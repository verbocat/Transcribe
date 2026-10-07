"""
AI second pass over speaker labels.

The speech engine labels speakers from the voice alone, so it makes three kinds of mistakes that are easy to
spot once you read the conversation: one person split into two labels, a short reply ("हाँ", "जी") given to the
wrong person, and two people merged. This pass hands a language model the transcript with its labels and asks
only for corrections, using the conversation itself (who is answering whom, names used, gender of address).

The model never rewrites text and never invents a speaker. It can only
  * merge one existing speaker into another, and
  * move a single line to an existing speaker.
Every suggestion is checked here before it is applied (known speaker, no gender clash, change budget).

Costs one text-only Gemini call per ~120 lines (no audio upload). Off by default in the pipeline; the Speakers
panel runs it on demand.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

CHUNK_LINES = 120
CONTEXT_LINES = 8          # lines of lead-in shown to the model but not editable
MAX_CHANGED_FRACTION = 0.30  # more than this many lines changed means the model is guessing; apply nothing
MAX_LINE_CHARS = 160

Line = Dict[str, Any]  # {id, speaker, gender, start, end, text}


def lines_from_segments(segments) -> List[Line]:
    out = []
    for s in segments:
        get = (lambda k, d=None: s.get(k, d)) if isinstance(s, dict) else (lambda k, d=None: getattr(s, k, d))
        out.append({
            "id": get("segment_id"),
            "speaker": str(get("speaker") or "Speaker 1"),
            "gender": str(get("gender") or "Unknown"),
            "start": float(get("start_time") or 0.0),
            "end": float(get("end_time") or 0.0),
            "text": str(get("transcript") or ""),
        })
    return out


def speaker_profiles(lines: List[Line]) -> Dict[str, Dict[str, Any]]:
    prof: Dict[str, Dict[str, Any]] = {}
    for ln in lines:
        p = prof.setdefault(ln["speaker"], {"lines": 0, "seconds": 0.0, "genders": {}})
        p["lines"] += 1
        p["seconds"] += max(0.0, ln["end"] - ln["start"])
        p["genders"][ln["gender"]] = p["genders"].get(ln["gender"], 0) + 1
    for p in prof.values():
        p["gender"] = max(p["genders"], key=p["genders"].get)
    return prof


def _chunks(lines: List[Line]) -> List[Tuple[List[Line], List[Line]]]:
    """(lead-in context, editable lines) pairs."""
    out = []
    for i in range(0, len(lines), CHUNK_LINES):
        out.append((lines[max(0, i - CONTEXT_LINES):i], lines[i:i + CHUNK_LINES]))
    return out


def build_prompt(context: List[Line], chunk: List[Line], prof: Dict[str, Dict[str, Any]], language: str) -> str:
    roster = "\n".join(
        f"- {name}: {p['gender']}, {p['lines']} lines, {p['seconds']:.0f}s" for name, p in prof.items())

    def fmt(ln: Line, prev: Optional[Line]) -> str:
        gap = f"+{ln['start'] - prev['end']:.1f}s" if prev else ""
        return f"{ln['id']} | {ln['speaker']} | {gap} | {ln['text'][:MAX_LINE_CHARS]}"

    shown = list(context) + list(chunk)
    rows = [fmt(ln, shown[i - 1] if i else None) for i, ln in enumerate(shown)]
    n_ctx = len(context)
    body = "\n".join(rows[:n_ctx]) + ("\n--- lines you may correct start here ---\n" if n_ctx else "") + "\n".join(rows[n_ctx:])
    return f"""You are checking speaker labels on a {language} TV drama / conversation transcript.
An automatic diarizer labelled each line from the voice alone and is sometimes wrong. Use the conversation
(who answers whom, names people call each other, gendered verb forms, turn-taking, very short replies) to find mistakes.

Speakers:
{roster}

Lines (id | speaker | silence since previous line | text):
{body}

Report ONLY clear mistakes:
1. "merge": two labels that are obviously the same person (same gender, never talk to each other, alternate roles
   impossible). Be conservative: merge only with strong evidence.
2. "fix": a single line that clearly belongs to a different existing speaker than the one it has.
Rules: use only the speaker labels listed above. Never invent a speaker. Never change a line between a male and a
female speaker. Only fix lines after the marker. If unsure, report nothing.
Return JSON: {{"merge": [{{"from": "Speaker 4", "into": "Speaker 2"}}], "fix": [{{"id": 17, "speaker": "Speaker 1"}}]}}"""


def parse_plan(text: str) -> Dict[str, Any]:
    try:
        data = json.loads((text or "").strip() or "{}")
    except json.JSONDecodeError:
        return {"merge": [], "fix": []}
    if not isinstance(data, dict):
        return {"merge": [], "fix": []}
    merge = [m for m in data.get("merge") or [] if isinstance(m, dict) and isinstance(m.get("from"), str) and isinstance(m.get("into"), str)]
    fix = [f for f in data.get("fix") or [] if isinstance(f, dict) and isinstance(f.get("speaker"), str) and "id" in f]
    return {"merge": merge, "fix": fix}


def _compatible(a: str, b: str) -> bool:
    return a == b or "Unknown" in (a, b)


def apply_plan(lines: List[Line], plans: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Validate the model's suggestions and return {'speaker_map', 'reassign'}; empty if it overreaches."""
    prof = speaker_profiles(lines)
    known = set(prof)
    by_id = {ln["id"]: ln for ln in lines}

    speaker_map: Dict[str, str] = {}
    for plan in plans:
        for m in plan["merge"]:
            src, dst = m["from"], m["into"]
            if src == dst or src not in known or dst not in known:
                continue
            if not _compatible(prof[src]["gender"], prof[dst]["gender"]):
                continue
            speaker_map[src] = dst

    def resolve(name: str) -> str:
        seen = set()
        while name in speaker_map and name not in seen:
            seen.add(name)
            name = speaker_map[name]
        return name

    # Collapse chains (A->B, B->C) and drop cycles
    speaker_map = {k: resolve(k) for k in list(speaker_map) if resolve(k) != k}

    reassign: Dict[Any, str] = {}
    for plan in plans:
        for f in plan["fix"]:
            ln = by_id.get(f["id"])
            if ln is None:
                continue
            target = resolve(f["speaker"])
            current = resolve(ln["speaker"])
            if target not in known and target not in speaker_map.values():
                continue
            if target == current:
                continue
            if not _compatible(prof.get(target, {}).get("gender", "Unknown"), prof.get(current, {}).get("gender", "Unknown")):
                continue
            reassign[ln["id"]] = target

    moved_by_merge = sum(1 for ln in lines if ln["speaker"] in speaker_map)
    if lines and (moved_by_merge + len(reassign)) / len(lines) > MAX_CHANGED_FRACTION:
        logger.warning("[SpeakerAI] Suggestions touch too many lines; ignoring them")
        return {"speaker_map": {}, "reassign": {}}
    return {"speaker_map": speaker_map, "reassign": reassign}


def _call_model(prompt: str, health: Dict[str, Any]) -> Dict[str, Any]:
    from app.config import GEMINI_API_KEY, GEMINI_MODEL
    from app.gemini_util import generate_sync
    if health["down"] or not GEMINI_API_KEY:
        return {"merge": [], "fix": []}
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=GEMINI_API_KEY)
        resp = generate_sync(
            client, GEMINI_MODEL or "gemini-2.5-flash", prompt,
            types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"))
        return parse_plan(resp.text)
    except Exception as e:  # quota, auth, network: the labels simply stay as they were
        health["down"], health["reason"] = True, str(e)[:90]
        logger.warning(f"[SpeakerAI] Gemini call failed: {e}")
        return {"merge": [], "fix": []}


def suggest_corrections(lines: List[Line], language: str = "Hindi") -> Tuple[Dict[str, Any], List[str]]:
    """Ask the model for corrections. Returns ({'speaker_map', 'reassign'}, notes for the user)."""
    from app.config import GEMINI_API_KEY
    notes: List[str] = []
    if len({ln["speaker"] for ln in lines}) < 2 and len(lines) < 4:
        return {"speaker_map": {}, "reassign": {}}, notes
    if not GEMINI_API_KEY:
        return {"speaker_map": {}, "reassign": {}}, ["AI speaker review needs a Gemini key on the server."]

    prof = speaker_profiles(lines)
    health: Dict[str, Any] = {"down": False, "reason": None}
    prompts = [build_prompt(ctx, chunk, prof, language) for ctx, chunk in _chunks(lines)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        plans = list(pool.map(lambda p: _call_model(p, health), prompts))
    if health["down"]:
        notes.append(f"AI speaker review could not finish ({health['reason']}); speaker labels are unchanged where it failed.")
    return apply_plan(lines, plans), notes


def renumber_by_first_appearance(segments) -> None:
    """Relabel 'Speaker N' so numbers follow first appearance again (pipeline use; objects with .speaker)."""
    labels: Dict[str, str] = {}
    for s in segments:
        if s.speaker not in labels:
            labels[s.speaker] = f"Speaker {len(labels) + 1}"
        s.speaker = labels[s.speaker]


def refine_segments_in_place(segments, language: str = "Hindi") -> List[str]:
    """Pipeline hook: apply AI corrections to Segment objects, fix genders of moved lines, renumber."""
    lines = lines_from_segments(segments)
    plan, notes = suggest_corrections(lines, language)
    prof = speaker_profiles(lines)
    changed = 0
    for s in segments:
        target = plan["reassign"].get(s.segment_id) or plan["speaker_map"].get(s.speaker)
        if target and target != s.speaker:
            s.speaker = target
            if target in prof and prof[target]["gender"] != "Unknown":
                s.gender = prof[target]["gender"]
            changed += 1
    if changed:
        renumber_by_first_appearance(segments)
        notes.append(f"AI speaker review corrected {changed} line{'s' if changed != 1 else ''}.")
    return notes
