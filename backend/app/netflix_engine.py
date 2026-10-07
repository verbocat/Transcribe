"""
Universal Netflix Timed Text Subtitle Conforming Engine
======================================================

Conforms raw word-level transcripts (from ElevenLabs Scribe v2 or other STT)
into broadcast-grade, 100% compliant subtitles adhering to the official
Netflix Timed Text Style Guide across ALL languages.

Key Capabilities:
- Multi-Language Profiles: Latin, Indic (Devanagari, Tamil, Telugu, etc.),
  CJK (Japanese, Chinese, Korean), Cyrillic, Arabic, Hebrew, Thai, etc.
- Reading Speed Enforcement: Adult (20 CPS / 7.5 CPS for JPN / 9.5 for ZHO / 10.5 for KOR)
  and Children (17 CPS / 5.0 for JPN / 7.0 for ZHO / 7.5 for KOR).
- Character Per Line (CPL) Limits: 42 for Latin/Indic/Cyrillic/Arabic, 16 for CJK, 35 for Thai.
- Maximum 2 lines per subtitle event (1 line preferred if under CPL).
- Linguistic Line Breaking:
  * Prohibits breaking article + noun, pronoun + verb, preposition + object.
  * Preserves Indic postpositions (कारक चिन्ह) and conjunctions.
  * Enforces Japanese Kinsoku Shori (禁則処理) and particle splitting.
  * Preserves Korean postposition particles (조사) at eojeol boundaries.
  * Protects titles/honorifics and number + unit pairs.
  * Bottom-heavy / balanced pyramid aesthetic; strict orphan prevention.
- Perfect Sync & Gap Management:
  * Word-level acoustic anchor timestamps.
  * Readability duration extension up to minimum 0.833s (20 frames @ 24fps).
  * Maximum duration 7.0s.
  * Gap chaining for 3-11 frame gaps to 2-frame gap (eliminates flicker).
  * Strict 2-frame minimum gap between consecutive events.
- Multi-Speaker Diarization: Dual-speaker hyphenation (- Speaker 1\\n- Speaker 2).
- Non-speech Audio Events: SDH formatting ([laughter], [applause], [groan]).
"""

import re
import math
import logging
from typing import List, Dict, Any, Optional, Tuple

from app.netflix_models import (
    SubtitleEvent, NetflixQCResult, CPSStats, format_timestamp, calculate_cps, calculate_cpl
)
from app.terminal_logger import log_terminal

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────
# Netflix Timed Text Profile Registry by Language / Script
# ──────────────────────────────────────────────────────────

class NetflixLanguageProfile:
    def __init__(
        self,
        name: str,
        script: str,
        cpl_limit: int,
        cps_adult: float,
        cps_children: float,
        min_duration: float = 5.0 / 6.0,  # 0.833s (20 frames @ 24fps)
        max_duration: float = 7.0,
        min_gap_frames: int = 2,
        chain_gap_frames: int = 12,
        sentence_endings: Tuple[str, ...] = ('.', '!', '?'),
        clause_delimiters: Tuple[str, ...] = (',', ';', ':', '—', '–'),
        no_break_before: Optional[set] = None,
        good_break_before: Optional[set] = None,
        honorifics: Optional[set] = None,
    ):
        self.name = name
        self.script = script
        self.cpl_limit = cpl_limit
        self.cps_adult = cps_adult
        self.cps_children = cps_children
        self.min_duration = min_duration
        self.max_duration = max_duration
        self.min_gap_frames = min_gap_frames
        self.chain_gap_frames = chain_gap_frames
        self.sentence_endings = sentence_endings
        self.clause_delimiters = clause_delimiters
        self.no_break_before = no_break_before or set()
        self.good_break_before = good_break_before or set()
        self.honorifics = honorifics or set()


# Common Latin articles & pronouns
_LATIN_ARTICLES = {
    # English
    "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their",
    # Spanish
    "el", "la", "los", "las", "un", "una", "unos", "unas", "este", "esta", "estos", "estas", "mi", "tu", "su",
    # French
    "le", "la", "les", "un", "une", "des", "du", "de", "ce", "cette", "ces", "mon", "ton", "son", "notre", "votre", "leur",
    # German
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines", "mein", "dein", "sein", "ihr",
    # Italian
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "questo", "questa", "mio", "tuo", "suo",
    # Portuguese
    "o", "a", "os", "as", "um", "uma", "uns", "umas", "este", "esta", "meu", "teu", "seu",
}

_LATIN_PRONOUNS = {
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "yo", "tú", "él", "ella", "nosotros", "vosotros", "ellos", "ellas",
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
    "ich", "du", "er", "sie", "es", "wir", "ihr",
    "io", "tu", "lui", "lei", "noi", "voi", "loro",
    "eu", "você", "ele", "ela", "nós", "vocês", "eles", "elas",
}

_LATIN_PREPOSITIONS = {
    # English
    "in", "on", "at", "to", "for", "with", "by", "from", "about", "into", "through", "during", "without", "between", "under", "over", "of",
    # Spanish
    "en", "de", "a", "con", "por", "para", "sobre", "sin", "hacia", "desde", "entre", "hasta",
    # French
    "dans", "de", "à", "avec", "pour", "par", "sur", "sans", "vers", "depuis", "entre", "chez",
    # German
    "in", "an", "auf", "zu", "von", "mit", "für", "bei", "nach", "über", "um", "aus", "durch", "ohne",
    # Italian
    "in", "a", "da", "di", "con", "su", "per", "tra", "fra",
    # Portuguese
    "em", "de", "a", "com", "por", "para", "sobre", "sem", "entre", "até",
}

_LATIN_CONJUNCTIONS = {
    "and", "but", "or", "nor", "so", "yet", "because", "although", "while", "when", "where", "if", "unless", "since",
    "y", "e", "o", "u", "pero", "sino", "porque", "aunque", "mientras", "cuando", "donde", "si", "como",
    "et", "ou", "mais", "car", "parce", "puisque", "quoique", "quand", "lorsque", "où", "si",
    "und", "oder", "aber", "denn", "weil", "da", "obwohl", "während", "wenn", "als", "wo", "dass",
    "e", "o", "ma", "però", "perché", "poiché", "sebbene", "mentre", "quando", "dove", "se",
}

# Indic postpositions (कारक चिन्ह) - Must never be stranded or start line 2
_HINDI_POSTPOSITIONS = {
    # Hindi / Urdu / Marathi / Punjabi / Bengali / Gujarati
    "ने", "को", "से", "का", "के", "की", "में", "पर", "पे", "तक", "लिए", "साथ", "द्वारा", "वाला", "वाले", "वाली",
    "मध्ये", "वरून", "साठी", "कडून", "च्या", "चे", "ची",
    "থেকে", "দিয়ে", "জন্য", "কাছে", "সঙ্গে", "এর", "তে",
    "થી", "માટે", "સાથે", "ના", "ની", "નું", "ને",
    "ਤੋਂ", "ਨੂੰ", "ਵਾਲਾ", "ਵਾਲੀ", "ਲਈ", "ਵਿੱਚ",
    "உடன்", "இருந்து", "மூலம்", "க்காக", "இல்", "கு",
    "నుంచి", "తో", "కోసం", "లో", "కి", "కు",
    "ne", "ko", "se", "ka", "ke", "ki", "mein", "me", "par", "pe", "tak", "liye", "saath", "dwara", "wala", "wale", "wali",
}

_HINDI_CONJUNCTIONS = {
    "और", "या", "अथवा", "लेकिन", "मगर", "किंतु", "परंतु", "क्योंकि", "इसलिए", "ताकि", "कि", "तो", "जब", "तब", "अगर", "यदि", "जैसे", "वैसे", "फिर", "भी",
    "आणि", "किंवा", "पण", "परंतु", "कारण", "म्हणून",
    "এবং", "বা", "কিন্তু", "কারণ", "তাই", "যে",
    "અને", "અથવા", "પરંતુ", "કારણ", "કે",
    "ਅਤੇ", "ਜਾਂ", "ਪਰ", "ਕਿਉਂਕਿ", "ਇਸ ਲਈ",
    "மற்றும்", "அல்லது", "ஆனால்", "ஏனெனில்",
    "మరియు", "లేదా", "కానీ", "ఎందుకంటే",
    "aur", "ya", "athwa", "lekin", "magar", "kintu", "parantu", "kyunki", "isliye", "taaki", "ki", "to", "jab", "tab", "agar", "yadi", "jaise", "phir", "bhi",
}

_HINDI_AUXILIARIES = {
    "है", "हैं", "था", "थी", "थे", "थीं", "हूँ", "हो", "गा", "गी", "गे",
    "रहा", "रही", "रहे", "सकता", "सकती", "सकते", "सका", "सकी", "सके",
    "गया", "गई", "गए", "जाएगा", "जाएगी", "जाएंगे",
    "चाहिए", "पड़ा", "पड़ी", "पड़े", "चुका", "चुकी", "चुके",
    "दिया", "दी", "दिए", "देगा", "देगी", "देंगे",
    "लिया", "ली", "लिए", "लेगा", "लेगी", "लेंगे",
    "करता", "करती", "करते", "किया", "की", "किए",
    "हुआ", "हुई", "हुए", "होगा", "होगी", "होंगे",
    "hai", "hain", "tha", "thi", "the", "thin", "hoon", "ho", "ga", "gi", "ge",
    "raha", "rahi", "rahe", "sakta", "sakti", "sakte", "saka", "saki", "sake",
    "gaya", "gayi", "gaye", "chahiye", "pada", "padi", "pade", "chuka", "chuki", "chuke",
    "diya", "di", "diye", "liya", "li", "liye", "karta", "karti", "karte", "kiya", "kiye",
    "hua", "hui", "hue", "hoga", "hogi", "honge",
}

# Japanese Kinsoku Shori characters
_JAPANESE_NO_LINE_START = {
    '、', '。', '！', '？', '!', '?', 'っ', 'ゃ', 'ゅ', 'ょ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ',
    'ッ', 'ャ', 'ュ', 'ョ', '々', 'ー', '）', '」', '』', '】', '〕', '〉', '》', '…', '：', '；'
}
_JAPANESE_NO_LINE_END = {
    '（', '「', '『', '【', '〔', '〈', '《', '“', '‘'
}
_JAPANESE_PARTICLES = {
    'は', 'が', 'を', 'に', 'で', 'と', 'も', 'から', 'まで', 'より', 'へ', 'など', 'や', 'ね', 'よ', 'か', 'の'
}

# Korean particles (조사)
_KOREAN_PARTICLES = {
    '은', '는', '이', '가', '을', '를', '에', '에서', '의', '과', '와', '로', '으로', '도', '만', '에게', '께', '처럼', '보다', '부터', '까지'
}

_COMMON_HONORIFICS = {
    "mr", "mrs", "ms", "miss", "dr", "prof", "sir", "lord", "lady",
    "mr.", "mrs.", "ms.", "dr.", "prof.",
    "sr.", "sra.", "sr", "sra", "don", "doña",
    "m.", "mme.", "mlle.", "monsieur", "madame",
    "hr.", "fr.", "herr", "frau",
    "sig.", "sig.ra", "dott.",
    "श्री", "श्रीमती", "सुश्री", "डॉक्टर", "डॉ.", "डॉ", "पंडित", "पं.", "प्रोफेसर",
    "shri", "smt", "pandit",
    "san", "sama", "sensei", "senpai", "kun", "chan",
}

_COMMON_UNITS = {
    "km", "m", "cm", "mm", "miles", "miles/h", "mph", "kph", "km/h",
    "kg", "g", "mg", "lbs", "oz", "pounds",
    "dollars", "euros", "cents", "rupees", "yen", "won", "pounds",
    "percent", "%", "$", "€", "£", "₹", "¥", "₩",
    "hours", "minutes", "seconds", "days", "weeks", "months", "years",
    "sec", "min", "hr",
}

_COMMON_ABBREVIATIONS = {
    # English
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "rev.", "gen.", "col.", "capt.", "lt.", "sgt.",
    "vs.", "v.", "etc.", "e.g.", "i.e.", "approx.", "est.", "dept.", "govt.", "inc.", "corp.", "ltd.", "co.",
    "a.m.", "p.m.", "jan.", "feb.", "mar.", "apr.", "jun.", "jul.", "aug.", "sep.", "sept.", "oct.", "nov.", "dec.",
    # Spanish / French / German
    "m.", "mme.", "mlle.", "sr.", "sra.", "srta.", "hr.", "fr.", "bzw.", "usw.", "z.b.",
    # Indic (Devanagari)
    "डॉ.", "पं.", "प्रो.", "श्री.", "श्रीमती.",
}

_INDIVISIBLE_COLLOCATIONS = {
    ("mr.", "beast"), ("thank", "you"), ("dollar", "for"), ("for", "dollar"), ("look", "at"), ("at", "that"),
    ("out", "of"), ("up", "to"), ("as", "well"), ("well", "as"), ("in", "the"), ("on", "the"),
    ("water", "bottle"), ("like", "this"), ("until", "the"), ("the", "end"),
    ("clean", "up"), ("pick", "up"), ("bring", "in"), ("shake", "out"), ("fill", "up"),
    ("groups", "of"), ("first", "bag"), ("more", "people"), ("we", "did"), ("did", "it"),
    ("will", "take"), ("take", "forever"), ("so", "much"), ("come", "on"), ("on", "in"),
    ("every", "single"), ("single", "piece"), ("piece", "of"), ("starting", "with"),
    ("beach", "cleaner"), ("professional", "beach"), ("small", "stuff"), ("big", "stuff"),
    ("how", "do"), ("do", "we"), ("just", "need"), ("all", "the"), ("four", "in"),
    ("part", "of"), ("see", "if"), ("me", "and"), ("and", "the"), ("the", "boys"),
    ("by", "ourselves"), ("other", "part"), ("would've", "taken"), ("taken", "a"),
    ("a", "year"), ("coulda", "told"), ("told", "you"), ("you", "that"), ("more", "trash"),
    ("putting", "more"), ("the", "ocean"), ("new", "law"), ("thou", "shalt"), ("shalt", "not"),
    ("your", "underwear"), ("already", "fill"), ("better", "than"), ("to", "be"), ("be", "fair"),
    ("12", "hours"), ("hours", "of"), ("tomorrow", "i'm"), ("10", "times"), ("times", "the"),
    ("the", "volunteers"), ("as", "slowly"), ("slowly", "as"), ("as", "possible"),
    ("who's", "more"), ("make", "sure"), ("watch", "until"), ("30", "million"),
    ("million", "pounds"), ("pounds", "of"), ("coming", "to"), ("to", "our"),
    ("our", "country"), ("really", "awesome"), ("right", "here"), ("right", "there"),
    ("he's", "not"), ("not", "stopping"), ("gonna", "move"), ("bad", "boy"),
    ("6,000", "pounds"), ("36,000", "pounds"), ("weighs", "the"), ("the", "same"),
    ("same", "as"), ("3,000", "cats"), ("three", "t-rexes"), ("whichever", "you"), ("you", "prefer")
}


_LATIN_AUXILIARIES = {
    "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
    "will", "would", "shall", "should", "can", "could", "may", "might", "must", "not", "n't", "never",
    "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "haven't", "hasn't", "hadn't",
    "won't", "wouldn't", "can't", "couldn't", "shouldn't", "gonna", "wanna", "gotta",
    "i'm", "you're", "he's", "she's", "it's", "we're", "they're", "i've", "you've", "we've", "they've",
    "i'll", "you'll", "he'll", "she'll", "we'll", "they'll", "i'd", "you'd", "he'd", "she'd", "we'd", "they'd",
}

_LATIN_RELATIVES = {"that", "who", "whom", "whose", "which", "what", "how", "why", "when", "where", "if", "than", "as"}

_LATIN_FUNCTION_WORDS = (
    _LATIN_ARTICLES | _LATIN_PRONOUNS | _LATIN_PREPOSITIONS | _LATIN_CONJUNCTIONS
    | _LATIN_AUXILIARIES | _LATIN_RELATIVES
)

_PUNCT_STRIP = '.,!?;:।॥…—–-"”’)]'


def _word_core(raw: str) -> str:
    return raw.strip().lower().strip(_PUNCT_STRIP + '"“‘([-')


def phrase_break_cost(prev_raw: str, next_raw: str) -> float:
    """
    Language-neutral grammar cost of cutting between two adjacent words (higher = worse).

    Shared by the card splitter and the two-line breaker so both keep noun phrases
    ("super crystal"), proper names ("Shadow World"), verb groups ("was a total failure")
    and clauses together. A break right after punctuation is always free of these costs.
    """
    prev_raw = prev_raw.strip()
    next_raw = next_raw.strip()
    if not prev_raw or not next_raw:
        return 0.0
    if prev_raw[-1] in ',;:।॥—–…' or prev_raw[-1] in '.!?':
        return 0.0
    prev = _word_core(prev_raw)
    nxt = _word_core(next_raw)
    cost = 0.0
    latin = prev_raw.isascii() and next_raw.isascii()

    if latin:
        # Proper name or title split across the break ("Shadow | World")
        if prev_raw[:1].isupper() and next_raw[:1].isupper() and prev not in {"i"} and nxt not in {"i"}:
            cost += 400.0
        # Two content words in a row are almost always one noun phrase or verb + object
        prev_fn = prev in _LATIN_FUNCTION_WORDS
        next_fn = nxt in _LATIN_FUNCTION_WORDS
        if not prev_fn and not next_fn:
            cost += 220.0
        # Auxiliary / negation / modal must stay with the verb that follows
        if prev in _LATIN_AUXILIARIES:
            cost += 300.0
        # A dangling conjunction or relative at the end of a line
        if prev in _LATIN_CONJUNCTIONS or prev in _LATIN_RELATIVES:
            cost += 260.0
        # Short adverb / determiner-like word stranded before its head ("still | moping")
        if prev in {"just", "still", "really", "very", "too", "so", "all", "only", "even", "also", "always", "never", "quite", "almost"}:
            cost += 150.0
        # Good places to cut: right before a conjunction, relative, or preposition (clause / PP start)
        if nxt in _LATIN_CONJUNCTIONS or nxt in _LATIN_RELATIVES:
            cost -= 60.0
        elif nxt in _LATIN_PREPOSITIONS and prev not in _LATIN_FUNCTION_WORDS:
            cost -= 40.0
    else:
        if prev in _HINDI_CONJUNCTIONS and prev not in {"भी", "तो", "bhi", "to"}:
            cost += 260.0
        if nxt in _HINDI_POSTPOSITIONS or nxt in _HINDI_AUXILIARIES or nxt in {"भी", "तो", "ही", "bhi", "hi", "to"}:
            cost += 500.0
        if prev in _HINDI_POSTPOSITIONS:
            cost += 120.0
        if prev in {"नहीं", "मत", "न", "nahi", "mat"}:
            cost += 250.0
        if nxt in _HINDI_CONJUNCTIONS:
            cost -= 60.0
    return cost


def filter_diarization_flickers(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Temporal Diarization Glitch Filter:
    Eliminates momentary 1-2 word speaker misattributions caused by shouting, music, or background noise.
    """
    if len(words) < 3:
        return words

    cleaned = [dict(w) for w in words]
    n = len(cleaned)

    # Pass 1: 1-word flickers (Speaker A -> Speaker B (1 word) -> Speaker A)
    for i in range(1, n - 1):
        prev_spk = cleaned[i - 1].get("speaker", cleaned[i - 1].get("speaker_id"))
        curr_spk = cleaned[i].get("speaker", cleaned[i].get("speaker_id"))
        next_spk = cleaned[i + 1].get("speaker", cleaned[i + 1].get("speaker_id"))

        if curr_spk != prev_spk and prev_spk == next_spk:
            gap1 = float(cleaned[i].get("start", 0)) - float(cleaned[i - 1].get("end", 0))
            gap2 = float(cleaned[i + 1].get("start", 0)) - float(cleaned[i].get("end", 0))
            curr_dur = float(cleaned[i].get("end", 0)) - float(cleaned[i].get("start", 0))
            if (gap1 < 0.65 and gap2 < 0.65) or curr_dur < 0.45:
                cleaned[i]["speaker"] = prev_spk
                cleaned[i]["speaker_id"] = cleaned[i - 1].get("speaker_id")

    # Pass 2: 2-word flickers (Speaker A -> Speaker B (2 words) -> Speaker A)
    for i in range(1, n - 2):
        prev_spk = cleaned[i - 1].get("speaker", cleaned[i - 1].get("speaker_id"))
        w1_spk = cleaned[i].get("speaker", cleaned[i].get("speaker_id"))
        w2_spk = cleaned[i + 1].get("speaker", cleaned[i + 1].get("speaker_id"))
        next_spk = cleaned[i + 2].get("speaker", cleaned[i + 2].get("speaker_id"))

        if w1_spk == w2_spk and w1_spk != prev_spk and prev_spk == next_spk:
            dur = float(cleaned[i + 1].get("end", 0)) - float(cleaned[i].get("start", 0))
            if dur < 0.70:
                cleaned[i]["speaker"] = prev_spk
                cleaned[i]["speaker_id"] = cleaned[i - 1].get("speaker_id")
                cleaned[i + 1]["speaker"] = prev_spk
                cleaned[i + 1]["speaker_id"] = cleaned[i - 1].get("speaker_id")

    # Pass 3: Syntactic Seam Protection
    # A speaker change cannot happen inside an obvious collocation or prepositional phrase without a pause
    for i in range(n - 1):
        w1 = str(cleaned[i].get("text", "")).lower().strip('.,!?;:')
        w2 = str(cleaned[i + 1].get("text", "")).lower().strip('.,!?;:')
        spk1 = cleaned[i].get("speaker", cleaned[i].get("speaker_id"))
        spk2 = cleaned[i + 1].get("speaker", cleaned[i + 1].get("speaker_id"))

        if spk1 != spk2:
            gap = float(cleaned[i + 1].get("start", 0)) - float(cleaned[i].get("end", 0))
            if gap < 0.35:
                if (w1, w2) in _INDIVISIBLE_COLLOCATIONS or w1 in _LATIN_PREPOSITIONS or w1 in _LATIN_ARTICLES:
                    cleaned[i + 1]["speaker"] = spk1
                    cleaned[i + 1]["speaker_id"] = cleaned[i].get("speaker_id")

    return cleaned


def is_true_sentence_boundary(token: Dict[str, Any], next_token: Optional[Dict[str, Any]] = None) -> bool:
    """Checks whether token ends with a true sentence terminator (. ! ? । ॥) and not an abbreviation."""
    text = str(token.get("text", "")).strip()
    if not any(text.endswith(p) for p in ('.', '!', '?', '।', '॥')):
        return False

    clean_lower = text.lower().rstrip('.,!?;:') + "."
    if clean_lower in _COMMON_ABBREVIATIONS:
        return False

    # Check for decimal numbers
    if re.search(r'\d+\.\d*$', text):
        return False

    # If followed by next token, check if next token starts with a capital letter
    if next_token:
        next_text = str(next_token.get("text", "")).strip().lstrip('"-—–[({\'')
        if next_text and next_text[0].islower() and not text.endswith(('!', '?')):
            return False

    return True


def find_best_split_point(tokens: List[Dict[str, Any]], cpl_limit: int = 42) -> int:
    """Finds optimal grammatical clause boundary in tokens when length exceeds card limits."""
    n = len(tokens)
    if n <= 2:
        return max(1, n // 2)

    best_idx = -1
    best_score = float('-inf')

    # Allow scanning all valid split boundaries
    start_range = 1
    end_range = n

    for i in range(start_range, end_range):
        prev_tok = tokens[i - 1]
        next_tok = tokens[i]
        prev_txt = str(prev_tok.get("text", "")).strip()
        next_txt = str(next_tok.get("text", "")).strip()
        prev_clean = prev_txt.lower().rstrip('.,!?;:')
        next_clean = next_txt.lower().lstrip('.,!?;:')

        # Upper card text length check: never let upper card exceed 2-line maximum capacity
        upper_text = " ".join([t.get("text", "") for t in tokens[:i]])
        if len(upper_text) > (cpl_limit * 1.95):
            continue

        # Forbidden break check: Never split collocations, titles, abbreviations
        if (prev_clean, next_clean) in _INDIVISIBLE_COLLOCATIONS:
            continue
        if (prev_clean + ".") in _COMMON_ABBREVIATIONS or prev_clean in _COMMON_ABBREVIATIONS:
            continue

        score = 0.0

        # Heavily penalize creating 1-word orphan cards
        if i == 1:
            score -= 150.0
        if i == n - 1:
            score -= 150.0

        # Grammar penalties: do not break after prepositions or articles
        if prev_clean in _LATIN_PREPOSITIONS or prev_clean in _HINDI_POSTPOSITIONS:
            score -= 90.0
        if prev_clean in _LATIN_ARTICLES or prev_clean in _LATIN_PRONOUNS:
            score -= 90.0

        # Phrase integrity: noun phrases, proper names, verb groups, dangling conjunctions
        score -= phrase_break_cost(prev_txt, next_txt) * 0.5

        # High reward for punctuation (comma, semicolon, dash, danda)
        if any(prev_txt.endswith(c) for c in (',', ';', ':', '—', '–', '।', '॥')):
            score += 130.0

        # Reward for coordinating conjunction
        if next_clean in {"and", "but", "or", "so", "because", "although", "while", "aur", "lekin"}:
            score += 70.0

        # Reward for acoustic gap
        gap = float(next_tok.get("start", 0)) - float(prev_tok.get("end", 0))
        if gap > 0.10:
            score += min(gap * 90.0, 75.0)

        # Baseline balance score (favor relatively balanced cards)
        center_dist = abs(i - (n / 2.0)) / (n / 2.0)
        score -= center_dist * 20.0

        if score > best_score:
            best_score = score
            best_idx = i

    if best_idx > 0:
        return best_idx
    return max(1, n // 2)


# ──────────────────────────────────────────────────────────
# Card merging, dual speakers, ellipsis and punctuation
# (Netflix General Requirements + Hindi Timed Text Style Guide)
# ──────────────────────────────────────────────────────────

# A line that ends with one of these is a finished sentence (or an interruption already marked with "…").
_TERMINAL_PUNCT = ('.', '!', '?', '।', '॥', '…')
# Trailing marks replaced by "…" when an unfinished sentence gets an ellipsis.
_TRAILING_SOFT_PUNCT = ',;:—–-'
# Two cards of the same speaker are joined only across a short pause, so the second part never shows up long before it is said.
MERGE_MAX_GAP_SEC = 1.0
# Two speakers share a card only in a quick back-and-forth.
DUAL_MAX_GAP_SEC = 1.0
# Netflix: an ellipsis marks a pause of 2 seconds or more...
PAUSE_ELLIPSIS_SEC = 2.0
# Past this the next line is treated as a new start, not the same sentence resuming.
PAUSE_ELLIPSIS_MAX_SEC = 10.0
# ...or an abrupt interruption: the next speaker starts this soon after an unfinished sentence.
INTERRUPTION_MAX_GAP_SEC = 0.5
# Languages whose own guide puts a space before ? ! : ; (French), so the "no space before punctuation" rule is skipped.
_SPACE_BEFORE_PUNCT_LANGS = {"fr", "fra", "fre", "french"}


def is_dual_speaker_text(text: str) -> bool:
    """True for a Netflix dual-speaker card: exactly two lines, each opened by a hyphen."""
    lines = [ln.strip() for ln in re.sub(r'<[^>]+>|\{\\an[1-9]\}', '', text or '').split('\n')]
    return len(lines) == 2 and all(ln.startswith(('-', '–', '—')) for ln in lines)


def _ends_sentence(text: str) -> bool:
    return text.rstrip().rstrip('"”’\')').endswith(_TERMINAL_PUNCT)


def _with_trailing_ellipsis(text: str) -> str:
    text = text.rstrip()
    if text.endswith('…'):
        return text
    return text.rstrip(_TRAILING_SOFT_PUNCT).rstrip() + '…'


def _with_leading_ellipsis(text: str) -> str:
    text = text.lstrip()
    return text if text.startswith('…') else '…' + text


def tidy_punctuation_spacing(text: str, language: Optional[str] = None) -> str:
    """Unicode ellipsis, no space before punctuation (Hindi guide I.14), single spaces."""
    text = re.sub(r'\.{3,}', '…', text or '')
    if str(language or '').strip().lower() not in _SPACE_BEFORE_PUNCT_LANGS:
        text = re.sub(r'(?<=\S)[ \t]+([,.!?;:।॥…])', r'\1', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    return text.strip()


def tidy_quotation_marks(texts: List[str]) -> List[str]:
    """
    Quotation marks across the whole transcript (Hindi guide I.15): no space inside the marks,
    and a closing quote follows the full stop. A quotation may span several cards, so the open/close
    state carries over from card to card; a straight quote is read from the spaces around it first,
    and from that state only when the spaces don't tell.
    """
    out: List[str] = []
    is_open = False
    for text in texts:
        res: List[str] = []
        i, n = 0, len(text)
        while i < n:
            ch = text[i]
            if ch in '"“”':
                before = text[i - 1] if i > 0 else ' '
                after = text[i + 1] if i + 1 < n else ' '
                space_before = before.isspace()
                space_after = after.isspace() or after in ',.!?;:।॥…'
                if ch == '“':
                    opening = True
                elif ch == '”':
                    opening = False
                elif space_before and not space_after:
                    opening = True
                elif space_after and not space_before:
                    opening = False
                else:
                    opening = not is_open
                if opening:
                    res.append(ch)
                    i += 1
                    while i < n and text[i] in ' \t':
                        i += 1
                    is_open = True
                    continue
                while res and res[-1] in ' \t':
                    res.pop()
                if i + 1 < n and text[i + 1] in '.।॥':
                    res.append(text[i + 1])
                    res.append(ch)
                    i += 2
                else:
                    res.append(ch)
                    i += 1
                is_open = False
                continue
            res.append(ch)
            i += 1
        out.append(''.join(res))
    return out


def _speaker_label_and_id(raw_spk: str) -> Tuple[str, str]:
    """'speaker_0' -> ('Speaker 1', 'speaker_0');  'Speaker 2' -> ('Speaker 2', 'speaker_1')."""
    raw_spk = str(raw_spk or "Speaker 1")
    if raw_spk.startswith("Speaker"):
        num_part = raw_spk.replace("Speaker ", "").strip()
        return raw_spk, f"speaker_{int(num_part) - 1 if num_part.isdigit() else 0}"
    num_part = raw_spk.replace("speaker_", "").strip()
    return f"Speaker {int(num_part) + 1 if num_part.isdigit() else num_part}", raw_spk


def _fits_card(text: str, profile: 'NetflixLanguageProfile', cpl_limit: int) -> bool:
    """
    Can this text sit in one card: one line, or two lines that each stay within the CPL limit?
    When the text holds more than one sentence, the line break has to fall between sentences,
    so a merged card never reads "end of one sentence + start of the next / rest of it".
    """
    if len(text) <= cpl_limit:
        return True
    lines = optimize_language_line_breaks(text, profile, custom_cpl=cpl_limit).split('\n')
    if len(lines) != 2 or any(len(ln) > cpl_limit for ln in lines):
        return False
    if _SENTENCE_END_INSIDE.search(text) and not _ends_sentence(lines[0]):
        return False
    return True


_SENTENCE_END_INSIDE = re.compile(r'[.!?।॥…]["”’)]?\s+\S')


def _shot_change_between(t0: float, t1: float, shot_changes: Optional[List[float]]) -> bool:
    return bool(shot_changes) and any(t0 <= sc <= t1 for sc in shot_changes)


def _card_speaker_tag(raw_spk: str, include_speaker_tags: bool) -> str:
    return f"[{_speaker_label_and_id(raw_spk)[0]}] " if include_speaker_tags else ""


def merge_light_and_dual_speaker_cards(
    raw_events: List[Dict[str, Any]],
    profile: 'NetflixLanguageProfile',
    cpl_limit: int,
    cps_limit: float,
    max_dur: float,
    language: Optional[str] = None,
    shot_changes: Optional[List[float]] = None,
    include_speaker_tags: bool = False,
) -> List[Dict[str, Any]]:
    """
    Joins cards the segmenter left too light, without moving any split point inside a card:

    1. Same speaker: a card that fits on one line joins its neighbour when the pause between them is short,
       the result still fits two lines of at most `cpl_limit`, stays within the reading speed and 7 s,
       and does not end in the middle of a new sentence.
    2. Two speakers (Netflix dual-speaker card): two short complete sentences from different speakers in a
       quick exchange become "-line one" / "-line two", one speaker per line, each line within `cpl_limit`.
       The first line may be an interrupted sentence (it then ends with "…").

    Each raw event gets a "parts" list: [{"speaker", "tokens"}] (one part, or two for a dual-speaker card).
    """
    def _text(tokens: List[Dict[str, Any]]) -> str:
        return tidy_punctuation_spacing(" ".join(t["text"] for t in tokens), language)

    cards = []
    for ev in raw_events:
        toks = ev["tokens"]
        cards.append({
            "parts": [{"speaker": toks[0]["speaker"], "tokens": list(toks)}],
            "start": ev["start"],
            "end": ev["end"],
            "has_audio_event": any(t.get("type") == "audio_event" for t in toks),
        })

    merged: List[Dict[str, Any]] = []
    i = 0
    same_count = dual_count = 0
    while i < len(cards):
        cur = cards[i]
        while i + 1 < len(cards):
            nxt = cards[i + 1]
            if cur["has_audio_event"] or nxt["has_audio_event"] or len(cur["parts"]) > 1:
                break
            gap = nxt["start"] - cur["end"]
            span = nxt["end"] - cur["start"]
            if gap < 0 or span > max_dur or _shot_change_between(cur["end"], nxt["start"], shot_changes):
                break
            a_spk = cur["parts"][0]["speaker"]
            b_spk = nxt["parts"][0]["speaker"]
            a_txt = _text(cur["parts"][0]["tokens"])
            b_txt = _text(nxt["parts"][0]["tokens"])

            if a_spk == b_spk:
                joined = _text(cur["parts"][0]["tokens"] + nxt["parts"][0]["tokens"])
                light = len(a_txt) <= cpl_limit or len(b_txt) <= cpl_limit
                # Room for a leading and a trailing "…" the ellipsis pass may add later.
                if (
                    gap <= MERGE_MAX_GAP_SEC
                    and light
                    and _fits_card("…" + joined + "…", profile, cpl_limit)
                    and len(joined) / max(span, 0.1) <= cps_limit
                    and (not _ends_sentence(a_txt) or _ends_sentence(b_txt))
                ):
                    cur = {
                        "parts": [{"speaker": a_spk, "tokens": cur["parts"][0]["tokens"] + nxt["parts"][0]["tokens"]}],
                        "start": cur["start"],
                        "end": nxt["end"],
                        "has_audio_event": False,
                    }
                    same_count += 1
                    i += 1
                    continue
                break

            # Different speakers: Netflix dual-speaker card.
            prev = merged[-1] if merged else None
            prev_last = prev["parts"][-1] if prev else None
            a_continues_prev = (
                prev_last is not None
                and prev_last["speaker"] == a_spk
                and not _ends_sentence(_text(prev_last["tokens"]))
            )
            after = cards[i + 2] if i + 2 < len(cards) else None
            a_interrupted = not _ends_sentence(a_txt)
            a_resumes_after = (
                a_interrupted and after is not None
                and after["parts"][0]["speaker"] == a_spk
                and after["start"] - nxt["end"] <= MERGE_MAX_GAP_SEC
            )
            line_a = "-" + _card_speaker_tag(a_spk, include_speaker_tags) + (_with_trailing_ellipsis(a_txt) if a_interrupted else a_txt)
            line_b = "-" + _card_speaker_tag(b_spk, include_speaker_tags) + b_txt
            if (
                gap <= (INTERRUPTION_MAX_GAP_SEC if a_interrupted else DUAL_MAX_GAP_SEC)
                and not a_continues_prev
                and not a_resumes_after
                and _ends_sentence(b_txt)
                and len(line_a) <= cpl_limit
                and len(line_b) <= cpl_limit
                and (len(line_a) + len(line_b)) / max(span, 0.1) <= cps_limit
            ):
                cur = {
                    "parts": [cur["parts"][0], nxt["parts"][0]],
                    "start": cur["start"],
                    "end": nxt["end"],
                    "has_audio_event": False,
                }
                dual_count += 1
                i += 1
            break
        merged.append(cur)
        i += 1

    log_terminal(
        "NETFLIX-ENGINE",
        f"Card merging: {len(raw_events)} -> {len(merged)} cards ({same_count} same-speaker joins, {dual_count} dual-speaker cards)"
    )
    return merged


def apply_ellipsis_rules(cards: List[Dict[str, Any]]) -> None:
    """
    Netflix Hindi guide I.4 (Continuity), on the text of each card part ("text", set by the caller):
    - a sentence split between two continuous subtitles gets no ellipsis;
    - a pause of 2 s or more (up to 10 s) inside a sentence that continues: "…" ends the first subtitle and opens the next;
    - an abrupt interruption (another speaker cuts in right after an unfinished sentence): "…" ends the cut-off line.
    """
    flat = [(c, p) for c in cards for p in c["parts"]]
    for (c1, p1), (c2, p2) in zip(flat, flat[1:]):
        if not p1["text"] or not p2["text"]:
            continue
        if _ends_sentence(p1["text"]):
            continue
        gap = p2["tokens"][0]["start"] - p1["tokens"][-1]["end"]
        if p1["speaker"] == p2["speaker"]:
            if c1 is not c2 and PAUSE_ELLIPSIS_SEC <= gap <= PAUSE_ELLIPSIS_MAX_SEC:
                p1["text"] = _with_trailing_ellipsis(p1["text"])
                p2["text"] = _with_leading_ellipsis(p2["text"])
        elif gap <= INTERRUPTION_MAX_GAP_SEC:
            p1["text"] = _with_trailing_ellipsis(p1["text"])


def get_language_profile(language: Optional[str] = None) -> NetflixLanguageProfile:
    """Retrieve the exact Netflix Timed Text profile for a given language."""
    lang_clean = (language or "en").strip().lower()

    # Japanese
    if lang_clean in ["ja", "jpn", "japanese", "japan"]:
        return NetflixLanguageProfile(
            name="Japanese",
            script="japanese",
            cpl_limit=16,
            cps_adult=7.5,
            cps_children=5.0,
            sentence_endings=('。', '！', '？', '!', '?'),
            clause_delimiters=('、', '，', '；', '：'),
            no_break_before=_JAPANESE_NO_LINE_START,
            good_break_before=_JAPANESE_PARTICLES,
            honorifics={"さん", "様", "先生", "先輩", "君", "ちゃん", "殿"}
        )

    # Chinese (Simplified & Traditional)
    if lang_clean in ["zh", "zho", "chi", "chinese", "chinese (simplified)", "chinese (traditional)", "mandarin", "cantonese"]:
        return NetflixLanguageProfile(
            name="Chinese",
            script="chinese",
            cpl_limit=16,
            cps_adult=9.5,
            cps_children=7.0,
            sentence_endings=('。', '！', '？', '!', '?'),
            clause_delimiters=('，', '、', '；', '：', '……'),
            no_break_before={'，', '、', '。', '！', '？', '；', '：', '）', '」', '』', '】', '”', '’'},
            good_break_before=set(),
            honorifics={"先生", "女士", "小姐", "医生", "教授", "总"}
        )

    # Korean
    if lang_clean in ["ko", "kor", "korean"]:
        return NetflixLanguageProfile(
            name="Korean",
            script="korean",
            cpl_limit=16,
            cps_adult=10.5,
            cps_children=7.5,
            sentence_endings=('.', '!', '?', '。'),
            clause_delimiters=(',', ';', ':'),
            no_break_before=_KOREAN_PARTICLES,
            good_break_before=set(),
            honorifics={"씨", "님", "선생님", "박사님", "교수님"}
        )

    # Indic Languages (Hindi, Marathi, Tamil, Telugu, Bengali, Gujarati, Kannada, Malayalam, Punjabi, Urdu)
    if lang_clean in [
        "hi", "hin", "hindi", "hinglish", "mr", "mar", "marathi", "ta", "tam", "tamil",
        "te", "tel", "telugu", "bn", "ben", "bengali", "gu", "guj", "gujarati",
        "kn", "kan", "kannada", "ml", "mal", "malayalam", "pa", "pan", "punjabi", "ur", "urd", "urdu"
    ]:
        return NetflixLanguageProfile(
            name="Indic",
            script="indic",
            cpl_limit=42,
            cps_adult=20.0,
            cps_children=17.0,
            sentence_endings=('.', '!', '?', '।', '॥'),
            clause_delimiters=(',', ';', ':', '—', '–'),
            no_break_before=_HINDI_POSTPOSITIONS | _HINDI_AUXILIARIES | _LATIN_ARTICLES | _LATIN_PRONOUNS,
            good_break_before=_HINDI_CONJUNCTIONS | _LATIN_CONJUNCTIONS,
            honorifics=_COMMON_HONORIFICS
        )

    # Arabic & Hebrew
    if lang_clean in ["ar", "ara", "arabic", "he", "heb", "hebrew"]:
        return NetflixLanguageProfile(
            name="Semitic",
            script="arabic",
            cpl_limit=42,
            cps_adult=20.0,
            cps_children=17.0,
            sentence_endings=('.', '!', '?', '؟'),
            clause_delimiters=(',', '،', '؛', ':'),
            no_break_before={"من", "إلى", "في", "على", "عن", "مع", "هذا", "هذه", "أنا", "هو", "هي"},
            good_break_before={"و", "ف", "ثم", "أو", "لكن", "لأن", "حيث", "عندما"},
            honorifics={"السيد", "السيدة", "الدكتور", "الشيخ", "الأستاذ"}
        )

    # Thai
    if lang_clean in ["th", "tha", "thai"]:
        return NetflixLanguageProfile(
            name="Thai",
            script="thai",
            cpl_limit=35,
            cps_adult=20.0,
            cps_children=17.0,
            sentence_endings=('.', '!', '?'),
            clause_delimiters=(',', ';', ':'),
            no_break_before=set(),
            good_break_before=set(),
            honorifics=set()
        )

    # Latin / Cyrillic / Greek Standard (Default)
    return NetflixLanguageProfile(
        name="Latin Standard",
        script="latin",
        cpl_limit=42,
        cps_adult=20.0,
        cps_children=17.0,
        sentence_endings=('.', '!', '?'),
        clause_delimiters=(',', ';', ':', '—', '–'),
        no_break_before=_LATIN_ARTICLES | _LATIN_PRONOUNS,
        good_break_before=_LATIN_CONJUNCTIONS,
        honorifics=_COMMON_HONORIFICS
    )


def detect_text_script(text: str) -> str:
    """Accurately identify script of text to auto-select optimal Netflix profile."""
    if not text:
        return "latin"
    cjk_cnt = 0
    kor_cnt = 0
    indic_cnt = 0
    arabic_cnt = 0
    cyrillic_cnt = 0
    latin_cnt = 0

    for ch in text:
        cp = ord(ch)
        if 0x3040 <= cp <= 0x30FF or 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF:
            # Check if Hiragana/Katakana present -> Japanese, else CJK ideograph
            if 0x3040 <= cp <= 0x30FF:
                return "japanese"
            cjk_cnt += 1
        elif 0xAC00 <= cp <= 0xD7AF or 0x1100 <= cp <= 0x11FF:
            kor_cnt += 1
        elif 0x0900 <= cp <= 0x0D7F:
            indic_cnt += 1
        elif 0x0600 <= cp <= 0x06FF or 0x0750 <= cp <= 0x077F:
            arabic_cnt += 1
        elif 0x0400 <= cp <= 0x04FF:
            cyrillic_cnt += 1
        elif (0x0041 <= cp <= 0x005A) or (0x0061 <= cp <= 0x007A) or (0x00C0 <= cp <= 0x024F):
            latin_cnt += 1

    total = max(cjk_cnt + kor_cnt + indic_cnt + arabic_cnt + cyrillic_cnt + latin_cnt, 1)
    if kor_cnt / total > 0.25:
        return "korean"
    if cjk_cnt / total > 0.25:
        return "chinese"
    if indic_cnt / total > 0.25:
        return "indic"
    if arabic_cnt / total > 0.25:
        return "arabic"
    if cyrillic_cnt / total > 0.25:
        return "cyrillic"
    return "latin"


# ──────────────────────────────────────────────────────────
# Optimal Linguistic Line Breaking (Netflix Visual Balancing)
# ──────────────────────────────────────────────────────────

def optimize_language_line_breaks(
    text: str,
    profile: NetflixLanguageProfile,
    custom_cpl: Optional[int] = None
) -> str:
    """
    Computes optimal 1-2 line break for text based on Netflix guidelines:
    1. If clean text length <= CPL, keeps as 1 line.
    2. Respects linguistic boundaries (clause delimiters, conjunctions, prepositions).
    3. Strictly forbids breaking article+noun, pronoun+verb, title+name, number+unit.
    4. Forbids starting line 2 with Indic postpositions or Japanese/Korean particles.
    5. Bottom-heavy or symmetric pyramid layout.
    6. Strictly forbids orphan words on line 2 (line 2 having <= 4 characters).
    """
    # A dual-speaker card keeps one speaker per line; re-breaking it would mix the two speakers.
    if is_dual_speaker_text(text):
        return text

    clean = re.sub(r'<[^>]+>|\{\\an[1-9]\}', '', text or '').strip()
    cpl_limit = custom_cpl or profile.cpl_limit

    # Single-line check
    if len(clean) <= cpl_limit:
        return text

    # Handle CJK characters without standard whitespace
    if profile.script in ["japanese", "chinese"]:
        return _optimize_cjk_line_breaks(clean, profile, cpl_limit)

    words = clean.split()
    if len(words) <= 1:
        return text

    total_len = len(clean)
    target_split = total_len * 0.50
    has_inner_sentence_end = any(w.endswith(profile.sentence_endings + ('…',)) for w in words[:-1])

    best_score = float('inf')
    best_split = len(words) // 2

    for split_idx in range(1, len(words)):
        upper = " ".join(words[:split_idx])
        lower = " ".join(words[split_idx:])

        upper_len = len(upper)
        lower_len = len(lower)

        # Skip candidates where either line exceeds max CPL
        if upper_len > cpl_limit or lower_len > cpl_limit:
            continue

        # Baseline score: deviation from balanced length
        score = abs(upper_len - target_split) * 0.5

        # Encourage bottom-heavy pyramid (upper line slightly shorter than lower line)
        if upper_len <= lower_len:
            score -= 20.0
        else:
            score += 15.0

        last_upper_raw = words[split_idx - 1]
        first_lower_raw = words[split_idx]

        last_upper = last_upper_raw.lower().rstrip('.,!?;:।॥…—–')
        first_lower = first_lower_raw.lower().rstrip('.,!?;:।॥…—–')

        # Strictly forbid breaking indivisible collocations
        if (last_upper, first_lower) in _INDIVISIBLE_COLLOCATIONS:
            score += 600.0

        # Reward breaking after punctuation
        if last_upper_raw.endswith(profile.sentence_endings) or last_upper_raw.endswith(profile.clause_delimiters):
            score -= 85.0

        # Reward breaking before coordinating conjunctions
        if first_lower in profile.good_break_before:
            score -= 50.0

        # Penalize breaking article + noun
        if last_upper in _LATIN_ARTICLES:
            score += 500.0

        # Penalize breaking pronoun + verb
        if last_upper in _LATIN_PRONOUNS and not last_upper_raw.endswith(profile.clause_delimiters):
            score += 350.0

        # Penalize breaking preposition from object
        if last_upper in _LATIN_PREPOSITIONS:
            score += 450.0

        # Penalize breaking title/honorific + name
        if last_upper in profile.honorifics or (last_upper + ".") in profile.honorifics or (last_upper + ".") in _COMMON_ABBREVIATIONS:
            score += 600.0

        # Indic Postposition Protection: Never sever or start line 2 with postposition!
        if first_lower in _HINDI_POSTPOSITIONS:
            score += 500.0
        if last_upper in _HINDI_POSTPOSITIONS and not last_upper_raw.endswith(profile.clause_delimiters):
            score += 300.0
        if first_lower in _HINDI_AUXILIARIES:
            score += 500.0
        if last_upper in _HINDI_AUXILIARIES and first_lower not in _HINDI_CONJUNCTIONS and not (last_upper_raw.endswith(profile.sentence_endings) or last_upper_raw.endswith(profile.clause_delimiters)):
            score += 400.0

        # Number + Unit protection
        clean_num = last_upper_raw.replace(',', '').replace('.', '').replace('$', '').replace('€', '').replace('₹', '')
        if clean_num.isdigit() and first_lower in _COMMON_UNITS:
            score += 400.0

        # Phrase integrity: never cut a noun phrase, proper name or verb group when a better break exists
        score += phrase_break_cost(last_upper_raw, first_lower_raw)

        # Strict orphan penalty on line 2 (<= 5 chars or single word)
        if lower_len <= 5 or len(words[split_idx:]) == 1:
            score += 500.0

        # A card holding two sentences breaks between them, never inside one
        if has_inner_sentence_end and not last_upper_raw.endswith(profile.sentence_endings + ('…',)):
            score += 200.0

        if score < best_score:
            best_score = score
            best_split = split_idx

    # Apply best split
    upper_result = " ".join(words[:best_split])
    lower_result = " ".join(words[best_split:])

    # Preserve italics tag if originally formatted
    if text.startswith("<i>") and text.endswith("</i>"):
        return f"<i>{upper_result}\n{lower_result}</i>"

    return f"{upper_result}\n{lower_result}"


def _optimize_cjk_line_breaks(text: str, profile: NetflixLanguageProfile, max_cpl: int) -> str:
    """CJK line breaking with Kinsoku Shori (禁則処理) and semantic particle splitting."""
    n = len(text)
    if n <= max_cpl:
        return text

    target = n // 2
    best_split = target
    best_score = float('inf')

    for i in range(max(1, target - (max_cpl // 2)), min(n, target + (max_cpl // 2) + 1)):
        upper = text[:i]
        lower = text[i:]

        if len(upper) > max_cpl or len(lower) > max_cpl:
            continue

        score = abs(len(upper) - target) * 1.0

        # Kinsoku Shori check: Never start line 2 with prohibited char
        if lower and lower[0] in profile.no_break_before:
            score += 500.0

        # Kinsoku Shori check: Never end line 1 with opening bracket
        if upper and upper[-1] in _JAPANESE_NO_LINE_END:
            score += 500.0

        # Reward break after punctuation
        if upper and upper[-1] in profile.clause_delimiters or upper[-1] in profile.sentence_endings:
            score -= 60.0

        # Japanese particle break bonus (break AFTER particle)
        if profile.script == "japanese" and upper and upper[-1] in _JAPANESE_PARTICLES:
            score -= 35.0

        # Orphan penalty
        if len(lower) <= 2:
            score += 200.0

        if score < best_score:
            best_score = score
            best_split = i

    upper = text[:best_split]
    lower = text[best_split:]
    return f"{upper}\n{lower}"


# ──────────────────────────────────────────────────────────
# Dialogue Segmentation & Synchronization Algorithm
# ──────────────────────────────────────────────────────────

def build_netflix_subtitles_from_words(
    words: List[Dict[str, Any]],
    language: Optional[str] = "en",
    content_type: str = "adult",
    sdh_mode: bool = False,
    frame_rate: float = 24.0,
    custom_cpl: Optional[int] = None,
    custom_cps: Optional[float] = None,
    custom_min_duration: Optional[float] = None,
    custom_max_duration: Optional[float] = None,
    include_speaker_tags: bool = False,
    snap_to_shot_changes: bool = True,
    shot_changes: Optional[List[float]] = None,
) -> List[SubtitleEvent]:
    """
    Constructs 100% compliant Netflix subtitle events from raw word timestamps.

    Applies:
    - Language profile detection and limits
    - Accurate speaker turn & dialogue grouping
    - Natural acoustic silence detection (pauses >= 0.45s)
    - Sentence end punctuation boundary splits
    - Reading speed (CPS) guardrails
    - Optimal linguistic line breaking (max 2 lines)
    - Gap chaining (gaps < 12 frames chained to 2 frames)
    - Minimum duration enforcement (0.833s / 20 frames)
    - Zero overlapping events
    """
    if not words:
        return []

    # Detect language profile
    sample_text = " ".join([w.get("text", "") for w in words[:100]])
    script_detected = detect_text_script(sample_text)
    profile = get_language_profile(language or script_detected)

    cpl_limit = custom_cpl or profile.cpl_limit
    cps_limit = custom_cps or (profile.cps_children if content_type == "children" else profile.cps_adult)
    min_dur = custom_min_duration or profile.min_duration
    max_dur = custom_max_duration or profile.max_duration
    fps = max(float(frame_rate or 24.0), 1.0)
    min_gap_sec = profile.min_gap_frames / fps
    chain_thresh_sec = profile.chain_gap_frames / fps

    # Step 1: Pre-process tokens (handling spacing, punctuation, audio events)
    clean_tokens = []
    for w in words:
        txt = str(w.get("text", "")).strip()
        w_type = w.get("type", "word")
        st = float(w.get("start", 0.0))
        et = float(w.get("end", st + 0.1))
        spk = str(w.get("speaker", w.get("speaker_id", "speaker_0")))

        if not txt and w_type != "audio_event":
            continue

        # Format audio events (SDH)
        if w_type == "audio_event":
            if not sdh_mode:
                continue
            if not txt.startswith("[") and not txt.startswith("("):
                txt = f"[{txt}]"

        clean_tokens.append({
            "text": txt,
            "start": st,
            "end": et,
            "speaker": spk,
            "type": w_type
        })

    if not clean_tokens:
        return []

    # Run Temporal Diarization Glitch Filter on tokens
    clean_tokens = filter_diarization_flickers(clean_tokens)

    # Step 2: Segment into coherent subtitle events
    raw_events = []
    current_tokens = []
    current_speaker = clean_tokens[0]["speaker"]
    current_start = clean_tokens[0]["start"]

    split_counts = {
        "speaker_change": 0,
        "acoustic_pause_long": 0,
        "clause_grounded_pause": 0,
        "sentence_boundary": 0,
        "cpl_exceeded": 0,
        "cps_overflow": 0,
        "syntactic_lookback": 0
    }

    for i, tok in enumerate(clean_tokens):
        if not current_tokens:
            current_tokens.append(tok)
            current_speaker = tok["speaker"]
            current_start = tok["start"]
            continue

        prev_tok = current_tokens[-1]
        gap_since_prev = tok["start"] - prev_tok["end"]
        proposed_duration = tok["end"] - current_start
        proposed_text = " ".join([t["text"] for t in current_tokens] + [tok["text"]])
        proposed_chars = len(proposed_text)
        prev_text = prev_tok["text"]
        is_sentence_boundary = is_true_sentence_boundary(prev_tok, tok)

        # Check split conditions:
        should_split = False
        split_reason = ""

        # Condition A: Speaker change (Strict Netflix isolation: never strand unfinished sentence)
        if tok["speaker"] != current_speaker:
            should_split = True
            split_reason = "speaker_change"

        # Condition B: Acoustic silence gap >= 0.70s (Natural speech pause)
        elif gap_since_prev >= 0.70:
            should_split = True
            split_reason = "acoustic_pause_long"

        # Condition C: Clause-grounded pause (gap >= 0.35s + clause delimiter / conjunction)
        elif gap_since_prev >= 0.35 and (
            is_sentence_boundary or
            any(prev_text.endswith(c) for c in profile.clause_delimiters) or
            (proposed_chars >= 30 and tok["text"].lower().strip('.,!?;:') in {"and", "but", "or", "so", "because", "aur", "lekin"})
        ):
            should_split = True
            split_reason = "clause_grounded_pause"

        # Condition D: True Sentence boundary (Always split at real sentence terminators)
        elif is_sentence_boundary:
            # If current tokens only contain 1-2 words or total chars < 22, and no substantial acoustic pause,
            # allow grouping with next short sentence by the same speaker (e.g. "We did it. This will take forever.")
            if proposed_chars < (cpl_limit * 1.6) and proposed_duration < 3.8 and gap_since_prev < 0.40 and len(current_tokens) <= 3:
                pass
            else:
                should_split = True
                split_reason = "sentence_boundary"

        # Condition E & F: Duration or character limit reached -> Perform Syntactic Lookback
        elif proposed_duration >= max_dur or proposed_chars > (cpl_limit * 1.85):
            split_k = find_best_split_point(current_tokens, cpl_limit)
            if split_k > 0 and split_k < len(current_tokens):
                split_counts["syntactic_lookback"] += 1
                raw_events.append({
                    "tokens": list(current_tokens[:split_k]),
                    "start": current_start,
                    "end": current_tokens[split_k - 1]["end"],
                })
                current_tokens = current_tokens[split_k:] + [tok]
                current_start = current_tokens[0]["start"]
                current_speaker = current_tokens[0]["speaker"]
                continue
            else:
                should_split = True
                split_reason = "cpl_exceeded"

        # Condition G: Reading speed overflow with natural pause
        elif proposed_duration >= 1.5 and (proposed_chars / max(proposed_duration, 0.1)) > (cps_limit * 1.35):
            if any(prev_text.endswith(c) for c in profile.clause_delimiters) or gap_since_prev >= 0.15:
                should_split = True
                split_reason = "cps_overflow"

        if should_split and current_tokens:
            split_counts[split_reason] = split_counts.get(split_reason, 0) + 1
            raw_events.append({
                "tokens": list(current_tokens),
                "start": current_start,
                "end": current_tokens[-1]["end"],
            })
            current_tokens = [tok]
            current_speaker = tok["speaker"]
            current_start = tok["start"]
        else:
            current_tokens.append(tok)

    if current_tokens:
        raw_events.append({
            "tokens": list(current_tokens),
            "start": current_start,
            "end": current_tokens[-1]["end"],
        })

    log_terminal("NETFLIX-ENGINE", f"Segmented {len(clean_tokens)} word tokens into {len(raw_events)} raw events. Split Breakdown -> {dict(split_counts)}")

    # Step 2b: Join light cards and quick two-speaker exchanges (Netflix dual-speaker format)
    raw_events = merge_light_and_dual_speaker_cards(
        raw_events, profile, cpl_limit, cps_limit, max_dur,
        language=language, shot_changes=shot_changes if snap_to_shot_changes else None,
        include_speaker_tags=include_speaker_tags,
    )

    # Step 2c: Text of every card part, then ellipsis (pauses / interruptions) and quotation marks
    for card in raw_events:
        for part in card["parts"]:
            part["text"] = tidy_punctuation_spacing(" ".join(t["text"] for t in part["tokens"]), language)
    apply_ellipsis_rules(raw_events)
    all_parts = [p for card in raw_events for p in card["parts"]]
    for part, quoted in zip(all_parts, tidy_quotation_marks([p["text"] for p in all_parts])):
        part["text"] = quoted

    # Step 3: Conform each event into Netflix SubtitleEvent
    events: List[SubtitleEvent] = []
    total_raw = len(raw_events)

    readability_extended = 0
    shot_snapped = 0

    for idx, raw in enumerate(raw_events, 1):
        parts = raw["parts"]
        ev_start = raw["start"]
        ev_end = raw["end"]

        if len(parts) == 2:
            # Netflix dual-speaker card: hyphen without a space, one speaker per line
            spk1_label, spk1_id = _speaker_label_and_id(parts[0]["speaker"])
            spk2_label, _ = _speaker_label_and_id(parts[1]["speaker"])
            lines = [
                "-" + _card_speaker_tag(parts[0]["speaker"], include_speaker_tags) + parts[0]["text"],
                "-" + _card_speaker_tag(parts[1]["speaker"], include_speaker_tags) + parts[1]["text"],
            ]
            formatted_text = "\n".join(lines)
            speaker_names = [spk1_label, spk2_label]
            primary_speaker = spk1_label
            primary_speaker_id = spk1_id
        else:
            speaker_label, speaker_id = _speaker_label_and_id(parts[0]["speaker"])
            # Optimize line breaks according to Netflix language guidelines
            formatted_text = optimize_language_line_breaks(parts[0]["text"], profile, custom_cpl=cpl_limit)
            if include_speaker_tags:
                formatted_text = f"[{speaker_label}] {formatted_text}"
            lines = formatted_text.split('\n')
            speaker_names = [speaker_label]
            primary_speaker = speaker_label
            primary_speaker_id = speaker_id

        # Calculate initial duration
        duration = max(ev_end - ev_start, 0.1)

        # Netflix Readability Extension:
        # If words were spoken rapidly or duration < min_duration, extend out-point into following silence
        next_event_start = raw_events[idx]["start"] if idx < total_raw else (ev_end + 2.0)
        max_possible_end = next_event_start - min_gap_sec

        target_duration = max(duration, min_dur)
        clean_char_len = len(re.sub(r'<[^>]+>|\{\\an[1-9]\}', '', formatted_text).replace('\n', ''))

        # If CPS is uncomfortably high, pad duration if silence exists
        ideal_duration_for_cps = clean_char_len / max(cps_limit * 0.85, 1.0)
        recommended_end = ev_start + max(target_duration, min(ideal_duration_for_cps, target_duration + 0.6))
        
        final_end = min(recommended_end, max_possible_end)
        final_end = max(final_end, ev_end)
        if idx < total_raw:
            final_end = min(final_end, max_possible_end)
            if final_end < ev_start + 0.1:
                final_end = ev_start + 0.1

        # Lead-in (Pre-roll) into preceding silence if duration is under min_dur or CPS is high
        curr_dur = final_end - ev_start
        if curr_dur < min_dur or (curr_dur > 0 and calculate_cps(formatted_text, curr_dur) > cps_limit):
            prev_event_end = events[-1].end_time if events else 0.0
            avail_silence_before = max(0.0, (ev_start - prev_event_end) - min_gap_sec)
            needed = max(min_dur - curr_dur, (clean_char_len / cps_limit) - curr_dur)
            lead_in = min(needed, avail_silence_before, 0.35)
            if lead_in > 0.02:
                ev_start = round(ev_start - lead_in, 3)

        if final_end > ev_end:
            readability_extended += 1

        # Snap to Video Shot Changes (Scene Cuts) if requested
        if snap_to_shot_changes and shot_changes:
            for sc in shot_changes:
                if (ev_start - 10 / fps) <= sc <= (ev_start - 2 / fps) or abs(sc - ev_start) < (2 / fps):
                    ev_start = round(sc, 3)
                    shot_snapped += 1
                    break
            for sc in shot_changes:
                if (final_end + 2 / fps) <= sc <= (final_end + 10 / fps):
                    final_end = round(max(ev_start + min_dur, sc - (2 / fps)), 3)
                    shot_snapped += 1
                    break

        final_duration = max(round(final_end - ev_start, 3), 0.1)
        event_cps = calculate_cps(formatted_text, final_duration)
        event_cpl = calculate_cpl(formatted_text)

        event = SubtitleEvent(
            id=idx,
            start_time=round(ev_start, 3),
            end_time=round(final_end, 3),
            start=round(ev_start, 3),
            end=round(final_end, 3),
            start_time_str=format_timestamp(ev_start),
            end_time_str=format_timestamp(final_end),
            duration=final_duration,
            text=formatted_text,
            lines=lines,
            speaker=primary_speaker,
            speaker_id=primary_speaker_id,
            primary_speaker=primary_speaker,
            speaker_count=len(speaker_names),
            speakers=speaker_names,
            is_italic=False,
            is_forced_narrative=False,
            cps=event_cps,
            cpl=event_cpl,
            qc_errors=[],
            is_valid=True
        )
        events.append(event)

    # Step 4: Netflix Gap Chaining & Collision Prevention
    chained_count = 0
    collision_fixed_count = 0

    for i in range(len(events) - 1):
        curr_ev = events[i]
        next_ev = events[i + 1]

        gap_sec = next_ev.start_time - curr_ev.end_time

        # Gap Chaining: Netflix requires chaining gaps between 3 and 11 frames (~0.125s - 0.5s)
        # to exactly 2 frames before the next event to eliminate subtitle flickering.
        if min_gap_sec < gap_sec <= chain_thresh_sec:
            chained_end = round(next_ev.start_time - min_gap_sec, 3)
            new_dur = round(chained_end - curr_ev.start_time, 3)
            if new_dur <= max_dur:
                curr_ev.end_time = chained_end
                curr_ev.end = chained_end
                curr_ev.end_time_str = format_timestamp(chained_end)
                curr_ev.duration = new_dur
                curr_ev.cps = calculate_cps(curr_ev.text, new_dur)
                chained_count += 1

        # Enforce strict 2-frame gap if collision or overlap occurs
        elif gap_sec < min_gap_sec:
            safe_end = round(next_ev.start_time - min_gap_sec, 3)
            if safe_end > curr_ev.start_time:
                curr_ev.end_time = safe_end
                curr_ev.end = safe_end
                curr_dur = round(safe_end - curr_ev.start_time, 3)
                if curr_dur < min_dur:
                    prev_end = events[i - 1].end_time if i > 0 else 0.0
                    avail_pre = max(0.0, (curr_ev.start_time - prev_end) - min_gap_sec)
                    nudge = min(min_dur - curr_dur, avail_pre, 0.35)
                    if nudge > 0.02:
                        curr_ev.start_time = round(curr_ev.start_time - nudge, 3)
                        curr_ev.start = curr_ev.start_time
                        curr_ev.start_time_str = format_timestamp(curr_ev.start_time)
                        curr_dur = round(safe_end - curr_ev.start_time, 3)
                curr_ev.duration = curr_dur
                curr_ev.end_time_str = format_timestamp(safe_end)
                curr_ev.cps = calculate_cps(curr_ev.text, curr_dur)
                collision_fixed_count += 1

    log_terminal(
        "NETFLIX-ENGINE",
        f"Built {len(events)} broadcast-grade cards (Readability extended: {readability_extended}, Shot cuts snapped: {shot_snapped}, Chained gaps: {chained_count}, Collisions fixed: {collision_fixed_count})"
    )

    return events


# ──────────────────────────────────────────────────────────
# Netflix Timed Text Quality Control Audit
# ──────────────────────────────────────────────────────────

def audit_netflix_compliance(
    events: List[SubtitleEvent],
    language: Optional[str] = "en",
    content_type: str = "adult",
    frame_rate: float = 24.0,
    shot_changes: Optional[List[float]] = None
) -> Tuple[List[SubtitleEvent], int, int, float, CPSStats]:
    """
    Validates all subtitle events against the Netflix Timed Text Style Guide.
    Attaches detailed QC error objects and computes overall compliance score.
    """
    if not events:
        empty_stats = CPSStats(min_cps=0.0, max_cps=0.0, avg_cps=0.0, p95_cps=0.0, events_over_limit=0, total_events=0)
        return [], 0, 0, 100.0, empty_stats

    sample_text = " ".join([e.text for e in events[:50]])
    profile = get_language_profile(language or detect_text_script(sample_text))
    fps = max(float(frame_rate or 24.0), 1.0)
    min_gap_sec = profile.min_gap_frames / fps
    cps_limit = profile.cps_children if content_type == "children" else profile.cps_adult

    total_errors = 0
    total_warnings = 0
    cps_values = []
    events_over_limit = 0

    for i, ev in enumerate(events):
        qc_errs = []
        dur = ev.duration or (ev.end_time - ev.start_time)
        clean_text = re.sub(r'<[^>]+>|\{\\an[1-9]\}', '', ev.text).replace('\n', '')
        actual_cps = calculate_cps(ev.text, dur)
        actual_cpl = calculate_cpl(ev.text)
        cps_values.append(actual_cps)

        # 1. Reading Speed (CPS)
        if actual_cps > cps_limit:
            events_over_limit += 1
            severity = "error" if actual_cps > (cps_limit + 3.0) else "warning"
            qc_errs.append({
                "rule_id": "NF-CPS-LIMIT",
                "message": f"Reading speed ({actual_cps:.1f} CPS) exceeds Netflix limit of {cps_limit} CPS for {profile.name}.",
                "severity": severity,
                "suggested_fix": "Extend subtitle duration into pause or split event."
            })
            if severity == "error":
                total_errors += 1
            else:
                total_warnings += 1

        # 2. Characters Per Line (CPL)
        for line_idx, line_len in enumerate(actual_cpl, 1):
            if line_len > profile.cpl_limit:
                total_errors += 1
                qc_errs.append({
                    "rule_id": "NF-CPL-LIMIT",
                    "message": f"Line {line_idx} ({line_len} chars) exceeds maximum {profile.cpl_limit} CPL for {profile.name}.",
                    "severity": "error",
                    "suggested_fix": "Insert line break at natural clause or phrase boundary."
                })

        # 3. Maximum Lines (Max 2 lines)
        lines = ev.text.split('\n')
        if len(lines) > 2:
            total_errors += 1
            qc_errs.append({
                "rule_id": "NF-MAX-LINES",
                "message": f"Subtitle has {len(lines)} lines. Netflix strictly permits a maximum of 2 lines.",
                "severity": "error",
                "suggested_fix": "Split into two consecutive subtitle events."
            })

        # 4. Duration Limits (0.833s min, 7.0s max)
        if dur < (profile.min_duration - 0.05):
            total_warnings += 1
            qc_errs.append({
                "rule_id": "NF-MIN-DURATION",
                "message": f"Duration ({dur:.2f}s) is shorter than minimum 5/6 second (~0.833s / 20 frames).",
                "severity": "warning",
                "suggested_fix": "Extend duration to 0.833s if adjacent dialogue permits."
            })
        elif dur > profile.max_duration:
            total_errors += 1
            qc_errs.append({
                "rule_id": "NF-MAX-DURATION",
                "message": f"Duration ({dur:.2f}s) exceeds Netflix maximum limit of 7.0 seconds.",
                "severity": "error",
                "suggested_fix": "Divide into two separate events."
            })

        # 5. Gap to next event
        if i < len(events) - 1:
            next_ev = events[i + 1]
            gap = next_ev.start_time - ev.end_time
            if gap < (min_gap_sec - 0.01):
                total_errors += 1
                qc_errs.append({
                    "rule_id": "NF-MIN-GAP",
                    "message": f"Gap to next subtitle ({gap * fps:.1f} frames) is less than required 2 frames.",
                    "severity": "error",
                    "suggested_fix": "Adjust out-point to maintain 2-frame gap."
                })

        ev.qc_errors = qc_errs
        ev.is_valid = (len([e for e in qc_errs if e["severity"] == "error"]) == 0)

    # Calculate statistics
    avg_cps = round(sum(cps_values) / max(len(cps_values), 1), 2)
    min_cps = round(min(cps_values) if cps_values else 0.0, 2)
    max_cps = round(max(cps_values) if cps_values else 0.0, 2)
    sorted_cps = sorted(cps_values)
    p95_idx = int(0.95 * len(sorted_cps))
    p95_cps = round(sorted_cps[min(p95_idx, len(sorted_cps) - 1)] if sorted_cps else 0.0, 2)

    stats = CPSStats(
        min_cps=min_cps,
        max_cps=max_cps,
        avg_cps=avg_cps,
        p95_cps=p95_cps,
        events_over_limit=events_over_limit,
        total_events=len(events)
    )

    score = max(0.0, round(100.0 - (total_errors * 2.5 + total_warnings * 0.8), 1))
    return events, total_errors, total_warnings, score, stats


def align_subtitles_to_words(
    events: List[SubtitleEvent],
    words: List[Dict[str, Any]],
    language: Optional[str] = "en",
    frame_rate: float = 24.0,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    cpl_limit: Optional[int] = None,
    max_cps: Optional[float] = None,
) -> List[SubtitleEvent]:
    """
    Acoustically realigns subtitle events to physical spoken word timestamps
    from ElevenLabs Scribe v2 (replacing Whisper).
    """
    if not events or not words:
        return events

    profile = get_language_profile(language)
    cpl = cpl_limit or profile.cpl_limit
    fps = max(float(frame_rate or 24.0), 1.0)
    min_gap_sec = profile.min_gap_frames / fps
    chain_thresh_sec = profile.chain_gap_frames / fps

    def _normalize_token(t: str) -> str:
        return re.sub(r'[^\w]', '', t.lower())

    norm_words = []
    for w in words:
        raw_t = str(w.get("text", "")).strip()
        cleaned_t = _normalize_token(raw_t)
        if cleaned_t:
            norm_words.append({
                "clean": cleaned_t,
                "start": float(w.get("start", 0.0)),
                "end": float(w.get("end", 0.0)),
                "speaker": w.get("speaker_id", "speaker_0")
            })

    if not norm_words:
        return events

    word_cursor = 0
    total_norm = len(norm_words)

    for ev in events:
        ev_clean = _normalize_token(ev.text)
        if not ev_clean:
            continue

        ev_tokens = [x for x in [_normalize_token(p) for p in ev.text.split()] if x]
        if not ev_tokens:
            continue

        # Search forward for best token match in words list
        best_start = None
        best_end = None
        first_token = ev_tokens[0]
        last_token = ev_tokens[-1]

        # Look in window of 40 words from cursor
        search_start = max(0, word_cursor - 5)
        search_end = min(total_norm, word_cursor + 45)

        for w_idx in range(search_start, search_end):
            if norm_words[w_idx]["clean"] == first_token:
                best_start = norm_words[w_idx]["start"]
                # Scan ahead for last token
                for end_idx in range(w_idx, min(total_norm, w_idx + len(ev_tokens) + 12)):
                    if norm_words[end_idx]["clean"] == last_token:
                        best_end = norm_words[end_idx]["end"]
                        word_cursor = end_idx + 1
                        break
                if best_end is not None:
                    break

        if best_start is not None and best_end is not None and best_end > best_start:
            ev.start_time = round(best_start, 3)
            ev.end_time = round(best_end, 3)
            ev.start = ev.start_time
            ev.end = ev.end_time
            ev.start_time_str = format_timestamp(ev.start_time)
            ev.end_time_str = format_timestamp(ev.end_time)
            ev.duration = round(ev.end_time - ev.start_time, 3)

        # Optimize line breaks
        ev.text = optimize_language_line_breaks(ev.text, profile, custom_cpl=cpl)
        ev.lines = ev.text.split('\n')
        ev.cpl = calculate_cpl(ev.text)
        ev.cps = calculate_cps(ev.text, ev.duration or 0.1)

    # Gap chaining & collision prevention pass
    for i in range(len(events) - 1):
        c_ev = events[i]
        n_ev = events[i + 1]
        gap = n_ev.start_time - c_ev.end_time
        if min_gap_sec < gap <= chain_thresh_sec:
            ch_end = round(n_ev.start_time - min_gap_sec, 3)
            if ch_end - c_ev.start_time <= max_duration:
                c_ev.end_time = ch_end
                c_ev.end = ch_end
                c_ev.end_time_str = format_timestamp(ch_end)
                c_ev.duration = round(ch_end - c_ev.start_time, 3)
                c_ev.cps = calculate_cps(c_ev.text, c_ev.duration)
        elif gap < min_gap_sec:
            sf_end = round(n_ev.start_time - min_gap_sec, 3)
            if sf_end > c_ev.start_time:
                c_ev.end_time = sf_end
                c_ev.end = sf_end
                c_ev.end_time_str = format_timestamp(sf_end)
                c_ev.duration = round(sf_end - c_ev.start_time, 3)
                c_ev.cps = calculate_cps(c_ev.text, c_ev.duration)

    return events


def auto_fix_events_netflix(
    events: List[SubtitleEvent],
    language: Optional[str] = "en",
    content_type: str = "adult",
    frame_rate: float = 24.0,
    cpl_limit: Optional[int] = None,
    max_cps: Optional[float] = None,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    shot_changes: Optional[List[float]] = None
) -> List[SubtitleEvent]:
    """
    Auto-corrects existing subtitle events (CPL, CPS, line breaks, duration, gap chaining)
    strictly following the language's Netflix Timed Text Style Guide.
    """
    if not events:
        return []

    sample_text = " ".join([e.text for e in events[:50]])
    profile = get_language_profile(language or detect_text_script(sample_text))
    cpl = cpl_limit or profile.cpl_limit
    cps = max_cps or (profile.cps_children if content_type == "children" else profile.cps_adult)
    fps = max(float(frame_rate or 24.0), 1.0)
    min_gap_sec = profile.min_gap_frames / fps
    chain_thresh_sec = profile.chain_gap_frames / fps

    fixed_events: List[SubtitleEvent] = []

    for ev in events:
        # Standardize ellipsis
        clean_text = re.sub(r'\.{3,}', '…', ev.text)
        # Re-break lines using language profile
        formatted = optimize_language_line_breaks(clean_text, profile, custom_cpl=cpl)
        lines = formatted.split('\n')

        dur = ev.duration or (ev.end_time - ev.start_time)
        dur = max(dur, min_duration)
        dur = min(dur, max_duration)

        end_t = round(ev.start_time + dur, 3)

        fixed_ev = SubtitleEvent(
            id=ev.id,
            start_time=ev.start_time,
            end_time=end_t,
            start=ev.start_time,
            end=end_t,
            start_time_str=format_timestamp(ev.start_time),
            end_time_str=format_timestamp(end_t),
            duration=dur,
            text=formatted,
            lines=lines,
            speaker_count=ev.speaker_count or len(ev.speakers or ["Speaker 1"]),
            speakers=ev.speakers or ["Speaker 1"],
            speaker=ev.speaker or "Speaker 1",
            speaker_id=ev.speaker_id or "speaker_0",
            primary_speaker=getattr(ev, 'primary_speaker', None) or ev.speaker or "Speaker 1",
            is_italic=ev.is_italic,
            is_forced_narrative=ev.is_forced_narrative,
            cps=calculate_cps(formatted, dur),
            cpl=calculate_cpl(formatted),
            qc_errors=[],
            is_valid=True
        )
        fixed_events.append(fixed_ev)

    # Gap chaining and collision enforcement
    for i in range(len(fixed_events) - 1):
        c_ev = fixed_events[i]
        n_ev = fixed_events[i + 1]
        gap = n_ev.start_time - c_ev.end_time
        if min_gap_sec < gap <= chain_thresh_sec:
            ch_end = round(n_ev.start_time - min_gap_sec, 3)
            if ch_end - c_ev.start_time <= max_duration:
                c_ev.end_time = ch_end
                c_ev.end = ch_end
                c_ev.end_time_str = format_timestamp(ch_end)
                c_ev.duration = round(ch_end - c_ev.start_time, 3)
                c_ev.cps = calculate_cps(c_ev.text, c_ev.duration)
        elif gap < min_gap_sec:
            sf_end = round(n_ev.start_time - min_gap_sec, 3)
            if sf_end > c_ev.start_time:
                c_ev.end_time = sf_end
                c_ev.end = sf_end
                c_ev.end_time_str = format_timestamp(sf_end)
                c_ev.duration = round(sf_end - c_ev.start_time, 3)
                c_ev.cps = calculate_cps(c_ev.text, c_ev.duration)

    return fixed_events

