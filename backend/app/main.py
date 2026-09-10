import os
import re
import urllib.parse
import asyncio
import shutil
import uuid
import json
import io
import time
from collections import defaultdict
from pathlib import Path
from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse

from app.config import UPLOAD_DIR, EXPORTS_DIR, GEMINI_API_KEY, GEMINI_MODEL, DEFAULT_LANGUAGE, DEFAULT_SCRIPT
from app.models import (
    TranscriptionResult, Segment, LintRequest, AutoFixRequest, ExportRequest, BatchTask, AudioAnalysis, WordConfidence, QCError
)
from app.gemini_transcriber import process_audio_file
from app.linter_engine import lint_dataset, apply_auto_fixes
from app.rejection_engine import evaluate_audio_quality
from app.export_service import (
    export_to_csv, export_to_tsv, export_to_txt,
    export_to_docx, export_to_xlsx, export_to_json, export_to_srt, export_to_vtt,
    export_rejection_csv
)
from app.batch_runner import batch_manager
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
from app.gemini_subtitle_generator import generate_subtitles, generate_subtitles_stream
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle handler."""
    _cleanup_old_uploads()
    _evict_expired_sessions()
    init_db()
    yield


app = FastAPI(
    title="Karya Conversational Audio Transcription & Segmentation Studio",
    description="Automated verbatim transcription, speaker diarization, QA linter & batch pipeline",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration with explicit Vercel and local dev support
DEFAULT_ALLOWED_ORIGINS = [
    "https://transcribe-eight-eta.vercel.app",
    "https://transcribes.vercel.app",
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
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    """Ensure HTTP exceptions (e.g. 429, 404, 413) always include CORS headers."""
    origin = request.headers.get("origin") or "*"
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
    )


@app.exception_handler(Exception)
async def custom_general_exception_handler(request: Request, exc: Exception):
    """Ensure unhandled 500 exceptions always include CORS headers so browsers see the real error."""
    origin = request.headers.get("origin") or "*"
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
    )


@app.middleware("http")
async def add_security_headers(request, call_next):
    """REL-07: Add modern security response headers without breaking CORS."""
    response = await call_next(request)
    origin = request.headers.get("origin")
    if origin and "Access-Control-Allow-Origin" not in response.headers:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=()"
    return response


# In-memory storage for active sessions
active_sessions = {}


@app.get("/")
@app.head("/")
def root_endpoint():
    """Root health check for UptimeRobot, Render health checks & load balancers."""
    return {
        "status": "healthy",
        "service": "Karya Conversational Audio Transcription Studio",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/health"
    }


@app.get("/health")
@app.head("/health")
@app.get("/api/health")
@app.head("/api/health")
async def health_check():
    has_api_key = bool(GEMINI_API_KEY and len(GEMINI_API_KEY.strip()) > 5)
    return {
        "status": "healthy",
        "has_gemini_api_key": has_api_key,
        "default_model": GEMINI_MODEL,
        "default_language": DEFAULT_LANGUAGE,
        "default_script": DEFAULT_SCRIPT,
        "version": "1.0.0"
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
    api_key: Optional[str] = Form(None),
    model_name: Optional[str] = Form(None)
):
    """Transcribe single audio file using Gemini pipeline + Karya linting."""
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

    try:
        result = process_audio_file(
            audio_path=target_path,
            language=language,
            script=script,
            api_key=api_key,
            model_name=model_name or GEMINI_MODEL
        )
    except Exception as trans_err:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(trans_err)}"
        )

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
        total_warnings=total_warnings
    )


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
            headers={"Content-Disposition": f'attachment; filename="{base_name}_karya.csv"'}
        )
    elif format == "tsv":
        content = export_to_tsv(result, delimiter="\t")
        return Response(
            content=content,
            media_type="text/tab-separated-values",
            headers={"Content-Disposition": f'attachment; filename="{base_name}_karya.tsv"'}
        )
    elif format == "txt":
        content = export_to_txt(result)
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base_name}_transcript.txt"'}
        )
    elif format == "json":
        content = export_to_json(result)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{base_name}_deliverable.json"'}
        )
    elif format == "srt":
        content = export_to_srt(result)
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.srt"'}
        )
    elif format == "vtt":
        content = export_to_vtt(result)
        return Response(
            content=content,
            media_type="text/vtt; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.vtt"'}
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
            headers={"Content-Disposition": f'attachment; filename="{base_name}_rejection.csv"'}
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format '{format}'.")


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
            return Response(content=content, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{base_name}_karya.csv"'})
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
            return Response(content=content, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{base_name}.srt"'})
        elif fmt == "vtt":
            content = export_to_vtt(result)
            return Response(content=content, media_type="text/vtt; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{base_name}.vtt"'})
        elif fmt == "txt":
            content = export_to_txt(result)
            return Response(content=content, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{base_name}_transcript.txt"'})
        elif fmt == "json":
            content = export_to_json(result)
            return Response(content=content, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{base_name}_deliverable.json"'})

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
        headers={"Content-Disposition": f'attachment; filename="{base_name}_deliverables.zip"'}
    )


# Batch Processing Endpoints
@app.post("/api/batch/upload")
async def batch_upload(
    files: List[UploadFile] = File(...),
    language: str = Form("Auto-Detect"),
    script: str = Form("Auto-Detect")
):
    """Upload multiple files and queue them for batch processing."""
    tasks = []
    for file in files:
        file_path = UPLOAD_DIR / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        task = batch_manager.add_task(
            filename=file.filename,
            file_path=str(file_path),
            language=language,
            script=script
        )
        tasks.append(task)

    return {"tasks": tasks, "total_queued": len(tasks)}


@app.get("/api/batch/tasks")
async def get_batch_tasks():
    """Get all current batch tasks."""
    return {"tasks": batch_manager.get_all_tasks()}


@app.get("/api/batch/export/zip")
async def export_batch_zip(format: str = "all"):
    """Export all completed batch deliverables in a single ZIP."""
    zip_bytes = batch_manager.create_batch_zip(export_format=format)
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="karya_batch_deliverables.zip"'}
    )


@app.post("/api/batch/clear")
async def clear_batch_tasks():
    """Clear completed tasks."""
    batch_manager.clear_completed()
    return {"status": "cleared"}


@app.post("/api/batch/cancel/{task_id}")
async def cancel_batch_task(task_id: str):
    """Cancel a queued (not yet started) batch task."""
    success = batch_manager.cancel_task(task_id)
    if success:
        return {"status": "cancelled", "task_id": task_id}
    return {"status": "not_cancellable", "task_id": task_id,
            "detail": "Task already started or does not exist."}


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

    unique_prefix = uuid.uuid4().hex[:8]
    raw_stem = Path(file.filename).stem
    # Sanitize filename stem to eliminate unsafe characters that break URLs or filesystems
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
        raise HTTPException(status_code=500, detail=f"Error writing media upload: {str(e)}")

    return await _process_saved_media(file_path, safe_filename, clean_stem, raw_stem, ext)


async def _process_saved_media(file_path: Path, safe_filename: str, clean_stem: str, raw_stem: str, ext: str):
    """Validate media, resolve audio, precalculate waveform and register active session."""
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
    audio_path = None
    if ext in [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"]:
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

    return {
        "video_id": video_id,
        "filename": safe_filename,
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

    return await _process_saved_media(final_file_path, safe_filename, clean_stem, raw_stem, ext)


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
async def get_subtitle_waveform_endpoint(video_id: str, points_per_sec: int = 50):
    """Return high-precision acoustic waveform peaks for video_id with instant disk cache lookup."""
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


@app.post("/api/subtitle/generate")
async def generate_subtitles_endpoint(payload: dict):
    """Generate Netflix QC compliant subtitles from video with dynamic settings."""
    video_id = payload.get("video_id")
    language = payload.get("language", "en")
    content_type = payload.get("content_type", "adult")
    sdh_mode = payload.get("sdh_mode", False)
    cpl_limit = int(payload.get("cpl_limit", 42))
    max_cps = float(payload.get("max_cps", 20.0 if content_type == "adult" else 17.0))
    max_lines = int(payload.get("max_lines", 2))
    min_duration = float(payload.get("min_duration", 0.833))
    max_duration = float(payload.get("max_duration", 7.0))
    gemini_auto_fix = bool(payload.get("gemini_auto_fix", True))
    
    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")
        
    video_path = resolve_active_session_video(video_id)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video session not found or expired. Please re-upload the video.")
    
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
            gemini_auto_fix=gemini_auto_fix,
        )
        active_sessions[video_id]["result"] = result
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Subtitle generation failed: {str(e)}")


@app.post("/api/subtitle/generate_stream")
async def generate_subtitles_stream_endpoint(payload: dict):
    """Progressively stream subtitle batches using Server-Sent Events (SSE) with dynamic settings."""
    video_id = payload.get("video_id")
    language = payload.get("language", "auto")
    script = payload.get("script", "auto")
    content_type = payload.get("content_type", "adult")
    sdh_mode = payload.get("sdh_mode", False)
    cpl_limit = int(payload.get("cpl_limit", 42))
    max_cps = float(payload.get("max_cps", 20.0 if content_type == "adult" else 17.0))
    max_lines = int(payload.get("max_lines", 2))
    min_duration = float(payload.get("min_duration", 0.833))
    max_duration = float(payload.get("max_duration", 7.0))
    gemini_auto_fix = bool(payload.get("gemini_auto_fix", True))
    start_chunk = int(payload.get("start_chunk", 1))
    prev_events_count = int(payload.get("prev_events_count", 0))
    prev_batch_end = float(payload.get("prev_batch_end", 0.0))
    prev_context = payload.get("prev_context", [])
    raw_start_time = payload.get("start_time")
    start_time = float(raw_start_time) if raw_start_time is not None else None
    batch_mode = payload.get("batch_mode", "all")
    user_feedback = payload.get("user_feedback")
    
    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")
        
    video_path = resolve_active_session_video(video_id)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video session not found or expired. Please re-upload the video.")
    
    return StreamingResponse(
        generate_subtitles_stream(
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
            gemini_auto_fix=gemini_auto_fix,
            start_chunk=start_chunk,
            prev_events_count=prev_events_count,
            prev_batch_end=prev_batch_end,
            prev_context=prev_context,
            start_time=start_time,
            batch_mode=batch_mode,
            user_feedback=user_feedback,
        ),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no"
        }
    )


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

    whisper_words = None
    is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
    enable_whisper = os.getenv("ENABLE_WHISPER", "true").lower() == "true"
    whisper_model = os.getenv("WHISPER_MODEL", "tiny" if is_cloud else "base")
    language = payload.get("language") or (active_sessions.get(video_id, {}).get("language") if video_id else None)
    if enable_whisper and video_id:
        video_path = resolve_active_session_video(video_id) or ""
        audio_path = os.path.splitext(video_path)[0] + ".wav" if video_path else ""
        if os.path.exists(audio_path):
            try:
                from app.whisper_aligner import get_whisper_word_timestamps
                whisper_words = await asyncio.to_thread(get_whisper_word_timestamps, audio_path, language, whisper_model)
            except Exception:
                pass

    try:
        from app.gemini_qc_fixer import coordinate_gemini_qc_fix
        result = await asyncio.to_thread(
            coordinate_gemini_qc_fix,
            events=events,
            whisper_words=whisper_words,
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
async def acoustic_sync_subtitles_endpoint(payload: dict):
    """
    Closed-loop acoustic synchronization:
    Locks all subtitle events to exact audio speech timestamps using Whisper and VAD acoustic energy.
    """
    video_id = payload.get("video_id")
    events = payload.get("events", [])
    language = payload.get("language")
    content_type = payload.get("content_type", "adult")
    frame_rate = float(payload.get("frame_rate", 24.0))
    cpl_limit = int(payload.get("cpl_limit", 42))
    max_cps = float(payload.get("max_cps", 20.0 if content_type == "adult" else 17.0))
    max_lines = int(payload.get("max_lines", 2))
    min_duration = float(payload.get("min_duration", 0.833))
    max_duration = float(payload.get("max_duration", 7.0))
    shot_changes = payload.get("shot_changes", [])

    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")

    video_path = resolve_active_session_video(video_id)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video session not found or expired.")

    # Determine audio path (prioritize active session audio, then existing .wav, then extract)
    audio_path = None
    if video_id in active_sessions and active_sessions[video_id].get("audio_path"):
        cand = active_sessions[video_id]["audio_path"]
        if os.path.exists(cand):
            audio_path = cand

    if not audio_path:
        audio_cand = os.path.splitext(video_path)[0] + ".wav"
        if os.path.exists(audio_cand):
            audio_path = audio_cand
        else:
            try:
                audio_info = extract_audio_from_video(video_path)
                audio_path = audio_info.get("audio_path", "")
            except Exception as ex:
                raise HTTPException(status_code=500, detail=f"Failed to extract audio: {ex}")

    is_cloud = bool(os.getenv("RENDER") or os.getenv("PORT"))
    whisper_model = payload.get("whisper_model") or os.getenv("WHISPER_MODEL", "tiny" if is_cloud else "base")

    try:
        from app.whisper_aligner import get_whisper_word_timestamps, align_subtitle_timestamps
        from app.gemini_subtitle_generator import polish_subtitle_events_netflix

        # 1. Run Whisper to get acoustic words
        whisper_words = await asyncio.to_thread(
            get_whisper_word_timestamps,
            audio_path,
            language if language and language.lower() not in ["auto", "auto-detect"] else None,
            whisper_model
        )

        if not whisper_words:
            raise HTTPException(status_code=500, detail="Whisper could not detect speech or failed to transcribe.")

        # 2. Sequential Acoustic Alignment
        aligned = await asyncio.to_thread(
            align_subtitle_timestamps,
            events,
            whisper_words,
            12.0,
            0.0,
            audio_path
        )

        # 3. Netflix Polish
        polished = await asyncio.to_thread(
            polish_subtitle_events_netflix,
            events=aligned,
            cpl_limit=cpl_limit,
            max_cps=max_cps,
            max_lines=max_lines,
            min_duration=min_duration,
            max_duration=max_duration,
            frame_rate=frame_rate,
            shot_changes=shot_changes,
            prev_batch_end=0.0
        )

        # 4. Lint result
        lint_result = lint_all_subtitles(
            events=polished,
            shot_changes=shot_changes,
            content_type=content_type,
            frame_rate=frame_rate,
            custom_cpl=cpl_limit,
            custom_cps=max_cps,
            custom_max_lines=max_lines,
            custom_min_duration=min_duration,
            custom_max_duration=max_duration
        )

        return {
            "events": polished,
            "lint_result": lint_result,
            "matched_words_count": len(whisper_words),
            "whisper_model": whisper_model,
            "message": f"Successfully synchronized {len(polished)} subtitles with audio acoustics."
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Acoustic synchronization failed: {str(e)}")


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
async def export_subtitles_endpoint(payload: SubtitleExportRequest):
    """Export subtitles to requested format."""
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
