"""AI dubbing pipeline for the Dubbing Studio.

Flow (each step is a separate function so the API can run and report them one at a time):
  1. speaker_profiles()  build a profile of every speaker (gender, age range, tone, accent, pace) from the transcript,
                         the measured speaking rate and a sample of that person's own voice (Gemini listens to it)
  2. translate_lines()   translate every line for a dubbing booth: natural speech, in the speaker's register, and short
                         enough to be said inside the time the original line took
  3. render_dub()        clone each speaker's voice (stock-voice fallback), speak every line with ElevenLabs, fit each
                         line to its original slot, then place the lines on a timeline and mix them

Nothing here touches Transcribe Studio or Subtitle Studio; the transcript comes from the same Scribe pipeline they use.
"""
import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx
import numpy as np
import soundfile as sf

from app.config import GEMINI_API_KEY, GEMINI_MODEL
from app.elevenlabs_service import get_elevenlabs_api_key
from app.video_processor import get_ffmpeg_path

logger = logging.getLogger(__name__)

ELEVEN_BASE = "https://api.elevenlabs.io"
TTS_MODEL = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")
TTS_CONCURRENCY = max(1, int(os.getenv("DUBBING_TTS_CONCURRENCY", "3")))
SAMPLE_RATE = 24000
SAMPLE_SECONDS = 90.0          # voice sample per speaker (used for profiling and for cloning)
MIN_SAMPLE_SECONDS = 8.0
MAX_STRETCH = 1.35             # a line is never sped up more than this to fit its slot
FIRST_STRETCH = 1.2            # ElevenLabs voice "speed" limit

# Languages the studio offers. `cps` is how many characters per second a natural voice speaks in that language,
# used to size translations to the time available.
LANGUAGES: Dict[str, Dict[str, Any]] = {
    "Hindi": {"code": "hi", "cps": 13.0},
    "English": {"code": "en", "cps": 15.0},
}

# Used when the account's voice list cannot be read: ElevenLabs premade voices (Rachel, Adam)
DEFAULT_STOCK = {"female": "21m00Tcm4TlvDq8ikWAM", "male": "pNInz6obpgDQGcFmaJgB"}


class DubbingError(Exception):
    """A problem the user can act on (missing key, plan limit, bad language pair)."""


ProgressCb = Callable[[str, float, str], None]


# ----------------------------------------------------------------------------------------------- helpers
def _run(cmd: List[str], timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def _ffmpeg() -> str:
    return get_ffmpeg_path()


def normalize_language(name: Optional[str]) -> str:
    n = str(name or "").strip().lower()
    for lang in LANGUAGES:
        if lang.lower() == n or LANGUAGES[lang]["code"] == n:
            return lang
    raise DubbingError(f"Dubbing supports {', '.join(LANGUAGES)} for now.")


def _json_from(text: str) -> Any:
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"(\[.*\]|\{.*\})", t, re.S)
        if not m:
            raise
        return json.loads(m.group(1))


async def _gemini_json(parts, temperature: float = 0.3) -> Any:
    from google.genai import types
    from app.gemini_transcriber import get_gemini_client
    from app.gemini_util import generate_async
    if not GEMINI_API_KEY:
        raise DubbingError("The AI service (Gemini) is not configured on the server.")
    client = get_gemini_client()
    resp = await generate_async(
        client, GEMINI_MODEL, parts,
        types.GenerateContentConfig(temperature=temperature, response_mime_type="application/json"),
    )
    return _json_from(resp.text or "")


# ----------------------------------------------------------------------------------------------- 1. profiles
def extract_voice_sample(media_path: str, segments: List[Dict[str, Any]], out_mp3: str) -> float:
    """Concatenate the speaker's longest clean lines (up to SAMPLE_SECONDS) into one mp3. Returns its length in seconds."""
    picks, total = [], 0.0
    for s in sorted(segments, key=lambda s: s["end"] - s["start"], reverse=True):
        d = s["end"] - s["start"]
        if d < 1.0:
            continue
        d = min(d, 20.0)
        picks.append((s["start"], d))
        total += d
        if total >= SAMPLE_SECONDS:
            break
    if not picks:  # very short lines only: use whatever exists
        picks = [(s["start"], max(0.3, s["end"] - s["start"])) for s in segments[:30]]
    picks.sort()
    chunks = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, (start, dur) in enumerate(picks):
            part = Path(tmp) / f"p{i}.wav"
            r = _run([_ffmpeg(), "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", media_path,
                      "-vn", "-ac", "1", "-ar", "44100", str(part)], timeout=120)
            if r.returncode == 0 and part.exists():
                data, _ = sf.read(str(part), dtype="float32")
                if len(data):
                    chunks.append(data)
                    chunks.append(np.zeros(int(0.15 * 44100), dtype="float32"))
        if not chunks:
            raise DubbingError("Could not cut a voice sample from the media.")
        joined = Path(tmp) / "joined.wav"
        sf.write(str(joined), np.concatenate(chunks), 44100)
        r = _run([_ffmpeg(), "-y", "-loglevel", "error", "-i", str(joined), "-b:a", "128k", out_mp3], timeout=120)
        if r.returncode != 0:
            raise DubbingError("Could not encode the voice sample.")
    return round(sum(len(c) for c in chunks) / 44100, 1)


def _pace_stats(segments: List[Dict[str, Any]]) -> Dict[str, float]:
    talk = sum(max(0.0, s["end"] - s["start"]) for s in segments)
    words = sum(len(s["text"].split()) for s in segments)
    chars = sum(len(re.sub(r"\s", "", s["text"])) for s in segments)
    return {
        "talk_seconds": round(talk, 1),
        "lines": len(segments),
        "words_per_minute": round(words / talk * 60, 0) if talk > 0 else 0,
        "chars_per_second": round(chars / talk, 1) if talk > 0 else 0,
    }


def _pace_label(wpm: float) -> str:
    if wpm <= 0:
        return "unknown"
    return "slow" if wpm < 110 else "fast" if wpm > 175 else "moderate"


def _fallback_profile(gender: str) -> Dict[str, Any]:
    return {"age_range": "adult", "tone": ["neutral"], "accent": "not detected", "energy": "medium",
            "speaking_style": "conversational", "voice_description": f"{gender.lower()} adult voice", "source": "defaults"}


async def _profile_one(speaker: str, segs: List[Dict[str, Any]], gender: str, sample_mp3: Optional[str], language: str) -> Dict[str, Any]:
    from google.genai import types
    stats = _pace_stats(segs)
    lines = "\n".join(f"- {s['text']}" for s in segs[:40])
    prompt = (
        f"You are a voice casting director preparing to dub this person. Language spoken: {language}. "
        f"Detected gender: {gender}. Measured pace: {stats['words_per_minute']} words per minute.\n"
        "Listen to the voice sample (if attached) and read some of their lines, then describe how they speak. "
        "Reply with JSON only: {\"age_range\": one of [\"child\",\"teen\",\"young adult\",\"adult\",\"middle-aged\",\"senior\"], "
        "\"tone\": [up to 3 words such as warm, stern, playful, calm, anxious, authoritative], "
        "\"accent\": short description of accent or regional flavour, \"energy\": \"low\"|\"medium\"|\"high\", "
        "\"speaking_style\": short phrase, \"voice_description\": one sentence a casting director could use}.\n\nLines:\n" + lines
    )
    parts: List[Any] = [prompt]
    if sample_mp3 and Path(sample_mp3).exists():
        parts.insert(0, types.Part.from_bytes(data=Path(sample_mp3).read_bytes(), mime_type="audio/mp3"))
    data = await _gemini_json(parts, temperature=0.2)
    if isinstance(data, list):
        data = data[0] if data else {}
    base = _fallback_profile(gender)
    for k in ("age_range", "accent", "energy", "speaking_style", "voice_description"):
        if isinstance(data.get(k), str) and data[k].strip():
            base[k] = data[k].strip()
    tone = data.get("tone")
    if isinstance(tone, str):
        tone = [tone]
    if isinstance(tone, list) and tone:
        base["tone"] = [str(t) for t in tone[:3]]
    if base["energy"].lower() not in ("low", "medium", "high"):
        base["energy"] = "medium"
    base["energy"] = base["energy"].lower()
    base["source"] = "ai"
    return base


async def speaker_profiles(
    media_path: str, segments: List[Dict[str, Any]], language: str, job_dir: Path, progress: Optional[ProgressCb] = None,
) -> Dict[str, Dict[str, Any]]:
    """{speaker: profile}. Each profile has gender, pace, talk time, a voice sample file and the AI-described tone/accent/age."""
    by_speaker: Dict[str, List[Dict[str, Any]]] = {}
    for s in segments:
        by_speaker.setdefault(s["speaker"], []).append(s)
    order = sorted(by_speaker, key=lambda n: int(re.sub(r"\D", "", n) or 0))
    out: Dict[str, Dict[str, Any]] = {}
    (job_dir / "samples").mkdir(exist_ok=True)

    async def one(i: int, name: str):
        segs = by_speaker[name]
        genders = [s.get("gender") for s in segs if s.get("gender") in ("Male", "Female")]
        gender = max(set(genders), key=genders.count) if genders else "Unknown"
        sample = str(job_dir / "samples" / f"{re.sub(r'[^A-Za-z0-9]+', '_', name)}.mp3")
        sample_secs = 0.0
        try:
            sample_secs = await asyncio.to_thread(extract_voice_sample, media_path, segs, sample)
        except Exception as exc:
            logger.warning("voice sample failed for %s: %s", name, exc)
            sample = None
        try:
            prof = await _profile_one(name, segs, gender, sample, language)
        except Exception as exc:
            logger.warning("speaker profile failed for %s: %s", name, exc)
            prof = _fallback_profile(gender)
        stats = _pace_stats(segs)
        prof.update(stats)
        prof["gender"] = gender
        prof["pace"] = _pace_label(stats["words_per_minute"])
        prof["sample_file"] = Path(sample).name if sample else None
        prof["sample_seconds"] = sample_secs
        out[name] = prof
        if progress:
            progress("profiling", (i + 1) / len(order), f"Profiled {name}")

    sem = asyncio.Semaphore(3)

    async def guarded(i, n):
        async with sem:
            await one(i, n)

    await asyncio.gather(*(guarded(i, n) for i, n in enumerate(order)))
    return {n: out[n] for n in order}


# ----------------------------------------------------------------------------------------------- 2. translation
def max_chars_for(duration: float, target_language: str) -> int:
    return max(6, int(duration * LANGUAGES[target_language]["cps"]))


async def translate_lines(
    segments: List[Dict[str, Any]], profiles: Dict[str, Dict[str, Any]], source_language: str, target_language: str,
    progress: Optional[ProgressCb] = None,
) -> Dict[int, str]:
    """{segment id: dubbed text}. Lines are sized to the time available so the voice does not need heavy speeding up."""
    if source_language == target_language:
        raise DubbingError(f"This media is already in {target_language}. Pick a different target language.")
    cast = "\n".join(
        f"- {n}: {p.get('gender')}, {p.get('age_range')}, tone {', '.join(p.get('tone') or [])}, {p.get('accent')}, "
        f"{p.get('speaking_style')}, pace {p.get('pace')}" for n, p in profiles.items()
    )
    result: Dict[int, str] = {}
    batch_size = 30
    for b in range(0, len(segments), batch_size):
        batch = segments[b:b + batch_size]
        before = segments[max(0, b - 3):b]
        payload = [
            {"id": s["id"], "speaker": s["speaker"], "text": s["text"], "seconds": round(s["end"] - s["start"], 2),
             "max_chars": max_chars_for(s["end"] - s["start"], target_language)}
            for s in batch
        ]
        prompt = (
            f"You are a professional dubbing translator. Translate each line from {source_language} to {target_language} "
            "for voice-over.\nRules:\n"
            "- Say it the way that character would naturally speak, matching their tone, age and register (see the cast).\n"
            "- Spoken language, not written: contractions, natural fillers, no stiff or bookish words.\n"
            f"- Each line must be speakable within its `seconds`: keep it at or under `max_chars` characters. Shorten by rephrasing, "
            "never by dropping the key meaning.\n"
            "- Keep names, brand names and numbers; write numbers as spoken words.\n"
            f"- Write {target_language} in its normal script ({'Devanagari' if target_language == 'Hindi' else 'Latin'}). "
            "No stage directions, no speaker labels, no quotes.\n"
            "Reply with JSON only: [{\"id\": <id>, \"text\": \"<dubbed line>\"}, ...] covering every id.\n\n"
            f"Cast:\n{cast}\n\n"
            + ("Previous lines for context (do not translate):\n" + "\n".join(f"{s['speaker']}: {s['text']}" for s in before) + "\n\n" if before else "")
            + "Lines:\n" + json.dumps(payload, ensure_ascii=False)
        )
        data = await _gemini_json([prompt], temperature=0.3)
        if isinstance(data, dict):
            data = data.get("lines") or data.get("translations") or []
        for item in data or []:
            try:
                sid = int(item["id"])
                txt = str(item.get("text") or "").strip()
            except Exception:
                continue
            if txt:
                result[sid] = txt
        if progress:
            progress("translating", min(1.0, (b + batch_size) / len(segments)), f"Translated {min(len(segments), b + batch_size)} of {len(segments)} lines")
    missing = [s["id"] for s in segments if s["id"] not in result]
    if missing:
        raise DubbingError(f"The AI returned no translation for {len(missing)} lines. Try translating again.")
    return result


async def shorten_line(text: str, target_chars: int, target_language: str, profile: Dict[str, Any]) -> str:
    prompt = (
        f"Shorten this {target_language} dubbing line to at most {target_chars} characters while keeping its meaning and the "
        f"speaker's {', '.join(profile.get('tone') or ['natural'])} tone. Spoken style. Reply with JSON only: {{\"text\": \"...\"}}.\n\n{text}"
    )
    data = await _gemini_json([prompt], temperature=0.2)
    out = str((data[0] if isinstance(data, list) and data else data).get("text") or "").strip()
    return out or text


# ----------------------------------------------------------------------------------------------- 3. voices + speech
def _headers() -> Dict[str, str]:
    key = get_elevenlabs_api_key()
    if not key:
        raise DubbingError("ElevenLabs API key is missing on the server (ELEVENLABS_API_KEY).")
    return {"xi-api-key": key}


def _eleven_error(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        det = body.get("detail", body)
        if isinstance(det, dict):
            return f"{det.get('status', resp.status_code)}: {det.get('message', det)}"
        return str(det)
    except Exception:
        return f"HTTP {resp.status_code}"


async def clone_voice(client: httpx.AsyncClient, name: str, sample_mp3: str, description: str) -> str:
    data = {"name": name, "description": description[:400], "remove_background_noise": "true"}
    files = [("files", (Path(sample_mp3).name, Path(sample_mp3).read_bytes(), "audio/mpeg"))]
    resp = await client.post(f"{ELEVEN_BASE}/v1/voices/add", headers=_headers(), data=data, files=files, timeout=180)
    if resp.status_code >= 400:
        raise DubbingError(f"Voice cloning refused by ElevenLabs ({_eleven_error(resp)})")
    vid = resp.json().get("voice_id")
    if not vid:
        raise DubbingError("ElevenLabs did not return a voice id.")
    return vid


async def delete_voice(client: httpx.AsyncClient, voice_id: str) -> None:
    try:
        await client.delete(f"{ELEVEN_BASE}/v1/voices/{voice_id}", headers=_headers(), timeout=30)
    except Exception:
        logger.warning("could not delete cloned voice %s", voice_id)


async def list_stock_voices(client: httpx.AsyncClient) -> Dict[str, List[Dict[str, str]]]:
    """Stock voices the account can use, grouped by gender (premade first)."""
    groups: Dict[str, List[Dict[str, str]]] = {"male": [], "female": []}
    try:
        resp = await client.get(f"{ELEVEN_BASE}/v1/voices", headers=_headers(), timeout=30)
        if resp.status_code < 400:
            voices = sorted(resp.json().get("voices", []), key=lambda v: 0 if v.get("category") == "premade" else 1)
            for v in voices:
                labels = v.get("labels") or {}
                g = str(labels.get("gender") or "").lower()
                if g in groups and v.get("category") in ("premade", "professional", "generated", None):
                    groups[g].append({"id": v["voice_id"], "age": str(labels.get("age") or "")})
    except Exception:
        logger.warning("could not list ElevenLabs voices")
    for g, vid in DEFAULT_STOCK.items():
        if not groups[g]:
            groups[g].append({"id": vid, "age": ""})
    return groups


def pick_stock_voice(groups: Dict[str, List[Dict[str, str]]], profile: Dict[str, Any], used: List[str], index: int) -> str:
    g = str(profile.get("gender") or "").lower()
    if g not in groups:
        g = "female" if index % 2 else "male"
    age = str(profile.get("age_range") or "")
    want = "old" if age == "senior" else "young" if age in ("child", "teen", "young adult") else "middle_aged"
    pool = groups[g]
    ranked = sorted(pool, key=lambda v: (v["id"] in used, 0 if v["age"] == want else 1))
    return ranked[0]["id"]


def voice_settings(profile: Dict[str, Any], speed: float = 1.0) -> Dict[str, Any]:
    energy = str(profile.get("energy") or "medium")
    stability, style = {"low": (0.6, 0.0), "high": (0.3, 0.45)}.get(energy, (0.45, 0.2))
    return {"stability": stability, "similarity_boost": 0.8, "style": style, "use_speaker_boost": True,
            "speed": max(0.7, min(FIRST_STRETCH, speed))}


async def speak(client: httpx.AsyncClient, voice_id: str, text: str, settings: Dict[str, Any], sem: asyncio.Semaphore) -> bytes:
    body = {"text": text, "model_id": TTS_MODEL, "voice_settings": settings}
    delay = 2.0
    async with sem:
        for attempt in range(5):
            resp = await client.post(
                f"{ELEVEN_BASE}/v1/text-to-speech/{voice_id}", params={"output_format": "mp3_44100_128"},
                headers=_headers(), json=body, timeout=180,
            )
            if resp.status_code == 200:
                return resp.content
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < 4:
                await asyncio.sleep(delay)
                delay *= 2
                continue
            raise DubbingError(f"ElevenLabs could not speak a line ({_eleven_error(resp)})")
    raise DubbingError("ElevenLabs is busy. Try again in a minute.")


# ----------------------------------------------------------------------------------------------- audio fitting + mixing
_TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,"
         "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse")


def to_wav(src: str, dst: str, tempo: float = 1.0) -> float:
    """Decode a line to mono wav at SAMPLE_RATE, trim silence, optionally speed up by `tempo`. Returns seconds."""
    chain = _TRIM + (f",atempo={tempo:.4f}" if abs(tempo - 1.0) > 0.005 else "")
    r = _run([_ffmpeg(), "-y", "-loglevel", "error", "-i", src, "-filter:a", chain, "-ar", str(SAMPLE_RATE), "-ac", "1", dst], timeout=120)
    if r.returncode != 0 or not Path(dst).exists():
        raise DubbingError("Could not decode a generated line.")
    return float(sf.info(dst).duration)


def mix_timeline(lines: List[Dict[str, Any]], total_seconds: float, out_wav: str) -> None:
    """Place each line's wav at its start time. Overlaps add together."""
    end = max([total_seconds] + [l["start"] + l["duration"] for l in lines])
    buf = np.zeros(int(end * SAMPLE_RATE) + 1, dtype="float32")
    for l in lines:
        data, _ = sf.read(l["wav"], dtype="float32")
        i = int(l["start"] * SAMPLE_RATE)
        n = max(0, min(len(data), len(buf) - i))
        buf[i:i + n] += data[:n]
    peak = float(np.max(np.abs(buf))) if len(buf) else 0.0
    if peak > 0.98:
        buf *= 0.98 / peak
    sf.write(out_wav, buf, SAMPLE_RATE, subtype="PCM_16")


def wav_to_mp3(wav: str, mp3: str) -> None:
    r = _run([_ffmpeg(), "-y", "-loglevel", "error", "-i", wav, "-b:a", "192k", mp3], timeout=600)
    if r.returncode != 0:
        raise DubbingError("Could not encode the dubbed audio.")


def mux_video(video: str, dub_wav: str, out_mp4: str) -> None:
    base = [_ffmpeg(), "-y", "-loglevel", "error", "-i", video, "-i", dub_wav, "-map", "0:v:0", "-map", "1:a:0"]
    tail = ["-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out_mp4]
    if _run(base + ["-c:v", "copy"] + tail, timeout=3600).returncode == 0:
        return
    r = _run(base + ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"] + tail, timeout=7200)
    if r.returncode != 0:
        raise DubbingError("Could not put the dubbed audio onto the video.")


# ----------------------------------------------------------------------------------------------- render
async def render_dub(
    job_dir: Path, media_path: str, is_video: bool, total_seconds: float, segments: List[Dict[str, Any]],
    profiles: Dict[str, Dict[str, Any]], texts: Dict[int, str], target_language: str, voice_modes: Dict[str, str],
    progress: Optional[ProgressCb] = None,
) -> Dict[str, Any]:
    """Speak every line, fit it to its slot and mix. Returns {files, notes, voices, overruns}."""
    notes: List[str] = []
    lines_dir = job_dir / "lines"
    lines_dir.mkdir(exist_ok=True)
    cloned: List[str] = []
    voices: Dict[str, Dict[str, str]] = {}
    ordered = sorted(segments, key=lambda s: s["start"])
    cps = LANGUAGES[target_language]["cps"]
    _headers()  # fail fast if the key is missing

    async with httpx.AsyncClient() as client:
        try:
            stock = None
            used: List[str] = []
            for i, (name, prof) in enumerate(profiles.items()):
                mode = voice_modes.get(name, "clone")
                vid, how = None, "clone"
                sample = job_dir / "samples" / (prof.get("sample_file") or "-")
                if mode == "clone" and sample.exists() and prof.get("sample_seconds", 0) >= MIN_SAMPLE_SECONDS:
                    try:
                        vid = await clone_voice(client, f"LT-{job_dir.name[:6]}-{name}", str(sample),
                                                f"{prof.get('gender')}, {prof.get('age_range')}, {prof.get('accent')}")
                        cloned.append(vid)
                    except DubbingError as exc:
                        notes.append(f"{name}: {exc}. Used a stock voice instead.")
                elif mode == "clone":
                    notes.append(f"{name}: not enough clean speech to clone, used a stock voice.")
                if not vid:
                    if stock is None:
                        stock = await list_stock_voices(client)
                    vid, how = pick_stock_voice(stock, prof, used, i), "stock"
                used.append(vid)
                voices[name] = {"voice_id": vid, "mode": how}
                if progress:
                    progress("voices", (i + 1) / len(profiles), f"Voice ready for {name} ({how})")

            sem = asyncio.Semaphore(TTS_CONCURRENCY)
            done = {"n": 0}
            placed: List[Dict[str, Any]] = []
            overruns: List[int] = []

            async def do_line(idx: int, s: Dict[str, Any]):
                text = texts[s["id"]]
                prof = profiles[s["speaker"]]
                vid = voices[s["speaker"]]["voice_id"]
                nxt = ordered[idx + 1]["start"] if idx + 1 < len(ordered) else s["end"] + 1.0
                slot = max(0.4, min(s["end"] - s["start"] + 0.35, nxt - s["start"] - 0.03))  # may spill a little into silence
                mp3 = lines_dir / f"{s['id']}.mp3"
                wav = lines_dir / f"{s['id']}.wav"
                mp3.write_bytes(await speak(client, vid, text, voice_settings(prof, 1.0), sem))
                dur = await asyncio.to_thread(to_wav, str(mp3), str(wav))
                if dur > slot * 1.15 and len(text) > 8:
                    # Too long even with a small speed-up: ask for a shorter wording once and speak it again
                    try:
                        short = await shorten_line(text, max(6, int(len(text) * slot / dur * 0.95)), target_language, prof)
                        if short and short != text:
                            texts[s["id"]] = text = short
                            mp3.write_bytes(await speak(client, vid, text, voice_settings(prof, 1.0), sem))
                            dur = await asyncio.to_thread(to_wav, str(mp3), str(wav))
                    except Exception as exc:
                        logger.warning("shorten failed for line %s: %s", s["id"], exc)
                if dur > slot * 1.02:
                    tempo = min(MAX_STRETCH, dur / slot)
                    dur = await asyncio.to_thread(to_wav, str(mp3), str(wav), tempo)
                if dur > slot * 1.1:
                    overruns.append(s["id"])
                placed.append({"id": s["id"], "speaker": s["speaker"], "start": s["start"], "duration": dur, "wav": str(wav)})
                done["n"] += 1
                if progress:
                    progress("speaking", done["n"] / len(ordered), f"Spoke {done['n']} of {len(ordered)} lines")

            await asyncio.gather(*(do_line(i, s) for i, s in enumerate(ordered)))
        finally:
            for vid in cloned:
                await delete_voice(client, vid)

    if progress:
        progress("mixing", 0.0, "Mixing the dubbed track")
    placed.sort(key=lambda l: l["start"])
    files: Dict[str, str] = {}
    out_wav = job_dir / "dub.wav"
    await asyncio.to_thread(mix_timeline, placed, total_seconds, str(out_wav))
    await asyncio.to_thread(wav_to_mp3, str(out_wav), str(job_dir / "dub.mp3"))
    files["audio"] = "dub.mp3"
    spk_dir = job_dir / "speakers"
    spk_dir.mkdir(exist_ok=True)
    files["speakers"] = {}
    for name in profiles:
        mine = [l for l in placed if l["speaker"] == name]
        if not mine:
            continue
        stem = re.sub(r"[^A-Za-z0-9]+", "_", name)
        w = spk_dir / f"{stem}.wav"
        await asyncio.to_thread(mix_timeline, mine, total_seconds, str(w))
        await asyncio.to_thread(wav_to_mp3, str(w), str(spk_dir / f"{stem}.mp3"))
        w.unlink(missing_ok=True)
        files["speakers"][name] = f"speakers/{stem}.mp3"
    if is_video:
        if progress:
            progress("mixing", 0.6, "Putting the new audio on the video")
        await asyncio.to_thread(mux_video, media_path, str(out_wav), str(job_dir / "dub.mp4"))
        files["video"] = "dub.mp4"
    out_wav.unlink(missing_ok=True)
    for w in lines_dir.glob("*.wav"):
        w.unlink(missing_ok=True)
    if overruns:
        notes.append(f"{len(overruns)} lines are still a little longer than the original timing. Shorten them in the review step and render again.")
    return {"files": files, "notes": notes, "voices": voices, "texts": texts, "overruns": overruns}
