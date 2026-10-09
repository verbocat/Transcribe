"""Per-line language detection for mixed-language videos (no external dependency).

A film can be mostly English with some lines in Italian. The translator must copy a line that is already in the
target language instead of rewriting it, so every cue sent to Centroid carries the language detected for that line.

The detector is deliberately cautious: it returns a language only when the evidence is clear and None otherwise.
A wrong answer is worse than no answer, because Centroid copies a line marked as the target language unchanged.
  * Non-Latin scripts are decided by the script (with a few letters that tell Urdu, Persian and Arabic apart, etc.).
  * Latin-script lines are scored against short lists of frequent function words per language.
"""
import re
import unicodedata
from typing import Dict, Iterable, List, Optional

# Frequent words per language. A word listed for several languages is shared between them.
# Very short ambiguous words ('a', 'e', 'o', 'i', 'no', 'si') are left out on purpose.
_WORDS: Dict[str, str] = {
    "en": "the you and is are i'm im don't dont what this that it's its have has to of with for not we they he she was "
          "were will can your my me do know there here just get want okay yeah please thank thanks sorry why how where "
          "who when about from at on in be been an it him her them our us did didn't can't won't i'll you're let's go "
          "come die home some all one good right now out up",
    "it": "il lo la gli le che non sono sei è per una uno del della dello degli delle di da mi ti ci vi ma come cosa "
          "perché perche questo questa quello quella molto anche ancora sempre adesso ora qui qua dove quando chi grazie "
          "prego ciao sì bene tutto tutti niente nulla fare fatto andiamo vai vieni aspetta scusa mamma papà ho hai "
          "abbiamo siamo voglio posso devo dobbiamo allora basta domani oggi sto stai sta anch'io nostri nostro tuo tua "
          "mio mia figli lavoro casa tornato tornata hanno fame morire davvero più così siete vuoi devi puoi può però altro "
          "altra stessa stesso andata andato com'è c'è dov'è cos'è qualcosa nessuno sempre oggi",
    "es": "el los las que es por para una del de en y pero como qué cómo dónde cuándo quién gracias hola sí bien muy "
          "también ahora aquí allí estoy estás está soy eres tengo tienes hay vamos nada todo mañana hoy señor usted "
          "ustedes yo tú él ella nosotros porque esto eso puedo quiero",
    "fr": "le les des du une un est et je tu il elle nous vous ils pas ne que qui quoi c'est ce cette mais avec pour "
          "dans sur très aussi maintenant ici merci bonjour oui bien rien tout suis sommes êtes j'ai faire allez viens "
          "attends pourquoi comment où",
    "de": "der die das und ist ich du er sie wir ihr nicht ein eine mit auf für zu von den dem aber was wie wo warum ja "
          "nein danke bitte hier jetzt auch noch schon sehr gut bin bist sind habe hast haben kann mein dein",
    "pt": "o os as que não é um uma do da dos das em no na por para com mas como você eu ele ela nós obrigado obrigada "
          "sim bem muito também agora aqui estou está sou tenho tem vamos nada tudo amanhã hoje porque isso isto",
    "nl": "de het een en is ik jij je hij zij wij niet wat hoe waar waarom ja nee dank bedankt hier nu ook nog al heel "
          "goed ben bent zijn heb heeft hebben kan mijn jouw dat die met op voor van maar",
    "sv": "och jag du han hon vi ni de inte är en ett att det som på för med men vad hur var varför ja nej tack här nu "
          "också bra har kan min din mycket",
    "tr": "ve bir bu şu ne için ile değil evet hayır teşekkür teşekkürler ben sen biz siz onlar var yok çok ama gibi "
          "neden nasıl nerede şimdi burada tamam lütfen",
    "pl": "w nie to jest się na z że co jak ale tak ja ty my wy oni dziękuję proszę tu teraz bardzo dobrze jestem "
          "jesteś mam masz gdzie dlaczego czy",
    "id": "tidak saya kamu apa ini itu yang dan di ke dari akan sudah belum bisa mau aku ada tapi juga sangat sekarang "
          "nggak gak enggak kenapa bagaimana siapa",
    "ms": "tidak saya awak kamu apa ini itu yang dan di ke dari akan sudah belum boleh mahu tak ada tetapi juga sangat "
          "sekarang kenapa bagaimana siapa",
}
# Words that settle a short line on their own ("Grazie.", "Permesso.").
_STRONG: Dict[str, str] = {
    "it": "grazie prego permesso aspetta scusa ciao andiamo basta allora perché sì è più",
    "es": "gracias hola vamos señor qué cómo dónde",
    "fr": "merci bonjour oui c'est pourquoi attends",
    "de": "danke bitte nein jetzt warum",
    "pt": "obrigado obrigada não você",
    "nl": "bedankt waarom",
    "sv": "tack varför",
    "tr": "teşekkürler teşekkür evet hayır tamam lütfen",
    "pl": "dziękuję proszę dlaczego",
    "en": "thanks thank please sorry yeah okay",
}
_LEXICON: Dict[str, Dict[str, float]] = {}
for _lang, _ws in _WORDS.items():
    for _w in _ws.split():
        _LEXICON.setdefault(_w, {})[_lang] = 1.0
for _w, _langs in _LEXICON.items():
    for _l in _langs:
        _langs[_l] = 1.0 / len(_langs)
for _lang, _ws in _STRONG.items():
    for _w in _ws.split():
        _LEXICON.setdefault(_w, {})[_lang] = 2.0

# Letters that point at one Latin-script language.
_MARKS = [
    (re.compile(r"[ñ¿¡]"), "es", 2.0),
    (re.compile(r"[ãõ]"), "pt", 2.0),
    (re.compile(r"ß"), "de", 2.0),
    (re.compile(r"[ğşı]"), "tr", 2.0),
    (re.compile(r"[łąęśźżńć]"), "pl", 2.0),
    (re.compile(r"[ơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]"), "vi", 3.0),
]

_SCRIPTS = [
    ("DEVANAGARI", "hi"), ("BENGALI", "bn"), ("GURMUKHI", "pa"), ("GUJARATI", "gu"), ("TAMIL", "ta"),
    ("TELUGU", "te"), ("KANNADA", "kn"), ("MALAYALAM", "ml"), ("SINHALA", "si"), ("ARABIC", "ar"),
    ("HEBREW", "he"), ("CYRILLIC", "ru"), ("GREEK", "el"), ("THAI", "th"), ("HANGUL", "ko"),
    ("HIRAGANA", "ja"), ("KATAKANA", "ja"), ("CJK", "zh"),
]
_URDU_LETTERS = re.compile(r"[ٹڈڑںےھ]")
_PERSIAN_LETTERS = re.compile(r"[پچژگکی]")
_UKRAINIAN_LETTERS = re.compile(r"[іїєґІЇЄҐ]")
_MARATHI_HINTS = re.compile(r"ळ|आहे|नाही|काय|मला|तुला")
_NEPALI_HINTS = re.compile(r"(^|\s)(छ|छु|छौ|छन्|हुन्छ|गर्नु|हजुर|तिमी)(\s|[।?!,.]|$)")
_TOKEN = re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)?", re.UNICODE)


def _script_counts(text: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for ch in text:
        if not ch.isalpha():
            continue
        try:
            name = unicodedata.name(ch)
        except ValueError:
            continue
        key = "LATIN" if name.startswith("LATIN") else next((s for s, _ in _SCRIPTS if name.startswith(s)), "OTHER")
        counts[key] = counts.get(key, 0) + 1
    return counts


def _by_script(text: str, script: str, candidates: List[str]) -> Optional[str]:
    lang = dict(_SCRIPTS).get(script)
    if script == "DEVANAGARI":
        if _MARATHI_HINTS.search(text):
            return "mr"
        if _NEPALI_HINTS.search(text):
            return "ne"
        if "hi" not in candidates:
            for c in ("mr", "ne"):
                if c in candidates:
                    return c
        return "hi"
    if script == "ARABIC":
        if _URDU_LETTERS.search(text):
            return "ur"
        if _PERSIAN_LETTERS.search(text):
            return "ur" if ("ur" in candidates and "fa" not in candidates) else "fa"
        return "ar"
    if script == "CYRILLIC":
        return "uk" if _UKRAINIAN_LETTERS.search(text) else "ru"
    if script in ("HIRAGANA", "KATAKANA"):
        return "ja"
    if script == "CJK":
        return "ja" if re.search(r"[぀-ヿ]", text) else "zh"
    return lang


def _base(code: str) -> str:
    return str(code or "").lower().split("-")[0]


def detect_cue_language(text: str, candidates: Optional[Iterable[str]] = None) -> Optional[str]:
    """Language code of one subtitle line, or None when the line does not say clearly."""
    t = re.sub(r"<[^>]+>|\{\\[^}]*\}|\[[^\]]*\]|\([^)]*\)", " ", str(text or ""))  # tags, [sounds], (notes)
    cands = [_base(c) for c in (candidates or []) if c]
    counts = _script_counts(t)
    letters = sum(counts.values())
    if letters < 2:
        return None
    script, n = max(counts.items(), key=lambda kv: kv[1])
    if script != "LATIN":
        return _by_script(t, script, cands) if n / letters >= 0.6 else None
    if n / letters < 0.8:
        return None

    low = t.lower().replace("’", "'")
    tokens = _TOKEN.findall(low)
    if not tokens:
        return None
    scores: Dict[str, float] = {}
    strong = False
    matched = 0
    for tok in tokens:
        hits = _LEXICON.get(tok)
        if not hits:
            continue
        matched += 1
        for lang, w in hits.items():
            scores[lang] = scores.get(lang, 0.0) + w
            strong = strong or w >= 2.0
    for rx, lang, w in _MARKS:
        if rx.search(low):
            scores[lang] = scores.get(lang, 0.0) + w
            strong = True
    if not scores:
        return None
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best, top = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    # Indonesian and Malay share most words: settle on the one the job is about, otherwise give no answer.
    if {best, ranked[1][0] if len(ranked) > 1 else ""} == {"id", "ms"} and abs(top - second) < 1.0:
        pick = [c for c in ("id", "ms") if c in cands]
        return pick[0] if len(pick) == 1 else None
    if len(tokens) <= 2 and not strong:
        return None
    if top < 2.0 or (second and top < 3 * second):
        return None
    if len(tokens) >= 4 and matched / len(tokens) < 0.3:
        return None
    return best


def annotate_languages(texts: List[str], candidates: Optional[Iterable[str]] = None) -> List[Optional[str]]:
    cands = list(candidates or [])
    return [detect_cue_language(t, cands) for t in texts]
