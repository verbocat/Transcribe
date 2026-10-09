"""
ElevenLabs Scribe v2 & Netflix Conforming Subtitle Generator
============================================================

Unified end-to-end subtitle generation pipeline:
1. Ingests full media (video or audio) without arbitrary batch slicing.
2. Performs transcription using ElevenLabs Scribe v2 with speaker diarization,
   audio event tagging (SDH), and word-level acoustic timestamps across 90+ languages.
3. Multi-Speaker Diarization Refinement: Identifies distinct conversational turns
   and formats speakers into standard labels (Speaker 1, Speaker 2...).
4. Strict Native Script Enforcement: Transliterates foreign/English loanwords
   into the native script of the selected target language (e.g. "competition" -> "कंपटीशन" in Hindi).
5. Conforms word timestamps into broadcast-grade subtitles strictly adhering
   to the Netflix Timed Text Style Guide via the local Netflix Engine.
6. Audits compliance, reading speed (CPS), line length (CPL), and gap chaining.
7. Streams real-time SSE progress directly to the frontend workspace.
"""

import os
import json
import math
import time
import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, AsyncGenerator

from app.config import UPLOAD_DIR, GEMINI_API_KEY, GEMINI_MODEL
from app.netflix_models import SubtitleEvent, NetflixQCResult, CPSStats, format_timestamp
from app.video_processor import extract_audio_from_video, detect_shot_changes, get_video_metadata
from app.elevenlabs_service import transcribe_with_scribe_v2
from app.transliteration_service import enforce_native_script_for_words
from app.netflix_engine import (
    build_netflix_subtitles_from_words,
    filter_diarization_flickers,
    audit_netflix_compliance,
    get_language_profile,
    detect_text_script
)
from app.terminal_logger import log_terminal
from collections import defaultdict

logger = logging.getLogger(__name__)


async def refine_speaker_diarization(
    words: List[Dict[str, Any]],
    num_speakers: Optional[int] = None,
    language: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Normalizes speaker IDs and applies intelligent conversational turn fallback
    if Scribe reports single speaker on a multi-speaker conversation.
    """
    if not words:
        return words

    log_terminal("DIARIZATION", f"Starting diarization analysis on {len(words)} word tokens...")

    # Filter acoustic diarization flickers before assignment
    smoothed_words = filter_diarization_flickers(words)
    flickers_smoothed = sum(1 for a, b in zip(words, smoothed_words) if a.get("speaker_id") != b.get("speaker_id"))
    if flickers_smoothed > 0:
        log_terminal("DIARIZATION", f"Smoothed {flickers_smoothed} micro-flicker acoustic glitches from Scribe speaker track")

    distinct_raw = {str(w.get("speaker_id")) for w in smoothed_words if w.get("speaker_id") is not None}
    log_terminal("DIARIZATION", f"Distinct speaker IDs from Scribe v2: {len(distinct_raw)} ({list(distinct_raw)})")

    # If Scribe returned distinct speakers, map to human-friendly 1-indexed labels
    if len(distinct_raw) > 1:
        updated = []
        for w in smoothed_words:
            w_copy = dict(w)
            spk = str(w_copy.get("speaker_id", "speaker_0"))
            num_part = spk.replace("speaker_", "")
            if num_part.isdigit():
                w_copy["speaker"] = f"Speaker {int(num_part) + 1}"
            else:
                w_copy["speaker"] = f"Speaker {spk}"
            updated.append(w_copy)
        
        final_words = filter_diarization_flickers(updated)
        speaker_counts = defaultdict(int)
        for w in final_words:
            speaker_counts[w.get("speaker", "Speaker 1")] += 1
        log_terminal("DIARIZATION", f"[OK] Multi-speaker assignment complete: {dict(speaker_counts)}")
        return final_words

    # If Scribe only detected 1 speaker:
    target_speakers = int(num_speakers) if num_speakers and int(num_speakers) > 0 else 1
    if target_speakers <= 1:
        for w in words:
            w["speaker"] = "Speaker 1"
        log_terminal("DIARIZATION", "Single speaker detected/configured: All tokens assigned to 'Speaker 1'")
        return words

    log_terminal(
        "DIARIZATION",
        f"Single speaker reported by Scribe, but {target_speakers} speakers requested. "
        f"Applying conversational turn segmentation..."
    )

    # Segment words by acoustic pauses >= 0.65s
    turns = []
    curr_turn = []
    for w in words:
        if not curr_turn:
            curr_turn.append(w)
            continue
        gap = float(w.get("start", 0)) - float(curr_turn[-1].get("end", 0))
        if gap >= 0.65:
            turns.append(curr_turn)
            curr_turn = [w]
        else:
            curr_turn.append(w)
    if curr_turn:
        turns.append(curr_turn)

    # Use Gemini conversational structure analysis if available
    if GEMINI_API_KEY and len(turns) > 1:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=GEMINI_API_KEY)
            turn_samples = []
            for idx, turn in enumerate(turns[:60]):
                txt = " ".join([t.get("text", "") for t in turn]).strip()
                turn_samples.append(f"[{idx}] {txt}")

            prompt = f"""You are an expert audio dialogue analyst.
Assign speaker numbers (1 to {target_speakers}) to each speech turn based on questions, responses, conversational flow, and turn-taking.
Return strictly a JSON array of integers matching the length of the turns ({len(turn_samples)}), e.g. [1, 2, 1, 2].

Dialogue turns:
{chr(10).join(turn_samples)}
"""
            model_name = GEMINI_MODEL or "gemini-3.8-flash"
            resp = await client.aio.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json"
                )
            )
            labels = json.loads(resp.text)
            if isinstance(labels, list) and len(labels) == len(turns[:60]):
                for t_idx, spk_num in enumerate(labels):
                    spk_label = f"Speaker {spk_num}"
                    spk_id = f"speaker_{max(int(spk_num) - 1, 0)}"
                    for w in turns[t_idx]:
                        w["speaker_id"] = spk_id
                        w["speaker"] = spk_label
                # Tail turns
                for t_idx in range(60, len(turns)):
                    for w in turns[t_idx]:
                        w["speaker_id"] = "speaker_0"
                        w["speaker"] = "Speaker 1"
                return words
        except Exception as exc:
            logger.warning(f"[Diarization] Turn analysis fallback note: {exc}")

    # Heuristic alternating turns
    for t_idx, turn in enumerate(turns):
        spk_idx = (t_idx % target_speakers) + 1
        for w in turn:
            w["speaker_id"] = f"speaker_{spk_idx - 1}"
            w["speaker"] = f"Speaker {spk_idx}"

    return words


def generate_subtitles(
    video_path: str,
    language: Optional[str] = "auto",
    script: Optional[str] = "auto",
    content_type: str = "adult",
    sdh_mode: bool = False,
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    custom_frame_rate: Optional[float] = None,
    api_key: Optional[str] = None,
    include_speaker_tags: bool = False,
    snap_to_shot_changes: bool = True,
    num_speakers: Optional[int] = None,
    strict_native_script: bool = True,
    **kwargs
) -> NetflixQCResult:
    """
    Synchronous / thread-wrapped subtitle generation using ElevenLabs Scribe v2
    and the local Netflix Conforming Engine.
    """
    return asyncio.run(
        generate_subtitles_async(
            video_path=video_path,
            language=language,
            script=script,
            content_type=content_type,
            sdh_mode=sdh_mode,
            cpl_limit=cpl_limit,
            max_cps=max_cps,
            max_lines=max_lines,
            min_duration=min_duration,
            max_duration=max_duration,
            custom_frame_rate=custom_frame_rate,
            api_key=api_key,
            include_speaker_tags=include_speaker_tags,
            snap_to_shot_changes=snap_to_shot_changes,
            num_speakers=num_speakers,
            strict_native_script=strict_native_script,
        )
    )


async def generate_subtitles_async(
    video_path: str,
    language: Optional[str] = "auto",
    script: Optional[str] = "auto",
    content_type: str = "adult",
    sdh_mode: bool = False,
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    custom_frame_rate: Optional[float] = None,
    api_key: Optional[str] = None,
    include_speaker_tags: bool = False,
    snap_to_shot_changes: bool = True,
    num_speakers: Optional[int] = None,
    strict_native_script: bool = True,
) -> NetflixQCResult:
    """
    Complete async pipeline for ElevenLabs Scribe v2 transcription,
    speaker diarization, native script transliteration, and Netflix conforming.
    """
    video_file = Path(video_path)
    filename = video_file.name
    video_id = video_file.stem
    file_size_mb = round(video_file.stat().st_size / (1024 * 1024), 2) if video_file.exists() else 0.0

    log_terminal("MEDIA-PIPELINE", f"Ingesting media file: '{filename}' ({file_size_mb} MB)")

    # Extract audio track
    audio_path = str(video_file)
    audio_duration = 0.0
    frame_rate = custom_frame_rate or 24.0
    video_res = ""

    try:
        meta = get_video_metadata(str(video_file))
        audio_duration = meta.get("duration", 0.0)
        if not custom_frame_rate and meta.get("frame_rate"):
            frame_rate = meta.get("frame_rate")
        if meta.get("width") and meta.get("height"):
            video_res = f"{meta['width']}x{meta['height']}"
        log_terminal("MEDIA-PIPELINE", f"Media Info -> Resolution: {video_res or 'Audio Only'} | Frame Rate: {frame_rate} FPS | Duration: {audio_duration:.2f}s")
    except Exception as e:
        logger.debug(f"Metadata read error: {e}")

    ext = video_file.suffix.lower()
    if ext in [".mp4", ".mkv", ".mov", ".webm", ".avi", ".flv", ".wma"]:
        extracted_wav = UPLOAD_DIR / f"{video_id}_audio.wav"
        if not extracted_wav.exists():
            log_terminal("MEDIA-PIPELINE", f"Demuxing 16kHz audio track via FFmpeg to {extracted_wav.name}...")
            t_ext = time.time()
            extract_audio_from_video(str(video_file), str(extracted_wav))
            ext_time = round(time.time() - t_ext, 2)
            wav_mb = round(extracted_wav.stat().st_size / (1024 * 1024), 2)
            log_terminal("MEDIA-PIPELINE", f"[OK] Audio extracted: {wav_mb} MB in {ext_time}s")
        audio_path = str(extracted_wav)

    shot_changes = []
    try:
        shot_changes = detect_shot_changes(str(video_file))
        log_terminal("SHOT-DETECTOR", f"Detected {len(shot_changes)} shot changes (Scene cuts)")
    except Exception:
        pass

    # Call ElevenLabs Scribe v2 with diarization and speaker hints
    log_terminal("ELEVENLABS-STT", f"Dispatching audio to ElevenLabs Scribe v2 (Lang: {language}, SDH: {sdh_mode}, Speakers: {num_speakers or 'Auto'})...")
    stt_result = await transcribe_with_scribe_v2(
        audio_path=audio_path,
        language=language,
        diarize=True,
        tag_audio_events=sdh_mode,
        num_speakers=num_speakers,
        api_key=api_key,
    )

    words = stt_result.get("words", [])
    user_lang = language if (language and str(language).strip().lower() not in ("auto", "none", "")) else None
    detected_lang = user_lang or stt_result.get("language_code") or "en"
    log_terminal("ELEVENLABS-STT", f"[OK] Transcription complete: {len(words)} word tokens | Language: {detected_lang}")

    # Multi-Speaker Refinement
    words = await refine_speaker_diarization(
        words=words,
        num_speakers=num_speakers,
        language=detected_lang,
    )

    # Strict Native Script Enforcement (Transliterate English loanwords into native script)
    if strict_native_script:
        log_terminal("TRANSLITERATION", f"Enforcing native script for target language: {detected_lang.upper()} (Script: {script or 'Auto'})")
        words = await enforce_native_script_for_words(
            words=words,
            target_language=detected_lang,
            target_script_override=script,
            enable_strict_script=True,
        )

    # Conform words to Netflix Timed Text Style Guide (Deterministic Local Engine)
    log_terminal("NETFLIX-ENGINE", f"Conforming {len(words)} words into Netflix subtitle cards (CPL: {cpl_limit}, Max CPS: {max_cps}, Min Dur: {min_duration}s, Max Dur: {max_duration}s)...")
    t_start = time.perf_counter()
    events = build_netflix_subtitles_from_words(
        words=words,
        language=detected_lang,
        content_type=content_type,
        sdh_mode=sdh_mode,
        frame_rate=frame_rate,
        custom_cpl=cpl_limit,
        custom_cps=max_cps,
        custom_min_duration=min_duration,
        custom_max_duration=max_duration,
        include_speaker_tags=include_speaker_tags,
        snap_to_shot_changes=snap_to_shot_changes,
        shot_changes=shot_changes,
    )
    t_ms = (time.perf_counter() - t_start) * 1000
    log_terminal("NETFLIX-ENGINE", f"[OK] Conforming complete! Generated {len(events)} broadcast-grade cards in {t_ms:.1f}ms")

    # Run Netflix Timed Text Quality Control Audit
    events, total_errs, total_warns, compliance_score, cps_stats = audit_netflix_compliance(
        events=events,
        language=detected_lang,
        content_type=content_type,
        frame_rate=frame_rate,
        shot_changes=shot_changes,
    )
    log_terminal("NETFLIX-QC", f"[Audit] Compliance: {compliance_score}% | Errors: {total_errs} | Warnings: {total_warns} | Avg CPS: {cps_stats.avg_cps:.1f} | Max CPS: {cps_stats.max_cps:.1f}")

    # Terminal preview of generated subtitles
    if events:
        log_terminal("NETFLIX-QC", f"--- Subtitle Output Preview ({len(events)} cards total) ---")
        for ev in events[:3]:
            txt_flat = ev.text.replace("\n", " / ")
            spk = getattr(ev, "primary_speaker", None) or getattr(ev, "speaker", "Speaker 1")
            log_terminal("NETFLIX-QC", f"  Card #{ev.id} [{ev.start_time:.3f}s -> {ev.end_time:.3f}s] ({spk}): \"{txt_flat}\" (CPS: {ev.cps:.1f}, CPL: {ev.cpl})")
        if len(events) > 3:
            if len(events) > 5:
                log_terminal("NETFLIX-QC", f"  ... ({len(events) - 5} intermediate cards) ...")
            for ev in events[-2:]:
                txt_flat = ev.text.replace("\n", " / ")
                spk = getattr(ev, "primary_speaker", None) or getattr(ev, "speaker", "Speaker 1")
                log_terminal("NETFLIX-QC", f"  Card #{ev.id} [{ev.start_time:.3f}s -> {ev.end_time:.3f}s] ({spk}): \"{txt_flat}\" (CPS: {ev.cps:.1f}, CPL: {ev.cpl})")

    return NetflixQCResult(
        video_id=video_id,
        filename=filename,
        language=detected_lang,
        events=events,
        total_events=len(events),
        total_errors=total_errs,
        total_warnings=total_warns,
        compliance_score=compliance_score,
        cps_stats=cps_stats,
        shot_changes=shot_changes,
        frame_rate=frame_rate,
        content_type=content_type,
        audio_duration=audio_duration,
        video_resolution=video_res,
    )

# ---------------------------------------------------------------------------------------------
# Real progress
# ---------------------------------------------------------------------------------------------

_SPEED_FILE = Path(__file__).resolve().parent.parent / "data" / "stt_speed.json"
_DEFAULT_STT_RATIO = 0.12   # seconds of processing per second of audio, until we have measured this server
_STT_OVERHEAD_SEC = 6.0


def _load_stt_ratio() -> float:
    try:
        return max(0.01, min(2.0, float(json.loads(_SPEED_FILE.read_text(encoding="utf-8")).get("ratio", _DEFAULT_STT_RATIO))))
    except Exception:
        return _DEFAULT_STT_RATIO


def _save_stt_ratio(measured: float) -> None:
    """Learn how fast transcription really is on this server (running average), so the next ETA is closer."""
    try:
        new = max(0.01, min(2.0, 0.5 * _load_stt_ratio() + 0.5 * measured))
        _SPEED_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SPEED_FILE.write_text(json.dumps({"ratio": round(new, 4)}), encoding="utf-8")
    except Exception:
        pass


def _stt_progress(elapsed: float, expected: float):
    """Transcription is one long request with no progress of its own, so this is an ESTIMATE from the audio length and
    this server's measured speed. It never claims 100% before the result arrives."""
    expected = max(expected, 5.0)
    if elapsed <= expected:
        return 0.9 * elapsed / expected, expected - elapsed
    return 0.9 + 0.08 * (1.0 - math.exp(-(elapsed - expected) / expected)), None


class _StageProgress:
    """Weighted stage progress: each stage owns a share of the bar and reports its own fraction when it can measure one."""

    def __init__(self, steps):
        total = float(sum(w for _, _, w in steps)) or 1.0
        self.steps = [(k, label, w / total * 100.0) for k, label, w in steps]
        self.index = {k: i for i, (k, _, _) in enumerate(self.steps)}
        self.t0 = time.time()

    def event(self, key: str, fraction: float = 0.0, detail: str = "", estimated: bool = False, eta: Optional[float] = None) -> str:
        i = self.index[key]
        before = sum(w for _, _, w in self.steps[:i])
        _, label, weight = self.steps[i]
        fraction = max(0.0, min(1.0, fraction))
        payload = {
            "type": "progress", "stage": label, "stage_key": key, "progress": round(before + weight * fraction, 1),
            "step": i + 1, "steps": len(self.steps), "step_progress": round(fraction, 3), "estimated": estimated,
            "eta": None if eta is None else int(round(eta)), "detail": detail, "elapsed": round(time.time() - self.t0, 1),
        }
        return f"data: {json.dumps(payload)}\n\n"


def _fmt_duration(seconds: float) -> str:
    s = int(max(0, seconds))
    return f"{s // 60}m {s % 60:02d}s" if s >= 60 else f"{s}s"


async def stream_generate_subtitles(
    video_path: str,
    language: Optional[str] = "auto",
    script: Optional[str] = "auto",
    content_type: str = "adult",
    sdh_mode: bool = False,
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    custom_frame_rate: Optional[float] = None,
    api_key: Optional[str] = None,
    include_speaker_tags: bool = False,
    snap_to_shot_changes: bool = True,
    num_speakers: Optional[int] = None,
    strict_native_script: bool = True,
    context: Optional[Dict[str, Any]] = None,
    project_glossary: Optional[List[str]] = None,
    **kwargs
) -> AsyncGenerator[str, None]:
    """
    Streams the pipeline over SSE with REAL progress: every stage owns a share of the bar, stages that can measure their
    work report it (batches done, words processed), and the one long wait (speech recognition) is an estimate based on the
    audio length and this server's own measured speed, shown with an ETA and flagged as an estimate.

    `context` (speakers, key terms, "often misheard" fixes, writing style...) is applied three ways: key terms bias the speech
    engine, "misheard -> correct" fixes are applied exactly, and an AI proofreading pass fixes real recognition mistakes.
    """
    from app import context_polisher as cp

    video_file = Path(video_path)
    filename = video_file.name
    video_id = video_file.stem
    file_size_mb = round(video_file.stat().st_size / (1024 * 1024), 2) if video_file.exists() else 0.0

    ctx: Dict[str, Any] = dict(context or {})
    legacy_notes = kwargs.get("user_feedback")
    if legacy_notes and not str(ctx.get("notes") or "").strip():
        ctx["notes"] = str(legacy_notes)
    glossary_terms = [t for t in (project_glossary or []) if isinstance(t, str) and t.strip()]
    keyterms = cp.key_terms_from_context(ctx, glossary_terms)
    corrections = cp.parse_corrections(ctx.get("corrections"))
    polish_ctx = dict(ctx)
    if glossary_terms:
        polish_ctx["key_terms"] = "\n".join([*cp._lines(ctx.get("key_terms")), *glossary_terms])
    use_polish = bool(GEMINI_API_KEY) and (not cp.context_is_empty(polish_ctx))

    steps = [("prepare", "Preparing media", 4), ("transcribe", "Transcribing speech", 56), ("speakers", "Assigning speakers", 3)]
    if strict_native_script:
        steps.append(("script", "Native script", 4))
    steps.append(("conform", "Building subtitles", 5))
    if use_polish:
        steps.append(("context", "Applying your context", 14))
    steps.append(("qc", "Quality check", 4))
    prog = _StageProgress(steps)

    log_terminal("MEDIA-PIPELINE", f"===> Subtitle Pipeline Initialized for '{filename}' ({file_size_mb} MB)")
    if keyterms or corrections or use_polish:
        log_terminal("MEDIA-PIPELINE", f"Context: {len(keyterms)} key terms, {len(corrections)} fixes, AI proofreading={'on' if use_polish else 'off'}")

    yield prog.event("prepare", 0.05, "Reading the media")
    await asyncio.sleep(0.05)

    # 1. Media metadata & audio extraction
    audio_path = str(video_file)
    audio_duration = 0.0
    frame_rate = custom_frame_rate or 24.0
    video_res = ""

    try:
        meta = get_video_metadata(str(video_file))
        audio_duration = meta.get("duration", 0.0)
        if not custom_frame_rate and meta.get("frame_rate"):
            frame_rate = meta.get("frame_rate")
        if meta.get("width") and meta.get("height"):
            video_res = f"{meta['width']}x{meta['height']}"
        log_terminal("MEDIA-PIPELINE", f"Media Info -> Resolution: {video_res or 'Audio Only'} | Frame Rate: {frame_rate} FPS | Duration: {audio_duration:.2f}s")
    except Exception as e:
        logger.debug(f"Metadata read error: {e}")

    yield prog.event("prepare", 0.3, "Extracting the audio track")
    ext = video_file.suffix.lower()
    if ext in [".mp4", ".mkv", ".mov", ".webm", ".avi", ".flv", ".wma"]:
        extracted_wav = UPLOAD_DIR / f"{video_id}_audio.wav"
        if not extracted_wav.exists():
            log_terminal("MEDIA-PIPELINE", f"Demuxing 16kHz audio track via FFmpeg to {extracted_wav.name}...")
            t_ext = time.time()
            await asyncio.to_thread(extract_audio_from_video, str(video_file), str(extracted_wav))
            ext_time = round(time.time() - t_ext, 2)
            wav_mb = round(extracted_wav.stat().st_size / (1024 * 1024), 2)
            log_terminal("MEDIA-PIPELINE", f"[OK] Audio extracted: {wav_mb} MB in {ext_time}s")
        audio_path = str(extracted_wav)

    # 2. Shot change detection
    yield prog.event("prepare", 0.65, "Finding scene changes")
    shot_changes = []
    try:
        shot_changes = await asyncio.to_thread(detect_shot_changes, str(video_file))
        log_terminal("SHOT-DETECTOR", f"Detected {len(shot_changes)} shot changes (Scene cuts)")
    except Exception:
        pass

    yield f"data: {json.dumps({'type': 'init', 'shot_changes': shot_changes, 'frame_rate': frame_rate, 'audio_duration': audio_duration})}\n\n"
    yield prog.event("prepare", 1.0, "Media ready")

    # 3. ElevenLabs Scribe v2 transcription: one long request, so progress is an estimate with a live heartbeat
    speaker_hint_text = f" ({num_speakers} speakers specified)" if num_speakers else " (Auto-diarization)"
    expected = _STT_OVERHEAD_SEC + _load_stt_ratio() * max(audio_duration, 1.0)
    audio_label = f"{_fmt_duration(audio_duration)} of audio" if audio_duration else "your audio"
    yield prog.event("transcribe", 0.0, f"Transcribing {audio_label} with ElevenLabs Scribe v2{speaker_hint_text}", estimated=True, eta=expected)

    task = None
    t_stt = time.time()
    try:
        log_terminal("ELEVENLABS-STT", f"Dispatching audio to ElevenLabs Scribe v2 (Lang: {language}, SDH: {sdh_mode}, Speakers: {num_speakers or 'Auto'}, KeyTerms: {len(keyterms)})...")
        task = asyncio.create_task(transcribe_with_scribe_v2(
            audio_path=audio_path,
            language=language,
            diarize=True,
            tag_audio_events=sdh_mode,
            num_speakers=num_speakers,
            api_key=api_key,
            keyterms=keyterms or None,
        ))
        while True:
            done, _ = await asyncio.wait({task}, timeout=1.0)
            if done:
                break
            frac, eta = _stt_progress(time.time() - t_stt, expected)
            yield prog.event("transcribe", frac, f"Transcribing {audio_label}" + (" · almost done" if eta is None else ""), estimated=True, eta=eta)
        stt_result = task.result()
    except Exception as exc:
        err_msg = str(exc)
        logger.error(f"ElevenLabs transcription error: {err_msg}")
        log_terminal("ELEVENLABS-STT", f"[ERROR] Scribe v2 failed: {err_msg}", level="ERROR")
        yield f"data: {json.dumps({'type': 'error', 'message': err_msg, 'error': err_msg})}\n\n"
        return
    finally:
        if task is not None and not task.done():
            task.cancel()

    stt_elapsed = time.time() - t_stt
    if stt_elapsed > 8 and audio_duration > 20:  # a cache hit returns instantly and says nothing about speed
        _save_stt_ratio(max(0.0, stt_elapsed - _STT_OVERHEAD_SEC) / audio_duration)

    try:
        words = stt_result.get("words", [])
        user_lang = language if (language and str(language).strip().lower() not in ("auto", "none", "")) else None
        detected_lang = user_lang or stt_result.get("language_code") or "en"
        word_count = len(words)
        log_terminal("ELEVENLABS-STT", f"[OK] Transcription complete: {word_count} word tokens | Language: {detected_lang}")
        yield prog.event("transcribe", 1.0, f"{word_count} words transcribed")

        # 4. Speaker diarization refinement
        yield prog.event("speakers", 0.1, "Working out who speaks when")
        words = await refine_speaker_diarization(
            words=words,
            num_speakers=num_speakers,
            language=detected_lang,
        )
        yield prog.event("speakers", 1.0, "Speakers assigned")

        # 5. Strict native script enforcement (transliterate English loanwords)
        if strict_native_script:
            yield prog.event("script", 0.1, f"Checking the {detected_lang.upper()} script")
            log_terminal("TRANSLITERATION", f"Enforcing native script for target language: {detected_lang.upper()} (Script: {script or 'Auto'})")
            words = await enforce_native_script_for_words(
                words=words,
                target_language=detected_lang,
                target_script_override=script,
                enable_strict_script=True,
            )
            yield prog.event("script", 1.0, "Script checked")

        # 6. Netflix Timed Text conforming engine (deterministic local engine)
        yield prog.event("conform", 0.1, f"Fitting {word_count} words into subtitle cards")
        await asyncio.sleep(0.05)

        log_terminal("NETFLIX-ENGINE", f"Conforming {word_count} words into Netflix subtitle cards (CPL: {cpl_limit}, Max CPS: {max_cps}, Min Dur: {min_duration}s, Max Dur: {max_duration}s)...")
        t_start = time.perf_counter()
        events = build_netflix_subtitles_from_words(
            words=words,
            language=detected_lang,
            content_type=content_type,
            sdh_mode=sdh_mode,
            frame_rate=frame_rate,
            custom_cpl=cpl_limit,
            custom_cps=max_cps,
            custom_min_duration=min_duration,
            custom_max_duration=max_duration,
            include_speaker_tags=include_speaker_tags,
            snap_to_shot_changes=snap_to_shot_changes,
            shot_changes=shot_changes,
        )
        t_ms = (time.perf_counter() - t_start) * 1000
        log_terminal("NETFLIX-ENGINE", f"[OK] Conforming complete! Generated {len(events)} broadcast-grade cards in {t_ms:.1f}ms")
        yield prog.event("conform", 1.0, f"{len(events)} subtitles built")

        # 7. Context: exact fixes first, then the AI proofreading pass (real progress: batches done / batches total)
        context_fixes: Dict[str, Any] = {"applied_corrections": 0, "ai_fixes": 0, "items": []}
        if corrections or use_polish:
            fixed_by_rule = 0
            for ev in events:
                new_text, n = cp.apply_corrections(ev.text, corrections) if corrections else (ev.text, 0)
                if n:
                    context_fixes["items"].append({"id": ev.id, "before": ev.text, "after": new_text, "reason": "your correction list"})
                    ev.text = new_text
                    ev.lines = new_text.split("\n")
                    fixed_by_rule += n
            context_fixes["applied_corrections"] = fixed_by_rule

        if use_polish and events:
            progress_state = {"done": 0, "total": max(1, -(-len(events) // cp.BATCH_SIZE))}

            def _on_batch(done_n: int, total_n: int) -> None:
                progress_state["done"], progress_state["total"] = done_n, total_n

            yield prog.event("context", 0.0, f"Proofreading {len(events)} subtitles against your context")
            unsure = cp.unsure_words_for_spans([(ev.start_time, ev.end_time) for ev in events], words)
            poll = asyncio.create_task(cp.polish_texts(
                [{"id": ev.id, "text": ev.text, "unsure": u} for ev, u in zip(events, unsure)], polish_ctx, detected_lang,
                cpl_limit, max_lines, _on_batch,
            ))
            try:
                last = -1
                while True:
                    done, _ = await asyncio.wait({poll}, timeout=0.7)
                    if progress_state["done"] != last:
                        last = progress_state["done"]
                        yield prog.event("context", last / progress_state["total"],
                                         f"Proofread {last} of {progress_state['total']} batches")
                    if done:
                        break
                fixes = poll.result()
            except Exception as exc:
                logger.warning(f"Context proofreading skipped: {exc}")
                fixes = []
            finally:
                if not poll.done():
                    poll.cancel()
            by_id = {ev.id: ev for ev in events}
            for fx in fixes:
                ev = by_id.get(fx["id"])
                if ev is not None and ev.text == fx["before"]:
                    ev.text = fx["after"]
                    ev.lines = fx["after"].split("\n")
                    context_fixes["items"].append(fx)
                    context_fixes["ai_fixes"] += 1
            yield prog.event("context", 1.0, f"{context_fixes['ai_fixes'] + context_fixes['applied_corrections']} lines corrected")
            log_terminal("CONTEXT-POLISH", f"Applied {context_fixes['applied_corrections']} exact fixes and {context_fixes['ai_fixes']} AI fixes from your context")

        # 8. Quality control audit
        yield prog.event("qc", 0.2, "Checking reading speed, line length and gaps")
        await asyncio.sleep(0.05)

        events, total_errs, total_warns, compliance_score, cps_stats = audit_netflix_compliance(
            events=events,
            language=detected_lang,
            content_type=content_type,
            frame_rate=frame_rate,
            shot_changes=shot_changes,
        )
        log_terminal("NETFLIX-QC", f"[Audit] Compliance: {compliance_score}% | Errors: {total_errs} | Warnings: {total_warns} | Avg CPS: {cps_stats.avg_cps:.1f} | Max CPS: {cps_stats.max_cps:.1f}")

        # Terminal preview of generated subtitles
        if events:
            log_terminal("NETFLIX-QC", f"--- Subtitle Output Preview ({len(events)} cards total) ---")
            for ev in events[:3]:
                txt_flat = ev.text.replace("\n", " / ")
                spk = getattr(ev, "primary_speaker", None) or getattr(ev, "speaker", "Speaker 1")
                log_terminal("NETFLIX-QC", f"  Card #{ev.id} [{ev.start_time:.3f}s -> {ev.end_time:.3f}s] ({spk}): \"{txt_flat}\" (CPS: {ev.cps:.1f}, CPL: {ev.cpl})")
            if len(events) > 3:
                if len(events) > 5:
                    log_terminal("NETFLIX-QC", f"  ... ({len(events) - 5} intermediate cards) ...")
                for ev in events[-2:]:
                    txt_flat = ev.text.replace("\n", " / ")
                    spk = getattr(ev, "primary_speaker", None) or getattr(ev, "speaker", "Speaker 1")
                    log_terminal("NETFLIX-QC", f"  Card #{ev.id} [{ev.start_time:.3f}s -> {ev.end_time:.3f}s] ({spk}): \"{txt_flat}\" (CPS: {ev.cps:.1f}, CPL: {ev.cpl})")

        # Per card, for later steps (nothing here changes text, timing or the export):
        #  * unsure_words: words ElevenLabs Scribe scored as low-confidence; the only words AI proofreading may change
        #  * gender: the voice gender of the speaker, sent to Centroid so translations get gender agreement right
        try:
            from app import context_polisher as cp_words
            for ev, u in zip(events, cp_words.unsure_words_for_spans([(ev.start_time, ev.end_time) for ev in events], words)):
                setattr(ev, "unsure_words", u)
        except Exception as exc:
            logger.warning(f"Low-confidence word tagging skipped: {exc}")
        try:
            from app.segment_gender import assign_event_genders
            tagged = await asyncio.to_thread(assign_event_genders, audio_path, events)
            log_terminal("NETFLIX-QC", f"Voice gender tagged on {tagged}/{len(events)} subtitles (for translation)")
        except Exception as exc:
            logger.warning(f"Subtitle gender detection skipped: {exc}")

        yield prog.event("qc", 1.0, "Done")

        # Emit complete result
        qc_result = NetflixQCResult(
            video_id=video_id,
            filename=filename,
            language=detected_lang,
            events=events,
            total_events=len(events),
            total_errors=total_errs,
            total_warnings=total_warns,
            compliance_score=compliance_score,
            cps_stats=cps_stats,
            shot_changes=shot_changes,
            frame_rate=frame_rate,
            content_type=content_type,
            audio_duration=audio_duration,
            video_resolution=video_res,
        )

        events_payload = [e.model_dump() for e in events]
        context_fixes["items"] = context_fixes["items"][:200]

        yield f"data: {json.dumps({'type': 'complete', 'result': qc_result.model_dump(), 'events': events_payload, 'total_events': len(events), 'compliance_score': compliance_score, 'context_fixes': context_fixes})}\n\n"
    except Exception as exc:
        logger.exception(f"Unhandled error in stream_generate_subtitles: {exc}")
        log_terminal("NETFLIX-QC", f"[PIPELINE ERROR] {exc}", level="ERROR")
        yield f"data: {json.dumps({'type': 'error', 'message': str(exc), 'error': str(exc)})}\n\n"


# Alias for main.py router export
generate_subtitles_stream = stream_generate_subtitles
