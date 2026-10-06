"""
ElevenLabs Scribe v2 Transcription Service
===========================================

Provides high-accuracy Speech-to-Text transcription using the ElevenLabs
`scribe_v2` model. Delivers word-level timestamps, speaker diarization,
and non-speech audio event tagging across 90+ languages.
"""

import os
import re
import json
import asyncio
import mimetypes
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import httpx

from app.config import BASE_DIR

logger = logging.getLogger(__name__)

# Official ElevenLabs Speech-to-Text API endpoint
ELEVENLABS_STT_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"
DEFAULT_MODEL_ID = "scribe_v2"

# ISO-639 Language Mapping for ElevenLabs Scribe v2
LANGUAGE_CODE_MAP = {
    # Auto-detect
    "auto": None,
    "auto-detect": None,
    "autodetect": None,

    # English & Latin
    "english": "eng",
    "en": "eng",
    "eng": "eng",
    "spanish": "spa",
    "es": "spa",
    "spa": "spa",
    "french": "fra",
    "fr": "fra",
    "fra": "fra",
    "fre": "fra",
    "german": "deu",
    "de": "deu",
    "deu": "deu",
    "ger": "deu",
    "italian": "ita",
    "it": "ita",
    "ita": "ita",
    "portuguese": "por",
    "pt": "por",
    "por": "por",
    "dutch": "nld",
    "nl": "nld",
    "nld": "nld",
    "polish": "pol",
    "pl": "pol",
    "pol": "pol",
    "swedish": "swe",
    "sv": "swe",
    "swe": "swe",
    "danish": "dan",
    "da": "dan",
    "dan": "dan",
    "norwegian": "nor",
    "no": "nor",
    "nor": "nor",
    "finnish": "fin",
    "fi": "fin",
    "fin": "fin",
    "romanian": "ron",
    "ro": "ron",
    "ron": "ron",
    "czech": "ces",
    "cs": "ces",
    "ces": "ces",
    "hungarian": "hun",
    "hu": "hun",
    "hun": "hun",
    "greek": "ell",
    "el": "ell",
    "ell": "ell",
    "turkish": "tur",
    "tr": "tur",
    "tur": "tur",
    "indonesian": "ind",
    "id": "ind",
    "ind": "ind",
    "vietnamese": "vie",
    "vi": "vie",
    "vie": "vie",
    "thai": "tha",
    "th": "tha",
    "tha": "tha",

    # Slavic / Cyrillic
    "russian": "rus",
    "ru": "rus",
    "rus": "rus",
    "ukrainian": "ukr",
    "uk": "ukr",
    "ukr": "ukr",
    "bulgarian": "bul",
    "bg": "bul",
    "bul": "bul",
    "serbian": "srp",
    "sr": "srp",
    "srp": "srp",

    # Asian (CJK)
    "japanese": "jpn",
    "ja": "jpn",
    "jpn": "jpn",
    "korean": "kor",
    "ko": "kor",
    "kor": "kor",
    "chinese": "zho",
    "zh": "zho",
    "zho": "zho",
    "mandarin": "zho",
    "chinese (simplified)": "zho",
    "chinese (traditional)": "zho",
    "cantonese": "yue",

    # Indic Languages
    "hindi": "hin",
    "hi": "hin",
    "hin": "hin",
    "hinglish": "hin",
    "tamil": "tam",
    "ta": "tam",
    "tam": "tam",
    "telugu": "tel",
    "te": "tel",
    "tel": "tel",
    "bengali": "ben",
    "bn": "ben",
    "ben": "ben",
    "marathi": "mar",
    "mr": "mar",
    "mar": "mar",
    "gujarati": "guj",
    "gu": "guj",
    "guj": "guj",
    "kannada": "kan",
    "kn": "kan",
    "kan": "kan",
    "malayalam": "mal",
    "ml": "mal",
    "mal": "mal",
    "punjabi": "pan",
    "pa": "pan",
    "pan": "pan",
    "urdu": "urd",
    "ur": "urd",
    "urd": "urd",

    # Semitic
    "arabic": "ara",
    "ar": "ara",
    "ara": "ara",
    "hebrew": "heb",
    "he": "heb",
    "heb": "heb",
}


def resolve_language_code(language_name_or_code: Optional[str]) -> Optional[str]:
    """Map natural language name or code to ElevenLabs Scribe v2 ISO-639 code."""
    if not language_name_or_code:
        return None
    cleaned = str(language_name_or_code).strip().lower()
    if cleaned in ["auto", "auto-detect", "autodetect", "none", ""]:
        return None
    return LANGUAGE_CODE_MAP.get(cleaned, cleaned[:3])


def get_elevenlabs_api_key(override_key: Optional[str] = None) -> str:
    """Retrieve ElevenLabs API key from override, environment, or .env file."""
    if override_key and str(override_key).strip():
        return str(override_key).strip()
    key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    return key


async def transcribe_with_scribe_v2(
    audio_path: str,
    language: Optional[str] = None,
    diarize: bool = True,
    tag_audio_events: bool = True,
    num_speakers: Optional[int] = None,
    api_key: Optional[str] = None,
    model_id: str = DEFAULT_MODEL_ID,
    keyterms: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Transcribe an audio file using ElevenLabs Scribe v2.
    `keyterms` (names, brands, technical terms) bias the engine towards the correct spelling.

    Returns:
        Dict containing:
        - "text": Full transcribed text
        - "words": List of dicts with word timing:
            {"text": str, "start": float, "end": float, "type": str, "speaker_id": str}
        - "language_code": Detected or specified language code
        - "raw": Complete API response
    """
    resolved_key = get_elevenlabs_api_key(api_key)
    if not resolved_key:
        raise ValueError(
            "ElevenLabs API Key is missing. Please provide your ELEVENLABS_API_KEY "
            "in backend/.env or in the Subtitle Settings modal."
        )

    file_p = Path(audio_path)
    if not file_p.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    from app.terminal_logger import log_terminal
    import time

    lang_code = resolve_language_code(language)
    file_size_mb = round(file_p.stat().st_size / (1024 * 1024), 2)
    log_terminal(
        "ELEVENLABS-API",
        f"Preparing request for '{file_p.name}' ({file_size_mb} MB) | Language: {lang_code or 'auto-detect'} | Diarize: {diarize} | SDH: {tag_audio_events} | Speakers: {num_speakers or 'auto'}"
    )

    mime_type, _ = mimetypes.guess_type(str(file_p))
    if not mime_type:
        mime_type = "audio/x-ms-wma" if file_p.suffix.lower() == ".wma" else "audio/wav"

    headers = {
        "xi-api-key": resolved_key,
    }

    data_payload: Dict[str, Any] = {
        "model_id": model_id,
        "diarize": "true" if diarize else "false",
        "tag_audio_events": "true" if tag_audio_events else "false",
        "timestamps_granularity": "word",
    }
    if lang_code:
        data_payload["language_code"] = lang_code
    if num_speakers and num_speakers > 0:
        data_payload["num_speakers"] = str(num_speakers)
    clean_terms = [t.strip() for t in (keyterms or []) if isinstance(t, str) and t.strip() and len(t.strip()) <= 50][:100]
    keyterm_tag = ""
    if clean_terms:
        import hashlib
        keyterm_tag = "_kt" + hashlib.md5("|".join(sorted(clean_terms)).encode("utf-8")).hexdigest()[:8]

    # ElevenLabs Scribe v2 local cache check to prevent redundant API calls
    cache_name = f"{file_p.name}_{lang_code or 'auto'}_sdh{tag_audio_events}_spk{num_speakers or 'auto'}{keyterm_tag}.scribe.json"
    cache_path = file_p.parent / cache_name
    resp_json = None
    if cache_path.exists() and cache_path.stat().st_size > 100:
        try:
            with open(cache_path, "r", encoding="utf-8") as f_c:
                resp_json = json.load(f_c)
            log_terminal("ELEVENLABS-API", f"[Cache Hit] Reusing cached Scribe v2 transcription for '{file_p.name}'")
        except Exception:
            resp_json = None

    if resp_json is None:
        # ElevenLabs Scribe v2 requires multipart file upload
        st_time = time.time()
        log_terminal("ELEVENLABS-API", f"Uploading audio stream to {ELEVENLABS_STT_ENDPOINT}...")
        def _post_upload(with_keyterms: bool = True) -> httpx.Response:
            # Blocking client in a worker thread: large uploads never touch the asyncio socket
            # transport (the Windows SelectorEventLoop used by `uvicorn --reload` can spin forever
            # with "Data should not be empty" mid-upload), and the event loop stays responsive.
            with httpx.Client(timeout=httpx.Timeout(900.0, connect=60.0)) as client:
                with open(file_p, "rb") as f:
                    files = {
                        "file": (file_p.name, f, mime_type)
                    }
                    payload = dict(data_payload)
                    if with_keyterms and clean_terms:
                        payload["keyterms"] = clean_terms  # repeated multipart field
                    return client.post(
                        ELEVENLABS_STT_ENDPOINT,
                        headers=headers,
                        data=payload,
                        files=files,
                    )

        try:
            response = await asyncio.to_thread(_post_upload)
        except httpx.TimeoutException:
            log_terminal("ELEVENLABS-API", "ElevenLabs Scribe v2 request timed out after 900s", level="ERROR")
            raise RuntimeError(
                "ElevenLabs Scribe v2 request timed out. The audio file may be unusually large."
            )
        except httpx.RequestError as exc:
            log_terminal("ELEVENLABS-API", f"Connection error to ElevenLabs API: {exc}", level="ERROR")
            raise RuntimeError(f"Connection error to ElevenLabs API: {exc}")

        if clean_terms and response.status_code in (400, 422) and "keyterm" in (response.text or "").lower():
            # This account/model does not accept key terms: transcribe without them (context polish still fixes the names)
            log_terminal("ELEVENLABS-API", "Key terms were not accepted by ElevenLabs. Retrying without them.", level="WARNING")
            response = await asyncio.to_thread(_post_upload, False)
        elif clean_terms:
            log_terminal("ELEVENLABS-API", f"Sent {len(clean_terms)} key terms to bias the transcription.")

        elapsed_sec = round(time.time() - st_time, 2)
        log_terminal("ELEVENLABS-API", f"ElevenLabs responded with HTTP {response.status_code} in {elapsed_sec}s")

        if response.status_code == 401:
            log_terminal("ELEVENLABS-API", "HTTP 401 Unauthorized: Invalid ElevenLabs API Key", level="ERROR")
            raise ValueError(
                "Invalid ElevenLabs API Key. Please verify your ELEVENLABS_API_KEY."
            )
        elif response.status_code == 429:
            log_terminal("ELEVENLABS-API", "HTTP 429 Rate Limit / Quota Exceeded on ElevenLabs account", level="ERROR")
            raise RuntimeError(
                "ElevenLabs rate limit or quota exceeded. Please check your ElevenLabs subscription/tier."
            )
        elif response.status_code != 200:
            err_text = response.text
            try:
                err_json = response.json()
                err_text = err_json.get("detail", err_json.get("message", response.text))
            except Exception:
                pass
            log_terminal("ELEVENLABS-API", f"HTTP {response.status_code} Failure: {err_text}", level="ERROR")
            raise RuntimeError(
                f"ElevenLabs Scribe v2 transcription failed (HTTP {response.status_code}): {err_text}"
            )

        resp_json = response.json()
        try:
            with open(cache_path, "w", encoding="utf-8") as f_w:
                json.dump(resp_json, f_w, ensure_ascii=False)
        except Exception:
            pass

    # Extract words with normalization
    raw_words = resp_json.get("words", [])
    normalized_words = []

    for w in raw_words:
        w_text = w.get("text", "")
        w_start = float(w.get("start", 0.0))
        w_end = float(w.get("end", 0.0))
        w_type = w.get("type", "word")
        w_speaker = w.get("speaker_id", "speaker_0")

        # Skip purely empty tokens
        if not w_text and w_type != "audio_event":
            continue

        normalized_words.append({
            "text": w_text,
            "start": round(w_start, 3),
            "end": round(w_end, 3),
            "type": w_type,
            "speaker_id": w_speaker
        })

    detected_lang = resp_json.get("language_code") or lang_code or "en"
    full_text = resp_json.get("text", "")
    if not full_text and normalized_words:
        full_text = "".join([w["text"] for w in normalized_words])

    logger.info(
        f"[ElevenLabs Scribe v2] Completed! Extracted {len(normalized_words)} words/events. "
        f"Detected language: {detected_lang}"
    )
    log_terminal(
        "ELEVENLABS-API",
        f"[OK] Completed Scribe v2! Extracted {len(normalized_words)} words/events. Detected language: {detected_lang} ({len(full_text)} characters)"
    )

    return {
        "text": full_text,
        "words": normalized_words,
        "language_code": detected_lang,
        "raw": resp_json,
    }
