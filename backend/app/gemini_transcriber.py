import os
import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types

from app.config import GEMINI_API_KEY, GEMINI_MODEL, DEFAULT_LANGUAGE, DEFAULT_SCRIPT, MAX_SEGMENT_DURATION, MIN_SEGMENT_DURATION, UPLOAD_DIR
from app.models import Segment, TranscriptionResult, AudioAnalysis, WordConfidence
from app.linter_engine import lint_dataset
from app.audio_processor import (
    format_timestamp, detect_speech_boundaries, inspect_audio,
    snap_to_acoustic_boundaries, find_dialogue_split_points, extract_audio_slice,
    detect_dual_channel_layout, extract_physical_speech_intervals,
    resolve_segment_speaker_from_channels
)

SYSTEM_INSTRUCTION = """You are an expert conversational speech transcriptionist and acoustic annotator adhering strictly to the official Karya Verbatim Transcription & Segmentation Guidelines.

Your task is to transcribe and segment the provided audio conversation with 100% precision.

### CRITICAL RULES:
1. TWO PRIMARY SPEAKERS:
   - Speaker 1: The person who starts speaking first in the conversation.
   - Speaker 2: The second conversational participant.
   - Maintain these exact speaker labels consistently throughout the entire recording.
   - Gender: Must be "Male", "Female", or "Unknown".

2. FULL VERBATIM TRANSCRIPTION (NO GRAMMAR CORRECTION):
   - Type EXACTLY what is spoken. Never correct grammar, rewrite, beautify, or skip words.
   - Retain all slang, colloquialisms, repetitions (e.g. 'मैंने मैंने मैंने'), false starts, and self-corrections (e.g. 'मैं उम मुझे लगा').
   - Include all natural fillers (e.g. 'उम', 'उह', 'अह', 'ए...', 'uh', 'um').
   - Include stutters with hyphens (e.g. 'म-म-मैं', 'क-क-कल', 'w-w-what').
   - Spelled-out acronyms/letters must be space-separated (e.g. 'एस बी आई', 'एच डी एफ सी', 'S B I').
   - Incomplete / trailed-off sentences MUST end with double hyphen '--' (e.g. 'पर फिर --').

3. ABSOLUTELY NO CODE-MIXED SCRIPTS:
   - All foreign/English words spoken must be TRANSLITERATED into the target script (e.g., if target script is Devanagari/Hindi, write 'मीटिंग', 'ऑफिस', 'लेट' - NEVER 'meeting', 'office', 'late').

4. NUMBERS IN WORDS (NEVER DIGITS):
   - NEVER use digits (0-9 or Indic digits).
   - Write numbers as full spoken words (e.g. 'तीन', 'पच्चीस', 'एक सौ', 'twenty five').
   - Never use symbols like % or &; write 'प्रतिशत' / 'और' / 'percent' / 'and'.

5. ALLOWED PUNCTUATION ONLY:
   - ONLY these characters are allowed: . , ? ! - _ ' ।
   - Do NOT use semicolons, colons, quotes, parentheses, brackets, percentage, ampersand, etc.

6. SPECIAL TAGS:
   - Use [unintelligible] if speech is audible but words cannot be understood due to accent/slurring.
   - Use [inaudible] if speech cannot be heard due to low volume, noise, or clipping.

7. 100% ACCURATE ACOUSTIC ONSET & OFFSET SEGMENTATION:
   - Segment start_time must match the exact millisecond when the first audible phoneme begins.
   - Segment end_time must match the exact millisecond when the last audible phoneme finishes.
   - Segments must NEVER overlap: end_time <= next start_time.
   - Segment duration must be between 0.5s and 20.0s.

8. WORD-LEVEL CONFIDENCE SCORING:
   - For every transcribed word, assess acoustic clarity and provide a confidence score from 0.00 to 1.00 (e.g. 0.95 for clear speech, 0.65 for muffled/slurred words, 0.40 for low-confidence or ambiguous speech).
"""


def get_gemini_client(api_key: Optional[str] = None) -> genai.Client:
    """Initialize and return Google GenAI Client."""
    key = api_key or GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("GEMINI_API_KEY is not configured in .env or environment.")
    return genai.Client(api_key=key)


def transcribe_audio_with_gemini(
    audio_path: str,
    language: str = "Auto-Detect",
    script: str = "Auto-Detect",
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Uploads audio file to Gemini multimodal API and prompts for language auto-detection,
    structured segmentation, and full verbatim transcription with automatic model fallback & retry.
    """
    import time
    client = get_gemini_client(api_key)
    
    # Active high-quality candidate models in order of transcription fidelity & precision
    candidate_models = []
    if model_name:
        candidate_models.append(model_name)
    if GEMINI_MODEL and GEMINI_MODEL not in candidate_models:
        candidate_models.append(GEMINI_MODEL)
    for high_quality_model in ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-2.5-flash"]:
        if high_quality_model not in candidate_models:
            candidate_models.append(high_quality_model)

    audio_file_path = Path(audio_path)
    
    # Determine mime type
    suffix = audio_file_path.suffix.lower()
    mime_type = "audio/wav"
    if suffix == ".mp3":
        mime_type = "audio/mp3"
    elif suffix in [".m4a", ".aac"]:
        mime_type = "audio/mp4"
    elif suffix == ".ogg":
        mime_type = "audio/ogg"
    elif suffix == ".flac":
        mime_type = "audio/flac"

    uploaded_file = None
    try:
        uploaded_file = client.files.upload(
            file=str(audio_file_path),
            config=dict(mime_type=mime_type)
        )
    except Exception as upload_err:
        raise RuntimeError(f"Failed to upload audio to Gemini: {upload_err}")

    is_auto = (not language or language.lower() in ["auto", "auto-detect", "autodetect"])

    user_prompt = f"""Analyze the provided audio conversation, auto-detect the spoken language and native script, and transcribe/segment according to the Karya guidelines with 100% timestamp precision.
Target Language: {language} {"(Auto-detect the primary language spoken, e.g. Hindi, Marathi, Punjabi, Bengali, Tamil, Telugu, English, Gujarati, Kannada, etc.)" if is_auto else ""}
Target Script: {script} {"(Auto-detect the appropriate native script, e.g. Devanagari, Gurmukhi, Latin, Bengali, Tamil, Telugu, Gujarati, Kannada)" if is_auto or script.lower() in ["auto", "auto-detect"] else ""}

Return a valid JSON object matching this schema:
{{
  "detected_language": "string (e.g. Hindi, Punjabi, English, Marathi, Tamil, Bengali, Telugu, Gujarati, Kannada)",
  "detected_script": "string (e.g. Devanagari, Gurmukhi, Latin, Bengali, Tamil, Telugu, Gujarati, Kannada)",
  "segments": [
    {{
      "speaker": "Speaker 1 or Speaker 2",
      "gender": "Male or Female or Unknown",
      "start_time": 0.350,
      "end_time": 4.800,
      "confidence": 0.95,
      "transcript": "string (verbatim transcription adhering to all script, punctuation, number in words, and filler rules in detected_script)",
      "words": [
        {{"word": "string", "confidence": 0.98}}
      ]
    }}
  ]
}}
"""

    response = None
    last_error = None

    try:
        for candidate in candidate_models:
            for attempt in range(1, 5):
                try:
                    response = client.models.generate_content(
                        model=candidate,
                        contents=[uploaded_file, user_prompt],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_INSTRUCTION,
                            response_mime_type="application/json",
                            temperature=0.1,
                            max_output_tokens=65536,
                        )
                    )
                    if response is not None:
                        break
                except Exception as e:
                    last_error = e
                    err_str = str(e).lower()
                    retryable_keywords = [
                        "503", "unavailable", "high demand", "429", "quota", "resource_exhausted",
                        "timeout", "deadline", "timed out", "connection", "reset", "500", "internal"
                    ]
                    if any(kw in err_str for kw in retryable_keywords) and attempt < 4:
                        sleep_time = attempt * 3.0
                        print(f"Gemini API transient error on {candidate} (attempt {attempt}/4): {err_str[:80]}... Retrying in {sleep_time}s")
                        time.sleep(sleep_time)
                        continue
                    else:
                        print(f"Switching fallback model from {candidate} due to: {err_str[:80]}")
                        break
            if response is not None:
                break
    finally:
        # Guaranteed cleanup of uploaded file from Gemini cloud storage
        if uploaded_file:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                pass

    if response is None:
        raise RuntimeError(f"Gemini transcription failed across candidate models: {last_error}")

    resp_text = (response.text or "").strip()
    
    # Robust JSON extraction & repair
    return extract_and_repair_json(
        resp_text,
        default_lang=language if not is_auto else DEFAULT_LANGUAGE,
        default_script=script if not is_auto else DEFAULT_SCRIPT
    )


def extract_and_repair_json(
    text: str,
    default_lang: str = DEFAULT_LANGUAGE,
    default_script: str = DEFAULT_SCRIPT
) -> Dict[str, Any]:
    """
    Robustly parses JSON from Gemini multimodal responses, handling markdown code blocks,
    direct JSON, bracket closures, and partial/truncated JSON streams.
    """
    text = (text or "").strip()
    if not text:
        return {"detected_language": default_lang, "detected_script": default_script, "segments": []}

    # 1. Try standard JSON parse
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
        elif isinstance(data, list):
            return {"detected_language": default_lang, "detected_script": default_script, "segments": data}
    except Exception:
        pass

    # 2. Try markdown code block extraction
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if match:
        try:
            data = json.loads(match.group(1).strip())
            if isinstance(data, dict):
                return data
            elif isinstance(data, list):
                return {"detected_language": default_lang, "detected_script": default_script, "segments": data}
        except Exception:
            pass

    # 3. Extract detected language and script
    detected_lang = default_lang
    detected_scr = default_script
    lang_m = re.search(r'"detected_language"\s*:\s*"([^"]+)"', text, re.IGNORECASE)
    if lang_m:
        detected_lang = lang_m.group(1).strip()
    script_m = re.search(r'"detected_script"\s*:\s*"([^"]+)"', text, re.IGNORECASE)
    if script_m:
        detected_scr = script_m.group(1).strip()

    # 4. Partial JSON Recovery: Find all segment objects
    segment_objs = []
    raw_blocks = re.findall(r'\{[^{}]*"transcript"[^{}]*\}', text, re.DOTALL)
    for block in raw_blocks:
        try:
            seg_dict = json.loads(block)
            if "transcript" in seg_dict or "start_time" in seg_dict:
                segment_objs.append(seg_dict)
        except Exception:
            spk = re.search(r'"speaker"\s*:\s*"([^"]+)"', block)
            gnd = re.search(r'"gender"\s*:\s*"([^"]+)"', block)
            st = re.search(r'"start_time"\s*:\s*([\d.]+)', block)
            et = re.search(r'"end_time"\s*:\s*([\d.]+)', block)
            tr = re.search(r'"transcript"\s*:\s*"((?:\\.|[^"\\])*)"', block)
            if tr:
                segment_objs.append({
                    "speaker": spk.group(1) if spk else "Speaker 1",
                    "gender": gnd.group(1) if gnd else "Male",
                    "start_time": float(st.group(1)) if st else 0.0,
                    "end_time": float(et.group(1)) if et else 2.0,
                    "transcript": tr.group(1).encode('utf-8').decode('unicode_escape', errors='ignore')
                })

    if segment_objs:
        return {
            "detected_language": detected_lang if detected_lang != "Auto-Detect" else "Hindi",
            "detected_script": detected_scr if detected_scr != "Auto-Detect" else "Devanagari",
            "segments": segment_objs
        }

    # 5. Try closing unclosed JSON string
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

    return {
        "detected_language": detected_lang if detected_lang != "Auto-Detect" else "Hindi",
        "detected_script": detected_scr if detected_scr != "Auto-Detect" else "Devanagari",
        "segments": []
    }


def process_audio_file(
    audio_path: str,
    language: str = "Auto-Detect",
    script: str = "Auto-Detect",
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> TranscriptionResult:
    """
    Complete pipeline: Audio inspection, dialogue-aware 2-minute subtask chunking for long audio,
    Gemini transcription with language auto-detection, acoustic snapping, Karya compliance linting.
    """
    import uuid

    audio_id = str(uuid.uuid4())[:8]
    filename = Path(audio_path).name

    # Step 1: Extract audio metadata safely & physical ground-truth acoustic intervals
    audio_info_dict = inspect_audio(audio_path)
    dual_ch_info = detect_dual_channel_layout(audio_path)
    if dual_ch_info.get("is_dual_channel"):
        audio_info_dict["channels"] = 2
    audio_info = AudioAnalysis(**audio_info_dict)
    audio_info.is_rejected = False
    audio_info.rejection_category = None
    audio_info.rejection_reason = None
    total_duration = audio_info.duration

    # Extract physically measured speech bursts directly from raw PCM waveform
    physical_intervals = extract_physical_speech_intervals(audio_path)

    resolved_language = language
    resolved_script = script
    raw_chunks_segments = []

    # Step 2: Dialogue-Aware Subtask Chunking (Split into 50s chunks for tight timestamp sync)
    if total_duration > 65.0:
        chunks = find_dialogue_split_points(
            audio_path,
            target_chunk_sec=50.0,
            min_chunk_sec=35.0,
            max_chunk_sec=75.0
        )
        print(f"Dividing {total_duration:.1f}s audio into {len(chunks)} short dialogue subtask chunks...")

        for chunk_idx, (chunk_s, chunk_e) in enumerate(chunks, 1):
            slice_filename = f"temp_chunk_{audio_id}_{chunk_idx}.wav"
            slice_path = UPLOAD_DIR / slice_filename
            try:
                extract_audio_slice(audio_path, chunk_s, chunk_e, str(slice_path))
                chunk_data = transcribe_audio_with_gemini(
                    audio_path=str(slice_path),
                    language=resolved_language,
                    script=resolved_script,
                    api_key=api_key,
                    model_name=model_name
                )
                if language in ["Auto-Detect", "auto", "Auto"] and chunk_idx == 1:
                    resolved_language = chunk_data.get("detected_language", "Hindi")
                if script in ["Auto-Detect", "auto", "Auto"] and chunk_idx == 1:
                    resolved_script = chunk_data.get("detected_script", "Devanagari")

                for raw_seg in chunk_data.get("segments", []):
                    raw_chunks_segments.append({
                        "raw": raw_seg,
                        "chunk_offset": chunk_s
                    })
            finally:
                if slice_path.exists():
                    try:
                        slice_path.unlink()
                    except Exception:
                        pass
    else:
        # Single-pass transcription for short audio (<= 65s)
        try:
            data = transcribe_audio_with_gemini(
                audio_path=audio_path,
                language=language,
                script=script,
                api_key=api_key,
                model_name=model_name
            )
            if language in ["Auto-Detect", "auto", "Auto"]:
                resolved_language = data.get("detected_language", "Hindi")
            if script in ["Auto-Detect", "auto", "Auto"]:
                resolved_script = data.get("detected_script", "Devanagari")

            for raw_seg in data.get("segments", []):
                raw_chunks_segments.append({
                    "raw": raw_seg,
                    "chunk_offset": 0.0
                })
        except Exception as e:
            raise RuntimeError(f"Transcription failed: {str(e)}")

    # Step 3: Build & Calibrate Segment Objects with Monotonic Acoustic Tightening
    segments: List[Segment] = []
    prev_end = 0.0

    for i, item in enumerate(raw_chunks_segments, 1):
        raw = item["raw"]
        chunk_offset = item["chunk_offset"]

        # Shift relative chunk timestamps to absolute audio timeline
        raw_s = float(raw.get("start_time", 0.0))
        raw_e = float(raw.get("end_time", raw_s + 2.0))
        s_time = chunk_offset + raw_s
        e_time = chunk_offset + raw_e

        # Micro-collar acoustic boundary snapping (+/- 0.15s)
        try:
            s_time, e_time = snap_to_acoustic_boundaries(audio_path, s_time, e_time, collar_sec=0.15)
        except Exception:
            pass

        # Discrete 2-channel stereo speaker identification
        raw_speaker = str(raw.get("speaker", "Speaker 1")).strip()
        speaker = resolve_segment_speaker_from_channels(audio_path, s_time, e_time, default_speaker=raw_speaker)

        # Guarantee non-overlapping with natural dialogue breathing room
        if s_time < prev_end:
            s_time = round(prev_end + 0.050, 3)
        elif s_time == prev_end and i > 1:
            s_time = round(prev_end + 0.050, 3)

        if e_time <= s_time:
            e_time = round(s_time + 0.5, 3)

        s_time = round(s_time, 3)
        e_time = round(e_time, 3)
        duration = round(e_time - s_time, 3)
        prev_end = e_time

        gender = str(raw.get("gender", "Male")).capitalize()
        if gender not in ["Male", "Female", "Unknown"]:
            gender = "Unknown"

        transcript = str(raw.get("transcript", "")).strip()

        # Build word confidence data with absolute timeline offsets
        words_list: List[WordConfidence] = []
        raw_words = raw.get("words", [])
        if raw_words and isinstance(raw_words, list):
            for w in raw_words:
                if isinstance(w, dict) and "word" in w:
                    w_s = float(w["start_time"]) + chunk_offset if w.get("start_time") is not None else None
                    w_e = float(w["end_time"]) + chunk_offset if w.get("end_time") is not None else None
                    words_list.append(WordConfidence(
                        word=str(w["word"]),
                        confidence=float(w.get("confidence", 0.95)),
                        start_time=round(w_s, 3) if w_s is not None else None,
                        end_time=round(w_e, 3) if w_e is not None else None
                    ))
        if not words_list and transcript:
            tokens = transcript.split()
            seg_dur = max(0.1, duration)
            w_dur = seg_dur / max(1, len(tokens))
            seg_conf = float(raw.get("confidence", 0.95))
            for idx, tok in enumerate(tokens):
                tok_clean = tok.strip().lower()
                if "[unintelligible]" in tok_clean or "[inaudible]" in tok_clean:
                    w_conf = 0.35
                elif "-" in tok_clean and len(tok_clean) > 2:
                    w_conf = 0.70
                elif "--" in tok_clean:
                    w_conf = 0.75
                else:
                    w_conf = seg_conf
                words_list.append(WordConfidence(
                    word=tok,
                    confidence=round(w_conf, 2),
                    start_time=round(s_time + idx * w_dur, 3),
                    end_time=round(s_time + (idx + 1) * w_dur, 3)
                ))

        seg = Segment(
            segment_id=i,
            speaker=speaker,
            gender=gender,
            start_time=s_time,
            end_time=e_time,
            start_time_str=format_timestamp(s_time),
            end_time_str=format_timestamp(e_time),
            duration=duration,
            transcript=transcript,
            confidence=float(raw.get("confidence", 0.95)),
            words=words_list,
            qc_errors=[],
            is_valid=True
        )
        segments.append(seg)
        prev_end = e_time

    # Step 4: Lint against Karya Rules & compute compliance score
    linted_segments, score, errors_count, warnings_count = lint_dataset(
        segments, language=resolved_language, script=resolved_script
    )

    return TranscriptionResult(
        audio_id=audio_id,
        filename=filename,
        language=resolved_language,
        script=resolved_script,
        audio_info=audio_info,
        segments=linted_segments,
        compliance_score=score,
        total_errors=errors_count,
        total_warnings=warnings_count,
        is_rejected=False
    )
