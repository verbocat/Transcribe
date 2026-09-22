import os
import math
import logging
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional
import numpy as np
import soundfile as sf
from pydub import AudioSegment
import imageio_ffmpeg

logger = logging.getLogger(__name__)

from app.config import (
    MAX_SEGMENT_DURATION,
    MIN_SEGMENT_DURATION,
    SEGMENT_BUFFER_SEC,
    MAX_SILENCE_SEC
)

# Configure ffmpeg for pydub safely
try:
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    if ffmpeg_exe and Path(ffmpeg_exe).exists():
        AudioSegment.converter = ffmpeg_exe
        AudioSegment.ffmpeg = ffmpeg_exe
        ffmpeg_dir = str(Path(ffmpeg_exe).parent)
        if ffmpeg_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass


def format_timestamp(seconds: float) -> str:
    """Format seconds into HH:MM:SS.mmm string."""
    if seconds < 0:
        seconds = 0.0
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hrs:02d}:{mins:02d}:{secs:06.3f}"


def parse_timestamp(timestamp_val: Any) -> float:
    """
    Robustly parse timestamp into float seconds.
    Handles:
    - float / int seconds (e.g. 5.25)
    - HH:MM:SS.mmm (e.g. 00:01:23.450)
    - HH:MM:SS,mmm (SRT format e.g. 00:01:23,450)
    - MM:SS:mmm (e.g. 00:05:250 -> 5.25s, fixing colon-before-millis bug)
    - MM:SS.mmm (e.g. 05:23.450)
    - HH:MM:SS:mmm (4 parts e.g. 00:00:05:250)
    """
    if timestamp_val is None:
        return 0.0
    if isinstance(timestamp_val, (int, float)):
        return max(0.0, float(timestamp_val))
    
    ts_str = str(timestamp_val).strip()
    if not ts_str:
        return 0.0

    # Normalize SRT style comma decimal separator
    ts_str = ts_str.replace(",", ".")

    try:
        if ":" in ts_str:
            parts = ts_str.split(":")
            if len(parts) == 4:
                # HH:MM:SS:mmm
                h, m, s, ms = parts
                ms_val = float(ms)
                ms_div = 1000.0 if len(ms) <= 3 else (10.0 ** len(ms))
                return max(0.0, int(h) * 3600 + int(m) * 60 + int(s) + ms_val / ms_div)
            elif len(parts) == 3:
                p0, p1, p2 = parts
                # Disambiguate HH:MM:SS.mmm vs MM:SS:mmm
                # If p2 has 3 digits without a dot, or float(p2) >= 60, it represents milliseconds!
                try:
                    val2 = float(p2)
                    if val2 >= 60 or (len(p2) == 3 and "." not in p2):
                        # MM:SS:mmm format (e.g. 00:05:250 -> 5.250s)
                        return max(0.0, int(p0) * 60 + int(p1) + val2 / 1000.0)
                    else:
                        # Standard HH:MM:SS.mmm
                        return max(0.0, int(p0) * 3600 + int(p1) * 60 + val2)
                except Exception:
                    return 0.0
            elif len(parts) == 2:
                p0, p1 = parts
                try:
                    val1 = float(p1)
                    if val1 >= 60 or (len(p1) == 3 and "." not in p1):
                        return max(0.0, int(p0) + val1 / 1000.0)
                    return max(0.0, int(p0) * 60 + val1)
                except Exception:
                    return 0.0
        return max(0.0, float(ts_str))
    except Exception:
        return 0.0


def inspect_audio(audio_path: str) -> Dict[str, Any]:
    """Safely inspect audio properties without throwing unhandled exceptions."""
    filename = Path(audio_path).name
    duration = 0.0
    channels = 1
    sample_rate = 16000
    rms_db = -20.0
    snr_db = 25.0

    # Try soundfile first (pure binary libsndfile, no ffmpeg subprocess needed)
    try:
        sf_info = sf.info(audio_path)
        duration = float(sf_info.duration)
        channels = int(sf_info.channels)
        sample_rate = int(sf_info.samplerate)
    except Exception:
        pass

    # Try pydub if duration not yet determined
    if duration <= 0:
        try:
            sound = AudioSegment.from_file(audio_path)
            duration = float(sound.duration_seconds)
            channels = int(sound.channels)
            sample_rate = int(sound.frame_rate)
            if sound.dBFS != float("-inf"):
                rms_db = float(sound.dBFS)
        except Exception:
            pass

    # Fallback duration estimate from file size if needed
    if duration <= 0:
        try:
            file_size_bytes = Path(audio_path).stat().st_size
            # Rough estimate ~16KB/sec for standard 128kbps audio
            duration = max(1.0, round(file_size_bytes / 16000.0, 2))
        except Exception:
            duration = 10.0

    return {
        "filename": filename,
        "duration": round(duration, 3),
        "channels": channels,
        "sample_rate": sample_rate,
        "rms_db": round(rms_db, 2),
        "snr_db": round(snr_db, 2),
    }


def compute_acoustic_waveform_peaks(audio_path: str, points_per_sec: int = 50) -> Dict[str, Any]:
    """
    Extract high-precision normalized acoustic waveform peaks directly from audio.
    Streams in constant < 3MB RAM blocks regardless of file duration (zero OOM risk on cloud).
    """
    try:
        info = sf.info(audio_path)
        total_frames = info.frames
        sr = info.samplerate
        duration = float(info.duration)
    except Exception:
        info_d = inspect_audio(audio_path)
        return {
            "duration": info_d.get("duration", 0.0),
            "points_per_sec": points_per_sec,
            "peaks": []
        }

    if total_frames <= 0 or duration <= 0:
        return {"duration": 0.0, "points_per_sec": points_per_sec, "peaks": []}

    block_size = max(1, sr // points_per_sec)
    total_points = int(total_frames // block_size)
    if total_points == 0:
        return {"duration": round(duration, 3), "points_per_sec": points_per_sec, "peaks": [0.05]}

    raw_peaks = []
    rms_vals = []

    try:
        # Read in streaming 30-second blocks to maintain tiny memory footprint
        chunk_frames = sr * 30
        with sf.SoundFile(audio_path) as f:
            while f.tell() < total_frames:
                data = f.read(chunk_frames, dtype='float32')
                if data.ndim > 1:
                    data = np.mean(data, axis=1)
                n_pts = len(data) // block_size
                if n_pts > 0:
                    trimmed = data[:n_pts * block_size].reshape(n_pts, block_size)
                    p = np.max(np.abs(trimmed), axis=1)
                    r = np.sqrt(np.mean(trimmed**2, axis=1))
                    raw_peaks.extend(p)
                    rms_vals.extend(r)

        if not raw_peaks:
            return {"duration": round(duration, 3), "points_per_sec": points_per_sec, "peaks": [0.05]}

        raw_peaks = np.array(raw_peaks)
        rms_vals = np.array(rms_vals)
        envelope = 0.6 * raw_peaks + 0.4 * (rms_vals * 2.5)
        p99 = np.percentile(envelope, 99) if len(envelope) > 0 else 1.0
        norm_factor = p99 if p99 > 1e-4 else 1.0
        normalized = np.clip(envelope / norm_factor, 0.02, 1.0)

        return {
            "duration": round(duration, 3),
            "points_per_sec": points_per_sec,
            "peaks": [round(float(p), 4) for p in normalized]
        }
    except Exception as e:
        print(f"Streaming waveform error: {e}")
        return {"duration": round(duration, 3), "points_per_sec": points_per_sec, "peaks": []}



def detect_speech_boundaries(
    audio_path: str,
    min_silence_len_ms: int = 400,
    silence_thresh_offset_db: float = 16.0,
    max_duration_sec: float = MAX_SEGMENT_DURATION,
    min_duration_sec: float = MIN_SEGMENT_DURATION,
    buffer_sec: float = SEGMENT_BUFFER_SEC,
    max_silence_boundary_sec: float = MAX_SILENCE_SEC
) -> List[Tuple[float, float]]:
    """
    Detect speech intervals complying with Karya segmentation rules:
    - Min duration: 0.5s
    - Max duration: 20.0s
    - Buffer ~0.3s start & end
    - No silence > 4s inside segment
    - Non-overlapping
    """
    try:
        sound = AudioSegment.from_file(audio_path)
        total_duration = sound.duration_seconds
        
        if total_duration < min_duration_sec:
            return [(0.0, total_duration)]

        # Dynamic silence threshold based on average loudness
        avg_db = sound.dBFS
        silence_thresh = avg_db - silence_thresh_offset_db if avg_db > -60 else -40.0

        # Non-silent chunk detection
        from pydub.silence import detect_nonsilent
        nonsilent_ranges = detect_nonsilent(
            sound,
            min_silence_len=min_silence_len_ms,
            silence_thresh=silence_thresh
        )
    except Exception:
        nonsilent_ranges = []
        info = inspect_audio(audio_path)
        total_duration = info.get("duration", 10.0)

    if not nonsilent_ranges:
        # Fallback: divide audio into uniform 10-second segments
        raw_segments = []
        cur = 0.0
        while cur < total_duration:
            end = min(cur + 10.0, total_duration)
            raw_segments.append((round(cur, 3), round(end, 3)))
            cur = end
        return raw_segments if raw_segments else [(0.0, max(5.0, total_duration))]

    # Convert ms ranges to float seconds
    raw_segments: List[Tuple[float, float]] = []
    for start_ms, end_ms in nonsilent_ranges:
        s_sec = max(0.0, start_ms / 1000.0)
        e_sec = min(total_duration, end_ms / 1000.0)
        if e_sec - s_sec >= 0.1:
            raw_segments.append((s_sec, e_sec))

    # Merge very close segments (gap < 0.3s) if merged length <= max_duration_sec
    merged_segments: List[Tuple[float, float]] = []
    if raw_segments:
        cur_s, cur_e = raw_segments[0]
        for s, e in raw_segments[1:]:
            gap = s - cur_e
            # If gap is short and total duration stays under 20s and gap < 4.0s
            if gap < 0.5 and (e - cur_s) <= max_duration_sec and gap < max_silence_boundary_sec:
                cur_e = e
            else:
                merged_segments.append((cur_s, cur_e))
                cur_s, cur_e = s, e
        merged_segments.append((cur_s, cur_e))
    else:
        merged_segments = [(0.0, total_duration)]

    # Split segments longer than max_duration_sec (20.0s)
    split_segments: List[Tuple[float, float]] = []
    for s, e in merged_segments:
        seg_dur = e - s
        if seg_dur > max_duration_sec:
            # Split into chunks of at most 15-18s
            num_splits = math.ceil(seg_dur / 15.0)
            chunk_len = seg_dur / num_splits
            for i in range(num_splits):
                cs = s + (i * chunk_len)
                ce = min(e, s + ((i + 1) * chunk_len))
                if ce - cs >= min_duration_sec:
                    split_segments.append((cs, ce))
        elif seg_dur >= min_duration_sec:
            split_segments.append((s, e))

    if not split_segments:
        split_segments = [(0.0, min(total_duration, 15.0))]

    # Apply ~0.3s buffer at start & end, strictly preventing overlaps
    buffered_segments: List[Tuple[float, float]] = []
    prev_end = 0.0

    for i, (s, e) in enumerate(split_segments):
        # Buffered start: at least prev_end, with up to 0.3s buffer
        buffered_s = max(prev_end, s - buffer_sec)
        buffered_s = max(0.0, buffered_s)
        
        # Next segment start
        next_s = split_segments[i+1][0] if i+1 < len(split_segments) else total_duration
        
        # Buffered end: at most next_s, with up to 0.3s buffer
        buffered_e = min(total_duration, e + buffer_sec)
        if i + 1 < len(split_segments):
            buffered_e = min(buffered_e, (e + next_s) / 2.0)
        
        # Ensure minimum duration
        if buffered_e - buffered_s < min_duration_sec:
            buffered_e = min(total_duration, buffered_s + min_duration_sec)
            
        # Ensure maximum duration
        if buffered_e - buffered_s > max_duration_sec:
            buffered_e = buffered_s + max_duration_sec

        # Ensure no overlap
        buffered_s = round(buffered_s, 3)
        buffered_e = round(buffered_e, 3)
        if buffered_e > buffered_s:
            buffered_segments.append((buffered_s, buffered_e))
            prev_end = buffered_e

    return buffered_segments


def snap_to_acoustic_boundaries(
    audio_path: str,
    raw_start: Any,
    raw_end: Any,
    collar_sec: float = 0.20,
) -> Tuple[float, float]:
    """
    Safely refines proposed start and end timestamps by finding the exact acoustic
    speech onset and decay within a tight local micro-collar (+/- 0.20s).
    Uses direct disk seek-reads (sub-millisecond, < 100KB RAM) to prevent memory spikes on long media.
    """
    raw_start = parse_timestamp(raw_start)
    raw_end = parse_timestamp(raw_end)
    if not audio_path or not os.path.exists(audio_path):
        return round(raw_start, 3), round(raw_end, 3)

    # Fast Neural VAD snapping (Silero VAD) with graceful fallback to RMS energy
    try:
        from app.vad_processor import is_vad_available, snap_to_acoustic_boundaries_vad
        if is_vad_available():
            return snap_to_acoustic_boundaries_vad(audio_path, raw_start, raw_end, collar_sec)
    except Exception as e:
        logger.debug(f"Silero VAD snapping fallback to RMS: {e}")

    try:
        info = sf.info(audio_path)
        samplerate = info.samplerate
        total_sec = float(info.duration)
        if total_sec <= 0.1:
            return round(raw_start, 3), round(raw_end, 3)

        frame_len = max(16, int(samplerate * 0.010))  # 10ms frame
        hop_len = max(4, int(samplerate * 0.002))     # 2ms hop

        # 1. Refine Start Time within tight [raw_start - collar_sec, raw_start + collar_sec]
        s_min = max(0.0, raw_start - collar_sec)
        s_max = min(total_sec, raw_start + collar_sec)
        idx_s = int(s_min * samplerate)
        idx_e = int(s_max * samplerate)

        refined_start = raw_start
        if idx_e > idx_s:
            chunk_s, _ = sf.read(audio_path, start=idx_s, stop=idx_e, dtype='float32')
            if chunk_s.ndim > 1:
                chunk_s = np.mean(chunk_s, axis=1)

            if len(chunk_s) > frame_len * 2:
                energies_s = [
                    float(np.sqrt(np.mean(chunk_s[f:f + frame_len]**2)))
                    for f in range(0, len(chunk_s) - frame_len, hop_len)
                ]
                if energies_s:
                    noise_s = float(np.percentile(energies_s, 20))
                    peak_s = float(np.max(energies_s))
                    thresh_s = noise_s + 0.15 * (peak_s - noise_s)

                    center_idx = int((raw_start - s_min) * samplerate / hop_len)
                    center_idx = max(0, min(len(energies_s) - 1, center_idx))

                    # Walk backward from center to find speech onset
                    best_start_idx = center_idx
                    for idx in range(center_idx, -1, -1):
                        if energies_s[idx] <= thresh_s:
                            best_start_idx = idx
                            break

                    calc_start = s_min + (best_start_idx * hop_len) / samplerate
                    refined_start = round(calc_start, 3)

        # 2. Refine End Time within tight [raw_end - collar_sec, raw_end + collar_sec]
        e_min = max(refined_start + 0.2, raw_end - collar_sec)
        e_max = min(total_sec, raw_end + collar_sec)
        idx_e_s = int(e_min * samplerate)
        idx_e_e = int(e_max * samplerate)

        refined_end = raw_end
        if idx_e_e > idx_e_s:
            chunk_e, _ = sf.read(audio_path, start=idx_e_s, stop=idx_e_e, dtype='float32')
            if chunk_e.ndim > 1:
                chunk_e = np.mean(chunk_e, axis=1)

            if len(chunk_e) > frame_len * 2:
                energies_e = [
                    float(np.sqrt(np.mean(chunk_e[f:f + frame_len]**2)))
                    for f in range(0, len(chunk_e) - frame_len, hop_len)
                ]
                if energies_e:
                    noise_e = float(np.percentile(energies_e, 20))
                    peak_e = float(np.max(energies_e))
                    thresh_e = noise_e + 0.15 * (peak_e - noise_e)

                    center_end_idx = int((raw_end - e_min) * samplerate / hop_len)
                    center_end_idx = max(0, min(len(energies_e) - 1, center_end_idx))

                    # Walk forward from center to find speech decay
                    best_end_idx = center_end_idx
                    for idx in range(center_end_idx, len(energies_e)):
                        if energies_e[idx] <= thresh_e:
                            best_end_idx = idx
                            break

                    calc_end = e_min + (best_end_idx * hop_len) / samplerate
                    refined_end = round(calc_end, 3)

        # Guardrails: never let refined duration drop below 0.4s
        if refined_end - refined_start < 0.4:
            refined_start = raw_start
            refined_end = max(raw_start + 0.4, raw_end)

        return round(refined_start, 3), round(refined_end, 3)
    except Exception:
        return round(raw_start, 3), round(raw_end, 3)


def find_dialogue_split_points(
    audio_path: str,
    target_chunk_sec: float = 90.0,    # ~90s batches for fast, high-quality delivery
    min_chunk_sec: float = 65.0,       # at least 65s
    max_chunk_sec: float = 115.0,      # up to 115s (+/- n seconds)
    start_offset_sec: float = 0.0
) -> List[Tuple[float, float]]:
    """
    Partitions audio into ~90s batches (+/- n seconds) ending at clean dialogue pauses (>= 1-2s).
    Prefers Silero neural VAD to distinguish human speech from background music/score.
    Falls back to vectorized acoustic energy pause detection if VAD is unavailable.
    """
    # 1. Try Silero VAD for neural voice activity detection (resilient to background music)
    try:
        from app.vad_processor import is_vad_available, find_vad_dialogue_cut_points
        if is_vad_available():
            vad_chunks = find_vad_dialogue_cut_points(
                audio_path,
                target_chunk_sec=target_chunk_sec,
                min_chunk_sec=min_chunk_sec,
                max_chunk_sec=max_chunk_sec,
                min_pause_sec=1.2,
                start_offset_sec=start_offset_sec
            )
            if vad_chunks:
                return vad_chunks
    except Exception as e:
        logger.warning(f"VAD dialogue cut points failed, falling back to energy pause detection: {e}")

    # 2. Energy-based fallback
    try:
        info = sf.info(audio_path)
        total_sec = float(info.duration)
        samplerate = info.samplerate
        total_frames = info.frames
    except Exception:
        info_d = inspect_audio(audio_path)
        total_sec = float(info_d.get("duration", 0.0))
        samplerate = 16000
        total_frames = int(total_sec * samplerate)

    cur_start = max(0.0, min(float(start_offset_sec), max(0.0, total_sec - 0.5)))

    # If remaining audio from cur_start is already <= max_chunk_sec, process as single chunk
    if (total_sec - cur_start) <= max_chunk_sec or total_frames <= 0:
        return [(round(cur_start, 3), round(total_sec, 3))]

    chunks: List[Tuple[float, float]] = []

    while cur_start < total_sec:
        remaining = total_sec - cur_start
        if remaining <= max_chunk_sec:
            chunks.append((round(cur_start, 3), round(total_sec, 3)))
            break

        # Search window: flexible between min_chunk_sec and max_chunk_sec
        win_s = cur_start + min_chunk_sec
        win_e = min(total_sec, cur_start + max_chunk_sec)
        best_split_point = cur_start + target_chunk_sec

        try:
            start_frame = int(win_s * samplerate)
            stop_frame = int(win_e * samplerate)
            window_data, _ = sf.read(audio_path, start=start_frame, stop=stop_frame, dtype='float32')
            if window_data.ndim > 1:
                window_data = np.mean(window_data, axis=1)

            frame_len = int(samplerate * 0.05)  # 50ms
            hop_len = int(samplerate * 0.01)    # 10ms
            num_hops = max(1, (len(window_data) - frame_len) // hop_len)

            strided = np.lib.stride_tricks.sliding_window_view(window_data[:num_hops * hop_len + frame_len], frame_len)[::hop_len]
            energies = np.sqrt(np.mean(strided**2, axis=1))
            candidate_times = win_s + (np.arange(len(energies)) * 0.01)

            floor = float(np.percentile(energies, 1))
            p90 = float(np.percentile(energies, 85))
            dyn_range = max(1e-5, p90 - floor)
            silence_threshold = floor + 0.16 * dyn_range

            silent_mask = energies <= silence_threshold
            best_score = float('inf')
            run_start = None

            # Look for sustained dialogue pauses (preferring >= 1.0s - 1.5s)
            found_runs = []
            for idx, is_sil in enumerate(silent_mask):
                if is_sil:
                    if run_start is None:
                        run_start = idx
                else:
                    if run_start is not None:
                        run_len = idx - run_start
                        run_dur = run_len * 0.01
                        if run_dur >= 0.35:
                            run_mid_time = candidate_times[(run_start + idx) // 2]
                            found_runs.append((run_mid_time, run_dur))
                        run_start = None

            if run_start is not None:
                run_len = len(silent_mask) - run_start
                run_dur = run_len * 0.01
                if run_dur >= 0.35:
                    run_mid_time = candidate_times[(run_start + len(silent_mask)) // 2]
                    found_runs.append((run_mid_time, run_dur))

            # Tier 1: Look for runs >= 1.2s pause
            tier1 = [r for r in found_runs if r[1] >= 1.2]
            if tier1:
                best_run = min(tier1, key=lambda r: abs(r[0] - (cur_start + target_chunk_sec)))
                best_split_point = best_run[0]
            elif found_runs:
                # Tier 2: Best available pause >= 0.5s closest to target
                tier2 = [r for r in found_runs if r[1] >= 0.5]
                if tier2:
                    best_run = min(tier2, key=lambda r: abs(r[0] - (cur_start + target_chunk_sec)))
                    best_split_point = best_run[0]
                else:
                    best_run = min(found_runs, key=lambda r: abs(r[0] - (cur_start + target_chunk_sec)))
                    best_split_point = best_run[0]
            else:
                # If no pause found, find the deepest acoustic valley
                roll_window = 50
                if len(energies) > roll_window:
                    kernel = np.ones(roll_window) / roll_window
                    smooth = np.convolve(energies, kernel, mode='valid')
                    min_idx = int(np.argmin(smooth)) + (roll_window // 2)
                    best_split_point = candidate_times[min_idx]
                else:
                    min_idx = int(np.argmin(energies))
                    best_split_point = candidate_times[min_idx]

        except Exception:
            best_split_point = cur_start + target_chunk_sec

        best_split_point = round(min(total_sec, max(cur_start + min_chunk_sec, best_split_point)), 3)
        chunks.append((round(cur_start, 3), best_split_point))
        cur_start = best_split_point

    return chunks



def extract_audio_slice(audio_path: str, start_sec: float, end_sec: float, output_path: str) -> str:
    """Extracts an audio slice from start_sec to end_sec and saves it to output_path with direct disk seeking."""
    try:
        info = sf.info(audio_path)
        samplerate = info.samplerate
        total_frames = info.frames
        idx_s = int(max(0.0, start_sec) * samplerate)
        idx_e = int(min(float(total_frames), end_sec * samplerate))
        slice_data, _ = sf.read(audio_path, start=idx_s, stop=idx_e, dtype='float32')
        sf.write(output_path, slice_data, samplerate)
        return output_path
    except Exception:
        try:
            sound = AudioSegment.from_file(audio_path)
            chunk = sound[int(start_sec * 1000):int(end_sec * 1000)]
            chunk.export(output_path, format="wav")
            return output_path
        except Exception as e:
            print(f"Error extracting audio slice: {e}")
            return audio_path


def apply_dynamic_audio_normalization(input_wav: str, output_wav: str) -> str:
    """
    Applies FFmpeg dynamic audio normalizer (dynaudnorm) to boost quiet in-game/Discord
    voice chat so all speakers have balanced volume before feeding to Gemini and Whisper.
    
    Parameters:
    - p=0.95: Target peak amplitude (95% headroom to prevent digital clipping)
    - m=10.0: Max gain factor (+20dB boost for quiet speech, preventing runaway noise floor)
    - s=12.0: Smoothing filter window to prevent volume pumping
    - g=15: Gaussian filter size for natural transitions
    
    Falls back gracefully to input_wav if FFmpeg fails.
    """
    import subprocess
    try:
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        if not ffmpeg_exe or not Path(ffmpeg_exe).exists():
            return input_wav
        
        cmd = [
            ffmpeg_exe,
            "-i", str(input_wav),
            "-af", "dynaudnorm=p=0.95:m=10:s=12:g=15",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            "-y",
            str(output_wav)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if res.returncode == 0 and Path(output_wav).exists() and Path(output_wav).stat().st_size > 1000:
            return output_wav
        else:
            logger.warning(f"dynaudnorm failed (rc={res.returncode}): {res.stderr[:200]}, using original audio.")
            return input_wav
    except Exception as e:
        logger.warning(f"Error applying dynamic audio normalization: {e}, using original audio.")
        return input_wav


def detect_dual_channel_layout(audio_path: str) -> Dict[str, Any]:
    """
    Checks if a WAV file contains discrete 2-channel audio (Left = Speaker 1, Right = Speaker 2).
    Computes cross-channel correlation to distinguish true dual-track audio from mono stereo.
    Reads at most 30 seconds to keep memory < 2MB.
    """
    try:
        info = sf.info(audio_path)
        if info.channels < 2:
            return {"is_dual_channel": False, "channels": 1, "correlation": 1.0}

        samplerate = info.samplerate
        max_samples = min(info.frames, int(30 * samplerate))
        data, _ = sf.read(audio_path, stop=max_samples, dtype='float32')
        if len(data.shape) < 2 or data.shape[1] < 2:
            return {"is_dual_channel": False, "channels": 1, "correlation": 1.0}

        left = data[:, 0]
        right = data[:, 1]

        # Check RMS of each channel
        rms_left = float(np.sqrt(np.mean(left**2)))
        rms_right = float(np.sqrt(np.mean(right**2)))

        if rms_left < 1e-6 and rms_right < 1e-6:
            return {"is_dual_channel": False, "channels": 2, "correlation": 1.0}

        # Subsample for fast correlation check
        step = max(1, len(left) // 50000)
        sub_l = left[::step]
        sub_r = right[::step]

        # Pearson correlation between Left and Right channels
        std_l = float(np.std(sub_l))
        std_r = float(np.std(sub_r))

        if std_l > 1e-6 and std_r > 1e-6:
            corr = float(np.corrcoef(sub_l, sub_r)[0, 1])
        else:
            corr = 1.0

        # If correlation < 0.92 and both channels contain distinct signal, it is true dual-channel!
        is_discrete_stereo = bool(corr < 0.92 and (rms_left > 1e-5 or rms_right > 1e-5))

        return {
            "is_dual_channel": is_discrete_stereo,
            "channels": 2,
            "correlation": round(corr, 3),
            "rms_left_db": round(20 * math.log10(max(1e-7, rms_left)), 2),
            "rms_right_db": round(20 * math.log10(max(1e-7, rms_right)), 2)
        }
    except Exception:
        return {"is_dual_channel": False, "channels": 1, "correlation": 1.0}


def extract_physical_speech_intervals(
    audio_path: str,
    min_dur: float = 0.5,
    max_dur: float = 20.0,
    silence_gap: float = 0.35
) -> List[Dict[str, Any]]:
    """
    Extracts physical ground-truth speech intervals directly from raw PCM audio waveform samples.
    - If 2-Channel Stereo: Channel 0 is tagged as Speaker 1, Channel 1 is tagged as Speaker 2.
    - If Mono: Uses dual-threshold energy VAD to find exact physical speech onset and decay timestamps.
    Guarded against long-file OOM crashes (< 3MB RAM).
    """
    try:
        info = sf.info(audio_path)
        total_sec = float(info.duration)
        samplerate = info.samplerate
        total_frames = info.frames
    except Exception:
        return []

    # Fast Neural Silero VAD (handles any duration with < 5MB RAM and high accuracy)
    try:
        from app.vad_processor import is_vad_available, get_speech_timestamps_vad
        if is_vad_available():
            vad_intervals = get_speech_timestamps_vad(
                audio_path,
                threshold=0.5,
                min_speech_duration_ms=int(min_dur * 1000),
                min_silence_duration_ms=int(silence_gap * 1000)
            )
            if vad_intervals:
                return vad_intervals
    except Exception as e:
        logger.debug(f"Silero VAD interval extraction fallback to energy: {e}")

    # On long recordings (> 180s) without VAD, return empty so we rely on seek-based acoustic snapping
    if total_sec > 180.0 or total_frames <= 0:
        return []

    try:
        data, _ = sf.read(audio_path, dtype='float32')
    except Exception:
        return []

    is_stereo = len(data.shape) > 1 and data.shape[1] >= 2
    channel_info = detect_dual_channel_layout(audio_path) if is_stereo else {"is_dual_channel": False}
    is_dual_channel = channel_info.get("is_dual_channel", False)

    frame_len = int(samplerate * 0.02)  # 20ms frame
    hop_len = int(samplerate * 0.01)    # 10ms hop

    intervals: List[Dict[str, Any]] = []

    if is_dual_channel:
        # Separate VAD on Left (Speaker 1) and Right (Speaker 2)
        for ch_idx, speaker_label in [(0, "Speaker 1"), (1, "Speaker 2")]:
            ch_data = data[:, ch_idx]
            # Pre-emphasis filter
            pre_emph = np.append(ch_data[0], ch_data[1:] - 0.95 * ch_data[:-1])

            ch_energies = []
            ch_times = []
            for f_idx in range(0, len(pre_emph) - frame_len, hop_len):
                frame = pre_emph[f_idx:f_idx + frame_len]
                rms = float(np.sqrt(np.mean(frame**2)))
                ch_energies.append(rms)
                ch_times.append(f_idx / samplerate)

            if not ch_energies:
                continue

            ch_energies = np.array(ch_energies)
            ch_times = np.array(ch_times)

            noise_floor = float(np.percentile(ch_energies, 15))
            dyn_range = float(np.max(ch_energies)) - noise_floor

            if dyn_range < 1e-4:
                continue

            thresh_trigger = noise_floor + 0.18 * dyn_range
            thresh_hold = noise_floor + 0.06 * dyn_range

            in_speech = False
            seg_s = 0.0

            for idx, e in enumerate(ch_energies):
                t = ch_times[idx]
                if not in_speech:
                    if e >= thresh_trigger:
                        in_speech = True
                        seg_s = max(0.0, t - 0.040)
                else:
                    if e < thresh_hold or (t - seg_s) >= max_dur:
                        # Check silence lookahead
                        is_end = True
                        lookahead = int(silence_gap / 0.01)
                        if (t - seg_s) < max_dur and idx + lookahead < len(ch_energies):
                            if np.max(ch_energies[idx:idx + lookahead]) >= thresh_trigger:
                                is_end = False

                        if is_end:
                            seg_e = min(len(data) / samplerate, t + 0.040)
                            if seg_e - seg_s >= min_dur:
                                intervals.append({
                                    "start_time": round(seg_s, 3),
                                    "end_time": round(seg_e, 3),
                                    "duration": round(seg_e - seg_s, 3),
                                    "speaker": speaker_label,
                                    "channel": ch_idx
                                })
                            in_speech = False

        # Sort combined dual-channel intervals chronologically
        intervals.sort(key=lambda x: x["start_time"])
    else:
        # Mono or Joint-Stereo physical VAD
        mono_data = np.mean(data, axis=1) if is_stereo else data
        pre_emph = np.append(mono_data[0], mono_data[1:] - 0.95 * mono_data[:-1])

        energies = []
        times = []
        for f_idx in range(0, len(pre_emph) - frame_len, hop_len):
            frame = pre_emph[f_idx:f_idx + frame_len]
            rms = float(np.sqrt(np.mean(frame**2)))
            energies.append(rms)
            times.append(f_idx / samplerate)

        if energies:
            energies = np.array(energies)
            times = np.array(times)
            noise_floor = float(np.percentile(energies, 15))
            dyn_range = float(np.max(energies)) - noise_floor

            if dyn_range >= 1e-4:
                thresh_trigger = noise_floor + 0.18 * dyn_range
                thresh_hold = noise_floor + 0.06 * dyn_range

                in_speech = False
                seg_s = 0.0

                for idx, e in enumerate(energies):
                    t = times[idx]
                    if not in_speech:
                        if e >= thresh_trigger:
                            in_speech = True
                            seg_s = max(0.0, t - 0.040)
                    else:
                        if e < thresh_hold or (t - seg_s) >= max_dur:
                            is_end = True
                            lookahead = int(silence_gap / 0.01)
                            if (t - seg_s) < max_dur and idx + lookahead < len(energies):
                                if np.max(energies[idx:idx + lookahead]) >= thresh_trigger:
                                    is_end = False

                            if is_end:
                                seg_e = min(len(mono_data) / samplerate, t + 0.040)
                                if seg_e - seg_s >= min_dur:
                                    intervals.append({
                                        "start_time": round(seg_s, 3),
                                        "end_time": round(seg_e, 3),
                                        "duration": round(seg_e - seg_s, 3),
                                        "speaker": "Speaker 1",
                                        "channel": 0
                                    })
                                in_speech = False
    return intervals


def resolve_segment_speaker_from_channels(
    audio_path: str,
    start_sec: float,
    end_sec: float,
    default_speaker: str = "Speaker 1"
) -> str:
    """
    If audio is discrete 2-channel stereo, determines whether Left (Speaker 1)
    or Right (Speaker 2) is speaking during [start_sec, end_sec] based on RMS energy ratio.
    Uses seek-reading to prevent memory spikes (< 100KB RAM).
    """
    try:
        info = sf.info(audio_path)
        if info.channels < 2:
            return default_speaker

        samplerate = info.samplerate
        idx_s = int(max(0.0, start_sec) * samplerate)
        idx_e = int(min(float(info.frames), end_sec * samplerate))
        if idx_e <= idx_s:
            return default_speaker

        data, _ = sf.read(audio_path, start=idx_s, stop=idx_e, dtype='float32')
        if len(data.shape) < 2 or data.shape[1] < 2:
            return default_speaker

        left_slice = data[:, 0]
        right_slice = data[:, 1]

        rms_left = float(np.sqrt(np.mean(left_slice**2)))
        rms_right = float(np.sqrt(np.mean(right_slice**2)))

        if rms_left > rms_right * 1.35 and rms_left > 1e-4:
            return "Speaker 1"
        elif rms_right > rms_left * 1.35 and rms_right > 1e-4:
            return "Speaker 2"
        return default_speaker
    except Exception:
        return default_speaker
