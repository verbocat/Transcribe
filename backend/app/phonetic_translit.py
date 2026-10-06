"""
Offline English -> Indic-script transliteration (no API, no cost).

English loanwords spoken inside Indian-language speech ("bulldozer", "feet", "support") must be written in
the target script. Pipeline: word -> pronunciation (CMU Pronouncing Dictionary, 126k words; a letter-rule
guess for unknown words) -> Devanagari by phonetic rules -> the target Indic script by Unicode block mapping.

Spelling conventions follow the project's existing dictionary (e.g. ऑफिस, डॉक्टर, फोन, नंबर, फ्रेंड):
English t/d become retroflex ट/ड, a nasal before a consonant becomes an anusvara, no nukta on फ.
"""

import re
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

try:
    import cmudict
    _CMU = cmudict.dict()
except Exception:  # pragma: no cover - package missing
    _CMU = {}

_CONSONANTS = {
    "B": "ब", "CH": "च", "D": "ड", "DH": "द", "F": "फ", "G": "ग", "HH": "ह", "JH": "ज", "K": "क",
    "L": "ल", "M": "म", "N": "न", "P": "प", "R": "र", "S": "स", "SH": "श", "T": "ट", "TH": "थ",
    "V": "व", "W": "व", "Y": "य", "Z": "ज़", "ZH": "ज़",
}
# (independent form, matra)
_VOWELS = {
    "AA": ("आ", "ा"), "AE": ("ऐ", "ै"), "AH": ("अ", ""), "AO": ("ऑ", "ॉ"), "AW": ("आउ", "ाउ"),
    "AY": ("आइ", "ाइ"), "EH": ("ए", "े"), "EY": ("ए", "े"), "IH": ("इ", "ि"), "IY": ("ई", "ी"),
    "OW": ("ओ", "ो"), "OY": ("ऑय", "ॉय"), "UH": ("उ", "ु"), "UW": ("ऊ", "ू"),
}
_NASAL_BEFORE = {"B", "CH", "D", "DH", "G", "JH", "K", "P", "T", "TH", "F", "V", "S", "SH", "Z"}
_VOWEL_SET = set(_VOWELS) | {"ER"}


def _strip_stress(p: str) -> Tuple[str, int]:
    m = re.match(r"([A-Z]+)(\d?)$", p)
    return (m.group(1), int(m.group(2) or 0)) if m else (p, 0)


def arpabet_to_devanagari(phones: List[str], spelling: str = "") -> str:
    ph = [_strip_stress(p) for p in phones]
    letter_groups = re.findall(r"[aeiouy]+", spelling.lower())   # k-th vowel phone ~ k-th vowel letters
    vowel_index = -1
    out: List[str] = []
    after_schwa = 0             # 2: schwa just written, 1: its consonant just written (syllable break follows)
    pending_consonant = False   # last unit is a bare consonant (no vowel yet), so a following consonant needs a halant
    n = len(ph)
    for i, (p, stress) in enumerate(ph):
        nxt = ph[i + 1][0] if i + 1 < n else None
        prev = ph[i - 1][0] if i > 0 else None
        if p in _VOWEL_SET:
            vowel_index += 1
        letters = letter_groups[vowel_index] if 0 <= vowel_index < len(letter_groups) else ""
        if p in _VOWEL_SET and p != "AH":
            after_schwa = 0
        if p in _VOWELS:
            indep, matra = _VOWELS[p]
            if p == "AA" and letters.startswith("o"):
                indep, matra = "ऑ", "ॉ"      # doctor, hospital, problem, sorry
            if p == "AH":
                if i == 0:
                    out.append("अ")
                elif nxt is None and prev is not None and (prev in _CONSONANTS or prev == "ER"):
                    out.append("ा")  # word-final schwa: sofa -> सोफा
                elif (nxt == "N" and i + 2 < n and ph[i + 2][0] in _NASAL_BEFORE and letters[:1] in ("e", "a")
                      and i > 0 and prev not in ("SH", "ZH")):
                    out.append("े")
                    pending_consonant = False
                    continue
                elif letters.startswith("i") and i > 0 and prev not in ("SH", "ZH"):
                    out.append("ि")  # notice -> नोटिस, promise -> प्रॉमिस
                pending_consonant = False
                after_schwa = 2 if (nxt in _CONSONANTS and nxt != "S" and i + 2 < n and ph[i + 2][0] in _CONSONANTS) else 0
                continue
            if p == "AO" and i > 0 and nxt == "R":
                indep, matra = "ओ", "ो"      # court -> कोर्ट
            if p == "AY":
                if nxt is None:
                    indep, matra = "आई", "ाई"   # die -> डाई
                elif nxt == "R" or nxt in _VOWEL_SET:
                    indep, matra = "आय", "ाय"   # viral -> वायरल
            out.append(matra if (i > 0 and (not _is_vowel(prev) or prev == "ER")) else indep)
            pending_consonant = False
        elif p == "ER":
            out.append("अर" if i == 0 else "र")
            pending_consonant = (nxt is not None and nxt in _CONSONANTS
                                 and (i + 2 >= n or ph[i + 2][0] not in _VOWEL_SET))
        elif p == "NG":
            out.append("ं" if i > 0 else "ङ")
            out.append("ग" if (nxt is None or nxt in _VOWEL_SET) else "")
            if out[-1] == "ग":
                pending_consonant = True
        elif p in ("M", "N") and nxt in _NASAL_BEFORE and i > 0 and not pending_consonant and prev not in ("AA", "AO"):
            out.append("ं")  # number -> नंबर, friend -> फ्रेंड
            pending_consonant = False
        elif p in _CONSONANTS:
            # schwa + C1 + C2 (up|date, down|load): the syllable break sits between C1 and C2, so no halant there
            syllable_break = (after_schwa == 1 and p not in ("R", "L", "W", "Y")) or (prev == "N" and p == "L")
            if pending_consonant and not syllable_break:
                out.append("्")
            out.append(_CONSONANTS[p])
            pending_consonant = True
            after_schwa = 1 if after_schwa == 2 else 0
        # unknown phones are skipped
    return "".join(out)


def _is_vowel(p: Optional[str]) -> bool:
    return p in _VOWEL_SET


# ---- letter-to-sound guess for words the dictionary does not know
_DIGRAPHS = [
    ("tch", ["CH"]), ("sch", ["S", "K"]), ("shi", ["SH", "IH"]), ("tion", ["SH", "AH", "N"]), ("sion", ["ZH", "AH", "N"]),
    ("igh", ["AY"]), ("ough", ["AO"]), ("ck", ["K"]), ("sh", ["SH"]), ("ch", ["CH"]), ("th", ["TH"]), ("ph", ["F"]),
    ("wh", ["W"]), ("ng", ["NG"]), ("qu", ["K", "W"]), ("ee", ["IY"]), ("ea", ["IY"]), ("oo", ["UW"]), ("ai", ["EY"]),
    ("ay", ["EY"]), ("oa", ["OW"]), ("ou", ["AW"]), ("ow", ["OW"]), ("oi", ["OY"]), ("oy", ["OY"]), ("au", ["AO"]),
    ("aw", ["AO"]), ("ie", ["IY"]), ("ey", ["EY"]),
]
_LETTERS = {
    "a": ["AE"], "b": ["B"], "c": ["K"], "d": ["D"], "e": ["EH"], "f": ["F"], "g": ["G"], "h": ["HH"], "i": ["IH"],
    "j": ["JH"], "k": ["K"], "l": ["L"], "m": ["M"], "n": ["N"], "o": ["AA"], "p": ["P"], "q": ["K"], "r": ["R"],
    "s": ["S"], "t": ["T"], "u": ["AH"], "v": ["V"], "w": ["W"], "x": ["K", "S"], "y": ["IY"], "z": ["Z"],
}


def guess_phones(word: str) -> List[str]:
    w = word.lower()
    phones: List[str] = []
    i = 0
    while i < len(w):
        for pat, ph in _DIGRAPHS:
            if w.startswith(pat, i):
                phones += ph
                i += len(pat)
                break
        else:
            phones += _LETTERS.get(w[i], [])
            i += 1
    if w.endswith("e") and len(w) > 3 and phones and phones[-1] == "EH":
        phones.pop()   # silent final e: "gate"
    return phones


_LEXICON = {
    "bulldozer": "बुलडोज़र", "footpath": "फुटपाथ", "flyover": "फ्लाईओवर", "railway": "रेलवे", "mobile": "मोबाइल",
    "video": "वीडियो", "police": "पुलिस", "market": "मार्केट", "highway": "हाईवे", "airport": "एयरपोर्ट",
    "hotel": "होटल", "ticket": "टिकट", "pocket": "पॉकेट", "rupees": "रुपये", "madam": "मैडम", "sir": "सर",
}


def lookup_phones(word: str) -> Optional[List[str]]:
    entries = _CMU.get(word.lower())
    return entries[0] if entries else None


# ---- Devanagari -> other Indic scripts (Unicode blocks share the same layout)
_BLOCK_START = {
    "Devanagari": 0x0900, "Bengali": 0x0980, "Gurmukhi": 0x0A00, "Gujarati": 0x0A80, "Odia": 0x0B00,
    "Tamil": 0x0B80, "Telugu": 0x0C00, "Kannada": 0x0C80, "Malayalam": 0x0D00,
}


def _convert_block(text: str, script: str) -> str:
    base = _BLOCK_START[script]
    out = []
    for ch in text:
        cp = ord(ch)
        if 0x0901 <= cp <= 0x094D or 0x0958 <= cp <= 0x095F:
            out.append(chr(cp - 0x0900 + base))
        else:
            out.append(ch)
    return "".join(out)


def devanagari_to(text: str, script: str) -> str:
    if script == "Devanagari" or script not in _BLOCK_START:
        return text
    text = text.replace("ज़", "ज")   # nukta forms do not exist in most scripts
    if script in ("Bengali", "Gurmukhi", "Odia", "Tamil", "Telugu", "Kannada", "Malayalam"):
        text = text.replace("ऑ", "ओ").replace("ॉ", "ो")
    if script == "Tamil":
        text = _convert_tamil(text)
        return text
    return _convert_block(text, script)


def _convert_tamil(text: str) -> str:
    # Tamil has one letter per place of articulation, so voiced / aspirated forms collapse
    collapse = {"ख": "क", "ग": "क", "घ": "क", "छ": "च", "झ": "ज", "ठ": "ट", "ड": "ट", "ढ": "ट", "थ": "त", "द": "त",
                "ध": "त", "फ": "प", "ब": "प", "भ": "प"}
    return _convert_block("".join(collapse.get(c, c) for c in text), "Tamil")


@lru_cache(maxsize=20000)
def phonetic_transliterate(word: str, script: str = "Devanagari", allow_guess: bool = True) -> Optional[str]:
    """English word -> target script, or None when the word is unknown and guessing is not allowed."""
    clean = re.sub(r"[^A-Za-z']", "", word).replace("'", "")
    if not clean:
        return None
    if clean.lower() in _LEXICON:
        return devanagari_to(_LEXICON[clean.lower()], script)
    phones = lookup_phones(clean)
    if phones is None and "'" in word:
        phones = lookup_phones(word.lower())
    if phones is None:
        if not allow_guess:
            return None
        phones = guess_phones(clean)
    if not phones:
        return None
    return devanagari_to(arpabet_to_devanagari(phones, clean), script)


def in_dictionary(word: str) -> bool:
    return lookup_phones(re.sub(r"[^A-Za-z]", "", word)) is not None
