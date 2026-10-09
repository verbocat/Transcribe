"""Languages the Transcribe Studio pickers offer: (name, translate code, ElevenLabs Scribe ISO-639-3 code).

Mirrors frontend/src/data/languages.json (backend/tests/test_language_catalog.py keeps the two in step).
`translate` is the code sent to Centroid, `scribe` the code sent to the speech engine; None means that side does not offer it.
"""
from typing import Dict, List, Optional, Tuple

CATALOG: List[Tuple[str, Optional[str], Optional[str]]] = [
    ('Afrikaans', 'af', 'afr'),
    ('Amharic', 'am', 'amh'),
    ('Arabic', 'ar', 'ara'),
    ('Armenian', 'hy', 'hye'),
    ('Assamese', 'as', 'asm'),
    ('Asturian', None, 'ast'),
    ('Azerbaijani', 'az', 'aze'),
    ('Belarusian', 'be', 'bel'),
    ('Bengali', 'bn', 'ben'),
    ('Bosnian', 'bs', 'bos'),
    ('Bulgarian', 'bg', 'bul'),
    ('Burmese', 'my', 'mya'),
    ('Cantonese', None, 'yue'),
    ('Catalan', 'ca', 'cat'),
    ('Cebuano', None, 'ceb'),
    ('Chichewa', 'ny', 'nya'),
    ('Chinese (Mandarin)', 'zh', 'zho'),
    ('Chinese (Traditional)', 'zht', None),
    ('Croatian', 'hr', 'hrv'),
    ('Czech', 'cs', 'ces'),
    ('Danish', 'da', 'dan'),
    ('Dutch', 'nl', 'nld'),
    ('English', 'en', 'eng'),
    ('Estonian', 'et', 'est'),
    ('Filipino', 'fil', 'fil'),
    ('Finnish', 'fi', 'fin'),
    ('French', 'fr', 'fra'),
    ('Fulah', 'ff', 'ful'),
    ('Galician', 'gl', 'glg'),
    ('Ganda', 'lg', 'lug'),
    ('Georgian', 'ka', 'kat'),
    ('German', 'de', 'deu'),
    ('Greek', 'el', 'ell'),
    ('Gujarati', 'gu', 'guj'),
    ('Hausa', 'ha', 'hau'),
    ('Hebrew', 'he', 'heb'),
    ('Hindi', 'hi', 'hin'),
    ('Hinglish (Hindi in Latin script)', 'hinglish', None),
    ('Hungarian', 'hu', 'hun'),
    ('Icelandic', 'is', 'isl'),
    ('Igbo', 'ig', 'ibo'),
    ('Indonesian', 'id', 'ind'),
    ('Irish', 'ga', 'gle'),
    ('Italian', 'it', 'ita'),
    ('Japanese', 'ja', 'jpn'),
    ('Javanese', 'jv', 'jav'),
    ('Kabuverdianu', None, 'kea'),
    ('Kannada', 'kn', 'kan'),
    ('Kazakh', 'kk', 'kaz'),
    ('Khmer', 'km', 'khm'),
    ('Korean', 'ko', 'kor'),
    ('Kurdish', 'ku', 'kur'),
    ('Kyrgyz', 'ky', 'kir'),
    ('Lao', 'lo', 'lao'),
    ('Latvian', 'lv', 'lav'),
    ('Lingala', 'ln', 'lin'),
    ('Lithuanian', 'lt', 'lit'),
    ('Luo', None, 'luo'),
    ('Luxembourgish', 'lb', 'ltz'),
    ('Macedonian', 'mk', 'mkd'),
    ('Malay', 'ms', 'msa'),
    ('Malayalam', 'ml', 'mal'),
    ('Maltese', 'mt', 'mlt'),
    ('Maori', 'mi', 'mri'),
    ('Marathi', 'mr', 'mar'),
    ('Mongolian', 'mn', 'mon'),
    ('Nepali', 'ne', 'nep'),
    ('Northern Sotho', None, 'nso'),
    ('Norwegian', 'no', 'nor'),
    ('Occitan', 'oc', 'oci'),
    ('Odia', 'or', 'ori'),
    ('Pashto', 'ps', 'pus'),
    ('Persian', 'fa', 'fas'),
    ('Polish', 'pl', 'pol'),
    ('Portuguese', 'pt', 'por'),
    ('Portuguese (Brazil)', 'pt-br', None),
    ('Punjabi', 'pa', 'pan'),
    ('Romanian', 'ro', 'ron'),
    ('Russian', 'ru', 'rus'),
    ('Serbian', 'sr', 'srp'),
    ('Shona', 'sn', 'sna'),
    ('Sindhi', 'sd', 'snd'),
    ('Sinhala', 'si', None),
    ('Slovak', 'sk', 'slk'),
    ('Slovenian', 'sl', 'slv'),
    ('Somali', 'so', 'som'),
    ('Spanish', 'es', 'spa'),
    ('Swahili', 'sw', 'swa'),
    ('Swedish', 'sv', 'swe'),
    ('Tajik', 'tg', 'tgk'),
    ('Tamil', 'ta', 'tam'),
    ('Telugu', 'te', 'tel'),
    ('Thai', 'th', 'tha'),
    ('Turkish', 'tr', 'tur'),
    ('Ukrainian', 'uk', 'ukr'),
    ('Umbundu', None, 'umb'),
    ('Urdu', 'ur', 'urd'),
    ('Uzbek', 'uz', 'uzb'),
    ('Vietnamese', 'vi', 'vie'),
    ('Welsh', 'cy', 'cym'),
    ('Wolof', 'wo', 'wol'),
    ('Xhosa', 'xh', 'xho'),
    ('Zulu', 'zu', 'zul'),
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
