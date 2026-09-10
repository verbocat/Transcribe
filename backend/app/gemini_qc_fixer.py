"""
Gemini-Coordinated Netflix QC Self-Correction Loop for Subtitle Studio.

Takes subtitle events with linter errors (CPL, CPS, Line Breaks, Overlaps),
formats a diagnostic prompt for Gemini with the exact rule violations,
prompts Gemini to restructure/re-break/split the offending events,
and aligns the corrected output against Whisper acoustic boundaries.
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.netflix_models import format_timestamp, calculate_cps, calculate_cpl
from app.audio_processor import parse_timestamp
from app.netflix_linter import lint_all_subtitles, auto_chain_gaps
from app.whisper_aligner import align_subtitle_timestamps

logger = logging.getLogger(__name__)


def log_terminal(msg: str):
    """Print clean formatted timestamped log to terminal."""
    now_str = datetime.now().strftime('%H:%M:%S')
    print(f"[{now_str}] [Gemini QC Fixer] {msg}", flush=True)


class SubtitleItemSchema(BaseModel):
    id: int
    start_time: str = Field(description="Timestamp in HH:MM:SS.mmm format")
    end_time: str = Field(description="Timestamp in HH:MM:SS.mmm format")
    text: str = Field(description="Subtitle text with optional newline '\\n' for line breaks")
    speakers: List[str] = Field(default_factory=lambda: ["Speaker 1"])


class SubtitleBatchSchema(BaseModel):
    subtitles: List[SubtitleItemSchema]


GEMINI_QC_FIX_SYSTEM_PROMPT = """You are an elite subtitle editor and Netflix Timed Text Quality Control specialist.

Your task is to fix subtitle events that have failed automated QC checks (CPL, CPS, line breaks, or duration limits).

### STRICT RULES:
1. 100% VERBATIM ACCURACY (NEVER REPHRASE OR REMOVE SPOKEN WORDS):
   - Every single word spoken by the speaker MUST be preserved exactly.
   - Do NOT delete, paraphrase, summarize, or alter words in any way.

2. CHARACTERS PER LINE (CPL):
   - Every line of text MUST NOT exceed {cpl_limit} characters.
   - Insert newline '\\n' at natural linguistic boundaries (before conjunctions, prepositions, or between clauses).
   - NEVER break across: article + noun ("the / car"), pronoun + verb ("I / went"), or names.

3. MAXIMUM LINES:
   - Exactly 1 or 2 lines per subtitle event (NEVER 3 lines).

4. READING SPEED (CPS):
   - Keep reading speed under {max_cps} characters per second (CPS = character_count / duration).
   - If a spoken sentence is too long for its current time window, SPLIT it into two sequential subtitle events across the timeline so the viewer has time to read both parts!
   - Ensure the second part starts at or after the first part ends (monotonic ordering).

5. COMPLETE SENTENCES:
   - Maintain natural sentence formation. Do NOT leave awkward single-word or half-clause fragments.

6. STRICT SINGLE-SPEAKER RULE (EXACTLY ONE SPEAKER PER EVENT):
   - Each and every subtitle event MUST contain speech from EXACTLY ONE speaker!
   - NEVER combine speech from two different speakers into a single subtitle event.
   - NEVER use hyphen prefixes ('- Speaker 1\n- Speaker 2') within the same subtitle event.
   - Set 'speakers' array to contain exactly one speaker identity (e.g. ['Speaker 1']).

7. HINDI & MULTILINGUAL LINE BREAK RULES:
   - Break lines at natural punctuation ('।', '॥', ',', '?') or before conjunctions ('और', 'या', 'लेकिन', 'क्योंकि', 'इसलिए', 'ताकि', 'कि', 'तो', 'and', 'but').
   - NEVER break right before a Hindi postposition ('ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक') leaving it stranded on the next line! Keep postpositions with the preceding noun.
   - NEVER sever honorifics/titles ('श्री', 'श्रीमती', 'डॉ.', 'Mr.', 'Mrs.').

Return the fixed subtitles in strict JSON format conforming to the provided schema.
"""


def _get_gemini_client() -> genai.Client:
    """Initialize and return Google GenAI client."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


def _has_fixable_errors(qc_errors: List[Dict[str, Any]]) -> bool:
    """Check if an event has errors that Gemini should address."""
    target_rules = {
        "NF-CPL",
        "NF-CPS-ADULT",
        "NF-CPS-CHILD",
        "NF-MAX-LINES",
        "NF-LINE-BREAK",
        "NF-LINE-BREAK-POSTPOSITION",
        "NF-DURATION-SHORT",
        "NF-DURATION-LONG",
        "NF-LINE-BREAK-PRONOUN",
        "NF-LINE-BREAK-TITLE",
        "NF-LINE-BREAK-NUMBER",
        "NF-OVERLAP",
        "NF-DUAL-SPEAKER",
    }
    for err in qc_errors:
        rule_id = err.get("rule_id", "")
        if rule_id in target_rules or err.get("severity") == "error":
            return True
    return False


def coordinate_gemini_qc_fix(
    events: List[Dict[str, Any]],
    whisper_words: Optional[List[Dict[str, Any]]] = None,
    shot_changes: Optional[List[float]] = None,
    content_type: str = "adult",
    frame_rate: float = 24.0,
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    audio_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Coordinates with Gemini to fix subtitle events violating QC rules.

    1. Lints events against user settings.
    2. Gathers violating events and their exact diagnostic errors.
    3. Grounds the fix prompt with actual spoken word timestamps from Whisper.
    4. Batches violating events to Gemini with a targeted fix prompt.
    5. Merges corrected events into the timeline.
    6. Re-aligns corrected events against Whisper & Silero VAD acoustic boundaries.
    7. Re-lints and returns updated events and QC score.
    """
    shot_changes = shot_changes or []

    # Step 0: Fast deterministic algorithmic formatting pass (resolves 95%+ of CPL & CPS issues instantly)
    from app.netflix_linter import format_and_split_subtitle_events
    events = format_and_split_subtitle_events(
        events=events,
        cpl_limit=cpl_limit,
        max_cps=max_cps,
        max_lines=max_lines,
        min_duration=min_duration,
        max_duration=max_duration,
        frame_rate=frame_rate,
    )

    # Step 1: Initial lint with custom thresholds
    initial_lint = lint_all_subtitles(
        events=events,
        shot_changes=shot_changes,
        content_type=content_type,
        frame_rate=frame_rate,
        custom_cpl=cpl_limit,
        custom_cps=max_cps,
        custom_max_lines=max_lines,
        custom_min_duration=min_duration,
        custom_max_duration=max_duration,
    )

    linted_events = initial_lint["events"]
    violating_indices = [
        i for i, ev in enumerate(linted_events)
        if _has_fixable_errors(ev.get("qc_errors", []))
    ]

    if not violating_indices:
        log_terminal("No QC violations detected — subtitles are 100% compliant!")
        return initial_lint

    log_terminal(f"Detected {len(violating_indices)} subtitle event(s) with remaining QC violations. Coordinating with Gemini...")

    # Step 2: Batch violating events in groups of up to 8
    batch_size = 8
    corrected_map = {}  # original_index -> list of corrected event dicts

    client = _get_gemini_client()
    candidate_models = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
    ]
    primary = os.getenv("GEMINI_MODEL")
    if primary and primary in candidate_models:
        candidate_models.remove(primary)
        candidate_models.insert(0, primary)
    elif primary:
        candidate_models.insert(0, primary)

    system_prompt = GEMINI_QC_FIX_SYSTEM_PROMPT.format(
        cpl_limit=cpl_limit,
        max_cps=max_cps,
        max_lines=max_lines
    )

    for b_start in range(0, len(violating_indices), batch_size):
        batch_idx_subset = violating_indices[b_start:b_start + batch_size]
        items_to_fix = []

        for idx in batch_idx_subset:
            ev = linted_events[idx]
            err_msgs = [e.get("message", "") for e in ev.get("qc_errors", [])]
            ev_st = parse_timestamp(ev.get("start_time", 0.0))
            ev_et = parse_timestamp(ev.get("end_time", ev_st + 2.0))

            # Ground with physical spoken word timestamps from Whisper if available
            ev_word_anchors = []
            if whisper_words:
                for w in whisper_words:
                    w_st = float(w.get("start", 0.0))
                    w_et = float(w.get("end", w_st + 0.3))
                    if w_et >= ev_st - 0.4 and w_st <= ev_et + 0.4:
                        ev_word_anchors.append(f"{w.get('word', '')} ({w_st:.2f}s-{w_et:.2f}s)")

            fix_item = {
                "batch_item_id": idx,
                "current_start": ev.get("start_time_str") or format_timestamp(ev.get("start_time", 0.0)),
                "current_end": ev.get("end_time_str") or format_timestamp(ev.get("end_time", 0.0)),
                "duration": ev.get("duration", 0.0),
                "current_text": ev.get("text", ""),
                "qc_errors": err_msgs,
                "speakers": ev.get("speakers", ["Speaker 1"]),
            }
            if ev_word_anchors:
                fix_item["spoken_word_timestamps"] = " ".join(ev_word_anchors[:25])

            items_to_fix.append(fix_item)

        fix_prompt = f"""Fix the following {len(items_to_fix)} subtitle event(s) to strictly satisfy all Netflix rules:

Target Settings:
- Max CPL: {cpl_limit}
- Max CPS: {max_cps}
- Max Lines: {max_lines}

Items to Fix:
{json.dumps(items_to_fix, indent=2)}

Instructions:
- For each item, keep 100% verbatim spoken words.
- Re-break lines with '\\n' so every line has <= {cpl_limit} characters.
- If text is too long for its duration (CPS > {max_cps}), split it into TWO separate sequential subtitle events with appropriate timestamps!
- Use the spoken_word_timestamps to ensure any split falls precisely at a natural pause between words.
- Use the item's `batch_item_id` in the `id` field (or sub-ids if split, e.g. 101, 102).
"""

        response = None
        for cand_model in candidate_models:
            try:
                response = client.models.generate_content(
                    model=cand_model,
                    contents=fix_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=0.1,
                        thinking_config=types.ThinkingConfig(thinking_level="low"),
                        response_mime_type="application/json",
                        response_schema=SubtitleBatchSchema,
                    ),
                )
                if response is not None:
                    break
            except Exception as e:
                err_str = str(e).lower()
                if any(kw in err_str for kw in ["429", "quota", "resource_exhausted", "404", "not_found"]):
                    log_terminal(f"Model {cand_model} unavailable/exhausted, falling back to next candidate...")
                    continue
                else:
                    logger.error(f"Error fixing batch with {cand_model}: {e}")
                    break

        if response is None:
            log_terminal(f"Warning: Gemini fix batch {b_start} skipped due to API quota limits.")
            continue

        try:
            raw_text = response.text or ""
            # Parse corrected subtitles
            parsed = json.loads(raw_text)
            subs = parsed.get("subtitles", [])

            # Map fixed subtitles back to their original event indices
            for sub in subs:
                orig_idx = sub.get("id")
                # If Gemini returned valid index, map it
                if orig_idx in batch_idx_subset:
                    if orig_idx not in corrected_map:
                        corrected_map[orig_idx] = []
                    s_sec = parse_timestamp(sub.get("start_time", "00:00:00.000"))
                    e_sec = parse_timestamp(sub.get("end_time", "00:00:02.000"))
                    if e_sec <= s_sec:
                        e_sec = s_sec + max(0.833, len(sub.get("text", "")) / max_cps)
                    corrected_map[orig_idx].append({
                        "start_time": s_sec,
                        "end_time": e_sec,
                        "text": sub.get("text", "").strip(),
                        "speakers": sub.get("speakers", ["Speaker 1"]),
                    })

            log_terminal(f"Batch {b_start // batch_size + 1}: Gemini fixed {len(subs)} subtitle events.")
        except Exception as fix_err:
            log_terminal(f"WARNING: Gemini fix batch failed ({fix_err}), keeping original events.")

    # Step 3: Rebuild the full event list with corrected events spliced in
    rebuilt_events = []
    current_id = 1

    for i, orig_ev in enumerate(linted_events):
        if i in corrected_map and corrected_map[i]:
            for fixed_item in corrected_map[i]:
                txt = fixed_item["text"]
                dur = max(0.01, round(fixed_item["end_time"] - fixed_item["start_time"], 3))
                rebuilt_events.append({
                    "id": current_id,
                    "start_time": round(fixed_item["start_time"], 3),
                    "end_time": round(fixed_item["end_time"], 3),
                    "start": round(fixed_item["start_time"], 3),
                    "end": round(fixed_item["end_time"], 3),
                    "start_time_str": format_timestamp(fixed_item["start_time"]),
                    "end_time_str": format_timestamp(fixed_item["end_time"]),
                    "duration": dur,
                    "text": txt,
                    "lines": txt.split("\n"),
                    "speaker_count": len(fixed_item.get("speakers", ["Speaker 1"])),
                    "speakers": fixed_item.get("speakers", ["Speaker 1"]),
                    "is_italic": orig_ev.get("is_italic", False),
                    "is_forced_narrative": orig_ev.get("is_forced_narrative", False),
                    "cps": calculate_cps(txt, dur),
                    "cpl": calculate_cpl(txt),
                    "qc_errors": [],
                    "is_valid": True,
                })
                current_id += 1
        else:
            orig_ev["id"] = current_id
            rebuilt_events.append(orig_ev)
            current_id += 1

    # Step 4: If Whisper words are available, align any newly split or edited events
    if whisper_words:
        log_terminal("Re-aligning Gemini-fixed subtitles against Whisper & Silero VAD acoustic boundaries...")
        rebuilt_events = align_subtitle_timestamps(
            rebuilt_events,
            whisper_words,
            search_radius=12.0,
            audio_path=audio_path,
            frame_rate=frame_rate,
            min_duration=min_duration,
            max_duration=max_duration
        )

    # Step 5: Split any multi-speaker events, gap chaining & monotonic order enforcement
    from app.netflix_linter import split_multi_speaker_subtitles
    rebuilt_events = split_multi_speaker_subtitles(rebuilt_events, frame_rate=frame_rate, min_duration=min_duration)
    rebuilt_events = auto_chain_gaps(rebuilt_events, frame_rate=frame_rate, min_duration=min_duration, max_cps=max_cps)

    # Step 6: Final lint check
    final_lint = lint_all_subtitles(
        events=rebuilt_events,
        shot_changes=shot_changes,
        content_type=content_type,
        frame_rate=frame_rate,
        custom_cpl=cpl_limit,
        custom_cps=max_cps,
        custom_max_lines=max_lines,
        custom_min_duration=min_duration,
        custom_max_duration=max_duration,
    )

    old_score = initial_lint.get("compliance_score", 0.0)
    new_score = final_lint.get("compliance_score", 0.0)
    log_terminal(f"Gemini QC Fix Complete: QC Score improved from {old_score}% -> {new_score}%")

    return final_lint
