"""
Speaker gender detection from voice pitch (fundamental frequency).

Scribe v2 diarizes speakers but does not report gender, so each diarized speaker's
median F0 is measured from their own speech and mapped to Male / Female.
Pure numpy/soundfile - no extra model downloads.
"""

import logging
from typing import Dict, List, Optional

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

FRAME_SEC = 0.04
HOP_SEC = 0.01
F0_MIN, F0_MAX = 70.0, 400.0
VOICED_CORR = 0.5            # normalized autocorrelation peak needed to call a frame voiced
FEMALE_F0_THRESHOLD = 165.0  # median F0 at/above this -> Female (adult male ~85-155 Hz, female ~165-255 Hz)
MIN_VOICED_FRAMES = 15
MAX_SPEECH_PER_SPEAKER_SEC = 45.0
MIN_SPAN_SEC = 0.8


def _frame_f0s(y: np.ndarray, sr: int) -> List[float]:
    """Autocorrelation F0 for each voiced frame of a mono signal."""
    frame, hop = int(FRAME_SEC * sr), int(HOP_SEC * sr)
    lag_min, lag_max = int(sr / F0_MAX), int(sr / F0_MIN)
    if len(y) < frame + 1:
        return []
    window = np.hanning(frame)
    energy_floor = max(np.sqrt(np.mean(y ** 2)) * 0.5, 1e-4)
    n_fft = 1 << (2 * frame - 1).bit_length()
    f0s: List[float] = []
    for start in range(0, len(y) - frame, hop):
        x = y[start:start + frame]
        if np.sqrt(np.mean(x ** 2)) < energy_floor:
            continue
        x = (x - x.mean()) * window
        spec = np.fft.rfft(x, n_fft)
        ac = np.fft.irfft(spec * np.conj(spec))[:lag_max + 1]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        lag = lag_min + int(np.argmax(ac[lag_min:lag_max + 1]))
        if ac[lag] >= VOICED_CORR:
            f0s.append(sr / lag)
    return f0s


def _pick_spans(spans: List[tuple]) -> List[tuple]:
    """Longest-first spans up to the per-speaker speech budget."""
    chosen, total = [], 0.0
    for s, e in sorted(spans, key=lambda x: x[1] - x[0], reverse=True):
        if total >= MAX_SPEECH_PER_SPEAKER_SEC:
            break
        chosen.append((s, e))
        total += e - s
    return chosen


def detect_speaker_genders(audio_path: str, segments) -> Dict[str, str]:
    """Return {speaker label: 'Male' | 'Female' | 'Unknown'} for the given segments."""
    by_speaker: Dict[str, List[tuple]] = {}
    for seg in segments:
        if seg.end_time - seg.start_time >= MIN_SPAN_SEC:
            by_speaker.setdefault(seg.speaker, []).append((seg.start_time, seg.end_time))
    all_speakers = {seg.speaker for seg in segments}
    result = {spk: "Unknown" for spk in all_speakers}

    try:
        info = sf.info(audio_path)
    except Exception as e:
        logger.warning(f"[Gender] Cannot read audio for gender detection: {e}")
        return result

    sr = info.samplerate
    for spk, spans in by_speaker.items():
        f0s: List[float] = []
        for s, e in _pick_spans(spans):
            try:
                data, _ = sf.read(audio_path, start=int(s * sr), stop=int(min(e, info.duration) * sr),
                                  dtype="float32", always_2d=True)
            except Exception:
                continue
            y = data.mean(axis=1)
            f0s.extend(_frame_f0s(y, sr))
        if len(f0s) < MIN_VOICED_FRAMES:
            continue
        median_f0 = float(np.median(f0s))
        result[spk] = "Female" if median_f0 >= FEMALE_F0_THRESHOLD else "Male"
        logger.info(f"[Gender] {spk}: median F0 {median_f0:.0f} Hz over {len(f0s)} frames -> {result[spk]}")
    return result
