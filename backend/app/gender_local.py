"""
Local neural gender detection (no API, no per-file cost, works offline).

Runs a wav2vec2 gender classifier exported to ONNX (prithivMLmods/Common-Voice-Gender-Detection-ONNX)
on each line's audio. The model is trained on adult speech, so children are its weak spot; the voting
layer in segment_gender.py and the cast list in the UI cover that.
"""

import logging
import os
import urllib.request
from pathlib import Path
from threading import Lock
from typing import Dict, Optional

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "gender"
MODEL_PATH = MODEL_DIR / "model.onnx"
MODEL_URL = "https://huggingface.co/prithivMLmods/Common-Voice-Gender-Detection-ONNX/resolve/main/onnx/model.onnx"

MAX_CLIP_SEC = 8.0   # centre crop for long lines (speed; gender is stable over a few seconds)
MIN_CLIP_SAMPLES = 4000  # 0.25 s at 16 kHz

_session = None
_lock = Lock()


def ensure_model() -> Optional[Path]:
    """Return the model path, downloading it once on first use. None if unavailable."""
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 1_000_000:
        return MODEL_PATH
    try:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("[Gender] Downloading local gender model (~378 MB, one time)...")
        tmp = MODEL_PATH.with_suffix(".part")
        urllib.request.urlretrieve(MODEL_URL, tmp)
        os.replace(tmp, MODEL_PATH)
        return MODEL_PATH
    except Exception as e:
        logger.warning(f"[Gender] Local gender model unavailable: {e}")
        return None


def _get_session():
    global _session
    with _lock:
        if _session is None:
            path = ensure_model()
            if path is None:
                return None
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
            _session = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
        return _session


def local_gender_probs(audio_path: str, segments) -> Dict[int, float]:
    """{segment_id: probability the speaker is female} for every line long enough to judge."""
    session = _get_session()
    if session is None:
        return {}
    input_name = session.get_inputs()[0].name
    try:
        info = sf.info(audio_path)
    except Exception as e:
        logger.warning(f"[Gender] Cannot read audio for local model: {e}")
        return {}
    sr = info.samplerate
    out: Dict[int, float] = {}
    for seg in segments:
        start, end = seg.start_time, seg.end_time
        if end - start > MAX_CLIP_SEC:
            mid = (start + end) / 2
            start, end = mid - MAX_CLIP_SEC / 2, mid + MAX_CLIP_SEC / 2
        try:
            data, _ = sf.read(audio_path, start=int(max(0.0, start) * sr), stop=int(min(end, info.duration) * sr),
                              dtype="float32", always_2d=True)
        except Exception:
            continue
        y = data.mean(axis=1)
        if sr != 16000 and len(y) > 1:
            y = np.interp(np.linspace(0, len(y) - 1, int(len(y) * 16000 / sr)), np.arange(len(y)), y).astype(np.float32)
        if len(y) < MIN_CLIP_SAMPLES:
            continue
        y = (y - y.mean()) / (y.std() + 1e-7)
        logits = session.run(None, {input_name: y[None, :].astype(np.float32)})[0][0]
        e = np.exp(logits - logits.max())
        out[seg.segment_id] = float((e / e.sum())[0])  # index 0 = female
    return out
