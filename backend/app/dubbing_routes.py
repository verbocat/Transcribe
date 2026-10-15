"""HTTP API for the Dubbing Studio (separate from Transcribe Studio and Subtitle Studio).

Dubbing runs on the ElevenLabs Dubbing API: it transcribes, separates the voices from the background, translates,
clones every speaker's voice in the target language and mixes the new voices back over the ORIGINAL music and
effects. This module uploads the file, waits for the result, stores it and bills the hours.

Hours are held for the full media length when the job is created (same metering as transcription) and charged once
the dub is delivered. A failed dub is refunded.
"""
import asyncio
import logging
import mimetypes
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import metering
from app.auth_module import usage as usage_mod
from app.auth_module.models import User
from app.auth_module.routes import get_current_user_from_token
from app.config import UPLOAD_DIR
from app.elevenlabs_service import get_elevenlabs_api_key
from app.video_processor import get_ffmpeg_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dubbing", tags=["dubbing"])

ELEVEN = "https://api.elevenlabs.io"
DUB_DIR = UPLOAD_DIR / "dubbing"
DUB_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
JOB_TTL_SEC = 48 * 3600
POLL_SEC = 5
MAX_WAIT_SEC = 3 * 3600

LANGUAGES = {
    "English": "en", "Hindi": "hi", "Tamil": "ta", "Spanish": "es", "French": "fr", "German": "de", "Portuguese": "pt",
    "Italian": "it", "Japanese": "ja", "Korean": "ko", "Chinese": "zh", "Arabic": "ar", "Russian": "ru", "Indonesian": "id",
}

_jobs: Dict[str, Dict[str, Any]] = {}
_tasks: Dict[str, asyncio.Task] = {}
_PRIVATE = {"media_path", "owner", "updated", "eleven_id"}


def _dir(job_id: str) -> Path:
    if not job_id.isalnum():
        raise HTTPException(status_code=404, detail="Dubbing job not found.")
    return DUB_DIR / job_id


def _save(job: Dict[str, Any]) -> None:
    import json
    job["updated"] = time.time()
    try:
        (_dir(job["id"]) / "job.json").write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logger.exception("could not persist dubbing job %s", job.get("id"))


def _get(job_id: str, user: User) -> Dict[str, Any]:
    import json
    job = _jobs.get(job_id)
    if job is None:
        f = _dir(job_id) / "job.json"
        if f.exists():
            try:
                job = json.loads(f.read_text(encoding="utf-8"))
                if job.get("status") == "dubbing" and job["id"] not in _tasks:
                    job.update(status="error", error="The server restarted while this was running. Start it again.")
                _jobs[job_id] = job
            except Exception:
                job = None
    if job is None or job.get("owner") != user.id:
        raise HTTPException(status_code=404, detail="Dubbing job not found.")
    return job


def _public(job: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in job.items() if k not in _PRIVATE}
    out["elapsed_sec"] = round((job.get("finished") or time.time()) - job.get("created", time.time()), 1)
    return out


def _prune() -> None:
    now = time.time()
    for d in DUB_DIR.iterdir():
        try:
            if d.is_dir() and now - d.stat().st_mtime > JOB_TTL_SEC and d.name not in _tasks:
                shutil.rmtree(d, ignore_errors=True)
                _jobs.pop(d.name, None)
        except Exception:
            pass


def _headers() -> Dict[str, str]:
    key = get_elevenlabs_api_key()
    if not key:
        raise HTTPException(status_code=503, detail="ElevenLabs is not configured on the server, so dubbing is unavailable.")
    return {"xi-api-key": key}


def _eleven_error(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        det = body.get("detail", body)
        if isinstance(det, dict):
            return f"{det.get('status', resp.status_code)}: {det.get('message', det)}"
        if isinstance(det, list) and det:
            return "; ".join(str(d.get("msg", d)) for d in det)
        return str(det)
    except Exception:
        return f"HTTP {resp.status_code}"


@router.get("/config")
async def dubbing_config(current_user: User = Depends(get_current_user_from_token)):
    return {"languages": list(LANGUAGES), "elevenlabs_configured": bool(get_elevenlabs_api_key())}


async def _run(job: Dict[str, Any], meter: "metering.Metered", src_code: str, tgt_code: str, num_speakers: int) -> None:
    jdir = _dir(job["id"])
    headers = _headers()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as client:
            job.update(stage="uploading", detail="Sending the file to the dubbing engine")
            media = Path(job["media_path"])
            mime = mimetypes.guess_type(media.name)[0] or "application/octet-stream"
            mode = os.getenv("DUBBING_WATERMARK", "auto").strip().lower()  # auto | on | off
            marks = ["true"] if mode in ("on", "true", "1") else ["false"] if mode in ("off", "false", "0") else ["false", "true"]
            for i, mark in enumerate(marks):
                with open(media, "rb") as fh:
                    resp = await client.post(
                        f"{ELEVEN}/v1/dubbing", headers=headers,
                        data={"target_lang": tgt_code, "source_lang": src_code, "num_speakers": str(num_speakers),
                              "watermark": mark, "highest_resolution": "true", "mode": "automatic", "name": job["filename"][:80]},
                        files={"file": (job["filename"], fh, mime)},
                    )
                if resp.status_code >= 400 and mark == "false" and i + 1 < len(marks) and "watermark_not_allowed" in resp.text:
                    job["detail"] = "Plan without watermark-free dubbing, retrying with a watermark"
                    continue
                job["watermarked"] = mark == "true"
                break
            if resp.status_code >= 400:
                raise RuntimeError(f"ElevenLabs refused the file ({_eleven_error(resp)})")
            eid = resp.json().get("dubbing_id")
            if not eid:
                raise RuntimeError("ElevenLabs did not return a dubbing id.")
            job["eleven_id"] = eid
            meter.work_started = True  # the paid call is under way: a cancel from here on is still charged
            job.update(stage="dubbing", detail="Transcribing, translating and cloning the voices")
            _save(job)

            waited = 0
            while True:
                await asyncio.sleep(POLL_SEC)
                waited += POLL_SEC
                st = await client.get(f"{ELEVEN}/v1/dubbing/{eid}", headers=headers)
                if st.status_code >= 400:
                    if waited > MAX_WAIT_SEC or st.status_code in (401, 403, 404):
                        raise RuntimeError(f"Could not read the dubbing status ({_eleven_error(st)})")
                    continue
                body = st.json()
                state = str(body.get("status") or "").lower()
                if state in ("dubbed", "complete", "completed"):
                    break
                if state in ("failed", "error"):
                    raise RuntimeError(f"The dubbing engine failed: {body.get('error') or 'unknown error'}")
                if waited > MAX_WAIT_SEC:
                    raise RuntimeError("Dubbing took too long and was stopped.")
                job["detail"] = "Dubbing in progress" + (f" ({state})" if state else "")

            job.update(stage="downloading", detail="Downloading the dubbed file")
            out_path = jdir / "dub.bin"
            async with client.stream("GET", f"{ELEVEN}/v1/dubbing/{eid}/audio/{tgt_code}", headers=headers) as dl:
                if dl.status_code >= 400:
                    await dl.aread()
                    raise RuntimeError(f"Could not download the dub ({_eleven_error(dl)})")
                ctype = dl.headers.get("content-type", "")
                with open(out_path, "wb") as f:
                    async for chunk in dl.aiter_bytes(1024 * 256):
                        f.write(chunk)
            is_video = "video" in ctype or (job["is_video"] and "audio" not in ctype)
            final = jdir / ("dub.mp4" if is_video else "dub.mp3")
            out_path.replace(final)
            files = {"video": final.name} if is_video else {"audio": final.name}
            if is_video:  # the finished audio track on its own (voices + original background)
                r = await asyncio.to_thread(
                    subprocess.run, [get_ffmpeg_path(), "-y", "-loglevel", "error", "-i", str(final), "-vn", "-b:a", "192k", str(jdir / "dub.mp3")],
                    capture_output=True, timeout=1800)
                if r.returncode == 0:
                    files["audio"] = "dub.mp3"
            meter.work_done = True
            meter.finish(True)
            job.update(status="done", stage="done", detail="Dub ready", files=files, error=None, finished=time.time())
            try:  # free the project on the ElevenLabs side
                await client.delete(f"{ELEVEN}/v1/dubbing/{eid}", headers=headers, timeout=30)
            except Exception:
                pass
    except asyncio.CancelledError:
        meter.on_error(asyncio.CancelledError())
        job.update(status="error", error="Cancelled.", cancelled=True, finished=time.time())
    except Exception as exc:
        logger.warning("dubbing job %s failed: %s", job["id"], exc)
        meter.on_error(exc)
        job.update(status="error", error=str(exc), finished=time.time())
    finally:
        meter.on_error(RuntimeError("job ended"))  # no-op once closed
        _tasks.pop(job["id"], None)
        _save(job)


@router.post("/jobs")
async def create_job(
    file: UploadFile = File(...),
    target_language: str = Form(...),
    source_language: str = Form("Auto-Detect"),
    num_speakers: int = Form(0),
    current_user: User = Depends(get_current_user_from_token),
):
    from app.video_processor import get_supported_media_extensions, get_supported_video_extensions
    _prune()
    _headers()
    tgt = LANGUAGES.get(target_language)
    if not tgt:
        raise HTTPException(status_code=400, detail=f"Pick one of: {', '.join(LANGUAGES)}.")
    src = "auto"
    if str(source_language).strip().lower() not in ("", "auto", "auto-detect"):
        src = LANGUAGES.get(source_language)
        if not src:
            raise HTTPException(status_code=400, detail="Unsupported spoken language.")
        if src == tgt:
            raise HTTPException(status_code=400, detail="The spoken and target language are the same.")
    name = Path(file.filename or "media").name
    ext = Path(name).suffix.lower()
    if ext not in get_supported_media_extensions():
        raise HTTPException(status_code=415, detail="That file type is not supported. Upload an audio or video file.")

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
        "target_language": target_language, "status": "dubbing", "stage": "queued", "detail": "Queued", "error": None,
        "files": None, "watermarked": None, "created": time.time(),
    }
    _jobs[job_id] = job
    _save(job)
    _tasks[job_id] = asyncio.create_task(_run(job, meter, src, tgt, max(0, min(num_speakers, 20))))
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, current_user: User = Depends(get_current_user_from_token)):
    return _public(_get(job_id, current_user))


@router.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str, current_user: User = Depends(get_current_user_from_token)):
    _get(job_id, current_user)
    task = _tasks.get(job_id)
    if task:
        task.cancel()
    return {"ok": True}


@router.get("/jobs/{job_id}/download/{kind}")
async def download(job_id: str, kind: str, current_user: User = Depends(get_current_user_from_token)):
    job = _get(job_id, current_user)
    files = job.get("files") or {}
    stem, lang = Path(job["filename"]).stem, job.get("target_language") or "dub"
    if kind == "audio" and files.get("audio"):
        return FileResponse(_dir(job_id) / files["audio"], media_type="audio/mpeg", filename=f"{stem}.{lang}.dub.mp3")
    if kind == "video" and files.get("video"):
        return FileResponse(_dir(job_id) / files["video"], media_type="video/mp4", filename=f"{stem}.{lang}.dub.mp4")
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
