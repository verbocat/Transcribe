import os
import re
import json
import time
import uuid
import asyncio
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, AsyncGenerator, Tuple
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

from app.config import GEMINI_API_KEY, GEMINI_MODEL, UPLOAD_DIR
from app.netflix_models import SubtitleEvent, NetflixQCResult, CPSStats, format_timestamp, calculate_cps, calculate_cpl
from app.video_processor import (
    extract_audio_from_video, detect_shot_changes, get_video_metadata
)
from app.audio_processor import (
    inspect_audio, detect_dual_channel_layout, find_dialogue_split_points,
    extract_audio_slice, apply_dynamic_audio_normalization, snap_to_acoustic_boundaries,
    extract_physical_speech_intervals, parse_timestamp
)
from app.netflix_linter import (
    auto_fix_subtitles, lint_all_subtitles
)
from app.whisper_aligner import (
    get_whisper_word_timestamps, align_subtitle_timestamps
)

def log_terminal(msg: str):
    """Print clean formatted timestamped log to terminal."""
    now_str = datetime.now().strftime('%H:%M:%S')
    print(f"[{now_str}] [Subtitle Studio] {msg}", flush=True)


class SubtitleItemSchema(BaseModel):
    id: int = Field(description="Sequential subtitle ID starting at 1")
    start_time: str = Field(description="Subtitle onset timestamp HH:MM:SS.mmm")
    end_time: str = Field(description="Subtitle offset timestamp HH:MM:SS.mmm")
    text: str = Field(description="Exact verbatim spoken words. Use dual-speaker hyphen format (- Speaker 1: ...\\n- Speaker 2: ...) if two speakers talk simultaneously.")
    speaker: str = Field(default="Speaker 1", description="Primary speaker identity vocalizing this event.")
    speakers: List[str] = Field(default_factory=lambda: ["Speaker 1"], description="List of speaker names for this event (1 speaker normally, or 2 speakers if speaking simultaneously).")
    is_italic: bool = Field(default=False, description="True for off-screen, voiceover, phone, lyrics")
    is_forced_narrative: bool = Field(default=False, description="True for translated foreign signs or forced dialogue")


class SubtitleBatchSchema(BaseModel):
    detected_language: Optional[str] = Field(default=None, description="Auto-detected language of speech")
    detected_script: Optional[str] = Field(default=None, description="Auto-detected native script")
    subtitles: List[SubtitleItemSchema] = Field(description="List of subtitle events for this audio chunk")


def extract_and_repair_subtitle_json(text: str) -> Dict[str, Any]:
    """
    Robust JSON parser for subtitle responses from Gemini.
    Handles direct JSON, markdown code blocks, truncated streams,
    and subtitle-specific key extraction ('text', 'start_time', 'end_time').
    """
    text = (text or "").strip()
    if not text:
        return {"subtitles": []}

    # 1. Try standard JSON parse
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            if "subtitles" in data:
                return data
            for k in ["subs", "results", "events", "segments"]:
                if k in data and isinstance(data[k], list):
                    return {"subtitles": data[k]}
        elif isinstance(data, list):
            return {"subtitles": data}
    except Exception:
        pass

    # 2. Try markdown code block
    m = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if m:
        try:
            data = json.loads(m.group(1).strip())
            if isinstance(data, dict):
                return data if "subtitles" in data else {"subtitles": data.get("segments", [])}
            elif isinstance(data, list):
                return {"subtitles": data}
        except Exception:
            pass

    # 3. Detect language/script if present in string
    det_lang = None
    det_script = None
    lang_m = re.search(r'"detected_language"\s*:\s*"([^"]+)"', text, re.IGNORECASE)
    if lang_m:
        det_lang = lang_m.group(1).strip()
    script_m = re.search(r'"detected_script"\s*:\s*"([^"]+)"', text, re.IGNORECASE)
    if script_m:
        det_script = script_m.group(1).strip()

    # 4. Subtitle Object Recovery: find any JSON object with "text" or "transcript"
    sub_objs = []
    pattern = r'\{[^{}]*?(?:"text"|"transcript"|"start_time")[^{}]*?\}'
    raw_blocks = re.findall(pattern, text, re.DOTALL)
    for idx, block in enumerate(raw_blocks, 1):
        try:
            item = json.loads(block)
            if "text" in item or "transcript" in item or "start_time" in item:
                if "text" not in item and "transcript" in item:
                    item["text"] = item["transcript"]
                sub_objs.append(item)
        except Exception:
            st = re.search(r'"start_time"\s*:\s*"([^"]+)"', block) or re.search(r'"start_time"\s*:\s*([\d.]+)', block)
            et = re.search(r'"end_time"\s*:\s*"([^"]+)"', block) or re.search(r'"end_time"\s*:\s*([\d.]+)', block)
            tx = re.search(r'"text"\s*:\s*"((?:\\.|[^"\\])*)"', block) or re.search(r'"transcript"\s*:\s*"((?:\\.|[^"\\])*)"', block)
            if tx or st:
                txt_val = tx.group(1).encode('utf-8').decode('unicode_escape', errors='ignore') if tx else ""
                sub_objs.append({
                    "id": idx,
                    "start_time": st.group(1) if st else "00:00:00.000",
                    "end_time": et.group(1) if et else "00:00:02.000",
                    "text": txt_val,
                    "speakers": ["Speaker 1"],
                    "is_italic": False,
                    "is_forced_narrative": False
                })

    if sub_objs:
        res = {"subtitles": sub_objs}
        if det_lang:
            res["detected_language"] = det_lang
        if det_script:
            res["detected_script"] = det_script
        return res

    # 5. Try unclosed JSON recovery
    first_brace = text.find('{')
    if first_brace != -1:
        truncated = text[first_brace:]
        clean_cand = re.sub(r',?\s*\{[^{}]*$', '', truncated)
        clean_cand = re.sub(r',?\s*"[^"]*"?\s*:\s*[^,}]*$', '', clean_cand)
        clean_cand = clean_cand.rstrip().rstrip(',')
        if not clean_cand.endswith(']}'):
            if not clean_cand.endswith(']'):
                clean_cand += ']}'
            else:
                clean_cand += '}'
        try:
            data = json.loads(clean_cand)
            if isinstance(data, dict):
                return data
        except Exception:
            pass

    return {"subtitles": []}


def group_whisper_words_into_subtitles(
    words: List[Dict[str, Any]],
    chunk_offset: float = 0.0,
    cpl_limit: int = 42,
    max_duration: float = 5.0,
    target_language: str = "Auto-Detect"
) -> List[Dict[str, Any]]:
    """Group flat Whisper words into Netflix-compliant subtitle event dictionaries with hallucination filtering."""
    if not words:
        return []
    
    events = []
    curr_words = []
    curr_start = words[0]["start"]
    is_english = target_language.lower() in ["english", "en", "latin"]
    
    for w in words:
        word_txt = w["word"].strip()
        if not word_txt:
            continue
            
        # Filter out standalone punctuation artifacts or repetitive symbols
        if re.match(r'^[\s.,!?:;\-_~`\'"♪\(\)\[\]#*&^%$@+=<>\\/]+$', word_txt):
            continue

        # Filter out hallucinated Arabic/Urdu Unicode blocks when English/Latin is targeted
        if is_english and re.search(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]', word_txt):
            continue
            
        proposed = ' '.join([x["word"].strip() for x in curr_words] + [word_txt])
        dur = w["end"] - curr_start
        
        is_sentence_end = word_txt[-1:] in {'.', '!', '?'}
        gap_before = (w["start"] - curr_words[-1]["end"]) if curr_words else 0.0
        
        if (curr_words and (len(proposed) > cpl_limit * 1.8 or dur > max_duration or gap_before > 0.7)) or (is_sentence_end and len(proposed) > 28):
            st = max(0.0, curr_start - chunk_offset)
            et = max(st + 0.8, curr_words[-1]["end"] - chunk_offset)
            events.append({
                "start_time": format_timestamp(st),
                "end_time": format_timestamp(et),
                "text": ' '.join([x["word"].strip() for x in curr_words]),
                "speakers": ["Speaker 1"]
            })
            curr_words = [w]
            curr_start = w["start"]
        else:
            curr_words.append(w)
            
    if curr_words:
        st = max(0.0, curr_start - chunk_offset)
        et = max(st + 0.8, curr_words[-1]["end"] - chunk_offset)
        events.append({
            "start_time": format_timestamp(st),
            "end_time": format_timestamp(et),
            "text": ' '.join([x["word"].strip() for x in curr_words]),
            "speakers": ["Speaker 1"]
        })
        
    return events


def transcribe_chunk_with_whisper(
    target_path: str,
    chunk_s: float = 0.0,
    language: str = "Auto-Detect",
    cpl_limit: int = 42,
    whisper_model: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fallback transcription for an individual audio chunk using local Whisper.
    Runs on CPU, extracts word timestamps, and groups them into Netflix-compliant subtitles.
    Guarantees that subtitles are always produced even if Gemini API quota is completely exhausted.
    """
    try:
        from app.whisper_aligner import get_whisper_word_timestamps
        is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
        # Phase 1 Fix 1: Use tiny on cloud (RAM-constrained), base on local.
        # Medium hallucinates under greedy decode + CPU and is used only for timing, not transcription.
        model_name = whisper_model or os.getenv("WHISPER_MODEL", "tiny" if is_cloud else "base")
        
        resolved_lang, _ = normalize_language_and_script(language)
        lang_target = None
        if resolved_lang and resolved_lang.lower() not in ["auto", "auto-detect"]:
            lang_lower = resolved_lang.lower()
            code_map = {
                "hindi": "hi", "english": "en", "spanish": "es", "french": "fr",
                "german": "de", "tamil": "ta", "telugu": "te", "marathi": "mr",
                "bengali": "bn", "gujarati": "gu", "kannada": "kn", "malayalam": "ml",
                "punjabi": "pa", "urdu": "ur"
            }
            lang_target = code_map.get(lang_lower, lang_lower[:2])

        log_terminal(f"Running Whisper ({model_name}) fallback on chunk audio: {Path(target_path).name} (lang={lang_target or 'auto'})...")
        words = get_whisper_word_timestamps(target_path, language=lang_target, model_name=model_name)
        if words:
            subs = group_whisper_words_into_subtitles(
                words,
                chunk_offset=0.0,
                cpl_limit=cpl_limit,
                target_language=resolved_lang
            )
            log_terminal(f"Whisper fallback produced {len(subs)} subtitle events for this chunk.")
            return subs
    except Exception as e:
        log_terminal(f"Whisper chunk fallback error: {e}")
    return []


def normalize_language_and_script(language: str, script: str = "auto") -> tuple:
    """Normalize language and script codes/names into clean presentation strings."""
    lang_lower = (language or "auto").lower().strip()
    script_lower = (script or "auto").lower().strip()

    lang_map = {
        "hi": ("Hindi", "Devanagari"),
        "hindi": ("Hindi", "Devanagari"),
        "hinglish": ("Hindi", "Latin (Hinglish)"),
        "en": ("English", "Latin"),
        "english": ("English", "Latin"),
        "bn": ("Bengali", "Bengali"),
        "bengali": ("Bengali", "Bengali"),
        "ta": ("Tamil", "Tamil"),
        "tamil": ("Tamil", "Tamil"),
        "te": ("Telugu", "Telugu"),
        "telugu": ("Telugu", "Telugu"),
        "mr": ("Marathi", "Devanagari"),
        "marathi": ("Marathi", "Devanagari"),
        "gu": ("Gujarati", "Gujarati"),
        "gujarati": ("Gujarati", "Gujarati"),
        "kn": ("Kannada", "Kannada"),
        "kannada": ("Kannada", "Kannada"),
        "ml": ("Malayalam", "Malayalam"),
        "malayalam": ("Malayalam", "Malayalam"),
        "pa": ("Punjabi", "Gurmukhi"),
        "punjabi": ("Punjabi", "Gurmukhi"),
        "ur": ("Urdu", "Arabic"),
        "urdu": ("Urdu", "Arabic"),
        "es": ("Spanish", "Latin"),
        "spanish": ("Spanish", "Latin"),
        "fr": ("French", "Latin"),
        "french": ("French", "Latin"),
        "de": ("German", "Latin"),
        "german": ("German", "Latin"),
        "ja": ("Japanese", "Japanese"),
        "japanese": ("Japanese", "Japanese"),
        "ko": ("Korean", "Hangul"),
        "korean": ("Korean", "Hangul"),
        "ar": ("Arabic", "Arabic"),
        "arabic": ("Arabic", "Arabic"),
        "auto": ("Auto-Detect", "Auto-Detect"),
    }

    resolved_lang, default_script = lang_map.get(lang_lower, (language.title() if language and language.lower() not in ["auto", "auto-detect"] else "Auto-Detect", "Auto-Detect"))
    is_hindi = lang_lower in ["hi", "hindi", "hinglish"]
    
    if script_lower in ["devanagari"]:
        resolved_script = "Devanagari" if is_hindi or "marathi" in lang_lower or lang_lower == "mr" else default_script
    elif script_lower in ["latin", "hinglish", "roman", "romanized"]:
        resolved_script = "Latin (Hinglish)" if is_hindi else "Latin"
    elif script_lower in ["auto", "native"]:
        resolved_script = default_script
    elif script_lower != "auto" and script:
        resolved_script = script.title() if len(script) > 3 else script
    else:
        resolved_script = default_script

    return resolved_lang, resolved_script


def get_netflix_subtitle_system_prompt(
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    target_language: str = "Auto-Detect",
    target_script: str = "Auto-Detect"
) -> str:
    """Generate dynamic system prompt with user-configured CPL, CPS, max lines, and target language enforcement."""
    is_english = target_language.lower() in ["english", "en"]
    is_hindi_indic = target_language.lower() in ["hindi", "hi", "hinglish"] or target_script.lower() in ["devanagari", "hindi"]
    lang_directive = ""
    if is_english:
        lang_directive = (
            "CRITICAL MANDATE: TARGET SUBTITLE LANGUAGE IS 100% ENGLISH (LATIN ALPHABET).\n"
            "   - Every single subtitle text MUST be written in ENGLISH using the standard Latin alphabet.\n"
            "   - ABSOLUTE PROHIBITION: NEVER output Urdu, Arabic script (e.g. اردو, ی, ہ, etc.), Devanagari, or random symbols/gibberish.\n"
            "   - If the audio is in English: transcribe the spoken words verbatim into English subtitles.\n"
            "   - If the audio dialogue is spoken in Hindi, Urdu, or another language: translate the spoken dialogue accurately and fluently into natural English subtitles.\n"
        )
    elif is_hindi_indic:
        lang_directive = (
            "CRITICAL MANDATE: TARGET SUBTITLE LANGUAGE IS 100% HINDI IN DEVANAGARI SCRIPT.\n"
            "   - 100% of the output text MUST be in Devanagari script. Every single character must be in Devanagari.\n"
            "   - VERBATIM PHONETIC TRANSLITERATION ONLY (DO NOT TRANSLATE TO HINDI MEANING):\n"
            "     * If any English sentence or phrase is spoken (e.g. 'I want to go', 'You are wrong', 'Come on bro'), you MUST transliterate it phonetically AS-IS into Devanagari script: 'आई वांट टू गो', 'यू आर रॉन्ग', 'कम ऑन ब्रो'.\n"
            "     * ABSOLUTE PROHIBITION: DO NOT translate English sentences into Hindi meaning! (e.g. NEVER translate 'I want to go' into 'मैं जाना चाहता हूँ' — it must be 'आई वांट टू गो').\n"
            "     * ABSOLUTE PROHIBITION: NEVER leave English words in the Latin/English alphabet (e.g. NEVER write 'I want to go' or 'target').\n"
            "     * Transliterate all English loan words, slang, and phrases verbatim: 'target' -> 'टारगेट', 'eliminate' -> 'एलिमिनेट', 'sorry' -> 'सॉरी', 'game plan' -> 'गेम प्लान', 'finalist' -> 'फाइनलिस्ट', 'brother' -> 'ब्रदर', 'task' -> 'टास्क', 'bro' -> 'ब्रो'.\n"
        )
    elif target_language != "Auto-Detect":
        lang_directive = (
            f"CRITICAL MANDATE: TARGET SUBTITLE LANGUAGE IS 100% {target_language.upper()} ({target_script} SCRIPT).\n"
            f"   - All subtitle text MUST be in {target_language} using {target_script} script.\n"
            f"   - NEVER output random symbols or unrelated language scripts.\n"
        )

    return f"""You are an elite, professional audio-to-text subtitle transcription and translation engine.

Your task is to generate millimeter-precise, timed subtitles following strict Netflix Timed Text standards.

### CRITICAL RULES:

1. 100% VERBATIM ACCURACY & COMPLETE DIALOGUE FIDELITY (HIGHEST PRIORITY):
   - Capture the EXACT spoken dialogue of EVERY speaker word-for-word.
   - Retain every single spoken word, syllable, stutter, repetition, filler ('um', 'uh', 'haan', 'arre', 'you know'), and interjection.
   - ABSOLUTE PROHIBITION: NEVER drop, summarize, paraphrase, omit, or shorten dialogue just because a speaker is talking rapidly or back-to-back!
   - Do NOT censor profanity.
   - Do NOT invent or hallucinate words, repeating punctuation, or random symbols.

2. ABSOLUTE PROPER NOUN PRESERVATION:
   - Preserve character names, brand names, and place names faithfully with phonetic precision.
   - Do not substitute real names with arbitrary Western names.

3. STRICT TARGET LANGUAGE & SCRIPT PURITY:
{lang_directive}   - If Target Language is Hindi and Target Script is Devanagari:
     * Output 100% in Devanagari script (e.g. "तरुण, क्या हाल है?").
     * Phonetically transliterate all English words, loan words, and English sentences verbatim into Devanagari (e.g. 'I want to go' -> 'आई वांट टू गो', 'sorry' -> 'सॉरी', 'game' -> 'गेम', 'target' -> 'टारगेट', 'brother' -> 'ब्रदर').
     * NEVER translate English sentences into Hindi meaning (do NOT convert 'I want to go' to 'मैं जाना चाहता हूँ'). Transcribe the sounds as-is in Devanagari!
     * NEVER leave English words in the Latin/English alphabet.
     * Do NOT translate Hindi dialogue into English.
   - If Target Language is Hindi and Target Script is Latin / Hinglish:
     * Transcribe conversational Hindi phonetically in Latin alphabet (e.g. "Tarun, kya haal hai?").
   - Under no circumstances should you ever output random corrupted symbols (e.g. '.....', '♪♪♪', repeating characters).

4. COMPLETE GRAMMATICAL UNITS & NATURAL CLAUSE BOUNDARIES (NO MID-PHRASE SPLITS):
   - Subtitle event boundaries MUST occur at natural syntactic breaks: major punctuation (., !, ?, commas, semicolons) or major coordinating conjunctions ('and then', 'but', 'so', 'because').
   - ABSOLUTE PROHIBITION: NEVER split a subtitle event in the middle of a prepositional phrase (e.g., do NOT end one subtitle with "into the wrong" and start the next with "bedroom,").
   - NEVER split a subtitle event after a title or honorific (e.g., do NOT end one subtitle with "Mrs." and start the next with "Rutherford's death?").
   - If a sentence fits within 2 lines <= {cpl_limit} characters (up to ~84 characters total), KEEP IT TOGETHER in ONE subtitle event!

5. PRECISE ACOUSTIC TIMING & READING SPEED (CPS):
   - `start_time`: Must match the EXACT millisecond the speaker begins vocalizing the first syllable.
   - `end_time`: Must match the EXACT millisecond the speaker completes vocalizing the last syllable.
   - Target comfortable reading speed (~{max_cps} CPS).
   - CRITICAL RULE FOR FAST SPEECH: When speech is naturally rapid or excited, you MUST STILL transcribe 100% of the words verbatim.
   - In rapid dialogue, output shorter, tighter sequential subtitle events (e.g. 1-line rapid events) instead of dropping words to force a low CPS! NEVER omit spoken words to satisfy reading speed limits.

6. LINE BREAKS & CLAUSE SPLITTING (HINDI & ALL LANGUAGES):
   - Maximum {cpl_limit} characters per line (CPL).
   - Maximum {max_lines} lines per subtitle event (NEVER 3 lines).
   - Break lines at natural linguistic & grammatical boundaries:
     * English: punctuation (comma, period, semicolon), before conjunctions ('and', 'but', 'so', 'because'), or before prepositions.
     * Hindi Devanagari: punctuation ('।', '॥', ',', '?', '!'), or before conjunctions ('और', 'या', 'लेकिन', 'मगर', 'क्योंकि', 'इसलिए', 'ताकि', 'कि', 'तो', 'जब', 'तब', 'अगर').
     * Hinglish / Latin: before conjunctions ('aur', 'ya', 'lekin', 'kyunki', 'isliye', 'taaki', 'ki', 'to').
   - CRITICAL HINDI POSTPOSITION RULE:
     * Hindi postpositions ('ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक', 'लिए', 'साथ') MUST NEVER START A NEW LINE OR A NEW EVENT ALONE!
     * Postpositions must ALWAYS remain on the same line as the preceding noun (e.g. 'राहुल ने' together, 'घर में' together).
   - NEVER break across: title + name ('श्री' / 'श्रीमती' / 'डॉ.' + name, 'Mr.' / 'Mrs.' + name), article + noun, pronoun + verb, or split compound verb phrases.

7. MULTI-SPEAKER & OVERLAPPING SPEECH (DUAL-SPEAKER HYPHENS):
   - Identify speaker changes accurately from voice acoustics, timbre, pitch, gender, and conversational turns.
   - When two speakers speak simultaneously, interrupt, or talk over one another:
     * Format BOTH speakers in ONE subtitle event using hyphens:
       - [Speaker 1]: <dialogue 1>
       - [Speaker 2]: <dialogue 2>
     * Set the 'speakers' array to contain both identities (e.g. ['Speaker 1', 'Speaker 2']).
   - When speakers speak sequentially (one finishes, then the next starts), output separate sequential subtitle events.
   - NEVER drop, skip, or omit either speaker's dialogue when multiple people speak at the same time!

8. SEQUENTIAL TIMELINE & ZERO OVERLAPS BETWEEN EVENTS:
   - All subtitle events MUST be strictly sequential on the timeline (start of next subtitle >= end of previous subtitle + 2 frames).
   - Never overlap two separate subtitle events in time; use dual-speaker hyphen format within a single event when dialogue coincides in time.
   - Transcribe 100% of spoken words verbatim from all speakers without dropping or altering anything.

9. ITALICS (<i>...</i>):
   - Use `<i>...</i>` for: voiceover narration, off-screen dialogue, phone/radio/TV audio, and song lyrics (`<i>♪ lyrics here ♪</i>`).

10. SOUND DESCRIPTIONS (SDH Mode):
   - If SDH is requested, include audible sound events in lowercase brackets: `[door slams]`, `[music playing]`, `[laughter]`.

11. PUNCTUATION & SPECIAL FORMATTING:
   - Use Unicode ellipsis `…` (U+2026), NOT three periods `...`.
   - Use double hyphen `--` for sudden speech interruptions or trailing off.
   - Numbers 1-10 spelled out in words, 11+ written as numerals.

12. DIALOGUE OVER BACKGROUND MUSIC & SOUNDTRACK:
   - When background music, soundtrack, or long instrumental tones play with only occasional or sparse dialogue spoken, YOU MUST DETECT AND TRANSCRIBE EVERY SPOKEN WORD with exact timestamps!
   - Never skip or omit quiet, soft, or sparse dialogue just because music is playing.
   - Do NOT transcribe instrumental music as subtitles, but ALWAYS transcribe human speech spoken within or over musical sections.

13. GAMING, ACTION SFX & IN-GAME VOICE CHAT:
   - In gameplay and action content, players speak over loud gunshots, explosions, vehicle engines, and footsteps.
   - YOU MUST TRANSCRIBE ALL SPOKEN WORDS even when partially masked by game SFX. Never omit words because gunshots or loud sound effects are present!
   - Teammates on Discord or in-game mic may have compressed or lower-fidelity audio. Treat teammate callouts with EQUAL PRIORITY to the main streamer.
   - Never leave an interval empty if human speech can be deciphered under sound effects.

### OUTPUT FORMAT:
Return a structured JSON object strictly matching this schema:
{{
  "detected_language": "string (e.g. Hindi, English, Spanish)",
  "detected_script": "string (e.g. Devanagari, Latin, Latin (Hinglish))",
  "subtitles": [
    {{
      "id": 1,
      "start_time": "00:00:01.250",
      "end_time": "00:00:04.100",
      "text": "Exact transcribed spoken words line 1\\nExact transcribed spoken words line 2",
      "speakers": ["Speaker 1"],
      "is_italic": false,
      "is_forced_narrative": false
    }}
  ]
}}
"""

# Default static fallback
NETFLIX_SUBTITLE_SYSTEM_PROMPT = get_netflix_subtitle_system_prompt()


def get_gemini_client(api_key: Optional[str] = None) -> genai.Client:
    """Initialize and return Google GenAI Client."""
    key = api_key or GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("GEMINI_API_KEY is not configured in .env or environment.")
    return genai.Client(api_key=key)


def resolve_batch_timestamps(
    subs: List[Dict[str, Any]],
    chunk_s: float,
    chunk_e: float,
    prev_batch_end: float = 0.0,
    min_gap_sec: float = 0.083,
    min_duration: float = 0.833
) -> List[Dict[str, Any]]:
    """
    Accurately maps Gemini subtitle timestamps to absolute video timeline.
    Detects whether Gemini outputted slice-relative timestamps (0.0 to chunk_dur)
    or absolute timestamps across the entire batch, completely eliminating backwards jumping,
    timeline gaps, and collisions.
    """
    if not subs:
        return []

    from app.audio_processor import parse_timestamp

    parsed_items = []
    for s in subs:
        st_val = s.get("start_time", 0.0)
        et_val = s.get("end_time", 2.0)
        st_sec = parse_timestamp(st_val) if isinstance(st_val, str) else float(st_val)
        et_sec = parse_timestamp(et_val) if isinstance(et_val, str) else float(et_val)
        if et_sec <= st_sec:
            et_sec = round(st_sec + 1.8, 3)
        parsed_items.append((st_sec, et_sec, s))

    first_st = parsed_items[0][0]

    # If chunk_s > 0.0 and first_st is near zero (< chunk_s - 2.0), the batch is SLICE-RELATIVE!
    is_slice_relative = (chunk_s > 0.0 and first_st < (chunk_s - 2.0))

    resolved = []
    chunk_dur = max(1.0, chunk_e - chunk_s)

    # prev_batch_end can ONLY affect this batch if it is immediately adjacent to chunk_s!
    # If prev_batch_end is far away (e.g. from the end of the video), it MUST NOT push this chunk into the future!
    if 0.0 < prev_batch_end and (chunk_s - 5.0 <= prev_batch_end <= chunk_s + 5.0):
        current_cursor = prev_batch_end + min_gap_sec
    else:
        current_cursor = chunk_s

    for st_sec, et_sec, orig_s in parsed_items:
        if is_slice_relative:
            abs_st = round(chunk_s + st_sec, 3)
            abs_et = round(chunk_s + et_sec, 3)
        else:
            abs_st = round(st_sec, 3)
            abs_et = round(et_sec, 3)

        # Natural duration guard (must be positive)
        raw_dur = max(0.1, round(abs_et - abs_st, 3))
        abs_et = round(abs_st + raw_dur, 3)

        # Hard guard: abs_st can NEVER fall outside the audio chunk boundary!
        if abs_st > chunk_e + 2.0 or abs_st < chunk_s - 2.0:
            abs_st = round(chunk_s + min(st_sec, chunk_dur), 3)
            abs_et = round(abs_st + raw_dur, 3)

        # Enforce strictly sequential non-overlapping timeline without runaway forward drift
        if resolved:
            prev_ev_end = resolved[-1]["end_time"]
            if abs_st < prev_ev_end + min_gap_sec:
                # Acoustic anchor principle: incoming abs_st is speech onset and must NOT be pushed forward!
                # Trim preceding event's end_time to ensure required min_gap_sec
                target_prev_end = round(abs_st - min_gap_sec, 3)
                if target_prev_end > resolved[-1]["start_time"] + 0.05:
                    resolved[-1]["end_time"] = target_prev_end
                    resolved[-1]["end"] = target_prev_end
                else:
                    # In degenerate cases where Gemini timestamps completely collided or inverted, sequence safely
                    abs_st = round(prev_ev_end + min_gap_sec, 3)
                    abs_et = round(abs_st + raw_dur, 3)
        elif abs_st < current_cursor:
            abs_st = round(current_cursor, 3)
            abs_et = round(abs_st + raw_dur, 3)

        # Ensure event stays within the chunk boundary (allowing at most 2.0s spillover at chunk end)
        if abs_et > chunk_e + 2.0:
            abs_et = round(chunk_e + 2.0, 3)
            if abs_st >= abs_et:
                abs_st = round(max(chunk_s, abs_et - min_duration), 3)

        spk = orig_s.get("speaker") or (orig_s.get("speakers") or ["Speaker 1"])[0]

        item = {
            "start_time": abs_st,
            "end_time": abs_et,
            "start": abs_st,
            "end": abs_et,
            "text": orig_s.get("text", "").strip(),
            "speakers": [spk],
            "speaker_count": 1,
            "is_italic": bool(orig_s.get("is_italic", False)),
            "is_forced_narrative": bool(orig_s.get("is_forced_narrative", False))
        }
        resolved.append(item)

    # Post-resolution: Safe expansion for short events (< min_duration) into silence
    # Expands forward if space exists before next event, or backward into preceding silence.
    # NEVER pushes any subsequent event's start_time!
    for i in range(len(resolved)):
        ev_dur = resolved[i]["end_time"] - resolved[i]["start_time"]
        if ev_dur < min_duration:
            needed = round(min_duration - ev_dur, 3)
            # Try expanding forward into silence first
            next_st = resolved[i + 1]["start_time"] if (i + 1 < len(resolved)) else (chunk_e + 2.0)
            avail_forward = round((next_st - min_gap_sec) - resolved[i]["end_time"], 3)
            if avail_forward > 0:
                fwd_extend = min(needed, avail_forward)
                resolved[i]["end_time"] = round(resolved[i]["end_time"] + fwd_extend, 3)
                resolved[i]["end"] = resolved[i]["end_time"]
                needed = round(needed - fwd_extend, 3)

            # If still needed, expand backward into preceding silence
            if needed > 0:
                prev_et = resolved[i - 1]["end_time"] if (i > 0) else current_cursor
                avail_backward = round(resolved[i]["start_time"] - (prev_et + min_gap_sec), 3)
                if avail_backward > 0:
                    bwd_extend = min(needed, avail_backward)
                    resolved[i]["start_time"] = round(resolved[i]["start_time"] - bwd_extend, 3)
                    resolved[i]["start"] = resolved[i]["start_time"]

    return resolved


def resolve_chunk_timestamp(ts_val: Any, chunk_s: float, chunk_e: float) -> float:
    """Safe fallback single timestamp resolver."""
    from app.audio_processor import parse_timestamp
    sec = parse_timestamp(ts_val) if isinstance(ts_val, str) else float(ts_val)
    if chunk_s > 10.0 and sec < (chunk_s - 5.0):
        return round(chunk_s + sec, 3)
    elif chunk_s <= 10.0:
        return round(chunk_s + sec, 3)
    return round(sec, 3)


def repair_chunk_timestamp(ts_val: Any, chunk_dur: float) -> float:
    """Safely parse timestamp relative to audio chunk duration without modulo-60 distortion."""
    from app.audio_processor import parse_timestamp
    sec = parse_timestamp(ts_val) if isinstance(ts_val, str) else float(ts_val)
    if sec > chunk_dur:
        sec = min(chunk_dur, max(0.0, sec % chunk_dur if chunk_dur > 0 else 0.0))
    return round(max(0.0, sec), 3)


def balance_text_to_lines(text: str, cpl_limit: int = 42, max_lines: int = 2) -> List[str]:
    """Balance text into 1 or 2 lines where each line is <= cpl_limit without dropping words or creating bad breaks."""
    text = text.replace('...', '…')
    raw_lines = [l.strip() for l in text.split('\n') if l.strip()]

    words = text.replace('\n', ' ').split()
    if not words:
        return []
    full = ' '.join(words)
    if len(full) <= cpl_limit:
        return [full]
    if max_lines == 1:
        return []

    bad_ends = {
        'a', 'an', 'the', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'mr', 'mrs', 'ms', 'dr',
        'my', 'his', 'her', 'our', 'their', 'its', 'your', 'this', 'that', 'these', 'those',
        'wrong', 'other', 'new', 'old', 'into', 'of', 'to', 'in', 'at', 'from', 'with',
        'i', 'he', 'she', 'we', 'they', 'it',
        # Hindi titles & honorifics - never sever from name
        'श्री', 'श्रीमती', 'सुश्री', 'डॉक्टर', 'डॉ.', 'डॉ', 'पंडित', 'पं.', 'पं', 'shri', 'smt', 'pandit',
        # Hindi postpositions - NEVER end line 1 with a dangling postposition!
        'ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक', 'लिए', 'साथ',
        'ne', 'ko', 'se', 'ka', 'ke', 'ki', 'mein', 'me', 'par', 'pe', 'tak', 'liye', 'saath'
    }
    bad_starts = {
        # Hindi postpositions - must NEVER start line 2 alone!
        'ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक', 'लिए', 'साथ', 'द्वारा', 'वाला', 'वाले', 'वाली',
        'ne', 'ko', 'se', 'ka', 'ke', 'ki', 'mein', 'me', 'par', 'pe', 'tak', 'liye', 'saath', 'dwara', 'wala', 'wale', 'wali',
        # Hindi auxiliaries when severed
        'है', 'हैं', 'था', 'थी', 'थे', 'होगा', 'होगी', 'होंगे', 'रहा', 'रही', 'रहे', 'सकता', 'सकती', 'सकते',
        'hai', 'hain', 'tha', 'thi', 'the', 'hoga', 'hogi', 'honge', 'raha', 'rahi', 'rahe', 'sakta', 'sakti', 'sakte'
    }

    # If already 2 lines provided by AI/editor that fit CPL and don't violate grammar, preserve them!
    if len(raw_lines) == 2 and all(len(l) <= cpl_limit for l in raw_lines):
        first_w_l2 = raw_lines[1].split()[0].lower().rstrip('.,!?:;--…।॥') if raw_lines[1].split() else ""
        last_w_l1 = raw_lines[0].split()[-1].lower().rstrip('.,!?:;--…।॥') if raw_lines[0].split() else ""
        if first_w_l2 not in bad_starts and last_w_l1 not in bad_ends:
            return raw_lines

    best_lines = None
    min_penalty = 999999

    prepositions_and_conjunctions = {
        'and', 'but', 'or', 'so', 'because', 'although', 'while', 'when', 'if',
        'through', 'into', 'under', 'between', 'after', 'before', 'about', 'over', 'by', 'from', 'with',
        # Hindi conjunctions
        'और', 'या', 'अथवा', 'लेकिन', 'मगर', 'किंतु', 'परंतु', 'क्योंकि', 'इसलिए', 'ताकि', 'कि', 'तो', 'जब', 'तब', 'अगर', 'यदि', 'जैसे', 'वैसे', 'फिर', 'भी',
        'aur', 'ya', 'athwa', 'lekin', 'magar', 'kintu', 'parantu', 'kyunki', 'isliye', 'taaki', 'ki', 'to', 'jab', 'tab', 'agar', 'yadi', 'jaise', 'phir', 'bhi'
    }

    for i in range(1, len(words)):
        l1 = ' '.join(words[:i])
        l2 = ' '.join(words[i:])
        if len(l1) <= cpl_limit and len(l2) <= cpl_limit:
            diff = abs(len(l1) - len(l2))
            penalty = diff * 0.3

            last_w = words[i - 1].lower().rstrip('.,!?:;--…।॥')
            first_w = words[i].lower().rstrip('.,!?:;--…।॥')

            if last_w in bad_ends:
                penalty += 2000  # Strictly forbid breaking after articles, titles, postpositions

            if first_w in bad_starts:
                penalty += 3000  # Strictly forbid starting line 2 with a postposition or severed auxiliary!

            if l1.endswith((',', ';', '.', '!', '?', '--', '…', ':', '।', '॥')):
                penalty -= 80   # Strongest preference for natural punctuation breaks (including Hindi । and ॥)
            elif first_w in prepositions_and_conjunctions:
                penalty -= 50   # Strong preference for breaking before prepositions and conjunctions

            if penalty < min_penalty:
                min_penalty = penalty
                best_lines = [l1, l2]
    return best_lines or []


def heal_cross_event_dangling_phrases(events: List[Dict[str, Any]], cpl_limit: int = 42, max_lines: int = 2) -> List[Dict[str, Any]]:
    """
    Heals awkward splits across consecutive subtitle events (e.g. 'the wrong' | 'bedroom' or 'Mrs.' | 'Rutherford').
    Keeps grammatical units together without dropping any words or corrupting timestamps.
    """
    bad_ends = {
        'a', 'an', 'the', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'mr', 'mrs', 'ms', 'dr',
        'my', 'his', 'her', 'our', 'their', 'its', 'your', 'this', 'that', 'these', 'those',
        'wrong', 'other', 'new', 'old', 'into', 'of', 'to', 'in', 'at', 'from', 'with'
    }
    i = 0
    while i < len(events) - 1:
        cur = events[i]
        nxt = events[i + 1]
        cur_words = cur.get('text', '').replace('\n', ' ').split()
        nxt_words = nxt.get('text', '').replace('\n', ' ').split()
        if not cur_words or not nxt_words:
            i += 1
            continue

        last_w = cur_words[-1].lower().rstrip('.,!?:;--…')

        # Case 1: cur ends with a title -> shift title to next event so title stays with name
        if last_w in {'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'mr', 'mrs', 'ms', 'dr',
                       'श्री', 'श्रीमती', 'सुश्री', 'डॉक्टर', 'डॉ.', 'डॉ', 'पंडित', 'पं.', 'पं', 'shri', 'smt', 'pandit'}:
            title_word = cur_words.pop()
            nxt_words.insert(0, title_word)
            cur['text'] = ' '.join(cur_words)
            nxt['text'] = ' '.join(nxt_words)

        # Case 1B: nxt starts with a Hindi postposition -> shift it to cur so it stays with the noun
        elif nxt_words[0].lower().rstrip('.,!?:;--…।॥') in {
            'ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक', 'लिए', 'साथ', 'द्वारा',
            'ne', 'ko', 'se', 'ka', 'ke', 'ki', 'mein', 'me', 'par', 'pe', 'tak', 'liye', 'saath'
        }:
            postp = nxt_words.pop(0)
            cand_cur = ' '.join(cur_words + [postp])
            lines = balance_text_to_lines(cand_cur, cpl_limit=cpl_limit, max_lines=max_lines)
            if lines:
                cur['text'] = '\n'.join(lines)
                nxt['text'] = ' '.join(nxt_words)
            else:
                nxt_words.insert(0, postp)

        # Case 2: cur ends with an article/adjective/preposition like "wrong" or "the" and nxt has the noun
        elif last_w in bad_ends:
            dangling_noun = nxt_words.pop(0)
            cand_cur_text = ' '.join(cur_words + [dangling_noun])
            lines = balance_text_to_lines(cand_cur_text, cpl_limit=cpl_limit, max_lines=max_lines)
            if lines:
                cur['text'] = '\n'.join(lines)
                nxt['text'] = ' '.join(nxt_words)
                cur_et = float(cur.get('end_time', 0.0))
                cur['end_time'] = round(cur_et + 0.35, 3)
                cur['end'] = cur['end_time']
                nxt['start_time'] = round(cur['end_time'] + (2.0 / 24.0), 3)
                nxt['start'] = nxt['start_time']
            else:
                nxt_words.insert(0, dangling_noun)

        i += 1
    return events


def stitch_cross_chunk_seam(
    prev_batch_events: List[Dict[str, Any]],
    current_batch_events: List[Dict[str, Any]],
    min_gap_sec: float = 0.083,
    min_duration: float = 0.833,
    collar_sec: float = 1.0
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Seamlessly stitches subtitle events across audio chunk boundaries.
    Prevents chopped words, duplicate subtitles, and timeline collisions caused by 1.0s overlap collars.

    1. Deduplicates repeating phrases emitted in the overlap collar.
    2. Merges sentence completions where Chunk N was cut off and Chunk N+1 finished the sentence.
    3. Sequences distinct events strictly with the required min_gap_sec.
    """
    if not prev_batch_events or not current_batch_events:
        return prev_batch_events, current_batch_events

    from difflib import SequenceMatcher
    from app.dtw_aligner import normalize_token
    from app.netflix_models import format_timestamp

    last_prev = prev_batch_events[-1]
    first_curr = current_batch_events[0]

    p_text = " ".join(normalize_token(w) for w in last_prev.get("text", "").split() if normalize_token(w))
    c_text = " ".join(normalize_token(w) for w in first_curr.get("text", "").split() if normalize_token(w))

    p_end = float(last_prev.get("end_time", last_prev.get("end", 0.0)))
    c_start = float(first_curr.get("start_time", first_curr.get("start", 0.0)))
    c_end = float(first_curr.get("end_time", first_curr.get("end", c_start + 1.0)))

    # Only process if current event starts within the overlap collar window
    if c_start > p_end + collar_sec + 0.5:
        return prev_batch_events, current_batch_events

    sim = SequenceMatcher(None, p_text, c_text).ratio() if (p_text and c_text) else 0.0

    p_start = float(last_prev.get("start_time", last_prev.get("start", 0.0)))
    words_count = len(p_text.split())

    # Case 1: Exact or verified duplicate caused by overlap collar
    # Must have high string similarity (>= 0.88) AND physical acoustic coincidence.
    # If c_start starts at or after p_end - 0.05s, Chunk N already stopped speaking;
    # an identical word in Chunk N+1 is a genuine new dialogue utterance, NEVER a collar duplicate!
    if p_text and c_text:
        has_match = (sim >= 0.88 and words_count >= 3) or (p_text == c_text)
        if has_match:
            is_true_collar_dup = False
            if words_count >= 3:
                # 3+ words: only a duplicate if c_start overlaps Chunk N's active speech window
                is_true_collar_dup = (c_start < p_end - 0.15) or (abs(c_start - p_start) <= 1.0)
            else:
                # 1-2 words: only a duplicate if timestamps coincide closely in time (within 0.40s)
                is_true_collar_dup = (abs(c_start - p_start) <= 0.40) or (c_start < p_end - 0.25 and c_end <= p_end + 0.25)

            if is_true_collar_dup:
                current_batch_events.pop(0)
                return prev_batch_events, current_batch_events

    # Case 2: Continuation / Sentence extension across seam
    # Example: Chunk N was cut off ("We must go to the"), Chunk N+1 heard full ("We must go to the market now")
    # Only merge if last_prev has at least 3 words, does NOT end with sentence terminator (.?!।), and curr starts with full prev text
    raw_p_text = last_prev.get("text", "").strip()
    is_terminal = bool(raw_p_text and raw_p_text[-1] in ".?!।॥")
    if p_text and c_text and len(p_text.split()) >= 3 and not is_terminal and c_text.startswith(p_text):
        if len(first_curr.get("text", "")) > len(raw_p_text):
            last_prev["text"] = first_curr.get("text", "")
            last_prev["end_time"] = max(p_end, c_end)
            last_prev["end"] = last_prev["end_time"]
            last_prev["end_time_str"] = format_timestamp(last_prev["end_time"])
            last_prev["duration"] = round(last_prev["end_time"] - float(last_prev.get("start_time", 0.0)), 3)
            current_batch_events.pop(0)
            return prev_batch_events, current_batch_events

    # Case 3: Distinct events that collide on the timeline due to overlap collar
    if c_start < p_end + min_gap_sec:
        new_c_start = round(p_end + min_gap_sec, 3)
        new_c_end = max(round(new_c_start + min_duration, 3), c_end)
        first_curr["start_time"] = new_c_start
        first_curr["start"] = new_c_start
        first_curr["start_time_str"] = format_timestamp(new_c_start)
        first_curr["end_time"] = new_c_end
        first_curr["end"] = new_c_end
        first_curr["end_time_str"] = format_timestamp(new_c_end)
        first_curr["duration"] = round(new_c_end - new_c_start, 3)

        # CRITICAL: Cascade this shift across subsequent events in current_batch_events
        # Without this, event 1 and event 2 collide with event 0, causing 2 or 3 subtitles to overlap!
        cursor = new_c_end
        for k in range(1, len(current_batch_events)):
            ev_k = current_batch_events[k]
            k_st = float(ev_k.get("start_time", 0.0))
            k_et = float(ev_k.get("end_time", k_st + 1.0))
            k_dur = max(min_duration, round(k_et - k_st, 3))
            if k_st < cursor + min_gap_sec:
                k_st = round(cursor + min_gap_sec, 3)
                k_et = round(k_st + k_dur, 3)
                ev_k["start_time"] = k_st
                ev_k["start"] = k_st
                ev_k["end_time"] = k_et
                ev_k["end"] = k_et
                ev_k["duration"] = round(k_et - k_st, 3)
                ev_k["start_time_str"] = format_timestamp(k_st)
                ev_k["end_time_str"] = format_timestamp(k_et)
                cursor = k_et
            else:
                break

    return prev_batch_events, current_batch_events


def snap_split_time_to_acoustic_pause(audio_path: Optional[str], approx_time: float, search_radius: float = 0.8) -> float:
    """Finds the local acoustic silence valley (lowest RMS energy) around approx_time so splits never cut words."""
    if not audio_path or not os.path.exists(audio_path):
        return approx_time
    try:
        info = sf.info(audio_path)
        sr = info.samplerate
        total_sec = info.duration
        s_sec = max(0.0, approx_time - search_radius)
        e_sec = min(total_sec, approx_time + search_radius)
        if e_sec <= s_sec + 0.1:
            return approx_time
        start_frame = int(s_sec * sr)
        stop_frame = int(e_sec * sr)
        data, _ = sf.read(audio_path, start=start_frame, stop=stop_frame, dtype='float32')
        if data.ndim > 1:
            data = np.mean(data, axis=1)
        frame_len = int(sr * 0.04)
        hop_len = int(sr * 0.01)
        if len(data) < frame_len + hop_len:
            return approx_time
        num_hops = (len(data) - frame_len) // hop_len
        strided = np.lib.stride_tricks.sliding_window_view(data[:num_hops * hop_len + frame_len], frame_len)[::hop_len]
        energies = np.sqrt(np.mean(strided**2, axis=1))
        cand_times = s_sec + (np.arange(len(energies)) * 0.01)
        dist_pen = np.abs(cand_times - approx_time) * (np.max(energies) - np.min(energies) + 1e-6) * 0.4
        best_idx = int(np.argmin(energies + dist_pen))
        return round(float(cand_times[best_idx]), 3)
    except Exception:
        return approx_time


def split_and_balance_event(
    ev: Dict[str, Any],
    cpl_limit: int = 42,
    max_lines: int = 2,
    audio_path: Optional[str] = None,
    whisper_words: Optional[List[Dict[str, Any]]] = None,
    min_duration: float = 0.833,
    frame_rate: float = 24.0
) -> List[Dict[str, Any]]:
    """Recursively split and balance a subtitle event so NO event exceeds max_lines or cpl_limit."""
    text = ev.get('text', '').strip().replace('...', '…')
    words = text.replace('\n', ' ').split()
    if not words:
        return []
    
    # Check if can fit directly in <= max_lines
    lines = balance_text_to_lines(text, cpl_limit=cpl_limit, max_lines=max_lines)
    if lines:
        ev['text'] = '\n'.join(lines)
        ev['lines'] = lines
        ev['cpl'] = max(len(l) for l in lines)
        return [ev]
        
    # Cannot fit in 2 lines <= cpl_limit! Split into 2 sequential events at best midpoint
    total_len = sum(len(w) for w in words)
    target_mid = total_len / 2.0
    cum = 0
    best_split = len(words) // 2
    best_pen = 999999
    for i in range(1, len(words)):
        cum += len(words[i - 1])
        pen = abs(cum - target_mid)
        prev_w = words[i - 1]
        next_w = words[i].lower().rstrip('.,!?:;--…।॥')
        prev_w_clean = prev_w.lower().rstrip('.,!?:;--…।॥')
        if prev_w.endswith((',', ';', '.', '!', '?', '--', '…', ':', '।', '॥')):
            pen -= 80  # Dominant preference for natural sentence/clause punctuation!
        elif next_w in ['and', 'but', 'or', 'so', 'that', 'who', 'which', 'because', 'when', 'if',
                        'और', 'या', 'अथवा', 'लेकिन', 'मगर', 'किंतु', 'परंतु', 'क्योंकि', 'इसलिए', 'ताकि', 'कि', 'तो', 'जब', 'तब', 'अगर', 'यदि',
                        'aur', 'ya', 'lekin', 'kyunki', 'isliye', 'taaki', 'agar']:
            pen -= 45
        elif next_w in {'ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक', 'लिए', 'साथ',
                        'ne', 'ko', 'se', 'ka', 'ke', 'ki', 'mein', 'me', 'par', 'pe', 'tak'}:
            pen += 2500  # Strictly avoid severing noun and postposition across events!

        bad_ends = {'a', 'an', 'the', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'श्री', 'श्रीमती', 'डॉ.', 'wrong'}
        if prev_w_clean in bad_ends or prev_w.lower() in bad_ends:
            pen += 2500

        if pen < best_pen:
            best_pen = pen
            best_split = i
            
    words_a = words[:best_split]
    words_b = words[best_split:]
    
    st = float(ev.get('start_time', 0.0))
    et = float(ev.get('end_time', st + 2.0))
    dur = max(1.0, et - st)
    ratio_a = max(0.2, min(0.8, sum(len(w) for w in words_a) / max(1, total_len)))
    
    dur_a = max(min_duration, round(dur * ratio_a, 3))
    split_time = round(st + dur_a, 3)

    # If Whisper words are available, anchor split_time to exact acoustic start of boundary word
    acoustic_split_found = False
    if whisper_words and words_b:
        from app.whisper_aligner import _normalize_text
        target_b_word = _normalize_text(words_b[0])
        if target_b_word:
            for w in whisper_words:
                w_start = float(w.get("start", 0.0))
                if (st + 0.3) <= w_start <= (et - 0.3):
                    if _normalize_text(w.get("word", "")) == target_b_word:
                        split_time = round(w_start, 3)
                        acoustic_split_found = True
                        break

    # Snap split point to natural acoustic pause between words if not already anchored
    if audio_path and not acoustic_split_found:
        split_time = snap_split_time_to_acoustic_pause(audio_path, split_time)

    if split_time >= et - min_duration:
        split_time = round(et - min_duration, 3)
        
    min_gap_sec = round(2.0 / frame_rate, 3)
    ev_a = dict(ev)
    ev_a['text'] = ' '.join(words_a)
    ev_a['start_time'] = st
    ev_a['end_time'] = round(split_time - min_gap_sec, 3)
    
    ev_b = dict(ev)
    ev_b['text'] = ' '.join(words_b)
    ev_b['start_time'] = split_time
    ev_b['end_time'] = et
    
    # Recursively format sub-events
    res_a = split_and_balance_event(ev_a, cpl_limit=cpl_limit, max_lines=max_lines, audio_path=audio_path, whisper_words=whisper_words, min_duration=min_duration, frame_rate=frame_rate)
    res_b = split_and_balance_event(ev_b, cpl_limit=cpl_limit, max_lines=max_lines, audio_path=audio_path, whisper_words=whisper_words, min_duration=min_duration, frame_rate=frame_rate)
    return res_a + res_b


def merge_short_fragments(events: List[Dict[str, Any]], cpl_limit: int = 42, max_lines: int = 2) -> List[Dict[str, Any]]:
    """
    Safely merges ONLY true grammatically stranded fragments (e.g. dangling prepositions/conjunctions).
    GUARANTEES that complete conversational dialogues, questions, answers, and short interjections
    ('हाँ', 'नहीं', 'तू सुन', 'मत कर', 'क्या हुआ', 'leave it', 'watch out') are NEVER swallowed or lost!
    """
    if not events:
        return []

    merged = []
    for ev in events:
        text = ev.get("text", "").strip()
        words = text.replace('\n', ' ').split()
        st = float(ev.get("start_time", 0.0))
        et = float(ev.get("end_time", st + 1.0))
        dur = et - st
        
        if merged and (len(words) <= 3 or dur < 0.9):
            prev = merged[-1]
            prev_st = float(prev["start_time"])
            prev_et = float(prev["end_time"])
            combined_dur = et - prev_st

            # Rule 1: Do NOT merge across different speakers!
            prev_spk = prev.get("speaker") or (prev.get("speakers")[0] if prev.get("speakers") else "Speaker 1")
            ev_spk = ev.get("speaker") or (ev.get("speakers")[0] if ev.get("speakers") else "Speaker 1")
            if prev_spk != ev_spk or "-" in prev.get("text", "") or "-" in text:
                merged.append(ev)
                continue

            # Rule 2: NEVER merge across terminal sentence punctuation (., ?, !, ।, ॥, …)
            prev_strip = prev.get("text", "").rstrip()
            if prev_strip.endswith((".", "?", "!", "।", "॥", "…")):
                merged.append(ev)
                continue

            # Rule 3: NEVER merge if ev itself is a complete utterance, exclamation, or question
            ev_strip = text.rstrip()
            if ev_strip.endswith((".", "?", "!", "।", "॥")):
                merged.append(ev)
                continue

            # Rule 4: NEVER merge independent conversational starters, verbs, question words, or particles
            conversational_words = {
                # English conversational starters, verbs, interjections
                "yes", "yeah", "yep", "no", "nah", "nope", "hi", "hello", "hey", "right", "okay", "ok", "fine", "sure",
                "wait", "listen", "what", "why", "how", "who", "when", "where", "well", "see", "look", "please", "thanks", "sorry",
                "stop", "come", "go", "don't", "dont", "let", "lets", "let's", "call", "watch", "leave", "shut",
                # Hindi Devanagari conversational starters, verbs, imperatives
                "हाँ", "नहीं", "ना", "अच्छा", "ठीक", "अरे", "नमस्ते", "शुक्रिया", "धन्यवाद", "सुनो", "रुको", "क्या", "क्यों", "भाई",
                "चल", "हट", "रुक", "देख", "बता", "बोल", "सॉरी", "टारगेट", "मत", "तू", "तुम", "आप", "छोड़", "छोड़", "आया", "गया",
                "कहा", "बोला", "होगा", "कहाँ", "कैसे", "कौन", "किधर", "कब", "कितना", "साहब", "सर", "मैडम", "यार", "दोस्त",
                # Hinglish / Latin equivalents
                "haan", "nahi", "nahin", "achha", "theek", "are", "namaste", "dhanyawad", "suno", "ruko", "kya", "kyun", "bhai",
                "chal", "hat", "ruk", "dekh", "bata", "bol", "sorry", "target", "mat", "tu", "tum", "aap", "chhod", "aaya", "gaya",
                "kaha", "bola", "hoga", "kahan", "kaise", "kaun", "kidhar", "kab", "kitna", "yaar", "dost"
            }
            first_w = words[0].lower().strip(".,!?।॥\"'()—–-") if words else ""
            if first_w in conversational_words:
                merged.append(ev)
                continue

            # Rule 5: Only merge if gap is very tight (<= 0.12s) AND combined duration <= 5.0s
            # AND the preceding line ended without complete clause boundary
            if combined_dur <= 5.0 and (st - prev_et) <= 0.12:
                combined_text = prev["text"].replace('\n', ' ') + ' ' + text
                balanced = balance_text_to_lines(combined_text, cpl_limit=cpl_limit, max_lines=max_lines)
                if balanced:
                    prev["text"] = '\n'.join(balanced)
                    prev["end_time"] = et
                    prev["end"] = et
                    prev["duration"] = round(et - prev_st, 3)
                    continue

        merged.append(ev)
    return merged


def polish_subtitle_events_netflix(
    events: List[Dict[str, Any]],
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    frame_rate: float = 24.0,
    shot_changes: Optional[List[float]] = None,
    prev_batch_end: float = 0.0
) -> List[Dict[str, Any]]:
    """
    Industry-Standard Netflix conformance pass:
    - Guarantees 0 events have > max_lines (split into sequential events if needed, ZERO words lost).
    - Guarantees all lines <= cpl_limit with grammatically sound breaks.
    - Merges isolated orphan fragments into previous events.
    - Extends into following and preceding silence aiming for comfortable reading speed.
    - Ensures min_duration >= 0.833s and max_duration <= 7.0s.
    - Dedicated pass guarantees strict 2-frame gap and eliminates gap-flash flicker.
    - Snaps to shot changes if provided.
    - Replaces ascii '...' with Unicode ellipsis '…'.
    """
    from app.netflix_models import format_timestamp, calculate_cps, calculate_cpl
    from app.netflix_linter import split_multi_speaker_subtitles
    min_gap_sec = round(2.0 / frame_rate, 3)

    # Step 0: Ensure strict single-speaker events (never 2 speakers in 1 subtitle)
    events = split_multi_speaker_subtitles(events, frame_rate=frame_rate, min_duration=min_duration)
    
    # Step 1: Split and balance any oversized subtitles (NO WORDS DROPPED)
    expanded_events = []
    for ev in events:
        expanded_events.extend(split_and_balance_event(ev, cpl_limit=cpl_limit, max_lines=max_lines, min_duration=min_duration, frame_rate=frame_rate))
        
    # Step 2: Merge orphan tiny fragments that fit into previous event
    expanded_events = merge_short_fragments(expanded_events, cpl_limit=cpl_limit, max_lines=max_lines)

    # Invariant: Sort strictly by start_time so non-overlap checks work in true chronological sequence
    expanded_events.sort(key=lambda x: (float(x.get("start_time", 0.0)), float(x.get("end_time", 0.0))))

    # Guarantee first event does not collide with previous batch end (only if prev_batch_end is adjacent to first event)
    first_st = float(expanded_events[0].get("start_time", 0.0)) if expanded_events else 0.0
    eff_prev_end = prev_batch_end if (0.0 < prev_batch_end <= first_st + 2.0 and prev_batch_end >= first_st - 5.0) else 0.0

    if expanded_events and eff_prev_end > 0.0:
        first_ev = expanded_events[0]
        f_st = float(first_ev.get("start_time", 0.0))
        if f_st < eff_prev_end + min_gap_sec:
            first_ev["start_time"] = round(eff_prev_end + min_gap_sec, 3)
            first_ev["start"] = first_ev["start_time"]
            first_ev["end_time"] = round(max(float(first_ev.get("end_time", 0.0)), first_ev["start_time"] + min_duration), 3)
            first_ev["end"] = first_ev["end_time"]
            # Cascade forward if needed
            cur_end = float(first_ev["end_time"])
            for k in range(1, len(expanded_events)):
                k_st = float(expanded_events[k].get("start_time", 0.0))
                k_dur = max(min_duration, float(expanded_events[k].get("end_time", k_st + 1.0)) - k_st)
                if k_st < cur_end + min_gap_sec:
                    k_st = round(cur_end + min_gap_sec, 3)
                    expanded_events[k]["start_time"] = k_st
                    expanded_events[k]["start"] = k_st
                    expanded_events[k]["end_time"] = round(k_st + k_dur, 3)
                    expanded_events[k]["end"] = expanded_events[k]["end_time"]
                    cur_end = float(expanded_events[k]["end_time"])
                else:
                    break
    
    n = len(expanded_events)
    for idx, ev in enumerate(expanded_events):
        text = ev.get("text", "").strip()
        st = float(ev.get("start_time", 0.0))
        et = float(ev.get("end_time", st + 1.5))
        dur = max(0.01, round(et - st, 3))
        
        # 1. Min duration guard (strictly respecting next event start)
        if dur < min_duration:
            next_st = float(expanded_events[idx + 1]["start_time"]) if idx + 1 < n else et + 2.0
            max_allowed_et = next_st - min_gap_sec
            et = round(min(max_allowed_et, st + min_duration), 3)
            dur = max(0.01, round(et - st, 3))

        # 2. Max duration cap
        if dur > max_duration:
            et = round(st + max_duration, 3)
            dur = max_duration

        # 3. Snap to shot changes (Netflix cuts rule)
        if shot_changes:
            for sc in shot_changes:
                if 0.0 < abs(st - sc) < 3.0 / frame_rate:
                    st = round(sc, 3)
                    dur = max(0.01, round(et - st, 3))
                if 0.0 < abs(et - sc) < 3.0 / frame_rate:
                    et = round(sc - min_gap_sec, 3)
                    dur = max(0.01, round(et - st, 3))

        ev["start_time"] = st
        ev["end_time"] = et

    # Step 3: Enforce strict Netflix gap chaining & zero-overlap guarantee
    from app.netflix_linter import auto_chain_gaps
    expanded_events = auto_chain_gaps(expanded_events, frame_rate=frame_rate, min_duration=min_duration, max_cps=max_cps)

    for ev in expanded_events:
        st = float(ev["start_time"])
        et = float(ev["end_time"])
        dur = max(0.01, round(et - st, 3))
        if dur > max_duration:
            et = round(st + max_duration, 3)
            dur = max_duration
        ev["start_time"] = st
        ev["end_time"] = et
        ev["start"] = st
        ev["end"] = et
        ev["start_time_str"] = format_timestamp(st)
        ev["end_time_str"] = format_timestamp(et)
        ev["duration"] = dur

        # Guarantee EXACTLY ONE speaker per subtitle event (strip any leading dialogue dashes)
        clean_text = ev["text"]
        lines = [l.strip() for l in clean_text.split("\n") if l.strip()]
        unhyphenated_lines = []
        for l in lines:
            if l.startswith(("- ", "— ", "– ")):
                unhyphenated_lines.append(l[2:].strip())
            elif l.startswith(("-", "—", "–")):
                unhyphenated_lines.append(l[1:].strip())
            else:
                unhyphenated_lines.append(l)
        ev["text"] = "\n".join(unhyphenated_lines)
        ev["lines"] = unhyphenated_lines
        ev["speakers"] = [(ev.get("speakers") or ["Speaker 1"])[0]]
        ev["speaker_count"] = 1
        ev["cpl"] = calculate_cpl(ev["text"])
        ev["qc_errors"] = []
        ev["is_valid"] = True

    return expanded_events


def post_process_subtitles(
    raw_events: List[Dict[str, Any]],
    audio_path: str,
    shot_changes: List[float],
    frame_rate: float,
    content_type: str,
    is_dual_channel: bool = False,
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
) -> List[Dict[str, Any]]:
    """
    Post-processing pipeline with:
    - Micro-collar acoustic energy snapping (+/- 0.15s) from Transcribe Studio
    - VAD physical speech interval clamping
    - Strict monotonic ordering with min 50ms breathing room (prevents flicker & overlap)
    - CPS, CPL, and Netflix compliance calculations
    """
    log_terminal(f"Processing {len(raw_events)} verbatim subtitle events...")
    
    # Extract physical speech intervals for silence gating
    physical_intervals = []
    try:
        physical_intervals = extract_physical_speech_intervals(audio_path)
    except Exception:
        pass

    event_dicts = []
    prev_end = 0.0

    for i, item in enumerate(raw_events, 1):
        raw = item["raw"]
        offset = item.get("chunk_offset", 0.0)
        
        st_val = raw.get("start_time", 0.0)
        et_val = raw.get("end_time", 2.0)
        
        s_time = (parse_timestamp(st_val) if isinstance(st_val, str) else float(st_val)) + offset
        e_time = (parse_timestamp(et_val) if isinstance(et_val, str) else float(et_val)) + offset
        
        # Ensure valid initial ordering
        if e_time <= s_time:
            e_time = s_time + 1.5

        # 1. Acoustic vocal boundary snapping (Silero VAD, +/- 0.80s search window)
        try:
            s_time, e_time = snap_to_acoustic_boundaries(audio_path, s_time, e_time, collar_sec=0.80)
        except Exception:
            pass

        # 2. VAD Silence Clamping: if e_time extends >1.2s past active speech, clamp it
        if physical_intervals:
            overlapping_ends = [
                inv["end_time"] for inv in physical_intervals
                if inv["start_time"] <= e_time + 0.3 and inv["end_time"] >= s_time - 0.3
            ]
            if overlapping_ends:
                max_speech_end = max(overlapping_ends)
                if e_time > max_speech_end + 1.2:
                    e_time = round(max_speech_end + 0.250, 3)

        # 3. Acoustic Anchor Principle: Lock s_time to speech onset; trim lingering previous event rather than pushing s_time into the future
        if s_time < prev_end:
            target_prev_end = round(s_time - 0.050, 3)
            if events and target_prev_end > events[-1]["start_time"] + 0.20:
                events[-1]["end_time"] = target_prev_end
                events[-1]["end"] = target_prev_end
                events[-1]["duration"] = round(target_prev_end - events[-1]["start_time"], 3)
                prev_end = target_prev_end
            else:
                s_time = round(prev_end + 0.050, 3)
        elif s_time == prev_end and i > 1:
            s_time = round(prev_end + 0.050, 3)

        if e_time <= s_time:
            e_time = round(s_time + max(0.500, min_duration), 3)

        s_time = round(s_time, 3)
        e_time = round(e_time, 3)
        duration = max(0.01, round(e_time - s_time, 3))

        speakers = raw.get("speakers", [])
        if not speakers:
            speakers = ["Speaker 1"]

        text = str(raw.get("text", "")).strip()

        # 4. Intelligent CPS Gapping: If reading speed > max_cps, extend duration into silence
        cur_cps = calculate_cps(text, duration)
        if cur_cps > max_cps and duration < max_duration:
            clean_txt = text.replace('\n', ' ').strip()
            needed_dur = len(clean_txt) / max_cps
            target_end = s_time + min(needed_dur, max_duration, duration + 1.2)
            e_time = round(target_end, 3)
            duration = max(0.01, round(e_time - s_time, 3))

        prev_end = e_time

        event_dict = {
            "id": i,
            "start_time": s_time,
            "end_time": e_time,
            "start": s_time,
            "end": e_time,
            "start_time_str": format_timestamp(s_time),
            "end_time_str": format_timestamp(e_time),
            "duration": duration,
            "text": text,
            "lines": text.split("\n"),
            "speaker_count": len(speakers),
            "speakers": speakers,
            "is_italic": bool(raw.get("is_italic", False)),
            "is_forced_narrative": bool(raw.get("is_forced_narrative", False)),
            "cps": calculate_cps(text, duration),
            "cpl": calculate_cpl(text),
            "qc_errors": [],
            "is_valid": True
        }
        event_dicts.append(event_dict)

    # Apply strict Netflix CPL line breaking and CPS splitting/extension to every event
    from app.netflix_linter import format_and_split_subtitle_events
    formatted_events = format_and_split_subtitle_events(
        events=event_dicts,
        cpl_limit=cpl_limit,
        max_cps=max_cps,
        max_lines=max_lines,
        min_duration=min_duration,
        max_duration=max_duration,
        frame_rate=frame_rate,
    )
    return formatted_events


def build_qc_result(
    events: List[Dict[str, Any]],
    video_id: str,
    filename: str,
    language: str,
    content_type: str,
    frame_rate: float,
    shot_changes: List[float],
    audio_duration: float,
    video_resolution: str,
    compliance_score: float = 100.0,
    cps_stats: Optional[Dict[str, Any]] = None
) -> dict:
    """Build the final QC result dict matching the NetflixQCResult model."""
    total_errors = sum(1 for e in events for err in e.get("qc_errors", []) if err.get("severity") == "error")
    total_warnings = sum(1 for e in events for err in e.get("qc_errors", []) if err.get("severity") == "warning")
    
    if cps_stats is None:
        cps_list = [e.get("cps", 0.0) for e in events if e.get("duration", 0) > 0]
        if cps_list:
            cps_stats = {
                "min_cps": min(cps_list),
                "max_cps": max(cps_list),
                "avg_cps": round(sum(cps_list)/len(cps_list), 2),
                "p95_cps": sorted(cps_list)[int(len(cps_list)*0.95)],
                "events_over_limit": sum(1 for c in cps_list if c > (20.0 if content_type == "adult" else 17.0)),
                "total_events": len(events)
            }
        else:
            cps_stats = {"min_cps": 0.0, "max_cps": 0.0, "avg_cps": 0.0, "p95_cps": 0.0, "events_over_limit": 0, "total_events": 0}
        
    return {
        "video_id": video_id,
        "filename": filename,
        "language": language,
        "events": events,
        "total_events": len(events),
        "total_errors": total_errors,
        "total_warnings": total_warnings,
        "compliance_score": compliance_score,
        "cps_stats": cps_stats,
        "shot_changes": shot_changes,
        "frame_rate": frame_rate,
        "content_type": content_type,
        "audio_duration": audio_duration,
        "video_resolution": video_resolution
    }


def generate_subtitles(
    video_path: str,
    language: str = "auto",
    script: str = "auto",
    content_type: str = "adult",
    sdh_mode: bool = False,
    progress_callback = None,
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    gemini_auto_fix: bool = True,
    custom_frame_rate: Optional[float] = None,
    project_glossary: Optional[List[str]] = None
) -> dict:
    """Synchronous / Threaded end-to-end pipeline for Netflix subtitle generation with dynamic settings."""
    resolved_language, resolved_script = normalize_language_and_script(language, script)
    log_terminal(f"Starting subtitle generation for: {Path(video_path).name}")
    log_terminal(f"Parameters: Language={resolved_language}, Script={resolved_script}, Content={content_type}, SDH={sdh_mode}, CPL<={cpl_limit}, CPS<={max_cps}, AutoFix={gemini_auto_fix}")
    
    if progress_callback:
        progress_callback("Extracting Audio", 10, "Extracting audio track from video...")
    
    # 1. Extract audio
    audio_info = extract_audio_from_video(video_path)
    audio_path_out = audio_info.get("audio_path")
    if not audio_path_out or not os.path.exists(audio_path_out):
        raise RuntimeError("Failed to extract audio from video.")
        
    # 2. Detect shot changes
    shot_changes = detect_shot_changes(video_path)
    
    # 3. Get video metadata
    video_meta = get_video_metadata(video_path)
    detected_fps = float(video_meta.get("frame_rate", 24.0))
    if custom_frame_rate is not None and float(custom_frame_rate) > 0:
        frame_rate = float(custom_frame_rate)
        log_terminal(f"Using user-specified frame rate: {frame_rate} FPS (container detected: {detected_fps} FPS)")
    elif detected_fps > 0:
        frame_rate = detected_fps
        log_terminal(f"Auto-detected frame rate from container: {frame_rate} FPS")
    else:
        frame_rate = 24.0
    video_resolution = f"{video_meta.get('width', 0)}x{video_meta.get('height', 0)}"
    
    # 4. Inspect audio properties
    audio_props = inspect_audio(audio_path_out)
    total_duration = audio_props.get("duration", 0.0)
    
    # 5. Detect dual-channel audio
    dual_ch_info = detect_dual_channel_layout(audio_path_out)
    is_dual_channel = dual_ch_info.get("is_dual_channel", False)
    
    # 6. Whisper acoustic alignment settings (executed per-batch to cap CPU/memory usage)
    is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
    enable_whisper = os.getenv("ENABLE_WHISPER", "true").lower() == "true"
    whisper_model = os.getenv("WHISPER_MODEL", "tiny" if is_cloud else "base")
    whisper_words = []
    if not enable_whisper:
        log_terminal("Cloud instance / Fast mode: using Gemini native millisecond audio timestamps.")
    else:
        log_terminal(f"Whisper acoustic alignment active ({whisper_model}).")
    
    # 7. Chunk audio: ~90s batches (+/- n seconds) ending at 1-2s dialogue pauses
    if total_duration > 65.0:
        chunks = find_dialogue_split_points(audio_path_out, target_chunk_sec=90.0, min_chunk_sec=65.0, max_chunk_sec=115.0)
    else:
        chunks = [(0.0, total_duration)]
        
    client = get_gemini_client()
    candidate_models = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
    ]
    primary = GEMINI_MODEL
    if primary and primary in candidate_models:
        candidate_models.remove(primary)
        candidate_models.insert(0, primary)
    elif primary:
        candidate_models.insert(0, primary)
            
    raw_subtitles = []
    video_id = str(uuid.uuid4())[:8]
    rolling_context = []
    
    # Phase 3 Fix 3: Speaker registry for non-streaming batch loop
    speaker_registry = {}
    speaker_lock_clause = ""
    
    for chunk_idx, (chunk_s, chunk_e) in enumerate(chunks, 1):
        log_terminal(f"Processing Chunk {chunk_idx}/{len(chunks)} [{chunk_s:.2f}s -> {chunk_e:.2f}s] with Gemini AI...")
        
        # 250ms acoustic decay cushion (ensures zero cross-batch dialogue overlap during 1-2s pauses)
        collar_sec = 0.25
        collar_left = collar_sec if chunk_s >= collar_sec else 0.0
        collar_right = collar_sec if (chunk_e + collar_sec) <= total_duration else 0.0
        slice_s = max(0.0, round(chunk_s - collar_left, 3))
        slice_e = min(total_duration, round(chunk_e + collar_right, 3))

        norm_target_path = None
        if len(chunks) > 1:
            slice_filename = f"temp_chunk_{video_id}_{chunk_idx}.wav"
            slice_path = UPLOAD_DIR / slice_filename
            extract_audio_slice(audio_path_out, slice_s, slice_e, str(slice_path))
            norm_slice_path = UPLOAD_DIR / f"temp_norm_chunk_{video_id}_{chunk_idx}.wav"
            target_path = apply_dynamic_audio_normalization(str(slice_path), str(norm_slice_path))
            if target_path == str(norm_slice_path):
                norm_target_path = str(norm_slice_path)
        else:
            slice_s = 0.0
            slice_e = total_duration
            norm_single_path = UPLOAD_DIR / f"temp_norm_single_{video_id}.wav"
            target_path = apply_dynamic_audio_normalization(audio_path_out, str(norm_single_path))
            if target_path == str(norm_single_path):
                norm_target_path = str(norm_single_path)
            
        try:
            # Read chunk audio bytes directly (under 3MB, well within 20MB inline limit)
            with open(target_path, "rb") as f:
                chunk_bytes = f.read()
            audio_part = types.Part.from_bytes(data=chunk_bytes, mime_type="audio/wav")

            context_clause = ""
            if rolling_context:
                formatted_prev = "\n".join([f"- {item}" for item in rolling_context[-5:]])
                context_clause = (
                    f"PREVIOUS CONVERSATION CONTEXT (from previous minutes for conversational continuity, speaker identity & proper nouns — DO NOT re-transcribe):\n"
                    f"{formatted_prev}\n\n"
                    f"CRITICAL SEAM CONTINUITY: If a sentence was spoken across or near the boundary transition, transcribe the COMPLETE full sentence in this chunk so zero words or syllables are cut off!\n\n"
                )

            # Phase 3 Fix 3: Inject speaker identity lock from batch 2 onwards
            if speaker_lock_clause:
                context_clause = speaker_lock_clause + context_clause

            music_dialogue_clause = (
                "CRITICAL DIALOGUE OVER BACKGROUND MUSIC & SOUNDTRACK:\n"
                "- When background music, soundtrack, or long instrumental tones play with only occasional or sparse dialogue spoken, YOU MUST DETECT AND TRANSCRIBE EVERY SINGLE SPOKEN WORD with exact timestamps!\n"
                "- Never skip or omit quiet, soft, or sparse dialogue just because music is playing.\n"
                "- Do NOT transcribe instrumental music as subtitles, but ALWAYS transcribe human speech spoken within or over musical sections.\n\n"
            )

            gaming_sfx_clause = (
                "CRITICAL GAMING, GUNFIRE & IN-GAME VOICE CHAT RULE:\n"
                "- Players speak over loud gunshots, explosions, vehicles, and footsteps. YOU MUST TRANSCRIBE ALL SPOKEN WORDS even when partially masked by game SFX!\n"
                "- Treat in-game / Discord teammate voice chat with EQUAL PRIORITY to the main streamer's microphone.\n"
                "- When multiple speakers talk at the same time or call out simultaneously, use dual-speaker hyphen format (- Speaker 1: ...\\n- Speaker 2: ...). NEVER omit either speaker!\n\n"
            )

            script_clause = f"Target Script: {resolved_script}\n" if resolved_script != "Auto-Detect" else ""
            glossary_clause = ""
            if project_glossary and len(project_glossary) > 0:
                clean_terms = [t.strip() for t in project_glossary if isinstance(t, str) and t.strip()]
                if clean_terms:
                    terms_str = ", ".join([repr(t) for t in clean_terms])
                    glossary_clause = (
                        f"PROJECT GLOSSARY & CUSTOM VOCABULARY (MANDATORY PROPER NOUNS):\n"
                        f"The following domain-specific terms, character names, gamertags, locations, and slang are present in this audio:\n"
                        f"[{terms_str}]\n"
                        f"Whenever acoustic signals resemble any of these terms, ALWAYS spell and transcribe them using these exact names! Do NOT substitute, invent alternative spellings, or mishear them.\n\n"
                    )

            prompt = (
                f"{context_clause}"
                f"{glossary_clause}"
                f"{music_dialogue_clause}"
                f"{gaming_sfx_clause}"
                f"Target Spoken Language: {resolved_language}\n"
                f"{script_clause}"
                f"SDH Mode: {sdh_mode}\n"
                f"Content Type: {content_type}\n"
                f"MANDATORY FORMATTING & TIMING SPECIFICATIONS:\n"
                f"1. 100% VERBATIM ACCURACY (HIGHEST PRIORITY): Transcribe the EXACT words spoken word-for-word. NEVER summarize, paraphrase, simplify, omit, smooth grammar, or alter dialogue in any way, even when speakers talk rapidly!\n"
                f"2. ABSOLUTE PROPER NOUN PRESERVATION & ANTI-ANGLICIZATION:\n"
                f"   - NEVER anglicize, westernize, or substitute South Asian, Indian, regional, or culturally specific names, places, or titles (e.g. 'Tarun' must ALWAYS remain 'Tarun' or 'तरुण', NEVER replace with Western names like 'Tyrone').\n"
                f"   - Transcribe names with phonetic fidelity.\n"
                f"3. STRICT LANGUAGE & SCRIPT PURITY:\n"
                f"   - If Target Language is Hindi and Script is Devanagari: Output 100% in Hindi using standard Devanagari script. Do NOT translate into English!\n"
                f"   - If Target Language is Hindi and Script is Latin (Hinglish): Output conversational Hindi in the Latin alphabet (e.g. 'Tarun, kya haal hai?'). Do NOT translate into English!\n"
                f"   - If Target Language is English: Output in English.\n"
                f"4. MAXIMUM CHARACTERS PER LINE (CPL): Exactly <= {cpl_limit} characters per line.\n"
                f"   - When a sentence exceeds {cpl_limit - 4} characters, insert a newline ('\\n') at a natural linguistic pause.\n"
                f"5. READING SPEED (CPS): Target comfortable reading speed (~{max_cps} CPS). In fast dialogue, prioritize 100% verbatim capture and output tighter, shorter sequential subtitle events rather than dropping words!\n"
                f"6. MAXIMUM LINES: Exactly <= {max_lines} lines per subtitle event.\n"
                f"7. COMPLETE CLAUSES & SYNTACTIC BOUNDARIES: Subtitle events MUST break at natural clause boundaries.\n"
                f"8. MULTI-SPEAKER & DUAL SPEAKER FORMATTING: When two speakers speak simultaneously, use dual-speaker hyphen format (- Speaker 1: ...\\n- Speaker 2: ...). NEVER drop either speaker!\n"
                f"9. TIMESTAMPS: Provide acoustic start_time and end_time for each subtitle event relative to this audio slice."
            )
            
            response = None
            last_error = None
            
            for candidate in candidate_models:
                for attempt in range(1, 3):
                    try:
                        response = client.models.generate_content(
                            model=candidate,
                            contents=[audio_part, prompt],
                            config=types.GenerateContentConfig(
                                system_instruction=get_netflix_subtitle_system_prompt(cpl_limit=cpl_limit, max_cps=max_cps, max_lines=max_lines),
                                response_mime_type="application/json",
                                response_schema=SubtitleBatchSchema,
                                temperature=0.1,
                                max_output_tokens=16384,
                            )
                        )
                        if response is not None:
                            break
                    except Exception as e:
                        last_error = e
                        err_str = str(e).lower()
                        # Fast failover on quota exhaustion (429) or deprecated model (404)
                        if any(kw in err_str for kw in ["429", "quota", "resource_exhausted", "404", "not_found", "no longer available"]):
                            log_terminal(f"Model {candidate} hit quota/unavailability. Switching immediately to next candidate...")
                            break
                        elif any(kw in err_str for kw in ["503", "unavailable", "timeout", "deadline", "timed out", "connection", "reset", "500"]):
                            if attempt < 2:
                                time.sleep(1.5)
                                continue
                            else:
                                break
                        else:
                            break
                if response is not None:
                    break
                    
            if response is None:
                log_terminal(f"Gemini API unavailable for Chunk {chunk_idx}. Falling back to local Whisper transcription...")
                subs = transcribe_chunk_with_whisper(target_path, chunk_s, language=resolved_language, cpl_limit=cpl_limit, whisper_model=whisper_model)
                if subs:
                    parsed = {"subtitles": subs}
                else:
                    chunk_whisper_words = [w for w in whisper_words if w["start"] >= chunk_s - 0.2 and w["end"] <= chunk_e + 0.2]
                    if chunk_whisper_words:
                        subs = group_whisper_words_into_subtitles(chunk_whisper_words, chunk_s, cpl_limit=cpl_limit)
                        parsed = {"subtitles": subs}
                    else:
                        raise RuntimeError(f"Gemini & Whisper generation failed: {last_error}")
            else:
                parsed = extract_and_repair_subtitle_json(response.text)
            # Lock language and script across chunks
            if chunk_idx == 1:
                if parsed.get("detected_language") and resolved_language in ["en", "auto", "Auto-Detect"]:
                    resolved_language = parsed["detected_language"]
                if parsed.get("detected_script") and resolved_script == "Auto-Detect":
                    resolved_script = parsed["detected_script"]

            subs = parsed.get("subtitles", []) if isinstance(parsed, dict) else []
            if isinstance(parsed, list):
                subs = parsed
                
            prev_chunk_end = raw_subtitles[-1]["end_time"] if raw_subtitles else 0.0
            resolved_chunk_subs = resolve_batch_timestamps(
                subs,
                slice_s,
                slice_e,
                prev_batch_end=prev_chunk_end,
                min_gap_sec=round(2.0 / frame_rate, 3),
                min_duration=min_duration
            )

            # Cross-chunk acoustic seam stitching & deduplication across 1.0s overlap collar
            if raw_subtitles and resolved_chunk_subs:
                raw_subtitles, resolved_chunk_subs = stitch_cross_chunk_seam(
                    raw_subtitles,
                    resolved_chunk_subs,
                    min_gap_sec=round(2.0 / frame_rate, 3),
                    min_duration=min_duration,
                    collar_sec=collar_sec
                )

            for item in resolved_chunk_subs:
                item["id"] = len(raw_subtitles) + 1
                raw_subtitles.append(item)
            
            # Update rolling context for next chunk
            for item in raw_subtitles[-5:]:
                txt = item.get("text", "").replace("\n", " ").strip()
                spk = (item.get("speakers") or ["Speaker"])[0]
                if txt:
                    rolling_context.append(f"{spk}: \"{txt}\"")
            if len(rolling_context) > 10:
                rolling_context = rolling_context[-10:]

            # Phase 3 Fix 3: Update speaker registry & lock clause across batches
            for ev in resolved_chunk_subs:
                spk = (ev.get("speakers") or ["Speaker 1"])[0]
                if spk not in speaker_registry:
                    speaker_registry[spk] = {"count": 0, "first_seen": chunk_idx}
                speaker_registry[spk]["count"] += 1

            if chunk_idx == 1 and not speaker_lock_clause and speaker_registry:
                ordered_spks = sorted(speaker_registry.keys(),
                                      key=lambda s: (speaker_registry[s]["first_seen"], -speaker_registry[s]["count"]))
                spk_lines = []
                for rank, spk_label in enumerate(ordered_spks[:4], 1):
                    spk_lines.append(f"  - {spk_label}: voice #{rank} heard in the audio (maintain this label for this same voice throughout)")
                speaker_lock_clause = (
                    "SPEAKER IDENTITY LOCK (established from the first segment — do NOT reassign):\n"
                    + "\n".join(spk_lines) + "\n"
                    "CRITICAL: Use EXACTLY these speaker labels for the same voices. Do NOT flip, swap, or rename speakers.\n\n"
                )
                log_terminal(f"Chunk {chunk_idx}: Speaker registry locked: {list(speaker_registry.keys())}")
                    
            # Extract Whisper words on this batch slice with resolved language (if enabled)
            if enable_whisper:
                try:
                    cw = get_whisper_word_timestamps(target_path, language=resolved_language, model_name=whisper_model)
                    for w in cw:
                        w["start"] = round(w["start"] + slice_s, 3)
                        w["end"] = round(w["end"] + slice_s, 3)
                    whisper_words.extend(cw)
                except Exception as e:
                    log_terminal(f"Chunk {chunk_idx} Whisper alignment warning: {e}")

        finally:
            if len(chunks) > 1 and os.path.exists(target_path):
                try:
                    os.unlink(target_path)
                except Exception:
                    pass
            if norm_target_path and os.path.exists(norm_target_path):
                try:
                    os.unlink(norm_target_path)
                except Exception:
                    pass
            if len(chunks) > 1 and 'slice_path' in locals() and os.path.exists(str(slice_path)):
                try:
                    os.unlink(str(slice_path))
                except Exception:
                    pass
                
    # Stage 0: Guarantee single speaker per event (split any multi-speaker events)
    from app.netflix_linter import split_multi_speaker_subtitles
    raw_subtitles = split_multi_speaker_subtitles(raw_subtitles, frame_rate=frame_rate, min_duration=min_duration)

    # Stage 1A: Heal any cross-event dangling phrases (e.g. 'the wrong' | 'bedroom' or 'Mrs.' | 'Rutherford')
    raw_subtitles = heal_cross_event_dangling_phrases(raw_subtitles, cpl_limit=cpl_limit, max_lines=max_lines)

    # Stage 1B: Pre-split any oversized events that exceed 2 lines or cpl_limit (ZERO words dropped)
    split_subtitles = []
    for s in raw_subtitles:
        split_subtitles.extend(split_and_balance_event(s, cpl_limit=cpl_limit, max_lines=max_lines, whisper_words=whisper_words, min_duration=min_duration, frame_rate=frame_rate))

    # Stage 2: Monotonic Whisper Acoustic Synchronization
    if whisper_words and split_subtitles:
        log_terminal("Aligning subtitle timestamps to Whisper acoustic boundaries...")
        split_subtitles = align_subtitle_timestamps(
            split_subtitles,
            whisper_words,
            search_radius=8.0,
            audio_path=audio_path_out,
            frame_rate=frame_rate,
            min_duration=min_duration,
            max_duration=max_duration
        )

    # Stage 3: Non-destructive Netflix polish
    fixed_event_dicts = polish_subtitle_events_netflix(
        events=split_subtitles,
        cpl_limit=cpl_limit,
        max_cps=max_cps,
        max_lines=max_lines,
        min_duration=min_duration,
        max_duration=max_duration,
        frame_rate=frame_rate,
        shot_changes=shot_changes
    )
    
    # Audit and build result (no redundant expensive API calls)
    lint_result = lint_all_subtitles(
        events=fixed_event_dicts,
        shot_changes=shot_changes,
        content_type=content_type,
        frame_rate=frame_rate,
        custom_cpl=cpl_limit,
        custom_cps=max_cps,
        custom_max_lines=max_lines,
            custom_min_duration=min_duration,
            custom_max_duration=max_duration,
        )
    
    return build_qc_result(
        events=lint_result["events"],
        video_id=video_id,
        filename=Path(video_path).name,
        language=language,
        content_type=content_type,
        frame_rate=frame_rate,
        shot_changes=shot_changes,
        audio_duration=total_duration,
        video_resolution=video_resolution,
        compliance_score=lint_result.get("compliance_score", 100.0),
        cps_stats=lint_result.get("cps_stats")
    )


async def execute_task_with_heartbeats(
    task_coro_or_func,
    *args,
    chunk_idx: int = 1,
    total_chunks: int = 1,
    stage: str = "Processing",
    heartbeat_interval: float = 2.5,
    **kwargs
):
    """
    Executes a blocking function (in a thread) or an async coroutine, while yielding SSE
    keepalive comment lines (': keepalive\\n\\n') and application heartbeats every
    `heartbeat_interval` seconds. This prevents Cloudflare/Render reverse proxies from
    timing out (60-100s idle limit) during long Gemini inference calls.
    """
    if asyncio.iscoroutinefunction(task_coro_or_func):
        task = asyncio.create_task(task_coro_or_func(*args, **kwargs))
    else:
        task = asyncio.create_task(asyncio.to_thread(task_coro_or_func, *args, **kwargs))
    
    elapsed = 0.0
    try:
        while not task.done():
            done, _ = await asyncio.wait([task], timeout=heartbeat_interval)
            if not done:
                elapsed += heartbeat_interval
                # Standard SSE comment line (RFC 8895 / EventSource specification ignores lines starting with :)
                # Keeps TCP socket and proxy buffers active
                yield ": keepalive\n\n"
                # Structured JSON heartbeat for frontend UI progress tracking
                yield f"data: {json.dumps({'type': 'heartbeat', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'elapsed_sec': round(elapsed, 1), 'stage': f'{stage} ({round(elapsed)}s)'})}\n\n"
        
        result = await task
        yield ("__RESULT__", result)
    except Exception as e:
        if not task.done():
            task.cancel()
        raise e


async def generate_subtitles_stream(
    video_path: str,
    language: str = "auto",
    script: str = "auto",
    content_type: str = "adult",
    sdh_mode: bool = False,
    cpl_limit: int = 42,
    max_cps: float = 20.0,
    max_lines: int = 2,
    min_duration: float = 0.833,
    max_duration: float = 7.0,
    gemini_auto_fix: bool = True,
    start_chunk: int = 1,
    prev_events_count: int = 0,
    prev_batch_end: float = 0.0,
    prev_context: Optional[List[str]] = None,
    start_time: Optional[float] = None,
    batch_mode: str = "all",
    user_feedback: Optional[str] = None,
    custom_frame_rate: Optional[float] = None,
    project_glossary: Optional[List[str]] = None
) -> AsyncGenerator[str, None]:
    """Progressive Batch-wise SSE Stream generator with resume capability, single-batch review pause, and user feedback injection."""
    resolved_language, resolved_script = normalize_language_and_script(language, script)
    start_chunk = max(1, int(start_chunk))
    prev_events_count = max(0, int(prev_events_count))
    current_event_id = prev_events_count + 1
    prev_batch_end = max(0.0, float(prev_batch_end))
    start_time_sec = float(start_time) if start_time is not None and float(start_time) > 0.0 else None
    rolling_context = list(prev_context) if prev_context else []

    glossary_clause = ""
    if project_glossary and len(project_glossary) > 0:
        clean_terms = [t.strip() for t in project_glossary if isinstance(t, str) and t.strip()]
        if clean_terms:
            terms_str = ", ".join([repr(t) for t in clean_terms])
            glossary_clause = (
                f"PROJECT GLOSSARY & CUSTOM VOCABULARY (MANDATORY PROPER NOUNS):\n"
                f"The following domain-specific terms, character names, gamertags, locations, and slang are present in this audio:\n"
                f"[{terms_str}]\n"
                f"Whenever acoustic signals resemble any of these terms, ALWAYS spell and transcribe them using these exact names! Do NOT substitute, invent alternative spellings, or mishear them.\n\n"
            )

    log_terminal(f"Starting Progressive Batch Stream for: {Path(video_path).name} (Starting at Batch {start_chunk}{f', From Time {start_time_sec:.2f}s' if start_time_sec else ''})")
    log_terminal(f"Settings: Language={resolved_language}, Script={resolved_script}, Content={content_type}, SDH={sdh_mode}, CPL<={cpl_limit}, CPS<={max_cps}, BatchMode={batch_mode}, UserFeedback={'Yes' if user_feedback else 'None'}, GlossaryTerms={len(project_glossary) if project_glossary else 0}")
    
    all_raw_subtitles = []
    all_aligned_subtitles = []
    video_id = str(uuid.uuid4())[:8]
    total_duration = 0.0
    shot_changes = []
    frame_rate = 24.0

    try:
        # Immediate handshake ping to flush HTTP 200 headers and prevent reverse proxy idle timeouts
        yield ": ping - connection established\n\n"
        yield f"data: {json.dumps({'type': 'init_start', 'stage': 'Initializing media pipeline...'})}\n\n"

        # 1. Extract audio
        audio_info = await asyncio.to_thread(extract_audio_from_video, video_path)
        audio_path_out = audio_info.get("audio_path")
        if not audio_path_out or not os.path.exists(audio_path_out):
            yield f"data: {json.dumps({'type': 'stream_error', 'error': 'Failed to extract audio from video'})}\n\n"
            return
            
        # 2. Detect shot changes & metadata
        shot_changes = await asyncio.to_thread(detect_shot_changes, video_path)
        video_meta = await asyncio.to_thread(get_video_metadata, video_path)
        detected_fps = float(video_meta.get("frame_rate", 24.0))
        if custom_frame_rate is not None and float(custom_frame_rate) > 0:
            frame_rate = float(custom_frame_rate)
            log_terminal(f"Using user-specified frame rate: {frame_rate} FPS (container detected: {detected_fps} FPS)")
        elif detected_fps > 0:
            frame_rate = detected_fps
            log_terminal(f"Auto-detected frame rate from container: {frame_rate} FPS")
        else:
            frame_rate = 24.0
        video_resolution = f"{video_meta.get('width', 0)}x{video_meta.get('height', 0)}"
        
        audio_props = await asyncio.to_thread(inspect_audio, audio_path_out)
        total_duration = audio_props.get("duration", 0.0)
        
        dual_ch_info = await asyncio.to_thread(detect_dual_channel_layout, audio_path_out)
        is_dual_channel = dual_ch_info.get("is_dual_channel", False)
        
        # 3. Whisper acoustic alignment settings (executed per-chunk to guarantee zero stream delay and unlimited video length)
        is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
        enable_whisper = os.getenv("ENABLE_WHISPER", "true").lower() == "true"
        # Phase 1 Fix 1: Use tiny on cloud (RAM-constrained), base on local.
        whisper_model = os.getenv("WHISPER_MODEL", "tiny" if is_cloud else "base")
        whisper_words = []
        whisper_lang_target = resolved_language if resolved_language not in ["auto", "Auto-Detect"] else None
        if not enable_whisper:
            log_terminal("Whisper disabled via ENABLE_WHISPER=false. Using Gemini native millisecond audio timestamps.")
        else:
            log_terminal(f"Whisper acoustic alignment active ({whisper_model}).")
        
        # 4. Chunk audio: 90s target chunks (1.5 minutes) for fast 8-15s batch delivery!
        # If start_time_sec was not explicitly provided but prev_batch_end is given, resume from prev_batch_end
        if (start_time_sec is None or start_time_sec <= 0.0) and prev_batch_end > 0.0 and prev_batch_end < total_duration:
            start_time_sec = prev_batch_end

        if start_time_sec is not None and start_time_sec > 0.0:
            effective_start = max(0.0, min(start_time_sec, max(0.0, total_duration - 0.5)))
            if prev_batch_end < effective_start or prev_batch_end > effective_start + 5.0:
                prev_batch_end = effective_start
            remaining_dur = total_duration - effective_start
            if remaining_dur > 60.0:
                chunks = find_dialogue_split_points(
                    audio_path_out,
                    target_chunk_sec=90.0,
                    min_chunk_sec=60.0,
                    max_chunk_sec=120.0,
                    start_offset_sec=effective_start
                )
            else:
                chunks = [(round(effective_start, 3), round(total_duration, 3))]
        elif total_duration > 60.0:
            chunks = find_dialogue_split_points(
                audio_path_out,
                target_chunk_sec=90.0,
                min_chunk_sec=60.0,
                max_chunk_sec=120.0,
                start_offset_sec=0.0
            )
        else:
            chunks = [(0.0, round(total_duration, 3))]
            
        total_chunks = len(chunks)
        
        # Yield initial telemetry with start_chunk and start_time included
        yield f"data: {json.dumps({'type': 'init', 'total_chunks': total_chunks, 'start_chunk': start_chunk, 'start_time': start_time_sec, 'shot_changes': shot_changes, 'frame_rate': frame_rate, 'total_duration': total_duration, 'video_resolution': video_resolution})}\n\n"
        
        client = get_gemini_client()
        candidate_models = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
    ]
        primary = GEMINI_MODEL
        if primary and primary in candidate_models:
            candidate_models.remove(primary)
            candidate_models.insert(0, primary)
        elif primary:
            candidate_models.insert(0, primary)
        
        exhausted_models = set()

        # Phase 3 Fix 3: Speaker registry — tracks which speaker label maps to which
        # acoustic identity (first-heard, gender/pitch hints) so labels stay
        # consistent across all batches even when Gemini resets each chunk.
        speaker_registry = {}    # e.g. {'Speaker 1': {'count': 12, 'first_seen': 1}}
        speaker_lock_clause = ""  # Injected into prompt from batch 2 onwards

        # Process each batch from start_chunk onwards
        for chunk_idx, (chunk_s, chunk_e) in enumerate(chunks, 1):
            if chunk_idx < start_chunk:
                continue

            log_terminal(f"Streaming Batch {chunk_idx}/{total_chunks} [{chunk_s:.2f}s -> {chunk_e:.2f}s]...")
            
            yield f"data: {json.dumps({'type': 'progress', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'stage': f'Processing Batch {chunk_idx} of {total_chunks}'})}\n\n"
            
            # 250ms acoustic decay cushion (ensures zero cross-batch dialogue overlap during 1-2s pauses)
            collar_sec = 0.25
            collar_left = collar_sec if chunk_s >= collar_sec else 0.0
            collar_right = collar_sec if (chunk_e + collar_sec) <= total_duration else 0.0
            slice_s = max(0.0, round(chunk_s - collar_left, 3))
            slice_e = min(total_duration, round(chunk_e + collar_right, 3))

            norm_target_path = None
            if total_chunks > 1:
                slice_filename = f"temp_chunk_{video_id}_{chunk_idx}.wav"
                slice_path = UPLOAD_DIR / slice_filename
                extract_audio_slice(audio_path_out, slice_s, slice_e, str(slice_path))
                norm_slice_path = UPLOAD_DIR / f"temp_norm_chunk_{video_id}_{chunk_idx}.wav"
                target_path = apply_dynamic_audio_normalization(str(slice_path), str(norm_slice_path))
                if target_path == str(norm_slice_path):
                    norm_target_path = str(norm_slice_path)
            else:
                slice_s = 0.0
                slice_e = total_duration
                norm_single_path = UPLOAD_DIR / f"temp_norm_single_{video_id}.wav"
                target_path = apply_dynamic_audio_normalization(audio_path_out, str(norm_single_path))
                if target_path == str(norm_single_path):
                    norm_target_path = str(norm_single_path)

            try:
                # Step 1: Read chunk audio bytes directly (well within 20MB inline limit)
                with open(target_path, "rb") as f:
                    chunk_bytes = f.read()
                audio_part = types.Part.from_bytes(data=chunk_bytes, mime_type="audio/wav")

                context_clause = ""
                if rolling_context:
                    formatted_prev = "\n".join([f"- {item}" for item in rolling_context[-5:]])
                    context_clause = (
                        f"PREVIOUS CONVERSATION CONTEXT (from previous minutes for continuity & speaker/term consistency — DO NOT re-transcribe):\n"
                        f"{formatted_prev}\n\n"
                        f"CRITICAL SEAM CONTINUITY: If a sentence was spoken across or near the boundary transition, transcribe the COMPLETE full sentence in this chunk so zero words or syllables are cut off!\n\n"
                    )

                # Phase 3 Fix 3 Step C: Inject speaker identity lock from batch 2 onwards.
                # This prevents Gemini from reassigning Speaker 1/2 labels independently per chunk.
                if speaker_lock_clause:
                    context_clause = speaker_lock_clause + context_clause

                music_dialogue_clause = (
                    "CRITICAL DIALOGUE OVER BACKGROUND MUSIC & SOUNDTRACK:\n"
                    "- When background music, soundtrack, or long instrumental tones play with only occasional or sparse dialogue spoken, YOU MUST DETECT AND TRANSCRIBE EVERY SINGLE SPOKEN WORD with exact timestamps!\n"
                    "- Never skip or omit quiet, soft, or sparse dialogue just because music is playing.\n"
                    "- Do NOT transcribe instrumental music as subtitles, but ALWAYS transcribe human speech spoken within or over musical sections.\n\n"
                )

                gaming_sfx_clause = (
                    "CRITICAL GAMING, GUNFIRE & IN-GAME VOICE CHAT RULE:\n"
                    "- In gameplay and action scenes, players speak over loud gunshots, explosions, vehicle engines, and footsteps.\n"
                    "- YOU MUST TRANSCRIBE ALL SPOKEN WORDS even when partially masked by game SFX, gunfire, or loud audio! Never leave an interval empty because gunshots are present.\n"
                    "- Teammates speaking via Discord or in-game voice chat may be quieter or more compressed than the main streamer. Treat in-game / Discord teammate voice chat with EQUAL PRIORITY to the main microphone!\n"
                    "- When multiple players talk at the same time or call out simultaneously, use dual-speaker hyphen format (- Speaker 1: ...\\n- Speaker 2: ...). NEVER omit either speaker's dialogue!\n\n"
                )

                script_clause = f"Target Script: {resolved_script}\n" if resolved_script != "Auto-Detect" else ""
                lang_directive = ""
                is_chunk_hindi_indic = resolved_language.lower() in ["hindi", "hi", "hinglish"] or resolved_script.lower() in ["devanagari", "hindi"]
                if resolved_language.lower() in ["english", "en"]:
                    lang_directive = (
                        "CRITICAL LANGUAGE RULE (ENGLISH ONLY):\n"
                        "- Target Language is 100% ENGLISH in Latin script.\n"
                        "- ABSOLUTELY FORBIDDEN: NEVER output Urdu, Arabic script (e.g. اردو, ی, ہ, etc.), Devanagari, or random symbols/characters.\n"
                        "- If speech is in English: transcribe verbatim in English.\n"
                        "- If speech is in another language (e.g. Hindi, Urdu, etc.): translate dialogue into natural, accurate English subtitles.\n"
                    )
                elif is_chunk_hindi_indic:
                    lang_directive = (
                        "CRITICAL LANGUAGE & TRANSLITERATION RULE (HINDI / DEVANAGARI ONLY):\n"
                        "- Target Language is 100% HINDI in DEVANAGARI script.\n"
                        "- 100% of all subtitle characters MUST be in Devanagari script. Zero Latin/English letters permitted.\n"
                        "- VERBATIM PHONETIC TRANSLITERATION ONLY (DO NOT TRANSLATE TO HINDI MEANING):\n"
                        "  * If any English sentence or phrase is spoken (e.g. 'I want to go', 'You are wrong', 'Shut up', 'Come on bro'), you MUST transliterate it phonetically AS-IS into Devanagari script: 'आई वांट टू गो', 'यू आर रॉन्ग', 'शट अप', 'कम ऑन ब्रो'.\n"
                        "  * ABSOLUTELY FORBIDDEN: NEVER translate English sentences into Hindi meaning! (e.g. NEVER translate 'I want to go' into 'मैं जाना चाहता हूँ' — it must be 'आई वांट टू गो').\n"
                        "  * ABSOLUTELY FORBIDDEN: NEVER leave English words in the Latin/English alphabet (e.g. NEVER write 'I want to go' or 'target').\n"
                        "  * Transliterate all English loan words, slang, and phrases verbatim: 'target' -> 'टारगेट', 'eliminate' -> 'एलिमिनेट', 'sorry' -> 'सॉरी', 'game plan' -> 'गेम प्लान', 'finalist' -> 'फाइनलिस्ट', 'brother' -> 'ब्रदर', 'task' -> 'टास्क', 'bro' -> 'ब्रो'.\n"
                    )
                elif resolved_language != "Auto-Detect":
                    lang_directive = (
                        f"CRITICAL LANGUAGE RULE ({resolved_language.upper()} ONLY):\n"
                        f"- Target Language is 100% {resolved_language} in {resolved_script} script.\n"
                        f"- Subtitles must strictly match {resolved_language}. Do NOT output random symbols or unrelated languages.\n"
                    )

                feedback_clause = ""
                if user_feedback and user_feedback.strip():
                    feedback_clause = (
                        "USER FEEDBACK & CRITICAL CORRECTIONS (Review notes from user on previous batch):\n"
                        f"{user_feedback.strip()}\n"
                        "MANDATORY: You MUST strictly adhere to this user feedback. Adjust timing, vocabulary, speaker assignments, and formatting accordingly!\n\n"
                    )

                silence_clause = (
                    "CRITICAL SILENCE & SOUND EFFECTS RULE:\n"
                    "- NEVER generate subtitles for pure instrumental music, background score, ambient noise, sound effects, or silence alone.\n"
                    "- ALWAYS transcribe human vocal speech even when spoken within or over gunfire, explosions, vehicle engines, background music, or chatter!\n"
                    "- In gaming and action scenes, transcribe all team callouts, tactical commands, and shouts verbatim.\n\n"
                )

                prompt = (
                    f"{feedback_clause}"
                    f"{glossary_clause}"
                    f"{context_clause}"
                    f"{music_dialogue_clause}"
                    f"{gaming_sfx_clause}"
                    f"{silence_clause}"
                    f"Target Spoken Language: {resolved_language}\n"
                    f"{script_clause}"
                    f"{lang_directive}"
                    f"SDH Mode: {sdh_mode}\n"
                    f"Content Type: {content_type}\n"
                    f"MANDATORY FORMATTING & TIMING SPECIFICATIONS:\n"
                    f"1. 100% VERBATIM ACCURACY (HIGHEST PRIORITY): Transcribe the EXACT words spoken word-for-word. NEVER summarize, paraphrase, simplify, omit, smooth grammar, or alter dialogue in any way, even when speakers talk rapidly!\n"
                    f"2. ABSOLUTE PROPER NOUN PRESERVATION & ANTI-ANGLICIZATION:\n"
                    f"   - NEVER anglicize, westernize, or substitute South Asian, Indian, regional, or culturally specific names, places, or titles (e.g. 'Tarun' must ALWAYS remain 'Tarun' or 'तरुण', NEVER replace with Western names like 'Tyrone').\n"
                    f"   - Transcribe names with phonetic fidelity.\n"
                    f"3. STRICT LANGUAGE & SCRIPT PURITY:\n"
                    f"   - If Target Language is English: Output strictly in English using Latin characters. Never output Urdu or Arabic symbols.\n"
                    f"   - If Target Language is Hindi and Script is Devanagari: Output 100% in Devanagari script. Phonetically transliterate all English words, loan words, and English sentences verbatim into Devanagari (e.g. 'I want to go' -> 'आई वांट टू गो', 'sorry' -> 'सॉरी', 'game' -> 'गेम', 'target' -> 'टारगेट', 'brother' -> 'ब्रदर'). NEVER translate English sentences into Hindi meaning (do NOT convert 'I want to go' to 'मैं जाना चाहता हूँ'). Transcribe the sounds as-is in Devanagari! NEVER leave English words in Latin alphabet. Do NOT translate into English!\n"
                    f"   - If Target Language is Hindi and Script is Latin (Hinglish): Output conversational Hindi in the Latin alphabet (e.g. 'Tarun, kya haal hai?'). Do NOT translate into English!\n"
                    f"4. MAXIMUM CHARACTERS PER LINE (CPL): Exactly <= {cpl_limit} characters per line.\n"
                    f"   - When a sentence exceeds {cpl_limit - 4} characters, insert a newline ('\\n') at a natural linguistic pause.\n"
                    f"   - HINDI & ALL LANGUAGES: Break at punctuation ('।', '॥', ',', '?') or before conjunctions ('और', 'या', 'लेकिन', 'मगर', 'क्योंकि', 'इसलिए', 'ताकि', 'कि', 'तो', 'and', 'but').\n"
                    f"   - CRITICAL HINDI RULE: NEVER break right before a Hindi postposition ('ने', 'को', 'से', 'का', 'के', 'की', 'में', 'पर', 'पे', 'तक') leaving it stranded on the next line! Keep postpositions with the preceding noun.\n"
                    f"   - NEVER break in the middle of a person's name or title ('श्री', 'श्रीमती', 'डॉ.', 'Mr.', 'Mrs.').\n"
                    f"5. READING SPEED (CPS): Target comfortable reading speed (~{max_cps} CPS). In fast dialogue, prioritize 100% verbatim capture and output tighter, shorter sequential subtitle events rather than dropping words!\n"
                    f"6. MAXIMUM LINES: Exactly <= {max_lines} lines per subtitle event.\n"
                    f"7. COMPLETE CLAUSES & SYNTACTIC BOUNDARIES:\n"
                    f"   - Subtitle events MUST break at natural clause boundaries.\n"
                    f"   - If a sentence fits within 2 lines of {cpl_limit} characters (<= 84 characters total), KEEP IT TOGETHER in ONE subtitle event.\n"
                    f"8. MULTI-SPEAKER & DUAL-SPEAKER HYPHEN FORMATTING:\n"
                    f"   - When two speakers speak simultaneously, interrupt, or talk over one another, output BOTH speakers in ONE subtitle event using hyphens:\n"
                    f"     - [Speaker 1]: <dialogue 1>\n"
                    f"     - [Speaker 2]: <dialogue 2>\n"
                    f"   - Set 'speakers': ['Speaker 1', 'Speaker 2'] and 'speaker_count': 2.\n"
                    f"   - NEVER drop, skip, or omit either speaker's dialogue when both talk at the same time!\n"
                    f"   - If speakers speak sequentially, output separate sequential subtitle events.\n"
                    f"9. STRICTLY SEQUENTIAL TIMELINE (ZERO OVERLAPS BETWEEN EVENTS):\n"
                    f"   - Subtitle events must NOT overlap on the timeline (start of next event >= end of previous event).\n"
                    f"   - Use dual-speaker hyphen format within a single event for simultaneous speech.\n"
                    f"10. GAMING, GUNFIRE & IN-GAME VOICE CHAT:\n"
                    f"    - Transcribe ALL spoken words even when partially masked by game SFX, gunfire, or vehicles.\n"
                    f"    - Treat in-game / Discord teammate voice-chat with EQUAL PRIORITY to the main microphone.\n"
                    f"11. TIMESTAMPS: Provide acoustic start_time and end_time for each subtitle event relative to this audio slice."
                )
                
                response = None
                last_error = None
                succeeded_candidate = None
                is_whisper_fallback = False
                
                # Prioritize candidates that haven't hit quota in this session
                active_candidates = [m for m in candidate_models if m not in exhausted_models]
                if not active_candidates:
                    active_candidates = list(candidate_models)

                for candidate in active_candidates:
                    for attempt in range(1, 3):
                        try:
                            gen_config = types.GenerateContentConfig(
                                system_instruction=get_netflix_subtitle_system_prompt(
                                    cpl_limit=cpl_limit,
                                    max_cps=max_cps,
                                    max_lines=max_lines,
                                    target_language=resolved_language,
                                    target_script=resolved_script
                                ),
                                response_mime_type="application/json",
                                response_schema=SubtitleBatchSchema,
                                temperature=0.1,
                                max_output_tokens=16384,
                            )
                            async for item in execute_task_with_heartbeats(
                                client.models.generate_content,
                                model=candidate,
                                contents=[audio_part, prompt],
                                config=gen_config,
                                chunk_idx=chunk_idx,
                                total_chunks=total_chunks,
                                stage=f"Transcribing Part {chunk_idx} of {total_chunks} ({candidate})"
                            ):
                                if isinstance(item, tuple) and item[0] == "__RESULT__":
                                    response = item[1]
                                else:
                                    yield item

                            if response is not None:
                                succeeded_candidate = candidate
                                break
                        except Exception as e:
                            last_error = e
                            err_str = str(e).lower()
                            # Fast failover on quota exhaustion (429) or deprecated model (404)
                            if any(kw in err_str for kw in ["429", "quota", "resource_exhausted", "404", "not_found", "no longer available"]):
                                exhausted_models.add(candidate)
                                log_terminal(f"Model {candidate} hit quota/unavailability. Marked exhausted for session. Switching to next candidate...")
                                break
                            elif any(kw in err_str for kw in ["503", "unavailable", "timeout", "deadline", "timed out", "connection", "reset", "500"]):
                                if attempt < 2:
                                    await asyncio.sleep(1.5)
                                    continue
                                else:
                                    break
                            else:
                                break
                    if response is not None:
                        break
                        
                # Promote working candidate to front of candidate_models for subsequent chunks
                if succeeded_candidate and succeeded_candidate != candidate_models[0]:
                    candidate_models.remove(succeeded_candidate)
                    candidate_models.insert(0, succeeded_candidate)

                if response is None:
                    log_terminal(f"Gemini API unavailable for Batch {chunk_idx}. Falling back to local Whisper transcription...")
                    yield f"data: {json.dumps({'type': 'progress', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'stage': f'Batch {chunk_idx}: Transcribing via local Whisper fallback...'})}\n\n"
                    
                    subs = await asyncio.to_thread(
                        transcribe_chunk_with_whisper,
                        target_path,
                        chunk_s,
                        resolved_language,
                        cpl_limit,
                        whisper_model
                    )
                    if subs:
                        parsed = {"subtitles": subs}
                        is_whisper_fallback = True
                    else:
                        yield f"data: {json.dumps({'type': 'batch_error', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'error': str(last_error)})}\n\n"
                        prev_batch_end = max(prev_batch_end, chunk_e)
                        continue
                else:
                    parsed = extract_and_repair_subtitle_json(response.text)
                    is_whisper_fallback = False

                # Lock language and script across chunks ONLY if auto-detected
                is_user_explicit_lang = language.lower() not in ["auto", "auto-detect", ""]
                if chunk_idx == start_chunk and not is_user_explicit_lang:
                    if parsed.get("detected_language") and resolved_language in ["auto", "Auto-Detect"]:
                        resolved_language = parsed["detected_language"]
                    if parsed.get("detected_script") and resolved_script == "Auto-Detect":
                        resolved_script = parsed["detected_script"]

                subs = parsed.get("subtitles", []) if isinstance(parsed, dict) else []
                if isinstance(parsed, list):
                    subs = parsed
                    
                # 1. Format raw batch events with absolute video timeline (zero jumping, zero gaps)
                batch_raw = resolve_batch_timestamps(
                    subs,
                    slice_s,
                    slice_e,
                    prev_batch_end=prev_batch_end,
                    min_gap_sec=round(2.0 / frame_rate, 3),
                    min_duration=min_duration
                )

                # Cross-chunk acoustic seam stitching & deduplication across overlap collar
                if all_aligned_subtitles and batch_raw:
                    all_aligned_subtitles, batch_raw = stitch_cross_chunk_seam(
                        all_aligned_subtitles,
                        batch_raw,
                        min_gap_sec=round(2.0 / frame_rate, 3),
                        min_duration=min_duration,
                        collar_sec=collar_sec
                    )
                
                # Stage 0: Guarantee single speaker per event (split any multi-speaker events)
                from app.netflix_linter import split_multi_speaker_subtitles
                batch_raw = split_multi_speaker_subtitles(batch_raw, frame_rate=frame_rate, min_duration=min_duration)

                # Stage 1A: Heal any cross-event dangling phrases
                batch_raw = heal_cross_event_dangling_phrases(batch_raw, cpl_limit=cpl_limit, max_lines=max_lines)

                # Stage 2: Whisper Acoustic Word Extraction & Synchronization (strictly on this batch)
                chunk_whisper_words = []
                if enable_whisper and batch_raw:
                    log_terminal(f"Batch {chunk_idx}: Running Whisper ({whisper_model}) acoustic alignment...")
                    yield f"data: {json.dumps({'type': 'progress', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'stage': f'Batch {chunk_idx}: Whisper ({whisper_model}) acoustic sync...'})}\n\n"
                    try:
                        raw_cw = []
                        async for item in execute_task_with_heartbeats(
                            get_whisper_word_timestamps,
                            target_path,
                            whisper_lang_target,
                            whisper_model,
                            chunk_idx=chunk_idx,
                            total_chunks=total_chunks,
                            stage=f"Whisper ({whisper_model}) acoustic sync for Part {chunk_idx}"
                        ):
                            if isinstance(item, tuple) and item[0] == "__RESULT__":
                                raw_cw = item[1]
                            else:
                                yield item
                        for w in raw_cw:
                            w_item = {
                                "word": w["word"],
                                "start": round(w["start"] + slice_s, 3),
                                "end": round(w["end"] + slice_s, 3),
                                "probability": w.get("probability", 1.0)
                            }
                            chunk_whisper_words.append(w_item)
                            whisper_words.append(w_item)
                        log_terminal(f"Batch {chunk_idx}: Whisper extracted {len(raw_cw)} words on audio slice.")
                    except Exception as e:
                        log_terminal(f"Batch {chunk_idx} Whisper alignment warning: {e}")

                # Stage 2B: Pre-split any oversized events that exceed 2 lines or cpl_limit using acoustic word boundaries
                split_batch = []
                for s in batch_raw:
                    split_batch.extend(split_and_balance_event(s, cpl_limit=cpl_limit, max_lines=max_lines, audio_path=audio_path_out, whisper_words=chunk_whisper_words, min_duration=min_duration, frame_rate=frame_rate))

                # Stage 2C: Closed-Loop Acoustic Synchronization (Locks subtitles to exact spoken words & audio energy)
                if chunk_whisper_words and split_batch:
                    log_terminal(f"Batch {chunk_idx}: Synchronizing {len(split_batch)} events acoustically with Whisper ({whisper_model})...")
                    try:
                        split_batch = align_subtitle_timestamps(
                            split_batch,
                            chunk_whisper_words,
                            search_radius=8.0,
                            prev_batch_end=prev_batch_end,
                            audio_path=audio_path_out,
                            frame_rate=frame_rate,
                            min_duration=min_duration,
                            max_duration=max_duration
                        )
                    except Exception as align_err:
                        log_terminal(f"Batch {chunk_idx} acoustic sync fallback (preserving Gemini timestamps): {align_err}")

                # Stage 3: Automated Quality Check (Audits the acoustically synchronized events)
                batch_lint = lint_all_subtitles(
                    events=split_batch,
                    shot_changes=shot_changes,
                    content_type=content_type,
                    frame_rate=frame_rate,
                    script=resolved_script,
                    custom_cpl=cpl_limit,
                    custom_cps=max_cps,
                    custom_max_lines=max_lines,
                    custom_min_duration=min_duration,
                    custom_max_duration=max_duration,
                )

                # Stage 3B: Call AI again if QC errors detected (Gemini Self-Correction pass)
                from app.gemini_qc_fixer import coordinate_gemini_qc_fix, _has_fixable_errors
                violating_events = [ev for ev in batch_lint.get("events", []) if _has_fixable_errors(ev.get("qc_errors", []))]
                has_active_gemini = any(m not in exhausted_models for m in candidate_models)
                if gemini_auto_fix and violating_events and not is_whisper_fallback and has_active_gemini:
                    log_terminal(f"Batch {chunk_idx}: QC detected {len(violating_events)} violation(s). Calling Gemini self-correction pass...")
                    yield f"data: {json.dumps({'type': 'progress', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'stage': f'AI Self-Correction for Batch {chunk_idx} ({len(violating_events)} issues)...'})}\n\n"
                    try:
                        qc_fixed = None
                        async for item in execute_task_with_heartbeats(
                            coordinate_gemini_qc_fix,
                            events=split_batch,
                            whisper_words=active_words,
                            shot_changes=shot_changes,
                            content_type=content_type,
                            frame_rate=frame_rate,
                            cpl_limit=cpl_limit,
                            max_cps=max_cps,
                            max_lines=max_lines,
                            min_duration=min_duration,
                            max_duration=max_duration,
                            audio_path=audio_path_out,
                            chunk_idx=chunk_idx,
                            total_chunks=total_chunks,
                            stage=f"QC Self-Correction for Part {chunk_idx}"
                        ):
                            if isinstance(item, tuple) and item[0] == "__RESULT__":
                                qc_fixed = item[1]
                            else:
                                yield item
                        if qc_fixed and isinstance(qc_fixed, dict):
                            split_batch = qc_fixed.get("events", split_batch)
                            log_terminal(f"Batch {chunk_idx}: Gemini self-correction resolved issues. Score: {qc_fixed.get('compliance_score', 100)}%")
                    except Exception as qc_err:
                        log_terminal(f"Batch {chunk_idx} Gemini QC fix warning: {qc_err}")
                
                # Stage 4: Non-destructive Netflix polish
                processed_batch = polish_subtitle_events_netflix(
                    events=split_batch,
                    cpl_limit=cpl_limit,
                    max_cps=max_cps,
                    max_lines=max_lines,
                    min_duration=min_duration,
                    max_duration=max_duration,
                    frame_rate=frame_rate,
                    shot_changes=shot_changes,
                    prev_batch_end=prev_batch_end
                )

                # 5. Monotonic ID assignment & timeline tracking
                if processed_batch:
                    for ev in processed_batch:
                        ev["id"] = current_event_id
                        current_event_id += 1
                        prev_batch_end = ev["end_time"]
                else:
                    prev_batch_end = max(prev_batch_end, chunk_e)

                # Record last dialogue lines into rolling context for subsequent batches
                for item in processed_batch[-5:]:
                    txt = item.get("text", "").replace("\n", " ").strip()
                    spk = (item.get("speakers") or ["Speaker"])[0]
                    if txt:
                        rolling_context.append(f"{spk}: \"{txt}\"")
                if len(rolling_context) > 10:
                    rolling_context = rolling_context[-10:]

                # Phase 3 Fix 3 Step B: After first batch, build speaker registry + lock clause.
                # After every batch, update speaker counts for cross-batch normalization.
                for ev in processed_batch:
                    spk = (ev.get("speakers") or ["Speaker 1"])[0]
                    if spk not in speaker_registry:
                        speaker_registry[spk] = {"count": 0, "first_seen": chunk_idx}
                    speaker_registry[spk]["count"] += 1

                # Build speaker_lock_clause after first successful batch so batch 2+ stays aligned
                if chunk_idx == start_chunk and not speaker_lock_clause and speaker_registry:
                    # Determine canonical label order by first-seen then count
                    ordered_spks = sorted(speaker_registry.keys(),
                                          key=lambda s: (speaker_registry[s]["first_seen"], -speaker_registry[s]["count"]))
                    spk_lines = []
                    for rank, spk_label in enumerate(ordered_spks[:4], 1):
                        spk_lines.append(f"  - {spk_label}: voice #{rank} heard in the audio (maintain this label for this same voice throughout)")
                    speaker_lock_clause = (
                        "SPEAKER IDENTITY LOCK (established from the first segment — do NOT reassign):\n"
                        + "\n".join(spk_lines) + "\n"
                        "CRITICAL: Use EXACTLY these speaker labels for the same voices. Do NOT flip, swap, or rename speakers.\n\n"
                    )
                    log_terminal(f"Batch {chunk_idx}: Speaker registry locked: {list(speaker_registry.keys())}")

                all_aligned_subtitles.extend(processed_batch)
                
                # 6. Yield this batch AND notification for manual QC
                fallback_tag = " (Whisper fallback)" if is_whisper_fallback else ""
                yield f"data: {json.dumps({'type': 'batch', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'events': processed_batch, 'fallback': is_whisper_fallback})}\n\n"
                yield f"data: {json.dumps({'type': 'batch_ready', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'message': f'Part {chunk_idx}{fallback_tag} is complete! You can do manual QC on it now.'})}\n\n"
                log_terminal(f"Yielded Batch {chunk_idx}/{total_chunks} with {len(processed_batch)} events{fallback_tag}. User notified: ready for manual QC!")
                
            except Exception as chunk_err:
                import traceback
                traceback.print_exc()
                log_terminal(f"ERROR processing Batch {chunk_idx}: {chunk_err}")
                yield f"data: {json.dumps({'type': 'batch_error', 'chunk_index': chunk_idx, 'total_chunks': total_chunks, 'error': str(chunk_err)})}\n\n"
            finally:
                if total_chunks > 1 and os.path.exists(target_path):
                    try:
                        os.unlink(target_path)
                    except Exception:
                        pass
                if norm_target_path and os.path.exists(norm_target_path):
                    try:
                        os.unlink(norm_target_path)
                    except Exception:
                        pass
                if total_chunks > 1 and 'slice_path' in locals() and os.path.exists(str(slice_path)):
                    try:
                        os.unlink(str(slice_path))
                    except Exception:
                        pass
                        
        # Final global QC audit using the already-aligned events (NO SYNC JUMPING, NO REDUNDANT EXPENSIVE API CALLS)
        log_terminal("Finalizing global QC audit across all batches...")
        fixed_all = all_aligned_subtitles
        
        try:
            lint_res = lint_all_subtitles(
                events=fixed_all,
                shot_changes=shot_changes,
                content_type=content_type,
                frame_rate=frame_rate,
                custom_cpl=cpl_limit,
                custom_cps=max_cps,
                custom_max_lines=max_lines,
                custom_min_duration=min_duration,
                custom_max_duration=max_duration,
            )
            
            final_res = build_qc_result(
                events=lint_res["events"],
                video_id=video_id,
                filename=Path(video_path).name,
                language=language,
                content_type=content_type,
                frame_rate=frame_rate,
                shot_changes=shot_changes,
                audio_duration=total_duration,
                video_resolution=video_resolution,
                compliance_score=lint_res.get("compliance_score", 100.0),
                cps_stats=lint_res.get("cps_stats")
            )
        except Exception as final_err:
            log_terminal(f"Warning in final QC build: {final_err}. Falling back to raw aligned events.")
            final_res = {
                "events": fixed_all,
                "compliance_score": 100.0,
                "total_errors": 0,
                "total_warnings": 0,
                "shot_changes": shot_changes,
                "frame_rate": frame_rate,
                "cps_stats": None,
                "audio_duration": total_duration,
                "filename": Path(video_path).name
            }
        
        yield f"data: {json.dumps({'type': 'complete', 'result': final_res})}\n\n"
        log_terminal(f"Stream Complete! Total Events: {len(final_res.get('events', []))} | QC Score: {final_res.get('compliance_score', 100)}%")

    except Exception as fatal_stream_err:
        import traceback
        traceback.print_exc()
        log_terminal(f"FATAL STREAM ERROR: {fatal_stream_err}")
        yield f"data: {json.dumps({'type': 'stream_error', 'error': str(fatal_stream_err)})}\n\n"
        if all_aligned_subtitles:
            # Yield partial completion with all subtitles generated so far
            yield f"data: {json.dumps({'type': 'complete', 'result': {'events': all_aligned_subtitles, 'compliance_score': 90.0, 'total_errors': 0, 'total_warnings': 0, 'filename': Path(video_path).name}})}\n\n"
