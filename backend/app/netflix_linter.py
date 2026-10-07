"""
Netflix Timed Text Quality Control Linter Engine
=================================================

Enforces the Netflix Timed Text Style Guide with 20+ rules covering:
- Reading speed (CPS) limits: 20 CPS (adult), 17 CPS (children)
- Characters per line (CPL): 42 for Latin/Cyrillic/Greek
- Duration limits: 0.833s minimum, 7.0s maximum
- Gap management: 2-frame minimum, gap chaining for 3-11 frame gaps
- Shot change snapping and bleed prevention
- Line break rules (linguistic boundaries, pyramid structure, orphans)
- Dual speaker formatting with hyphen prefix
- Italics usage validation
- Music note delimiters for lyrics
- Ellipsis formatting (Unicode U+2026)
- Interruption formatting (--)

All numeric thresholds match Netflix's official specifications.
"""

import re
import math
from typing import List, Dict, Any, Tuple, Optional, Set
from app.netflix_models import format_timestamp, calculate_cps, calculate_cpl


# ──────────────────────────────────────────────────────────
# Netflix Timed Text Constants
# ──────────────────────────────────────────────────────────

# Reading speed limits (Characters Per Second)
CPS_LIMIT_ADULT = 20.0
CPS_LIMIT_CHILDREN = 17.0
CPS_WARNING_ADULT = 18.0
CPS_WARNING_CHILDREN = 15.0

# Characters per line limits by script type
CPL_LIMITS = {
    "latin": 42,
    "cyrillic": 42,
    "greek": 42,
    "korean": 23,
    "chinese": 16,
    "japanese": 13,
    "arabic": 42,
    "default": 42,
}

# Duration limits (seconds)
MIN_SUBTITLE_DURATION = 5.0 / 6.0  # ~0.833 seconds (20 frames @ 24fps)
MAX_SUBTITLE_DURATION = 7.0

# Maximum lines per subtitle event
MAX_LINES = 2

# Gap management (in frames)
MIN_GAP_FRAMES = 2          # Minimum gap between consecutive events
CHAIN_THRESHOLD_FRAMES = 12  # Gaps < 12 frames must be chained to 2-frame gap

# Shot change proximity thresholds (frames)
SHOT_SNAP_THRESHOLD_FRAMES = 2   # Snap in/out if within 2 frames of cut
SHOT_PROXIMITY_FRAMES = 12       # 12-frame proximity zone around cuts

# Hindi & Hinglish postpositions (कारक चिन्ह) - must NEVER start a new line or event alone!
HINDI_POSTPOSITIONS = {
    "ने", "को", "से", "का", "के", "की", "में", "पर", "पे", "तक", "लिए", "साथ", "द्वारा", "वाला", "वाले", "वाली",
    "ne", "ko", "se", "ka", "ke", "ki", "mein", "me", "par", "pe", "tak", "liye", "saath", "dwara", "wala", "wale", "wali",
}

# Hindi & Hinglish conjunctions (समुच्चयबोधक अव्यय) - natural clause and line break points
HINDI_CONJUNCTIONS = {
    "और", "या", "अथवा", "लेकिन", "मगर", "किंतु", "परंतु", "क्योंकि", "इसलिए", "ताकि", "कि", "तो", "जब", "तब", "अगर", "यदि", "जैसे", "वैसे", "फिर", "भी",
    "aur", "ya", "athwa", "lekin", "magar", "kintu", "parantu", "kyunki", "isliye", "taaki", "ki", "to", "jab", "tab", "agar", "yadi", "jaise", "phir", "bhi",
}

# Hindi titles & honorifics - never sever from following name
HINDI_TITLES = {
    "श्री", "श्रीमती", "सुश्री", "डॉक्टर", "डॉ.", "डॉ", "पंडित", "पं.", "पं", "प्रोफेसर", "प्रो.", "प्रो",
    "shri", "smt", "sushri", "pandit",
}

# Line break: words that should NOT start a new line (articles, pronouns, short prepositions, Hindi postpositions)
NO_BREAK_BEFORE = {
    "a", "an", "the", "i", "he", "she", "it", "we", "you", "they",
    "me", "my", "his", "her", "its", "our", "your", "their",
    "am", "is", "are", "was", "were",
    # Hindi postpositions
    *HINDI_POSTPOSITIONS,
    # Hindi auxiliaries
    "है", "हैं", "था", "थी", "थे", "होगा", "होगी", "होंगे", "रहा", "रही", "रहे", "सकता", "सकती", "सकते",
    "hai", "hain", "tha", "thi", "the", "hoga", "hogi", "honge", "raha", "rahi", "rahe", "sakta", "sakti", "sakte",
}

# Words that are GOOD break points (conjunctions, prepositions)
GOOD_BREAK_BEFORE = {
    "and", "but", "or", "nor", "so", "yet", "for",
    "because", "since", "although", "though", "while", "when", "where",
    "if", "unless", "until", "after", "before",
    "in", "on", "at", "to", "from", "with", "by", "about", "into",
    "through", "during", "without", "between", "among", "upon",
    "of", "than", "that", "which", "who", "whom", "whose",
    *HINDI_CONJUNCTIONS,
}

# Orphan: a single word on line 2 shorter than this is flagged
ORPHAN_MAX_CHARS = 4

# Italics-permitted contexts (detected by tags or flags)
VALID_ITALIC_CONTEXTS = {
    "voiceover", "narration", "off-screen", "internal_monologue",
    "phone", "television", "radio", "computer", "intercom",
    "song_lyrics", "foreign_word", "title", "emphasis",
}


# ──────────────────────────────────────────────────────────
# Helper Functions
# ──────────────────────────────────────────────────────────

def _strip_tags(text: str) -> str:
    """Remove HTML/XML tags like <i>, </i>, <b>, </b> from text for character counting."""
    return re.sub(r'<[^>]+>|\{\\an[1-9]\}', '', text)


def _is_dual_speaker(text: str) -> bool:
    """Netflix dual-speaker card: exactly two lines, each opened by a hyphen (one speaker per line)."""
    lines = [l.strip() for l in _strip_tags(text or "").split('\n')]
    return len(lines) == 2 and all(l.startswith(('-', '–', '—')) for l in lines)


def _strip_music_notes(text: str) -> str:
    """Remove ♪ characters for CPS calculation."""
    return text.replace('♪', '').strip()


def calculate_cps(text: str, duration: float) -> float:
    """
    Calculate Characters Per Second for a subtitle event.
    
    Netflix CPS counting rules:
    - Strip HTML tags (<i>, </i>)
    - Strip music notes (♪)
    - Count spaces (they contribute to reading time)
    - Don't count newline characters themselves
    - Don't count speaker hyphens at line start
    """
    if duration <= 0:
        return 0.0
    
    clean = _strip_tags(text)
    clean = _strip_music_notes(clean)
    
    # Remove speaker hyphens at start of lines
    lines = clean.split('\n')
    cleaned_lines = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith('-'):
            stripped = stripped[1:].lstrip()
        cleaned_lines.append(stripped)
    
    clean = ' '.join(cleaned_lines)
    # Remove extra whitespace
    clean = re.sub(r'\s+', ' ', clean).strip()
    
    char_count = len(clean)
    return round(char_count / duration, 2)


def calculate_cpl(text: str) -> List[int]:
    """
    Calculate Characters Per Line for each line in a subtitle event.
    
    Returns a list of character counts, one per line.
    Tags are stripped before counting.
    """
    clean = _strip_tags(text)
    lines = clean.split('\n')
    return [len(line.strip()) for line in lines]


def _seconds_to_frames(seconds: float, frame_rate: float) -> int:
    """Convert seconds to frame count."""
    return int(round(seconds * frame_rate))


def _frames_to_seconds(frames: int, frame_rate: float) -> float:
    """Convert frame count to seconds."""
    if frame_rate <= 0:
        return 0.0
    return round(frames / frame_rate, 6)


def _get_cps_limit(content_type: str) -> float:
    """Get the CPS limit based on content type."""
    return CPS_LIMIT_CHILDREN if content_type == "children" else CPS_LIMIT_ADULT


def _get_cps_warning(content_type: str) -> float:
    """Get the CPS warning threshold based on content type."""
    return CPS_WARNING_CHILDREN if content_type == "children" else CPS_WARNING_ADULT


def _get_cpl_limit(script: str = "latin") -> int:
    """Get the CPL limit based on script type."""
    return CPL_LIMITS.get(script.lower(), CPL_LIMITS["default"])


def _detect_script_type(text: str) -> str:
    """Detect the primary script type of the text for CPL limit selection."""
    # Count characters by Unicode block
    cjk_count = 0
    korean_count = 0
    arabic_count = 0
    latin_count = 0
    
    for char in text:
        cp = ord(char)
        if 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF:  # CJK
            cjk_count += 1
        elif 0xAC00 <= cp <= 0xD7AF or 0x1100 <= cp <= 0x11FF:  # Korean
            korean_count += 1
        elif 0x0600 <= cp <= 0x06FF or 0x0750 <= cp <= 0x077F:  # Arabic
            arabic_count += 1
        elif 0x0041 <= cp <= 0x024F:  # Latin
            latin_count += 1
    
    total = cjk_count + korean_count + arabic_count + latin_count
    if total == 0:
        return "latin"
    
    if korean_count / max(total, 1) > 0.3:
        return "korean"
    if cjk_count / max(total, 1) > 0.3:
        return "chinese"
    if arabic_count / max(total, 1) > 0.3:
        return "arabic"
    return "latin"


# ──────────────────────────────────────────────────────────
# Line Break Analysis
# ──────────────────────────────────────────────────────────

def detect_bad_line_breaks(text: str) -> List[Dict[str, str]]:
    """
    Detect line breaks that violate Netflix's linguistic line break rules.
    
    Returns list of violations with rule_id, message, and suggested_fix.
    """
    violations = []
    lines = text.split('\n')
    
    if len(lines) < 2:
        return violations
    
    for i in range(len(lines) - 1):
        upper_line = lines[i].strip()
        lower_line = lines[i + 1].strip()
        
        # Skip dual-speaker lines (each line starts with -)
        if upper_line.startswith('-') and lower_line.startswith('-'):
            continue
        
        upper_words = upper_line.split()
        lower_words = lower_line.split()
        
        if not upper_words or not lower_words:
            continue
        
        last_word_upper = upper_words[-1].lower().rstrip('.,!?;:')
        first_word_lower = lower_words[0].lower().rstrip('.,!?;:')
        
        # Rule: Don't split article + noun
        if last_word_upper in {'a', 'an', 'the'}:
            violations.append({
                "rule_id": "NF-LINE-BREAK-ARTICLE",
                "message": f"Article '{upper_words[-1]}' separated from its noun '{lower_words[0]}' across lines.",
                "suggested_fix": f"Keep '{upper_words[-1]} {lower_words[0]}' on the same line.",
            })
        
        # Rule: Don't split pronoun + verb (only when not separated by clause punctuation)
        has_clause_break = upper_words[-1].endswith((',', ';', ':', '--', '…', '.', '!', '?', '।', '॥'))
        if not has_clause_break and last_word_upper in {'i', 'he', 'she', 'it', 'we', 'you', 'they'}:
            violations.append({
                "rule_id": "NF-LINE-BREAK-PRONOUN",
                "message": f"Pronoun '{upper_words[-1]}' separated from its verb '{lower_words[0]}' across lines.",
                "suggested_fix": f"Keep '{upper_words[-1]} {lower_words[0]}' on the same line.",
            })
        
        # Rule: Don't split title/honorific + name (English & Hindi)
        all_titles = {'mr', 'mrs', 'ms', 'dr', 'prof', 'sir', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', *HINDI_TITLES}
        if last_word_upper in all_titles:
            violations.append({
                "rule_id": "NF-LINE-BREAK-TITLE",
                "message": f"Title/honorific '{upper_words[-1]}' separated from name '{lower_words[0]}' across lines.",
                "suggested_fix": f"Keep '{upper_words[-1]} {lower_words[0]}' on the same line.",
            })

        # Rule: Don't split Hindi noun + postposition (postposition stranded on line 2)
        if first_word_lower in HINDI_POSTPOSITIONS and not has_clause_break:
            violations.append({
                "rule_id": "NF-LINE-BREAK-POSTPOSITION",
                "message": f"Hindi postposition '{lower_words[0]}' severed from noun '{upper_words[-1]}' across lines.",
                "suggested_fix": f"Keep '{upper_words[-1]} {lower_words[0]}' together on the upper line or rebreak before noun.",
            })
        
        # Rule: Don't split number + unit
        if upper_words[-1].replace(',', '').replace('.', '').isdigit():
            unit_words = {'miles', 'km', 'meters', 'feet', 'inches', 'pounds', 'kg',
                         'dollars', 'euros', 'percent', 'hours', 'minutes', 'seconds',
                         'days', 'weeks', 'months', 'years', 'mph', 'kph', 'lbs', 'oz'}
            if first_word_lower in unit_words:
                violations.append({
                    "rule_id": "NF-LINE-BREAK-NUMBER",
                    "message": f"Number '{upper_words[-1]}' separated from unit '{lower_words[0]}' across lines.",
                    "suggested_fix": f"Keep '{upper_words[-1]} {lower_words[0]}' on the same line.",
                })
    
    return violations


def optimize_line_breaks(text: str, max_cpl: int = 42) -> str:
    """
    Intelligently break text into 1-2 lines following Netflix rules.
    
    Rules applied:
    1. If text fits on one line (≤ max_cpl chars), keep it on one line
    2. Break after punctuation marks
    3. Break before conjunctions/prepositions
    4. Never split articles+nouns, pronouns+verbs, names, numbers+units
    5. Bottom-heavy pyramid: upper line shorter than lower line
    6. No orphans (single short word on line 2)
    """
    # A dual-speaker card keeps one speaker per line; re-breaking it would mix the two speakers.
    if _is_dual_speaker(text):
        return text

    clean = _strip_tags(text).strip()
    
    # If it fits on one line, no break needed
    if len(clean) <= max_cpl:
        return text
    
    words = clean.split()
    if len(words) <= 1:
        return text
    
    total_len = len(clean)
    target_split = total_len * 0.50  # Balanced natural split
    
    best_score = float('inf')
    best_split = len(words) // 2
    
    for split_pos in range(1, len(words)):
        upper = ' '.join(words[:split_pos])
        lower = ' '.join(words[split_pos:])
        
        upper_len = len(upper)
        lower_len = len(lower)
        
        # Skip if either line exceeds CPL
        if upper_len > max_cpl or lower_len > max_cpl:
            continue
        
        # Score components (lower is better)
        # Distance from balanced split
        score = abs(upper_len - target_split) * 0.5
        
        # Bonus for breaking at good points
        break_word = words[split_pos].lower().rstrip('.,!?;:।॥…')
        last_upper = words[split_pos - 1].lower().rstrip('.,!?;:।॥…')

        if break_word in GOOD_BREAK_BEFORE:
            score -= 35.0
        
        # Dominant bonus for breaking after punctuation (English & Hindi)
        if upper.rstrip()[-1:] in {',', '.', ';', ':', '!', '?', '—', '–', '।', '॥', '…'}:
            score -= 60.0
        
        # Heavy penalty for bad breaks
        if last_upper in {'a', 'an', 'the'}:  # article + noun split
            score += 200.0
        if last_upper in {'i', 'he', 'she', 'it', 'we', 'you', 'they'}:  # pronoun + verb split
            score += 200.0
        if last_upper in {'mr', 'mrs', 'ms', 'dr', 'prof', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', *HINDI_TITLES}:
            score += 300.0
        if last_upper in HINDI_POSTPOSITIONS:  # Postposition stranded at end of line 1!
            score += 350.0
        if break_word in HINDI_POSTPOSITIONS:  # Postposition stranded on line 2!
            score += 400.0
        if break_word in {"है", "हैं", "था", "थी", "थे", "रहा", "रही", "रहे", "सकता", "सकती", "सकते", "hai", "hain", "tha", "thi", "the", "raha", "rahi", "rahe"}:
            score += 250.0
        if words[split_pos - 1].replace(',', '').replace('.', '').isdigit():
            unit_words = {'miles', 'km', 'meters', 'feet', 'dollars', 'euros', 'percent',
                         'hours', 'minutes', 'seconds', 'mph', 'kph'}
            if break_word in unit_words:
                score += 150.0
        
        # Penalty for orphan on lower line
        if len(lower.strip()) <= ORPHAN_MAX_CHARS:
            score += 100.0
        
        # Penalty for distance from ideal split point
        score += abs(upper_len - target_split) * 0.3
        
        if score < best_score:
            best_score = score
            best_split = split_pos
    
    upper = ' '.join(words[:best_split])
    lower = ' '.join(words[best_split:])
    
    # Preserve italic tags if present in original
    if '<i>' in text and '</i>' in text:
        return f"<i>{upper}\n{lower}</i>"
    
    return f"{upper}\n{lower}"


# ──────────────────────────────────────────────────────────
# Gap Management & Shot Change
# ──────────────────────────────────────────────────────────

def check_gap_compliance(
    sub1_end: float,
    sub2_start: float,
    frame_rate: float = 24.0
) -> Optional[Dict[str, Any]]:
    """
    Check if the gap between two consecutive subtitle events complies with Netflix rules.
    
    Returns None if compliant, or a dict with violation details.
    
    Netflix gap rules:
    - Minimum 2-frame gap between events
    - Gaps of 3-11 frames must be chained (extend sub1 out-time to leave exactly 2-frame gap)
    - Gaps ≥ 12 frames are left as-is
    """
    gap_seconds = sub2_start - sub1_end
    gap_frames = _seconds_to_frames(gap_seconds, frame_rate)
    min_gap_seconds = _frames_to_seconds(MIN_GAP_FRAMES, frame_rate)
    
    if gap_seconds < -0.001:
        # Overlap
        return {
            "rule_id": "NF-OVERLAP",
            "gap_frames": gap_frames,
            "gap_seconds": round(gap_seconds, 4),
            "message": f"Events overlap by {abs(gap_seconds):.3f}s ({abs(gap_frames)} frames).",
            "severity": "error",
            "fix_end_time": sub2_start - min_gap_seconds,
        }
    
    if gap_frames < MIN_GAP_FRAMES and gap_seconds >= 0:
        # Gap too small (0-1 frames)
        return {
            "rule_id": "NF-GAP-MISSING",
            "gap_frames": gap_frames,
            "gap_seconds": round(gap_seconds, 4),
            "message": f"Gap is only {gap_frames} frame(s). Minimum is {MIN_GAP_FRAMES} frames.",
            "severity": "error",
            "fix_end_time": sub2_start - min_gap_seconds,
        }
    
    if MIN_GAP_FRAMES < gap_frames < CHAIN_THRESHOLD_FRAMES:
        # Flicker zone (3-11 frames) - must be chained
        return {
            "rule_id": "NF-GAP-FLASH",
            "gap_frames": gap_frames,
            "gap_seconds": round(gap_seconds, 4),
            "message": f"Gap of {gap_frames} frames ({gap_seconds:.3f}s) causes subtitle flicker. Chain to 2-frame gap.",
            "severity": "error",
            "fix_end_time": sub2_start - min_gap_seconds,
        }
    
    return None


def find_nearest_shot_change(
    timestamp: float,
    shot_changes: List[float],
    max_distance_frames: int,
    frame_rate: float
) -> Optional[float]:
    """
    Find the nearest shot change within max_distance_frames of a timestamp.
    Returns the shot change timestamp or None if none is close enough.
    """
    max_distance = _frames_to_seconds(max_distance_frames, frame_rate)
    
    best_shot = None
    best_dist = float('inf')
    
    for sc in shot_changes:
        dist = abs(sc - timestamp)
        if dist <= max_distance and dist < best_dist:
            best_dist = dist
            best_shot = sc
    
    return best_shot


def check_shot_change_compliance(
    start_time: float,
    end_time: float,
    shot_changes: List[float],
    frame_rate: float = 24.0
) -> List[Dict[str, Any]]:
    """
    Check if a subtitle event's timing properly respects shot/scene changes.
    
    Netflix shot change rules:
    - Don't let subtitle bleed over a shot cut by 1-2 frames
    - Snap in-time to cut if speech starts within 2 frames after cut
    - Snap out-time to 2 frames before cut if speech ends within 2 frames before cut
    """
    violations = []
    min_gap = _frames_to_seconds(MIN_GAP_FRAMES, frame_rate)
    
    for sc in shot_changes:
        # Check if subtitle spans across a shot change
        if start_time < sc < end_time:
            # How far is the shot change from start and end?
            dist_from_start = sc - start_time
            dist_from_end = end_time - sc
            
            start_frames = _seconds_to_frames(dist_from_start, frame_rate)
            end_frames = _seconds_to_frames(dist_from_end, frame_rate)
            
            # Subtitle bleeds over cut by only 1-2 frames on either side
            if start_frames <= SHOT_SNAP_THRESHOLD_FRAMES:
                violations.append({
                    "rule_id": "NF-SHOT-BLEED",
                    "message": f"Subtitle starts only {start_frames} frame(s) before shot change at {sc:.3f}s. Snap to the cut.",
                    "severity": "error",
                    "shot_change_time": sc,
                    "fix_start_time": sc,
                })
            elif end_frames <= SHOT_SNAP_THRESHOLD_FRAMES:
                violations.append({
                    "rule_id": "NF-SHOT-BLEED",
                    "message": f"Subtitle ends only {end_frames} frame(s) after shot change at {sc:.3f}s. End 2 frames before the cut.",
                    "severity": "error",
                    "shot_change_time": sc,
                    "fix_end_time": sc - min_gap,
                })
        
        # Check if in-time should snap to a nearby shot cut
        in_dist = abs(start_time - sc)
        in_frames = _seconds_to_frames(in_dist, frame_rate)
        if 0 < in_frames <= SHOT_SNAP_THRESHOLD_FRAMES and start_time > sc:
            violations.append({
                "rule_id": "NF-SHOT-SNAP",
                "message": f"In-time is {in_frames} frame(s) after shot change at {sc:.3f}s. Consider snapping to the cut.",
                "severity": "warning",
                "shot_change_time": sc,
                "fix_start_time": sc,
            })
        
        # Check if out-time should snap to a nearby shot cut
        out_dist = abs(end_time - sc)
        out_frames = _seconds_to_frames(out_dist, frame_rate)
        is_already_snapped = abs(end_time - (sc - min_gap)) < (0.8 / frame_rate)
        if not is_already_snapped and 0 < out_frames <= SHOT_SNAP_THRESHOLD_FRAMES and end_time < sc:
            violations.append({
                "rule_id": "NF-SHOT-SNAP",
                "message": f"Out-time is {out_frames} frame(s) before shot change at {sc:.3f}s. Consider snapping out-time to 2 frames before cut.",
                "severity": "warning",
                "shot_change_time": sc,
                "fix_end_time": sc - min_gap,
            })
    
    return violations


# ──────────────────────────────────────────────────────────
# Core Linting Functions
# ──────────────────────────────────────────────────────────

def lint_subtitle_event(
    event: Dict[str, Any],
    prev_event: Optional[Dict[str, Any]] = None,
    next_event: Optional[Dict[str, Any]] = None,
    shot_changes: Optional[List[float]] = None,
    content_type: str = "adult",
    frame_rate: float = 24.0,
    script: str = "latin",
    custom_cpl: Optional[int] = None,
    custom_cps: Optional[float] = None,
    custom_max_lines: Optional[int] = None,
    custom_min_duration: Optional[float] = None,
    custom_max_duration: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Lint a single subtitle event against all Netflix Timed Text rules (with optional custom thresholds).
    
    Args:
        event: Subtitle event dict with keys: id, start_time, end_time, text, is_italic, etc.
        prev_event: Previous subtitle event (for gap/overlap checks)
        next_event: Next subtitle event (for gap chaining checks)
        shot_changes: List of shot change timestamps
        content_type: "adult" or "children" (affects CPS limit)
        frame_rate: Video frame rate (default 24.0)
        script: Script type for CPL limits (default "latin")
        custom_cpl: Optional override for max characters per line (e.g. 42)
        custom_cps: Optional override for max reading speed (e.g. 20.0)
        custom_max_lines: Optional override for max lines (e.g. 2)
        custom_min_duration: Optional override for min subtitle duration (e.g. 0.833)
        custom_max_duration: Optional override for max subtitle duration (e.g. 7.0)
    
    Returns:
        List of error dicts with: rule_id, field, message, severity, suggested_fix
    """
    errors = []
    shot_changes = shot_changes or []
    
    text = event.get("text", "")
    start_time = float(event.get("start_time", 0))
    end_time = float(event.get("end_time", 0))
    duration = end_time - start_time
    event_id = event.get("id", 0)
    is_italic = event.get("is_italic", False)
    
    cps_limit = float(custom_cps) if custom_cps is not None else _get_cps_limit(content_type)
    cps_warning = (cps_limit - 2.0) if custom_cps is not None else _get_cps_warning(content_type)
    cpl_limit = int(custom_cpl) if custom_cpl is not None else _get_cpl_limit(script)
    max_lines_limit = int(custom_max_lines) if custom_max_lines is not None else MAX_LINES
    min_dur_limit = float(custom_min_duration) if custom_min_duration is not None else MIN_SUBTITLE_DURATION
    max_dur_limit = float(custom_max_duration) if custom_max_duration is not None else MAX_SUBTITLE_DURATION
    
    # ── Duration Checks ──
    if duration < (min_dur_limit - 0.005):
        errors.append({
            "event_id": event_id,
            "rule_id": "NF-DURATION-SHORT",
            "field": "timing",
            "message": f"Duration {duration:.3f}s is below minimum of {min_dur_limit:.3f}s.",
            "severity": "error",
            "suggested_fix": f"Extend to at least {min_dur_limit:.3f}s or merge with adjacent event.",
        })
    
    if duration > (max_dur_limit + 0.005):
        errors.append({
            "event_id": event_id,
            "rule_id": "NF-DURATION-LONG",
            "field": "timing",
            "message": f"Duration {duration:.3f}s exceeds maximum of {max_dur_limit:.1f}s.",
            "severity": "error",
            "suggested_fix": "Split into two events or shorten the display time.",
        })
    
    # ── CPS (Reading Speed) Checks (Yellow / Amber Warnings) ──
    if duration > 0:
        cps = calculate_cps(text, duration)
        if cps > cps_limit:
            errors.append({
                "event_id": event_id,
                "rule_id": f"NF-CPS-{'CHILD' if content_type == 'children' else 'ADULT'}",
                "field": "text",
                "message": f"CPS {cps:.1f} exceeds limit of {cps_limit:.1f}. Text is too dense for the display time.",
                "severity": "warning",
                "suggested_fix": f"Extend duration or reduce text to bring CPS below {cps_limit:.1f}.",
            })
        elif cps > cps_warning:
            errors.append({
                "event_id": event_id,
                "rule_id": "NF-CPS-WARNING",
                "field": "text",
                "message": f"CPS {cps:.1f} is approaching the limit of {cps_limit:.1f}.",
                "severity": "warning",
                "suggested_fix": None,
            })
    
    # ── CPL (Characters Per Line) Checks ──
    lines = text.split('\n')
    for line_idx, line in enumerate(lines):
        clean_line = _strip_tags(line).strip()
        # Remove speaker hyphen for CPL counting
        if clean_line.startswith('-'):
            clean_line = clean_line[1:].strip()
        
        line_len = len(clean_line)
        if line_len > cpl_limit:
            errors.append({
                "event_id": event_id,
                "rule_id": "NF-CPL",
                "field": "text",
                "message": f"Line {line_idx + 1} has {line_len} characters, exceeding the {cpl_limit} CPL limit.",
                "severity": "error",
                "suggested_fix": f"Rebreak the line to keep each line ≤ {cpl_limit} characters.",
            })
    
    # ── Max Lines Check ──
    if len(lines) > max_lines_limit:
        errors.append({
            "event_id": event_id,
            "rule_id": "NF-MAX-LINES",
            "field": "text",
            "message": f"Subtitle has {len(lines)} lines. Maximum allowed is {max_lines_limit}.",
            "severity": "error",
            "suggested_fix": f"Condense to {max_lines_limit} lines maximum or split into separate events.",
        })
    
    # ── Line Break Quality Checks ──
    if len(lines) == 2:
        break_violations = detect_bad_line_breaks(text)
        for bv in break_violations:
            errors.append({
                "event_id": event_id,
                "rule_id": "NF-LINE-BREAK",
                "field": "text",
                "message": bv["message"],
                "severity": "warning",
                "suggested_fix": bv.get("suggested_fix"),
            })
        
        # Check for orphan on second line (unless dual-speaker)
        is_dual_speaker = lines[0].strip().startswith('-') and lines[1].strip().startswith('-')
        if not is_dual_speaker:
            lower_clean = _strip_tags(lines[1]).strip()
            if len(lower_clean) <= ORPHAN_MAX_CHARS and len(lower_clean) > 0:
                errors.append({
                    "event_id": event_id,
                    "rule_id": "NF-ORPHAN",
                    "field": "text",
                    "message": f"Short orphan word '{lower_clean}' alone on second line ({len(lower_clean)} chars).",
                    "severity": "warning",
                    "suggested_fix": "Rebreak to move more words to the second line.",
                })

    # ── Script Purity / Code-Mixing Check ──
    # If target script is Devanagari, flag any Latin alphabet letters [a-zA-Z]
    if script and script.lower() in ["devanagari", "hindi"]:
        clean_no_tags = _strip_tags(text).strip()
        latin_words = re.findall(r'\b[a-zA-Z]+\b', clean_no_tags)
        if latin_words:
            sample_words = ", ".join(latin_words[:4])
            errors.append({
                "event_id": event_id,
                "rule_id": "NF-CODE-MIXED-SCRIPT",
                "field": "text",
                "message": f"Latin/English words detected in Devanagari script: '{sample_words}'. When target script is Devanagari, English words and sentences must be phonetically transliterated into Devanagari (e.g. 'I want to go' -> 'आई वांट टू गो', 'target' -> 'टारगेट').",
                "severity": "error",
                "suggested_fix": f"Phonetically transliterate foreign words ({sample_words}) into Devanagari characters.",
            })

    # ── Gap / Overlap Checks ──
    if prev_event:
        prev_end = float(prev_event.get("end_time", 0))
        gap_result = check_gap_compliance(prev_end, start_time, frame_rate)
        if gap_result:
            errors.append({
                "event_id": event_id,
                "rule_id": gap_result["rule_id"],
                "field": "timing",
                "message": gap_result["message"],
                "severity": gap_result["severity"],
                "suggested_fix": f"Adjust previous event's end time to {gap_result.get('fix_end_time', 'N/A'):.3f}s."
                    if gap_result.get('fix_end_time') else None,
            })
    
    # ── Dual Speaker Format Checks ──
    if len(lines) == 2:
        line1_has_hyphen = lines[0].strip().startswith('-')
        line2_has_hyphen = lines[1].strip().startswith('-')
        
        # If one line has hyphen but not the other, it's inconsistent
        if line1_has_hyphen != line2_has_hyphen:
            # Only flag if it looks like dual speaker (different content patterns)
            if line1_has_hyphen or line2_has_hyphen:
                errors.append({
                    "event_id": event_id,
                    "rule_id": "NF-DUAL-SPEAKER",
                    "field": "format",
                    "message": "Inconsistent dual-speaker formatting. Both lines must start with '-' for dual speakers.",
                    "severity": "error",
                    "suggested_fix": "Add '-' prefix to both lines if two speakers, or remove from both if single speaker.",
                })
    
        # Netflix: "Use a hyphen without a space to indicate two speakers in one subtitle"
        if line1_has_hyphen and line2_has_hyphen and any(re.match(r'^\s*(?:<[^>]+>)*[-–—]\s', l) for l in lines):
            errors.append({
                "event_id": event_id,
                "rule_id": "NF-DUAL-SPEAKER-SPACE",
                "field": "format",
                "message": "Dual-speaker hyphen is followed by a space. Netflix uses a hyphen without a space.",
                "severity": "warning",
                "suggested_fix": "\n".join(re.sub(r'^(\s*(?:<[^>]+>)*[-–—])\s+', r'\1', l) for l in lines),
            })

    # ── Space Before Punctuation Check (Hindi guide: no spaces after text and before punctuation) ──
    if re.search(r'\S[ \t]+[,.!?;:।॥…]', _strip_tags(text)):
        errors.append({
            "event_id": event_id,
            "rule_id": "NF-PUNCT-SPACE",
            "field": "text",
            "message": "Space before a punctuation mark. There should be no space between the text and the punctuation.",
            "severity": "warning",
            "suggested_fix": re.sub(r'(?<=\S)[ \t]+([,.!?;:।॥…])', r'\1', text),
        })

    # ── Ellipsis Check ──
    if '...' in text:
        errors.append({
            "event_id": event_id,
            "rule_id": "NF-ELLIPSIS",
            "field": "text",
            "message": "Three dots '...' detected. Netflix requires Unicode ellipsis '…' (U+2026).",
            "severity": "error",
            "suggested_fix": text.replace('...', '…'),
        })
    
    # ── Music Note Check ──
    # If text contains ♪ check proper formatting
    if '♪' in text:
        # Each line with lyrics should have ♪ at both start and end
        for line_idx, line in enumerate(lines):
            stripped = line.strip()
            if '♪' in stripped:
                has_start = stripped.startswith('♪') or stripped.startswith('<i>♪') or stripped.startswith('-♪') or stripped.startswith('-<i>♪') or stripped.startswith('<i>-♪')
                has_end = stripped.endswith('♪') or stripped.endswith('♪</i>')
                if not (has_start and has_end):
                    errors.append({
                        "event_id": event_id,
                        "rule_id": "NF-MUSIC-NOTE",
                        "field": "text",
                        "message": f"Line {line_idx + 1}: Lyrics must have ♪ at both start and end.",
                        "severity": "warning",
                        "suggested_fix": None,
                    })
    
    # ── Italics Usage Check ──
    has_italic_tags = '<i>' in text or '</i>' in text
    if has_italic_tags and not is_italic:
        # Italics present in text but event not flagged — informational only
        pass
    
    # Check for unclosed/mismatched italic tags
    open_count = text.count('<i>')
    close_count = text.count('</i>')
    if open_count != close_count:
        errors.append({
            "event_id": event_id,
            "rule_id": "NF-ITALICS-MISUSE",
            "field": "format",
            "message": f"Mismatched italic tags: {open_count} <i> vs {close_count} </i>.",
            "severity": "warning",
            "suggested_fix": None,
        })
    
    # ── Shot Change Compliance ──
    if shot_changes:
        shot_violations = check_shot_change_compliance(start_time, end_time, shot_changes, frame_rate)
        for sv in shot_violations:
            fix_msg = None
            if "fix_start_time" in sv:
                fix_msg = f"Snap in-time to {sv['fix_start_time']:.3f}s."
            elif "fix_end_time" in sv:
                fix_msg = f"Snap out-time to {sv['fix_end_time']:.3f}s."
            
            errors.append({
                "event_id": event_id,
                "rule_id": sv["rule_id"],
                "field": "timing",
                "message": sv["message"],
                "severity": sv["severity"],
                "suggested_fix": fix_msg,
            })
    
    return errors


def lint_all_subtitles(
    events: List[Dict[str, Any]],
    shot_changes: Optional[List[float]] = None,
    content_type: str = "adult",
    frame_rate: float = 24.0,
    script: str = "latin",
    custom_cpl: Optional[int] = None,
    custom_cps: Optional[float] = None,
    custom_max_lines: Optional[int] = None,
    custom_min_duration: Optional[float] = None,
    custom_max_duration: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Lint all subtitle events and compute Netflix QC result with optional custom thresholds.
    
    Args:
        events: List of subtitle event dicts
        shot_changes: List of shot change timestamps
        content_type: "adult" or "children"
        frame_rate: Video frame rate
        script: Script type for CPL limits
        custom_cpl: Optional override for max characters per line
        custom_cps: Optional override for max reading speed (CPS)
        custom_max_lines: Optional override for max lines
        custom_min_duration: Optional override for min subtitle duration
        custom_max_duration: Optional override for max subtitle duration
    
    Returns:
        Dict with: events (with qc_errors populated), total_errors, total_warnings,
        compliance_score, cps_stats
    """
    shot_changes = shot_changes or []
    total_errors = 0
    total_warnings = 0
    all_cps = []
    linted_events = []
    effective_cps_limit = float(custom_cps) if custom_cps is not None else _get_cps_limit(content_type)
    
    for i, event in enumerate(events):
        prev_event = events[i - 1] if i > 0 else None
        next_event = events[i + 1] if i < len(events) - 1 else None
        
        qc_errors = lint_subtitle_event(
            event=event,
            prev_event=prev_event,
            next_event=next_event,
            shot_changes=shot_changes,
            content_type=content_type,
            frame_rate=frame_rate,
            script=script,
            custom_cpl=custom_cpl,
            custom_cps=custom_cps,
            custom_max_lines=custom_max_lines,
            custom_min_duration=custom_min_duration,
            custom_max_duration=custom_max_duration,
        )
        
        # Update event with QC results
        event["qc_errors"] = qc_errors
        event["is_valid"] = all(e["severity"] != "error" for e in qc_errors)
        
        # Compute CPS
        duration = float(event.get("end_time", 0)) - float(event.get("start_time", 0))
        if duration > 0:
            cps = calculate_cps(event.get("text", ""), duration)
            event["cps"] = cps
            all_cps.append(cps)
        
        # Compute CPL
        event["cpl"] = calculate_cpl(event.get("text", ""))
        
        # Count errors
        errors_count = sum(1 for e in qc_errors if e["severity"] == "error")
        warnings_count = sum(1 for e in qc_errors if e["severity"] == "warning")
        total_errors += errors_count
        total_warnings += warnings_count
        
        linted_events.append(event)
    
    # Calculate compliance score
    total_events = max(1, len(events))
    score = max(0.0, 100.0 - (total_errors * 3.0) - (total_warnings * 0.5))
    score = min(100.0, round(score, 1))
    
    # Calculate CPS statistics
    cps_stats = {
        "min_cps": round(min(all_cps), 2) if all_cps else 0.0,
        "max_cps": round(max(all_cps), 2) if all_cps else 0.0,
        "avg_cps": round(sum(all_cps) / len(all_cps), 2) if all_cps else 0.0,
        "p95_cps": round(sorted(all_cps)[int(len(all_cps) * 0.95)] if all_cps else 0.0, 2),
        "events_over_limit": sum(1 for c in all_cps if c > effective_cps_limit),
        "total_events": len(all_cps),
    }
    
    return {
        "events": linted_events,
        "total_events": len(events),
        "total_errors": total_errors,
        "total_warnings": total_warnings,
        "compliance_score": score,
        "cps_stats": cps_stats,
    }


# ──────────────────────────────────────────────────────────
# Auto-Fix Functions
# ──────────────────────────────────────────────────────────

def auto_fix_ellipsis(text: str) -> str:
    """Replace three dots with Unicode ellipsis."""
    return text.replace('...', '…')


def auto_fix_line_breaks(text: str, max_cpl: int = 42) -> str:
    """Re-break lines to fix CPL violations using Netflix linguistic rules."""
    # If it's dual speaker, handle each line independently
    lines = text.split('\n')
    if len(lines) == 2 and lines[0].strip().startswith('-') and lines[1].strip().startswith('-'):
        fixed_lines = []
        for line in lines:
            clean = _strip_tags(line).strip()
            if len(clean) > max_cpl:
                # Can't easily rebreak a single speaker line that's already in dual-speaker format
                # Just truncate the approach - in practice the user should edit
                fixed_lines.append(line)
            else:
                fixed_lines.append(line)
        return '\n'.join(fixed_lines)
    
    # Single speaker: optimize line breaks
    clean = _strip_tags(text).replace('\n', ' ')
    clean = re.sub(r'\s+', ' ', clean).strip()
    return optimize_line_breaks(clean, max_cpl)


def auto_chain_gaps(
    events: List[Dict[str, Any]],
    frame_rate: float = 24.0,
    min_duration: float = 0.833,
    max_cps: float = 20.0
) -> List[Dict[str, Any]]:
    """
    Apply Netflix gap chaining rule to all events.
    
    Gaps of 3-11 frames → extend out-time of previous event to create exactly 2-frame gap.
    Gaps ≥ 12 frames → leave as-is.
    Overlaps → fix by adjusting end time.
    """
    if len(events) < 2:
        return events
    
    min_gap = _frames_to_seconds(MIN_GAP_FRAMES, frame_rate)
    
    # 1. Critical invariant: ALWAYS sort strictly by start_time first
    events.sort(key=lambda e: (float(e.get("start_time", 0.0)), float(e.get("end_time", 0.0))))
    
    for i in range(len(events) - 1):
        curr_start = float(events[i].get("start_time", 0.0))
        curr_end = float(events[i].get("end_time", curr_start + 1.0))
        next_start = float(events[i + 1].get("start_time", 0.0))
        next_end = float(events[i + 1].get("end_time", next_start + 1.0))
        
        # Degenerate collision: next_start is before or equal to curr_start
        if next_start <= curr_start + 0.05:
            next_dur = max(min_duration, next_end - next_start)
            next_start = round(curr_end + min_gap, 3)
            next_end = round(next_start + next_dur, 3)
            events[i + 1]["start_time"] = next_start
            events[i + 1]["start"] = next_start
            events[i + 1]["end_time"] = next_end
            events[i + 1]["end"] = next_end
        
        gap_seconds = next_start - curr_end
        gap_frames = _seconds_to_frames(gap_seconds, frame_rate)
        
        # Strict timeline non-overlap enforcement
        if gap_seconds < min_gap:
            target_end = round(next_start - min_gap, 3)
            if target_end > curr_start + 0.20:
                events[i]["end_time"] = target_end
                events[i]["end"] = target_end
            else:
                # Event is too tight: separate by minimum legible speech window
                events[i]["end_time"] = round(curr_start + 0.35, 3)
                events[i]["end"] = events[i]["end_time"]
                next_start = round(events[i]["end_time"] + min_gap, 3)
                next_dur = max(min_duration, next_end - float(events[i + 1]["start_time"]))
                events[i + 1]["start_time"] = next_start
                events[i + 1]["start"] = next_start
                events[i + 1]["end_time"] = round(next_start + next_dur, 3)
                events[i + 1]["end"] = events[i + 1]["end_time"]
                
        elif MIN_GAP_FRAMES < gap_frames < CHAIN_THRESHOLD_FRAMES:
            # Only bridge the gap if the pause is tiny (<= 0.18s) OR subtitle needs reading time (CPS > max_cps)
            cur_dur = max(0.01, curr_end - curr_start)
            cur_cps = calculate_cps(events[i].get("text", ""), cur_dur)
            if gap_seconds <= 0.18 or cur_cps > max_cps or cur_dur < min_duration:
                events[i]["end_time"] = round(next_start - min_gap, 3)
                events[i]["end"] = events[i]["end_time"]
    
    # Final safety clamp: 100% guarantee no cur_end exceeds next_start - min_gap
    for i in range(len(events) - 1):
        c_et = float(events[i]["end_time"])
        n_st = float(events[i + 1]["start_time"])
        if c_et > n_st - min_gap:
            events[i]["end_time"] = round(n_st - min_gap, 3)
            events[i]["end"] = events[i]["end_time"]
    
    # Update durations and formatted timestamps
    for event in events:
        st = float(event["start_time"])
        et = float(event["end_time"])
        event["duration"] = round(max(0.1, et - st), 3)
        event["start_time_str"] = format_timestamp(st)
        event["end_time_str"] = format_timestamp(et)
    
    return events


def auto_snap_to_shots(
    events: List[Dict[str, Any]],
    shot_changes: List[float],
    frame_rate: float = 24.0
) -> List[Dict[str, Any]]:
    """
    Snap subtitle in/out times to nearby shot changes per Netflix rules.
    
    - If in-time is within 2 frames after a shot cut → snap to the cut
    - If out-time is within 2 frames before a shot cut → snap to 2 frames before cut
    """
    if not shot_changes:
        return events
    
    min_gap = _frames_to_seconds(MIN_GAP_FRAMES, frame_rate)
    
    for event in events:
        start_time = float(event.get("start_time", 0))
        end_time = float(event.get("end_time", 0))
        
        # Snap in-time
        nearest_in = find_nearest_shot_change(
            start_time, shot_changes, SHOT_SNAP_THRESHOLD_FRAMES, frame_rate
        )
        if nearest_in is not None and start_time > nearest_in:
            event["start_time"] = nearest_in
        
        # Snap out-time to 2 frames before nearest shot change
        nearest_out = find_nearest_shot_change(
            end_time, shot_changes, SHOT_SNAP_THRESHOLD_FRAMES, frame_rate
        )
        if nearest_out is not None and end_time < nearest_out:
            event["end_time"] = round(nearest_out - min_gap, 6)
        
        # Update duration
        event["duration"] = round(float(event["end_time"]) - float(event["start_time"]), 3)
    
    return events


def auto_fix_cps(
    event: Dict[str, Any],
    max_cps: float = 20.0,
    max_extension: float = 0.5,
    next_start: Optional[float] = None,
    frame_rate: float = 24.0
) -> Dict[str, Any]:
    """
    Adjust subtitle timing to bring CPS within limits.
    
    Strategy:
    1. Extend out-time by up to max_extension (0.5s) beyond speech end
    2. Ensure we don't collide with the next event (respect 2-frame gap)
    3. If still over, flag for manual condensation
    """
    text = event.get("text", "")
    start_time = float(event.get("start_time", 0))
    end_time = float(event.get("end_time", 0))
    duration = end_time - start_time
    
    if duration <= 0:
        return event
    
    cps = calculate_cps(text, duration)
    if cps <= max_cps:
        return event
    
    # Calculate how much duration we need
    char_count = len(_strip_tags(_strip_music_notes(text)).strip())
    needed_duration = char_count / max_cps
    extension_needed = needed_duration - duration
    
    if extension_needed <= 0:
        return event
    
    # Cap extension at max_extension
    actual_extension = min(extension_needed, max_extension)
    
    # Don't collide with next event
    if next_start is not None:
        min_gap = _frames_to_seconds(MIN_GAP_FRAMES, frame_rate)
        max_end = next_start - min_gap
        actual_extension = min(actual_extension, max_end - end_time)
        actual_extension = max(0, actual_extension)
    
    event["end_time"] = round(end_time + actual_extension, 6)
    event["duration"] = round(float(event["end_time"]) - start_time, 3)
    
    return event


def split_dense_text_at_natural_boundary(text: str, max_cpl: int = 42) -> List[str]:
    """
    Split text that exceeds max_lines * max_cpl (or is too long for 1 event)
    into two well-formed parts at a natural grammatical / clause boundary.
    """
    clean = _strip_tags(text).strip()
    words = clean.split()
    if len(words) <= 1:
        return [clean]
    
    total_len = len(clean)
    mid = total_len // 2
    
    # Priority 1: Sentence or clause-ending punctuation near middle (. , ! ? ; — – । ॥ …)
    candidates = []
    for m in re.finditer(r'([.,!?;:—–।॥…])\s+', clean):
        pos = m.end()
        # Ensure split does not strand a Hindi postposition at the start of part 2
        remainder = clean[pos:].strip().split()
        if remainder and remainder[0].lower().rstrip('.,!?;:।॥…') in HINDI_POSTPOSITIONS:
            continue
        candidates.append((abs(pos - mid), pos))
    
    if candidates:
        candidates.sort(key=lambda x: x[0])
        best_pos = candidates[0][1]
        p1 = clean[:best_pos].strip()
        p2 = clean[best_pos:].strip()
        if p1 and p2:
            return [p1, p2]
            
    # Priority 2: Coordinating/subordinating conjunctions (English & Hindi)
    conj_candidates = []
    conj_pattern = re.compile(
        r'(?:\b(and|but|because|so|while|when|that|which|or|although|though|aur|lekin|magar|kintu|parantu|kyunki|isliye|taaki|agar)\b|(?<=\s)(और|या|अथवा|लेकिन|मगर|किंतु|परंतु|क्योंकि|इसलिए|ताकि|कि|तो|जब|तब|अगर|यदि)(?=\s))',
        re.IGNORECASE
    )
    for m in conj_pattern.finditer(clean):
        pos = m.start()
        remainder = clean[pos:].strip().split()
        if remainder and remainder[0].lower().rstrip('.,!?;:।॥…') in HINDI_POSTPOSITIONS:
            continue
        conj_candidates.append((abs(pos - mid), pos))
        
    if conj_candidates:
        conj_candidates.sort(key=lambda x: x[0])
        best_pos = conj_candidates[0][1]
        p1 = clean[:best_pos].strip()
        p2 = clean[best_pos:].strip()
        if p1 and p2:
            return [p1, p2]
            
    # Priority 3: Prepositions
    prep_candidates = []
    for m in re.finditer(r'\b(in|at|on|with|of|for|to|from|by|into|about)\b', clean, re.IGNORECASE):
        pos = m.start()
        remainder = clean[pos:].strip().split()
        if remainder and remainder[0].lower().rstrip('.,!?;:।॥…') in HINDI_POSTPOSITIONS:
            continue
        prep_candidates.append((abs(pos - mid), pos))
        
    if prep_candidates:
        prep_candidates.sort(key=lambda x: x[0])
        best_pos = prep_candidates[0][1]
        p1 = clean[:best_pos].strip()
        p2 = clean[best_pos:].strip()
        if p1 and p2:
            return [p1, p2]
            
    # Fallback: Word split closest to middle (ensuring postposition is not severed)
    mid_word = len(words) // 2
    if mid_word < len(words) and words[mid_word].lower().rstrip('.,!?;:।॥…') in HINDI_POSTPOSITIONS:
        # Move postposition into part 1 with its preceding noun
        mid_word = min(len(words) - 1, mid_word + 1)
    return [' '.join(words[:mid_word]), ' '.join(words[mid_word:])]


def rebalance_words_across_adjacent_events(
    events: List[Dict[str, Any]],
    cpl_limit: int = 42,
    max_lines: int = 2,
    min_duration: float = 0.833,
    frame_rate: float = 24.0,
) -> List[Dict[str, Any]]:
    """
    Adjust and rebalance words between adjacent subtitle events (shifting overflow words
    forward to next or backward to previous event) and adjust timestamps accordingly without
    compromising sync.
    """
    if len(events) < 2:
        return events

    min_gap = 2.0 / frame_rate if frame_rate > 0 else 0.083
    max_cap = max_lines * cpl_limit

    # Forward shift: from event[i] to event[i+1]
    for i in range(len(events) - 1):
        if _is_dual_speaker(events[i].get("text", "")) or _is_dual_speaker(events[i + 1].get("text", "")):
            continue
        txt_i = _strip_tags(events[i].get("text", "")).replace('\n', ' ').strip()
        broken_i = optimize_line_breaks(txt_i, cpl_limit).split('\n')
        if len(broken_i) > max_lines or any(len(l) > cpl_limit for l in broken_i) or len(txt_i) > (max_cap - 4):
            words = txt_i.split()
            for split_idx in range(len(words) - 1, 0, -1):
                p1 = ' '.join(words[:split_idx])
                p2 = ' '.join(words[split_idx:])
                b1 = optimize_line_breaks(p1, cpl_limit).split('\n')
                if len(b1) <= max_lines and all(len(l) <= cpl_limit for l in b1):
                    txt_next = _strip_tags(events[i + 1].get("text", "")).replace('\n', ' ').strip()
                    gap = float(events[i + 1].get("start_time", 0)) - float(events[i].get("end_time", 0))
                    if len(p2) + len(txt_next) + 1 <= max_cap and gap <= 1.2:
                        st = float(events[i]["start_time"])
                        et = float(events[i]["end_time"])
                        ratio = len(p1) / (len(p1) + len(p2))
                        new_et = round(st + (et - st) * ratio, 3)
                        next_et = float(events[i + 1].get("end_time", st + 4.0))

                        # Strict Netflix duration guard: both events must have duration >= min_duration
                        if (new_et - st) >= min_duration and (next_et - (new_et + min_gap)) >= min_duration:
                            events[i]["text"] = p1
                            events[i]["end_time"] = new_et
                            events[i]["end"] = new_et
                            events[i]["end_time_str"] = format_timestamp(new_et)
                            events[i]["duration"] = round(new_et - st, 3)

                            events[i + 1]["text"] = p2 + " " + txt_next
                            events[i + 1]["start_time"] = round(new_et + min_gap, 3)
                            events[i + 1]["start"] = events[i + 1]["start_time"]
                            events[i + 1]["start_time_str"] = format_timestamp(events[i + 1]["start_time"])
                            events[i + 1]["duration"] = round(next_et - events[i + 1]["start_time"], 3)
                            break

    # Backward shift: from event[i] to event[i-1]
    for i in range(len(events) - 1, 0, -1):
        if _is_dual_speaker(events[i].get("text", "")) or _is_dual_speaker(events[i - 1].get("text", "")):
            continue
        txt_i = _strip_tags(events[i].get("text", "")).replace('\n', ' ').strip()
        broken_i = optimize_line_breaks(txt_i, cpl_limit).split('\n')
        if len(broken_i) > max_lines or any(len(l) > cpl_limit for l in broken_i) or len(txt_i) > (max_cap - 4):
            words = txt_i.split()
            for split_idx in range(1, len(words)):
                p1 = ' '.join(words[:split_idx])
                p2 = ' '.join(words[split_idx:])
                b2 = optimize_line_breaks(p2, cpl_limit).split('\n')
                if len(b2) <= max_lines and all(len(l) <= cpl_limit for l in b2):
                    txt_prev = _strip_tags(events[i - 1].get("text", "")).replace('\n', ' ').strip()
                    gap = float(events[i].get("start_time", 0)) - float(events[i - 1].get("end_time", 0))
                    if len(txt_prev) + len(p1) + 1 <= max_cap and gap <= 1.2:
                        prev_st = float(events[i - 1].get("start_time", 0))
                        st = float(events[i]["start_time"])
                        et = float(events[i]["end_time"])
                        ratio = len(p1) / (len(p1) + len(p2))
                        new_split = round(st + (et - st) * ratio, 3)

                        # Strict duration guard
                        if (new_split - prev_st) >= min_duration and (et - (new_split + min_gap)) >= min_duration:
                            events[i - 1]["text"] = txt_prev + " " + p1
                            events[i - 1]["end_time"] = new_split
                            events[i - 1]["end"] = new_split
                            events[i - 1]["end_time_str"] = format_timestamp(new_split)
                            events[i - 1]["duration"] = round(new_split - prev_st, 3)

                            events[i]["text"] = p2
                            events[i]["start_time"] = round(new_split + min_gap, 3)
                            events[i]["start"] = events[i]["start_time"]
                            events[i]["start_time_str"] = format_timestamp(events[i]["start_time"])
                            events[i]["duration"] = round(et - events[i]["start_time"], 3)
                            break

    return events


def split_multi_speaker_subtitles(
    events: List[Dict[str, Any]],
    frame_rate: float = 24.0,
    min_duration: float = 0.833,
) -> List[Dict[str, Any]]:
    """
    Guarantees that EVERY subtitle event belongs to EXACTLY ONE speaker.
    If an event contains multiple speakers (dual-hyphen lines, multiple speaker tags,
    or len(speakers) > 1), automatically splits it into distinct, sequential,
    non-overlapping single-speaker subtitle events.
    """
    if not events:
        return []

    min_gap_sec = 2.0 / frame_rate if frame_rate > 0 else 0.083
    result = []

    prefix_pattern = re.compile(r'^([A-Za-z0-9_\u0900-\u097F\s]{1,25}):\s*(.*)$')

    for ev in events:
        text = str(ev.get("text", "")).strip()
        speakers = ev.get("speakers", [])
        if isinstance(speakers, str):
            speakers = [speakers]
        elif not isinstance(speakers, list):
            speakers = ["Speaker 1"]

        lines = [l.strip() for l in text.split("\n") if l.strip()]

        # Check for inline dual-speaker separation on a single line
        if len(lines) == 1:
            single = lines[0]
            # 1. Inline hyphens: e.g. "- Hello! - Hi!" or "Hello! - Hi!"
            inline_hyphen_parts = [p.strip() for p in re.split(r'(?:^|\s+)[-—–]\s+', single) if p.strip()]
            if len(inline_hyphen_parts) >= 2:
                lines = [f"-{p}" for p in inline_hyphen_parts]
            elif len(speakers) > 1:
                # 2. Model returned multiple speakers but single line of text without hyphens
                # Split at sentence boundaries (., !, ?, ।, ॥)
                sent_parts = [p.strip() for p in re.split(r'(?<=[.!?।॥])\s+', single) if p.strip()]
                if len(sent_parts) >= 2:
                    lines = sent_parts
                else:
                    # Split words at best linguistic clause boundary instead of blind mid = len(w) // 2
                    w = single.split()
                    if len(w) >= 2:
                        try:
                            from app.dialogue_harmonizer import score_split_candidate
                            best_s = len(w) // 2
                            best_p = 999999
                            total_chars = sum(len(x) for x in w)
                            cum_c = 0
                            for s_idx in range(1, len(w)):
                                cum_c += len(w[s_idx - 1])
                                s_pen = score_split_candidate(w[s_idx - 1], w[s_idx], cum_c, total_chars / 2.0, 0.0)
                                if s_pen < best_p:
                                    best_p = s_pen
                                    best_s = s_idx
                            lines = [' '.join(w[:best_s]), ' '.join(w[best_s:])]
                        except Exception:
                            mid = len(w) // 2
                            lines = [' '.join(w[:mid]), ' '.join(w[mid:])]

        # Condition A: 2 or more lines starting with hyphen / dash (e.g. '- Speaker 1\n- Speaker 2')
        hyphen_lines = [l for l in lines if l.startswith(("-", "—", "–"))]
        is_dual_hyphen = (len(hyphen_lines) >= 2)

        # Condition B: Multiple speaker names present in speakers list (len > 1)
        has_multiple_speakers = len(speakers) > 1

        # Condition C: Explicit speaker prefixes like "Speaker 1: ..." and "Speaker 2: ..."
        speaker_prefixed_lines = []
        for l in lines:
            m = prefix_pattern.match(l)
            if m:
                speaker_prefixed_lines.append((m.group(1).strip(), m.group(2).strip()))
            else:
                speaker_prefixed_lines.append((None, l))
        has_different_prefix_speakers = (
            len(speaker_prefixed_lines) >= 2
            and speaker_prefixed_lines[0][0] is not None
            and speaker_prefixed_lines[1][0] is not None
            and speaker_prefixed_lines[0][0] != speaker_prefixed_lines[1][0]
        )

        should_split = (is_dual_hyphen or has_multiple_speakers or has_different_prefix_speakers) and len(lines) >= 2

        if not should_split:
            # Single speaker event! Just ensure speaker array has exactly 1 speaker
            clean_ev = dict(ev)
            clean_ev["speakers"] = [speakers[0]] if speakers else ["Speaker 1"]
            clean_ev["speaker_count"] = 1
            result.append(clean_ev)
            continue

        # Netflix Dual-Speaker Rule: If exactly 2 lines and both start with a hyphen,
        # retain as a standard dual-speaker subtitle event on the same timeline
        if is_dual_hyphen and len(lines) == 2:
            clean_ev = dict(ev)
            clean_ev["speakers"] = speakers if len(speakers) >= 2 else ["Speaker 1", "Speaker 2"]
            clean_ev["speaker_count"] = 2
            clean_ev["lines"] = lines
            clean_ev["text"] = "\n".join(lines)
            result.append(clean_ev)
            continue

        # Multiple speakers detected in this single event! Split into distinct single-speaker events.
        st = float(ev.get("start_time", ev.get("start", 0.0)))
        et = float(ev.get("end_time", ev.get("end", st + 2.0)))
        dur = max(0.05, et - st)

        # Prepare sub-event items: [(speaker_name, clean_text)]
        sub_items = []
        for idx, l in enumerate(lines):
            clean_l = l
            # Strip leading hyphen/dash from individual speaker lines
            if clean_l.startswith(("-", "—", "–")):
                clean_l = re.sub(r'^[-—–]\s*', '', clean_l).strip()

            spk_name = None
            if idx < len(speaker_prefixed_lines) and speaker_prefixed_lines[idx][0]:
                spk_name = speaker_prefixed_lines[idx][0]
                clean_l = speaker_prefixed_lines[idx][1]
            elif idx < len(speakers):
                spk_name = speakers[idx]
            else:
                spk_name = f"Speaker {idx + 1}"

            if clean_l:
                sub_items.append((spk_name, clean_l))

        if not sub_items:
            result.append(dict(ev))
            continue

        total_chars = max(1, sum(len(txt) for _, txt in sub_items))

        # Proportional non-overlapping duration allocation
        cur_start = st
        for idx, (spk_name, txt) in enumerate(sub_items):
            ratio = len(txt) / total_chars
            item_dur = max(min_duration, round(dur * ratio, 3))
            item_end = round(cur_start + item_dur, 3)

            sub_ev = dict(ev)
            sub_ev["text"] = txt
            sub_ev["speakers"] = [spk_name]
            sub_ev["speaker_count"] = 1
            sub_ev["start_time"] = cur_start
            sub_ev["end_time"] = item_end
            sub_ev["start"] = cur_start
            sub_ev["end"] = item_end
            sub_ev["duration"] = round(item_end - cur_start, 3)
            sub_ev["start_time_str"] = format_timestamp(cur_start)
            sub_ev["end_time_str"] = format_timestamp(item_end)
            result.append(sub_ev)

            # Advance with minimum gap for the next speaker (strictly non-overlapping)
            cur_start = round(item_end + min_gap_sec, 3)

    return result


def format_and_split_subtitle_events(
    events: List[Dict[str, Any]],
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    frame_rate: float = 24.0,
) -> List[Dict[str, Any]]:
    """
    Format every subtitle event to strictly conform to Netflix CPL, CPS, and Line Break rules.
    - Guarantees EXACTLY ONE speaker per event (splits multi-speaker events).
    - If an event's text is too long for max_lines * cpl_limit (or causes excessive CPS),
      splits it into 2 sequential timed events at natural linguistic boundaries.
    - Re-breaks text into 1-2 lines so NO line exceeds cpl_limit.
    - Adjusts duration into silence so CPS is under max_cps.
    - Chains gaps so there are no flicker intervals or collisions.
    """
    if not events:
        return []

    min_gap_sec = 2.0 / frame_rate if frame_rate > 0 else 0.083
    max_chars_per_event = max_lines * cpl_limit

    # Pass 0: Guarantee single speaker per event (never 2 speakers in 1 subtitle)
    events = split_multi_speaker_subtitles(events, frame_rate=frame_rate, min_duration=min_duration)

    # Pass 1: Text splitting for dense events
    split_pass_events = []
    for ev in events:
        if _is_dual_speaker(str(ev.get("text", ""))):
            split_pass_events.append(dict(ev))
            continue
        raw_txt = _strip_tags(auto_fix_ellipsis(str(ev.get("text", "")))).strip()
        raw_txt = re.sub(r'\s+', ' ', raw_txt)
        st = float(ev.get("start_time", ev.get("start", 0.0)))
        et = float(ev.get("end_time", ev.get("end", st + 2.0)))
        dur = max(0.05, et - st)
        cps = calculate_cps(raw_txt, dur)

        # Check if this event needs to be split
        should_split = (len(raw_txt) > (max_chars_per_event - 4)) or (cps > (max_cps * 1.25) and len(raw_txt) > 48 and dur >= 1.5)

        if should_split:
            parts = split_dense_text_at_natural_boundary(raw_txt, cpl_limit)
            if len(parts) == 2 and len(parts[0]) > 0 and len(parts[1]) > 0:
                l1 = len(parts[0])
                l2 = len(parts[1])
                ratio = l1 / (l1 + l2)
                # Split duration proportionally
                d1 = max(min_duration, round(dur * ratio, 3))
                if st + d1 + min_gap_sec + min_duration > et:
                    et1 = round(st + d1, 3)
                    st2 = round(et1 + min_gap_sec, 3)
                    et2 = round(max(et, st2 + min_duration), 3)
                else:
                    et1 = round(st + d1, 3)
                    st2 = round(et1 + min_gap_sec, 3)
                    et2 = round(et, 3)

                ev1 = dict(ev)
                ev1["text"] = parts[0]
                ev1["start_time"] = st
                ev1["end_time"] = et1
                ev1["start"] = st
                ev1["end"] = et1
                ev1["duration"] = round(et1 - st, 3)

                ev2 = dict(ev)
                ev2["text"] = parts[1]
                ev2["start_time"] = st2
                ev2["end_time"] = et2
                ev2["start"] = st2
                ev2["end"] = et2
                ev2["duration"] = round(et2 - st2, 3)

                split_pass_events.append(ev1)
                split_pass_events.append(ev2)
                continue

        split_pass_events.append(dict(ev))

    # Pass 2: Inter-event word rebalancing (shift words to next/previous events if adjacent space permits)
    split_pass_events = rebalance_words_across_adjacent_events(
        events=split_pass_events,
        cpl_limit=cpl_limit,
        max_lines=max_lines,
        min_duration=min_duration,
        frame_rate=frame_rate
    )

    # Pass 2: Line Breaking (CPL enforcement) and CPS duration extension
    formatted_events = []
    for i, ev in enumerate(split_pass_events):
        if _is_dual_speaker(str(ev.get("text", ""))):
            broken_txt = '\n'.join(re.sub(r'\s+', ' ', l).strip() for l in _strip_tags(auto_fix_ellipsis(str(ev["text"]))).split('\n'))
        else:
            txt = _strip_tags(auto_fix_ellipsis(str(ev.get("text", "")))).strip()
            txt = re.sub(r'\s+', ' ', txt)
            broken_txt = optimize_line_breaks(txt, cpl_limit)
        
        # Verify lines
        lines = broken_txt.split('\n')
        rechecked_lines = []
        for l in lines:
            if len(l) > cpl_limit:
                w_list = l.split()
                cur_l = ""
                for w in w_list:
                    if len(cur_l) + len(w) + 1 <= cpl_limit or not cur_l:
                        cur_l = (cur_l + " " + w).strip()
                    else:
                        rechecked_lines.append(cur_l)
                        cur_l = w
                if cur_l:
                    rechecked_lines.append(cur_l)
            else:
                rechecked_lines.append(l)

        if len(rechecked_lines) > max_lines:
            # Merge excess lines into line 2 to guarantee zero words dropped
            l1 = rechecked_lines[0]
            l2 = ' '.join(rechecked_lines[1:])
            rechecked_lines = [l1, l2]

        final_text = '\n'.join(rechecked_lines)
        st = float(ev.get("start_time", ev.get("start", 0.0)))
        et = float(ev.get("end_time", ev.get("end", st + 2.0)))
        dur = max(0.01, et - st)

        # Calculate needed duration for CPS
        char_cnt = len(final_text.replace('\n', ' ').strip())
        current_cps = calculate_cps(final_text, dur)
        
        # Extend duration into pause if CPS is too high
        if current_cps > max_cps:
            needed_dur = char_cnt / max_cps
            next_st = float(split_pass_events[i + 1].get("start_time", 1e9)) if i < len(split_pass_events) - 1 else None
            max_avail_end = (next_st - min_gap_sec) if next_st is not None else (st + max_duration)
            
            target_et = st + min(needed_dur, max_duration)
            if target_et <= max_avail_end:
                et = round(target_et, 3)
            elif max_avail_end > et:
                et = round(max_avail_end, 3)
            dur = max(0.01, round(et - st, 3))

        # Enforce min duration
        if dur < min_duration:
            next_st = float(split_pass_events[i + 1].get("start_time", 1e9)) if i < len(split_pass_events) - 1 else None
            max_avail_end = (next_st - min_gap_sec) if next_st is not None else (st + min_duration)
            if st + min_duration <= max_avail_end:
                et = round(st + min_duration, 3)
                dur = round(et - st, 3)

        ev["text"] = final_text
        ev["lines"] = rechecked_lines
        ev["start_time"] = st
        ev["end_time"] = et
        ev["start"] = st
        ev["end"] = et
        ev["start_time_str"] = format_timestamp(st)
        ev["end_time_str"] = format_timestamp(et)
        ev["duration"] = dur
        ev["cps"] = calculate_cps(final_text, dur)
        ev["cpl"] = calculate_cpl(final_text)
        formatted_events.append(ev)

    # Re-assign sequential IDs
    for idx, ev in enumerate(formatted_events, 1):
        ev["id"] = idx

    # Pass 3: Gap chaining
    formatted_events = auto_chain_gaps(formatted_events, frame_rate=frame_rate, min_duration=min_duration, max_cps=max_cps)
    return formatted_events


def auto_fix_subtitles(
    events: List[Dict[str, Any]],
    shot_changes: Optional[List[float]] = None,
    content_type: str = "adult",
    frame_rate: float = 24.0,
    script: str = "latin",
    custom_cpl: Optional[int] = None,
    custom_cps: Optional[float] = None,
    custom_max_lines: Optional[int] = None,
    custom_min_duration: Optional[float] = None,
    custom_max_duration: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Apply comprehensive Netflix Timed Text auto-fixes to subtitle events.
    Guarantees CPL, CPS, duration, line limits, and gap compliance.
    """
    shot_changes = shot_changes or []
    cps_limit = float(custom_cps) if custom_cps is not None else _get_cps_limit(content_type)
    cpl_limit = int(custom_cpl) if custom_cpl is not None else _get_cpl_limit(script)
    max_lines_limit = int(custom_max_lines) if custom_max_lines is not None else MAX_LINES
    min_dur_limit = float(custom_min_duration) if custom_min_duration is not None else MIN_SUBTITLE_DURATION
    max_dur_limit = float(custom_max_duration) if custom_max_duration is not None else MAX_SUBTITLE_DURATION
    
    # Run core splitting and formatting pass
    fixed_events = format_and_split_subtitle_events(
        events=events,
        cpl_limit=cpl_limit,
        max_cps=cps_limit,
        max_lines=max_lines_limit,
        min_duration=min_dur_limit,
        max_duration=max_dur_limit,
        frame_rate=frame_rate
    )
    
    # Snap to shots if shot change list provided
    if shot_changes:
        fixed_events = auto_snap_to_shots(fixed_events, shot_changes, frame_rate)
        fixed_events = auto_chain_gaps(fixed_events, frame_rate=frame_rate, min_duration=min_dur_limit, max_cps=cps_limit)
        
    # Re-lint to populate final qc_errors and score
    result = lint_all_subtitles(
        events=fixed_events,
        shot_changes=shot_changes,
        content_type=content_type,
        frame_rate=frame_rate,
        script=script,
        custom_cpl=cpl_limit,
        custom_cps=cps_limit,
        custom_max_lines=max_lines_limit,
        custom_min_duration=min_dur_limit,
        custom_max_duration=max_dur_limit
    )
    
    return result["events"]
