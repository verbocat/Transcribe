"""
ElevenLabs Scribe v2 Karya Transcription Pipeline
=================================================

Transcription-tool pipeline (replaces the Gemini multimodal transcriber):
1. Inspects audio metadata and dual-channel layout.
2. Transcribes the full file with ElevenLabs Scribe v2 (word timestamps, diarization, logprobs).
3. Smooths diarization flickers and labels speakers by order of appearance (Speaker 1 speaks first).
4. Enforces the target script: English loanwords -> native script (offline dictionary + Gemini),
   or native script -> Latin when a Latin script (e.g. Hinglish) is requested.
5. Applies Karya text rules per word (numbers in words, allowed punctuation only).
6. Groups words into Karya segments (speaker turns, pauses, sentence ends, 0.5s-20s limits).
7. Lints the dataset against the Karya rules.
"""

import re
import json
import math
import uuid
import asyncio
import logging
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import (
    GEMINI_API_KEY, GEMINI_MODEL, DEFAULT_LANGUAGE,
    MAX_SEGMENT_DURATION, MIN_SEGMENT_DURATION
)
from app.models import Segment, TranscriptionResult, AudioAnalysis, WordConfidence
from app.linter_engine import lint_dataset, convert_all_digits_to_words, sanitize_karya_punctuation
from app.audio_processor import (
    format_timestamp, inspect_audio, detect_dual_channel_layout,
    resolve_segment_speaker_from_channels
)
from app.elevenlabs_service import transcribe_with_scribe_v2, LANGUAGE_CODE_MAP
from app.transliteration_service import enforce_native_script_for_words, get_language_script_info
from app.netflix_engine import filter_diarization_flickers
from app.segment_gender import assign_genders_and_split_speakers
from app.terminal_logger import log_terminal

logger = logging.getLogger(__name__)

# No speaker cap: every distinct voice gets its own label (dramas can have a dozen characters).
# Capping Scribe's speaker count merges extra people into the nearest cap-sized speaker.
KARYA_NUM_SPEAKERS = None
# Diarization-flicker smoothing only touches words packed this tightly into continuous speech,
# so a genuine short reply from another speaker ("हाँ", "जी") is never absorbed.
FLICKER_MAX_GAP_SEC = 0.25

# Segmentation thresholds
PAUSE_SPLIT_SEC = 0.8          # a silence this long always starts a new segment
SENTENCE_SPLIT_MIN_SEC = 3.0   # split after sentence-final punctuation once a segment is this long
MERGE_MAX_GAP_SEC = 1.0        # max gap when merging a too-short segment into a same-speaker neighbour
SEGMENT_GAP_SEC = 0.050        # breathing room enforced between consecutive segments

# Overall-progress window of each pipeline stage (the speech engine dominates the wall time)
STAGE_RANGES = {
    "preparing": (10.0, 13.0),
    "uploading": (13.0, 25.0),
    "transcribing": (25.0, 85.0),
    "script": (85.0, 88.0),
    "segmenting": (88.0, 90.0),
    "gender": (90.0, 98.0),
    "linting": (98.0, 100.0),
}

_SENTENCE_END_RE = re.compile(r'[.?!।]["\']?$')
_AUTO_VALUES = {"", "auto", "auto-detect", "autodetect", "none"}

# ISO-639-3 code -> display language name (first full name listed in the Scribe map wins)
_CODE_TO_LANGUAGE: Dict[str, str] = {}
for _name, _code in LANGUAGE_CODE_MAP.items():
    if _code and len(_name) > 3 and _name.isalpha() and _code not in _CODE_TO_LANGUAGE:
        _CODE_TO_LANGUAGE[_code] = _name.title()


def _is_auto(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in _AUTO_VALUES


def _resolve_language_name(requested: str, detected_code: Optional[str]) -> str:
    if not _is_auto(requested):
        return requested
    code = str(detected_code or "").strip().lower()
    return _CODE_TO_LANGUAGE.get(code) or (code.title() if code else DEFAULT_LANGUAGE)


def _resolve_script_name(requested: str, language: str) -> str:
    if not _is_auto(requested):
        return requested
    info = get_language_script_info(language)
    return info["script"] if info else "Latin"


def _has_non_latin_letters(text: str) -> bool:
    for ch in text:
        if unicodedata.category(ch).startswith("L") and "LATIN" not in unicodedata.name(ch, ""):
            return True
    return False


def _logprob_to_confidence(logprob: Any) -> float:
    try:
        return round(min(1.0, max(0.0, math.exp(float(logprob)))), 2)
    except (TypeError, ValueError, OverflowError):
        return 0.95


def _extract_scribe_tokens(stt_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Word + spacing tokens from the raw Scribe response (keeps logprob for confidence)."""
    raw_words = (stt_result.get("raw") or {}).get("words") or stt_result.get("words") or []
    tokens = []
    for w in raw_words:
        w_type = w.get("type", "word")
        text = w.get("text", "")
        if w_type not in ("word", "spacing") or not text:
            continue
        tokens.append({
            "text": text,
            "start": round(float(w.get("start", 0.0)), 3),
            "end": round(float(w.get("end", 0.0)), 3),
            "type": w_type,
            "speaker_id": w.get("speaker_id") or "speaker_0",
            "confidence": _logprob_to_confidence(w.get("logprob")),
        })
    return tokens


def _split_affixes(text: str):
    """Split a token into (leading punctuation, core word, trailing punctuation).

    Uses Unicode categories instead of \\w, which does not match Indic vowel signs (e.g. 'ी').
    """
    def is_affix(ch: str) -> bool:
        cat = unicodedata.category(ch)
        return cat.startswith("P") or cat.startswith("S") or cat.startswith("Z")

    start, end = 0, len(text)
    while start < end and is_affix(text[start]):
        start += 1
    while end > start and is_affix(text[end - 1]):
        end -= 1
    return text[:start], text[start:end], text[end:]


def _assign_speakers(tokens: List[Dict[str, Any]]) -> None:
    """Smooth diarization flickers on words, then label speakers by first appearance."""
    word_idx = [i for i, t in enumerate(tokens) if t["type"] == "word"]
    words = [tokens[i] for i in word_idx]
    smoothed = filter_diarization_flickers(words)
    for k, (i, sw) in enumerate(zip(word_idx, smoothed)):
        # Only accept a flicker correction inside continuous speech; a word set apart by
        # real pauses is a genuine short turn (e.g. a backchannel "हाँ") and keeps its speaker.
        gap_before = words[k]["start"] - words[k - 1]["end"] if k > 0 else 0.0
        gap_after = words[k + 1]["start"] - words[k]["end"] if k + 1 < len(words) else 0.0
        if gap_before < FLICKER_MAX_GAP_SEC and gap_after < FLICKER_MAX_GAP_SEC:
            tokens[i]["speaker_id"] = sw.get("speaker_id") or tokens[i]["speaker_id"]

    labels: Dict[str, str] = {}
    last_label = "Speaker 1"
    for t in tokens:
        if t["type"] == "word":
            spk = str(t["speaker_id"])
            if spk not in labels:
                labels[spk] = f"Speaker {len(labels) + 1}"
            last_label = labels[spk]
        t["speaker"] = last_label  # spacing tokens follow the preceding word


async def _romanize_with_gemini(tokens: List[str], language: str) -> Dict[str, str]:
    """Phonetically romanize native-script words into Latin script (e.g. Hinglish)."""
    if not tokens or not GEMINI_API_KEY:
        if tokens:
            logger.warning("[Romanization] GEMINI_API_KEY missing; native-script words left unchanged.")
        return {}
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_API_KEY)
        prompt = f"""You are a professional linguist for verbatim speech transcription.
Task: Romanize each {language} word below into casual Latin-script spelling, exactly as it sounds
(e.g. Hinglish: "मीटिंग" -> "meeting", "क्या" -> "kya", "ठीक" -> "theek").

STRICT RULES:
1. Do NOT translate. Only transliterate the phonetic sound.
2. English loanwords must use their normal English spelling.
3. Output strictly a JSON object mapping each input word to its romanized spelling. No commentary.

Words:
{json.dumps(tokens, ensure_ascii=False)}
"""
        from app.gemini_util import generate_async
        response = await generate_async(
            client, GEMINI_MODEL or "gemini-3.8-flash", prompt,
            types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
        )
        result = json.loads((response.text or "").strip() or "{}")
        if isinstance(result, dict):
            return {str(k): str(v) for k, v in result.items() if v}
    except Exception as exc:
        logger.error(f"[Romanization] Gemini romanization error: {exc}")
    return {}


async def _enforce_target_script(tokens: List[Dict[str, Any]], language: str, script: str) -> List[Dict[str, Any]]:
    script_info = get_language_script_info(language, script_override=None if _is_auto(script) else script)
    if script_info and not script_info.get("is_latin", False):
        return await enforce_native_script_for_words(
            words=tokens,
            target_language=language,
            target_script_override=None if _is_auto(script) else script,
            enable_strict_script=True,
        )

    # Latin target: romanize any native-script words Scribe produced (and use '.' instead of the danda)
    tokens = [dict(t, text=t["text"].replace("।", ".")) if t["type"] == "word" else t for t in tokens]
    cores = set()
    for t in tokens:
        if t["type"] != "word":
            continue
        _, core, _ = _split_affixes(t["text"])
        if core and _has_non_latin_letters(core):
            cores.add(core)
    if not cores:
        return tokens

    log_terminal("TRANSLITERATION", f"Romanizing {len(cores)} native-script words into Latin script ({language})...")
    mapping = await _romanize_with_gemini(sorted(cores), language)
    updated = []
    for t in tokens:
        t_copy = dict(t)
        if t_copy["type"] == "word":
            prefix, core, suffix = _split_affixes(t_copy["text"])
            if core in mapping:
                t_copy["text"] = f"{prefix}{mapping[core]}{suffix}"
        updated.append(t_copy)
    return updated


def _apply_karya_text_rules(text: str, language: str) -> str:
    """Numbers in words + allowed punctuation only (Karya rules 6.2 / 6.10)."""
    text = text.replace("…", "...").replace("—", "--").replace("–", "--")
    text = convert_all_digits_to_words(text, language=language)
    return sanitize_karya_punctuation(text, language=language)


def _split_long_run(run: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Recursively split a token run longer than MAX_SEGMENT_DURATION at the best boundary."""
    words = [t for t in run if t["type"] == "word"]
    if len(words) < 2 or words[-1]["end"] - words[0]["start"] <= MAX_SEGMENT_DURATION:
        return [run]

    mid_time = (words[0]["start"] + words[-1]["end"]) / 2.0
    best_i, best_score = None, None
    for i in range(len(run) - 1):
        cur = run[i]
        if cur["type"] != "word":
            continue
        nxt = next((t for t in run[i + 1:] if t["type"] == "word"), None)
        if nxt is None:
            continue
        gap = nxt["start"] - cur["end"]
        # Prefer sentence ends, then long pauses, then closeness to the middle
        score = (1.0 if _SENTENCE_END_RE.search(cur["text"]) else 0.0) + min(gap, 1.0) \
            - abs(cur["end"] - mid_time) / max(1.0, words[-1]["end"] - words[0]["start"])
        if best_score is None or score > best_score:
            best_i, best_score = i, score

    if best_i is None:
        return [run]
    return _split_long_run(run[:best_i + 1]) + _split_long_run(run[best_i + 1:])


def _group_into_segments(tokens: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    runs: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    last_word: Optional[Dict[str, Any]] = None

    for t in tokens:
        if t["type"] != "word":
            if current:
                current.append(t)
            continue
        if last_word is not None:
            seg_start = next(x for x in current if x["type"] == "word")["start"]
            new_segment = (
                t["speaker"] != last_word["speaker"]
                or t["start"] - last_word["end"] >= PAUSE_SPLIT_SEC
                or (_SENTENCE_END_RE.search(last_word["text"]) and last_word["end"] - seg_start >= SENTENCE_SPLIT_MIN_SEC)
            )
            if new_segment:
                runs.append(current)
                current = []
        current.append(t)
        last_word = t
    if current:
        runs.append(current)

    split_runs: List[List[Dict[str, Any]]] = []
    for run in runs:
        split_runs.extend(_split_long_run(run))

    # Space-delimited languages get a space when two runs are merged (CJK stays unspaced)
    uses_spaces = any(t["type"] == "spacing" for t in tokens)

    # Merge too-short runs into an adjacent same-speaker run when the gap is small
    merged: List[List[Dict[str, Any]]] = []
    for run in split_runs:
        words = [t for t in run if t["type"] == "word"]
        if not words:
            continue
        if merged:
            prev_words = [t for t in merged[-1] if t["type"] == "word"]
            same_speaker = prev_words[-1]["speaker"] == words[0]["speaker"]
            gap = words[0]["start"] - prev_words[-1]["end"]
            too_short = (words[-1]["end"] - words[0]["start"] < MIN_SEGMENT_DURATION
                         or prev_words[-1]["end"] - prev_words[0]["start"] < MIN_SEGMENT_DURATION)
            fits = words[-1]["end"] - prev_words[0]["start"] <= MAX_SEGMENT_DURATION
            if too_short and same_speaker and gap < MERGE_MAX_GAP_SEC and fits:
                joint = [{"text": " ", "start": prev_words[-1]["end"], "end": words[0]["start"],
                          "type": "spacing", "speaker": words[0]["speaker"]}] if uses_spaces else []
                merged[-1] = merged[-1] + joint + run
                continue
        merged.append(run)
    return merged


def _build_segments(runs: List[List[Dict[str, Any]]], audio_path: str, language: str, total_duration: float) -> List[Segment]:
    segments: List[Segment] = []
    # Left/right channel energy can only tell two speakers apart; with more, trust the diarization labels
    speaker_count = len({t["speaker"] for run in runs for t in run if t["type"] == "word"})
    prev_end = 0.0

    for idx, run in enumerate(runs):
        word_tokens = [t for t in run if t["type"] == "word"]
        words_list: List[WordConfidence] = []
        parts: List[str] = []
        for t in run:
            if t["type"] == "spacing":
                parts.append(" ")
                continue
            clean = _apply_karya_text_rules(t["text"], language)
            if not clean:
                continue
            parts.append(clean)
            words_list.append(WordConfidence(
                word=clean,
                confidence=t["confidence"],
                start_time=round(t["start"], 3),
                end_time=round(t["end"], 3),
            ))
        transcript = re.sub(r'\s+', ' ', "".join(parts)).strip()
        if not transcript:
            continue

        s_time = word_tokens[0]["start"]
        e_time = word_tokens[-1]["end"]

        # Stretch very short utterances toward the minimum duration without overlapping the next segment
        if e_time - s_time < MIN_SEGMENT_DURATION:
            next_start = None
            if idx + 1 < len(runs):
                next_words = [t for t in runs[idx + 1] if t["type"] == "word"]
                next_start = next_words[0]["start"] if next_words else None
            limit = (next_start - SEGMENT_GAP_SEC) if next_start is not None else (total_duration or e_time + MIN_SEGMENT_DURATION)
            e_time = max(e_time, min(s_time + MIN_SEGMENT_DURATION, limit))
            if e_time - s_time < MIN_SEGMENT_DURATION:
                s_time = max(prev_end + SEGMENT_GAP_SEC if segments else 0.0, e_time - MIN_SEGMENT_DURATION)

        # Guarantee non-overlapping segments (crosstalk) with natural breathing room
        if segments and s_time < prev_end + SEGMENT_GAP_SEC:
            s_time = prev_end + SEGMENT_GAP_SEC
        if e_time <= s_time:
            e_time = s_time + MIN_SEGMENT_DURATION

        s_time, e_time = round(s_time, 3), round(e_time, 3)
        speaker = word_tokens[0]["speaker"]
        if speaker_count <= 2:
            speaker = resolve_segment_speaker_from_channels(audio_path, s_time, e_time, default_speaker=speaker)
        confidence = round(sum(w.confidence for w in words_list) / len(words_list), 2) if words_list else 0.95

        segments.append(Segment(
            segment_id=len(segments) + 1,
            speaker=speaker,
            gender="Unknown",  # filled per speaker from voice pitch after segmentation
            start_time=s_time,
            end_time=e_time,
            start_time_str=format_timestamp(s_time),
            end_time_str=format_timestamp(e_time),
            duration=round(e_time - s_time, 3),
            transcript=transcript,
            confidence=confidence,
            words=words_list,
            qc_errors=[],
            is_valid=True,
        ))
        prev_end = e_time

    return segments


async def process_audio_file(
    audio_path: str,
    language: str = "Auto-Detect",
    script: str = "Auto-Detect",
    elevenlabs_api_key: Optional[str] = None,
    video_path: Optional[str] = None,
    progress_cb=None,
) -> TranscriptionResult:
    """Complete Karya transcription pipeline powered by ElevenLabs Scribe v2.

    `progress_cb(stage, percent, detail)` receives overall progress (0-100) at each step.
    """
    def report(stage: str, stage_pct: Optional[float], detail: str = ""):
        if not progress_cb:
            return
        lo, hi = STAGE_RANGES.get(stage, (0.0, 100.0))
        overall = lo if stage_pct is None else lo + (hi - lo) * max(0.0, min(100.0, stage_pct)) / 100.0
        try:
            progress_cb(stage, round(overall, 1), detail, stage_pct)
        except Exception:
            pass

    audio_id = str(uuid.uuid4())[:8]
    filename = Path(audio_path).name

    report("preparing", 0.0, "Reading the audio")
    audio_info_dict, dual_ch_info = await asyncio.gather(
        asyncio.to_thread(inspect_audio, audio_path),
        asyncio.to_thread(detect_dual_channel_layout, audio_path),
    )
    if dual_ch_info.get("is_dual_channel"):
        audio_info_dict["channels"] = 2
    audio_info = AudioAnalysis(**audio_info_dict)
    audio_info.is_rejected = False
    audio_info.rejection_category = None
    audio_info.rejection_reason = None

    log_terminal("ELEVENLABS-STT", f"Transcription tool: dispatching '{filename}' to ElevenLabs Scribe v2 (Lang: {language}, Script: {script})...")
    stt_result = await transcribe_with_scribe_v2(
        audio_path=audio_path,
        language=None if _is_auto(language) else language,
        diarize=True,
        tag_audio_events=False,
        num_speakers=KARYA_NUM_SPEAKERS,
        api_key=elevenlabs_api_key,
        progress_cb=lambda st, pct, detail: report(st, pct, detail),
        expected_sec=audio_info.duration,
    )

    resolved_language = _resolve_language_name(language, stt_result.get("language_code"))
    resolved_script = _resolve_script_name(script, resolved_language)

    report("script", 0.0, "Fixing script and loanwords")
    tokens = _extract_scribe_tokens(stt_result)
    _assign_speakers(tokens)
    tokens = await _enforce_target_script(tokens, resolved_language, script)

    report("segmenting", 0.0, "Building subtitle segments")
    runs = _group_into_segments(tokens)
    segments = await asyncio.to_thread(_build_segments, runs, audio_path, resolved_language, audio_info.duration)
    report("gender", 0.0, "Detecting speaker gender")
    processing_notes = await asyncio.to_thread(assign_genders_and_split_speakers, audio_path, segments, video_path)
    roster = sorted({(s.speaker, s.gender) for s in segments}, key=lambda x: int(x[0].split()[-1]))
    log_terminal("ELEVENLABS-STT", f"[OK] Speakers: {', '.join(f'{n} ({g})' for n, g in roster)}")
    log_terminal("ELEVENLABS-STT", f"[OK] Built {len(segments)} Karya segments from {sum(1 for t in tokens if t['type'] == 'word')} words | Language: {resolved_language} | Script: {resolved_script}")

    report("linting", 0.0, "Checking Karya rules")
    linted_segments, score, errors_count, warnings_count = await asyncio.to_thread(
        lint_dataset, segments, language=resolved_language, script=resolved_script
    )
    report("linting", 100.0, "Done")

    # English words left in Latin script mean the transliteration pass could not run (Gemini unavailable)
    latin_lines = sum(1 for s in linted_segments if any("Code-mixed English script" in e.message for e in s.qc_errors))
    if latin_lines:
        processing_notes.append(
            f"{latin_lines} lines still contain English words in Latin script because the transliteration step did not complete "
            "(Gemini may be out of credits). Top up and transcribe again, or edit those lines, which are marked in the list."
        )

    return TranscriptionResult(
        audio_id=audio_id,
        filename=filename,
        language=resolved_language,
        script=resolved_script,
        audio_info=audio_info,
        segments=linted_segments,
        compliance_score=score,
        total_errors=errors_count,
        total_warnings=warnings_count,
        is_rejected=False,
        processing_notes=processing_notes,
    )
