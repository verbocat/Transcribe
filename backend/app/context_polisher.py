"""
Context-aware transcript quality for Subtitle Studio.

The speech engine (ElevenLabs Scribe) does not know who is speaking or what the video is about, so it mishears
names, brands and technical terms, and it spells the same name several ways. This module uses the user's context
(speakers, key terms, "often misheard" fixes, writing style, filler/number/profanity rules) to:

  * key_terms_from_context(): build the key-term list that biases the speech engine itself (Scribe `keyterms`)
  * apply_corrections():      deterministic "heard as -> correct" fixes (free, instant, always applied)
  * polish_texts():           a Gemini proofreading pass that fixes only real recognition mistakes, never rewrites
  * autofill_context():       reads the transcript and drafts the whole context for the user to review

Nothing here changes timing. A change is only accepted when it passes safety checks (similarity, word count, line limits).
"""
import asyncio
import difflib
import json
import logging
import math
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.config import GEMINI_API_KEY, GEMINI_MODEL
from app.terminal_logger import log_terminal

logger = logging.getLogger(__name__)

BATCH_SIZE = 30
NEIGHBOURS = 3
PARALLEL = 3
MAX_KEYTERMS = 100
MIN_SIMILARITY = 0.55
# A word Scribe scored below this is "unsure" (same line as the low-confidence chips in the editor). Only unsure words may
# be changed by the AI proofreading pass: a word Scribe heard clearly is never rewritten by our own AI.
LOW_CONFIDENCE = 0.80
AUTOFILL_CHAR_BUDGET = 60000

_WORD = r"[\wऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]"

WRITING_STYLES = {
    "spoken": ("EXACTLY AS SPOKEN. Keep every colloquial word, slang, contraction and informal grammar exactly as the speaker said it. "
               "Never replace everyday words with formal, bookish or Sanskritised/literary synonyms. Fix only recognition errors and punctuation."),
    "light": ("LIGHT CLEANUP. Keep the wording as spoken, but drop false starts and repeated stutters when the rules below allow it. "
              "Never formalise the language."),
    "clean": ("CLEAN WRITTEN TEXT. Fix grammar slips and drop fillers and stutters, but never change the meaning, never change dialect "
              "into a different register and never add words the speaker did not say."),
}
FILLERS = {
    "keep": "Keep filler words (um, uh, you know, matlab, haan...) because they are part of how the person talks.",
    "remove": "Remove pure filler words (um, uh, er, hmm used as a filler, empty 'you know', 'matlab', 'mtlb') but keep words that carry meaning.",
}
STUTTERS = {
    "keep": "Keep repeated words and stutters as spoken.",
    "clean": "Collapse stutters and accidental word repeats (I I I think -> I think). Keep deliberate repetition for emphasis.",
}
NUMBERS = {
    "digits": "Write numbers as digits (25, 3rd, 10%).",
    "words": "Write numbers as words where it reads naturally, digits for dates, prices and measurements.",
    "guide": "Write numbers from one to ten as words and 11 and above as digits.",
}
PROFANITY = {
    "keep": "Keep profanity exactly as spoken.",
    "mask": "Mask profanity with asterisks after the first letter (f***).",
}
CONTENT_TYPES = {
    "interview": "Interview", "film": "Film / series", "documentary": "Documentary", "lecture": "Lecture / talk",
    "news": "News", "podcast": "Podcast / conversation", "ad": "Advertisement", "kids": "Kids / animation",
    "tutorial": "Tutorial / training", "other": "Other",
}

# Bookish Hindi words the polish pass must never introduce when the style is "as spoken"
_STIFF_HI = {
    "प्रारंभ", "आरंभ", "समाप्त", "कृपया", "प्रतीक्षा", "शीघ्र", "पुनः", "अथवा", "परंतु", "किंतु", "तथा", "यद्यपि", "तथापि",
    "अतः", "मित्र", "अत्यंत", "अत्यधिक", "प्रसन्न", "आवश्यकता", "आवश्यक", "उपयोग", "प्रयास", "निर्णय", "भयभीत", "क्षमा",
    "संभवतः", "कदाचित", "स्वयं", "आक्रमण", "शत्रु", "पराजित", "विनाश", "सहायता", "अवश्य", "विजय", "कठिन", "प्रश्न",
}


# --------------------------------------------------------------------------------------------------
# Context helpers
# --------------------------------------------------------------------------------------------------

def _lines(text: Any) -> List[str]:
    return [ln.strip() for ln in str(text or "").split("\n") if ln.strip()]


def parse_corrections(text: Any) -> List[Tuple[str, str]]:
    """Lines like `wrong => right` (also `->`, `=`)."""
    out = []
    for ln in _lines(text):
        parts = re.split(r"\s*(?:=>|->|→|=)\s*", ln, maxsplit=1)
        if len(parts) == 2 and parts[0].strip() and parts[1].strip():
            out.append((parts[0].strip(), parts[1].strip()))
    return out[:200]


def context_is_empty(ctx: Optional[Dict[str, Any]]) -> bool:
    if not ctx:
        return True
    for k, v in ctx.items():
        if k in ("strict", "writing_style", "fillers", "stutters", "numbers", "profanity"):
            continue
        if isinstance(v, list) and any((isinstance(x, dict) and x.get("name")) or (isinstance(x, str) and x.strip()) for x in v):
            return False
        if isinstance(v, str) and v.strip():
            return False
    return True


def key_terms_from_context(ctx: Optional[Dict[str, Any]], glossary: Optional[List[str]] = None) -> List[str]:
    """Names, brands and terms that should be spelled exactly. Used to bias the speech engine (Scribe keyterms)."""
    terms: List[str] = []
    ctx = ctx or {}
    terms += _lines(ctx.get("key_terms"))
    terms += [right for _, right in parse_corrections(ctx.get("corrections"))]
    for s in ctx.get("speakers") or []:
        if isinstance(s, dict) and str(s.get("name") or "").strip():
            terms.append(str(s["name"]).strip())
    terms += [t for t in (glossary or []) if isinstance(t, str)]
    seen, out = set(), []
    for t in terms:
        t = t.strip()
        if t and len(t) <= 50 and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:MAX_KEYTERMS]


def apply_corrections(text: str, pairs: List[Tuple[str, str]]) -> Tuple[str, int]:
    """Whole-word, case-insensitive `heard as -> correct` replacement."""
    count = 0
    for wrong, right in pairs:
        pattern = re.compile(rf"(?<!{_WORD}){re.escape(wrong)}(?!{_WORD})", flags=re.IGNORECASE)
        text, n = pattern.subn(right, text)
        count += n
    return text, count


def context_block(ctx: Optional[Dict[str, Any]]) -> str:
    """The context as prompt text."""
    ctx = ctx or {}
    lines = []

    def add(label, val):
        if val and str(val).strip():
            lines.append(f"- {label}: {str(val).strip()[:1500]}")

    add("Title", ctx.get("title"))
    add("Type of video", CONTENT_TYPES.get(str(ctx.get("content_type")), ctx.get("content_type")))
    add("Topic / domain", ctx.get("topic"))
    add("What it is about", ctx.get("summary"))
    add("Region / setting", ctx.get("region"))
    add("Spoken language and mixing", ctx.get("language_mix"))
    add("Accent / dialect / variety", ctx.get("variety"))
    spk = []
    for s in ctx.get("speakers") or []:
        if isinstance(s, dict) and str(s.get("name") or "").strip():
            bits = [str(s.get(k) or "").strip() for k in ("role", "style")]
            spk.append(f"  * {s['name'].strip()}" + (f" ({'; '.join(b for b in bits if b)})" if any(bits) else ""))
    if spk:
        lines.append("- SPEAKERS (spell these names exactly):\n" + "\n".join(spk))
    terms = _lines(ctx.get("key_terms"))
    if terms:
        lines.append("- KEY TERMS (always spell exactly like this): " + "; ".join(terms[:80]))
    pairs = parse_corrections(ctx.get("corrections"))
    if pairs:
        lines.append("- OFTEN MISHEARD (the engine writes the left side; the correct text is the right side): "
                     + "; ".join(f'"{a}" -> "{b}"' for a, b in pairs[:60]))
    add("ALWAYS do", ctx.get("dos"))
    add("NEVER do", ctx.get("donts"))
    add("Extra instructions", ctx.get("notes"))
    return "\n".join(lines)


def style_rules(ctx: Optional[Dict[str, Any]]) -> str:
    ctx = ctx or {}
    return "\n".join([
        "- Writing style: " + WRITING_STYLES.get(str(ctx.get("writing_style") or "spoken"), WRITING_STYLES["spoken"]),
        "- Fillers: " + FILLERS.get(str(ctx.get("fillers") or "keep"), FILLERS["keep"]),
        "- Stutters / repeats: " + STUTTERS.get(str(ctx.get("stutters") or "keep"), STUTTERS["keep"]),
        "- Numbers: " + NUMBERS.get(str(ctx.get("numbers") or "guide"), NUMBERS["guide"]),
        "- Profanity: " + PROFANITY.get(str(ctx.get("profanity") or "keep"), PROFANITY["keep"]),
    ])


# --------------------------------------------------------------------------------------------------
# Gemini
# --------------------------------------------------------------------------------------------------

async def _gemini_json(prompt: str, temperature: float = 0.0) -> Any:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set on the backend.")
    from google import genai
    from google.genai import types
    from app.gemini_util import generate_async

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = await generate_async(
        client, GEMINI_MODEL or "gemini-3.8-flash", prompt,
        types.GenerateContentConfig(temperature=temperature, response_mime_type="application/json"),
    )
    return json.loads((response.text or "").strip() or "null")


def _flat(text: str) -> str:
    return " ".join((text or "").split())


def _is_dual_speaker(text: str) -> bool:
    lines = [ln.strip() for ln in (text or "").split("\n") if ln.strip()]
    return len(lines) == 2 and all(ln.startswith(("-", "–", "—")) for ln in lines)


def _accept_change(old: str, new: str, language: str, style: str, max_cpl: int, max_lines: int, corrected: bool) -> bool:
    """Safety net: a proofreading fix may touch a few words, never rewrite the line."""
    if not new or not new.strip():
        return False
    lines = [ln for ln in new.split("\n") if ln.strip()]
    if _is_dual_speaker(old) != _is_dual_speaker(new):
        return False  # a two-speaker card keeps its "-line / -line" shape, and a one-speaker card never gains it
    if len(lines) > max_lines or any(len(ln) > max_cpl + 4 for ln in lines):
        return False
    fo, fn = _flat(old), _flat(new)
    if fo == fn:
        return False
    if difflib.SequenceMatcher(None, fo, fn).ratio() < MIN_SIMILARITY:
        return False
    wo, wn = len(fo.split()), len(fn.split())
    if style == "spoken" and wo and abs(wn - wo) / wo > 0.25:
        return False
    if style == "spoken" and str(language).lower().startswith("hi"):
        introduced = [w for w in _STIFF_HI if w in fn and w not in fo]
        if introduced:
            return False
    return True


def word_confidence(w: Dict[str, Any]) -> Optional[float]:
    """Scribe's own confidence for one word (from its logprob). None when Scribe gave no score."""
    lp = w.get("logprob")
    if lp is not None:
        try:
            return min(1.0, max(0.0, math.exp(float(lp))))
        except (TypeError, ValueError, OverflowError):
            return None
    c = w.get("confidence")
    return float(c) if isinstance(c, (int, float)) else None


def unsure_words_for_spans(spans: List[Tuple[float, float]], words: List[Dict[str, Any]],
                           threshold: float = LOW_CONFIDENCE) -> List[List[str]]:
    """For each (start, end) span, the words inside it that ElevenLabs Scribe scored below `threshold`."""
    scored = []
    for w in words or []:
        if w.get("type", "word") != "word":
            continue
        conf = word_confidence(w)
        text = str(w.get("text") or "").strip()
        if conf is None or conf >= threshold or not text:
            continue
        mid = (float(w.get("start", 0.0)) + float(w.get("end", 0.0))) / 2
        scored.append((mid, text))
    out = []
    for start, end in spans:
        out.append([t for mid, t in scored if start - 0.05 <= mid <= end + 0.05])
    return out


def _tokens(text: str) -> List[str]:
    return [t for t in (re.sub(r"[^\w']+", " ", (text or "").lower()).split()) if t]


def _only_unsure_changed(old: str, new: str, unsure: List[str]) -> bool:
    """True when every word the fix removes or replaces is one Scribe was unsure about (punctuation may change).
    A word may also be added right next to an unsure word (one misheard word that is really two)."""
    allowed = {t for w in unsure or [] for t in _tokens(w)}
    if not allowed:
        return False
    a, b = _tokens(old), _tokens(new)
    for op, i1, i2, _, _ in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op in ("replace", "delete") and not all(t in allowed for t in a[i1:i2]):
            return False
        if op == "insert" and not ((i1 > 0 and a[i1 - 1] in allowed) or (i1 < len(a) and a[i1] in allowed)):
            return False
    return True


def _polish_prompt(ctx: Dict[str, Any], language: str, batch, before, after, max_cpl: int, max_lines: int) -> str:
    return f"""You are a senior subtitle proofreader. The subtitles below were produced by speech recognition, so they contain recognition mistakes.
Language of the speech: {language or 'auto'}.

VIDEO CONTEXT (hard rules from the client; follow all of them):
{context_block(ctx) or '(none given)'}

STYLE RULES:
{style_rules(ctx)}

YOUR JOB: correct ONLY real recognition mistakes, and ONLY in the words the speech engine itself was unsure about.
Each subtitle lists its 'unsure' words: ElevenLabs Scribe gave them a low confidence score. Every other word was heard
clearly and MUST stay exactly as it is. Change an unsure word only when it is clearly wrong:
- a misheard or misspelled name, brand, place or technical term (use the key terms, speakers and 'often misheard' list),
- a name written differently from the same name elsewhere (make it identical),
- a wrong word that sounds like the right one when the context makes the right one clear.

ABSOLUTE RULES:
1. Never paraphrase, summarise, translate, shorten or 'improve' wording. Never make the language more formal.
2. Do not add words that were not spoken. Do not remove words except what the style rules above allow.
3. Keep the same line breaks where possible. Max {max_lines} lines, about {max_cpl} characters per line.
4. If you are not sure a word is wrong, leave it alone. Most subtitles need no change.
5. Return ONLY subtitles that you changed, with the full corrected text and a 3-6 word reason.

Subtitles before this batch (context only): {json.dumps(before, ensure_ascii=False)}
Subtitles AFTER this batch (context only): {json.dumps(after, ensure_ascii=False)}

SUBTITLES TO PROOFREAD:
{json.dumps(batch, ensure_ascii=False)}

Reply with JSON only: {{"fixes":[{{"id":<id>,"text":"<full corrected text>","reason":"<why>"}}]}}"""


async def polish_texts(
    items: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]],
    language: str = "auto",
    max_cpl: int = 42,
    max_lines: int = 2,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> List[Dict[str, Any]]:
    """items: [{id, text, unsure}] in order. Returns accepted fixes: [{id, before, after, reason}].

    Only the words ElevenLabs Scribe itself scored as low-confidence ('unsure', see unsure_words_for_spans) may be
    changed. A subtitle with no unsure words is never sent to the AI, so a word Scribe heard clearly is never rewritten."""
    if not items:
        return []
    ctx = context or {}
    style = str(ctx.get("writing_style") or "spoken")
    pos = {id(x): n for n, x in enumerate(items)}
    todo = [x for x in items if x.get("unsure")]
    if not todo:
        if on_progress:
            on_progress(1, 1)
        return []
    batches = [todo[i:i + BATCH_SIZE] for i in range(0, len(todo), BATCH_SIZE)]
    sem = asyncio.Semaphore(PARALLEL)
    done = 0
    results: List[List[Dict[str, Any]]] = []

    async def run(bi: int) -> List[Dict[str, Any]]:
        nonlocal done
        first, last = pos[id(batches[bi][0])], pos[id(batches[bi][-1])]
        before = [{"id": x["id"], "text": x["text"]} for x in items[max(0, first - NEIGHBOURS):first]]
        after = [{"id": x["id"], "text": x["text"]} for x in items[last + 1:last + 1 + NEIGHBOURS]]
        batch = [{"id": x["id"], "text": x["text"], "unsure": list(x["unsure"])} for x in batches[bi]]
        fixes: List[Dict[str, Any]] = []
        async with sem:
            try:
                data = await _gemini_json(_polish_prompt(ctx, language, batch, before, after, max_cpl, max_lines))
                by_id = {x["id"]: x for x in batches[bi]}
                for f in (data or {}).get("fixes", []) or []:
                    try:
                        fid = int(f.get("id"))
                    except (TypeError, ValueError):
                        continue
                    new = str(f.get("text") or "")
                    item = by_id.get(fid)
                    old = item["text"] if item is not None else None
                    if old is not None and _accept_change(old, new, language, style, max_cpl, max_lines, False) \
                            and _only_unsure_changed(old, new, item["unsure"]):
                        fixes.append({"id": fid, "before": old, "after": new.strip(), "reason": str(f.get("reason") or "").strip()})
            except Exception as exc:  # a failed batch keeps its original text
                log_terminal("CONTEXT-POLISH", f"Batch {bi + 1}/{len(batches)} skipped: {exc}", level="WARNING")
        done += 1
        if on_progress:
            on_progress(done, len(batches))
        return fixes

    results = await asyncio.gather(*(run(i) for i in range(len(batches))))
    return [f for part in results for f in part]


# --------------------------------------------------------------------------------------------------
# Auto-fill
# --------------------------------------------------------------------------------------------------

async def autofill_context(events: List[Dict[str, Any]], language: str = "auto") -> Dict[str, Any]:
    rows, used = [], 0
    for e in events:
        t = str(e.get("text") or "").replace("\n", " ").strip()
        if not t:
            continue
        spk = e.get("speaker") or e.get("primary_speaker") or ""
        row = f"[{spk}] {t}" if spk else t
        used += len(row) + 1
        if used > AUTOFILL_CHAR_BUDGET:
            break
        rows.append(row)
    prompt = f"""You are preparing a briefing for a subtitle proofreader. Read this transcript (speech recognition output, language: {language or 'auto'}) and
describe the video. Base everything ONLY on the transcript. Never invent facts. Leave a field empty if unknown.

Return JSON only:
{{"title":"","content_type":"interview|film|documentary|lecture|news|podcast|ad|kids|tutorial|other","topic":"main subject or domain",
"summary":"2-4 sentences","region":"where/who it is for if clear","language_mix":"e.g. Hindi with some English words",
"variety":"accent or dialect if clear","writing_style":"spoken|light|clean",
"speakers":[{{"name":"as used in the transcript","role":"short role/relationship","style":"how they talk"}}],
"key_terms":["names, brands, places and technical terms that must be spelled exactly (max 40)"],
"misheard":[{{"heard":"a wrong spelling seen in the transcript","correct":"the right one"}}]}}
Rules: for 'misheard' only list spellings that clearly refer to the same name or term as another spelling in the transcript (max 15).
'writing_style' is 'spoken' unless the speech is clearly formal and scripted.

TRANSCRIPT:
""" + "\n".join(rows)
    data = await _gemini_json(prompt, temperature=0.1) or {}
    speakers = []
    for s in data.get("speakers", []) or []:
        if isinstance(s, dict) and str(s.get("name") or "").strip() and not re.fullmatch(r"speaker\s*\d+", str(s["name"]).strip(), re.I):
            speakers.append({k: str(s.get(k) or "").strip() for k in ("name", "role", "style")})
    ct = str(data.get("content_type") or "").strip().lower()
    ws = str(data.get("writing_style") or "spoken").strip().lower()
    return {
        "title": str(data.get("title") or "").strip(), "content_type": ct if ct in CONTENT_TYPES else "",
        "topic": str(data.get("topic") or "").strip(), "summary": str(data.get("summary") or "").strip(),
        "region": str(data.get("region") or "").strip(), "language_mix": str(data.get("language_mix") or "").strip(),
        "variety": str(data.get("variety") or "").strip(), "writing_style": ws if ws in WRITING_STYLES else "spoken",
        "speakers": speakers[:12],
        "key_terms": [str(t).strip() for t in (data.get("key_terms") or []) if str(t).strip()][:40],
        "corrections": [f"{str(m.get('heard')).strip()} => {str(m.get('correct')).strip()}"
                        for m in (data.get("misheard") or []) if isinstance(m, dict) and str(m.get("heard") or "").strip() and str(m.get("correct") or "").strip()][:15],
        "lines_read": len(rows), "lines_total": len(events),
    }
