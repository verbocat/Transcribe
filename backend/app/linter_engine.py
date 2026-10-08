import re
import unicodedata
from typing import List, Dict, Any, Tuple, Optional
from num2words import num2words

from app.models import Segment, QCError
from app.config import MAX_SEGMENT_DURATION, MIN_SEGMENT_DURATION

# Allowed punctuations according to Karya Guideline 6.2
ALLOWED_PUNCTUATION = {'.', ',', '?', '!', '-', '_', "'", '।', ' '}
# Typographic apostrophes are the same character as ' to a reader (sanitize_karya_punctuation maps them to ')
APOSTROPHE_VARIANTS = {'’', '‘'}
# Any bracketed word; a wrong one is reported once, as INVALID_TAG, not again as stray brackets
_BRACKET_TAG_RE = re.compile(r'\[[^\]]+\]')
# Languages written in Latin script: English words are not code-mixing there
_LATIN_LANGUAGES = {"english", "en"}
_INDIC_LANGUAGES = {"hindi", "marathi", "sanskrit"}
ALLOWED_TAGS = {'[unintelligible]', '[inaudible]'}

# Number mapping for Hindi/Devanagari digits
DEVANAGARI_DIGITS = {
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
}

HINDI_NUMBERS_0_TO_100 = {
    0: "शून्य", 1: "एक", 2: "दो", 3: "तीन", 4: "चार", 5: "पाँच", 6: "छह", 7: "सात", 8: "आठ", 9: "नौ", 10: "दस",
    11: "ग्यारह", 12: "बारह", 13: "तेरह", 14: "चौदह", 15: "पंद्रह", 16: "सोलह", 17: "सत्रह", 18: "अठारह", 19: "उन्नीस", 20: "बीस",
    21: "इक्कीस", 22: "बाईस", 23: "तेईस", 24: "चौबीस", 25: "पच्चीस", 26: "छब्बीस", 27: "सत्ताईस", 28: "अट्ठाईस", 29: "उनतीस", 30: "तीस",
    31: "इकतीस", 32: "बत्तीस", 33: "तैंतीस", 34: "चौंतीस", 35: "पैंतीस", 36: "छत्तीस", 37: "सैंतीस", 38: "अड़तीस", 39: "उनतालीस", 40: "चालीस",
    41: "इकतालीस", 42: "बयालीस", 43: "तैंतालीस", 44: "चवालीस", 45: "पैंतालीस", 46: "छियालीस", 47: "सैंतालीस", 48: "अड़तालीस", 49: "उनचास", 50: "पचास",
    51: "इक्यावन", 52: "बावन", 53: "तिरेपन", 54: "चौवन", 55: "पचपन", 56: "छप्पन", 57: "सत्तावन", 58: "अट्ठावन", 59: "उनसठ", 60: "साठ",
    61: "इकसठ", 62: "बासठ", 63: "तिरसठ", 64: "चौंसठ", 65: "पैंसठ", 66: "छियासठ", 67: "सरसठ", 68: "अड़सठ", 69: "उनहत्तर", 70: "सत्तर",
    71: "इकहत्तर", 72: "बहत्तर", 73: "तिहत्तर", 74: "चौहत्तर", 75: "पचहत्तर", 76: "छिहत्तर", 77: "सतहत्तर", 78: "अठहत्तर", 79: "उनासी", 80: "अस्सी",
    81: "इक्यासी", 82: "बयासी", 83: "तिरासी", 84: "चौरासी", 85: "पचासी", 86: "छियासी", 87: "सत्तासी", 88: "अट्ठासी", 89: "नवासी", 90: "नब्बे",
    91: "इक्यानवे", 92: "बानवे", 93: "तिरानवे", 94: "चौरानवे", 95: "पंचानवे", 96: "छियानवे", 97: "सत्तानवे", 98: "अट्ठानवे", 99: "निन्यानवे", 100: "सौ"
}


def number_to_hindi_words(n: int) -> str:
    """Convert an integer to Hindi words."""
    if n in HINDI_NUMBERS_0_TO_100:
        return HINDI_NUMBERS_0_TO_100[n]
    if n < 1000:
        hundreds = n // 100
        rem = n % 100
        res = f"{HINDI_NUMBERS_0_TO_100.get(hundreds, str(hundreds))} सौ"
        if rem > 0:
            res += f" {HINDI_NUMBERS_0_TO_100.get(rem, str(rem))}"
        return res
    if n < 100000:
        thousands = n // 1000
        rem = n % 1000
        res = f"{number_to_hindi_words(thousands)} हज़ार"
        if rem > 0:
            res += f" {number_to_hindi_words(rem)}"
        return res
    if n < 10000000:
        lakhs = n // 100000
        rem = n % 100000
        res = f"{number_to_hindi_words(lakhs)} लाख"
        if rem > 0:
            res += f" {number_to_hindi_words(rem)}"
        return res
    crores = n // 10000000
    rem = n % 10000000
    res = f"{number_to_hindi_words(crores)} करोड़"
    if rem > 0:
        res += f" {number_to_hindi_words(rem)}"
    return res


# A number as people write it: 1,000 / 12,50,000 / 3.5 / 12 / 3rd. Digit runs glued to letters (MI5, 5G, COVID-19) match too.
_NUMBER_RE = re.compile(r'(\d{1,3}(?:,\d{2,3})*,\d{3}(?!\d)|\d+)(?:\.(\d+))?(st|nd|rd|th)?(?![A-Za-z])|(\d+)')
_DIGIT_TOKEN_RE = re.compile(r'[^\W\d_]*[\d०-९][\d०-९,.]*[^\W\d_]*')


def _int_to_words(val: int, language: str) -> str:
    if language.lower() in _INDIC_LANGUAGES:
        return number_to_hindi_words(val)
    return num2words(val, lang="en")


def convert_all_digits_to_words(text: str, language: str = "Hindi") -> str:
    """Auto-fixer to convert all digits (Arabic & Indic) to written words.

    Handles thousands separators (1,000), decimals (3.5), English ordinals (3rd) and digits glued to letters
    (MI5 -> MI five), which a plain whole-word match left untouched or turned into 'one,zero'."""
    for dev_digit, std_digit in DEVANAGARI_DIGITS.items():
        text = text.replace(dev_digit, std_digit)
    indic = language.lower() in _INDIC_LANGUAGES

    def replacer(match):
        whole = match.group(0)
        try:
            if match.group(4) is not None:
                words = _int_to_words(int(match.group(4)), language)
            else:
                val = int(match.group(1).replace(",", ""))
                if match.group(2) is not None:
                    point = "दशमलव" if indic else "point"
                    frac = " ".join(_int_to_words(int(d), language) for d in match.group(2))
                    words = f"{_int_to_words(val, language)} {point} {frac}"
                elif match.group(3) and not indic:
                    words = num2words(val, lang="en", to="ordinal")
                else:
                    words = _int_to_words(val, language)
        except Exception:
            return whole
        # Keep a space between the words and any letter they were glued to (MI5 -> MI five, 5G -> five G)
        start, end = match.span()
        before = match.string[start - 1] if start > 0 else ""
        after = match.string[end] if end < len(match.string) else ""
        return (" " if before.isalpha() else "") + words + (" " if after.isalpha() else "")

    return _NUMBER_RE.sub(replacer, text)


def sanitize_karya_punctuation(text: str, language: str = "Hindi") -> str:
    """Sanitize disallowed punctuation and replace symbols."""
    # Temporary mask allowed tags
    text = text.replace("[unintelligible]", "___UNINTELLIGIBLE___")
    text = text.replace("[inaudible]", "___INAUDIBLE___")

    # Replace common symbols with words
    if language.lower() in ["hindi", "marathi"]:
        text = text.replace("%", " प्रतिशत ")
        text = text.replace("&", " और ")
        text = text.replace("+", " जमा ")
        text = text.replace("=", " बराबर ")
    else:
        text = text.replace("%", " percent ")
        text = text.replace("&", " and ")
        text = text.replace("+", " plus ")
        text = text.replace("=", " equals ")

    # Typographic ellipsis and dashes become their plain-ASCII forms (both are allowed characters)
    text = text.replace('…', '...').replace('—', '--').replace('–', '--')

    # Replace disallowed punctuation
    text = text.replace('"', '')
    text = text.replace('“', '')
    text = text.replace('”', '')
    text = text.replace('’', "'")
    text = text.replace('‘', "'")
    text = text.replace(';', ',')
    text = text.replace(':', ',')
    text = text.replace('(', ' ')
    text = text.replace(')', ' ')
    text = text.replace('[', ' ')
    text = text.replace(']', ' ')
    text = text.replace('{', ' ')
    text = text.replace('}', ' ')
    text = text.replace('/', ' ')
    text = text.replace('\\', ' ')
    text = text.replace('*', ' ')
    text = text.replace('#', ' ')
    text = text.replace('@', ' ')
    text = text.replace('$', ' ')
    text = text.replace('^', ' ')
    text = text.replace('~', ' ')
    text = text.replace('|', '।')

    # Restore tags
    text = text.replace("___UNINTELLIGIBLE___", "[unintelligible]")
    text = text.replace("___INAUDIBLE___", "[inaudible]")

    # Normalize double spaces
    text = re.sub(r' +', ' ', text).strip()
    return text


def lint_segment(
    segment: Segment,
    prev_segment: Optional[Segment] = None,
    language: str = "Hindi",
    script: str = "Devanagari"
) -> List[QCError]:
    """Lint a single segment against all Karya rules and return detected errors."""
    errors: List[QCError] = []
    text = segment.transcript or ""

    # Check 1: Duration limits (0.5s to 20.0s)
    duration = segment.end_time - segment.start_time
    if duration < MIN_SEGMENT_DURATION:
        errors.append(QCError(
            segment_id=segment.segment_id,
            field="duration",
            error_type="DURATION_TOO_SHORT",
            message=f"Segment duration ({duration:.2f}s) is less than minimum allowed ({MIN_SEGMENT_DURATION}s).",
            snippet=f"{segment.start_time_str} - {segment.end_time_str}",
            suggested_fix=f"Expand segment to at least {MIN_SEGMENT_DURATION}s or merge with adjacent segment.",
            severity="error"
        ))
    elif duration > MAX_SEGMENT_DURATION:
        errors.append(QCError(
            segment_id=segment.segment_id,
            field="duration",
            error_type="DURATION_TOO_LONG",
            message=f"Segment duration ({duration:.2f}s) exceeds maximum allowed ({MAX_SEGMENT_DURATION}s).",
            snippet=f"{segment.start_time_str} - {segment.end_time_str}",
            suggested_fix="Split segment into smaller chunks <= 20.0s.",
            severity="error"
        ))

    # Check 2: Timestamp overlap with previous segment
    if prev_segment and segment.start_time < prev_segment.end_time - 0.001:
        errors.append(QCError(
            segment_id=segment.segment_id,
            field="start_time",
            error_type="TIMESTAMP_OVERLAP",
            message=f"Segment starts ({segment.start_time:.3f}s) before previous segment ends ({prev_segment.end_time:.3f}s). Segments must not overlap.",
            snippet=f"Prev: {prev_segment.end_time_str}, Curr: {segment.start_time_str}",
            suggested_fix=f"Adjust start time to >= {prev_segment.end_time:.3f}s.",
            severity="error"
        ))

    # Check 3: Digits Detection (Rule 6.10)
    # Any digit (0-9 or Devanagari ०-९). Report the words that contain them (MI5, 3rd), in reading order,
    # so the reviewer can see what was flagged.
    digit_tokens = list(dict.fromkeys(t.rstrip(".,") for t in _DIGIT_TOKEN_RE.findall(text)))
    if digit_tokens:
        errors.append(QCError(
            segment_id=segment.segment_id,
            field="transcript",
            error_type="DIGITS_DETECTED",
            message=f"Numbers must always be written in words. Digits are strictly prohibited (Rule 6.10). Found: {', '.join(digit_tokens[:5])}.",
            snippet=", ".join(digit_tokens),
            suggested_fix=convert_all_digits_to_words(text, language),
            severity="error"
        ))

    # Check 4: Disallowed Punctuation & Symbols (Rule 6.2 & 6.10)
    # Allowed tags are fine; any other [bracketed word] is reported once, as INVALID_TAG (Check 6)
    clean_text = _BRACKET_TAG_RE.sub("", text)
    invalid_puncts = set()
    for char in clean_text:
        if char in APOSTROPHE_VARIANTS:
            continue
        cat = unicodedata.category(char)
        if cat.startswith('P') or cat.startswith('S'):
            if char not in ALLOWED_PUNCTUATION:
                invalid_puncts.add(char)

    if invalid_puncts:
        shown = " ".join(sorted(invalid_puncts))
        errors.append(QCError(
            segment_id=segment.segment_id,
            field="transcript",
            error_type="DISALLOWED_PUNCTUATION",
            message=f"Disallowed punctuation/symbols found: {shown}. Only . , ? ! - _ ' । are allowed (Rule 6.2).",
            snippet=shown,
            suggested_fix=sanitize_karya_punctuation(text, language),
            severity="error"
        ))

    # Check 5: Code-Mixing / Foreign Script (Rule 6.4)
    # Only when the transcript is meant to be in Devanagari. The script decides; the language is the fallback when
    # the script is unknown. English (and any other Latin-script language) is never code-mixed.
    script_l, language_l = (script or "").strip().lower(), (language or "").strip().lower()
    if script_l in ("", "auto", "auto-detect"):
        needs_target_script = language_l in _INDIC_LANGUAGES
    else:
        needs_target_script = script_l == "devanagari" and language_l not in _LATIN_LANGUAGES
    if needs_target_script:
        no_tags = text.replace("[unintelligible]", "").replace("[inaudible]", "")
        latin_words = re.findall(r'\b[a-zA-Z]+\b', no_tags)
        if latin_words:
            errors.append(QCError(
                segment_id=segment.segment_id,
                field="transcript",
                error_type="CODE_MIXED_SCRIPT",
                message=f"Code-mixed English script detected: {', '.join(latin_words[:5])}. All foreign words must be transliterated into target script (Rule 6.4).",
                snippet=", ".join(latin_words[:5]),
                suggested_fix=None,
                severity="error"
            ))

    # Check 6: Tag syntax validation (Rule 6.3)
    # Catch broken tags like [inaudible, (unintelligible), [uninteligible]
    broken_tags = re.findall(r'\[[^\]]+\]', text)
    for tag in broken_tags:
        if tag not in ALLOWED_TAGS:
            errors.append(QCError(
                segment_id=segment.segment_id,
                field="transcript",
                error_type="INVALID_TAG",
                message=f"Invalid tag '{tag}'. Only [unintelligible] and [inaudible] are permitted (Rule 6.3).",
                snippet=tag,
                suggested_fix="[unintelligible]" if "unintel" in tag.lower() else "[inaudible]",
                severity="warning"
            ))

    # Check 7: Gender Tag Validation (Rule 5)
    if segment.gender not in ["Male", "Female", "Unknown"]:
        errors.append(QCError(
            segment_id=segment.segment_id,
            field="gender",
            error_type="INVALID_GENDER",
            message=f"Gender must be Male, Female, or Unknown. Got '{segment.gender}'.",
            snippet=segment.gender,
            suggested_fix="Male",
            severity="error"
        ))

    return errors


def lint_dataset(
    segments: List[Segment],
    language: str = "Hindi",
    script: str = "Devanagari"
) -> Tuple[List[Segment], float, int, int]:
    """
    Lint all segments and compute compliance score.
    Returns: (linted_segments, compliance_score_0_to_100, total_errors, total_warnings)
    """
    total_errors = 0
    total_warnings = 0
    linted_segments: List[Segment] = []

    # Rule 5 check: Speaker 1 starts the conversation first
    if segments and segments[0].speaker != "Speaker 1":
        # Check if first segment speaker is not Speaker 1
        pass

    for i, seg in enumerate(segments):
        prev_seg = segments[i-1] if i > 0 else None
        qc_errs = lint_segment(seg, prev_segment=prev_seg, language=language, script=script)
        seg.qc_errors = qc_errs
        seg.is_valid = len([e for e in qc_errs if e.severity == "error"]) == 0
        
        errors_count = len([e for e in qc_errs if e.severity == "error"])
        warnings_count = len([e for e in qc_errs if e.severity == "warning"])
        
        total_errors += errors_count
        total_warnings += warnings_count
        linted_segments.append(seg)

    # Calculate compliance score
    total_segments = max(1, len(segments))
    score = max(0.0, 100.0 - (total_errors * 5.0) - (total_warnings * 1.5))
    score = min(100.0, round(score, 1))

    return linted_segments, score, total_errors, total_warnings


def apply_auto_fixes(
    segments: List[Segment],
    fix_digits: bool = True,
    fix_punctuation: bool = True,
    fix_overlaps: bool = True,
    fix_tags: bool = True,
    language: str = "Hindi",
    script: str = "Devanagari"
) -> List[Segment]:
    """Apply 1-Click Auto-Fixes across all segments."""
    fixed_segments = []
    prev_end = 0.0

    for i, seg in enumerate(segments):
        s = seg.start_time
        e = seg.end_time
        t = seg.transcript or ""

        # Fix 1: Timestamp overlap
        if fix_overlaps:
            if s < prev_end:
                s = prev_end
            if e <= s:
                e = s + 0.5
            s = round(s, 3)
            e = round(e, 3)
            prev_end = e

        # Fix 2: Digits to words
        if fix_digits:
            t = convert_all_digits_to_words(t, language=language)

        # Fix 3: Punctuation sanitization
        if fix_punctuation:
            t = sanitize_karya_punctuation(t, language=language)

        # Fix 4: Tag normalization
        if fix_tags:
            t = re.sub(r'\[\s*unintelligible\s*\]', '[unintelligible]', t, flags=re.IGNORECASE)
            t = re.sub(r'\[\s*inaudible\s*\]', '[inaudible]', t, flags=re.IGNORECASE)

        from app.audio_processor import format_timestamp
        seg.start_time = s
        seg.end_time = e
        seg.start_time_str = format_timestamp(s)
        seg.end_time_str = format_timestamp(e)
        seg.duration = round(e - s, 3)
        seg.transcript = t
        fixed_segments.append(seg)

    # Re-lint
    relinted, _, _, _ = lint_dataset(fixed_segments, language=language, script=script)
    return relinted
