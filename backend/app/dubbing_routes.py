"""HTTP API for the Dubbing Studio (separate from Transcribe Studio and Subtitle Studio).

A dubbing job moves through: analysing (transcribe + speaker profiles) -> translating -> rendering.
The user reviews the speakers and the translated lines between the steps. Hours are held when the job is created,
for the full media length, using the same metering as transcription.
"""
import asyncio
import json
import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import dubbing_service as svc
from app import metering
from app.auth_module import usage as usage_mod
from app.auth_module.models import User
from app.auth_module.routes import get_current_user_from_token
from app.config import GEMINI_API_KEY, UPLOAD_DIR
from app.elevenlabs_service import get_elevenlabs_api_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dubbing", tags=["dubbing"])

DUB_DIR = UPLOAD_DIR / "dubbing"
DUB_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
JOB_TTL_SEC = 48 * 3600

_jobs: Dict[str, Dict[str, Any]] = {}
_tasks: Dict[str, asyncio.Task] = {}
_PRIVATE = {"media_path", "audio_path", "owner", "updated"}


def _dir(job_id: str) -> Path:
    if not job_id.isalnum():
        raise HTTPException(status_code=404, detail="Dubbing job not found.")
    return DUB_DIR / job_id


def _save(job: Dict[str, Any]) -> None:
    job["updated"] = time.time()
    try:
        (_dir(job["id"]) / "job.json").write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logger.exception("could not persist dubbing job %s", job.get("id"))


def _get(job_id: str, user: User) -> Dict[str, Any]:
    job = _jobs.get(job_id)
    if job is None:
        f = _dir(job_id) / "job.json"
        if f.exists():
            try:
                job = json.loads(f.read_text(encoding="utf-8"))
                if job.get("status") in ("analyzing", "translating", "rendering"):  # the server restarted mid-run
                    job.update(status="error", error="The server restarted while this was running. Start it again.")
                _jobs[job_id] = job
            except Exception:
                job = None
    if job is None or job.get("owner") != user.id:
        raise HTTPException(status_code=404, detail="Dubbing job not found.")
    return job


def _public(job: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in job.items() if k not in _PRIVATE}
    out["has_video"] = bool(job.get("is_video"))
    return out


def _progress(job: Dict[str, Any], base: float, span: float):
    def cb(stage: str, frac: float, detail: str = "") -> None:
        job.update(stage=stage, percent=round(min(99.0, base + span * max(0.0, min(1.0, frac))), 1), detail=detail)
    return cb


def _prune() -> None:
    now = time.time()
    for d in DUB_DIR.iterdir():
        try:
            if d.is_dir() and now - d.stat().st_mtime > JOB_TTL_SEC and d.name not in _tasks:
                shutil.rmtree(d, ignore_errors=True)
                _jobs.pop(d.name, None)
        except Exception:
            pass


@router.get("/config")
async def dubbing_config(current_user: User = Depends(get_current_user_from_token)):
    return {
        "languages": list(svc.LANGUAGES),
        "elevenlabs_configured": bool(get_elevenlabs_api_key()),
        "gemini_configured": bool(GEMINI_API_KEY and len(GEMINI_API_KEY.strip()) > 5),
    }


# ---------------------------------------------------------------------------------------------- 1. analyse
async def _analyze(job: Dict[str, Any], meter: "metering.Metered", language: str) -> None:
    from app.scribe_transcriber import process_audio_file
    from app.video_processor import extract_audio_from_video
    jdir = _dir(job["id"])
    try:
        job.update(status="analyzing", stage="extracting", percent=2.0, detail="Reading the audio")
        audio_path = job["media_path"]
        if job["is_video"] or Path(audio_path).suffix.lower() not in (".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"):
            info = await asyncio.to_thread(extract_audio_from_video, audio_path)
            audio_path = info.get("audio_path") or audio_path

        hook = metering.transcribe_stage_hook(meter)

        def on_stage(stage, overall, detail="", stage_pct=None):
            hook(stage)
            job.update(stage=stage, percent=round(min(70.0, 5.0 + float(overall) * 0.65), 1), detail=detail)

        result = await process_audio_file(
            audio_path=audio_path, language=language, script="Auto-Detect",
            video_path=job["media_path"] if job["is_video"] else None, progress_cb=on_stage,
        )
        segs = [
            {"id": i, "speaker": s.speaker, "gender": s.gender, "start": round(s.start_time, 3), "end": round(s.end_time, 3),
             "text": (s.transcript or "").strip()}
            for i, s in enumerate(result.segments, 1) if (s.transcript or "").strip() and s.end_time > s.start_time
        ]
        if not segs:
            raise svc.DubbingError("No speech was found in this file.")
        job["segments"] = segs
        job["source_language"] = result.language
        meter.finish(True)  # transcription done and paid for

        job.update(stage="profiling", percent=72.0, detail="Profiling the speakers")
        job["profiles"] = await svc.speaker_profiles(job["media_path"], segs, result.language, jdir, _progress(job, 72.0, 26.0))
        job.update(status="analyzed", stage="analyzed", percent=100.0, detail="Speakers ready", error=None)
    except asyncio.CancelledError:
        meter.on_error(asyncio.CancelledError())
        job.update(status="error", error="Cancelled.", cancelled=True)
    except Exception as exc:
        meter.on_error(exc)
        if not isinstance(exc, svc.DubbingError):
            logger.exception("dubbing analysis failed")
        job.update(status="error", error=str(exc) if isinstance(exc, svc.DubbingError) else f"Analysis failed: {exc}")
    finally:
        meter.on_error(RuntimeError("job ended"))  # no-op once closed
        _tasks.pop(job["id"], None)
        _save(job)


@router.post("/jobs")
async def create_job(
    file: UploadFile = File(...),
    source_language: str = Form("Auto-Detect"),
    current_user: User = Depends(get_current_user_from_token),
):
    from app.video_processor import get_supported_media_extensions, get_supported_video_extensions
    _prune()
    if not get_elevenlabs_api_key():
        raise HTTPException(status_code=503, detail="ElevenLabs is not configured on the server, so dubbing is unavailable.")
    name = Path(file.filename or "media").name
    ext = Path(name).suffix.lower()
    if ext not in get_supported_media_extensions():
        raise HTTPException(status_code=415, detail="That file type is not supported. Upload an audio or video file.")
    language = "Auto-Detect"
    if str(source_language).strip().lower() not in ("", "auto", "auto-detect"):
        try:
            language = svc.normalize_language(source_language)
        except svc.DubbingError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    job_id = uuid.uuid4().hex[:12]
    jdir = _dir(job_id)
    jdir.mkdir(parents=True)
    media = jdir / f"source{ext}"
    size = 0
    with open(media, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                shutil.rmtree(jdir, ignore_errors=True)
                raise HTTPException(status_code=413, detail="File too large. The limit is 1 GB.")
            out.write(chunk)
    try:
        ms = await metering.probe_duration_ms(str(media))
        meter = metering.Metered(metering.user_ref(current_user), usage_mod.TRANSCRIBE, ms, "/api/dubbing/jobs", f"dub:{job_id}:{name}").reserve()
    except HTTPException:
        shutil.rmtree(jdir, ignore_errors=True)
        raise

    job: Dict[str, Any] = {
        "id": job_id, "owner": current_user.id, "filename": name, "media_path": str(media),
        "is_video": ext in get_supported_video_extensions(), "duration": round(ms / 1000.0, 2),
        "status": "analyzing", "stage": "queued", "percent": 0.0, "detail": "Queued", "error": None,
        "source_language": language, "target_language": None, "segments": [], "profiles": {}, "translations": {},
        "voice_modes": {}, "outputs": None, "created": time.time(),
    }
    _jobs[job_id] = job
    _save(job)
    _tasks[job_id] = asyncio.create_task(_analyze(job, meter, language))
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, current_user: User = Depends(get_current_user_from_token)):
    return _public(_get(job_id, current_user))


# ---------------------------------------------------------------------------------------------- 2. translate
async def _translate(job: Dict[str, Any], target: str) -> None:
    try:
        job.update(status="translating", stage="translating", percent=1.0, detail="Translating for dubbing", error=None)
        texts = await svc.translate_lines(job["segments"], job["profiles"], svc.normalize_language(job["source_language"]),
                                          target, _progress(job, 1.0, 98.0))
        job["translations"] = {str(k): v for k, v in texts.items()}
        job["target_language"] = target
        job.update(status="translated", stage="translated", percent=100.0, detail="Review the lines", outputs=None)
    except asyncio.CancelledError:
        job.update(status="analyzed", error="Cancelled.", cancelled=True)
    except Exception as exc:
        if not isinstance(exc, svc.DubbingError):
            logger.exception("dubbing translation failed")
        job.update(status="analyzed" if not job.get("translations") else "translated",
                   error=str(exc) if isinstance(exc, svc.DubbingError) else f"Translation failed: {exc}")
    finally:
        _tasks.pop(job["id"], None)
        _save(job)


@router.post("/jobs/{job_id}/translate")
async def start_translate(job_id: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    job = _get(job_id, current_user)
    if job["status"] not in ("analyzed", "translated", "done") or job["id"] in _tasks:
        raise HTTPException(status_code=409, detail="This job is busy or not ready to translate.")
    try:
        target = svc.normalize_language(payload.get("target_language"))
        if target == svc.normalize_language(job["source_language"]):
            raise svc.DubbingError(f"This media is already in {target}. Pick the other language.")
    except svc.DubbingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _tasks[job_id] = asyncio.create_task(_translate(job, target))
    return {"ok": True}


@router.post("/jobs/{job_id}/edit")
async def edit_job(job_id: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    """Save the user's edits: dubbed line text and each speaker's voice choice."""
    job = _get(job_id, current_user)
    if job["id"] in _tasks:
        raise HTTPException(status_code=409, detail="This job is busy.")
    for sid, text in (payload.get("lines") or {}).items():
        if str(sid) in job["translations"] and isinstance(text, str) and text.strip():
            job["translations"][str(sid)] = text.strip()
    for name, mode in (payload.get("voice_modes") or {}).items():
        if name in job["profiles"] and mode in ("clone", "stock"):
            job["voice_modes"][name] = mode
    _save(job)
    return {"ok": True}


# ---------------------------------------------------------------------------------------------- 3. render
async def _render(job: Dict[str, Any]) -> None:
    try:
        job.update(status="rendering", stage="voices", percent=1.0, detail="Preparing voices", error=None)
        texts = {int(k): v for k, v in job["translations"].items()}
        out = await svc.render_dub(
            _dir(job["id"]), job["media_path"], job["is_video"], float(job["duration"]), job["segments"], job["profiles"],
            texts, job["target_language"], job["voice_modes"], _progress_render(job),
        )
        job["translations"] = {str(k): v for k, v in out["texts"].items()}
        job["outputs"] = {"files": out["files"], "notes": out["notes"], "voices": out["voices"], "overruns": out["overruns"]}
        job.update(status="done", stage="done", percent=100.0, detail="Dub ready")
    except asyncio.CancelledError:
        job.update(status="translated", error="Cancelled.", cancelled=True)
    except Exception as exc:
        if not isinstance(exc, svc.DubbingError):
            logger.exception("dubbing render failed")
        job.update(status="translated", error=str(exc) if isinstance(exc, svc.DubbingError) else f"Dubbing failed: {exc}")
    finally:
        _tasks.pop(job["id"], None)
        _save(job)


def _progress_render(job: Dict[str, Any]):
    spans = {"voices": (1.0, 9.0), "speaking": (10.0, 80.0), "mixing": (90.0, 9.0)}

    def cb(stage: str, frac: float, detail: str = "") -> None:
        base, span = spans.get(stage, (0.0, 0.0))
        job.update(stage=stage, percent=round(min(99.0, base + span * max(0.0, min(1.0, frac))), 1), detail=detail)
    return cb


@router.post("/jobs/{job_id}/render")
async def start_render(job_id: str, payload: dict, current_user: User = Depends(get_current_user_from_token)):
    job = _get(job_id, current_user)
    if job["status"] not in ("translated", "done") or job["id"] in _tasks:
        raise HTTPException(status_code=409, detail="Translate the lines first, or wait for the current step to finish.")
    if not payload.get("consent"):
        raise HTTPException(status_code=400, detail="Confirm that you have the right to clone these voices.")
    for name, mode in (payload.get("voice_modes") or {}).items():
        if name in job["profiles"] and mode in ("clone", "stock"):
            job["voice_modes"][name] = mode
    _tasks[job_id] = asyncio.create_task(_render(job))
    return {"ok": True}


@router.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str, current_user: User = Depends(get_current_user_from_token)):
    _get(job_id, current_user)
    task = _tasks.get(job_id)
    if task:
        task.cancel()
    return {"ok": True}


# ---------------------------------------------------------------------------------------------- downloads
@router.get("/jobs/{job_id}/download/{kind}")
async def download(job_id: str, kind: str, speaker: Optional[str] = None, current_user: User = Depends(get_current_user_from_token)):
    job = _get(job_id, current_user)
    files = (job.get("outputs") or {}).get("files") or {}
    stem = Path(job["filename"]).stem
    lang = job.get("target_language") or "dub"
    if kind == "audio" and files.get("audio"):
        return FileResponse(_dir(job_id) / files["audio"], media_type="audio/mpeg", filename=f"{stem}.{lang}.dub.mp3")
    if kind == "video" and files.get("video"):
        return FileResponse(_dir(job_id) / files["video"], media_type="video/mp4", filename=f"{stem}.{lang}.dub.mp4")
    if kind == "speaker" and speaker and (files.get("speakers") or {}).get(speaker):
        safe = "".join(c if c.isalnum() else "_" for c in speaker)
        return FileResponse(_dir(job_id) / files["speakers"][speaker], media_type="audio/mpeg", filename=f"{stem}.{lang}.{safe}.mp3")
    raise HTTPException(status_code=404, detail="That file is not available.")


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, current_user: User = Depends(get_current_user_from_token)):
    _get(job_id, current_user)
    task = _tasks.get(job_id)
    if task:
        task.cancel()
    _jobs.pop(job_id, None)
    shutil.rmtree(_dir(job_id), ignore_errors=True)
    return {"ok": True}
