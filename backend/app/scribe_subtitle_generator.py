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
    **kwargs
) -> AsyncGenerator[str, None]:
    """
    Progressively streams pipeline state via SSE (Server-Sent Events) to the frontend.
    Handles high-accuracy ElevenLabs Scribe v2 transcription, multi-speaker diarization,
    strict native script transliteration, and local Netflix conforming.
    """
    video_file = Path(video_path)
    filename = video_file.name
    video_id = video_file.stem
    file_size_mb = round(video_file.stat().st_size / (1024 * 1024), 2) if video_file.exists() else 0.0

    log_terminal("MEDIA-PIPELINE", f"===> Subtitle Pipeline Initialized for '{filename}' ({file_size_mb} MB)")

    yield f"data: {json.dumps({'type': 'progress', 'stage': 'Initializing media pipeline', 'progress': 5})}\n\n"
    await asyncio.sleep(0.05)

    # 1. Media Metadata & Audio Extraction
    yield f"data: {json.dumps({'type': 'progress', 'stage': 'Extracting high-fidelity audio track', 'progress': 15})}\n\n"
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
            await asyncio.to_thread(extract_audio_from_video, str(video_file), str(extracted_wav))
            ext_time = round(time.time() - t_ext, 2)
            wav_mb = round(extracted_wav.stat().st_size / (1024 * 1024), 2)
            log_terminal("MEDIA-PIPELINE", f"[OK] Audio extracted: {wav_mb} MB in {ext_time}s")
        audio_path = str(extracted_wav)

    # 2. Shot change detection
    shot_changes = []
    try:
        shot_changes = await asyncio.to_thread(detect_shot_changes, str(video_file))
        log_terminal("SHOT-DETECTOR", f"Detected {len(shot_changes)} shot changes (Scene cuts)")
    except Exception:
        pass

    yield f"data: {json.dumps({'type': 'init', 'shot_changes': shot_changes, 'frame_rate': frame_rate, 'audio_duration': audio_duration})}\n\n"

    # 3. ElevenLabs Scribe v2 Transcription
    speaker_hint_text = f" ({num_speakers} speakers specified)" if num_speakers else " (Auto-diarization)"
    yield f"data: {json.dumps({'type': 'progress', 'stage': f'Transcribing with ElevenLabs Scribe v2 (Word Timestamps & Diarization{speaker_hint_text})...', 'progress': 35})}\n\n"

    try:
        log_terminal("ELEVENLABS-STT", f"Dispatching audio to ElevenLabs Scribe v2 (Lang: {language}, SDH: {sdh_mode}, Speakers: {num_speakers or 'Auto'})...")
        stt_result = await transcribe_with_scribe_v2(
            audio_path=audio_path,
            language=language,
            diarize=True,
            tag_audio_events=sdh_mode,
            num_speakers=num_speakers,
            api_key=api_key,
        )
    except Exception as exc:
        err_msg = str(exc)
        logger.error(f"ElevenLabs transcription error: {err_msg}")
        log_terminal("ELEVENLABS-STT", f"[ERROR] Scribe v2 failed: {err_msg}", level="ERROR")
        yield f"data: {json.dumps({'type': 'error', 'message': err_msg, 'error': err_msg})}\n\n"
        return

    try:
        words = stt_result.get("words", [])
        user_lang = language if (language and str(language).strip().lower() not in ("auto", "none", "")) else None
        detected_lang = user_lang or stt_result.get("language_code") or "en"
        word_count = len(words)
        log_terminal("ELEVENLABS-STT", f"[OK] Transcription complete: {word_count} word tokens | Language: {detected_lang}")

        # 4. Speaker Diarization Refinement
        yield f"data: {json.dumps({'type': 'progress', 'stage': 'Refining speaker conversational turns & assignments...', 'progress': 50})}\n\n"
        words = await refine_speaker_diarization(
            words=words,
            num_speakers=num_speakers,
            language=detected_lang,
        )

        # 5. Strict Native Script Enforcement (Transliterate English Loanwords)
        if strict_native_script:
            yield f"data: {json.dumps({'type': 'progress', 'stage': f'Enforcing native {detected_lang.upper()} script (transliterating loanwords)...', 'progress': 65})}\n\n"
            log_terminal("TRANSLITERATION", f"Enforcing native script for target language: {detected_lang.upper()} (Script: {script or 'Auto'})")
            words = await enforce_native_script_for_words(
                words=words,
                target_language=detected_lang,
                target_script_override=script,
                enable_strict_script=True,
            )

        # 6. Netflix Timed Text Conforming Engine (Deterministic Local Engine)
        yield f"data: {json.dumps({'type': 'progress', 'stage': f'Conforming {word_count} words to Netflix Timed Text Style Guide ({detected_lang.upper()})...', 'progress': 80})}\n\n"
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

        # 7. Quality Control Audit
        yield f"data: {json.dumps({'type': 'progress', 'stage': 'Validating reading speeds, line breaks & gap chaining...', 'progress': 92})}\n\n"
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

        yield f"data: {json.dumps({'type': 'complete', 'result': qc_result.model_dump(), 'events': events_payload, 'total_events': len(events), 'compliance_score': compliance_score})}\n\n"
    except Exception as exc:
        logger.exception(f"Unhandled error in stream_generate_subtitles: {exc}")
        log_terminal("NETFLIX-QC", f"[PIPELINE ERROR] {exc}", level="ERROR")
        yield f"data: {json.dumps({'type': 'error', 'message': str(exc), 'error': str(exc)})}\n\n"


# Alias for main.py router export
generate_subtitles_stream = stream_generate_subtitles
