"""
Whisper-based timestamp alignment for Subtitle Studio.

Runs OpenAI Whisper (medium model, CPU) to extract word-level timestamps,
then aligns Gemini-generated subtitle events to precise acoustic boundaries.
Gemini owns the text; Whisper only provides start/end timing.
"""

import os
import re
import shutil
import logging
from pathlib import Path
from difflib import SequenceMatcher
from typing import List, Dict, Any, Optional
from datetime import datetime
import soundfile as sf
import numpy as np

# Ensure ffmpeg executable directory is on PATH for whisper and other tools
try:
    import imageio_ffmpeg
    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
    if ffmpeg_bin and Path(ffmpeg_bin).exists():
        bin_dir = Path(ffmpeg_bin).parent
        target_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        target_ffmpeg = bin_dir / target_name
        if not target_ffmpeg.exists() and Path(ffmpeg_bin).name != target_name:
            try:
                shutil.copyfile(ffmpeg_bin, target_ffmpeg)
                if os.name != "nt":
                    target_ffmpeg.chmod(0o755)
            except Exception:
                pass
        bin_dir_str = str(bin_dir)
        if bin_dir_str not in os.environ.get("PATH", ""):
            os.environ["PATH"] = bin_dir_str + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass

logger = logging.getLogger(__name__)

DEBUG_ALIGNER = os.getenv("DEBUG_WHISPER_ALIGNER", "false").lower() in ["1", "true", "yes"]

# Phase 3 Fix 5: Feature flag — pre-filter Whisper word list to speech-only regions before DTW.
# When True, words that fall in silence gaps between acoustic anchors are removed before alignment.
# This prevents the DTW from anchoring Gemini events to hallucinated words during silence.
# Default: false (safe off). Enable with ACOUSTIC_DTW_PREFILTER=true in .env
ACOUSTIC_DTW_PREFILTER = os.getenv("ACOUSTIC_DTW_PREFILTER", "false").lower() in ["1", "true", "yes"]

# Module-level model cache
_whisper_model = None
_whisper_model_name = None
_whisper_patched = False


def _ensure_whisper_patched():
    """Monkey-patch whisper.audio.load_audio lazily so it uses soundfile directly without ffmpeg subprocess."""
    global _whisper_patched
    if _whisper_patched:
        return
    try:
        import whisper.audio
        def _safe_whisper_load_audio(file: str, sr: int = 16000):
            try:
                data, file_sr = sf.read(file, dtype="float32")
                if len(data.shape) > 1:
                    data = data.mean(axis=1)
                if file_sr != sr:
                    from scipy.signal import resample
                    num_samples = int(len(data) * sr / file_sr)
                    data = resample(data, num_samples).astype(np.float32)
                return data
            except Exception:
                return _orig_load_audio(file, sr)

        if hasattr(whisper.audio, "load_audio") and not hasattr(whisper.audio, "_orig_load_audio"):
            _orig_load_audio = whisper.audio.load_audio
            whisper.audio._orig_load_audio = _orig_load_audio
            whisper.audio.load_audio = _safe_whisper_load_audio
        _whisper_patched = True
    except Exception:
        pass


def log_terminal(msg: str):
    """Print clean formatted timestamped log to terminal."""
    now_str = datetime.now().strftime('%H:%M:%S')
    print(f"[{now_str}] [Whisper Aligner] {msg}", flush=True)


def _filter_hallucinated_words(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter out hallucinated or invalid word entries produced by Whisper.

    Whisper (especially medium+ on CPU with greedy decode) can produce:
      - Words with impossibly short duration (<30ms) — attention artifacts
      - Words with zero/negative duration (end <= start)
      - Words whose timestamps didn't advance beyond the previous word
        (stuck-hallucination: model re-generates the same region repeatedly)
      - Completely empty words after stripping whitespace

    Removing these before alignment prevents the DTW and span-matcher from
    trying to anchor Gemini events to timestamps that don't represent real speech.
    """
    filtered = []
    prev_end = -1.0
    for w in words:
        word_text = w.get("word", "").strip()
        if not word_text:
            continue
        w_start = float(w.get("start", 0.0))
        w_end = float(w.get("end", 0.0))
        duration = w_end - w_start
        # Reject zero or negative duration
        if duration <= 0.0:
            continue
        # Reject impossibly short words (<30ms) — almost always hallucination artifacts
        if duration < 0.030:
            continue
        # Reject if end timestamp didn't advance past previous word's end
        # (means Whisper is re-generating over the same audio region)
        if w_end <= prev_end + 0.01:
            continue
        filtered.append(w)
        prev_end = w_end
    return filtered


def load_whisper_model(model_name: Optional[str] = None):
    """
    Lazy-load Whisper model and cache it globally.
    Defaults to 'medium'.
    """
    global _whisper_model, _whisper_model_name

    is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
    if not model_name:
        # Tiny on cloud (Render 512MB RAM), base on local desktop.
        # Medium is NOT recommended here: Whisper is used only for acoustic timing,
        # not full transcription. Base gives tighter word timestamps, lower hallucination
        # rate under greedy decode, and processes all 30s chunks without memory pressure.
        model_name = os.getenv("WHISPER_MODEL", "tiny" if is_cloud else "base")

    if _whisper_model is not None and _whisper_model_name == model_name:
        return _whisper_model

    _ensure_whisper_patched()

    try:
        import whisper
        import torch
        torch.set_num_threads(2 if is_cloud else (os.cpu_count() or 4))

        log_terminal(f"Loading Whisper '{model_name}' model (CPU, is_cloud={is_cloud})...")
        _whisper_model = whisper.load_model(model_name, device="cpu")
        _whisper_model_name = model_name
        log_terminal(f"Whisper '{model_name}' model loaded successfully.")
        return _whisper_model
    except ImportError:
        log_terminal("ERROR: openai-whisper is not installed. Run: pip install openai-whisper")
        raise ImportError(
            "openai-whisper is not installed. "
            "Install it with: pip install openai-whisper"
        )
    except Exception as e:
        log_terminal(f"ERROR loading Whisper model: {e}")
        raise


def get_whisper_word_timestamps(
    audio_path: str,
    language: Optional[str] = None,
    model_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Run Whisper on the full audio file and extract word-level timestamps.

    Args:
        audio_path: Path to the WAV audio file.
        language: Optional language code (e.g. 'hi', 'en', 'ta') for better accuracy.
        model_name: Whisper model size (defaults to 'medium').

    Returns:
        Flat list of word dicts: [{"word": "hello", "start": 0.52, "end": 0.88}, ...]
    """
    model = load_whisper_model(model_name)

    log_terminal(f"Running Whisper on audio: {audio_path} (language={language or 'auto'})...")

    import torch
    is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
    torch.set_num_threads(1 if is_cloud else min(4, os.cpu_count() or 4))

    # Fast acoustic alignment transcribe options (greedy search is 3-4x faster on CPU)
    transcribe_opts = {
        "word_timestamps": True,
        "fp16": False,  # CPU mode - no fp16
        "beam_size": 1,
        "best_of": 1,
        "temperature": 0.0,
        "condition_on_previous_text": False,
    }
    if language:
        # Map common language names to Whisper language codes
        lang_code = _map_language_to_whisper_code(language)
        if lang_code:
            transcribe_opts["language"] = lang_code
            script_prompts = {
                "hi": "यह बातचीत हिंदी में है। कृपया शुद्ध देवनागरी लिपि में ही लिखें।",
                "mr": "हे मराठीत संभाषण आहे. कृपया देवनागरी लिपीत लिहा.",
                "bn": "এটি বাংলায় কথোপকথন। অনুগ্রহ করে বাংলা লিপিতে লিখুন।",
                "ta": "இது தமிழில் உரையாடல். தயவுசெய்து தமிழ் எழுத்துக்களில் எழுதவும்.",
                "te": "ఇది తెలుగులో సంభాషణ. దయచేసి తెలుగు లిపిలో రాయండి.",
                "gu": "આ ગુજરાતીમાં વાતચીત છે. કૃપા કરીને ગુજરાતી લિપિમાં લખો.",
                "pa": "ਇਹ ਪੰਜਾਬੀ ਵਿੱਚ ਗੱਲਬਾਤ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਗੁਰਮੁਖੀ ਲਿਪੀ ਵਿੱਚ ਲਿਖੋ।",
                "ur": "یہ بات چیت اردو میں ہے۔ برائے مہربانی اردو رسم الخط میں لکھیں۔",
            }
            if lang_code in script_prompts:
                transcribe_opts["initial_prompt"] = script_prompts[lang_code]

    # Read audio directly using soundfile - avoids subprocess ffmpeg call completely!
    try:
        data, sr = sf.read(audio_path, dtype="float32")
        if len(data.shape) > 1:
            data = data.mean(axis=1)  # downmix stereo to mono
        if sr != 16000:
            # scipy.resample_poly is a polyphase filter — far better quality than
            # np.interp (linear). This matters because medium model is more sensitive
            # to resampling artifacts than base/tiny.
            try:
                from scipy.signal import resample_poly
                from math import gcd
                g = gcd(int(sr), 16000)
                data = resample_poly(data, 16000 // g, int(sr) // g).astype(np.float32)
            except Exception:
                # Fallback to linear interpolation if scipy is unavailable
                new_samples = int(len(data) * 16000 / sr)
                data = np.interp(
                    np.linspace(0, len(data), new_samples, endpoint=False),
                    np.arange(len(data)),
                    data
                ).astype(np.float32)
        audio_input = data
    except Exception as read_err:
        log_terminal(f"soundfile direct read fallback: {read_err}")
        audio_input = audio_path

    try:
        result = model.transcribe(audio_input, **transcribe_opts)
    finally:
        import gc
        gc.collect()

    # Extract flat word list from all segments
    words = []
    for segment in result.get("segments", []):
        for word_info in segment.get("words", []):
            words.append({
                "word": word_info.get("word", "").strip(),
                "start": round(float(word_info.get("start", 0.0)), 3),
                "end": round(float(word_info.get("end", 0.0)), 3),
            })

    log_terminal(f"Whisper extracted {len(words)} words with timestamps.")

    # Filter hallucinated/invalid word timestamps before passing to aligner.
    # Without this, medium model hallucinations cause the DTW/span matcher to
    # anchor Gemini events to timestamps that don't correspond to real speech.
    words = _filter_hallucinated_words(words)
    log_terminal(f"After hallucination filter: {len(words)} valid words remaining.")

    return words


def _map_language_to_whisper_code(language: str) -> Optional[str]:
    """
    Map user-facing language names to Whisper's ISO 639-1 codes.
    Returns None if not recognized (Whisper will auto-detect).
    """
    lang_map = {
        # Full names (as used in the Subtitle Studio UI)
        "english": "en",
        "hindi": "hi",
        "bengali": "bn",
        "tamil": "ta",
        "telugu": "te",
        "marathi": "mr",
        "gujarati": "gu",
        "kannada": "kn",
        "malayalam": "ml",
        "punjabi": "pa",
        "urdu": "ur",
        "odia": "or",
        "assamese": "as",
        "nepali": "ne",
        "spanish": "es",
        "french": "fr",
        "german": "de",
        "japanese": "ja",
        "korean": "ko",
        "chinese": "zh",
        "arabic": "ar",
        "portuguese": "pt",
        "russian": "ru",
        "italian": "it",
        "dutch": "nl",
        "turkish": "tr",
        "thai": "th",
        "vietnamese": "vi",
        "indonesian": "id",
        "malay": "ms",
    }

    lang_lower = language.lower().strip()

    # Direct match on full name
    if lang_lower in lang_map:
        return lang_map[lang_lower]

    # Already a 2-letter code
    if len(lang_lower) <= 3 and lang_lower.isalpha():
        return lang_lower

    return None


import unicodedata

def _normalize_text(text: str) -> str:
    """
    Normalize text for fuzzy matching across multilingual scripts (Devanagari, Indic, Latin, etc.).
    Preserves combining marks (matras, virama, vowel signs) while cleanly stripping punctuation.
    Also unifies common Hindi variations (chandrabindu -> anusvara, strips nuktas).
    """
    if not text:
        return ""
    text = text.lower().strip()
    # Remove common subtitle formatting
    text = re.sub(r'</?i>', '', text)
    text = re.sub(r'♪', '', text)
    # Strip invisible joiners (ZWNJ, ZWJ)
    text = text.replace('\u200c', '').replace('\u200d', '')
    # Unicode NFC normalization
    text = unicodedata.normalize('NFC', text)
    # Harmonize common Devanagari spelling variations
    text = text.replace('\u0901', '\u0902')  # chandrabindu (ँ) -> anusvara (ं)
    text = text.replace('\u093c', '')       # nukta (़)
    # Strip punctuation and symbols without destroying combining marks (matras, vowel signs)
    cleaned = ''.join(' ' if unicodedata.category(ch).startswith(('P', 'S')) else ch for ch in text)
    # Collapse multiple spaces
    return re.sub(r'\s+', ' ', cleaned).strip()


def _extract_boundary_words(text: str, count: int = 3) -> tuple:
    """
    Extract the first N and last N words from subtitle text.
    Returns (first_words_str, last_words_str).
    """
    words = text.replace('\n', ' ').split()
    if not words:
        return "", ""
    first_n = ' '.join(words[:count])
    last_n = ' '.join(words[-count:])
    return first_n, last_n


def _fuzzy_match_score(word_a: str, word_b: str) -> float:
    """Fuzzy similarity score between two normalized words."""
    if not word_a or not word_b:
        return 0.0
    if word_a == word_b:
        return 1.0
    if word_a in word_b or word_b in word_a:
        return 0.85
    return SequenceMatcher(None, word_a, word_b).ratio()


def _find_best_word_match(
    target_text: str,
    whisper_words: List[Dict[str, Any]],
    search_start: float,
    search_end: float,
    window_size: int = 3,
    boundary: str = "start"
) -> Optional[Dict[str, Any]]:
    """
    Find the Whisper word sequence that best matches the target text
    within the given time window.

    Args:
        target_text: Normalized text to match (first/last N words of subtitle).
        whisper_words: Full list of Whisper word timestamps.
        search_start: Start of time window to search (seconds).
        search_end: End of time window to search (seconds).
        window_size: Number of consecutive Whisper words to consider as a group.
        boundary: 'start' or 'end' — determines which word's timestamp to return.

    Returns:
        The best matching Whisper word dict, or None if no confident match found.
    """
    if not target_text or not whisper_words:
        return None

    # Filter words within search window
    candidates = [
        (i, w) for i, w in enumerate(whisper_words)
        if w["start"] >= search_start - 0.5 and w["end"] <= search_end + 0.5
    ]

    if not candidates:
        return None

    best_score = 0.0
    best_word = None

    for idx, (global_i, _) in enumerate(candidates):
        # Build a window of consecutive words
        end_idx = min(idx + window_size, len(candidates))
        window_words = [candidates[j][1] for j in range(idx, end_idx)]
        window_text = _normalize_text(" ".join(w["word"] for w in window_words))

        score = _fuzzy_match_score(target_text, window_text)

        if score > best_score:
            best_score = score
            if boundary == "start":
                best_word = window_words[0]  # First word in the matched window
            else:
                best_word = window_words[-1]  # Last word in the matched window

    # Minimum confidence threshold — below this, we don't trust the match
    if best_score < 0.35:
        return None

    return best_word


def extract_acoustic_timeline_anchors(
    whisper_words: List[Dict[str, Any]],
    min_pause_sec: float = 0.40,
    max_cluster_sec: float = 12.0
) -> List[Dict[str, Any]]:
    """
    Groups Whisper acoustic words into natural spoken phrases based on silence pauses.
    Returns list of dicts: [{'start': 5.0, 'end': 9.64, 'text': '...'}]
    Used to ground Gemini in prompt with genuine physical speech boundaries.
    """
    if not whisper_words:
        return []
    
    anchors = []
    curr_words = []
    cluster_start = whisper_words[0]["start"]
    
    for i, w in enumerate(whisper_words):
        word_txt = w.get("word", "").strip()
        if not word_txt:
            continue
        
        w_start = float(w.get("start", 0.0))
        w_end = float(w.get("end", w_start + 0.3))
        
        if curr_words:
            prev_end = float(curr_words[-1].get("end", 0.0))
            pause = w_start - prev_end
            span_dur = w_end - cluster_start
            
            # Split into new acoustic anchor if pause >= min_pause_sec or cluster too long
            if pause >= min_pause_sec or span_dur > max_cluster_sec:
                anchors.append({
                    "start": round(cluster_start, 3),
                    "end": round(prev_end, 3),
                    "text": " ".join(x.get("word", "").strip() for x in curr_words)
                })
                curr_words = [w]
                cluster_start = w_start
                continue
                
        curr_words.append(w)
        
    if curr_words:
        anchors.append({
            "start": round(cluster_start, 3),
            "end": round(float(curr_words[-1].get("end", cluster_start + 0.5)), 3),
            "text": " ".join(x.get("word", "").strip() for x in curr_words)
        })
        
    return anchors


def _prefilter_words_to_speech_regions(
    words: List[Dict[str, Any]],
    anchors: List[Dict[str, Any]],
    collar_sec: float = 0.10
) -> List[Dict[str, Any]]:
    """
    Phase 3 Fix 5: Remove Whisper words that fall in silence gaps between acoustic anchors.

    Words in silence regions are almost always Whisper hallucinations — the model invents
    words for breath sounds, ambient noise, or decoder artifacts between real speech bursts.
    Removing them before DTW alignment prevents false matches in silent segments.

    A word is KEPT if it overlaps with any acoustic anchor interval (with collar_sec margin).
    A word is REMOVED if it falls entirely in a silence gap between anchors.

    Args:
        words: Full Whisper word list.
        anchors: Output of extract_acoustic_timeline_anchors() — speech interval list.
        collar_sec: Extra margin around each anchor (default 0.10s) to avoid
                    clipping words at the edge of speech bursts.

    Returns:
        Filtered word list containing only words overlapping real speech regions.
    """
    if not anchors:
        return words  # No anchors = can't filter = return full list unchanged

    filtered = []
    for w in words:
        w_start = float(w.get("start", 0.0))
        w_end = float(w.get("end", w_start + 0.1))
        # Check if word overlaps any acoustic speech interval (with collar)
        in_speech = any(
            w_start < (a["end"] + collar_sec) and w_end > (a["start"] - collar_sec)
            for a in anchors
        )
        if in_speech:
            filtered.append(w)

    removed = len(words) - len(filtered)
    if removed > 0:
        log_terminal(f"Acoustic pre-filter: removed {removed} silence-region words from {len(words)} total (kept {len(filtered)}).")
    return filtered


DISTINCT_OCCURRENCE_GAP_SEC = 0.6  # Tightened from 1.5s for rapid dialogue and filler exchanges


def _find_best_span(
    clean_words: List[str],
    target_norm: str,
    target_len: int,
    orig_st: float,
    audio_cursor: float,
    whisper_words: List[Dict[str, Any]],
    search_start: int,
    total_w: int
) -> tuple:
    """
    Exact scan/score/margin logic, extracted so tests exercise real code.

    Scans candidate word spans in Whisper transcript, scores fuzzy similarity,
    applies proximity penalty relative to orig_st, and enforces margin requirements
    over competing distinct occurrences (spaced > DISTINCT_OCCURRENCE_GAP_SEC apart).

    Returns:
        (best_s_idx, best_e_idx, best_score, second_best_score, is_confident)
    """
    best_s_idx = None
    best_e_idx = None
    best_score = 0.0
    best_time_diff = float('inf')
    best_total_sim = 0.0
    second_best_score = 0.0

    # Widened from +35 to +55: gives the scanner more room to find matches
    # when there's a pause or dense dialogue causing cursor lag.
    max_scan = min(total_w, search_start + target_len + 55)
    candidates = []

    for s_i in range(search_start, max_scan):
        w_cand = whisper_words[s_i]
        # Don't match words that ended significantly before our confirmed audio cursor
        if w_cand["end"] < audio_cursor - 0.6:
            continue

        # Check candidate span lengths around target_len
        min_span = max(1, target_len - 3)
        max_span = min(target_len + 6, total_w - s_i + 1)
        for span_len in range(min_span, max_span):
            e_i = s_i + span_len - 1
            span_text = " ".join(_normalize_text(whisper_words[k]["word"]) for k in range(s_i, e_i + 1))

            sim = SequenceMatcher(None, target_norm, span_text).ratio()
            first_sim = SequenceMatcher(None, clean_words[0], _normalize_text(whisper_words[s_i]["word"])).ratio()
            last_sim = SequenceMatcher(None, clean_words[-1], _normalize_text(whisper_words[e_i]["word"])).ratio()

            # Weight full similarity plus boundary word matches
            total_sim = sim * 0.55 + first_sim * 0.25 + last_sim * 0.20

            # Proximity penalty: soft tiebreaker for competing matches (capped at 0.15)
            # Won't disqualify genuine acoustic matches when Gemini's estimate is coarse
            cand_st = whisper_words[s_i]["start"]
            time_diff = abs(cand_st - orig_st)
            proximity_penalty = min(0.15, time_diff * 0.015) if orig_st > 0 else 0.0
            score = total_sim - proximity_penalty
            candidates.append((score, s_i, e_i, cand_st, time_diff, total_sim))

    if not candidates:
        return None, None, 0.0, 0.0, False

    # Sort descending by score
    candidates.sort(key=lambda c: c[0], reverse=True)
    best_cand = candidates[0]
    best_score = best_cand[0]
    best_s_idx = best_cand[1]
    best_e_idx = best_cand[2]
    best_st = best_cand[3]
    best_time_diff = best_cand[4]
    best_total_sim = best_cand[5]

    # Find highest-scoring candidate representing a distinct occurrence (Fix 2)
    for c in candidates[1:]:
        cand_st = c[3]
        if abs(cand_st - best_st) > DISTINCT_OCCURRENCE_GAP_SEC:
            second_best_score = c[0]
            break

    # Dynamic margin:
    # If Gemini's timestamp and Whisper's match are within 600ms and similarity is high (>=0.88),
    # both models independently agree on this exact spot. We only need a 0.02 margin to confirm.
    # Otherwise, competing disjoint occurrences require a decisive 0.08 margin.
    margin = best_score - second_best_score if second_best_score > 0.0 else 1.0
    req_margin = 0.02 if (best_time_diff <= 0.6 and best_score >= 0.88) else 0.08
    has_clear_margin = margin >= req_margin

    # Confident match evaluation:
    # If this is an unambiguous unique occurrence (no competing duplicate phrase),
    # trust the acoustic match if text similarity is healthy (>= 0.60).
    if second_best_score == 0.0:
        # Lowered threshold from 0.45/0.60 → 0.38/0.52:
        # The original values caused batch-skipping on short Indic words
        # and single-syllable dialogue where similarity scores are inherently lower.
        is_confident = (best_score >= 0.38) or (best_total_sim >= 0.52)
    else:
        is_confident = (best_score >= 0.45) and has_clear_margin

    return best_s_idx, best_e_idx, best_score, second_best_score, is_confident


def align_subtitle_timestamps(
    gemini_events: List[Dict[str, Any]],
    whisper_words: List[Dict[str, Any]],
    search_radius: float = 8.0,
    prev_batch_end: float = 0.0,
    audio_path: Optional[str] = None,
    frame_rate: float = 24.0,
    min_duration: float = 0.833,
    max_duration: float = 7.0
) -> List[Dict[str, Any]]:
    """
    Closed-loop sequential acoustic alignment:
    Anchors each subtitle sequentially to genuine spoken words and acoustic VAD boundaries.
    Maintains a strictly monotonic audio cursor so that each subtitle starts and ends
    exactly when speech occurs, eliminating cumulative drift and artificial forward shift.
    """
    if not gemini_events or not whisper_words:
        return gemini_events

    from app.audio_processor import parse_timestamp, snap_to_acoustic_boundaries
    from app.netflix_models import format_timestamp as fmt_ts, calculate_cps
    from app.dtw_aligner import align_events_dtw

    total_events = len(gemini_events)
    total_w = len(whisper_words)
    if not gemini_events or total_w == 0:
        return gemini_events

    w_cursor = 0
    audio_cursor = prev_batch_end
    aligned_count = 0
    fallback_low_conf = 0
    fallback_ambiguous = 0
    min_gap = round(2.0 / frame_rate, 3)

    # Phase 2 Circuit Breaker: Compare Gemini word count with Whisper word count.
    # When speech is rapid or slurred on CPU, Whisper base/tiny often drops words (>50% mismatch)
    # or falls into greedy repetition loops (>300% inflation).
    # If Whisper exhibits severe discrepancy, attempting DTW forces Gemini's text
    # into distorted/hallucinated timestamps. In that case, preserve Gemini's direct audio timestamps cleanly!
    gemini_word_count = sum(len(e.get("text", "").split()) for e in gemini_events)
    if gemini_word_count > 10 and (total_w < gemini_word_count * 0.50 or total_w > gemini_word_count * 3.0):
        log_terminal(
            f"Acoustic Alignment Circuit Breaker: Whisper detected {total_w} words vs {gemini_word_count} in Gemini. "
            f"Bypassing DTW alignment to preserve Gemini's native acoustic timestamps."
        )
        return gemini_events

    # Phase 3 Fix 5: Optionally pre-filter Whisper words to speech-only regions.
    # Controlled by ACOUSTIC_DTW_PREFILTER env flag (default: false).
    # When enabled, builds acoustic anchors from the word list and removes words
    # that fall in silence gaps — preventing false DTW matches in quiet sections.
    dtw_words = whisper_words
    if ACOUSTIC_DTW_PREFILTER:
        try:
            speech_anchors = extract_acoustic_timeline_anchors(whisper_words)
            dtw_words = _prefilter_words_to_speech_regions(whisper_words, speech_anchors)
            log_terminal(f"Acoustic DTW pre-filter active: {len(dtw_words)}/{len(whisper_words)} words used for alignment.")
        except Exception as prefilter_err:
            log_terminal(f"Acoustic pre-filter warning (using full word list): {prefilter_err}")
            dtw_words = whisper_words

    # Pre-compute Global Monotonic DTW Alignment
    try:
        dtw_results = align_events_dtw(gemini_events, dtw_words)
    except Exception as dtw_err:
        log_terminal(f"DTW alignment error, using fallback matcher: {dtw_err}")
        dtw_results = []

    for ev_idx, event in enumerate(gemini_events):
        text = event.get("text", "")
        clean_words = [_normalize_text(w) for w in text.replace('\n', ' ').split() if _normalize_text(w)]
        
        orig_st = parse_timestamp(event.get("start_time", 0.0))
        orig_et = parse_timestamp(event.get("end_time", orig_st + 2.0))
        orig_dur = max(min_duration, round(orig_et - orig_st, 3))

        if not clean_words:
            st = orig_st
            if ev_idx > 0 and st < audio_cursor + min_gap:
                st = round(audio_cursor + min_gap, 3)
            et = round(st + orig_dur, 3)
            event["start_time"] = st
            event["end_time"] = et
            event["start"] = st
            event["end"] = et
            event["start_time_str"] = fmt_ts(st)
            event["end_time_str"] = fmt_ts(et)
            event["duration"] = orig_dur
            event["_aligned_confident"] = False
            audio_cursor = et
            continue

        target_norm = " ".join(clean_words)
        target_len = len(clean_words)

        # Primary Alignment: Global Monotonic DTW with audio proximity verification
        dtw_res = dtw_results[ev_idx] if dtw_results and ev_idx < len(dtw_results) else None
        dtw_accepted = False
        if dtw_res and dtw_res.get("is_confident") and dtw_res.get("matched_start") is not None:
            cand_st = float(dtw_res["matched_start"])
            cand_et = float(dtw_res["matched_end"])
            # Acoustic sanity check: DTW timestamp must not drift > 2.0s away from Gemini's audio ear
            if abs(cand_st - orig_st) <= 2.0 and cand_st >= audio_cursor - 0.5 and cand_et > cand_st:
                matched_start = cand_st
                matched_end = cand_et
                is_confident = True
                aligned_count += 1
                best_score = float(dtw_res.get("confidence", 1.0))
                second_best_score = 0.0
                dtw_accepted = True
                while w_cursor < total_w and whisper_words[w_cursor]["end"] <= matched_end:
                    w_cursor += 1

        if not dtw_accepted:
            # Secondary Alignment Fallback: Local Window Span Matcher (_find_best_span)
            search_start = max(0, w_cursor - 2)
            while search_start < total_w - 1 and whisper_words[search_start]["end"] < audio_cursor - 0.6:
                search_start += 1

            best_s_idx, best_e_idx, best_score, second_best_score, is_confident = _find_best_span(
                clean_words=clean_words,
                target_norm=target_norm,
                target_len=target_len,
                orig_st=orig_st,
                audio_cursor=audio_cursor,
                whisper_words=whisper_words,
                search_start=search_start,
                total_w=total_w
            )

            if is_confident and best_s_idx is not None and abs(whisper_words[best_s_idx]["start"] - orig_st) <= 2.5:
                matched_start = whisper_words[best_s_idx]["start"]
                matched_end = whisper_words[best_e_idx]["end"]
                w_cursor = best_e_idx + 1
                aligned_count += 1
            else:
                if best_s_idx is None or best_score < 0.50:
                    fallback_low_conf += 1
                else:
                    fallback_ambiguous += 1
                # Ambiguous repetition or weak match: fall back cleanly to Gemini's timestamp guess
                matched_start = orig_st
                matched_end = max(matched_start + min_duration, orig_et)
                # Advance w_cursor to the first word near matched_start to keep cursor progressing
                while w_cursor < total_w and whisper_words[w_cursor]["start"] < matched_start - 0.2:
                    w_cursor += 1

        orig_matched_st = matched_start
        snap_ran = False
        snap_delta = 0.0

        # Micro acoustic vocal cord snapping (Silero VAD)
        if audio_path and os.path.exists(audio_path):
            try:
                # If confident, tight collar (0.08s) eliminates residual word-boundary jitter
                # If not confident, wider collar (0.80s) enables VAD to bridge Gemini's coarse guess to true vocal energy
                collar = 0.08 if is_confident else 0.80
                snapped_st, snapped_et = snap_to_acoustic_boundaries(
                    audio_path, matched_start, matched_end, collar_sec=collar
                )
                snap_ran = True
                snap_delta = snapped_st - orig_matched_st
                matched_start = snapped_st
                matched_end = snapped_et
            except Exception:
                pass

        st = round(matched_start, 3)
        raw_dur = max(0.1, round(matched_end - matched_start, 3))
        et = round(min(st + max_duration, st + raw_dur), 3)

        trimmed_prev = False
        # Acoustic anchor principle: current speech onset (st) is locked to acoustic voice onset
        # Trim preceding event's end_time unless prev was confident and current is an unconfident fallback
        if st < audio_cursor + min_gap:
            if ev_idx > 0:
                prev_ev = gemini_events[ev_idx - 1]
                prev_st = float(prev_ev.get("start_time", 0.0))
                prev_was_confident = prev_ev.get("_aligned_confident", False)
                target_prev_end = round(st - min_gap, 3)

                if prev_was_confident and not is_confident:
                    # Protect confident acoustic line: don't let an unconfident fallback guess truncate it!
                    st = round(audio_cursor + min_gap, 3)
                    et = round(st + raw_dur, 3)
                elif target_prev_end > prev_st + 0.20:
                    prev_ev["end_time"] = target_prev_end
                    prev_ev["end"] = target_prev_end
                    prev_ev["duration"] = round(target_prev_end - prev_st, 3)
                    prev_ev["end_time_str"] = fmt_ts(target_prev_end)
                    audio_cursor = target_prev_end
                    trimmed_prev = True
                else:
                    # Only in true degenerate cases where speech completely collided, sequence safely
                    st = round(audio_cursor + min_gap, 3)
                    et = round(st + raw_dur, 3)
            else:
                # Event 0: only sequence if within collar collision distance of prev_batch_end
                if audio_cursor > 0 and (audio_cursor - 1.0 <= st <= audio_cursor + min_gap):
                    st = round(audio_cursor + min_gap, 3)
                    et = round(st + raw_dur, 3)

        dur = max(0.01, round(et - st, 3))

        event["start_time"] = st
        event["end_time"] = et
        event["start"] = st
        event["end"] = et
        event["start_time_str"] = fmt_ts(st)
        event["end_time_str"] = fmt_ts(et)
        event["duration"] = dur
        event["cps"] = calculate_cps(text, dur)
        event["_aligned_confident"] = is_confident  # Fix 1: Tag confidence

        if DEBUG_ALIGNER:
            log_terminal(
                f"[Align ev {ev_idx}] '{text[:30]}' | "
                f"score={best_score:.3f}, 2nd={second_best_score:.3f}, conf={is_confident} | "
                f"matched_st={matched_start:.3f} | snap_ran={snap_ran} (delta={snap_delta:+.3f}) | "
                f"trimmed_prev={trimmed_prev}"
            )

        audio_cursor = et

    # Fix 1: Strip internal confidence tag before returning events to frontend/caller
    for ev in gemini_events:
        ev.pop("_aligned_confident", None)

    # Phase 1: Zero-Overlap Invariant Guarantee
    from app.netflix_linter import auto_chain_gaps
    gemini_events = auto_chain_gaps(gemini_events, frame_rate=frame_rate, min_duration=min_duration, max_cps=20.0)

    log_terminal(
        f"Acoustic alignment complete: {aligned_count}/{total_events} events aligned. "
        f"Fallbacks: {fallback_low_conf} low confidence (< 0.50), {fallback_ambiguous} ambiguous margin."
    )
    return gemini_events
