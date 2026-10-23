"""Dubbing Studio projects: an editable, stage-by-stage dubbing workflow.

A project keeps the transcript segments (editable), the speakers (profile + voice), the translation of every line and,
in later stages, the generated audio of every line. Each stage is its own endpoint and can be re-run on its own.
Engines (speech-to-text, translation, voices) live in dubbing_engines.py behind small functions so they can be swapped.
Hours are held for the full media length when the project is created and charged once the transcript exists.
"""
import asyncio
import json
import logging
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from app import dubbing_edit as edits
from app import dubbing_engines as eng
from app import dubbing_stems as stems
from app import metering
from app.auth_module import usage as usage_mod
from app.auth_module.models import User
from app.auth_module.routes import get_current_user_from_token
from app.config import UPLOAD_DIR
from app.elevenlabs_service import get_elevenlabs_api_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dubbing/projects", tags=["dubbing-projects"])
voices_router = APIRouter(prefix="/api/dubbing", tags=["dubbing-projects"])

ROOT = UPLOAD_DIR / "dubbing_projects"
ROOT.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
TTL_SEC = 14 * 24 * 3600

_projects: Dict[str, Dict[str, Any]] = {}
_tasks: Dict[str, asyncio.Task] = {}
_PRIVATE = {"media_path", "owner", "updated", "lines", "edit"}
BUSY = ("transcribing", "profiling", "translating", "speaking", "separating", "rendering")


# --------------------------------------------------------------------------------------------- storage
def _dir(pid: str) -> Path:
    if not pid.isalnum():
        raise HTTPException(status_code=404, detail="Project not found.")
    return ROOT / pid


def _save(p: Dict[str, Any]) -> None:
    p["updated"] = time.time()
    try:
        (_dir(p["id"]) / "project.json").write_text(json.dumps(p, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logger.exception("could not save dubbing project %s", p.get("id"))


def _load(pid: str) -> Optional[Dict[str, Any]]:
    f = _dir(pid) / "project.json"
    if not f.exists():
        return None
    try:
        p = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return None
    if p.get("status") in BUSY and p["id"] not in _tasks:
        p.update(status="ready" if p.get("segments") else "error", error="The server restarted while this was running. Run the step again.")
    return p


def _get(pid: str, user: User) -> Dict[str, Any]:
    p = _projects.get(pid) or _load(pid)
    if p is None or p.get("owner") != user.id:
        raise HTTPException(status_code=404, detail="Project not found.")
    _projects[pid] = p
    return p


def _idle(p: Dict[str, Any]) -> None:
    if p["id"] in _tasks:
        raise HTTPException(status_code=409, detail="This project is busy. Wait for the current step to finish.")


def _progress(p: Dict[str, Any], base: float, span: float):
    def cb(stage: str, frac: float, detail: str = "") -> None:
        p.update(stage=stage, percent=round(min(99.0, base + span * max(0.0, min(1.0, frac))), 1), detail=detail)
    return cb


def _clamp(v, lo, hi, default):
    try:
        return round(max(lo, min(hi, float(v))), 3)
    except (TypeError, ValueError):
        return default


TTS_LIMITS = {"stability": (0.0, 1.0), "similarity": (0.0, 1.0), "style": (0.0, 1.0), "speed": (0.7, 1.2), "pitch": (-6.0, 6.0)}


def _clean_tts(raw) -> Dict[str, Any]:
    """Only known voice controls, within range. `fit` (speed the line up to fit its slot) is a boolean."""
    out: Dict[str, Any] = {}
    if isinstance(raw, dict):
        for k, (lo, hi) in TTS_LIMITS.items():
            if raw.get(k) is not None:
                v = _clamp(raw[k], lo, hi, None)
                if v is not None:
                    out[k] = v
        if raw.get("fit") is not None:
            out["fit"] = bool(raw["fit"])
    return out


def _default_voice() -> Dict[str, Any]:
    return {"mode": "stock", "voice_id": None, "voice_name": "", "cloned_id": None}


def sync_speakers(p: Dict[str, Any]) -> None:
    """Every speaker used by a segment has an entry; unused ones are dropped."""
    used = {s["speaker"] for s in p["segments"]}
    for name in used:
        sp = p["speakers"].setdefault(name, {})
        sp.setdefault("gender", "Unknown")
        sp.setdefault("voice", _default_voice())
    for name in list(p["speakers"]):
        if name not in used:
            p["speakers"].pop(name)


# --------------------------------------------------------------------------------------------- list / create
@router.get("")
async def list_projects(current_user: User = Depends(get_current_user_from_token)):
    rows = []
    for d in ROOT.iterdir():
        try:
            p = _projects.get(d.name) or _load(d.name)
            if p and p.get("owner") == current_user.id:
                rows.append({"id": p["id"], "filename": p["filename"], "status": p["status"], "duration": p.get("duration"),
                             "source_language": p.get("source_language"), "target_language": p.get("target_language"),
                             "lines": len(p.get("segments") or []), "updated": p.get("updated")})
        except Exception:
            continue
    return {"projects": sorted(rows, key=lambda r: r.get("updated") or 0, reverse=True)}


async def _transcribe(p: Dict[str, Any], meter: "metering.Metered", language: str) -> None:
    from app.scribe_transcriber import process_audio_file
    from app.video_processor import extract_audio_from_video
    pdir = _dir(p["id"])
    try:
        p.update(status="transcribing", stage="extracting", percent=2.0, detail="Reading the audio", error=None)
        audio_path = p["media_path"]
        if p["is_video"] or Path(audio_path).suffix.lower() not in (".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"):
            info = await asyncio.to_thread(extract_audio_from_video, audio_path)
            audio_path = info.get("audio_path") or audio_path
        hook = metering.transcribe_stage_hook(meter)

        def on_stage(stage, overall, detail="", stage_pct=None):
            hook(stage)
            p.update(stage=stage, percent=round(min(80.0, 5.0 + float(overall) * 0.75), 1), detail=detail)

        result = await process_audio_file(audio_path=audio_path, language=language, script="Auto-Detect",
                                          video_path=p["media_path"] if p["is_video"] else None, progress_cb=on_stage)
        segs = [{"id": i, "speaker": s.speaker, "gender": s.gender, "start": round(s.start_time, 3), "end": round(s.end_time, 3),
                 "text": (s.transcript or "").strip(), "translation": ""}
                for i, s in enumerate(result.segments, 1) if (s.transcript or "").strip() and s.end_time > s.start_time]
        if not segs:
            raise eng.DubbingError("No speech was found in this file.")
        p["segments"], p["source_language"] = segs, result.language
        meter.finish(True)
        p["speakers"] = {}
        sync_speakers(p)
        for name, sp in p["speakers"].items():
            genders = [s["gender"] for s in segs if s["speaker"] == name and s["gender"] in ("Male", "Female")]
            sp["gender"] = max(set(genders), key=genders.count) if genders else "Unknown"
        p.update(status="ready", stage="transcribed", percent=100.0, detail="Transcript ready")
        _save(p)
        await _profile(p)  # speaker profiles + default stock voices; failure here must not lose the transcript
    except asyncio.CancelledError:
        meter.on_error(asyncio.CancelledError())
        p.update(status="error", error="Cancelled.")
    except Exception as exc:
        meter.on_error(exc)
        if not isinstance(exc, eng.DubbingError):
            logger.exception("dubbing transcription failed")
        p.update(status="error", error=str(exc) if isinstance(exc, eng.DubbingError) else f"Transcription failed: {exc}")
    finally:
        meter.on_error(RuntimeError("done"))
        _tasks.pop(p["id"], None)
        _save(p)


async def _profile(p: Dict[str, Any]) -> None:
    """Describe every speaker (age, tone, accent, pace) and give each a default stock voice you can change."""
    try:
        p.update(status="profiling", stage="profiling", percent=0.0, detail="Profiling the speakers", error=None)
        profiles = await eng.speaker_profiles(p["media_path"], p["segments"], p.get("source_language") or "", _dir(p["id"]), _progress(p, 0.0, 90.0))
        for name, prof in profiles.items():
            sp = p["speakers"].setdefault(name, {"voice": _default_voice()})
            sp.update(prof)
        try:
            async with httpx.AsyncClient() as client:
                groups = await eng.list_stock_voices(client)
            used: List[str] = []
            for i, (name, sp) in enumerate(p["speakers"].items()):
                if not sp["voice"].get("voice_id"):
                    sp["voice"]["voice_id"] = eng.pick_stock_voice(groups, sp, used, i)
                    sp["voice"]["voice_name"] = "Suggested stock voice"
                used.append(sp["voice"]["voice_id"])
        except Exception as exc:
            logger.warning("default voices not assigned: %s", exc)
        p.update(status="ready", stage="profiled", percent=100.0, detail="Speakers ready")
    except Exception as exc:
        logger.warning("profiling failed: %s", exc)
        p.update(status="ready", error=f"Speaker profiling failed: {exc}")


@router.post("")
async def create_project(file: UploadFile = File(...), source_language: str = Form("Auto-Detect"),
                         current_user: User = Depends(get_current_user_from_token)):
    from app.video_processor import get_supported_media_extensions, get_supported_video_extensions
    if not get_elevenlabs_api_key():
        raise HTTPException(status_code=503, detail="ElevenLabs is not configured on the server, so dubbing is unavailable.")
    name = Path(file.filename or "media").name
    ext = Path(name).suffix.lower()
    if ext not in get_supported_media_extensions():
        raise HTTPException(status_code=415, detail="That file type is not supported. Upload an audio or video file.")
    language = "Auto-Detect"
    if str(source_language).strip().lower() not in ("", "auto", "auto-detect"):
        try:
            language = eng.normalize_language(source_language)
        except eng.DubbingError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    pid = uuid.uuid4().hex[:12]
    pdir = _dir(pid)
    pdir.mkdir(parents=True)
    media = pdir / f"source{ext}"
    size = 0
    with open(media, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                shutil.rmtree(pdir, ignore_errors=True)
                raise HTTPException(status_code=413, detail="File too large. The limit is 1 GB.")
            out.write(chunk)
    try:
        ms = await metering.probe_duration_ms(str(media))
        meter = metering.Metered(metering.user_ref(current_user), usage_mod.TRANSCRIBE, ms, "/api/dubbing/projects", f"dubproj:{pid}:{name}").reserve()
    except HTTPException:
        shutil.rmtree(pdir, ignore_errors=True)
        raise
    p: Dict[str, Any] = {
        "id": pid, "owner": current_user.id, "filename": name, "media_path": str(media), "is_video": ext in get_supported_video_extensions(),
        "duration": round(ms / 1000.0, 2), "status": "transcribing", "stage": "queued", "percent": 0.0, "detail": "Queued", "error": None,
        "source_language": language, "target_language": None, "segments": [], "speakers": {}, "created": time.time(),
    }
    _projects[pid] = p
    _save(p)
    _tasks[pid] = asyncio.create_task(_transcribe(p, meter, language))
    return {"id": pid}


@router.get("/{pid}")
async def get_project(pid: str, current_user: User = Depends(get_current_user_from_token)):
    return _public(_get(pid, current_user))


@router.get("/{pid}/media")
async def get_media(pid: str, current_user: User = Depends(get_current_user_from_token)):
    p = _get(pid, current_user)
    path = Path(p["media_path"])
    return FileResponse(path, media_type="video/mp4" if p["is_video"] else "audio/mpeg" if path.suffix == ".mp3" else None)


@router.delete("/{pid}")
async def delete_project(pid: str, current_user: User = Depends(get_current_user_from_token)):
    p = _get(pid, current_user)
    t = _tasks.get(pid)
    if t:
        t.cancel()
    cloned = [sp["voice"].get("cloned_id") for sp in p["speakers"].values() if sp.get("voice", {}).get("cloned_id")]
    if cloned:
        async with httpx.AsyncClient() as client:
            for vid in cloned:
                await eng.delete_voice(client, vid)
    _projects.pop(pid, None)
    shutil.rmtree(_dir(pid), ignore_errors=True)
    return {"ok": True}


@router.post("/{pid}/cancel")
async def cancel(pid: str, current_user: User = Depends(get_current_user_from_token)):
    _get(pid, current_user)
    t = _tasks.get(pid)
    if t:
        t.cancel()
    return {"ok": True}


# --------------------------------------------------------------------------------------------- stage 1: segments
@router.put("/{pid}/segments")
async def save_segments(pid: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    """Replace the transcript with the edited one: text, speaker, start/end, translation. New lines get new ids."""
    p = _get(pid, current_user)
    _idle(p)
    rows = payload.get("segments")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="Send the list of segments.")
    old = {s["id"]: s for s in p["segments"]}
    next_id = max([0] + list(old)) + 1
    out, seen = [], set()
    for r in rows:
        try:
            start, end = round(float(r["start"]), 3), round(float(r["end"]), 3)
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Every segment needs a start and an end time.")
        if not (0 <= start < end <= p["duration"] + 1.0):
            raise HTTPException(status_code=400, detail=f"A segment has invalid times ({start} to {end}).")
        sid = r.get("id")
        if not isinstance(sid, int) or sid in seen:
            sid, next_id = next_id, next_id + 1
        seen.add(sid)
        speaker = str(r.get("speaker") or "Speaker 1").strip()[:40] or "Speaker 1"
        out.append({"id": sid, "speaker": speaker, "gender": (old.get(sid) or {}).get("gender", "Unknown"),
                    "start": start, "end": end, "text": str(r.get("text") or "").strip(),
                    "translation": str(r.get("translation") or "").strip(),
                    "tts": _clean_tts(r.get("tts")), "mute": bool(r.get("mute")),
                    "gain": _clamp(r.get("gain"), 0.0, 2.0, 1.0), "shift": _clamp(r.get("shift"), -10.0, 10.0, 0.0)})
    out.sort(key=lambda s: s["start"])
    p["segments"] = out
    sync_speakers(p)
    _save(p)
    return _public(p)


@router.post("/{pid}/profiles")
async def rerun_profiles(pid: str, current_user: User = Depends(get_current_user_from_token)):
    p = _get(pid, current_user)
    _idle(p)

    async def run():
        try:
            await _profile(p)
        finally:
            _tasks.pop(pid, None)
            _save(p)
    _tasks[pid] = asyncio.create_task(run())
    return {"ok": True}


# --------------------------------------------------------------------------------------------- stage 2: voices
@voices_router.get("/voices")
async def account_voices(current_user: User = Depends(get_current_user_from_token)):
    try:
        async with httpx.AsyncClient() as client:
            return {"voices": await eng.list_account_voices(client)}
    except eng.DubbingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.put("/{pid}/speakers/{name}/voice")
async def set_voice(pid: str, name: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    """Pick a stock voice for a speaker (payload: voice_id, voice_name). Speaker keeps its cloned voice for later."""
    p = _get(pid, current_user)
    sp = p["speakers"].get(name)
    if not sp:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    vid = str(payload.get("voice_id") or "").strip()
    if not vid:
        raise HTTPException(status_code=400, detail="Pick a voice.")
    cloned = sp["voice"].get("cloned_id")
    mode = "clone" if cloned and vid == cloned else "stock"
    sp["voice"].update(mode=mode, voice_id=vid, voice_name=str(payload.get("voice_name") or ("Cloned voice" if mode == "clone" else ""))[:80])
    _save(p)
    return _public(p)


@router.post("/{pid}/speakers/{name}/clone")
async def clone_speaker(pid: str, name: str, current_user: User = Depends(get_current_user_from_token)):
    """Clone this speaker's voice from the recording. The clone stays with the project (so it can be previewed and reused)
    and is deleted from ElevenLabs when the project is deleted."""
    p = _get(pid, current_user)
    sp = p["speakers"].get(name)
    if not sp:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    sample = _dir(pid) / "samples" / (sp.get("sample_file") or "-")
    if not sample.exists() or sp.get("sample_seconds", 0) < eng.MIN_SAMPLE_SECONDS:
        raise HTTPException(status_code=400, detail="This speaker has too little clean speech to clone. Use a stock voice.")
    try:
        async with httpx.AsyncClient() as client:
            if sp["voice"].get("cloned_id"):
                await eng.delete_voice(client, sp["voice"]["cloned_id"])
            vid = await eng.clone_voice(client, f"LT-{pid[:6]}-{name}", str(sample), f"{sp.get('gender')}, {sp.get('age_range')}, {sp.get('accent')}")
    except eng.DubbingPlanError as exc:
        raise HTTPException(status_code=424, detail=str(exc))
    except eng.DubbingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    sp["voice"].update(mode="clone", voice_id=vid, cloned_id=vid, voice_name="Cloned voice")
    _save(p)
    return _public(p)


@router.get("/{pid}/speakers/{name}/sample")
async def speaker_sample(pid: str, name: str, current_user: User = Depends(get_current_user_from_token)):
    p = _get(pid, current_user)
    sp = p["speakers"].get(name)
    f = _dir(pid) / "samples" / ((sp or {}).get("sample_file") or "-")
    if not f.exists():
        raise HTTPException(status_code=404, detail="No sample for this speaker.")
    return FileResponse(f, media_type="audio/mpeg")


# --------------------------------------------------------------------------------------------- stage 3: translation
@router.post("/{pid}/translate")
async def translate(pid: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    """Translate all lines, or only `ids`. Existing hand edits on other lines are kept."""
    p = _get(pid, current_user)
    _idle(p)
    try:
        target = eng.normalize_language(payload.get("target_language"))
        if target == eng.normalize_language(p.get("source_language")):
            raise eng.DubbingError(f"This media is already in {target}. Pick the other language.")
    except eng.DubbingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    ids = payload.get("ids")
    segs = [s for s in p["segments"] if not ids or s["id"] in set(ids)]
    if not segs:
        raise HTTPException(status_code=400, detail="No lines to translate.")

    async def run():
        try:
            p.update(status="translating", stage="translating", percent=1.0, detail="Translating for dubbing", error=None)
            texts = await eng.translate_lines(segs, p["speakers"], eng.normalize_language(p["source_language"]), target, _progress(p, 1.0, 98.0))
            by_id = {s["id"]: s for s in p["segments"]}
            for sid, txt in texts.items():
                by_id[sid]["translation"] = txt
            p["target_language"] = target
            p.update(status="ready", stage="translated", percent=100.0, detail="Review the lines")
        except asyncio.CancelledError:
            p.update(status="ready", error="Cancelled.")
        except Exception as exc:
            if not isinstance(exc, eng.DubbingError):
                logger.exception("translation failed")
            p.update(status="ready", error=str(exc) if isinstance(exc, eng.DubbingError) else f"Translation failed: {exc}")
        finally:
            _tasks.pop(pid, None)
            _save(p)
    _tasks[pid] = asyncio.create_task(run())
    return {"ok": True}


# --------------------------------------------------------------------------------------------- stage 4: speech per line
def _line_meta(p: Dict[str, Any]) -> Dict[str, Any]:
    return p.setdefault("lines", {})


def _controls(p: Dict[str, Any], seg: Dict[str, Any]) -> Dict[str, Any]:
    """Voice controls for a line: speaker defaults, then the line's own."""
    sp = p["speakers"].get(seg["speaker"], {})
    merged = {"fit": True}
    merged.update(sp.get("tts") or {})
    merged.update(seg.get("tts") or {})
    return merged


def _signature(p: Dict[str, Any], seg: Dict[str, Any]) -> Dict[str, Any]:
    sp = p["speakers"].get(seg["speaker"], {})
    return {"text": seg.get("translation", ""), "voice_id": (sp.get("voice") or {}).get("voice_id"),
            "controls": _controls(p, seg), "slot": round(seg["end"] - seg["start"], 2)}


def line_state(p: Dict[str, Any], seg: Dict[str, Any]) -> Dict[str, Any]:
    meta = _line_meta(p).get(str(seg["id"]))
    if not meta or not meta.get("file"):
        return {"ready": False, "error": (meta or {}).get("error")}
    stale = meta.get("sig") != _signature(p, seg)
    return {"ready": True, "stale": stale, "duration": meta["duration"], "tempo": meta.get("tempo", 1.0),
            "overrun": meta.get("overrun", False), "rev": meta.get("rev", 0), "error": meta.get("error")}


def _public(p: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in p.items() if k not in _PRIVATE and k != "lines"}
    out["languages"] = {k: v["cps"] for k, v in eng.LANGUAGES.items()}
    out["segments"] = [dict(s, audio=line_state(p, s)) for s in p["segments"]]
    return out


async def _speak_lines(p: Dict[str, Any], ids: Optional[List[int]], only_stale: bool) -> None:
    pdir = _dir(p["id"])
    (pdir / "lines").mkdir(exist_ok=True)
    try:
        segs = [s for s in p["segments"] if (s.get("translation") or "").strip() and (not ids or s["id"] in set(ids))]
        if only_stale:
            segs = [s for s in segs if not line_state(p, s).get("ready") or line_state(p, s).get("stale")]
        if not segs:
            p.update(status="ready", stage="speech", detail="Nothing to generate", percent=100.0)
            return
        p.update(status="speaking", stage="speaking", percent=1.0, detail=f"Speaking {len(segs)} lines", error=None)
        sem = asyncio.Semaphore(eng.TTS_CONCURRENCY)
        done, failed = {"n": 0}, []
        meta_all = _line_meta(p)
        ordered = p["segments"]

        async with httpx.AsyncClient() as client:
            async def one(s: Dict[str, Any]):
                sp = p["speakers"].get(s["speaker"], {})
                vid = (sp.get("voice") or {}).get("voice_id")
                sid = str(s["id"])
                try:
                    if not vid:
                        raise eng.DubbingError(f"{s['speaker']} has no voice yet. Pick one in Speakers & voices.")
                    c = _controls(p, s)
                    sig = _signature(p, s)
                    mp3 = pdir / "lines" / f"{sid}.mp3"
                    wav = pdir / "lines" / f"{sid}.wav"
                    mp3.write_bytes(await eng.speak(client, vid, s["translation"], eng.voice_settings(sp, 1.0, c), sem))
                    pitch = c.get("pitch", 0.0)
                    raw = await asyncio.to_thread(eng.to_wav, str(mp3), str(wav), 1.0, pitch)
                    slot = max(0.4, s["end"] - s["start"])
                    tempo, dur = 1.0, raw
                    if c.get("fit", True) and raw > slot * 1.02:
                        tempo = min(eng.MAX_STRETCH, raw / slot)
                        dur = await asyncio.to_thread(eng.to_wav, str(mp3), str(wav), tempo, pitch)
                    old = meta_all.get(sid) or {}
                    meta_all[sid] = {"file": f"{sid}.wav", "duration": round(dur, 3), "raw_duration": round(raw, 3), "tempo": round(tempo, 3),
                                     "overrun": dur > slot * 1.1, "sig": sig, "rev": old.get("rev", 0) + 1, "error": None,
                                     "chars": len(s["translation"])}
                except Exception as exc:
                    failed.append(sid)
                    meta_all[sid] = dict(meta_all.get(sid) or {}, error=str(exc))
                done["n"] += 1
                p.update(percent=round(1 + 98 * done["n"] / len(segs), 1), detail=f"Spoke {done['n']} of {len(segs)} lines")

            await asyncio.gather(*(one(s) for s in segs))
        p.update(status="ready", stage="speech", percent=100.0, detail="Speech ready",
                 error=f"{len(failed)} lines failed. See the red marks in the Voice-over tab." if failed else None)
    except asyncio.CancelledError:
        p.update(status="ready", error="Cancelled.")
    except Exception as exc:
        if not isinstance(exc, eng.DubbingError):
            logger.exception("speech generation failed")
        p.update(status="ready", error=str(exc) if isinstance(exc, eng.DubbingError) else f"Speech generation failed: {exc}")
    finally:
        _tasks.pop(p["id"], None)
        _save(p)


@router.post("/{pid}/speak")
async def speak_lines(pid: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    """Generate speech for `ids` (one line, some, or all). `only_stale` skips lines whose audio is current."""
    p = _get(pid, current_user)
    _idle(p)
    if not p.get("target_language"):
        raise HTTPException(status_code=400, detail="Translate the lines first.")
    _tasks[pid] = asyncio.create_task(_speak_lines(p, payload.get("ids") or None, bool(payload.get("only_stale"))))
    return {"ok": True}


@router.put("/{pid}/speakers/{name}/tts")
async def speaker_tts(pid: str, name: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    """Default voice controls for a speaker (stability, similarity, style, speed, pitch, fit). Lines can override them."""
    p = _get(pid, current_user)
    sp = p["speakers"].get(name)
    if not sp:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    sp["tts"] = _clean_tts(payload)
    _save(p)
    return _public(p)


@router.get("/{pid}/lines/{sid}/audio")
async def line_audio(pid: str, sid: int, current_user: User = Depends(get_current_user_from_token)):
    p = _get(pid, current_user)
    meta = _line_meta(p).get(str(sid))
    f = _dir(pid) / "lines" / ((meta or {}).get("file") or "-")
    if not meta or not f.exists():
        raise HTTPException(status_code=404, detail="This line has no audio yet.")
    return FileResponse(f, media_type="audio/wav")


# --------------------------------------------------------------------------------------------- mix + downloads
@voices_router.get("/stems/status")
async def stems_status(current_user: User = Depends(get_current_user_from_token)):
    return stems.status()


@router.post("/{pid}/stems")
async def separate_background(pid: str, payload: dict = Body(default={}), current_user: User = Depends(get_current_user_from_token)):
    """Split the original recording into speech and background (music + effects) so the background can sit under the dub."""
    p = _get(pid, current_user)
    _idle(p)
    mode = payload.get("mode") if payload.get("mode") in ("demucs", "basic") else ("demucs" if stems.status()["demucs"] else "basic")

    async def run():
        try:
            p.update(status="separating", stage="separating", percent=1.0, detail="Separating the background", error=None)

            def cb(frac, detail):
                p.update(percent=round(1 + 97 * frac, 1), detail=detail)
            info = await stems.separate(p["media_path"], _dir(pid) / "stems", mode, cb)
            p["stems"] = dict(info, at=time.time())
            p.update(status="ready", stage="separated", percent=100.0, detail="Background ready")
        except asyncio.CancelledError:
            p.update(status="ready", error="Cancelled.")
        except Exception as exc:
            if not isinstance(exc, eng.DubbingError):
                logger.exception("stem separation failed")
            p.update(status="ready", error=str(exc) if isinstance(exc, eng.DubbingError) else f"Separation failed: {exc}")
        finally:
            _tasks.pop(pid, None)
            _save(p)
    _tasks[pid] = asyncio.create_task(run())
    return {"ok": True, "mode": mode}


@router.post("/{pid}/mix")
async def mix(pid: str, payload: dict = Body(default={}), current_user: User = Depends(get_current_user_from_token)):
    """Render the edit: every line clip where the editor put it, the background and the video as cut in the editor.
    Writes the dub (voices only), one file per speaker, and, when the background has been separated, the dub over the
    background plus the video with that audio. The output is as long as the edit."""
    p = _get(pid, current_user)
    _idle(p)
    pdir = _dir(pid)
    meta_all = _line_meta(p)
    bg_gain = _clamp(payload.get("background_gain"), 0.0, 2.0, 1.0)
    edit = _edit(p)
    placed = []
    for l in edits.line_placements(p, edit, meta_all):
        f = pdir / "lines" / l.pop("file")
        if f.exists():
            placed.append(dict(l, wav=str(f)))
    if not placed:
        raise HTTPException(status_code=400, detail="Generate some speech first.")
    duration = float(p["duration"])
    total = edits.sequence_end(p, edit, meta_all)
    on = edits.audible(edit)
    bg = pdir / "stems" / "background.wav"
    bg_pieces = edits.media_placements(p, edit, "A2")
    if not on.get("A2", True) or not bg_pieces:
        bg = pdir / "stems" / "-"  # the background track is muted, soloed away or emptied in the editor
    master = float((edit.get("master") or {}).get("volume", 1.0))
    vplan = edits.video_plan(p, edit, total) if p["is_video"] else {"pieces": [], "plain": True}
    overlays = edits.overlay_items(edit) if p["is_video"] else []
    missing = [o for o in overlays if not (pdir / "overlays" / f"{o['image']}.png").exists()]
    overlays = [o for o in overlays if o not in missing]
    plain_video = vplan["plain"] and not overlays and total <= duration + 0.05

    async def run():
        try:
            p.update(status="rendering", stage="mixing", percent=5.0, detail="Mixing the dub", error=None)
            out_dir = pdir / "out"
            out_dir.mkdir(exist_ok=True)
            tmp = out_dir / "dub.wav"
            await asyncio.to_thread(eng.mix_timeline, placed, total, str(tmp), master)
            await asyncio.to_thread(eng.wav_to_mp3, str(tmp), str(out_dir / "dub.mp3"))
            outputs: Dict[str, Any] = {"audio": "dub.mp3", "speakers": {}, "mixed_at": time.time(), "background_gain": bg_gain, "length": total}
            final_audio = out_dir / "dub.mp3"
            if bg.exists():
                p.update(percent=40.0, detail="Mixing with the background")
                bg_src = bg
                temps = []
                if not (edits.is_identity(bg_pieces, duration) and abs(total - duration) < 0.05):
                    bg_src = out_dir / "background_edit.wav"
                    await asyncio.to_thread(stems.assemble_track, str(bg), edits.concat_plan(bg_pieces, total), str(bg_src))
                    temps.append(bg_src)
                levels = edits.track_gain_fn(p, edit, "A2", meta_all)  # clip levels, fader, ducking, master
                if levels:
                    p.update(percent=30.0, detail="Applying the background levels and ducking")
                    shaped = out_dir / "background_levels.wav"
                    await asyncio.to_thread(stems.apply_gain, str(bg_src), str(shaped), levels)
                    bg_src = shaped
                    temps.append(shaped)
                # the voices at their exact levels (float, no normalising) so the balance with the background is kept
                exact = out_dir / "dub_exact.wav"
                await asyncio.to_thread(eng.mix_timeline, placed, total, str(exact), master, False)
                temps.append(exact)
                await asyncio.to_thread(stems.mix_with_background, str(bg_src), str(exact), bg_gain, str(out_dir / "mixed.mp3"))
                for f in temps:
                    f.unlink(missing_ok=True)
                outputs["mixed"] = "mixed.mp3"
                final_audio = out_dir / "mixed.mp3"
            tmp.unlink(missing_ok=True)
            for name in p["speakers"]:
                mine = [l for l in placed if l["speaker"] == name]
                if not mine:
                    continue
                stem = "".join(c if c.isalnum() else "_" for c in name)
                w = out_dir / f"{stem}.wav"
                await asyncio.to_thread(eng.mix_timeline, mine, total, str(w))
                await asyncio.to_thread(eng.wav_to_mp3, str(w), str(out_dir / f"{stem}.mp3"))
                w.unlink(missing_ok=True)
                outputs["speakers"][name] = f"{stem}.mp3"
            if p["is_video"]:
                if plain_video:
                    p.update(percent=70.0, detail="Putting the new audio on the video")
                    await asyncio.to_thread(eng.mux_video, p["media_path"], str(final_audio), str(out_dir / "dub.mp4"))
                else:
                    p.update(percent=70.0, detail="Rendering the edited video")
                    await asyncio.to_thread(eng.render_picture, p["media_path"], vplan, overlays, str(pdir / "overlays"), str(final_audio), str(out_dir / "dub.mp4"))
                outputs["video"] = "dub.mp4"
            if missing:
                outputs["warning"] = f"{len(missing)} text overlays were left out because their pictures had not reached the server. Open the Editor so it can send them, then mix again."
            p["outputs"] = outputs
            p.update(status="ready", stage="mixed", percent=100.0, detail="Dub mixed")
        except asyncio.CancelledError:
            p.update(status="ready", error="Cancelled.")
        except Exception as exc:
            logger.exception("mix failed")
            p.update(status="ready", error=str(exc) if isinstance(exc, eng.DubbingError) else f"Mixing failed: {exc}")
        finally:
            _tasks.pop(pid, None)
            _save(p)
    _tasks[pid] = asyncio.create_task(run())
    return {"ok": True}


# --------------------------------------------------------------------------------------------- editor (edit / sequence)
def _edit(p: Dict[str, Any]) -> Dict[str, Any]:
    """The project's edit, brought up to date with its lines and media (seeded on first use)."""
    return edits.reconcile(p, p["edit"]) if p.get("edit") else edits.seed(p)


def _probe_fps(path: str) -> float:
    """Frame rate of the video (for frame stepping and timecode in the editor); 25 when it cannot be read."""
    import re
    r = subprocess.run([eng._ffmpeg(), "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace", timeout=60)
    m = re.search(r"Video:.*?(\d+(?:\.\d+)?) fps", r.stderr or "")
    fps = float(m.group(1)) if m else 25.0
    return fps if 5.0 <= fps <= 120.0 else 25.0


@router.get("/{pid}/edit")
async def get_edit(pid: str, current_user: User = Depends(get_current_user_from_token)):
    p = _get(pid, current_user)
    if not p.get("fps"):
        p["fps"] = await asyncio.to_thread(_probe_fps, p["media_path"]) if p.get("is_video") else 25.0
        _save(p)
    if p.get("is_video") and not p.get("video_info"):
        try:
            p["video_info"] = await asyncio.to_thread(eng.probe_video, p["media_path"])
            _save(p)
        except Exception:
            logger.warning("could not probe the video size of %s", pid)
    return {"edit": _edit(p), "stored": bool(p.get("edit")), "fps": p["fps"], "video": p.get("video_info")}


@router.get("/{pid}/thumbs")
async def thumbnails(pid: str, current_user: User = Depends(get_current_user_from_token)):
    """Frames for the video track: a sprite sheet (GET .../thumbs.jpg) and how to read it."""
    p = _get(pid, current_user)
    if not p.get("is_video"):
        raise HTTPException(status_code=404, detail="This project has no video.")
    pdir = _dir(pid)
    meta = pdir / "thumbs.json"
    if meta.exists() and (pdir / "thumbs.jpg").exists():
        return json.loads(meta.read_text())
    try:
        data = await asyncio.to_thread(eng.thumbnail_sprite, p["media_path"], str(pdir / "thumbs.jpg"), float(p["duration"]))
    except eng.DubbingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    meta.write_text(json.dumps(data))
    return data


@router.get("/{pid}/thumbs.jpg")
async def thumbnails_image(pid: str, current_user: User = Depends(get_current_user_from_token)):
    _get(pid, current_user)
    f = _dir(pid) / "thumbs.jpg"
    if not f.exists():
        raise HTTPException(status_code=404, detail="No thumbnails yet.")
    return FileResponse(f, media_type="image/jpeg")


def _overlay_name(name: str) -> str:
    if not (8 <= len(name) <= 64 and all(ch in "0123456789abcdef" for ch in name)):
        raise HTTPException(status_code=400, detail="Bad overlay name.")
    return name


@router.get("/{pid}/overlays")
async def list_overlays(pid: str, current_user: User = Depends(get_current_user_from_token)):
    """The text-overlay pictures the server already has (by name), so the editor only sends new ones."""
    _get(pid, current_user)
    d = _dir(pid) / "overlays"
    return {"names": sorted(f.stem for f in d.glob("*.png") if not f.stem.startswith("blank_")) if d.exists() else []}


@router.put("/{pid}/overlays/{name}")
async def put_overlay(pid: str, name: str, request: Request, current_user: User = Depends(get_current_user_from_token)):
    """Store a text-overlay picture drawn by the editor (a PNG the size of the video, transparent around the text)."""
    p = _get(pid, current_user)
    name = _overlay_name(name)
    body = await request.body()
    if len(body) > 12 * 1024 * 1024 or not body.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail="Send a PNG picture (at most 12 MB).")
    d = _dir(pid) / "overlays"
    d.mkdir(exist_ok=True)
    if len(list(d.glob("*.png"))) > 6000:
        raise HTTPException(status_code=400, detail="This project has too many text overlays.")
    (d / f"{name}.png").write_bytes(body)
    return {"ok": True, "name": name}


@router.get("/{pid}/overlays/{name}.png")
async def get_overlay(pid: str, name: str, current_user: User = Depends(get_current_user_from_token)):
    _get(pid, current_user)
    f = _dir(pid) / "overlays" / f"{_overlay_name(name)}.png"
    if not f.exists():
        raise HTTPException(status_code=404, detail="No such overlay.")
    return FileResponse(f, media_type="image/png")


@router.put("/{pid}/edit")
async def put_edit(pid: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    """Save the edit from the editor: clip positions and trims, disabled clips, track mute / solo / lock / volume."""
    p = _get(pid, current_user)
    lengths = {}
    for s in p["segments"]:
        st = line_state(p, s)
        lengths[s["id"]] = st["duration"] if st.get("ready") else round(s["end"] - s["start"], 3)
    try:
        p["edit"] = edits.clean(p, payload.get("edit"), lengths)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _save(p)
    return {"edit": p["edit"], "stored": True}


@router.delete("/{pid}/edit")
async def reset_edit(pid: str, current_user: User = Depends(get_current_user_from_token)):
    """Throw the edit away and start again from the lines at their own times."""
    p = _get(pid, current_user)
    p.pop("edit", None)
    _save(p)
    return {"edit": _edit(p), "stored": False}


@router.get("/{pid}/waveform/lines")
async def line_waveforms(pid: str, current_user: User = Depends(get_current_user_from_token)):
    """Loudness envelopes of every generated line (50 points per second), keyed by line id, with the audio revision."""
    p = _get(pid, current_user)
    pdir = _dir(pid)
    cache = pdir / "lines" / "peaks.json"
    try:
        old = json.loads(cache.read_text()) if cache.exists() else {}
    except Exception:
        old = {}
    out: Dict[str, Any] = {}
    for sid, m in _line_meta(p).items():
        f = pdir / "lines" / (m.get("file") or "-")
        if not f.exists():
            continue
        if (old.get(sid) or {}).get("rev") == m.get("rev"):
            out[sid] = old[sid]
            continue
        try:
            d = await asyncio.to_thread(_line_peaks, str(f))
        except Exception:
            continue
        out[sid] = dict(d, rev=m.get("rev"))
    if out != old:
        try:
            cache.write_text(json.dumps(out))
        except OSError:
            pass
    return {"lines": out}


def _line_peaks(path: str, per_second: int = 50) -> Dict[str, Any]:
    import numpy as np
    import soundfile as sf
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    x = np.abs(x).max(axis=1)
    n = max(1, int(len(x) / sr * per_second))
    edges = np.linspace(0, len(x), n + 1).astype(int)
    peaks = [round(float(x[a:b].max()) if b > a else 0.0, 3) for a, b in zip(edges[:-1], edges[1:])]
    return {"peaks": peaks, "duration": round(len(x) / sr, 3)}


def _peaks(path: str, duration: float, points: int) -> Dict[str, Any]:
    import numpy as np
    r = subprocess.run([eng._ffmpeg(), "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "-"], capture_output=True, timeout=1800)
    if r.returncode != 0:
        raise eng.DubbingError("Could not read the audio for the waveform.")
    x = np.abs(np.frombuffer(r.stdout, dtype="<i2").astype("float32")) / 32768.0
    if not len(x):
        return {"peaks": [], "duration": duration}
    n = max(1, min(points, len(x)))
    edges = np.linspace(0, len(x), n + 1).astype(int)
    peaks = [round(float(x[a:b].max()) if b > a else 0.0, 3) for a, b in zip(edges[:-1], edges[1:])]
    top = max(peaks) or 1.0
    return {"peaks": [round(v / top, 3) for v in peaks], "duration": duration}


@router.get("/{pid}/waveform/{track}")
async def waveform(pid: str, track: str, current_user: User = Depends(get_current_user_from_token)):
    """Loudness envelope of the original recording or the separated background, for the timeline."""
    p = _get(pid, current_user)
    pdir = _dir(pid)
    src = p["media_path"] if track == "original" else str(pdir / "stems" / "background.wav") if track == "background" else None
    if not src or not Path(src).exists():
        raise HTTPException(status_code=404, detail="No such track yet.")
    cache = pdir / f"peaks_{track}.json"
    if cache.exists() and cache.stat().st_mtime >= Path(src).stat().st_mtime:
        return json.loads(cache.read_text())
    try:
        data = await asyncio.to_thread(_peaks, src, float(p["duration"]), min(12000, max(400, int(p["duration"] * 25))))
    except eng.DubbingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    cache.write_text(json.dumps(data))
    return data


@router.get("/{pid}/download/{kind}")
async def download(pid: str, kind: str, speaker: Optional[str] = None, current_user: User = Depends(get_current_user_from_token)):
    p = _get(pid, current_user)
    out = p.get("outputs") or {}
    stem = Path(p["filename"]).stem
    lang = p.get("target_language") or "dub"
    if kind == "audio" and out.get("audio"):
        return FileResponse(_dir(pid) / "out" / out["audio"], media_type="audio/mpeg", filename=f"{stem}.{lang}.dub.mp3")
    if kind == "mixed" and out.get("mixed"):
        return FileResponse(_dir(pid) / "out" / out["mixed"], media_type="audio/mpeg", filename=f"{stem}.{lang}.dub-with-background.mp3")
    if kind == "video" and out.get("video"):
        return FileResponse(_dir(pid) / "out" / out["video"], media_type="video/mp4", filename=f"{stem}.{lang}.dub.mp4")
    if kind in ("background", "vocals") and (_dir(pid) / "stems" / f"{kind}.mp3").exists():
        return FileResponse(_dir(pid) / "stems" / f"{kind}.mp3", media_type="audio/mpeg", filename=f"{stem}.{kind}.mp3")
    if kind == "speaker" and speaker and (out.get("speakers") or {}).get(speaker):
        safe = "".join(c if c.isalnum() else "_" for c in speaker)
        return FileResponse(_dir(pid) / "out" / out["speakers"][speaker], media_type="audio/mpeg", filename=f"{stem}.{lang}.{safe}.mp3")
    raise HTTPException(status_code=404, detail="That file is not available. Mix the dub first.")
