"""
Per-segment gender detection and gender-aware speaker splitting.

Diarization on noisy TV audio often merges a man and a woman under one speaker id, so gender is
decided per line and a speaker is identified by (diarized id, gender), renumbered by first appearance.

Each line gets a weighted vote from independent signals:
  * local wav2vec2 ONNX model (always available, free)          weight 1.0, soft probability
  * voice pitch                                                  weight 0.5, soft probability
  * Gemini watching the video (optional, needs credits)          weight 1.2
  * Gemini listening to the line's own clip (optional)           weight 0.8
If Gemini is unreachable (no credits, quota, network) the remaining signals still decide and a note
is returned so the UI can tell the user instead of silently degrading.
"""

import io
import json
import logging
import math
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List

import numpy as np
import soundfile as sf

from app.config import GEMINI_ASSIST
from app.gemini_util import generate_sync
from app.gender_local import local_gender_probs
from app.speaker_gender import _frame_f0s, MIN_VOICED_FRAMES

logger = logging.getLogger(__name__)

GEMINI_BATCH = 25
VIDEO_CHUNK_SEC = 150
W_LOCAL, W_PITCH, W_VIDEO, W_CLIP = 1.0, 0.5, 1.2, 0.8
PITCH_MIDPOINT_HZ, PITCH_SLOPE_HZ = 175.0, 20.0
KEEP_OWN_MIN_CONFIDENCE = 0.30   # |score - 0.5| a line needs to override its speaker's majority gender
KEEP_OWN_MIN_SEC = 1.0
_VALID = {"male": "Male", "female": "Female"}
_QUOTA_MARKERS = ("402", "429", "resource_exhausted", "quota", "prepayment", "billing", "credits", "permission_denied", "api key")


class GeminiDown(Exception):
    """Gemini cannot be used right now (credits, quota, auth)."""


def _is_quota_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(m in text for m in _QUOTA_MARKERS)


def _short(exc: Exception) -> str:
    text = str(exc)
    if "prepayment credits are depleted" in text:
        return "prepayment credits are depleted"
    if "429" in text or "quota" in text.lower():
        return "quota exceeded"
    return text[:90]


# ---------------------------------------------------------------- pitch

def _pitch_probs(audio_path: str, segments) -> Dict[int, float]:
    """Soft P(female) from median F0 (logistic around ~175 Hz)."""
    out: Dict[int, float] = {}
    try:
        info = sf.info(audio_path)
    except Exception:
        return out
    sr = info.samplerate
    for seg in segments:
        try:
            data, _ = sf.read(audio_path, start=int(seg.start_time * sr),
                              stop=int(min(seg.end_time, info.duration) * sr), dtype="float32", always_2d=True)
        except Exception:
            continue
        f0s = _frame_f0s(data.mean(axis=1), sr)
        if len(f0s) >= MIN_VOICED_FRAMES:
            out[seg.segment_id] = 1.0 / (1.0 + math.exp(-(float(np.median(f0s)) - PITCH_MIDPOINT_HZ) / PITCH_SLOPE_HZ))
    return out


# ---------------------------------------------------------------- Gemini (optional)

def _clip_wav_bytes(audio_path: str, seg, sr: int, total_frames: int) -> bytes:
    data, _ = sf.read(audio_path, start=int(seg.start_time * sr), stop=min(int(seg.end_time * sr), total_frames),
                      dtype="float32", always_2d=True)
    buf = io.BytesIO()
    sf.write(buf, data.mean(axis=1), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _parse_labels(text: str, key: str, n: int = None):
    out = {}
    try:
        items = json.loads((text or "").strip() or "[]")
    except json.JSONDecodeError:
        return out
    for it in items if isinstance(items, list) else []:
        g = _VALID.get(str(it.get("gender", "")).strip().lower())
        ident = it.get(key)
        if g and isinstance(ident, int) and (n is None or 1 <= ident <= n):
            out[ident] = g
    return out


def _gemini_clip_labels(audio_path: str, segments, health) -> Dict[int, float]:
    """1.0 = Female, 0.0 = Male, from Gemini listening to each line's own clip."""
    from app.config import GEMINI_API_KEY, GEMINI_MODEL
    if not GEMINI_API_KEY or not segments:
        return {}
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    model = GEMINI_MODEL or "gemini-2.5-flash"
    info = sf.info(audio_path)
    clips = []
    for seg in segments:
        try:
            clips.append((seg.segment_id, _clip_wav_bytes(audio_path, seg, info.samplerate, info.frames)))
        except Exception:
            continue

    def run(batch):
        if health["down"]:
            return {}
        try:
            contents = [
                "Each audio clip below is a different short utterance. For each clip, decide the gender of the "
                "person speaking from their voice alone. Children count by the child's gender (a boy is Male, a "
                "girl is Female). Judge every clip independently. Answer with a JSON array like "
                '[{"clip": 1, "gender": "Male"}] using only "Male" or "Female", covering every clip number.'
            ]
            for n, (_, wav) in enumerate(batch, start=1):
                contents += [f"Clip {n}:", types.Part.from_bytes(data=wav, mime_type="audio/wav")]
            resp = generate_sync(
                client, model, contents,
                types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"))
            labels = _parse_labels(resp.text, "clip", len(batch))
            return {batch[n - 1][0]: (1.0 if g == "Female" else 0.0) for n, g in labels.items()}
        except Exception as e:
            if _is_quota_error(e):
                health["down"], health["reason"] = True, _short(e)
            else:
                logger.warning(f"[Gender] Gemini clip batch failed: {e}")
            return {}

    result: Dict[int, float] = {}
    batches = [clips[i:i + GEMINI_BATCH] for i in range(0, len(clips), GEMINI_BATCH)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for part in pool.map(run, batches):
            result.update(part)
    return result


def _gemini_video_labels(video_path: str, segments, health) -> Dict[int, float]:
    """1.0 = Female, 0.0 = Male, from Gemini watching who is on screen and talking."""
    from app.config import GEMINI_API_KEY, GEMINI_MODEL
    import imageio_ffmpeg
    if not GEMINI_API_KEY or not segments:
        return {}
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    model = GEMINI_MODEL or "gemini-2.5-flash"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    chunks = list(range(int(max(s.end_time for s in segments) // VIDEO_CHUNK_SEC) + 1))

    with tempfile.TemporaryDirectory() as tmp:
        def run(i):
            if health["down"]:
                return {}
            lo, hi = i * VIDEO_CHUNK_SEC, (i + 1) * VIDEO_CHUNK_SEC
            batch = [s for s in segments if lo <= (s.start_time + s.end_time) / 2 < hi]
            if not batch:
                return {}
            f = None
            try:
                out_path = f"{tmp}/chunk{i}.mp4"
                subprocess.run(
                    [ffmpeg, "-y", "-ss", str(lo), "-t", str(VIDEO_CHUNK_SEC), "-i", video_path, "-vf", "scale=-2:360",
                     "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-c:a", "aac", "-b:a", "64k", out_path],
                    capture_output=True, check=True)
                f = client.files.upload(file=out_path, config=dict(mime_type="video/mp4"))
                for _ in range(90):
                    if getattr(getattr(f, "state", None), "name", "ACTIVE") == "ACTIVE":
                        break
                    time.sleep(2)
                    f = client.files.get(name=f.name)
                lines = "\n".join(
                    f"{s.segment_id} | {s.start_time - lo:.1f}s-{s.end_time - lo:.1f}s | {s.transcript[:70]}" for s in batch)
                prompt = (
                    "Watch and listen to this TV drama clip. For each numbered line (id | start-end seconds in this clip | "
                    "text), work out WHO is speaking it, using who is on screen and talking plus their voice, and report "
                    "that person's gender. Children count by the child's gender. Lines can have different speakers. "
                    'Return a JSON array like [{"id": 1, "gender": "Male"}] using only "Male" or "Female", covering every id.\n\n'
                    + lines)
                resp = generate_sync(
                    client, model, [f, prompt],
                    types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"))
                return {k: (1.0 if g == "Female" else 0.0) for k, g in _parse_labels(resp.text, "id").items()}
            except Exception as e:
                if _is_quota_error(e):
                    health["down"], health["reason"] = True, _short(e)
                else:
                    logger.warning(f"[Gender] Video chunk {i} failed: {e}")
                return {}
            finally:
                if f is not None:
                    try:
                        client.files.delete(name=f.name)
                    except Exception:
                        pass

        result: Dict[int, float] = {}
        with ThreadPoolExecutor(max_workers=4) as pool:
            for part in pool.map(run, chunks):
                result.update(part)
    return result


# ---------------------------------------------------------------- combine

def _combine(sources: List[tuple], segment_id: int):
    """Weighted mean of P(female) over the sources that scored this line. None if nobody did."""
    num = den = 0.0
    for weight, probs in sources:
        if segment_id in probs:
            num += weight * probs[segment_id]
            den += weight
    return (num / den) if den else None


def assign_genders(audio_path: str, segments, video_path=None, use_gemini: bool = True) -> List[str]:
    """Set gender (Male/Female/Unknown) on every segment without renaming any speaker; return notes for the user.
    use_gemini=False runs only the local model and voice pitch (no Gemini cost or wait)."""
    notes: List[str] = []
    health = {"down": False, "reason": None}
    sources: List[tuple] = []

    # The four signals are independent: run them at the same time so the slow Gemini round trips
    # overlap with the local model and pitch instead of queueing behind them.
    def _video():
        if not (use_gemini and GEMINI_ASSIST and video_path):
            return {}
        try:
            out = _gemini_video_labels(video_path, segments, health)
            logger.info(f"[Gender] Video labelled {len(out)}/{len(segments)} segments")
            return out
        except Exception as e:
            logger.warning(f"[Gender] Video gender detection failed: {e}")
            return {}

    def _clips():
        if not (use_gemini and GEMINI_ASSIST):
            return {}
        try:
            out = _gemini_clip_labels(audio_path, segments, health)
            logger.info(f"[Gender] Audio clips labelled {len(out)}/{len(segments)} segments")
            return out
        except Exception as e:
            logger.warning(f"[Gender] Audio-clip gender detection failed: {e}")
            return {}

    with ThreadPoolExecutor(max_workers=4) as pool:
        f_local = pool.submit(local_gender_probs, audio_path, segments)
        f_pitch = pool.submit(_pitch_probs, audio_path, segments)
        f_video = pool.submit(_video)
        f_clip = pool.submit(_clips)
        local, pitch, video, clips = f_local.result(), f_pitch.result(), f_video.result(), f_clip.result()

    if local:
        sources.append((W_LOCAL, local))
    else:
        notes.append("The local gender model could not run, so gender relied on pitch and Gemini only.")
    sources.append((W_PITCH, pitch))
    if not GEMINI_ASSIST:
        notes.append("Gender is estimated from the voice and can be wrong, especially for children. "
                     "Assign characters from the Cast list to set it exactly.")
    if video:
        sources.append((W_VIDEO, video))
    if clips:
        sources.append((W_CLIP, clips))
    if health["down"]:
        notes.append(f"Gemini was unavailable ({health['reason']}), so gender used the local model and pitch only. "
                     "Children are the least reliable: assign characters from the cast list or fix them in the speaker panel.")

    scores = {s.segment_id: _combine(sources, s.segment_id) for s in segments}

    # Majority gender per diarized speaker, weighted by how confident and long each line is
    weight_by_speaker: Dict[str, Dict[str, float]] = {}
    for s in segments:
        sc = scores.get(s.segment_id)
        if sc is None:
            continue
        g = "Female" if sc >= 0.5 else "Male"
        bucket = weight_by_speaker.setdefault(s.speaker, {})
        bucket[g] = bucket.get(g, 0.0) + (s.end_time - s.start_time) * (0.1 + abs(sc - 0.5))

    for s in segments:
        sc = scores.get(s.segment_id)
        bucket = weight_by_speaker.get(s.speaker)
        speaker_gender = max(bucket, key=bucket.get) if bucket else None
        own = None if sc is None else ("Female" if sc >= 0.5 else "Male")
        confident = sc is not None and abs(sc - 0.5) >= KEEP_OWN_MIN_CONFIDENCE and (s.end_time - s.start_time) >= KEEP_OWN_MIN_SEC
        s.gender = own if confident else (speaker_gender or own or "Unknown")

    return notes


def assign_genders_and_split_speakers(audio_path: str, segments, video_path=None) -> List[str]:
    """Set gender on every segment, split speakers that mix genders, return notes for the user."""
    notes = assign_genders(audio_path, segments, video_path)
    labels: Dict[tuple, str] = {}
    for s in segments:
        key = (s.speaker, s.gender)
        if key not in labels:
            labels[key] = f"Speaker {len(labels) + 1}"
        s.speaker = labels[key]
    return notes


def assign_event_genders(audio_path: str, events) -> int:
    """Subtitle Studio: put the voice gender ("Male"/"Female") on each subtitle card as `gender`, so translation can get
    gender agreement right. Speaker labels are not changed. Local model and pitch only, so subtitle generation gets no
    extra Gemini cost or wait. Returns how many cards got a gender."""
    from types import SimpleNamespace
    spans = [SimpleNamespace(segment_id=i, start_time=float(ev.start_time), end_time=float(ev.end_time),
                             speaker=getattr(ev, "speaker", None) or "Speaker 1", gender="Unknown")
             for i, ev in enumerate(events)]
    if not spans:
        return 0
    assign_genders(audio_path, spans, use_gemini=False)
    n = 0
    for ev, s in zip(events, spans):
        if s.gender in ("Male", "Female"):
            setattr(ev, "gender", s.gender)
            n += 1
    return n
