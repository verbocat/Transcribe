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
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import dubbing_engines as eng
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
_PRIVATE = {"media_path", "owner", "updated"}
BUSY = ("transcribing", "profiling", "translating", "speaking", "rendering")


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


def _public(p: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in p.items() if k not in _PRIVATE}
    out["languages"] = {k: v["cps"] for k, v in eng.LANGUAGES.items()}
    return out


def _idle(p: Dict[str, Any]) -> None:
    if p["id"] in _tasks:
        raise HTTPException(status_code=409, detail="This project is busy. Wait for the current step to finish.")


def _progress(p: Dict[str, Any], base: float, span: float):
    def cb(stage: str, frac: float, detail: str = "") -> None:
        p.update(stage=stage, percent=round(min(99.0, base + span * max(0.0, min(1.0, frac))), 1), detail=detail)
    return cb


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
                    "translation": str(r.get("translation") or "").strip()})
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
