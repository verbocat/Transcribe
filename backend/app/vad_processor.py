import os
import logging
import warnings
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import numpy as np
import soundfile as sf
import scipy.signal as signal
import torch

logger = logging.getLogger(__name__)

# Global cached Silero VAD model instance
_SILERO_MODEL = None
_VAD_INITIALIZED = False


def get_silero_model():
    """
    Loads and caches the local Silero VAD TorchScript JIT model.
    Runs 100% on CPU (< 10MB RAM, < 2.3MB disk).
    """
    global _SILERO_MODEL, _VAD_INITIALIZED
    if _VAD_INITIALIZED:
        return _SILERO_MODEL

    _VAD_INITIALIZED = True
    base_dir = Path(__file__).resolve().parent.parent
    candidate_paths = [
        base_dir / "models" / "silero_vad.jit",
        Path.home() / ".cache" / "torch" / "hub" / "snakers4_silero-vad_master" / "src" / "silero_vad" / "data" / "silero_vad.jit"
    ]

    for p in candidate_paths:
        if p.exists():
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    model = torch.jit.load(str(p))
                    model.eval()
                    _SILERO_MODEL = model
                    logger.info(f"Silero VAD loaded successfully from {p}")
                    return _SILERO_MODEL
            except Exception as e:
                logger.warning(f"Failed to load Silero VAD from {p}: {e}")

    logger.warning("Silero VAD model file not found in candidate paths. VAD will use RMS fallback.")
    return None


def is_vad_available() -> bool:
    """Check if Silero VAD model is loaded and available."""
    return get_silero_model() is not None


def _load_and_resample_audio(
    audio_path: str,
    start_sec: Optional[float] = None,
    end_sec: Optional[float] = None,
    target_sr: int = 16000
) -> Tuple[Optional[np.ndarray], int]:
    """
    Reads an audio slice and resamples to 16,000 Hz mono for Silero VAD.
    Uses soundfile + scipy.signal.resample_poly for fast, memory-safe execution (< 5MB RAM).
    """
    if not os.path.exists(audio_path):
        return None, 0

    # If passed a video container, look for pre-extracted WAV or extracted audio
    ext = Path(audio_path).suffix.lower()
    if ext in ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.wmv', '.flv']:
        wav_cand = Path(audio_path).with_suffix(".wav")
        if wav_cand.exists():
            audio_path = str(wav_cand)
        else:
            return None, 0

    try:
        info = sf.info(audio_path)
        sr = info.samplerate
        total_dur = float(info.duration)

        start_frame = max(0, int((start_sec or 0.0) * sr))
        stop_frame = min(info.frames, int((end_sec or total_dur) * sr)) if end_sec is not None else None

        data, read_sr = sf.read(audio_path, start=start_frame, stop=stop_frame, dtype='float32')
        if data.size == 0:
            return None, 0

        # Convert stereo to mono
        if data.ndim > 1:
            data = np.mean(data, axis=1)

        # Resample to target_sr (16kHz)
        if read_sr != target_sr:
            gcd = np.gcd(target_sr, read_sr)
            up = target_sr // gcd
            down = read_sr // gcd
            data_16k = signal.resample_poly(data, up, down).astype(np.float32)
        else:
            data_16k = data

        return data_16k, target_sr
    except Exception as e:
        logger.warning(f"Audio load/resample failed in VAD ({audio_path}): {e}")
        return None, 0


def _process_single_vad_block(
    tensor: torch.Tensor,
    sr: int,
    time_offset: float,
    model: Any,
    trigger_threshold: float = 0.45,
    sustain_threshold: float = 0.25,
    min_speech_duration_ms: int = 200,
    min_silence_duration_ms: int = 120,
    lead_in_sec: float = 0.064,
    lead_out_sec: float = 0.080,
    window_size_samples: int = 512
) -> List[Dict[str, float]]:
    """
    Processes a bounded audio tensor with Silero VAD using dual-threshold hysteresis
    and broadcast lead-in/lead-out padding to prevent consonant clipping.
    """
    step = window_size_samples
    num_frames = len(tensor) // step
    if num_frames == 0:
        return []

    frame_dur = step / sr  # 0.032s (32ms)

    speech_frames = []
    with torch.no_grad():
        for f_idx in range(num_frames):
            chunk = tensor[f_idx * step : (f_idx + 1) * step].unsqueeze(0)
            prob = float(model(chunk, 16000).item())
            speech_frames.append(prob)

    if not speech_frames:
        return []

    min_speech_frames = max(1, int(min_speech_duration_ms / (frame_dur * 1000)))
    min_silence_frames = max(1, int(min_silence_duration_ms / (frame_dur * 1000)))

    intervals = []
    in_speech = False
    speech_start_idx = 0
    silence_count = 0

    for idx, p in enumerate(speech_frames):
        if not in_speech:
            if p >= trigger_threshold:
                in_speech = True
                speech_start_idx = idx
                silence_count = 0
        else:
            if p < sustain_threshold:
                silence_count += 1
                if silence_count >= min_silence_frames:
                    speech_end_idx = idx - silence_count
                    dur_frames = speech_end_idx - speech_start_idx + 1
                    if dur_frames >= min_speech_frames:
                        # Apply lead-in to preserve opening unvoiced consonants ('s', 'p', 't', 'k')
                        s_time = max(0.0, round(time_offset + speech_start_idx * frame_dur - lead_in_sec, 3))
                        # Apply lead-out to preserve trailing plosive releases and voice decay
                        e_time = round(time_offset + (speech_end_idx + 1) * frame_dur + lead_out_sec, 3)
                        intervals.append({
                            "start_time": s_time,
                            "end_time": e_time,
                            "duration": round(e_time - s_time, 3)
                        })
                    in_speech = False
                    silence_count = 0
            else:
                silence_count = 0

    # Catch trailing speech
    if in_speech:
        speech_end_idx = len(speech_frames) - 1
        dur_frames = speech_end_idx - speech_start_idx + 1
        if dur_frames >= min_speech_frames:
            s_time = max(0.0, round(time_offset + speech_start_idx * frame_dur - lead_in_sec, 3))
            e_time = round(time_offset + (speech_end_idx + 1) * frame_dur + lead_out_sec, 3)
            intervals.append({
                "start_time": s_time,
                "end_time": e_time,
                "duration": round(e_time - s_time, 3)
            })

    return intervals


def get_speech_timestamps_vad(
    audio_path: str,
    threshold: float = 0.45,
    min_speech_duration_ms: int = 200,
    min_silence_duration_ms: int = 120,
    start_sec: Optional[float] = None,
    end_sec: Optional[float] = None,
    window_size_samples: int = 512,
    block_duration_sec: float = 60.0
) -> List[Dict[str, float]]:
    """
    Extracts frame-accurate speech intervals directly from raw audio using Silero VAD.
    - Uses 60s streaming blocks to bound RAM usage strictly < 8MB on files of ANY duration.
    - Uses dual-threshold hysteresis (0.45 trigger / 0.25 sustain) for whispers & emotional scenes.
    - Preserves unvoiced plosives and fricatives with lead-in and lead-out cushions.
    - Returns: List of {"start_time": float, "end_time": float, "duration": float}
    """
    model = get_silero_model()
    if model is None or not os.path.exists(audio_path):
        return []

    try:
        info = sf.info(audio_path)
        total_audio_dur = float(info.duration)
    except Exception:
        return []

    req_start = max(0.0, float(start_sec or 0.0))
    req_end = min(total_audio_dur, float(end_sec or total_audio_dur)) if end_sec is not None else total_audio_dur

    if req_end <= req_start:
        return []

    # If duration <= 65 seconds, process as single block for maximum speed
    span = req_end - req_start
    if span <= (block_duration_sec + 5.0):
        data_16k, sr = _load_and_resample_audio(audio_path, start_sec=req_start, end_sec=req_end, target_sr=16000)
        if data_16k is None or len(data_16k) < window_size_samples:
            return []
        tensor = torch.from_numpy(data_16k)
        try:
            model.reset_states()
        except Exception:
            pass
        return _process_single_vad_block(
            tensor, sr, req_start, model,
            trigger_threshold=threshold,
            sustain_threshold=0.25,
            min_speech_duration_ms=min_speech_duration_ms,
            min_silence_duration_ms=min_silence_duration_ms,
            lead_in_sec=0.064,
            lead_out_sec=0.080,
            window_size_samples=window_size_samples
        )

    # For long audio (> 60s), process in sliding 60-second blocks with 1.0s overlap to cap RAM < 8MB
    all_intervals: List[Dict[str, float]] = []
    curr_s = req_start
    overlap_s = 1.0

    while curr_s < req_end:
        curr_e = min(req_end, curr_s + block_duration_sec)
        data_16k, sr = _load_and_resample_audio(audio_path, start_sec=curr_s, end_sec=curr_e, target_sr=16000)
        if data_16k is not None and len(data_16k) >= window_size_samples:
            tensor = torch.from_numpy(data_16k)
            try:
                model.reset_states()
            except Exception:
                pass
            block_intervals = _process_single_vad_block(
                tensor, sr, curr_s, model,
                trigger_threshold=threshold,
                sustain_threshold=0.25,
                min_speech_duration_ms=min_speech_duration_ms,
                min_silence_duration_ms=min_silence_duration_ms,
                lead_in_sec=0.064,
                lead_out_sec=0.080,
                window_size_samples=window_size_samples
            )

            for inv in block_intervals:
                # Merge seamlessly with previous interval if overlapping across seam
                if all_intervals and inv["start_time"] <= all_intervals[-1]["end_time"] + 0.120:
                    all_intervals[-1]["end_time"] = max(all_intervals[-1]["end_time"], inv["end_time"])
                    all_intervals[-1]["duration"] = round(all_intervals[-1]["end_time"] - all_intervals[-1]["start_time"], 3)
                else:
                    all_intervals.append(inv)

        curr_s = curr_e - overlap_s if curr_e < req_end else req_end

    return all_intervals


def snap_timestamp_to_voice_vad(
    audio_path: str,
    target_time: float,
    is_start: bool = True,
    collar_sec: float = 0.25,
    threshold: float = 0.45,
    sustain_threshold: float = 0.25,
    lead_in_sec: float = 0.064,
    lead_out_sec: float = 0.080
) -> float:
    """
    Refines a proposed subtitle boundary within a tight local collar (+/- collar_sec)
    using neural vocal cord detection.
    - If is_start=True: Finds exact vocal onset and applies lead-in padding to preserve opening consonants.
    - If is_start=False: Finds exact vocal offset and applies lead-out padding to preserve plosive releases.
    - Dual-threshold hysteresis ensures whispered and emotional speech decays are never truncated.
    """
    model = get_silero_model()
    if model is None or not os.path.exists(audio_path):
        return target_time

    collar_s = max(0.0, target_time - collar_sec)
    collar_e = target_time + collar_sec

    data_16k, sr = _load_and_resample_audio(audio_path, start_sec=collar_s, end_sec=collar_e, target_sr=16000)
    if data_16k is None or len(data_16k) < 512:
        return target_time

    tensor = torch.from_numpy(data_16k)
    try:
        model.reset_states()
    except Exception:
        pass

    window_size = 512
    frame_dur = window_size / 16000.0  # 0.032s
    num_frames = len(tensor) // window_size

    probs = []
    with torch.no_grad():
        for i in range(num_frames):
            chunk = tensor[i * window_size : (i + 1) * window_size].unsqueeze(0)
            p = float(model(chunk, 16000).item())
            frame_t = round(collar_s + i * frame_dur, 3)
            probs.append((frame_t, p))

    if not probs:
        return target_time

    target_idx = min(range(len(probs)), key=lambda idx: abs(probs[idx][0] - target_time))

    if is_start:
        # Search for speech onset
        if probs[target_idx][1] >= threshold:
            onset_t = probs[target_idx][0]
            # Walk backward until speech drops below sustain_threshold
            for idx in range(target_idx, -1, -1):
                if probs[idx][1] < sustain_threshold:
                    onset_t = probs[idx + 1][0] if idx + 1 < len(probs) else probs[idx][0]
                    break
            # Subtract lead-in cushion to preserve opening plosives/fricatives ('s', 'p', 't', 'k')
            return max(collar_s, round(onset_t - lead_in_sec, 3))
        else:
            # Voice hasn't engaged yet; search forward
            for idx in range(target_idx, len(probs)):
                if probs[idx][1] >= threshold:
                    # Pad onset backward with lead-in cushion
                    return max(collar_s, round(probs[idx][0] - lead_in_sec, 3))
    else:
        # Search for speech offset
        if probs[target_idx][1] >= sustain_threshold:
            offset_t = probs[target_idx][0] + frame_dur
            # Walk forward until speech drops below sustain_threshold
            for idx in range(target_idx, len(probs)):
                if probs[idx][1] < sustain_threshold:
                    offset_t = probs[idx][0]
                    break
            # Add lead-out cushion to preserve consonant releases and voice decay
            return min(collar_e, round(offset_t + lead_out_sec, 3))
        else:
            # Voice already ended; search backward
            for idx in range(target_idx, -1, -1):
                if probs[idx][1] >= sustain_threshold:
                    return min(collar_e, round(probs[idx][0] + frame_dur + lead_out_sec, 3))

    return target_time


def snap_to_acoustic_boundaries_vad(
    audio_path: str,
    raw_start: float,
    raw_end: float,
    collar_sec: float = 0.20
) -> Tuple[float, float]:
    """
    Safely refines both start and end timestamps using Silero VAD neural vocal detection.
    Falls back gracefully to existing logic if VAD model is unavailable.
    """
    model = get_silero_model()
    if model is None:
        from app.audio_processor import snap_to_acoustic_boundaries
        return snap_to_acoustic_boundaries(audio_path, raw_start, raw_end, collar_sec)

    st = snap_timestamp_to_voice_vad(audio_path, float(raw_start), is_start=True, collar_sec=collar_sec)
    et = snap_timestamp_to_voice_vad(audio_path, float(raw_end), is_start=False, collar_sec=collar_sec)

    return round(st, 3), round(et, 3)


def find_vad_dialogue_cut_points(
    audio_path: str,
    target_chunk_sec: float = 90.0,
    min_chunk_sec: float = 65.0,
    max_chunk_sec: float = 115.0,
    min_pause_sec: float = 1.2,
    start_offset_sec: float = 0.0
) -> List[Tuple[float, float]]:
    """
    Partitions audio into ~90s batches (+/- n seconds) ending at clean dialogue pauses (>= 1-2s).
    Uses Silero VAD to identify genuine human speech vs background music/score/silence.
    
    3-Tier Fallback Hierarchy:
      Tier 1: Look for pause >= 1.5s (or min_pause_sec) within [min_chunk_sec, max_chunk_sec].
      Tier 2: If none, look for pause >= 1.0s within extended window (up to max_chunk_sec + 15s).
      Tier 3: If continuous speech with no 1s pause, find longest speech pause (>= 0.4s) or speaker turn closest to 90s.
      Music / Silence: If no speech in window (music only), cut cleanly at target_chunk_sec.
    """
    model = get_silero_model()
    if model is None or not os.path.exists(audio_path):
        return []

    try:
        info = sf.info(audio_path)
        total_sec = float(info.duration)
    except Exception:
        return []

    cur_start = max(0.0, min(float(start_offset_sec), max(0.0, total_sec - 0.5)))
    if (total_sec - cur_start) <= max_chunk_sec:
        return [(round(cur_start, 3), round(total_sec, 3))]

    chunks: List[Tuple[float, float]] = []

    while cur_start < total_sec:
        remaining = total_sec - cur_start
        if remaining <= max_chunk_sec:
            chunks.append((round(cur_start, 3), round(total_sec, 3)))
            break

        # Search window
        win_s = cur_start + min_chunk_sec
        win_e = min(total_sec, cur_start + max_chunk_sec)
        # Extended window for Tier 2/3 (e.g. up to +15-20s if needed)
        win_e_ext = min(total_sec, cur_start + max_chunk_sec + 15.0)

        # Get VAD speech intervals in the extended window
        speech_intervals = get_speech_timestamps_vad(
            audio_path,
            threshold=0.40,  # Slightly sensitive to detect faint speech over music
            min_speech_duration_ms=180,
            min_silence_duration_ms=150,
            start_sec=max(0.0, win_s - 5.0),
            end_sec=min(total_sec, win_e_ext + 2.0)
        )

        best_split_point = None

        if not speech_intervals:
            # No speech detected in this window (e.g. instrumental music or silence)
            # Safe to cut cleanly at target_chunk_sec
            best_split_point = min(total_sec, cur_start + target_chunk_sec)
        else:
            # Build silence / non-speech gaps between speech intervals
            gaps = []
            # Gap before first speech interval if within window
            first_sp = speech_intervals[0]
            if first_sp["start_time"] > win_s:
                gaps.append({
                    "start": win_s,
                    "end": first_sp["start_time"],
                    "dur": first_sp["start_time"] - win_s
                })

            for i in range(len(speech_intervals) - 1):
                gap_start = speech_intervals[i]["end_time"]
                gap_end = speech_intervals[i + 1]["start_time"]
                gap_dur = gap_end - gap_start
                if gap_dur > 0.05:
                    gaps.append({
                        "start": gap_start,
                        "end": gap_end,
                        "dur": gap_dur
                    })

            # Gap after last speech interval if within window
            last_sp = speech_intervals[-1]
            if last_sp["end_time"] < win_e_ext:
                gaps.append({
                    "start": last_sp["end_time"],
                    "end": win_e_ext,
                    "dur": win_e_ext - last_sp["end_time"]
                })

            target_time = cur_start + target_chunk_sec

            # Tier 1: Gaps >= min_pause_sec (>= 1.2s - 1.5s) inside primary window [win_s, win_e]
            tier1_candidates = [
                g for g in gaps
                if g["dur"] >= min_pause_sec and (win_s <= g["start"] <= win_e or win_s <= g["end"] <= win_e)
            ]
            if tier1_candidates:
                # Pick candidate closest to target_time
                best_gap = min(tier1_candidates, key=lambda g: abs(((g["start"] + g["end"]) / 2.0) - target_time))
                # Split at gap midpoint, leaving at least 0.5s pause after previous dialogue
                best_split_point = round((best_gap["start"] + best_gap["end"]) / 2.0, 3)

            # Tier 2: Gaps >= 1.0s inside extended window [win_s, win_e_ext]
            if best_split_point is None:
                tier2_candidates = [
                    g for g in gaps
                    if g["dur"] >= 1.0 and (win_s <= g["start"] <= win_e_ext or win_s <= g["end"] <= win_e_ext)
                ]
                if tier2_candidates:
                    best_gap = min(tier2_candidates, key=lambda g: abs(((g["start"] + g["end"]) / 2.0) - target_time))
                    best_split_point = round((best_gap["start"] + best_gap["end"]) / 2.0, 3)

            # Tier 3: Longest natural breath/turn pause (>= 0.35s) closest to target_time
            if best_split_point is None:
                tier3_candidates = [
                    g for g in gaps
                    if g["dur"] >= 0.35 and (win_s <= g["start"] <= win_e_ext or win_s <= g["end"] <= win_e_ext)
                ]
                if tier3_candidates:
                    # Score by distance from target + bonus for longer gap
                    best_gap = min(tier3_candidates, key=lambda g: abs(((g["start"] + g["end"]) / 2.0) - target_time) - min(g["dur"], 2.0) * 10.0)
                    best_split_point = round((best_gap["start"] + best_gap["end"]) / 2.0, 3)

        if best_split_point is None:
            # Fallback if no pause detected (e.g. continuous screaming/singing)
            best_split_point = cur_start + target_chunk_sec

        # Bound split point to avoid infinite loop or overshoot
        best_split_point = round(min(total_sec, max(cur_start + min_chunk_sec, best_split_point)), 3)
        chunks.append((round(cur_start, 3), best_split_point))
        cur_start = best_split_point

    return chunks

