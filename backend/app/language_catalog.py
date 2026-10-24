"""Languages the Transcribe Studio pickers offer: (name, translate code, ElevenLabs Scribe ISO-639-3 code).

Mirrors frontend/src/data/languages.json (backend/tests/test_language_catalog.py keeps the two in step).
`translate` is the code sent to Centroid, `scribe` the code sent to the speech engine; None means that side does not offer it.
"""
from typing import Dict, List, Optional, Tuple

CATALOG: List[Tuple[str, Optional[str], Optional[str]]] = [
    ('Arabic', 'ar', 'ara'),
    ('Assamese', 'as', 'asm'),
    ('Bengali', 'bn', 'ben'),
    ('Bulgarian', 'bg', 'bul'),
    ('Burmese', 'my', 'mya'),
    ('Chinese (Mandarin)', 'zh', 'zho'),
    ('Chinese (Traditional)', 'zht', None),
    ('Czech', 'cs', 'ces'),
    ('Danish', 'da', 'dan'),
    ('Dutch', 'nl', 'nld'),
    ('English', 'en', 'eng'),
    ('Finnish', 'fi', 'fin'),
    ('French', 'fr', 'fra'),
    ('German', 'de', 'deu'),
    ('Greek', 'el', 'ell'),
    ('Gujarati', 'gu', 'guj'),
    ('Hebrew', 'he', 'heb'),
    ('Hindi', 'hi', 'hin'),
    ('Hinglish (Hindi in Latin script)', 'hinglish', None),
    ('Hungarian', 'hu', 'hun'),
    ('Indonesian', 'id', 'ind'),
    ('Irish', 'ga', 'gle'),
    ('Italian', 'it', 'ita'),
    ('Japanese', 'ja', 'jpn'),
    ('Kannada', 'kn', 'kan'),
    ('Korean', 'ko', 'kor'),
    ('Lao', 'lo', 'lao'),
    ('Latvian', 'lv', 'lav'),
    ('Malay', 'ms', 'msa'),
    ('Malayalam', 'ml', 'mal'),
    ('Marathi', 'mr', 'mar'),
    ('Nepali', 'ne', 'nep'),
    ('Norwegian', 'no', 'nor'),
    ('Odia', 'or', 'ori'),
    ('Pashto', 'ps', 'pus'),
    ('Persian', 'fa', 'fas'),
    ('Polish', 'pl', 'pol'),
    ('Portuguese', 'pt', 'por'),
    ('Portuguese (Brazil)', 'pt-br', None),
    ('Portuguese (Portugal)', 'pt-pt', None),
    ('Punjabi', 'pa', 'pan'),
    ('Romanian', 'ro', 'ron'),
    ('Russian', 'ru', 'rus'),
    ('Serbian', 'sr', 'srp'),
    ('Spanish', 'es', 'spa'),
    ('Swedish', 'sv', 'swe'),
    ('Tamil', 'ta', 'tam'),
    ('Telugu', 'te', 'tel'),
    ('Thai', 'th', 'tha'),
    ('Turkish', 'tr', 'tur'),
    ('Ukrainian', 'uk', 'ukr'),
    ('Urdu', 'ur', 'urd'),
    ('Uyghur', 'ug', None),
    ('Vietnamese', 'vi', 'vie'),
    ('Yiddish', 'yi', None),
]


def scribe_code_map() -> Dict[str, str]:
    """Lower-case name / two-letter code / three-letter code -> Scribe code, for every language Scribe supports."""
    out: Dict[str, str] = {}
    for name, short, scribe in CATALOG:
        if not scribe:
            continue
        for key in (name.lower(), (short or "").lower(), scribe):
            if key:
                out.setdefault(key, scribe)
    return out


_SCRIPT_RANGES = [  # (first, last, Centroid code), checked in order
    (0x0900, 0x097F, "hi"), (0x0980, 0x09FF, "bn"), (0x0A00, 0x0A7F, "pa"), (0x0A80, 0x0AFF, "gu"),
    (0x0B80, 0x0BFF, "ta"), (0x0C00, 0x0C7F, "te"), (0x0C80, 0x0CFF, "kn"), (0x0D00, 0x0D7F, "ml"),
    (0x0600, 0x06FF, "ar"), (0x0590, 0x05FF, "he"), (0x0E00, 0x0E7F, "th"), (0x0400, 0x04FF, "ru"),
    (0x0370, 0x03FF, "el"), (0x3040, 0x30FF, "ja"), (0xAC00, 0xD7AF, "ko"), (0x4E00, 0x9FFF, "zh"),
]


def guess_source_lang(texts: List[str], hint: Optional[str] = None) -> str:
    """Source language for an 'auto' translate request: the language the transcript was detected as (`hint`) when
    the editor knows it, otherwise the dominant script of the text (Latin counts as English)."""
    if hint and hint.lower() != "auto":
        return hint
    counts: Dict[str, int] = {}
    for ch in "".join(texts)[:20000]:
        o = ord(ch)
        for lo, hi, code in _SCRIPT_RANGES:
            if lo <= o <= hi:
                counts[code] = counts.get(code, 0) + 1
                break
    return max(counts, key=counts.get) if counts else "en"
