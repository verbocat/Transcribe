"""
Local subtitle QC that always runs, next to (and merged with) the Centroid AI review.

Every issue it returns has the same shape Centroid uses, plus a concrete `suggestion` (the full replacement text for
that cue) wherever the problem can be fixed by editing the text, so the editor's one-click "Apply fix" works:

    {index, start, end, category, severity ("error"|"warning"), mqm_severity, title, description,
     source, target, suggestion (str | None), origin ("local")}

Checks: empty / untranslated cue, line breaks and bad splits (phrase-aware), CPL and line count, reading speed,
punctuation (spacing, doubles, missing question/exclamation mark, unbalanced quotes), numbers, speaker labels
and dual-speaker dashes, and consistency (glossary terms, the same source line translated two ways).
"""
import math
import re
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

from app.netflix_engine import (
    get_language_profile,
    optimize_language_line_breaks,
    phrase_break_cost,
    tidy_punctuation_spacing,
)

_TAGS = re.compile(r"<[^>]+>|\{\\an[1-9]\}")
_NUM = re.compile(r"\d+(?:[.,]\d+)?")
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_SPEAKER_LABEL = re.compile(r"^\s*[-–—]?\s*(\[[^\]]{1,30}\]|\([^)]{1,30}\)|[A-Z][A-Z ]{1,20}:)\s*")
_END_Q = ("?", "؟", "？")
_END_EX = ("!", "！")
_CLOSERS = '"”’)]'

# A cue that ends on one of these and is followed by a continuation is a bad split between cues
_DANGLING_END = {
    "a", "an", "the", "your", "my", "his", "her", "its", "our", "their", "this", "that", "to", "of", "in", "on", "at",
    "for", "with", "by", "from", "and", "but", "or", "because", "if", "than", "is", "are", "was", "were", "not",
    "का", "के", "की", "में", "से", "को", "पर", "और", "या", "कि", "क्योंकि", "लेकिन",
}


def _plain(text: str) -> str:
    return _TAGS.sub("", text or "")


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", _plain(text).replace("\n", " ")).strip()


def _numbers(text: str) -> List[str]:
    return [n.replace(",", "") for n in _NUM.findall(_plain(text).translate(_DEVANAGARI_DIGITS))]


def _norm_words(text: str) -> str:
    """Lower-case, no spaces or hyphens, chandrabindu folded into anusvara: for finding a number written in words."""
    return re.sub(r"[\s\-]+", "", (text or "").lower().replace("ँ", "ं"))


def _number_written_in(number: str, target: str, lang: str) -> bool:
    """True when the whole number `number` appears in `target` spelled out (Rule 6.10 wants words, not digits)."""
    try:
        val = int(number)
    except ValueError:
        return False
    from app.linter_engine import number_to_hindi_words
    haystack = _norm_words(target)
    candidates = {number_to_hindi_words(val)} if lang[:2] in ("hi", "mr") else set()
    try:
        from num2words import num2words
        candidates.add(num2words(val, lang=lang[:2]))
    except Exception:
        pass
    return any(_norm_words(c) in haystack for c in candidates if c)


def _issue(cue: Dict[str, Any], index: int, category: str, severity: str, title: str, description: str,
           suggestion: Optional[str] = None, suggestion_end: Optional[float] = None) -> Dict[str, Any]:
    target = cue.get("target") or ""
    if suggestion is not None and suggestion.strip() == target.strip():
        suggestion = None
    return {
        "index": index,
        "start": cue.get("start"),
        "end": cue.get("end"),
        "category": category,
        "severity": severity,
        "mqm_severity": "Major" if severity == "error" else "Minor",
        "title": title,
        "description": description,
        "source": cue.get("source") or "",
        "target": target,
        "suggestion": suggestion,
        "suggestion_end": suggestion_end,
        "origin": "local",
    }


def _clean_punctuation(text: str, lang: str) -> str:
    out = tidy_punctuation_spacing(text, lang)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\s+([,;:!?।])", r"\1", out) if lang.lower()[:2] != "fr" else out
    out = re.sub(r"([!?])\1{1,}", r"\1", out)
    out = re.sub(r"(?<!\.)\.{2}(?!\.)", ".", out)
    out = re.sub(r"\.{4,}", "...", out)
    return out.strip()


def _rebreak(text: str, lang: str, max_cpl: int) -> str:
    flat = _flat(text)
    profile = get_language_profile(lang)
    return optimize_language_line_breaks(flat, profile, custom_cpl=max_cpl)


def _extended_end(cues: List[Dict[str, Any]], n: int, chars: int, max_cps: float, cap_duration: bool) -> Optional[float]:
    """The end time that brings cue `n` (1-based) to `max_cps`, or None when the next cue (or 7 s) leaves no room."""
    try:
        start, end = float(cues[n - 1].get("start")), float(cues[n - 1].get("end"))
    except (TypeError, ValueError):
        return None
    need = math.ceil((start + chars / max_cps) * 1000) / 1000
    limit = start + 7.0 if cap_duration else float("inf")
    if n < len(cues):
        try:
            nxt = float(cues[n].get("start"))
            limit = min(limit, nxt - min(max(nxt - end, 0.0), 0.083))
        except (TypeError, ValueError):
            pass
    return need if end < need <= limit else None


def _glossary_pairs(glossary: Any, lang: str) -> List[Dict[str, str]]:
    pairs = []
    for g in glossary or []:
        if not isinstance(g, dict):
            continue
        src = str(g.get("source") or "").strip()
        tgt = str(g.get("target") or g.get("translation") or "").strip()
        g_lang = g.get("lang") or g.get("target_lang")
        if src and tgt and (not g_lang or g_lang == lang):
            pairs.append({"source": src, "target": tgt})
    return pairs


def run_local_qc(
    cues: List[Dict[str, Any]],
    target_lang: str,
    source_lang: Optional[str] = None,
    glossary: Any = None,
    constraints: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Return local QC issues for source/target cue pairs. `index` is the 1-based position, like Centroid's.

    `constraints["unit"]` says what a cue is. "cue" (default) is a finished subtitle card, so characters per line,
    line count and line breaks are checked. "segment" is a transcript segment (a sentence or a speaker turn): its
    text is not cut into cards yet, so those card rules are skipped here (they apply when the Netflix engine cuts the
    cards at export) and only the checks that hold for any unit run: reading speed over the whole segment,
    punctuation, numbers, speakers, consistency."""
    constraints = constraints or {}
    card_rules = str(constraints.get("unit") or "cue").lower() != "segment"
    lang = (target_lang or "en").lower()
    profile = get_language_profile(lang)
    max_cpl = int(constraints.get("max_cpl") or profile.cpl_limit)
    max_lines = int(constraints.get("max_lines") or 2)
    max_cps = float(constraints.get("max_cps") or profile.cps_adult)
    issues: List[Dict[str, Any]] = []
    same_lang = bool(source_lang) and source_lang.lower()[:2] == lang[:2]

    for n, cue in enumerate(cues, start=1):
        target = cue.get("target") or ""
        source = cue.get("source") or ""
        flat = _flat(target)
        lines = [l for l in _plain(target).split("\n")]
        dual = len(lines) == 2 and all(l.strip().startswith(("-", "–", "—")) for l in lines)

        if source.strip() and not flat:
            issues.append(_issue(cue, n, "omission", "error", "Empty subtitle",
                                 "This cue has a source line but no translation.", None))
            continue
        if not flat:
            continue

        if not same_lang and len(flat) > 12 and flat.lower() == _flat(source).lower() and not _NUM.fullmatch(flat):
            issues.append(_issue(cue, n, "untranslated", "warning", "Looks untranslated",
                                 "The text is identical to the source. If this is not a name or a quoted phrase, translate it.", None))

        # ---- Line breaks, length, line count ------------------------------------------------------------
        if not dual and card_rules:
            line_texts = [l.strip() for l in lines if l.strip()]
            too_long = [l for l in line_texts if len(l) > max_cpl]
            bad_joint = None
            for a, b in zip(line_texts, line_texts[1:]):
                aw, bw = a.split(), b.split()
                if aw and bw and phrase_break_cost(aw[-1], bw[0]) >= 200:
                    bad_joint = (aw[-1], bw[0])
                    break
            if len(line_texts) > max_lines or too_long:
                fixed = _rebreak(target, lang, max_cpl)
                still_long = any(len(l) > max_cpl for l in fixed.split("\n")) or len(fixed.split("\n")) > max_lines
                why = (f"The subtitle has {len(line_texts)} lines (max {max_lines})." if len(line_texts) > max_lines
                       else f"A line is {max(len(l) for l in too_long)} characters (max {max_cpl}).")
                issues.append(_issue(cue, n, "line-length", "error", "Line too long", why + (
                    " Re-broken at natural phrase boundaries." if not still_long else
                    " The text is too long for one subtitle; shorten it or split the cue."),
                    None if still_long else fixed))
            elif bad_joint:
                fixed = _rebreak(target, lang, max_cpl)
                issues.append(_issue(cue, n, "line-break", "warning", "Awkward line break",
                                     f"The break between “{bad_joint[0]}” and “{bad_joint[1]}” cuts a phrase in two. "
                                     "Break after a clause or before a conjunction or preposition instead.", fixed))

        # ---- Reading speed -------------------------------------------------------------------------------
        try:
            dur = float(cue.get("end")) - float(cue.get("start"))
        except (TypeError, ValueError):
            dur = 0.0
        if dur > 0:
            body = re.sub(r"^\s*[-–—]\s*", "", flat)
            cps = len(body) / dur
            if cps > max_cps:
                new_end = _extended_end(cues, n, len(body), max_cps, card_rules)
                severe = cps > max_cps * 1.2
                fix_note = (f" Ends {new_end - float(cue.get('end')):.2f} s later to fit." if new_end is not None
                            else " There is no room to lengthen it, so shorten the text.")
                issues.append(_issue(cue, n, "reading-speed", "error" if severe else "warning",
                                     "Reads too fast" if severe else "Reading speed is high",
                                     f"{cps:.0f} characters per second (limit {max_cps:.0f})." + fix_note,
                                     None, new_end))

        # ---- Punctuation -------------------------------------------------------------------------------
        cleaned = _clean_punctuation(target, lang)
        if not card_rules:
            # A transcript segment keeps three plain dots: the transcription rules (6.2) do not allow the … character
            cleaned = cleaned.replace("…", "...")
        if cleaned != target.strip():
            issues.append(_issue(cue, n, "punctuation", "warning", "Punctuation spacing",
                                 "Extra spaces, repeated punctuation or a space before a mark.", cleaned))
        src_tail = _flat(source).rstrip(_CLOSERS)
        tgt_tail = flat.rstrip(_CLOSERS)
        if src_tail.endswith(_END_Q) and not tgt_tail.endswith(_END_Q + ("…",)):
            q = "?" if lang[:2] != "ar" else "؟"
            fixed = re.sub(r"[.!।]+(?=[" + re.escape(_CLOSERS) + r"]*$)", "", target.rstrip()) if tgt_tail.endswith((".", "!", "।")) else target.rstrip()
            issues.append(_issue(cue, n, "punctuation", "warning", "Question mark missing",
                                 "The source is a question but the translation does not end with a question mark.", fixed + q))
        elif src_tail.endswith(_END_EX) and not tgt_tail.endswith(_END_EX + _END_Q + ("…",)) and not same_lang:
            issues.append(_issue(cue, n, "punctuation", "warning", "Exclamation mark missing",
                                 "The source is an exclamation but the translation does not end with one.",
                                 re.sub(r"[.।]+$", "", target.rstrip()) + "!"))
        # A transcript segment is a sentence or a speaker turn, so a quotation often runs on into the next one
        if card_rules and (flat.count('"') % 2 == 1 or flat.count("“") != flat.count("”")):
            issues.append(_issue(cue, n, "punctuation", "warning", "Unbalanced quotation marks",
                                 "A quotation mark is opened or closed without its pair in this subtitle.", None))

        # ---- Numbers ---------------------------------------------------------------------------------
        if source and not same_lang:
            tgt_nums = _numbers(target)
            miss = [x for x in dict.fromkeys(_numbers(source)) if x not in tgt_nums]
            # Numbers written in words (the transcription rules require it) are not missing
            written = [x for x in miss if "." not in x and _number_written_in(x, target, lang)]
            miss = [x for x in miss if x not in written]
            if miss:
                # No digits in the translation at all means the number may be spelled out in a form we cannot match
                spelled = not tgt_nums
                issues.append(_issue(cue, n, "number", "warning" if spelled else "error",
                                     "Check the number" if spelled else "Number differs from source",
                                     (f"The source contains {', '.join(miss)}; the translation has no digits, so make sure it is written out in words."
                                      if spelled else f"The source contains {', '.join(miss)} but the translation does not."), None))

        # ---- Speaker labels / dual speaker -----------------------------------------------------------
        src_lines = [l for l in _plain(source).split("\n") if l.strip()]
        src_dual = len(src_lines) == 2 and all(l.strip().startswith(("-", "–", "—")) for l in src_lines)
        if src_dual and not dual:
            sentences = re.split(r"(?<=[.?!।])\s+", flat)
            fixed = None
            if len(sentences) == 2:
                fixed = "-" + sentences[0].lstrip("-– ").strip() + "\n-" + sentences[1].lstrip("-– ").strip()
            issues.append(_issue(cue, n, "speaker", "error", "Dual-speaker dashes missing",
                                 "The source shows two speakers (a dash on each line) but the translation does not.", fixed))
        elif dual and not src_dual and source.strip():
            issues.append(_issue(cue, n, "speaker", "warning", "Unexpected dual-speaker dashes",
                                 "The translation shows two speakers but the source has only one.",
                                 re.sub(r"\s*\n\s*[-–—]\s*", " ", re.sub(r"^\s*[-–—]\s*", "", target.strip()))))
        if dual:
            for l in lines:
                if re.match(r"^\s*[-–—]\s+\S", l):
                    fixed = "\n".join(re.sub(r"^(\s*[-–—])\s+", r"\1", x) for x in lines)
                    issues.append(_issue(cue, n, "speaker", "warning", "Space after dual-speaker dash",
                                         "Netflix style puts the dash directly before the text, without a space.", fixed))
                    break
        m_src, m_tgt = _SPEAKER_LABEL.match(source or ""), _SPEAKER_LABEL.match(target or "")
        if m_src and not m_tgt:
            issues.append(_issue(cue, n, "speaker", "warning", "Speaker label dropped",
                                 f"The source starts with the speaker label {m_src.group(1)}; the translation does not.",
                                 f"{m_src.group(1)} {target.strip()}"))
        elif m_tgt and not m_src and source.strip():
            issues.append(_issue(cue, n, "speaker", "warning", "Speaker label added",
                                 f"The translation starts with {m_tgt.group(1)} but the source has no label.",
                                 _SPEAKER_LABEL.sub("", target, count=1).strip()))

    # ---- Bad split between neighbouring cues --------------------------------------------------------------
    for n in range(1, len(cues) if card_rules else 0):
        cur, nxt = cues[n - 1], cues[n]
        t, u = _flat(cur.get("target") or ""), _flat(nxt.get("target") or "")
        if not t or not u or t.endswith((".", "!", "?", "…", "।", ",", ":", ";", "—")):
            continue
        last = t.split()[-1].lower().strip(".,!?;:")
        try:
            gap = float(nxt.get("start")) - float(cur.get("end"))
        except (TypeError, ValueError):
            gap = 9.0
        if last in _DANGLING_END and gap < 0.5:
            issues.append(_issue(cur, n, "split", "warning", "Cue ends mid-phrase",
                                 f"This subtitle ends on “{last}” and the sentence continues in the next one. "
                                 "Move the last words to the next subtitle, or re-split the sentence at a clause break.", None))
        elif (t.split()[-1][:1].isupper() and u.split()[0][:1].isupper() and gap < 0.5
              and phrase_break_cost(t.split()[-1], u.split()[0]) >= 400):
            issues.append(_issue(cur, n, "split", "warning", "Name split across cues",
                                 f"“{t.split()[-1]} {u.split()[0]}” is cut between two subtitles.", None))

    # ---- Consistency --------------------------------------------------------------------------------------
    by_source: Dict[str, List[int]] = defaultdict(list)
    for n, cue in enumerate(cues, start=1):
        key = _flat(cue.get("source") or "").lower()
        if len(key) >= 4 and _flat(cue.get("target") or ""):
            by_source[key].append(n)
    for key, idxs in by_source.items():
        if len(idxs) < 2:
            continue
        variants = Counter(_flat(cues[i - 1].get("target") or "") for i in idxs)
        if len(variants) > 1:
            best = variants.most_common(1)[0][0]
            for i in idxs:
                cur_t = _flat(cues[i - 1].get("target") or "")
                if cur_t != best and variants[cur_t] < variants[best]:
                    issues.append(_issue(cues[i - 1], i, "consistency", "warning", "Same line translated differently",
                                         f"“{cues[i - 1].get('source', '').strip()}” is translated another way in {variants[best]} other place(s). "
                                         "Using one wording keeps characters and catchphrases consistent.", best))
    for g in _glossary_pairs(glossary, target_lang):
        s_low = g["source"].lower()
        for n, cue in enumerate(cues, start=1):
            if re.search(r"(?<!\w)" + re.escape(s_low) + r"(?!\w)", (cue.get("source") or "").lower()) \
                    and g["target"].lower() not in (cue.get("target") or "").lower() and (cue.get("target") or "").strip():
                issues.append(_issue(cue, n, "terminology", "error", "Glossary term not used",
                                     f"“{g['source']}” must be translated as “{g['target']}”.", None))

    issues.sort(key=lambda i: (i["index"], 0 if i["severity"] == "error" else 1))
    return issues


def _dedupe_conflicting(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One text fix per cue: a later suggestion would be written against the text the first one already changed."""
    seen_fix = set()
    out = []
    for i in issues:
        if i.get("suggestion"):
            if i["index"] in seen_fix:
                i = {**i, "suggestion": None}
            else:
                seen_fix.add(i["index"])
        out.append(i)
    return out


def merge_qc(centroid: Optional[Dict[str, Any]], local: List[Dict[str, Any]], total_cues: int,
             centroid_error: Optional[str] = None) -> Dict[str, Any]:
    """Combine Centroid's response with local issues. Centroid issues come first (they are the linguistic ones),
    local issues whose (index, category) Centroid already reported are dropped. The summary is recomputed."""
    data: Dict[str, Any] = dict(centroid or {})
    ai_issues = list(data.get("issues") or [])
    for i in ai_issues:
        i.setdefault("origin", "ai")
    seen = {(i.get("index"), i.get("category")) for i in ai_issues}
    extra = [i for i in local if (i["index"], i["category"]) not in seen]
    issues = _dedupe_conflicting(ai_issues + extra)
    issues.sort(key=lambda i: (i.get("index") or 0, 0 if i.get("severity") == "error" else 1))
    errors = sum(1 for i in issues if i.get("severity") == "error")
    warnings = sum(1 for i in issues if i.get("severity") != "error")
    bad_cues = len({i.get("index") for i in issues})
    summary = dict(data.get("summary") or {})
    summary.update({
        "error_count": errors,
        "warning_count": warnings,
        "clean_percentage": round(100 * (total_cues - bad_cues) / total_cues, 1) if total_cues else 100,
        "local_issue_count": len(extra),
        "ai_checked": bool(summary.get("ai_checked", True)) and centroid is not None,
    })
    if "mqm_score" not in summary or centroid is None or extra:
        penalty = errors * 5 + warnings * 1
        words = max(total_cues * 8, 1)
        summary["mqm_score"] = max(0, round(100 - 100 * penalty / words, 1)) if centroid is None else min(
            summary.get("mqm_score", 100), max(0, round(100 - 100 * penalty / words, 1)))
    data["summary"] = summary
    data["issues"] = issues
    if centroid_error:
        data["centroid_error"] = centroid_error
    return data
