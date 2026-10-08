import os
import re
import sys
import logging
import urllib.parse
import asyncio
import shutil
import uuid
import json
import io
import time
import tempfile
from collections import defaultdict
from pathlib import Path
from contextlib import asynccontextmanager
from typing import List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse

# Configure root stdout logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("backend")

from app.terminal_logger import log_terminal
from app import job_control
from app.config import UPLOAD_DIR, EXPORTS_DIR, GEMINI_API_KEY, GEMINI_MODEL, DEFAULT_LANGUAGE, DEFAULT_SCRIPT, ELEVENLABS_API_KEY
from app.models import (
    TranscriptionResult, Segment, LintRequest, AutoFixRequest, ExportRequest, BatchTask, AudioAnalysis, WordConfidence, QCError
)
from app.scribe_transcriber import process_audio_file
from app.audio_processor import inspect_audio
from app.linter_engine import lint_dataset, apply_auto_fixes
from app.rejection_engine import evaluate_audio_quality
from app.export_service import (
    export_to_csv, export_to_tsv, export_to_txt,
    export_to_docx, export_to_xlsx, export_to_json, export_to_srt, export_to_vtt,
    export_to_dubbing_script,
    export_rejection_csv
)
from app.db import init_db, get_db_session, DBProject, DBSegment

from app.video_processor import (
    extract_audio_from_video, detect_shot_changes, get_video_metadata,
    get_frame_rate, validate_video_file, get_supported_video_extensions,
    get_supported_audio_extensions, get_supported_media_extensions, validate_media_file
)
from app.netflix_linter import lint_all_subtitles, auto_fix_subtitles, optimize_line_breaks
from app.netflix_models import (
    SubtitleEvent, NetflixQCResult, SubtitleGenerationRequest,
    SubtitleLintRequest, SubtitleAutoFixRequest, SubtitleExportRequest
)
from app.scribe_subtitle_generator import generate_subtitles, generate_subtitles_stream
from app.netflix_engine import (
    build_netflix_subtitles_from_words,
    audit_netflix_compliance,
    auto_fix_events_netflix,
    align_subtitles_to_words
)
from app.export_service import export_netflix_srt, export_netflix_vtt, export_netflix_ttml
from app.db import DBSubtitleProject, DBSubtitleEvent

# In-memory storage for active sessions with TTL eviction (BUG-W2)
active_sessions = {}
SESSION_TTL_SECONDS = 7200  # 2 hours

def _evict_expired_sessions():
    """BUG-W2: Evict expired sessions from memory."""
    now = time.time()
    expired = [
        k for k, v in active_sessions.items()
        if now - v.get("created_at", now) > SESSION_TTL_SECONDS
    ]
    for k in expired:
        active_sessions.pop(k, None)


# BUG-W1: In-memory sliding window rate limiter
_client_request_history = defaultdict(list)
RATE_LIMIT_PER_MINUTE = 300  # Generous rate limit (300 req/min) to accommodate sliced chunk uploads and telemetry

def get_client_ip(request: Request) -> str:
    """Extract real client IP behind reverse proxy (Render, Cloudflare, etc.)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"

def _check_rate_limit(client_ip: str):
    """BUG-W1: Enforce sliding window rate limit per client IP."""
    now = time.time()
    history = _client_request_history[client_ip]
    _client_request_history[client_ip] = [t for t in history if now - t < 60]
    if len(_client_request_history[client_ip]) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Maximum 300 requests per minute allowed."
        )
    _client_request_history[client_ip].append(now)


def _cleanup_old_uploads():
    """Remove uploaded audio files older than 24 hours."""
    cutoff = time.time() - 86400  # 24 hours
    for f in UPLOAD_DIR.glob("*"):
        try:
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
        except Exception:
            pass


def purge_media_files_for_stem(
    clean_stem: Optional[str] = None,
    raw_stem: Optional[str] = None,
    video_id: Optional[str] = None,
    exclude_prefixes: Optional[List[str]] = None
) -> List[str]:
    """
    Surgically purge all previous media files (.wav, .mp3, .mp4, .peaks.json, .part, temp_chunk_*.wav)
    and active_sessions matching a given media stem.
    If exclude_prefixes is provided, leaves current active upload prefix untouched.
    """
    stems_to_match = set()
    if clean_stem:
        c = re.sub(r'[^\w\.-]', '_', str(clean_stem)).strip('_')
        c = re.sub(r'_+', '_', c)
        if len(c) >= 2:
            stems_to_match.add(c.lower())
    if raw_stem:
        r = Path(str(raw_stem)).stem
        if len(r) >= 2:
            stems_to_match.add(r.lower())
            r_clean = re.sub(r'[^\w\.-]', '_', r).strip('_')
            r_clean = re.sub(r'_+', '_', r_clean)
            if len(r_clean) >= 2:
                stems_to_match.add(r_clean.lower())
    if video_id:
        v_unquoted = urllib.parse.unquote(str(video_id)).strip()
        stems_to_match.add(v_unquoted.lower())
        v_stem = Path(v_unquoted).stem
        if len(v_stem) >= 2:
            stems_to_match.add(v_stem.lower())
        unprefixed = re.sub(r'^(?:up_[a-z0-9]+|[a-f0-9]{8})_', '', v_unquoted, flags=re.IGNORECASE).strip('_')
        if len(unprefixed) >= 2:
            stems_to_match.add(unprefixed.lower())

    valid_stems = {s for s in stems_to_match if len(s) >= 2}
    extra_stems = set()
    for s in valid_stems:
        base = re.sub(r'_(?:audio|16k)$', '', s, flags=re.IGNORECASE).strip('_')
        if len(base) >= 2:
            extra_stems.add(base.lower())
        if '_' in s:
            extra_stems.add(s.replace('_', ' ').strip().lower())
        if ' ' in s:
            extra_stems.add(s.replace(' ', '_').strip().lower())
    valid_stems.update(extra_stems)

    if not valid_stems:
        return []

    deleted_files = []
    upload_root = UPLOAD_DIR.resolve()
    supported_media = get_supported_media_extensions()
    exclude_list = [p.lower() for p in (exclude_prefixes or []) if p]

    for file_path in list(UPLOAD_DIR.glob("*")):
        if not file_path.is_file():
            continue

        try:
            if upload_root not in file_path.resolve().parents:
                continue
        except Exception:
            continue

        fname_lower = file_path.name.lower()
        fext_lower = file_path.suffix.lower()

        # Check if this file belongs to an excluded current prefix (e.g. current in-flight upload)
        if any(fname_lower.startswith(prefix) for prefix in exclude_list):
            continue

        is_peaks_cache = fname_lower.endswith(".peaks.json")
        is_wav = fext_lower == ".wav"
        is_part = fext_lower == ".part"
        is_media = fext_lower in supported_media
        is_temp_chunk = fname_lower.startswith("temp_chunk_") and fext_lower == ".wav"

        if not (is_peaks_cache or is_wav or is_part or is_media or is_temp_chunk):
            continue

        if any(s in fname_lower for s in valid_stems):
            try:
                file_path.unlink(missing_ok=True)
                deleted_files.append(file_path.name)
            except Exception as e:
                print(f"Non-fatal error deleting {file_path.name}: {e}")

    # Evict matching entries from active_sessions
    for sess_id in list(active_sessions.keys()):
        if any(sess_id.lower().startswith(p) for p in exclude_list):
            continue
        sess_info = active_sessions.get(sess_id, {})
        sess_fname = str(sess_info.get("filename", "")).lower()
        sess_path = str(sess_info.get("file_path", "")).lower()
        sess_id_lower = str(sess_id).lower()

        if any(s in sess_id_lower or s in sess_fname or s in sess_path for s in valid_stems):
            active_sessions.pop(sess_id, None)

    return deleted_files


from app.auth_module import auth_router
from app.auth_module.database import init_auth_db, SessionLocal
from app.auth_module.models import SystemHardwareSnapshot
from app.admin_routes import (
    admin_router, get_live_hardware_stats,
    increment_active_stream, decrement_active_stream
)


async def _hardware_monitor_loop():
    """Background sampler recording system hardware snapshots every 60s."""
    from sqlalchemy import func
    from datetime import datetime, timezone, timedelta
    while True:
        try:
            await asyncio.sleep(60)
            stats = get_live_hardware_stats()
            db = SessionLocal()
            try:
                snap = SystemHardwareSnapshot(
                    cpu_percent=stats["cpu_percent"],
                    memory_used_mb=stats["memory_used_mb"],
                    memory_total_mb=stats["memory_total_mb"],
                    memory_percent=stats["memory_percent"],
                    disk_used_gb=stats["disk_used_gb"],
                    disk_free_gb=stats["disk_free_gb"],
                    disk_percent=stats["disk_percent"],
                    active_sse_streams=stats["active_sse_streams"],
                )
                db.add(snap)
                # Keep maximum last 1440 snapshots (24 hours)
                total_snaps = db.query(func.count(SystemHardwareSnapshot.id)).scalar() or 0
                if total_snaps > 1440:
                    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
                    db.query(SystemHardwareSnapshot).filter(SystemHardwareSnapshot.recorded_at < cutoff).delete()
                db.commit()
            except Exception as e:
                db.rollback()
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle handler."""
    _cleanup_old_uploads()
    _evict_expired_sessions()
    init_db()
    init_auth_db()
    monitor_task = asyncio.create_task(_hardware_monitor_loop())
    # Load the local gender model now so the first transcription does not pay for it
    try:
        from app.gender_local import _get_session as _warm_gender_model
        asyncio.get_running_loop().run_in_executor(None, _warm_gender_model)
    except Exception:
        pass
    yield
    monitor_task.cancel()


app = FastAPI(
    title="Lower Third Transcription & Subtitle Studio",
    description="Automated verbatim transcription, speaker diarization, QA linter & batch pipeline",
    version="1.0.0",
    lifespan=lifespan
)
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_router)

# Requests tagged with an X-Job-Id header can be stopped with POST /api/jobs/{job_id}/cancel.
# Added before CORS so the CORS middleware stays outermost and still decorates a cancelled response.
app.add_middleware(job_control.JobScopeMiddleware)

# CORS configuration with explicit Vercel and local dev support
DEFAULT_ALLOWED_ORIGINS = [
    "https://transcribe-eight-eta.vercel.app",
    "https://transcribe.verbolabs.com",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
for default_o in DEFAULT_ALLOWED_ORIGINS:
    if default_o not in ALLOWED_ORIGINS:
        ALLOWED_ORIGINS.append(default_o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Credentialed requests are only accepted from known origins: the list above, any localhost
    # port (dev), any *.verbolabs.com host, plus an optional ALLOWED_ORIGIN_REGEX from the environment.
    allow_origin_regex=os.getenv(
        "ALLOWED_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://([a-z0-9-]+\.)*verbolabs\.com$",
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


_CORS_ORIGIN_RE = re.compile(
    os.getenv(
        "ALLOWED_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://([a-z0-9-]+\.)*verbolabs\.com$",
    )
)


def _cors_headers(request) -> dict:
    """CORS headers for responses built outside CORSMiddleware; only for origins on the allow-list."""
    origin = request.headers.get("origin")
    if not origin or not (origin in ALLOWED_ORIGINS or _CORS_ORIGIN_RE.match(origin)):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
        "Vary": "Origin",
    }


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    """Ensure HTTP exceptions (e.g. 429, 404, 413) always include CORS headers."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=_cors_headers(request),
    )


@app.exception_handler(Exception)
async def custom_general_exception_handler(request: Request, exc: Exception):
    """Ensure unhandled 500 exceptions always include CORS headers so browsers see the real error."""
    import traceback
    tb = traceback.format_exc()
    print("=== UNHANDLED 500 EXCEPTION ===", flush=True)
    print(tb, flush=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}", "traceback": tb},
        headers=_cors_headers(request),
    )


@app.middleware("http")
async def add_security_headers(request, call_next):
    """REL-07: Add modern security response headers without breaking CORS."""
    response = await call_next(request)
    if "Access-Control-Allow-Origin" not in response.headers:
        for key, value in _cors_headers(request).items():
            response.headers[key] = value
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=()"
    return response





@app.get("/")
@app.head("/")
def root_endpoint():
    """Root health check for UptimeRobot, Render health checks & load balancers."""
    return {
        "status": "healthy",
        "service": "Lower Third Transcription Studio",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/health"
    }


@app.get("/health")
@app.head("/health")
@app.get("/api/health")
@app.head("/api/health")
async def health_check():
    has_gemini = bool(GEMINI_API_KEY and len(GEMINI_API_KEY.strip()) > 5)
    has_elevenlabs = bool(ELEVENLABS_API_KEY and len(ELEVENLABS_API_KEY.strip()) > 5)
    return {
        "status": "healthy",
        "has_gemini_api_key": has_gemini,
        "has_elevenlabs_api_key": has_elevenlabs,
        "default_model": GEMINI_MODEL,
        "default_language": DEFAULT_LANGUAGE,
        "default_script": DEFAULT_SCRIPT,
        "version": "1.0.0",
        # Lets you confirm from outside that the live-progress job API is deployed
        "features": {"transcribe_async": True, "audio_extract_async": True}
    }


MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024  # 200 MB limit


@app.post("/api/upload")
async def upload_audio(request: Request, file: UploadFile = File(...)):
    """Upload single audio file and perform initial inspection."""
    client_ip = get_client_ip(request)
    _check_rate_limit(client_ip)

    # Validate file size
    if file.size and file.size > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum supported audio file size is 200MB."
        )

    # Surgically delete any older uploads of this same media
    raw_stem = Path(file.filename).stem
    purge_media_files_for_stem(raw_stem=raw_stem)

    unique_prefix = uuid.uuid4().hex[:8]
    safe_filename = f"{unique_prefix}_{file.filename}"
    file_path = UPLOAD_DIR / safe_filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    info = inspect_audio(str(file_path))
    audio_id = Path(safe_filename).stem

    active_sessions[audio_id] = {
        "filename": safe_filename,
        "file_path": str(file_path),
        "info": info,
        "is_rejected": False,
        "rejection_category": None,
        "rejection_reason": None,
        "created_at": time.time()
    }

    return {
        "audio_id": audio_id,
        "filename": safe_filename,
        "audio_info": info,
        "is_rejected": False,
        "rejection_category": None,
        "rejection_reason": None
    }


def _save_transcription_to_db(result: "TranscriptionResult", target_path: str):
    """Synchronous helper: save transcription project & segments to Neon PostgreSQL DB."""
    session = get_db_session()
    if not session:
        return
    try:
        db_proj = session.query(DBProject).filter(DBProject.id == result.audio_id).first()
        if not db_proj:
            db_proj = DBProject(
                id=result.audio_id,
                filename=result.filename,
                audio_path=target_path,
                language=result.language,
                script=result.script,
                duration=result.audio_info.duration if result.audio_info else 0.0,
                compliance_score=result.compliance_score,
                total_errors=result.total_errors,
                total_warnings=result.total_warnings,
                audio_info=result.audio_info.model_dump_json() if result.audio_info else "{}"
            )
            session.add(db_proj)
        else:
            db_proj.filename = result.filename
            db_proj.language = result.language
            db_proj.script = result.script
            db_proj.compliance_score = result.compliance_score
            db_proj.total_errors = result.total_errors
            db_proj.total_warnings = result.total_warnings
            session.query(DBSegment).filter(DBSegment.project_id == db_proj.id).delete()

        for seg in result.segments:
            db_seg = DBSegment(
                project_id=result.audio_id,
                segment_id=seg.segment_id,
                speaker=seg.speaker,
                gender=seg.gender,
                start_time=seg.start_time,
                end_time=seg.end_time,
                duration=seg.duration,
                transcript=seg.transcript,
                confidence=seg.confidence,
                words_data=json.dumps([w.model_dump() for w in seg.words], ensure_ascii=False) if seg.words else "[]",
                qc_errors_data=json.dumps([e.model_dump() for e in seg.qc_errors], ensure_ascii=False) if seg.qc_errors else "[]",
                is_valid=seg.is_valid
            )
            session.add(db_seg)

        session.commit()
    except Exception as db_err:
        session.rollback()
        print(f"Neon DB save warning: {db_err}")
    finally:
        session.close()


@app.post("/api/transcribe")
async def transcribe_audio(
    request: Request,
    file: Optional[UploadFile] = File(None),
    audio_id: Optional[str] = Form(None),
    language: str = Form("Auto-Detect"),
    script: str = Form("Auto-Detect"),
    elevenlabs_api_key: Optional[str] = Form(None)
):
    """Transcribe single audio file using ElevenLabs Scribe v2 pipeline + Karya linting."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    _check_rate_limit(client_ip)
    if file:
        unique_prefix = uuid.uuid4().hex[:8]
        safe_filename = f"{unique_prefix}_{file.filename}"
        file_path = UPLOAD_DIR / safe_filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        target_path = str(file_path)
    elif audio_id and audio_id in active_sessions:
        target_path = active_sessions[audio_id]["file_path"]
    else:
        raise HTTPException(status_code=400, detail="Audio file or valid audio_id is required.")

    original_media_path = target_path  # kept so gender detection can watch the video

    # Auto-extract 16kHz mono audio WAV if input is a video file or container or format needing conversion like .wma
    ext = Path(target_path).suffix.lower()
    from app.video_processor import get_supported_video_extensions, extract_audio_from_video
    if ext in get_supported_video_extensions() or ext == ".wma" or ext not in [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"]:
        try:
            audio_info = await asyncio.to_thread(extract_audio_from_video, target_path)
            extracted_path = audio_info.get("audio_path")
            if extracted_path and os.path.exists(extracted_path):
                target_path = extracted_path
        except Exception as extract_err:
            print(f"Video audio extraction fallback note: {extract_err}")

    try:
        result = await process_audio_file(
            audio_path=target_path,
            language=language,
            script=script,
            elevenlabs_api_key=elevenlabs_api_key,
            video_path=original_media_path if Path(original_media_path).suffix.lower() in get_supported_video_extensions() else None
        )
    except Exception as trans_err:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(trans_err)}"
        )

    # Ensure result filename points to the accessible audio file in uploads
    result.filename = Path(target_path).name

    active_sessions[result.audio_id] = {
        "filename": result.filename,
        "file_path": target_path,
        "result": result
    }

    # Automatically save transcription project & segments to Neon PostgreSQL DB
    await asyncio.to_thread(_save_transcription_to_db, result, target_path)

    return result


def _list_projects_from_db():
    session = get_db_session()
    if not session:
        return []
    try:
        projects = session.query(DBProject).order_by(DBProject.updated_at.desc()).all()
        result = []
        for p in projects:
            result.append({
                "id": p.id,
                "filename": p.filename,
                "language": p.language,
                "script": p.script,
                "duration": p.duration,
                "compliance_score": p.compliance_score,
                "total_errors": p.total_errors,
                "total_warnings": p.total_warnings,
                "segment_count": len(p.segments),
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None
            })
        return result
    finally:
        session.close()


@app.get("/api/projects")
async def list_projects():
    """List all saved projects from Neon PostgreSQL DB."""
    try:
        projects = await asyncio.to_thread(_list_projects_from_db)
        return {"projects": projects}
    except Exception as e:
        return {"projects": [], "error": str(e)}


def _get_project_details_from_db(project_id: str):
    session = get_db_session()
    if not session:
        raise ValueError("Database not available")
    try:
        proj = session.query(DBProject).filter(DBProject.id == project_id).first()
        if not proj:
            return None

        segments_out = []
        for s in proj.segments:
            words = []
            if s.words_data:
                try:
                    words = json.loads(s.words_data)
                except Exception:
                    pass
            qc_errors = []
            if s.qc_errors_data:
                try:
                    qc_errors = json.loads(s.qc_errors_data)
                except Exception:
                    pass

            segments_out.append({
                "segment_id": s.segment_id,
                "speaker": s.speaker,
                "gender": s.gender,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "duration": s.duration,
                "transcript": s.transcript,
                "confidence": s.confidence,
                "words": words,
                "qc_errors": qc_errors,
                "is_valid": s.is_valid
            })

        audio_info_parsed = {}
        if proj.audio_info:
            try:
                audio_info_parsed = json.loads(proj.audio_info)
            except Exception:
                pass

        return {
            "audio_id": proj.id,
            "filename": proj.filename,
            "language": proj.language,
            "script": proj.script,
            "duration": proj.duration,
            "compliance_score": proj.compliance_score,
            "total_errors": proj.total_errors,
            "total_warnings": proj.total_warnings,
            "audio_info": audio_info_parsed,
            "segments": segments_out
        }
    finally:
        session.close()


@app.get("/api/projects/{project_id}")
async def get_project_details(project_id: str):
    """Retrieve full project details with all segments and word confidence from Neon DB."""
    try:
        data = await asyncio.to_thread(_get_project_details_from_db, project_id)
        if not data:
            raise HTTPException(status_code=404, detail="Project not found")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _save_project_to_db(payload: dict):
    session = get_db_session()
    if not session:
        raise ValueError("Database not initialized")
    try:
        project_data = payload.get("result", {})
        proj_id = project_data.get("audio_id") or str(uuid.uuid4())[:8]
        filename = project_data.get("filename") or "audio_transcript.wav"

        db_proj = session.query(DBProject).filter(DBProject.id == proj_id).first()
        if not db_proj:
            db_proj = DBProject(
                id=proj_id,
                filename=filename,
                language=project_data.get("language", "Hindi"),
                script=project_data.get("script", "Devanagari"),
                duration=float(project_data.get("audio_info", {}).get("duration", 0.0)),
                compliance_score=float(project_data.get("compliance_score", 100.0)),
                total_errors=int(project_data.get("total_errors", 0)),
                total_warnings=int(project_data.get("total_warnings", 0)),
                audio_info=json.dumps(project_data.get("audio_info", {}))
            )
            session.add(db_proj)
        else:
            db_proj.filename = filename
            db_proj.language = project_data.get("language", db_proj.language)
            db_proj.script = project_data.get("script", db_proj.script)
            db_proj.compliance_score = float(project_data.get("compliance_score", db_proj.compliance_score))
            db_proj.total_errors = int(project_data.get("total_errors", db_proj.total_errors))
            db_proj.total_warnings = int(project_data.get("total_warnings", db_proj.total_warnings))
            session.query(DBSegment).filter(DBSegment.project_id == db_proj.id).delete()

        raw_segments = project_data.get("segments", [])
        for seg in raw_segments:
            words_data = json.dumps(seg.get("words", []), ensure_ascii=False)
            qc_errors_data = json.dumps(seg.get("qc_errors", []), ensure_ascii=False)
            db_seg = DBSegment(
                project_id=proj_id,
                segment_id=int(seg.get("segment_id", 1)),
                speaker=str(seg.get("speaker", "Speaker 1")),
                gender=str(seg.get("gender", "Male")),
                start_time=float(seg.get("start_time", 0.0)),
                end_time=float(seg.get("end_time", 2.0)),
                duration=float(seg.get("duration", 2.0)),
                transcript=str(seg.get("transcript", "")),
                confidence=float(seg.get("confidence", 1.0)),
                words_data=words_data,
                qc_errors_data=qc_errors_data,
                is_valid=bool(seg.get("is_valid", True))
            )
            session.add(db_seg)

        session.commit()
        return proj_id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@app.post("/api/projects/save")
async def save_project(payload: dict):
    """Save or update project edits into Neon PostgreSQL DB."""
    try:
        proj_id = await asyncio.to_thread(_save_project_to_db, payload)
        return {"status": "success", "project_id": proj_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _delete_project_from_db(project_id: str):
    session = get_db_session()
    if not session:
        raise ValueError("Database not available")
    try:
        session.query(DBProject).filter(DBProject.id == project_id).delete()
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete project from Neon DB."""
    try:
        await asyncio.to_thread(_delete_project_from_db, project_id)
        return {"status": "success", "deleted_id": project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Transcription with live step-by-step progress ───────────────────────────────
# POST /api/transcribe_async runs the same pipeline as POST /api/transcribe in the background;
# GET /api/transcribe_status/{job_id} reports the current stage, overall percent and a stage list.
# (/api/transcribe is unchanged and still returns the finished result in one response.)
_transcribe_jobs: dict = {}
TRANSCRIBE_STAGES = [
    ("extracting", "Extracting audio"),
    ("preparing", "Preparing audio"),
    ("uploading", "Uploading to speech engine"),
    ("transcribing", "Transcribing and identifying speakers"),
    ("script", "Fixing script and loanwords"),
    ("segmenting", "Building segments"),
    ("gender", "Detecting speaker gender"),
    ("linting", "Checking transcription rules"),
]


def _prune_transcribe_jobs():
    cutoff = time.time() - 3600
    for jid in [j for j, v in _transcribe_jobs.items() if v.get("updated", 0) < cutoff]:
        _transcribe_jobs.pop(jid, None)


async def _run_transcribe_job(job_id, target_path, original_media_path, language, script, elevenlabs_api_key, needs_extract=True, cancel_id=None):
    job = _transcribe_jobs[job_id]
    # Registered under the id the browser sent as X-Job-Id (or the poll id), so POST /api/jobs/{id}/cancel stops FFmpeg and the run
    scope_id = cancel_id or job_id
    scope = job_control.register(scope_id, asyncio.current_task())
    scope_token = job_control._current.set(scope)
    stages = [s for s in TRANSCRIBE_STAGES if needs_extract or s[0] != "extracting"]
    order = [k for k, _ in stages]
    started = time.time()
    # Stage list is rebuilt on every update so the UI can draw a checklist from one response
    def set_state(**kw):
        job.update(kw)
        job["updated"] = time.time()
        job["elapsed_sec"] = round(time.time() - started, 1)
        cur = job.get("stage")
        idx = order.index(cur) if cur in order else (len(order) if cur in ("saving", "done") else -1)
        if cur in order:
            job["step"], job["step_count"] = idx + 1, len(order)
        job["stages"] = [
            {"id": k, "label": lbl, "status": "done" if (i < idx or cur == "done") else ("active" if i == idx else "pending")}
            for i, (k, lbl) in enumerate(stages)
        ]

    def on_progress(stage, overall, detail, stage_pct=None):
        # Never let the bar move backwards (stages can report from worker threads)
        overall = max(overall, job.get("percent") or 0.0)
        set_state(stage=stage, percent=min(99.0, overall), stage_percent=stage_pct, detail=detail)

    try:
        from app.video_processor import get_supported_video_extensions, extract_audio_from_video
        ext = Path(target_path).suffix.lower()
        if needs_extract and (ext in get_supported_video_extensions() or ext == ".wma" or ext not in [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"]):
            # FFmpeg's own progress drives the first 10% of the bar
            def on_ffmpeg(pct, done, total):
                on_progress("extracting", 0.0 if pct is None else 10.0 * pct / 100.0, "Extracting the audio track with FFmpeg",
                            None if pct is None else round(pct, 1))
            set_state(stage="extracting", percent=0.0, detail="Extracting the audio track with FFmpeg")
            try:
                audio_info = await asyncio.to_thread(extract_audio_from_video, target_path, None, on_ffmpeg)
                extracted = audio_info.get("audio_path")
                if extracted and os.path.exists(extracted):
                    target_path = extracted
            except Exception as extract_err:
                print(f"Video audio extraction fallback note: {extract_err}")
        set_state(stage="preparing", percent=max(job.get("percent") or 0.0, 10.0), detail="Preparing audio")

        is_video = Path(original_media_path).suffix.lower() in get_supported_video_extensions()
        result = await process_audio_file(
            audio_path=target_path,
            language=language,
            script=script,
            elevenlabs_api_key=elevenlabs_api_key,
            video_path=original_media_path if is_video else None,
            progress_cb=on_progress,
        )
        result.filename = Path(target_path).name
        active_sessions[result.audio_id] = {"filename": result.filename, "file_path": target_path, "result": result}
        set_state(stage="saving", percent=99.0, detail="Saving the project")
        await asyncio.to_thread(_save_transcription_to_db, result, target_path)
        set_state(stage="done", percent=100.0, detail="Done", result=result.model_dump(mode="json"))
    except Exception as err:
        import traceback
        traceback.print_exc()
        set_state(stage="error", error=f"Transcription failed: {err}")
    except asyncio.CancelledError:
        set_state(stage="error", error="Transcription cancelled.", cancelled=True)
    finally:
        job_control.unregister(scope_id, scope)
        job_control._current.reset(scope_token)


@app.post("/api/transcribe_async")
async def transcribe_audio_async(
    request: Request,
    file: Optional[UploadFile] = File(None),
    audio_id: Optional[str] = Form(None),
    language: str = Form("Auto-Detect"),
    script: str = Form("Auto-Detect"),
    elevenlabs_api_key: Optional[str] = Form(None),
    audio_filename: Optional[str] = Form(None)
):
    """Start a transcription in the background and return a job id to poll.

    Send `audio_filename` (from /api/audio/extract_async's result) to reuse audio that was already
    extracted: nothing is uploaded or extracted a second time."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    _check_rate_limit(client_ip)
    _prune_transcribe_jobs()
    original_path = None
    needs_extract = True
    if audio_filename:
        wav_path = UPLOAD_DIR / Path(audio_filename).name
        if not wav_path.exists():
            raise HTTPException(status_code=404, detail="Extracted audio not found; upload the file again.")
        target_path = str(wav_path)
        needs_extract = False
        # The source video sits next to its extracted audio (same stem); gender detection can watch it
        from app.video_processor import get_supported_video_extensions as _vid_exts
        original_path = next((str(p) for p in UPLOAD_DIR.glob(f"{wav_path.stem}.*") if p.suffix.lower() in _vid_exts()), None)
    elif file:
        file_path = UPLOAD_DIR / f"{uuid.uuid4().hex[:8]}_{file.filename}"
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        target_path = str(file_path)
    elif audio_id and audio_id in active_sessions:
        target_path = active_sessions[audio_id]["file_path"]
    else:
        raise HTTPException(status_code=400, detail="Audio file, audio_filename or valid audio_id is required.")

    job_id = uuid.uuid4().hex
    _transcribe_jobs[job_id] = {"stage": "queued", "percent": 0.0, "updated": time.time()}
    asyncio.create_task(_run_transcribe_job(job_id, target_path, original_path or target_path, language, script, elevenlabs_api_key, needs_extract, cancel_id=request.headers.get("x-job-id")))
    return {"job_id": job_id}


@app.get("/api/transcribe_status/{job_id}")
async def transcribe_status(job_id: str):
    job = _transcribe_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Transcription job not found or expired.")
    return {k: v for k, v in job.items() if k != "updated"}


@app.get("/api/audio/{filename}")
async def get_audio_stream(filename: str):
    """Stream audio file for WaveSurfer browser player."""
    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        # Search in uploads directory
        matches = list(UPLOAD_DIR.glob(f"{filename}*"))
        if matches:
            file_path = matches[0]
        else:
            raise HTTPException(status_code=404, detail="Audio file not found.")

    suffix = file_path.suffix.lower()
    media_type = "audio/wav"
    if suffix == ".mp3":
        media_type = "audio/mp3"
    elif suffix in [".m4a", ".aac"]:
        media_type = "audio/mp4"
    elif suffix == ".ogg":
        media_type = "audio/ogg"

    return FileResponse(file_path, media_type=media_type)


@app.post("/api/audio/extract")
async def extract_audio_endpoint(request: Request, file: UploadFile = File(...)):
    """Extract 16kHz mono WAV audio track and waveform peaks from any uploaded video or audio file."""
    client_ip = get_client_ip(request)
    _check_rate_limit(client_ip)

    unique_prefix = uuid.uuid4().hex[:8]
    raw_stem = Path(file.filename).stem
    ext = Path(file.filename).suffix.lower()
    clean_stem = re.sub(r'[^\w\.-]', '_', raw_stem).strip()
    clean_stem = re.sub(r'_+', '_', clean_stem)
    safe_filename = f"{unique_prefix}_{clean_stem}{ext}"
    file_path = UPLOAD_DIR / safe_filename

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"Error saving file: {e}")

    try:
        from app.video_processor import extract_audio_from_video, get_video_metadata
        from app.audio_processor import compute_acoustic_waveform_peaks

        audio_info = await asyncio.to_thread(extract_audio_from_video, str(file_path))
        audio_path = audio_info.get("audio_path")
        if not audio_path or not os.path.exists(audio_path):
            raise HTTPException(status_code=500, detail="Failed to extract audio track from video.")

        audio_name = Path(audio_path).name
        meta = await asyncio.to_thread(get_video_metadata, str(file_path))

        wdata = await asyncio.to_thread(compute_acoustic_waveform_peaks, str(audio_path), 50)
        peaks = wdata.get("peaks", [])
        duration = float(audio_info.get("duration") or meta.get("duration") or wdata.get("duration", 0.0))

        # Cache peaks
        cache_path = UPLOAD_DIR / f"{Path(audio_name).stem}.peaks.json"
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"peaks": peaks, "duration": duration, "points_per_sec": 50}, f)

        return {
            "status": "success",
            "original_filename": file.filename,
            "audio_filename": audio_name,
            "audio_url": f"/api/audio/{audio_name}",
            "duration": round(duration, 3),
            "sample_rate": 16000,
            "channels": 1,
            "peaks": peaks
        }
    except HTTPException:
        raise
    except Exception as err:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Audio extraction failed: {str(err)}")


# ── Audio extraction with live progress ─────────────────────────────────────────
# POST /api/audio/extract_async saves the upload and starts the same extraction as /api/audio/extract
# in the background; GET /api/audio/extract_status/{job_id} reports real progress (FFmpeg media time).
_extract_jobs: dict = {}


def _prune_extract_jobs():
    cutoff = time.time() - 3600
    for jid in [j for j, v in _extract_jobs.items() if v.get("updated", 0) < cutoff]:
        _extract_jobs.pop(jid, None)


async def _run_extract_job(job_id: str, file_path: Path, original_filename: str):
    job = _extract_jobs[job_id]
    # Registered under the same id so POST /api/jobs/{job_id}/cancel stops FFmpeg and removes the upload
    scope = job_control.register(job_id, asyncio.current_task())
    token = job_control._current.set(scope)
    job_control.on_cancel(lambda: file_path.unlink(missing_ok=True))

    def set_state(**kw):
        job.update(kw)
        job["updated"] = time.time()

    def on_ffmpeg(pct, done, total):
        set_state(stage="extracting", percent=None if pct is None else round(pct, 1), seconds_done=round(done, 1), seconds_total=round(total, 1))

    try:
        from app.video_processor import extract_audio_from_video, get_video_metadata
        from app.audio_processor import compute_acoustic_waveform_peaks

        set_state(stage="extracting", percent=0.0, detail="Extracting the audio track with FFmpeg")
        audio_info = await asyncio.to_thread(extract_audio_from_video, str(file_path), None, on_ffmpeg)
        audio_path = audio_info.get("audio_path")
        if not audio_path or not os.path.exists(audio_path):
            raise RuntimeError("Failed to extract the audio track from this file.")

        audio_name = Path(audio_path).name
        meta = await asyncio.to_thread(get_video_metadata, str(file_path))

        set_state(stage="waveform", percent=None, detail="Drawing the waveform")
        wdata = await asyncio.to_thread(compute_acoustic_waveform_peaks, str(audio_path), 50)
        peaks = wdata.get("peaks", [])
        duration = float(audio_info.get("duration") or meta.get("duration") or wdata.get("duration", 0.0))

        cache_path = UPLOAD_DIR / f"{Path(audio_name).stem}.peaks.json"
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"peaks": peaks, "duration": duration, "points_per_sec": 50}, f)

        set_state(
            stage="done",
            percent=100.0,
            result={
                "status": "success",
                "original_filename": original_filename,
                "audio_filename": audio_name,
                "audio_url": f"/api/audio/{audio_name}",
                "duration": round(duration, 3),
                "sample_rate": 16000,
                "channels": 1,
                "audio_bytes": os.path.getsize(audio_path),
                "peaks": peaks,
            },
        )
    except asyncio.CancelledError:
        set_state(stage="cancelled")
        file_path.unlink(missing_ok=True)
        if not scope.cancelled:
            raise
    except Exception as err:
        if scope.cancelled:
            set_state(stage="cancelled")
            file_path.unlink(missing_ok=True)
        else:
            import traceback
            traceback.print_exc()
            set_state(stage="error", error=f"Audio extraction failed: {err}")
    finally:
        job_control._current.reset(token)
        job_control.unregister(job_id)


@app.post("/api/audio/extract_async")
async def extract_audio_async_endpoint(request: Request, file: UploadFile = File(...)):
    """Save the upload, then extract its audio in the background and report live progress."""
    client_ip = get_client_ip(request)
    _check_rate_limit(client_ip)
    _prune_extract_jobs()

    unique_prefix = uuid.uuid4().hex[:8]
    raw_stem = Path(file.filename).stem
    ext = Path(file.filename).suffix.lower()
    clean_stem = re.sub(r'[^\w\.-]', '_', raw_stem).strip()
    clean_stem = re.sub(r'_+', '_', clean_stem)
    file_path = UPLOAD_DIR / f"{unique_prefix}_{clean_stem}{ext}"

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"Error saving file: {e}")

    job_id = uuid.uuid4().hex
    _extract_jobs[job_id] = {"stage": "queued", "percent": 0.0, "updated": time.time(), "bytes": file_path.stat().st_size}
    asyncio.create_task(_run_extract_job(job_id, file_path, file.filename))
    return {"job_id": job_id, "bytes": _extract_jobs[job_id]["bytes"]}


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job_endpoint(job_id: str):
    """Stop a running job started with the same X-Job-Id header (or an extract_async job id)."""
    stopped = job_control.cancel(job_id)
    return {"cancelled": stopped}


@app.get("/api/audio/extract_status/{job_id}")
async def extract_audio_status_endpoint(job_id: str):
    job = _extract_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Extraction job not found or expired.")
    return {k: v for k, v in job.items() if k != "updated"}


@app.post("/api/speakers/refine")
async def refine_speakers_endpoint(payload: dict):
    """AI second pass on speaker labels. Returns suggestions only; the editor applies them (and can undo)."""
    from app.speaker_refine import lines_from_segments, suggest_corrections
    segments_raw = [s for s in payload.get("segments", []) if isinstance(s, dict) and "segment_id" in s]
    if len(segments_raw) < 2:
        raise HTTPException(status_code=400, detail="Not enough lines to review.")
    lines = lines_from_segments(segments_raw)
    plan, notes = await asyncio.to_thread(suggest_corrections, lines, str(payload.get("language") or "Hindi"))
    return {"speaker_map": plan["speaker_map"], "reassign": {str(k): v for k, v in plan["reassign"].items()}, "notes": notes}


@app.post("/api/lint")
async def lint_segments_endpoint(payload: dict):
    """REL-06: Re-lint segment list after manual edits with resilient schema validation."""
    segments_raw = payload.get("segments", [])
    language = payload.get("language", "Hindi")
    script = payload.get("script", "Devanagari")

    clean_segments = []
    for s in segments_raw:
        if isinstance(s, dict):
            try:
                clean_segments.append(Segment(**s))
            except Exception:
                s_time = float(s.get("start_time", 0.0) or 0.0)
                e_time = float(s.get("end_time", s_time + 2.0) or (s_time + 2.0))
                clean_segments.append(Segment(
                    segment_id=int(s.get("segment_id", 1) or 1),
                    speaker=str(s.get("speaker", "Speaker 1") or "Speaker 1"),
                    gender=str(s.get("gender", "Male") or "Male"),
                    start_time=s_time,
                    end_time=e_time,
                    duration=float(s.get("duration", e_time - s_time) or (e_time - s_time)),
                    transcript=str(s.get("transcript", "") or "")
                ))
        elif isinstance(s, Segment):
            clean_segments.append(s)

    linted_segments, score, total_errors, total_warnings = lint_dataset(
        clean_segments, language=language, script=script
    )

    return {
        "segments": linted_segments,
        "compliance_score": score,
        "total_errors": total_errors,
        "total_warnings": total_warnings
    }


@app.post("/api/autofix")
async def autofix_endpoint(payload: dict):
    """REL-06: Apply 1-click auto-fixes on segments with resilient validation."""
    segments_raw = payload.get("segments", [])
    fix_digits = payload.get("fix_digits", True)
    fix_punctuation = payload.get("fix_punctuation", True)
    fix_overlaps = payload.get("fix_overlaps", True)
    fix_tags = payload.get("fix_tags", True)
    language = payload.get("language", "Hindi")
    script = payload.get("script", "Devanagari")

    clean_segments = []
    for s in segments_raw:
        if isinstance(s, dict):
            try:
                clean_segments.append(Segment(**s))
            except Exception:
                s_time = float(s.get("start_time", 0.0) or 0.0)
                e_time = float(s.get("end_time", s_time + 2.0) or (s_time + 2.0))
                clean_segments.append(Segment(
                    segment_id=int(s.get("segment_id", 1) or 1),
                    speaker=str(s.get("speaker", "Speaker 1") or "Speaker 1"),
                    gender=str(s.get("gender", "Male") or "Male"),
                    start_time=s_time,
                    end_time=e_time,
                    duration=float(s.get("duration", e_time - s_time) or (e_time - s_time)),
                    transcript=str(s.get("transcript", "") or "")
                ))
        elif isinstance(s, Segment):
            clean_segments.append(s)

    fixed_segments = apply_auto_fixes(
        segments=clean_segments,
        fix_digits=fix_digits,
        fix_punctuation=fix_punctuation,
        fix_overlaps=fix_overlaps,
        fix_tags=fix_tags,
        language=language,
        script=script
    )

    _, score, total_errors, total_warnings = lint_dataset(
        fixed_segments, language=language, script=script
    )

    return {
        "segments": fixed_segments,
        "compliance_score": score,
        "total_errors": total_errors,
        "total_warnings": total_warnings
    }


def sanitize_transcription_result(data: dict) -> TranscriptionResult:
    """Safely build TranscriptionResult from any incoming client dictionary without failing."""
    if not isinstance(data, dict):
        data = {}

    audio_id = str(data.get("audio_id") or "audio_001")
    filename = str(data.get("filename") or "audio_transcript.wav")
    language = str(data.get("language") or "Hindi")
    script = str(data.get("script") or "Devanagari")
    compliance_score = float(data.get("compliance_score") or 100.0)
    total_errors = int(data.get("total_errors") or 0)
    total_warnings = int(data.get("total_warnings") or 0)

    # Process segments safely
    raw_segs = data.get("segments") or []
    clean_segs = []
    for i, s in enumerate(raw_segs, 1):
        if isinstance(s, dict):
            s_time = float(s.get("start_time") or 0.0)
            e_time = float(s.get("end_time") or (s_time + 2.0))
            clean_segs.append(Segment(
                segment_id=int(s.get("segment_id") or i),
                speaker=str(s.get("speaker") or "Speaker 1"),
                gender=str(s.get("gender") or "Male"),
                start_time=s_time,
                end_time=e_time,
                start_time_str=str(s.get("start_time_str") or f"{s_time:.3f}"),
                end_time_str=str(s.get("end_time_str") or f"{e_time:.3f}"),
                duration=float(s.get("duration") or (e_time - s_time)),
                transcript=str(s.get("transcript") or ""),
                translation=(str(s.get("translation")) if s.get("translation") not in (None, "") else None),
                confidence=float(s.get("confidence") or 1.0),
                words=s.get("words") or [],
                qc_errors=[],
                is_valid=bool(s.get("is_valid", True))
            ))

    raw_info = data.get("audio_info") or {}
    audio_info = AudioAnalysis(
        filename=filename,
        duration=float(raw_info.get("duration") or (clean_segs[-1].end_time if clean_segs else 0.0)),
        sample_rate=int(raw_info.get("sample_rate") or 16000),
        channels=int(raw_info.get("channels") or 1),
        rms_db=float(raw_info.get("rms_db") or -20.0),
        snr_db=float(raw_info.get("snr_db") or 25.0)
    )

    return TranscriptionResult(
        audio_id=audio_id,
        filename=filename,
        language=language,
        script=script,
        audio_info=audio_info,
        segments=clean_segs,
        compliance_score=compliance_score,
        total_errors=total_errors,
        total_warnings=total_warnings,
        translation_language=(str(data.get("translation_language")) if data.get("translation_language") else None)
    )


def attachment_disposition(filename: str) -> str:
    """Content-Disposition value that survives non-ASCII names (e.g. Hindi audio filenames)."""
    try:
        filename.encode("ascii")
        if '"' not in filename and "\\" not in filename:
            return f'attachment; filename="{filename}"'
        raise UnicodeEncodeError("ascii", filename, 0, 1, "quote characters")
    except UnicodeEncodeError:
        fallback = filename.encode("ascii", "replace").decode("ascii")
        fallback = re.sub(r'["\\?]', "_", fallback)
        return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{urllib.parse.quote(filename)}"


@app.post("/api/export")
async def export_deliverable(
    result_data: dict,
    format: str = "csv"
):
    """Generate and return deliverable file in requested format."""
    result = sanitize_transcription_result(result_data)
    base_name = Path(result.filename).stem

    if format == "csv":
        content = export_to_csv(result)
        return Response(
            content=content,
            media_type="text/csv",
            headers={"Content-Disposition": attachment_disposition(f"{base_name}_karya.csv")}
        )
    elif format == "tsv":
        content = export_to_tsv(result, delimiter="\t")
        return Response(
            content=content,
            media_type="text/tab-separated-values",
            headers={"Content-Disposition": attachment_disposition(f"{base_name}_karya.tsv")}
        )
    elif format == "txt":
        content = export_to_txt(result)
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": attachment_disposition(f"{base_name}_transcript.txt")}
        )
    elif format == "json":
        content = export_to_json(result)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": attachment_disposition(f"{base_name}_deliverable.json")}
        )
    elif format == "srt":
        content = export_to_srt(result)
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": attachment_disposition(f"{base_name}.srt")}
        )
    elif format == "vtt":
        content = export_to_vtt(result)
        return Response(
            content=content,
            media_type="text/vtt; charset=utf-8",
            headers={"Content-Disposition": attachment_disposition(f"{base_name}.vtt")}
        )
    elif format == "docx":
        docx_path = str(EXPORTS_DIR / f"{base_name}_karya.docx")
        export_to_docx(result, docx_path)
        return FileResponse(
            docx_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=f"{base_name}_karya.docx"
        )
    elif format == "xlsx":
        xlsx_path = str(EXPORTS_DIR / f"{base_name}_karya.xlsx")
        export_to_xlsx(result, xlsx_path)
        return FileResponse(
            xlsx_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=f"{base_name}_karya.xlsx"
        )
    elif format == "rejection_csv":
        rej_item = [{
            "filename": result.filename,
            "rejection_category": result.rejection_category or "Rejection Category",
            "rejection_reason": result.rejection_reason or "Detailed Reason",
            "duration": result.audio_info.duration,
            "rms_db": result.audio_info.rms_db,
            "snr_db": result.audio_info.snr_db
        }]
        content = export_rejection_csv(rej_item)
        return Response(
            content=content,
            media_type="text/csv",
            headers={"Content-Disposition": attachment_disposition(f"{base_name}_rejection.csv")}
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format '{format}'.")


@app.post("/api/export/dubbing")
async def export_dubbing_script(payload: dict):
    """Generate the Dubbing Script workbook, applying optional speaker -> character renames."""
    result = sanitize_transcription_result(payload.get("result", {}))
    speaker_map = payload.get("speaker_map") or {}
    if not isinstance(speaker_map, dict):
        raise HTTPException(status_code=400, detail="speaker_map must be an object.")
    base_name = Path(result.filename).stem
    out_name = f"{base_name}_dubbing_script.xlsx"
    out_path = str(EXPORTS_DIR / out_name)
    export_to_dubbing_script(result, out_path, speaker_map)
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": attachment_disposition(out_name)},
    )


@app.post("/api/export/multi")
async def export_multi_deliverables(payload: dict):
    """Generate and return deliverables for multiple selected formats (direct file or ZIP)."""
    import zipfile
    result_data = payload.get("result", {})
    formats = payload.get("formats", ["csv"])
    if not formats:
        formats = ["csv"]

    result = sanitize_transcription_result(result_data)
    base_name = Path(result.filename).stem

    # If only 1 format is selected, return that single file directly
    if len(formats) == 1:
        fmt = formats[0].lower()
        if fmt == "csv":
            content = export_to_csv(result)
            return Response(content=content, media_type="text/csv", headers={"Content-Disposition": attachment_disposition(f"{base_name}_karya.csv")})
        elif fmt == "docx":
            docx_path = str(EXPORTS_DIR / f"{base_name}_karya.docx")
            export_to_docx(result, docx_path)
            return FileResponse(docx_path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename=f"{base_name}_karya.docx")
        elif fmt == "xlsx":
            xlsx_path = str(EXPORTS_DIR / f"{base_name}_karya.xlsx")
            export_to_xlsx(result, xlsx_path)
            return FileResponse(xlsx_path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=f"{base_name}_karya.xlsx")
        elif fmt == "srt":
            content = export_to_srt(result)
            return Response(content=content, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": attachment_disposition(f"{base_name}.srt")})
        elif fmt == "vtt":
            content = export_to_vtt(result)
            return Response(content=content, media_type="text/vtt; charset=utf-8", headers={"Content-Disposition": attachment_disposition(f"{base_name}.vtt")})
        elif fmt == "txt":
            content = export_to_txt(result)
            return Response(content=content, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": attachment_disposition(f"{base_name}_transcript.txt")})
        elif fmt == "json":
            content = export_to_json(result)
            return Response(content=content, media_type="application/json", headers={"Content-Disposition": attachment_disposition(f"{base_name}_deliverable.json")})

    # Bundle multiple formats into a single ZIP archive
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for fmt in formats:
            fmt = fmt.lower()
            if fmt == "csv":
                zf.writestr(f"{base_name}_karya.csv", export_to_csv(result))
            elif fmt == "tsv":
                zf.writestr(f"{base_name}_karya.tsv", export_to_tsv(result))
            elif fmt == "txt":
                zf.writestr(f"{base_name}_transcript.txt", export_to_txt(result))
            elif fmt == "srt":
                zf.writestr(f"{base_name}.srt", export_to_srt(result))
            elif fmt == "vtt":
                zf.writestr(f"{base_name}.vtt", export_to_vtt(result))
            elif fmt == "json":
                zf.writestr(f"{base_name}_deliverable.json", export_to_json(result))
            elif fmt == "docx":
                docx_path = str(EXPORTS_DIR / f"{base_name}_temp.docx")
                export_to_docx(result, docx_path)
                with open(docx_path, "rb") as f:
                    zf.writestr(f"{base_name}_karya.docx", f.read())
            elif fmt == "xlsx":
                xlsx_path = str(EXPORTS_DIR / f"{base_name}_temp.xlsx")
                export_to_xlsx(result, xlsx_path)
                with open(xlsx_path, "rb") as f:
                    zf.writestr(f"{base_name}_karya.xlsx", f.read())

    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": attachment_disposition(f"{base_name}_deliverables.zip")}
    )


# --- NETFLIX SUBTITLE ENDPOINTS ---

@app.post("/api/subtitle/upload")
async def upload_video(request: Request, file: UploadFile = File(...)):
    """Upload media file (video or pure audio) and perform initial inspection."""
    client_ip = get_client_ip(request)
    _check_rate_limit(client_ip)

    MAX_UPLOAD_SIZE = 4 * 1024 * 1024 * 1024  # 4 GB
    if file.size and file.size > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum supported media file size is 4GB."
        )

    ext = Path(file.filename).suffix.lower()
    if ext not in get_supported_media_extensions():
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format {ext}. Supported formats: {', '.join(sorted(get_supported_media_extensions()))}"
        )

    raw_stem = Path(file.filename).stem
    # Sanitize filename stem to eliminate unsafe characters that break URLs or filesystems
    clean_stem = re.sub(r'[^\w\.-]', '_', raw_stem).strip()
    clean_stem = re.sub(r'_+', '_', clean_stem)

    # Surgically delete any previous files from older uploads of this same media (prevents stale baggage)
    purge_media_files_for_stem(clean_stem=clean_stem, raw_stem=raw_stem)

    unique_prefix = uuid.uuid4().hex[:8]
    safe_filename = f"{unique_prefix}_{clean_stem}{ext}"
    file_path = UPLOAD_DIR / safe_filename
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"Error writing media upload: {str(e)}")

    return await _process_saved_media(file_path, safe_filename, clean_stem, raw_stem, ext, request=request)


async def _process_saved_media(file_path: Path, safe_filename: str, clean_stem: str, raw_stem: str, ext: str, request: Optional[Request] = None):
    """Validate media, resolve audio, precalculate waveform, register active session, and audit UserMediaAsset."""
    try:
        val = validate_media_file(str(file_path))
        if not val["is_valid"]:
            if file_path.exists():
                file_path.unlink()
            raise HTTPException(status_code=400, detail=val.get("error_message") or "Invalid or corrupt media file.")
            
        metadata = val.get("metadata") or get_video_metadata(str(file_path))
        metadata["is_audio"] = val.get("is_audio_only", False)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"Error processing media upload: {str(e)}")
        
    video_id = Path(safe_filename).stem

    # Pre-extract or resolve audio path for instant waveform rendering
    # .wma files are converted to WAV via FFmpeg because browsers & soundfile cannot decode them natively
    audio_path = None
    if ext in [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"]:
        audio_path = str(file_path)
    else:
        try:
            from app.video_processor import extract_audio_from_video
            audio_info = await asyncio.to_thread(extract_audio_from_video, str(file_path))
            audio_path = audio_info.get("audio_path")
        except Exception as e:
            print(f"Non-fatal audio extraction warning during upload: {e}")

    if not audio_path and ext == ".wav":
        audio_path = str(file_path)

    # ── Instant Waveform Pre-Calculation & Disk Caching ──
    peaks_payload = []
    cache_path = UPLOAD_DIR / f"{video_id}.peaks.json"
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cdata = json.load(f)
                peaks_payload = cdata.get("peaks", [])
        except Exception:
            pass
    else:
        # Check if pre-computed peaks already exist for this media stem (instant reuse)
        existing_caches = list(UPLOAD_DIR.glob(f"*{clean_stem}*.peaks.json"))
        if not existing_caches and raw_stem != clean_stem:
            existing_caches = list(UPLOAD_DIR.glob(f"*{raw_stem}*.peaks.json"))
        if existing_caches:
            try:
                with open(existing_caches[0], "r", encoding="utf-8") as f:
                    cdata = json.load(f)
                peaks_payload = cdata.get("peaks", [])
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(cdata, f)
            except Exception:
                pass

    if not peaks_payload and audio_path and os.path.exists(audio_path):
        try:
            from app.audio_processor import compute_acoustic_waveform_peaks
            wdata = await asyncio.to_thread(compute_acoustic_waveform_peaks, str(audio_path), 50)
            wdata["video_id"] = video_id
            peaks_payload = wdata.get("peaks", [])
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(wdata, f)
        except Exception as e:
            print(f"Non-fatal pre-waveform computation note: {e}")

    active_sessions[video_id] = {
        "filename": safe_filename,
        "file_path": str(file_path),
        "audio_path": audio_path,
        "metadata": metadata,
        "created_at": time.time()
    }

    # Record UserMediaAsset for admin observability
    try:
        from app.auth_module.database import SessionLocal
        from app.auth_module.models import UserMediaAsset, User, AuthSession
        import hashlib

        file_hash = None
        try:
            with open(file_path, "rb") as f:
                head_bytes = f.read(4 * 1024 * 1024)
                file_hash = hashlib.sha256(head_bytes).hexdigest()
        except Exception:
            pass

        db_aud = SessionLocal()
        try:
            detected_user_id = None
            if request:
                auth_hdr = request.headers.get("authorization")
                if auth_hdr and auth_hdr.startswith("Bearer "):
                    tok = auth_hdr.split(" ")[1].strip()
                    sess = db_aud.query(AuthSession).filter(AuthSession.session_token == tok, AuthSession.is_active == True).first()
                    if sess:
                        detected_user_id = sess.user_id

            if not detected_user_id:
                first_u = db_aud.query(User).first()
                if first_u:
                    detected_user_id = first_u.id

            if detected_user_id:
                asset = UserMediaAsset(
                    user_id=detected_user_id,
                    video_id=video_id,
                    filename=safe_filename,
                    file_size_bytes=file_path.stat().st_size if file_path.exists() else 0,
                    duration_seconds=float(metadata.get("duration", 0.0)) if metadata else 0.0,
                    video_resolution=f"{metadata.get('width', '')}x{metadata.get('height', '')}" if metadata and metadata.get("width") else "",
                    frame_rate=float(metadata.get("frame_rate", 24.0)) if metadata else 24.0,
                    audio_sample_rate=int(metadata.get("sample_rate", 16000)) if metadata else 16000,
                    audio_channels=int(metadata.get("channels", 1)) if metadata else 1,
                    file_hash=file_hash,
                    storage_path=str(file_path)
                )
                db_aud.add(asset)
                db_aud.commit()
                active_sessions[video_id]["user_id"] = detected_user_id
                active_sessions[video_id]["media_asset_id"] = asset.id
        except Exception as aud_err:
            db_aud.rollback()
            print(f"Non-fatal media asset audit note: {aud_err}")
        finally:
            db_aud.close()
    except Exception:
        pass

    fps = round(float(metadata.get("frame_rate", 24.0)), 3) if metadata else 24.0
    audio_filename = Path(audio_path).name if (audio_path and os.path.exists(str(audio_path))) else None
    audio_url = f"/api/audio/{audio_filename}" if audio_filename else None

    return {
        "video_id": video_id,
        "filename": safe_filename,
        "audio_filename": audio_filename,
        "audio_url": audio_url,
        "frame_rate": fps,
        "metadata": metadata,
        "peaks": peaks_payload,
        "points_per_sec": 50
    }


@app.post("/api/subtitle/upload_chunk")
async def upload_video_chunk(
    request: Request,
    chunk: UploadFile = File(...),
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    filename: str = Form(...)
):
    """Receive sliced file chunk (<=20MB) to bypass cloud proxy request limits seamlessly."""

    ext = Path(filename).suffix.lower()
    if ext not in get_supported_media_extensions():
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format {ext}. Supported formats: {', '.join(sorted(get_supported_media_extensions()))}"
        )

    clean_upload_id = re.sub(r'[^\w\.-]', '_', upload_id).strip()
    raw_stem = Path(filename).stem
    clean_stem = re.sub(r'[^\w\.-]', '_', raw_stem).strip()
    clean_stem = re.sub(r'_+', '_', clean_stem)
    safe_filename = f"{clean_upload_id}_{clean_stem}{ext}"
    part_path = UPLOAD_DIR / f"{safe_filename}.part"

    # Surgically purge previous files for this media on the very first chunk (excluding current upload_id)
    if chunk_index == 0:
        purge_media_files_for_stem(
            clean_stem=clean_stem,
            raw_stem=raw_stem,
            exclude_prefixes=[f"{clean_upload_id}_"]
        )

    # Append chunk data to .part file
    mode = "ab" if (chunk_index > 0 and part_path.exists()) else "wb"
    try:
        with open(part_path, mode) as buffer:
            shutil.copyfileobj(chunk.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error writing chunk {chunk_index}: {e}")

    # Not last chunk yet - acknowledge receipt
    if chunk_index < total_chunks - 1:
        return {
            "status": "chunk_received",
            "chunk_index": chunk_index,
            "total_chunks": total_chunks
        }

    # Final chunk reached: finalize file and run full media processing
    final_file_path = UPLOAD_DIR / safe_filename
    if final_file_path.exists():
        final_file_path.unlink()
    shutil.move(str(part_path), str(final_file_path))

    return await _process_saved_media(final_file_path, safe_filename, clean_stem, raw_stem, ext, request=request)


@app.delete("/api/subtitle/upload_chunk/{upload_id}")
async def cancel_chunked_upload(upload_id: str):
    """Cancelled upload: delete the slices received so far for this upload id."""
    clean_upload_id = re.sub(r'[^\w\.-]', '_', upload_id).strip()
    if not clean_upload_id:
        return {"removed": 0}
    removed = 0
    for part in UPLOAD_DIR.glob(f"{clean_upload_id}_*.part"):
        try:
            part.unlink()
            removed += 1
        except OSError:
            pass
    return {"removed": removed}


def resolve_active_session_video(video_id: str) -> Optional[str]:
    """Resolve media path (video or audio) from in-memory active_sessions or automatically restore from disk in UPLOAD_DIR."""
    if not video_id:
        return None
    video_id = urllib.parse.unquote(str(video_id)).strip()
    if video_id in active_sessions and os.path.exists(active_sessions[video_id].get("file_path", "")):
        return active_sessions[video_id]["file_path"]
    if os.path.exists(video_id):
        return video_id
        
    supported_exts = get_supported_media_extensions()

    # Check exact stem match
    for cand in UPLOAD_DIR.glob(f"{video_id}.*"):
        if cand.is_file() and cand.suffix.lower() in supported_exts:
            audio_cand = UPLOAD_DIR / f"{video_id}.wav"
            if not audio_cand.exists():
                audio_cand = UPLOAD_DIR / f"{video_id}_audio.wav"
            active_sessions[video_id] = {
                "filename": cand.name,
                "file_path": str(cand),
                "audio_path": str(audio_cand) if audio_cand.exists() else None,
                "created_at": time.time()
            }
            return str(cand)

    # Check prefix / substring match
    matches = list(UPLOAD_DIR.glob(f"{video_id}*")) or list(UPLOAD_DIR.glob(f"*{video_id}*"))
    media_matches = [m for m in matches if m.is_file() and m.suffix.lower() in supported_exts]
    if media_matches:
        cand = media_matches[0]
        audio_cand = UPLOAD_DIR / f"{cand.stem}.wav"
        if not audio_cand.exists():
            audio_cand = UPLOAD_DIR / f"{cand.stem}_audio.wav"
        active_sessions[video_id] = {
            "filename": cand.name,
            "file_path": str(cand),
            "audio_path": str(audio_cand) if audio_cand.exists() else None,
            "created_at": time.time()
        }
        return str(cand)

    return None


@app.get("/api/subtitle/waveform/{video_id}")
async def get_subtitle_waveform_endpoint(video_id: str, request: Request, points_per_sec: int = 50):
    """Return high-precision acoustic waveform peaks for video_id with instant disk cache lookup."""
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ")[1].strip()
            from app.auth_module.models import AuthSession
            from app.auth_module.database import SessionLocal
            db_s = SessionLocal()
            sess = db_s.query(AuthSession).filter(AuthSession.session_token == token, AuthSession.is_active == True).first()
            if sess and sess.user and not getattr(sess.user, "can_audio_peaks", True):
                db_s.close()
                return {"video_id": video_id, "duration": 0.0, "points_per_sec": points_per_sec, "peaks": [], "disabled": True}
            db_s.close()
        except Exception:
            pass

    video_id = urllib.parse.unquote(str(video_id)).strip()

    # 1. Instant Disk Cache Lookup (< 20ms response time, Subtitle Edit level instant loading)
    cache_candidates = [
        UPLOAD_DIR / f"{video_id}.peaks.json",
        UPLOAD_DIR / f"{video_id}_audio.peaks.json",
        UPLOAD_DIR / f"{video_id}.wav.peaks.json"
    ]
    for c in cache_candidates:
        if c.exists():
            try:
                with open(c, "r", encoding="utf-8") as f:
                    cdata = json.load(f)
                cdata["video_id"] = video_id
                return cdata
            except Exception:
                pass

    # Prefix or substring match in cache
    cache_matches = list(UPLOAD_DIR.glob(f"{video_id}*.peaks.json")) or list(UPLOAD_DIR.glob(f"*{video_id}*.peaks.json"))
    clean_id = re.sub(r'[^\w\.-]', '_', video_id).strip()
    if not cache_matches and clean_id != video_id:
        cache_matches = list(UPLOAD_DIR.glob(f"*{clean_id}*.peaks.json"))

    for c in cache_matches:
        try:
            with open(c, "r", encoding="utf-8") as f:
                cdata = json.load(f)
            cdata["video_id"] = video_id
            return cdata
        except Exception:
            pass

    audio_path = None
    if video_id in active_sessions and active_sessions[video_id].get("audio_path"):
        cand = Path(active_sessions[video_id]["audio_path"])
        if cand.exists():
            audio_path = cand

    if not audio_path or not audio_path.exists():
        for cand_name in [f"{video_id}.wav", f"{video_id}_audio.wav", f"{video_id}_16k.wav"]:
            p = UPLOAD_DIR / cand_name
            if p.exists():
                audio_path = p
                break

    if not audio_path or not audio_path.exists():
        video_path = resolve_active_session_video(video_id)
        if video_path and os.path.exists(video_path):
            try:
                from app.video_processor import extract_audio_from_video
                audio_info = await asyncio.to_thread(extract_audio_from_video, video_path)
                extracted_path = audio_info.get("audio_path")
                if extracted_path and os.path.exists(extracted_path):
                    audio_path = Path(extracted_path)
                else:
                    audio_path = Path(video_path)
            except Exception as e:
                audio_path = Path(video_path)
        else:
            raise HTTPException(status_code=404, detail="Media session or audio track not found.")
            
    if not audio_path or not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio track not found.")
        
    try:
        from app.audio_processor import compute_acoustic_waveform_peaks
        waveform_data = await asyncio.to_thread(compute_acoustic_waveform_peaks, str(audio_path), points_per_sec)
        waveform_data["video_id"] = video_id
        
        # Save to cache immediately for future sub-second loading
        try:
            target_cache = UPLOAD_DIR / f"{video_id}.peaks.json"
            with open(target_cache, "w", encoding="utf-8") as f:
                json.dump(waveform_data, f)
        except Exception:
            pass

        return waveform_data
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to compute waveform: {e}")


@app.post("/api/subtitle/probe_media")
async def probe_media_endpoint(file: UploadFile = File(...)):
    """Probe video or audio container to detect exact frame rate, resolution, duration, and stream info."""
    suffix = Path(file.filename or "media.mp4").suffix or ".mp4"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = tmp.name
    try:
        # Write first 32MB (or full file if smaller) for rapid container header detection
        chunk_size = 1024 * 1024
        written = 0
        while chunk := await file.read(chunk_size):
            tmp.write(chunk)
            written += len(chunk)
            if written >= 32 * 1024 * 1024:
                break
        tmp.close()
        
        meta = await asyncio.to_thread(get_video_metadata, tmp_path)
        fps = round(float(meta.get("frame_rate", 24.0)), 3)
        return {
            "frame_rate": fps,
            "width": meta.get("width", 0),
            "height": meta.get("height", 0),
            "duration": meta.get("duration", 0.0),
            "is_audio": meta.get("is_audio", False),
            "codec": meta.get("codec", "unknown")
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "frame_rate": 24.0,
            "width": 0,
            "height": 0,
            "duration": 0.0,
            "is_audio": False,
            "error": str(e)
        }
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


class DiscardMediaRequest(BaseModel):
    filename: Optional[str] = None
    video_id: Optional[str] = None


@app.post("/api/media/discard")
@app.post("/api/subtitle/discard")
async def discard_media_endpoint(payload: DiscardMediaRequest):
    """
    Surgically delete all files in UPLOAD_DIR associated with a specific audio/video file
    (e.g., when the user clicks 'Discard & Start Fresh' upon re-uploading a previous file).
    Removes:
      - Raw uploaded media (.mp4, .mp3, .mkv, .mov, etc.)
      - Extracted mono/16k audio tracks (.wav, _audio.wav, _16k.wav)
      - Waveform peak caches (*.peaks.json)
      - Sliced upload parts (*.part)
      - Temporary chunk slices (temp_chunk_*.wav)
      - In-memory active_sessions for this media
    Guarantees no other user's files or unrelated uploads are affected.
    """
    raw_filename = (payload.filename or "").strip()
    raw_video_id = (payload.video_id or "").strip()

    if not raw_filename and not raw_video_id:
        raise HTTPException(status_code=400, detail="Either filename or video_id must be provided.")

    deleted_files = purge_media_files_for_stem(
        raw_stem=raw_filename if raw_filename else None,
        video_id=raw_video_id if raw_video_id else None
    )

    return {
        "success": True,
        "message": f"Discarded {len(deleted_files)} media, audio, and peaks files cleanly.",
        "deleted_count": len(deleted_files),
        "deleted_files": deleted_files
    }


@app.post("/api/subtitle/generate")
async def generate_subtitles_endpoint(request: Request, payload: dict):
    """Generate Netflix QC compliant subtitles from video using ElevenLabs Scribe v2 and local Netflix engine."""
    video_id = payload.get("video_id")
    language = payload.get("language", "auto")
    content_type = payload.get("content_type", "adult")
    sdh_mode = payload.get("sdh_mode", False)
    cpl_limit = int(payload.get("cpl_limit", 42))
    max_cps = float(payload.get("max_cps", 20.0 if content_type == "adult" else 17.0))
    max_lines = int(payload.get("max_lines", 2))
    min_duration = float(payload.get("min_duration", 0.833))
    max_duration = float(payload.get("max_duration", 7.0))
    raw_frame_rate = payload.get("frame_rate")
    custom_frame_rate = float(raw_frame_rate) if raw_frame_rate is not None and float(raw_frame_rate) > 0 else None
    elevenlabs_api_key = payload.get("elevenlabs_api_key") or request.headers.get("x-elevenlabs-api-key")
    
    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")
        
    video_path = resolve_active_session_video(video_id)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video session not found or expired. Please re-upload the video.")
    
    file_size_mb = round(os.path.getsize(video_path) / (1024 * 1024), 2) if os.path.exists(video_path) else 0.0
    log_terminal("SUBTITLE-API", f"===> Direct Subtitle Generation Request: video_id={video_id} ({file_size_mb} MB)")
    log_terminal("SUBTITLE-API", f"     Params -> Language: {language} | Content: {content_type} | SDH: {sdh_mode}")
    log_terminal("SUBTITLE-API", f"     Limits -> CPL: {cpl_limit} | Max CPS: {max_cps} | Min Dur: {min_duration}s | Max Dur: {max_duration}s")
    
    try:
        result = await asyncio.to_thread(
            generate_subtitles,
            video_path=video_path,
            language=language,
            content_type=content_type,
            sdh_mode=sdh_mode,
            cpl_limit=cpl_limit,
            max_cps=max_cps,
            max_lines=max_lines,
            min_duration=min_duration,
            max_duration=max_duration,
            custom_frame_rate=custom_frame_rate,
            api_key=elevenlabs_api_key,
        )
        active_sessions[video_id]["result"] = result
        log_terminal("SUBTITLE-API", f"[OK] Subtitles generated: {result.get('total_events', 0)} events (Score: {result.get('compliance_score', 0)}%)")
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        log_terminal("SUBTITLE-API", f"[ERROR] Subtitle generation failed: {str(e)}", level="ERROR")
        raise HTTPException(status_code=500, detail=f"Subtitle generation failed: {str(e)}")


@app.post("/api/subtitle/generate_stream")
async def generate_subtitles_stream_endpoint(request: Request, payload: dict):
    """Progressively stream subtitle batches using Server-Sent Events (SSE) with dynamic settings."""
    video_id = payload.get("video_id")
    language = payload.get("language", "auto")
    script = payload.get("script", "auto")
    content_type = payload.get("content_type", "adult")
    sdh_mode = payload.get("sdh_mode", False)
    include_speaker_tags = bool(payload.get("include_speaker_tags", False))
    snap_to_shot_changes = bool(payload.get("snap_to_shot_changes", True))
    # Robust numeric extraction in case frontend sends string representations like "42", "20.0", "0.833s", "24 fps"
    try:
        cpl_limit = int(str(payload.get("cpl_limit", 42)).replace("cpl", "").strip())
    except Exception:
        cpl_limit = 42

    try:
        max_cps = float(str(payload.get("max_cps", 20.0 if content_type == "adult" else 17.0)).replace("cps", "").strip())
    except Exception:
        max_cps = 20.0 if content_type == "adult" else 17.0

    try:
        max_lines = int(str(payload.get("max_lines", 2)).replace("lines", "").strip())
    except Exception:
        max_lines = 2

    try:
        min_duration = float(str(payload.get("min_duration", 0.833)).replace("s", "").strip())
    except Exception:
        min_duration = 0.833

    try:
        max_duration = float(str(payload.get("max_duration", 7.0)).replace("s", "").strip())
    except Exception:
        max_duration = 7.0

    raw_num_speakers = payload.get("num_speakers")
    num_speakers = int(raw_num_speakers) if raw_num_speakers is not None and str(raw_num_speakers).isdigit() and int(raw_num_speakers) > 0 else None
    strict_native_script = bool(payload.get("strict_native_script", True))

    raw_frame_rate = payload.get("frame_rate")
    try:
        custom_frame_rate = float(str(raw_frame_rate).replace("fps", "").strip()) if raw_frame_rate is not None else None
    except Exception:
        custom_frame_rate = None

    elevenlabs_api_key = payload.get("elevenlabs_api_key") or request.headers.get("x-elevenlabs-api-key")
    start_chunk = int(payload.get("start_chunk", 1))
    prev_events_count = int(payload.get("prev_events_count", 0))
    prev_batch_end = float(payload.get("prev_batch_end", 0.0))
    prev_context = payload.get("prev_context", [])
    raw_start_time = payload.get("start_time")
    start_time = float(raw_start_time) if raw_start_time is not None else None
    batch_mode = payload.get("batch_mode", "all")
    user_feedback = payload.get("user_feedback")
    project_glossary = payload.get("project_glossary") or payload.get("glossary", [])
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}

    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")
        
    video_path = resolve_active_session_video(video_id)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video session not found or expired. Please re-upload the video.")

    file_size_mb = round(os.path.getsize(video_path) / (1024 * 1024), 2) if os.path.exists(video_path) else 0.0
    log_terminal("SUBTITLE-API", f"===> Subtitle Stream Request: video_id={video_id} ({file_size_mb} MB)")
    log_terminal("SUBTITLE-API", f"     Target -> Language: {language} | Script: {script} | ContentType: {content_type} | SDH: {sdh_mode}")
    log_terminal("SUBTITLE-API", f"     Constraints -> CPL: {cpl_limit} | Max CPS: {max_cps} | Lines: {max_lines} | Min: {min_duration}s | Max: {max_duration}s")
    log_terminal("SUBTITLE-API", f"     Diarization -> Speakers: {num_speakers or 'Auto-Detect'} | Speaker Tags: {include_speaker_tags}")
    log_terminal("SUBTITLE-API", f"     Advanced -> Strict Script: {strict_native_script} | Snap Shot Cuts: {snap_to_shot_changes} | FPS: {custom_frame_rate or 'Auto'}")

    user_id = None
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ")[1].strip()
            from app.auth_module.models import AuthSession, User, SubtitleGenerationRun
            from app.auth_module.database import SessionLocal
            db_s = SessionLocal()
            sess = db_s.query(AuthSession).filter(AuthSession.session_token == token, AuthSession.is_active == True).first()
            if sess and sess.user:
                usr = sess.user
                user_id = usr.id
                if usr.is_blocked:
                    db_s.close()
                    raise HTTPException(status_code=403, detail="Your account has been suspended by an administrator.")
                
                # Check video quota limit
                if usr.max_videos_quota is not None and usr.max_videos_quota >= 0:
                    runs = db_s.query(SubtitleGenerationRun.video_id).filter(SubtitleGenerationRun.user_id == user_id).all()
                    distinct_video_ids = {r[0] for r in runs if r[0]}
                    if video_id not in distinct_video_ids and len(distinct_video_ids) >= usr.max_videos_quota:
                        db_s.close()
                        raise HTTPException(
                            status_code=403,
                            detail=f"Video generation quota exceeded: Your account limit is {usr.max_videos_quota} videos. Please contact your administrator."
                        )
                # Check AI optimize toggle
                if not getattr(usr, "can_ai_optimize", True):
                    gemini_auto_fix = False
            db_s.close()
        except HTTPException:
            raise
        except Exception as e:
            logger.debug(f"User quota validation note: {e}")

    if not user_id and video_id in active_sessions and active_sessions[video_id].get("user_id"):
        user_id = active_sessions[video_id]["user_id"]

    generator = generate_subtitles_stream(
        video_path=video_path,
        language=language,
        script=script,
        content_type=content_type,
        sdh_mode=sdh_mode,
        cpl_limit=cpl_limit,
        max_cps=max_cps,
        max_lines=max_lines,
        min_duration=min_duration,
        max_duration=max_duration,
        custom_frame_rate=custom_frame_rate,
        api_key=elevenlabs_api_key,
        include_speaker_tags=include_speaker_tags,
        snap_to_shot_changes=snap_to_shot_changes,
        num_speakers=num_speakers,
        strict_native_script=strict_native_script,
        context=context,
        project_glossary=project_glossary,
        user_feedback=user_feedback,
        user_id=user_id,
        video_id=video_id
    )

    async def sse_stream_wrapper():
        increment_active_stream()
        log_terminal("SSE-STREAM", f"Client connected to SSE stream for video_id={video_id}")
        chunk_count = 0
        try:
            async for chunk in generator:
                chunk_count += 1
                if "data:" in chunk:
                    try:
                        clean_data = chunk.strip().replace("data:", "").strip()
                        parsed = json.loads(clean_data)
                        p_type = parsed.get("type")
                        if p_type == "progress":
                            log_terminal("SSE-STREAM", f"[Progress {parsed.get('progress', 0)}%] {parsed.get('stage')}")
                        elif p_type == "complete":
                            log_terminal("SSE-STREAM", f"[Complete] Subtitle stream generated {parsed.get('total_events', 0)} events (Score: {parsed.get('compliance_score', 0)}%)")
                        elif p_type in ("error", "stream_error"):
                            log_terminal("SSE-STREAM", f"[Error] {parsed.get('message') or parsed.get('error')}", level="ERROR")
                    except Exception:
                        pass
                yield chunk
        except Exception as exc:
            logger.exception(f"Unhandled exception in sse_stream_wrapper: {exc}")
            log_terminal("SSE-STREAM", f"[FATAL STREAM ERROR] {exc}", level="ERROR")
            err_data = json.dumps({"type": "error", "message": str(exc), "error": str(exc)})
            yield f"data: {err_data}\n\n"
        finally:
            decrement_active_stream()
            log_terminal("SSE-STREAM", f"Client disconnected from SSE stream for video_id={video_id} (Emitted {chunk_count} chunks)")

    return StreamingResponse(
        sse_stream_wrapper(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/api/subtitle/context_autofill")
async def subtitle_context_autofill(payload: dict):
    """Read the current subtitles and draft the context (type, topic, speakers, key terms, misheard names)."""
    from app import context_polisher
    events = payload.get("events") or []
    if not any(str(e.get("text") or "").strip() for e in events):
        raise HTTPException(status_code=400, detail="There are no subtitles to read yet. Generate or import subtitles first.")
    try:
        return await context_polisher.autofill_context(events, payload.get("language") or "auto")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read the subtitles: {e}")


@app.post("/api/subtitle/context_polish")
async def subtitle_context_polish(payload: dict):
    """Proofread existing subtitles against the user's context. Timing never changes; only text fixes are returned."""
    from app import context_polisher as cp
    events = payload.get("events") or []
    ctx = dict(payload.get("context") or {})
    glossary = [t for t in (payload.get("glossary") or []) if isinstance(t, str) and t.strip()]
    if glossary:
        ctx["key_terms"] = "\n".join([*cp._lines(ctx.get("key_terms")), *glossary])
    if cp.context_is_empty(ctx):
        raise HTTPException(status_code=400, detail="Fill in some context first (speakers, key terms or notes).")
    corrections = cp.parse_corrections(ctx.get("corrections"))
    items = [{"id": e.get("id", e.get("event_id", i + 1)), "text": str(e.get("text") or "")} for i, e in enumerate(events)]
    fixes, seen = [], set()
    for it in items:
        new_text, n = cp.apply_corrections(it["text"], corrections) if corrections else (it["text"], 0)
        if n:
            fixes.append({"id": it["id"], "before": it["text"], "after": new_text, "reason": "your correction list"})
            it["text"] = new_text
            seen.add(it["id"])
    ai_error = None
    try:
        ai = await cp.polish_texts(items, ctx, payload.get("language") or "auto",
                                   int(payload.get("cpl_limit") or 42), int(payload.get("max_lines") or 2))
        for fx in ai:
            prior = next((f for f in fixes if f["id"] == fx["id"]), None)
            if prior:
                prior["after"], prior["reason"] = fx["after"], prior["reason"] + " + " + fx["reason"]
            else:
                fixes.append(fx)
    except Exception as e:
        ai_error = str(e)
    return {"fixes": fixes, "count": len(fixes), "ai_error": ai_error}


@app.post("/api/subtitle/extract_glossary_file")
async def extract_glossary_file_endpoint(file: UploadFile = File(...)):
    """Extract vocabulary terms / proper nouns from uploaded Word (.docx), Excel (.xlsx/.xls), CSV, TXT, or JSON files."""
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    raw_terms = []

    try:
        if ext == ".docx":
            import docx
            doc = docx.Document(file.file)
            for p in doc.paragraphs:
                if p.text.strip():
                    raw_terms.append(p.text.strip())
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text.strip():
                            raw_terms.append(cell.text.strip())

        elif ext in [".xlsx", ".xls"]:
            import openpyxl
            wb = openpyxl.load_workbook(file.file, data_only=True)
            for sheet in wb.worksheets:
                for row in sheet.iter_rows(values_only=True):
                    for cell_val in row:
                        if cell_val is not None and str(cell_val).strip():
                            raw_terms.append(str(cell_val).strip())

        elif ext in [".txt", ".csv", ".tsv"]:
            content = await file.read()
            text_content = content.decode("utf-8", errors="replace")
            raw_terms = text_content.splitlines()

        elif ext == ".json":
            content = await file.read()
            data = json.loads(content.decode("utf-8", errors="replace"))
            if isinstance(data, list):
                raw_terms = [str(x) for x in data if x is not None]
            elif isinstance(data, dict):
                raw_terms = [str(v) for v in data.values() if v is not None]

        else:
            content = await file.read()
            text_content = content.decode("utf-8", errors="replace")
            raw_terms = text_content.splitlines()

        # Parse terms: split by comma, tab, semicolon or pipe
        extracted = []
        seen = set()
        for item in raw_terms:
            parts = re.split(r'[,;\t|]+', item)
            for p in parts:
                clean = p.strip().strip('"\'`')
                if clean and len(clean) >= 2 and len(clean) <= 80 and clean.lower() not in seen:
                    seen.add(clean.lower())
                    extracted.append(clean)

        return {"success": True, "terms": extracted, "count": len(extracted), "filename": filename}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to extract glossary from file: {str(e)}")


# ── Centroid: AI subtitle translation + linguistic QC ──────────────────────────
@app.get("/api/centroid/status")
async def centroid_status():
    from app import centroid_client
    return await centroid_client.status()


@app.post("/api/centroid/translate")
async def centroid_translate(payload: dict):
    """Send SRT/events to Centroid and return translated SRT(s) per target language."""
    from app import centroid_client
    if not (payload.get("srt") or payload.get("cues") or payload.get("events")):
        raise HTTPException(status_code=400, detail="Provide 'srt' or 'events'.")
    if not (payload.get("target_langs") or payload.get("target_lang")):
        raise HTTPException(status_code=400, detail="Choose at least one target language.")
    body = {k: payload[k] for k in ("srt", "source_lang", "target_langs", "target_lang", "context", "glossary", "constraints", "quality") if payload.get(k)}
    cues = payload.get("cues") or payload.get("events")
    if cues and not body.get("srt"):
        body["cues"] = [
            {"start": e.get("start_time", e.get("start")), "end": e.get("end_time", e.get("end")), "text": e.get("text", "")}
            for e in cues
        ]
    data = await centroid_client.post("/subtitles/translate", body)
    if body.get("cues"):
        centroid_client.align_translations(data, body["cues"])
    return data


@app.post("/api/centroid/analyze")
async def centroid_analyze(payload: dict):
    """Ask Centroid to read the whole script and propose context, characters and a name glossary."""
    from app import centroid_client
    cues = payload.get("cues") or payload.get("events") or []
    if not cues:
        raise HTTPException(status_code=400, detail="There are no subtitles to analyse.")
    body = {k: payload[k] for k in ("source_lang", "target_langs", "context") if payload.get(k)}
    body["cues"] = [
        {"start": e.get("start_time", e.get("start")), "end": e.get("end_time", e.get("end")), "text": e.get("text", "")}
        for e in cues
    ]
    return await centroid_client.post("/subtitles/analyze", body)


@app.post("/api/centroid/qc")
async def centroid_qc(payload: dict):
    """
    Subtitle QC for source/target cue pairs: Centroid's AI review merged with local rule checks.

    Response (unchanged shape, additive fields only):
      summary: {mqm_score, error_count, warning_count, clean_percentage, ai_checked, local_issue_count, ...}
      issues:  [{index (1-based), start, end, category, severity "error"|"warning", mqm_severity, title, description,
                 source, target, suggestion (full replacement text for the cue, or null), origin "ai"|"local"}]
      centroid_error: present only when Centroid failed; local checks are still returned and ai_checked is false.
    """
    from app import centroid_client
    from app.subtitle_qc import run_local_qc, merge_qc
    cues = payload.get("cues") or []
    if not cues or not payload.get("target_lang"):
        raise HTTPException(status_code=400, detail="Provide 'cues' (source + target) and 'target_lang'.")
    body = {k: payload[k] for k in ("source_lang", "target_lang", "context", "glossary", "constraints", "include_technical") if payload.get(k) is not None}
    body["cues"] = [
        {"start": c.get("start"), "end": c.get("end"), "source": c.get("source", ""), "target": c.get("target", "")}
        for c in cues
    ]
    local = run_local_qc(
        body["cues"], payload["target_lang"], payload.get("source_lang"),
        payload.get("glossary"), payload.get("constraints"),
    )
    centroid, err = None, None
    try:
        centroid = await centroid_client.post("/subtitles/qc", body)
    except HTTPException as e:
        err = str(e.detail)
    return merge_qc(centroid, local, len(cues), err)


@app.post("/api/subtitle/qc")
async def subtitle_qc_local(payload: dict):
    """Local-only QC (no Centroid call): same response shape as /api/centroid/qc."""
    from app.subtitle_qc import run_local_qc, merge_qc
    cues = payload.get("cues") or []
    if not cues:
        raise HTTPException(status_code=400, detail="Provide 'cues'.")
    local = run_local_qc(
        cues, payload.get("target_lang") or payload.get("language") or "en", payload.get("source_lang"),
        payload.get("glossary"), payload.get("constraints"),
    )
    return merge_qc(None, local, len(cues))


@app.post("/api/subtitle/lint")
async def lint_subtitles_endpoint(payload: SubtitleLintRequest):
    """Lint subtitles for Netflix QC compliance with dynamic custom settings."""
    try:
        # Convert events to list of dicts safely
        events_dicts = [
            e.model_dump() if hasattr(e, "model_dump") else (dict(e) if isinstance(e, dict) else e.__dict__)
            for e in payload.events
        ]
        
        lint_result = lint_all_subtitles(
            events=events_dicts,
            shot_changes=payload.shot_changes,
            content_type=payload.content_type,
            frame_rate=payload.frame_rate,
            custom_cpl=getattr(payload, "custom_cpl", None),
            custom_cps=getattr(payload, "custom_cps", None),
            custom_max_lines=getattr(payload, "custom_max_lines", None),
            custom_min_duration=getattr(payload, "custom_min_duration", None),
            custom_max_duration=getattr(payload, "custom_max_duration", None),
        )
        
        return lint_result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/subtitle/gemini_fix")
async def gemini_fix_subtitles_endpoint(payload: dict):
    """Coordinate with Gemini AI to fix QC violations (CPL, CPS, line breaks)."""
    video_id = payload.get("video_id")
    events = payload.get("events", [])
    content_type = payload.get("content_type", "adult")
    frame_rate = float(payload.get("frame_rate", 24.0))
    cpl_limit = int(payload.get("cpl_limit", 42))
    max_cps = float(payload.get("max_cps", 20.0 if content_type == "adult" else 17.0))
    max_lines = int(payload.get("max_lines", 2))
    min_duration = float(payload.get("min_duration", 0.833))
    max_duration = float(payload.get("max_duration", 7.0))
    shot_changes = payload.get("shot_changes", [])

    try:
        from app.gemini_qc_fixer import coordinate_gemini_qc_fix
        result = await asyncio.to_thread(
            coordinate_gemini_qc_fix,
            events=events,
            whisper_words=None,
            shot_changes=shot_changes,
            content_type=content_type,
            frame_rate=frame_rate,
            cpl_limit=cpl_limit,
            max_cps=max_cps,
            max_lines=max_lines,
            min_duration=min_duration,
            max_duration=max_duration,
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Gemini QC Fix failed: {str(e)}")


@app.post("/api/subtitle/acoustic_sync")
async def acoustic_sync_subtitles_endpoint(request: Request, payload: dict):
    """
    Acoustic synchronization:
    Locks subtitle events to exact speech timestamps using ElevenLabs Scribe v2 word timing and local Netflix engine.
    """
    video_id = payload.get("video_id")
    raw_events = payload.get("events", [])
    language = payload.get("language", "auto")
    content_type = payload.get("content_type", "adult")
    frame_rate = float(payload.get("frame_rate", 24.0))
    cpl_limit = int(payload.get("cpl_limit", 42))
    max_cps = float(payload.get("max_cps", 20.0 if content_type == "adult" else 17.0))
    max_lines = int(payload.get("max_lines", 2))
    min_duration = float(payload.get("min_duration", 0.833))
    max_duration = float(payload.get("max_duration", 7.0))
    shot_changes = payload.get("shot_changes", [])
    elevenlabs_api_key = payload.get("elevenlabs_api_key") or request.headers.get("x-elevenlabs-api-key")

    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")

    video_path = resolve_active_session_video(video_id)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video session not found or expired.")

    # Convert event dicts to SubtitleEvent objects
    events = [
        SubtitleEvent(**e) if isinstance(e, dict) else e
        for e in raw_events
    ]

    # Check cached scribe words or transcribe
    session_data = active_sessions.get(video_id, {})
    words = session_data.get("scribe_words")

    if not words:
        # Determine audio path
        audio_path = session_data.get("audio_path")
        if not audio_path or not os.path.exists(audio_path):
            audio_cand = os.path.splitext(video_path)[0] + ".wav"
            if os.path.exists(audio_cand):
                audio_path = audio_cand
            else:
                try:
                    audio_info = extract_audio_from_video(video_path)
                    audio_path = audio_info.get("audio_path", "")
                except Exception as ex:
                    raise HTTPException(status_code=500, detail=f"Failed to extract audio: {ex}")

        from app.elevenlabs_service import transcribe_with_scribe_v2
        stt_res = await transcribe_with_scribe_v2(
            audio_path=audio_path,
            language=language,
            diarize=True,
            tag_audio_events=False,
            api_key=elevenlabs_api_key
        )
        words = stt_res.get("words", [])
        if video_id in active_sessions:
            active_sessions[video_id]["scribe_words"] = words

    # Align with local Netflix Engine
    aligned = align_subtitles_to_words(
        events=events,
        words=words,
        language=language,
        frame_rate=frame_rate,
        min_duration=min_duration,
        max_duration=max_duration,
        cpl_limit=cpl_limit,
        max_cps=max_cps
    )

    # Audit Netflix compliance
    aligned, total_errs, total_warns, compliance_score, cps_stats = audit_netflix_compliance(
        events=aligned,
        language=language,
        content_type=content_type,
        frame_rate=frame_rate,
        shot_changes=shot_changes
    )

    return {
        "events": [e.model_dump() for e in aligned],
        "lint_result": {
            "total_errors": total_errs,
            "total_warnings": total_warns,
            "compliance_score": compliance_score,
            "cps_stats": cps_stats.model_dump() if cps_stats else {}
        },
        "matched_words_count": len(words),
        "engine": "ElevenLabs Scribe v2 + Netflix Timed Text Engine",
        "message": f"Successfully synchronized {len(aligned)} subtitles to ElevenLabs acoustic words."
    }


@app.post("/api/subtitle/autofix")
async def autofix_subtitles_endpoint(payload: SubtitleAutoFixRequest):
    """Auto-fix subtitle errors for Netflix QC compliance."""
    try:
        events_dicts = [
            e.model_dump() if hasattr(e, "model_dump") else (dict(e) if isinstance(e, dict) else e.__dict__)
            for e in payload.events
        ]
        fixed_events = auto_fix_subtitles(
            events=events_dicts,
            shot_changes=payload.shot_changes,
            content_type=payload.content_type,
            frame_rate=payload.frame_rate,
            custom_cpl=payload.custom_cpl,
            custom_cps=payload.custom_cps,
            custom_max_lines=payload.custom_max_lines,
            custom_min_duration=payload.custom_min_duration,
            custom_max_duration=payload.custom_max_duration
        )
        return {"events": fixed_events}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/subtitle/export")
async def export_subtitles_endpoint(payload: SubtitleExportRequest, request: Request):
    """Export subtitles to requested format."""
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ")[1].strip()
            from app.auth_module.models import AuthSession
            from app.auth_module.database import SessionLocal
            db_s = SessionLocal()
            sess = db_s.query(AuthSession).filter(AuthSession.session_token == token, AuthSession.is_active == True).first()
            if sess and sess.user and not getattr(sess.user, "can_export", True):
                db_s.close()
                raise HTTPException(
                    status_code=403,
                    detail="Subtitle export feature is currently disabled for your account by the administrator."
                )
            db_s.close()
        except HTTPException:
            raise
        except Exception:
            pass

    try:
        events_dicts = [
            e.model_dump() if hasattr(e, "model_dump") else (dict(e) if isinstance(e, dict) else e.__dict__)
            for e in payload.events
        ]
        format = payload.format.lower()
        filename = payload.filename or "subtitles"
        language = payload.language or "en"
        base_name = Path(filename).stem
        
        if format == "srt":
            content = export_netflix_srt(events_dicts)
            media_type = "text/plain; charset=utf-8"
            ext = "srt"
        elif format == "vtt":
            content = export_netflix_vtt(events_dicts)
            media_type = "text/vtt; charset=utf-8"
            ext = "vtt"
        elif format == "ttml":
            content = export_netflix_ttml(events_dicts, language)
            media_type = "application/xml"
            ext = "ttml"
        elif format == "txt":
            content = "\n\n".join([e.get("text", "") for e in events_dicts])
            media_type = "text/plain; charset=utf-8"
            ext = "txt"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported export format: {format}")
            
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{base_name}.{ext}"'}
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/subtitle/video/{filename}")
async def get_video_stream(request: Request, filename: str):
    """Stream video file for player with Range requests support."""
    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        matches = list(UPLOAD_DIR.glob(f"{filename}*"))
        if matches:
            file_path = matches[0]
        else:
            raise HTTPException(status_code=404, detail="Video file not found.")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("Range")

    suffix = file_path.suffix.lower()
    import mimetypes
    guessed_type, _ = mimetypes.guess_type(str(file_path))
    if guessed_type:
        media_type = guessed_type
    elif suffix in [".mp3"]:
        media_type = "audio/mpeg"
    elif suffix in [".wav"]:
        media_type = "audio/wav"
    elif suffix in [".m4a", ".aac"]:
        media_type = "audio/mp4"
    elif suffix in [".flac"]:
        media_type = "audio/flac"
    elif suffix in [".ogg"]:
        media_type = "audio/ogg"
    elif suffix in [".webm"]:
        media_type = "video/webm"
    elif suffix in [".mkv"]:
        media_type = "video/x-matroska"
    else:
        media_type = "video/mp4"
        
    if range_header:
        range_match = range_header.replace("bytes=", "").split("-")
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if len(range_match) > 1 and range_match[1] else file_size - 1
        
        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))
        
        chunk_size = (end - start) + 1
        
        def iterfile():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    chunk = f.read(min(remaining, 65536))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
                
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": media_type,
        }
        return StreamingResponse(iterfile(), status_code=206, headers=headers)
    else:
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": media_type,
        }
        return FileResponse(file_path, headers=headers, media_type=media_type)


@app.post("/api/subtitle/rebreak")
async def rebreak_subtitles_endpoint(payload: dict):
    """Optimize line breaks for subtitles."""
    try:
        events_raw = payload.get("events", [])
        max_cpl = payload.get("max_cpl", 42)
        
        updated_events = []
        for event in events_raw:
            if isinstance(event, dict):
                text = event.get("text", "")
                event["text"] = optimize_line_breaks(text, max_cpl)
                updated_events.append(event)
            else:
                event.text = optimize_line_breaks(event.text, max_cpl)
                updated_events.append(event)
                
        return {"events": updated_events}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _save_subtitle_project_to_db(payload: dict):
    session = get_db_session()
    if not session:
        raise ValueError("Database not initialized")
    try:
        project_data = payload.get("project", {})
        if not project_data:
            # Fallback to direct payload
            project_data = payload
            
        proj_id = project_data.get("video_id") or str(uuid.uuid4())[:8]
        filename = project_data.get("filename") or "video_subtitle.mp4"

        db_proj = session.query(DBSubtitleProject).filter(DBSubtitleProject.id == proj_id).first()
        if not db_proj:
            db_proj = DBSubtitleProject(
                id=proj_id,
                filename=filename,
                language=project_data.get("language", "en"),
                content_type=project_data.get("content_type", "adult"),
                duration=float(project_data.get("metadata", {}).get("duration", 0.0)),
                compliance_score=float(project_data.get("compliance_score", 100.0)),
                total_errors=int(project_data.get("total_errors", 0)),
                total_warnings=int(project_data.get("total_warnings", 0)),
                video_metadata=json.dumps(project_data.get("metadata", {})),
                shot_changes=json.dumps(project_data.get("shot_changes", []))
            )
            session.add(db_proj)
        else:
            db_proj.filename = filename
            db_proj.language = project_data.get("language", db_proj.language)
            db_proj.content_type = project_data.get("content_type", db_proj.content_type)
            db_proj.compliance_score = float(project_data.get("compliance_score", db_proj.compliance_score))
            db_proj.total_errors = int(project_data.get("total_errors", db_proj.total_errors))
            db_proj.total_warnings = int(project_data.get("total_warnings", db_proj.total_warnings))
            session.query(DBSubtitleEvent).filter(DBSubtitleEvent.project_id == db_proj.id).delete()

        raw_events = project_data.get("events", [])
        for ev in raw_events:
            qc_errors_data = json.dumps(ev.get("qc_errors", []), ensure_ascii=False)
            db_ev = DBSubtitleEvent(
                project_id=proj_id,
                event_id=int(ev.get("event_id", 1)),
                start_time=float(ev.get("start_time", 0.0)),
                end_time=float(ev.get("end_time", 2.0)),
                duration=float(ev.get("duration", 2.0)),
                text=str(ev.get("text", "")),
                qc_errors_data=qc_errors_data,
                is_valid=bool(ev.get("is_valid", True))
            )
            session.add(db_ev)

        session.commit()
        return proj_id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@app.post("/api/subtitle/projects/save")
async def save_subtitle_project(payload: dict):
    """Save or update subtitle project into DB."""
    try:
        proj_id = await asyncio.to_thread(_save_subtitle_project_to_db, payload)
        return {"status": "success", "project_id": proj_id}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}


def _list_subtitle_projects_from_db():
    session = get_db_session()
    if not session:
        return []
    try:
        projects = session.query(DBSubtitleProject).order_by(DBSubtitleProject.updated_at.desc()).all()
        result = []
        for p in projects:
            result.append({
                "id": p.id,
                "filename": p.filename,
                "language": p.language,
                "content_type": p.content_type,
                "duration": p.duration,
                "compliance_score": p.compliance_score,
                "total_errors": p.total_errors,
                "total_warnings": p.total_warnings,
                "event_count": len(p.events),
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None
            })
        return result
    finally:
        session.close()


@app.get("/api/subtitle/projects")
async def list_subtitle_projects():
    """List all saved subtitle projects from DB."""
    try:
        projects = await asyncio.to_thread(_list_subtitle_projects_from_db)
        return {"projects": projects}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"projects": [], "error": str(e)}


def _get_subtitle_project_details_from_db(project_id: str):
    session = get_db_session()
    if not session:
        raise ValueError("Database not available")
    try:
        proj = session.query(DBSubtitleProject).filter(DBSubtitleProject.id == project_id).first()
        if not proj:
            return None

        events_out = []
        for e in proj.events:
            qc_errors = []
            if e.qc_errors_data:
                try:
                    qc_errors = json.loads(e.qc_errors_data)
                except Exception:
                    pass

            events_out.append({
                "event_id": e.event_id,
                "start_time": e.start_time,
                "end_time": e.end_time,
                "duration": e.duration,
                "text": e.text,
                "qc_errors": qc_errors,
                "is_valid": e.is_valid
            })

        metadata_parsed = {}
        if proj.video_metadata:
            try:
                metadata_parsed = json.loads(proj.video_metadata)
            except Exception:
                pass
                
        shot_changes_parsed = []
        if proj.shot_changes:
            try:
                shot_changes_parsed = json.loads(proj.shot_changes)
            except Exception:
                pass

        return {
            "video_id": proj.id,
            "filename": proj.filename,
            "language": proj.language,
            "content_type": proj.content_type,
            "duration": proj.duration,
            "compliance_score": proj.compliance_score,
            "total_errors": proj.total_errors,
            "total_warnings": proj.total_warnings,
            "metadata": metadata_parsed,
            "shot_changes": shot_changes_parsed,
            "events": events_out
        }
    finally:
        session.close()


@app.get("/api/subtitle/projects/{project_id}")
async def get_subtitle_project_details(project_id: str):
    """Retrieve full subtitle project details with all events from DB."""
    try:
        data = await asyncio.to_thread(_get_subtitle_project_details_from_db, project_id)
        if not data:
            raise HTTPException(status_code=404, detail="Project not found")
        return data
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _delete_subtitle_project_from_db(project_id: str):
    session = get_db_session()
    if not session:
        raise ValueError("Database not available")
    try:
        session.query(DBSubtitleProject).filter(DBSubtitleProject.id == project_id).delete()
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@app.delete("/api/subtitle/projects/{project_id}")
async def delete_subtitle_project(project_id: str):
    """Delete subtitle project from DB."""
    try:
        await asyncio.to_thread(_delete_subtitle_project_from_db, project_id)
        return {"status": "success", "deleted_id": project_id}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/cleanup/{audio_id}")
async def cleanup_audio_file(audio_id: str):
    """Delete uploaded audio file for a given session to free disk space."""
    session = active_sessions.get(audio_id)
    if session and session.get("file_path"):
        file_path = Path(session["file_path"])
        if file_path.exists():
            try:
                file_path.unlink()
                active_sessions.pop(audio_id, None)
                return {"status": "deleted", "audio_id": audio_id}
            except Exception as e:
                return {"status": "error", "message": str(e)}
    return {"status": "not_found", "audio_id": audio_id}
