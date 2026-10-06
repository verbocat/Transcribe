"""
Dialogue Harmonizer & Semantic Splitting Engine for VerboLabs Karya Studio.

Provides:
1. Multi-Speaker Dialogue Harmonization: Autonomous detection of speaker transition seams
   and syntactic affinity repair (prevents tail words like 'enjoy' or 'चाहता हूँ' from bleeding
   into the next speaker's subtitle).
2. Acoustic Pause Dominance & Indic Shield Clause Slicing: Replaces naive character-count
   slicing with pause-aware linguistic clause chunking for Hindi, Hinglish, and English.
3. 100% Verbatim Bag-of-Words Safety Invariants: Guarantees zero dropped, added, or mutated words.
"""

import re
import logging
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# Indic Postpositions & Connectors (Forbidden cut zones in continuous speech)
INDIC_POSTPOSITIONS = {
    'ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक', 'लिए', 'साथ',
    'बारे', 'वजह', 'द्वारा', 'वाला', 'वाले', 'वाली',
    'ne', 'ko', 'se', 'ka', 'ke', 'ki', 'mein', 'me', 'par', 'pe', 'tak', 'liye', 'saath',
    'bare', 'vajah', 'dwara', 'wala', 'wale', 'wali'
}

# Indic Auxiliary & Compound Verb Endings (Forbidden cut zones in continuous speech)
INDIC_VERB_AUXILIARIES = {
    'है', 'हैं', 'था', 'थी', 'थे', 'होगा', 'होगी', 'होंगे', 'रहा', 'रही', 'रहे',
    'सकता', 'सकती', 'सकते', 'गया', 'गई', 'गए', 'लिया', 'ली', 'दिए', 'दिया', 'दी',
    'चाहिए', 'पड़ा', 'पड़ी', 'पड़े', 'चुका', 'चुकी', 'चुके', 'हुआ', 'हुई', 'हुए',
    'चाहता', 'चाहती', 'चाहते', 'हूँ',
    'hai', 'hain', 'tha', 'thi', 'the', 'hoga', 'hogi', 'honge', 'raha', 'rahi', 'rahe',
    'sakta', 'sakti', 'sakte', 'gaya', 'gayi', 'gaye', 'liya', 'li', 'diye', 'diya', 'di',
    'chahiye', 'pada', 'padi', 'pade', 'chuka', 'chuki', 'chuke', 'hua', 'hui', 'hue',
    'chahta', 'chahti', 'chahte', 'hoon', 'hun',
    'thaa', 'thi'
}

# Common Conjunctions & Clause Starters (High preference for split points)
CLAUSE_CONJUNCTIONS = {
    'और', 'या', 'अथवा', 'लेकिन', 'मगर', 'किंतु', 'परंतु', 'क्योंकि', 'इसलिए', 'ताकि',
    'कि', 'तो', 'जब', 'तब', 'अगर', 'यदि', 'जैसे', 'वैसे', 'हालाँकि',
    'and', 'but', 'or', 'so', 'because', 'although', 'while', 'when', 'if', 'that', 'which', 'who',
    'aur', 'ya', 'lekin', 'magar', 'kintu', 'kyunki', 'isliye', 'taaki', 'agar', 'yadi', 'jab', 'tab', 'to'
}

# Punctuation Marks signaling Natural Sentence / Clause End
CLAUSE_PUNCTUATION = {'.', '!', '?', '।', '॥', ';', ':', '--', '…', '...'}


def _tokenize_clean(text: str) -> List[str]:
    """Tokenize text into lowercase words stripped of punctuation for diff verification."""
    return [w.strip('.,!?:;\"\'`~-_—–।॥()[]{}…').lower() for w in text.split() if w.strip('.,!?:;\"\'`~-_—–।॥()[]{}…')]


def verify_word_integrity(original_events: List[Dict[str, Any]], modified_events: List[Dict[str, Any]]) -> bool:
    """
    Enforces Invariant 1: 100% Verbatim Capture.
    Asserts that the bag of spoken words is preserved identically.
    """
    orig_words = []
    for ev in original_events:
        orig_words.extend(_tokenize_clean(str(ev.get("text", ""))))

    mod_words = []
    for ev in modified_events:
        mod_words.extend(_tokenize_clean(str(ev.get("text", ""))))

    if orig_words != mod_words:
        logger.warning(f"[Dialogue Harmonizer] Word integrity warning: original count {len(orig_words)} != modified {len(mod_words)}")
        return False
    return True


def harmonize_dialogue_turns(
    events: List[Dict[str, Any]],
    whisper_words: Optional[List[Dict[str, Any]]] = None,
    language: str = "Hindi"
) -> List[Dict[str, Any]]:
    """
    Pass 2: Dialogue Turn Harmonizer.
    Inspects seams between adjacent subtitle events, especially across speaker transitions.
    Re-attaches severed tail words (e.g. 'enjoy', 'चाहता हूँ', 'था', 'गया') back to their rightful
    speaker so each speaker's sentence is semantically and grammatically complete.
    """
    if not events or len(events) < 2:
        return events

    harmonized = [dict(ev) for ev in events]
    dirty = False

    for i in range(len(harmonized) - 1):
        ev_curr = harmonized[i]
        ev_next = harmonized[i + 1]

        text_curr = str(ev_curr.get("text", "")).strip()
        text_next = str(ev_next.get("text", "")).strip()

        words_curr = text_curr.split()
        words_next = text_next.split()

        if not words_curr or not words_next:
            continue

        spk_curr = (ev_curr.get("speakers") or ["Speaker 1"])[0]
        spk_next = (ev_next.get("speakers") or ["Speaker 1"])[0]

        last_curr_clean = words_curr[-1].lower().rstrip('.,!?:;--…।॥')
        first_next_clean = words_next[0].lower().rstrip('.,!?:;--…।॥')
        second_next_clean = words_next[1].lower().rstrip('.,!?:;--…।॥') if len(words_next) > 1 else ""

        # Condition 1: Dangling English Conjunction at end of Speaker 1, verb at start of Speaker 2
        # e.g. "I want to go there and" + "enjoy yeah it's a great place"
        # -> "enjoy" belongs with "and enjoy" in Speaker 1
        if last_curr_clean in {'and', 'to', 'or', 'so', 'because', 'want', 'gonna', 'wanna'}:
            # Check if first word of next event is a verb complement or continuing word
            # and NOT an obvious affirmative response like 'yeah', 'yes', 'no', 'sure', 'right', 'ok', 'okay'
            if first_next_clean not in {'yeah', 'yes', 'no', 'sure', 'right', 'ok', 'okay', 'ha', 'haan', 'nahi', 'are', 'arrey'}:
                # Move first word of next to current
                word_to_move = words_next.pop(0)
                words_curr.append(word_to_move)

                ev_curr["text"] = " ".join(words_curr)
                ev_next["text"] = " ".join(words_next)
                dirty = True
                logger.info(f"[Harmonizer] Repaired cross-speaker English seam: moved '{word_to_move}' to Speaker {spk_curr}")
                continue

        # Condition 2: Indic Severed Verbal Complex across Speaker transition
        # e.g. "मैं वहाँ जाना" + "चाहता हूँ। हाँ बिल्कुल सही है।"
        # -> "चाहता हूँ" belongs to Speaker 1
        if first_next_clean in INDIC_VERB_AUXILIARIES:
            # Check if second word is also an auxiliary (e.g. "रहा" + "है" or "चाहता" + "हूँ")
            words_to_move = [words_next.pop(0)]
            if words_next and words_next[0].lower().rstrip('.,!?:;--…।॥') in INDIC_VERB_AUXILIARIES:
                words_to_move.append(words_next.pop(0))

            words_curr.extend(words_to_move)
            ev_curr["text"] = " ".join(words_curr)
            ev_next["text"] = " ".join(words_next)
            dirty = True
            logger.info(f"[Harmonizer] Repaired Indic severed verb: moved {' '.join(words_to_move)} to Speaker {spk_curr}")
            continue

        # Condition 3: Indic Severed Postposition across Speaker transition
        # e.g. "इस काम के" + "लिए धन्यवाद" (or with different speaker)
        if first_next_clean in INDIC_POSTPOSITIONS and len(words_next) > 1:
            if second_next_clean not in INDIC_POSTPOSITIONS:
                # e.g. "लिए" followed by non-postposition
                word_to_move = words_next.pop(0)
                words_curr.append(word_to_move)
                ev_curr["text"] = " ".join(words_curr)
                ev_next["text"] = " ".join(words_next)
                dirty = True
                logger.info(f"[Harmonizer] Repaired Indic severed postposition: moved '{word_to_move}' to Speaker {spk_curr}")
                continue

    # Final safety assertion: Verify no words were lost
    if dirty:
        if verify_word_integrity(events, harmonized):
            return harmonized
        else:
            logger.warning("[Harmonizer] Word integrity check failed. Reverting to original events.")
            return events

    return events


PUNCT_STRIP = '.,!?:;\"\'`~-_—–।॥…'


def get_acoustic_gap_after_word(
    word_text: str,
    next_word_text: str,
    approx_time: float,
    whisper_words: Optional[List[Dict[str, Any]]] = None
) -> float:
    """
    Finds the exact acoustic silence gap (in seconds) between word_text and next_word_text
    using Whisper word-level timestamps.
    """
    if not whisper_words:
        # If no whisper_words but text explicitly ends with hesitation ellipsis, return synthetic pause
        if word_text.endswith(('…', '...', '--')):
            return 0.500
        return 0.0

    w_clean = word_text.lower().strip(PUNCT_STRIP)
    next_clean = next_word_text.lower().strip(PUNCT_STRIP)

    best_match_idx = -1
    min_time_diff = 9999.0

    for idx, w in enumerate(whisper_words):
        w_word = w.get("word", "").lower().strip(PUNCT_STRIP)
        w_start = float(w.get("start", 0.0))
        if w_word == w_clean:
            diff = abs(w_start - approx_time)
            if diff < min_time_diff and diff < 5.0:
                min_time_diff = diff
                best_match_idx = idx

    if best_match_idx >= 0 and best_match_idx + 1 < len(whisper_words):
        curr_end = float(whisper_words[best_match_idx].get("end", 0.0))
        next_start = float(whisper_words[best_match_idx + 1].get("start", 0.0))
        gap = next_start - curr_end
        return max(0.0, gap)

    return 0.0


def score_split_candidate(
    prev_w: str,
    next_w: str,
    cum_chars: int,
    target_mid: float,
    acoustic_gap: float,
    is_trailing_hesitation: bool = False
) -> float:
    """
    Evaluates the syntactic & acoustic quality of splitting between prev_w and next_w.
    Lower score = better split point.

    Incorporates the Hybrid Architecture:
    1. Acoustic Pause Dominance (User Rule): If acoustic_gap >= 0.450s, heavy bonus (-500)
       regardless of whether prev_w is 'pr', 'thaa', 'ne', or 'ki'.
    2. Punctuation Bonus: Sentence enders get -350.
    3. Conjunction Bonus: Natural clause starters get -150.
    4. Indic Shield (Forbidden Cut Zones in Continuous Speech):
       If speech is continuous (gap < 0.350s), cuts inside compound verbs or postpositions
       receive a prohibitive +3000 penalty.
    """
    prev_clean = prev_w.lower().rstrip('.,!?:;--…।॥')
    next_clean = next_w.lower().rstrip('.,!?:;--…।॥')

    # Base visual balance penalty (gentle)
    score = abs(cum_chars - target_mid) * 1.0

    # ──────────────────────────────────────────────────────────
    # 1. ACOUSTIC PAUSE DOMINANCE (Physics Overrules Grammar)
    # ──────────────────────────────────────────────────────────
    # If the speaker physically took a breath, sighed, or paused >= 450ms,
    # that pause marks the natural end of the breath unit!
    if acoustic_gap >= 0.450 or is_trailing_hesitation:
        score -= 500.0  # Dominant bonus!
        # When an acoustic pause occurred, ending on 'pr', 'par', 'thaa' is natural!
        return score

    # ──────────────────────────────────────────────────────────
    # 2. CONTINUOUS SPEECH (gap < 450ms) -> LINGUISTIC SHIELD ACTIVE
    # ──────────────────────────────────────────────────────────

    # Sentence / Clause ending punctuation
    if any(prev_w.endswith(p) for p in CLAUSE_PUNCTUATION):
        score -= 350.0
    elif any(prev_w.endswith(p) for p in {',', ';', '--', '…'}):
        score -= 200.0

    # Major clause conjunctions
    if next_clean in CLAUSE_CONJUNCTIONS:
        score -= 150.0

    # INDIC SHIELD 1: Never sever [Noun] + [Postposition] in continuous speech!
    # e.g. "राम [break] ने", "घर [break] में"
    if next_clean in INDIC_POSTPOSITIONS:
        score += 3000.0

    # INDIC SHIELD 2: Never sever [Main Verb] + [Auxiliary] in continuous speech!
    # e.g. "गया [break] था", "कर [break] रहा है", "हो [break] सकता है"
    if next_clean in INDIC_VERB_AUXILIARIES:
        score += 3000.0

    # INDIC SHIELD 3: Dangling Honorifics / Titles
    bad_honorifics = {'श्री', 'श्रीमती', 'सुश्री', 'डॉक्टर', 'डॉ.', 'पंडित', 'पं.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.'}
    if prev_clean in bad_honorifics:
        score += 3000.0

    # English articles / possessives
    bad_lead_ins = {'a', 'an', 'the', 'my', 'his', 'her', 'our', 'their', 'its', 'your'}
    if prev_clean in bad_lead_ins:
        score += 2500.0

    return score
