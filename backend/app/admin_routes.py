import os
import shutil
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, distinct

try:
    import psutil
except ImportError:
    psutil = None

from app.auth_module.database import get_auth_db
from app.auth_module.models import (
    User, AuthSession, LoginHistory, UserMediaAsset, SubtitleGenerationRun,
    SystemHardwareSnapshot, AdminAuditLog, AdminNotification
)
from app.auth_module.routes import get_current_user_from_token, get_current_admin_user, is_super_admin
from app.config import UPLOAD_DIR

logger = logging.getLogger(__name__)

admin_router = APIRouter(prefix="/api/admin", tags=["admin"])

# Global tracker for in-flight subtitle streams
_active_generation_streams_counter = 0

def increment_active_stream():
    global _active_generation_streams_counter
    _active_generation_streams_counter += 1

def decrement_active_stream():
    global _active_generation_streams_counter
    _active_generation_streams_counter = max(0, _active_generation_streams_counter - 1)

def get_active_stream_count() -> int:
    return _active_generation_streams_counter


def get_live_hardware_stats() -> Dict[str, Any]:
    """Collects real-time CPU, RAM, and Disk metrics via psutil."""
    cpu_percent = 0.0
    mem_used_mb = 0.0
    mem_total_mb = 0.0
    mem_percent = 0.0

    if psutil:
        try:
            cpu_percent = psutil.cpu_percent(interval=0.05)
            mem = psutil.virtual_memory()
            mem_used_mb = round(mem.used / (1024 * 1024), 1)
            mem_total_mb = round(mem.total / (1024 * 1024), 1)
            mem_percent = mem.percent
        except Exception as e:
            logger.debug(f"psutil read error: {e}")

    # Disk usage
    upload_path = UPLOAD_DIR.resolve()
    upload_size_mb = 0.0
    try:
        if upload_path.exists():
            total_bytes = sum(f.stat().st_size for f in upload_path.glob("**/*") if f.is_file())
            upload_size_mb = round(total_bytes / (1024 * 1024), 2)
    except Exception:
        pass

    disk_used_gb = 0.0
    disk_free_gb = 0.0
    disk_total_gb = 0.0
    disk_percent = 0.0
    try:
        disk = shutil.disk_usage(upload_path if upload_path.exists() else ".")
        disk_total_gb = round(disk.total / (1024 ** 3), 2)
        disk_used_gb = round(disk.used / (1024 ** 3), 2)
        disk_free_gb = round(disk.free / (1024 ** 3), 2)
        disk_percent = round((disk.used / disk.total) * 100, 1) if disk.total > 0 else 0.0
    except Exception:
        pass

    return {
        "cpu_percent": cpu_percent,
        "memory_used_mb": mem_used_mb,
        "memory_total_mb": mem_total_mb,
        "memory_percent": mem_percent,
        "disk_used_gb": disk_used_gb,
        "disk_free_gb": disk_free_gb,
        "disk_total_gb": disk_total_gb,
        "disk_percent": disk_percent,
        "upload_folder_mb": upload_size_mb,
        "active_sse_streams": get_active_stream_count()
    }


# ==============================================================================
# 0. Initial Setup / Promotion Helper
# ==============================================================================
@admin_router.post("/claim-initial-admin")
def claim_initial_admin(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """
    Bootstrap helper: Strictly restricted to Arpit Purohit.
    """
    if not is_super_admin(current_user.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Super Administrator role is strictly reserved for Arpit Purohit."
        )

    current_user.is_admin = True
    current_user.role = "admin"
    db.commit()

    return {
        "success": True,
        "message": f"Account {current_user.email} confirmed as Super Administrator.",
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "role": current_user.role,
            "is_admin": current_user.is_admin
        }
    }


# ==============================================================================
# 1. Overview & High-Level KPIs
# ==============================================================================
@admin_router.get("/overview")
def get_admin_overview(
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Returns high-level statistics and health KPIs for the Command Center dashboard."""
    now_utc = datetime.now(timezone.utc)
    day_ago = now_utc - timedelta(hours=24)

    # Cleanly deactivate expired sessions
    try:
        db.query(AuthSession).filter(
            AuthSession.is_active == True,
            AuthSession.expires_at <= now_utc
        ).update({"is_active": False})
        db.commit()
    except Exception:
        db.rollback()

    total_users = db.query(func.count(User.id)).scalar() or 0
    active_now_users = db.query(func.count(distinct(AuthSession.user_id))).join(
        User, AuthSession.user_id == User.id
    ).filter(
        AuthSession.is_active == True,
        AuthSession.expires_at > now_utc
    ).scalar() or 0
    active_now_users = min(active_now_users, total_users)

    total_uploads = db.query(func.count(UserMediaAsset.id)).scalar() or 0
    total_video_seconds = db.query(func.sum(UserMediaAsset.duration_seconds)).scalar() or 0.0

    total_runs = db.query(func.count(SubtitleGenerationRun.id)).scalar() or 0
    completed_runs = db.query(func.count(SubtitleGenerationRun.id)).filter(
        SubtitleGenerationRun.status == "completed"
    ).scalar() or 0
    failed_runs = db.query(func.count(SubtitleGenerationRun.id)).filter(
        SubtitleGenerationRun.status == "failed"
    ).scalar() or 0

    re_runs_count = db.query(func.count(SubtitleGenerationRun.id)).filter(
        SubtitleGenerationRun.run_index_for_video > 1
    ).scalar() or 0

    total_spend_usd = db.query(func.sum(SubtitleGenerationRun.total_run_cost_usd)).scalar() or 0.0
    gemini_spend_usd = db.query(func.sum(SubtitleGenerationRun.gemini_cost_usd)).scalar() or 0.0
    whisper_spend_usd = db.query(func.sum(SubtitleGenerationRun.whisper_cost_usd)).scalar() or 0.0
    total_gemini_tokens = (
        (db.query(func.sum(SubtitleGenerationRun.gemini_input_tokens)).scalar() or 0) +
        (db.query(func.sum(SubtitleGenerationRun.gemini_output_tokens)).scalar() or 0)
    )

    hardware = get_live_hardware_stats()

    return {
        "success": True,
        "stats": {
            "users": {
                "total": total_users,
                "active_now": active_now_users
            },
            "media": {
                "total_uploads": total_uploads,
                "total_duration_hours": round(total_video_seconds / 3600, 2),
                "total_duration_minutes": round(total_video_seconds / 60, 1)
            },
            "generations": {
                "total_runs": total_runs,
                "completed_runs": completed_runs,
                "failed_runs": failed_runs,
                "re_runs_count": re_runs_count,
                "re_run_rate_percent": round((re_runs_count / total_runs * 100), 1) if total_runs > 0 else 0.0
            },
            "financials": {
                "total_spend_usd": round(total_spend_usd, 4),
                "total_spend_inr": round(total_spend_usd * 86.5, 2),  # Current approx USD/INR
                "gemini_spend_usd": round(gemini_spend_usd, 4),
                "scribe_spend_usd": round(whisper_spend_usd, 4),
                "whisper_spend_usd": round(whisper_spend_usd, 4),
                "total_gemini_tokens": total_gemini_tokens
            },
            "hardware": hardware
        }
    }


# ==============================================================================
# 2. User Intelligence & Management
# ==============================================================================
@admin_router.get("/users")
def list_users(
    query: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Lists registered users with aggregated spend, upload count, and run metrics."""
    q = db.query(User)
    if query:
        search = f"%{query.strip().lower()}%"
        q = q.filter((func.lower(User.name).like(search)) | (func.lower(User.email).like(search)))

    total_count = q.count()
    users = q.order_by(desc(User.created_at)).offset(offset).limit(limit).all()

    result = []
    now_utc = datetime.now(timezone.utc)

    for u in users:
        # Check if user has active session
        has_active_sess = db.query(AuthSession).filter(
            AuthSession.user_id == u.id,
            AuthSession.is_active == True,
            AuthSession.expires_at > now_utc
        ).first() is not None

        # Count uploads & runs
        upload_count = db.query(func.count(UserMediaAsset.id)).filter(UserMediaAsset.user_id == u.id).scalar() or 0
        run_count = db.query(func.count(SubtitleGenerationRun.id)).filter(SubtitleGenerationRun.user_id == u.id).scalar() or 0
        spend = db.query(func.sum(SubtitleGenerationRun.total_run_cost_usd)).filter(SubtitleGenerationRun.user_id == u.id).scalar() or 0.0

        # Total tokens consumed by user across all generations
        total_tokens = db.query(
            func.sum(SubtitleGenerationRun.gemini_input_tokens + SubtitleGenerationRun.gemini_output_tokens)
        ).filter(SubtitleGenerationRun.user_id == u.id).scalar() or 0

        # Total duration in minutes of subtitle generation / media
        total_duration_sec = db.query(
            func.sum(UserMediaAsset.duration_seconds)
        ).filter(UserMediaAsset.user_id == u.id).scalar() or 0.0

        # Total re-runs / continues
        re_runs_count = db.query(func.count(SubtitleGenerationRun.id)).filter(
            SubtitleGenerationRun.user_id == u.id,
            SubtitleGenerationRun.run_index_for_video > 1
        ).scalar() or 0

        # Last login
        last_login = db.query(LoginHistory).filter(LoginHistory.user_id == u.id).order_by(desc(LoginHistory.login_time)).first()

        result.append({
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "employee_id": u.employee_id,
            "role": u.role or "editor",
            "is_admin": is_super_admin(u.email),
            "is_blocked": bool(u.is_blocked),
            "is_verified": u.is_verified,
            "is_online": has_active_sess,
            "total_uploads": upload_count,
            "total_runs": run_count,
            "re_runs_count": re_runs_count,
            "total_tokens": int(total_tokens),
            "total_duration_seconds": round(total_duration_sec, 1),
            "total_duration_minutes": round(total_duration_sec / 60.0, 1),
            "total_spend_usd": round(spend, 4),
            "monthly_budget_usd": u.monthly_budget_usd or 50.0,
            "max_videos_quota": getattr(u, "max_videos_quota", -1) if getattr(u, "max_videos_quota", None) is not None else -1,
            "can_export": getattr(u, "can_export", True) if getattr(u, "can_export", None) is not None else True,
            "can_ai_optimize": getattr(u, "can_ai_optimize", True) if getattr(u, "can_ai_optimize", None) is not None else True,
            "can_audio_peaks": getattr(u, "can_audio_peaks", True) if getattr(u, "can_audio_peaks", None) is not None else True,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login_at": last_login.login_time.isoformat() if last_login and last_login.login_time else None,
            "last_login_location": last_login.operating_location if last_login else None
        })

    return {
        "success": True,
        "total": total_count,
        "users": result
    }


@admin_router.get("/users/{user_id}")
def get_user_dossier(
    user_id: str,
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Returns a full dossier for a specific user: logins, uploads, runs, and spend."""
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    logins = db.query(LoginHistory).filter(LoginHistory.user_id == user_id).order_by(desc(LoginHistory.login_time)).limit(30).all()
    sessions = db.query(AuthSession).filter(AuthSession.user_id == user_id).order_by(desc(AuthSession.created_at)).limit(30).all()
    uploads = db.query(UserMediaAsset).filter(UserMediaAsset.user_id == user_id).order_by(desc(UserMediaAsset.created_at)).limit(50).all()
    runs = db.query(SubtitleGenerationRun).filter(SubtitleGenerationRun.user_id == user_id).order_by(desc(SubtitleGenerationRun.started_at)).limit(50).all()

    total_spend = db.query(func.sum(SubtitleGenerationRun.total_run_cost_usd)).filter(SubtitleGenerationRun.user_id == user_id).scalar() or 0.0
    total_tokens = db.query(
        func.sum(SubtitleGenerationRun.gemini_input_tokens + SubtitleGenerationRun.gemini_output_tokens)
    ).filter(SubtitleGenerationRun.user_id == user_id).scalar() or 0
    total_duration_sec = db.query(
        func.sum(UserMediaAsset.duration_seconds)
    ).filter(UserMediaAsset.user_id == user_id).scalar() or 0.0

    # Build video lookup maps
    upload_title_map = {u.video_id: u.filename for u in uploads}
    upload_duration_map = {u.video_id: u.duration_seconds for u in uploads}

    # Format runs
    formatted_runs = []
    for r in runs:
        title = upload_title_map.get(r.video_id) or (r.media_asset.filename if r.media_asset else f"Video {r.video_id[:8]}")
        vid_len = upload_duration_map.get(r.video_id) or (r.media_asset.duration_seconds if r.media_asset else r.whisper_audio_seconds)
        formatted_runs.append({
            "id": r.id,
            "video_id": r.video_id,
            "video_title": title,
            "filename": title,
            "run_index": r.run_index_for_video,
            "is_rerun": r.run_index_for_video > 1,
            "target_language": r.target_language,
            "mode": r.mode,
            "status": r.status,
            "batches_completed": r.batches_completed,
            "total_batches": r.total_batches,
            "tokens": r.gemini_input_tokens + r.gemini_output_tokens,
            "whisper_seconds": r.whisper_audio_seconds,
            "video_duration_seconds": round(vid_len, 1),
            "duration_seconds": round(r.total_duration_seconds, 1),
            "cost_usd": round(r.total_run_cost_usd, 4),
            "error": r.error_message,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None
        })

    # Build unified production video projects list (merging uploads and runs)
    production_map = {}
    for u in uploads:
        production_map[u.video_id] = {
            "video_id": u.video_id,
            "title": u.filename,
            "filename": u.filename,
            "duration_seconds": round(u.duration_seconds, 1),
            "size_mb": round(u.file_size_bytes / (1024 * 1024), 2),
            "resolution": u.video_resolution,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "total_tokens": 0,
            "total_cost_usd": 0.0,
            "rerun_count": 1,
            "status": "uploaded",
            "target_language": "en",
            "runs": []
        }

    for r in formatted_runs:
        vid = r["video_id"]
        if vid not in production_map:
            production_map[vid] = {
                "video_id": vid,
                "title": r["video_title"],
                "filename": r["video_title"],
                "duration_seconds": r["video_duration_seconds"],
                "size_mb": 0.0,
                "resolution": "",
                "created_at": r["started_at"],
                "total_tokens": 0,
                "total_cost_usd": 0.0,
                "rerun_count": 1,
                "status": r["status"],
                "target_language": r["target_language"],
                "runs": []
            }
        item = production_map[vid]
        item["runs"].append(r)
        item["total_tokens"] += r["tokens"]
        item["total_cost_usd"] = round(item["total_cost_usd"] + r["cost_usd"], 4)
        item["rerun_count"] = max(item["rerun_count"], r["run_index"])
        if r["status"] in ("completed", "in_progress", "failed"):
            item["status"] = r["status"]
        if r["target_language"]:
            item["target_language"] = r["target_language"]

    production_items = list(production_map.values())

    return {
        "success": True,
        "user": {
            "id": target_user.id,
            "name": target_user.name,
            "email": target_user.email,
            "employee_id": target_user.employee_id,
            "role": target_user.role or "editor",
            "is_admin": is_super_admin(target_user.email),
            "is_blocked": bool(target_user.is_blocked),
            "is_verified": target_user.is_verified,
            "total_spend_usd": round(total_spend, 4),
            "total_tokens": int(total_tokens),
            "total_duration_seconds": round(total_duration_sec, 1),
            "total_duration_minutes": round(total_duration_sec / 60.0, 1),
            "monthly_budget_usd": target_user.monthly_budget_usd or 50.0,
            "max_videos_quota": getattr(target_user, "max_videos_quota", -1) if getattr(target_user, "max_videos_quota", None) is not None else -1,
            "can_export": getattr(target_user, "can_export", True) if getattr(target_user, "can_export", None) is not None else True,
            "can_ai_optimize": getattr(target_user, "can_ai_optimize", True) if getattr(target_user, "can_ai_optimize", None) is not None else True,
            "can_audio_peaks": getattr(target_user, "can_audio_peaks", True) if getattr(target_user, "can_audio_peaks", None) is not None else True,
            "created_at": target_user.created_at.isoformat() if target_user.created_at else None
        },
        "logins": [
            {
                "id": l.id,
                "location": l.operating_location,
                "ip_address": l.ip_address,
                "user_agent": l.user_agent,
                "time": l.login_time.isoformat() if l.login_time else None
            }
            for l in logins
        ],
        "sessions": [
            {
                "id": s.id,
                "login_time": s.created_at.isoformat() if s.created_at else None,
                "expires_at": s.expires_at.isoformat() if s.expires_at else None,
                "is_active": s.is_active,
                "location": s.operating_location or "Standard Station",
                "device": s.device_info or "Web Browser",
                "device_info": s.device_info or "Web Browser",
                "ip_address": getattr(s, "ip_address", "127.0.0.1"),
                "is_expired": not (s.is_active and s.expires_at > datetime.now(timezone.utc)),
                "status": "Active Workstation" if s.is_active and s.expires_at > datetime.now(timezone.utc) else "Logged Out / Expired"
            }
            for s in sessions
        ],
        "uploads": [
            {
                "id": u.id,
                "video_id": u.video_id,
                "filename": u.filename,
                "size_mb": round(u.file_size_bytes / (1024 * 1024), 2),
                "duration_seconds": u.duration_seconds,
                "resolution": u.video_resolution,
                "snr_db": u.snr_db,
                "created_at": u.created_at.isoformat() if u.created_at else None
            }
            for u in uploads
        ],
        "runs": formatted_runs,
        "production_items": production_items
    }


class UpdateUserStatusRequest(BaseModel):
    role: Optional[str] = None
    is_admin: Optional[bool] = None
    is_blocked: Optional[bool] = None
    is_verified: Optional[bool] = None
    monthly_budget_usd: Optional[float] = None

@admin_router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: str,
    payload: UpdateUserStatusRequest,
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Allows administrators to change user roles, block/unblock, verify/unverify, or adjust monthly budget."""
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    if target_user.id == admin.id and payload.is_blocked is True:
        raise HTTPException(status_code=400, detail="Administrators cannot block their own account.")

    if payload.role is not None:
        new_role = payload.role.strip().lower()
        if new_role == "admin" and not is_super_admin(target_user.email):
            raise HTTPException(
                status_code=400,
                detail="Super Administrator status is strictly reserved for Arpit Purohit."
            )
        target_user.role = new_role
        target_user.is_admin = is_super_admin(target_user.email) and (new_role == "admin")

    if payload.is_admin is not None:
        if payload.is_admin and not is_super_admin(target_user.email):
            raise HTTPException(
                status_code=400,
                detail="Super Administrator status is strictly reserved for Arpit Purohit."
            )
        target_user.is_admin = bool(payload.is_admin and is_super_admin(target_user.email))
        if target_user.is_admin:
            target_user.role = "admin"

    if payload.is_verified is not None:
        target_user.is_verified = bool(payload.is_verified)

    if payload.is_blocked is not None:
        target_user.is_blocked = payload.is_blocked
        if payload.is_blocked:
            db.query(AuthSession).filter(AuthSession.user_id == user_id).update({"is_active": False})
            # Notify user they have been blocked
            db.add(AdminNotification(
                user_id=target_user.id,
                admin_email=admin.email,
                title="Account Access Restricted",
                message="Your account access has been temporarily restricted by the administrator. Please contact support for more information.",
                notification_type="warning"
            ))
        else:
            # Notify user they have been unblocked
            db.add(AdminNotification(
                user_id=target_user.id,
                admin_email=admin.email,
                title="Account Access Restored",
                message="Your account access has been restored by the administrator. You may now continue using Subtitle Studio.",
                notification_type="notice"
            ))

    if payload.monthly_budget_usd is not None:
        old_budget = target_user.monthly_budget_usd or 50.0
        new_budget = max(0.0, float(payload.monthly_budget_usd))
        target_user.monthly_budget_usd = new_budget
        if abs(new_budget - old_budget) > 0.001:
            db.add(AdminNotification(
                user_id=target_user.id,
                admin_email=admin.email,
                title="Monthly Budget Cap Updated",
                message=f"Your monthly budget cap has been updated from ${old_budget:.2f} to ${new_budget:.2f} by the administrator.",
                notification_type="quota_limit"
            ))

    if payload.role is not None and payload.role != target_user.role:
        db.add(AdminNotification(
            user_id=target_user.id,
            admin_email=admin.email,
            title="Account Role Updated",
            message=f"Your account role has been updated to '{payload.role.strip()}' by the administrator.",
            notification_type="notice"
        ))

    db.commit()

    return {
        "success": True,
        "message": "User status updated successfully.",
        "user": {
            "id": target_user.id,
            "role": target_user.role,
            "is_admin": is_super_admin(target_user.email),
            "is_blocked": target_user.is_blocked,
            "monthly_budget_usd": target_user.monthly_budget_usd
        }
    }


@admin_router.post("/users/{user_id}/approve-workflow")
def approve_user_workflow(
    user_id: str,
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Admin action to approve/move a newly registered or pending user to the Active Production Workflow."""
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    target_user.is_verified = True
    target_user.is_blocked = False
    if not target_user.role or target_user.role in ("pending", "viewer"):
        target_user.role = "editor"

    audit = AdminAuditLog(
        user_id=admin.id,
        event_type="user_approved_workflow",
        details=f"Admin {admin.email} moved {target_user.email} into the Active Production Workflow."
    )
    db.add(audit)

    notif = AdminNotification(
        user_id=target_user.id,
        admin_email=admin.email,
        title="Account Approved for Production Workflow",
        message="Your account has been officially approved for active production workflows in Subtitle Studio.",
        notification_type="system"
    )
    db.add(notif)
    db.commit()

    return {
        "success": True,
        "message": f"User {target_user.email} has been approved and moved to the Active Production Workflow.",
        "user_id": target_user.id
    }


class UserLimitsRequest(BaseModel):
    max_videos_quota: Optional[int] = None
    monthly_budget_usd: Optional[float] = None
    can_export: Optional[bool] = None
    can_ai_optimize: Optional[bool] = None
    can_audio_peaks: Optional[bool] = None

@admin_router.post("/users/{user_id}/limits")
def update_user_limits(
    user_id: str,
    payload: UserLimitsRequest,
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Allows Super-Admin to configure per-user video generation quotas and feature access toggles."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    if payload.max_videos_quota is not None:
        target.max_videos_quota = int(payload.max_videos_quota)
    if payload.monthly_budget_usd is not None:
        target.monthly_budget_usd = max(0.0, float(payload.monthly_budget_usd))
    if payload.can_export is not None:
        target.can_export = bool(payload.can_export)
    if payload.can_ai_optimize is not None:
        target.can_ai_optimize = bool(payload.can_ai_optimize)
    if payload.can_audio_peaks is not None:
        target.can_audio_peaks = bool(payload.can_audio_peaks)

    audit = AdminAuditLog(
        user_id=admin.id,
        event_type="user_limits_updated",
        details=f"Updated limits for {target.email}: quota={target.max_videos_quota}, export={target.can_export}, ai={target.can_ai_optimize}, peaks={target.can_audio_peaks}"
    )
    db.add(audit)

    # Automatically notify user in their in-app studio bell
    quota_desc = f"{target.max_videos_quota} videos" if target.max_videos_quota >= 0 else "Unlimited"
    features_list = []
    if target.can_export: features_list.append("Subtitle Export")
    if target.can_ai_optimize: features_list.append("AI Optimization")
    if target.can_audio_peaks: features_list.append("Audio Waveforms")
    allowed_str = ", ".join(features_list) if features_list else "None"

    limits_notif = AdminNotification(
        user_id=target.id,
        admin_email=admin.email,
        title="Account Production Quota & Feature Permissions Updated",
        message=f"Administrator has updated your account quotas and permissions:\n• Video Generation Quota: {quota_desc}\n• Monthly Budget Cap: ${target.monthly_budget_usd:.2f}\n• Active Features: {allowed_str}",
        notification_type="quota_limit"
    )
    db.add(limits_notif)
    db.commit()

    return {
        "success": True,
        "message": f"Updated limits and feature flags for {target.email}.",
        "user": {
            "id": target.id,
            "email": target.email,
            "max_videos_quota": target.max_videos_quota,
            "monthly_budget_usd": target.monthly_budget_usd,
            "can_export": target.can_export,
            "can_ai_optimize": target.can_ai_optimize,
            "can_audio_peaks": target.can_audio_peaks
        }
    }


class SendFeedbackRequest(BaseModel):
    title: str
    message: str
    notification_type: str = "feedback"  # "feedback", "warning", "notice", "quota_limit"

@admin_router.post("/users/{user_id}/feedback")
def send_user_feedback(
    user_id: str,
    payload: SendFeedbackRequest,
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Allows Super-Admin to dispatch direct in-app feedback or notices to a specific user."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    notification = AdminNotification(
        user_id=target.id,
        admin_email=admin.email,
        title=payload.title.strip(),
        message=payload.message.strip(),
        notification_type=payload.notification_type or "feedback"
    )
    db.add(notification)

    audit = AdminAuditLog(
        user_id=admin.id,
        event_type="feedback_sent",
        details=f"Sent {payload.notification_type} notice to {target.email}: '{payload.title}'"
    )
    db.add(audit)
    db.commit()

    return {
        "success": True,
        "message": f"Notification successfully dispatched to {target.email}."
    }


@admin_router.post("/users/{user_id}/kick")
def kick_user_sessions(
    user_id: str,
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Terminates all active sessions for a user, requiring them to re-authenticate."""
    count = db.query(AuthSession).filter(
        AuthSession.user_id == user_id,
        AuthSession.is_active == True
    ).update({"is_active": False})
    db.commit()

    return {
        "success": True,
        "message": f"Successfully terminated {count} active session(s) for user."
    }


# ==============================================================================
# 3. Video Upload Auditing & Deduplication
# ==============================================================================
@admin_router.get("/uploads")
def list_uploaded_media(
    query: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Audit table of all uploaded videos across all users with deduplication info."""
    q = db.query(UserMediaAsset).join(User, UserMediaAsset.user_id == User.id)

    if query:
        search = f"%{query.strip().lower()}%"
        q = q.filter(
            (func.lower(UserMediaAsset.filename).like(search)) |
            (func.lower(UserMediaAsset.video_id).like(search)) |
            (func.lower(User.email).like(search))
        )

    total_count = q.count()
    assets = q.order_by(desc(UserMediaAsset.created_at)).offset(offset).limit(limit).all()

    result = []
    for a in assets:
        # Check how many times subtitles were generated for this video
        runs_count = db.query(func.count(SubtitleGenerationRun.id)).filter(
            SubtitleGenerationRun.video_id == a.video_id
        ).scalar() or 0

        # Check if same file_hash was uploaded by others (duplicate detection)
        duplicate_count = 0
        if a.file_hash:
            duplicate_count = db.query(func.count(UserMediaAsset.id)).filter(
                UserMediaAsset.file_hash == a.file_hash,
                UserMediaAsset.id != a.id
            ).scalar() or 0

        result.append({
            "id": a.id,
            "video_id": a.video_id,
            "filename": a.filename,
            "user_id": a.user_id,
            "user_name": a.user.name if a.user else "Unknown",
            "user_email": a.user.email if a.user else "Unknown",
            "file_size_mb": round(a.file_size_bytes / (1024 * 1024), 2),
            "duration_seconds": round(a.duration_seconds, 1),
            "video_resolution": a.video_resolution,
            "audio_channels": a.audio_channels,
            "snr_db": round(a.snr_db, 1) if a.snr_db else 0.0,
            "runs_count": runs_count,
            "has_duplicates": duplicate_count > 0,
            "duplicate_count": duplicate_count,
            "created_at": a.created_at.isoformat() if a.created_at else None
        })

    return {
        "success": True,
        "total": total_count,
        "uploads": result
    }


# ==============================================================================
# 4. Subtitle Generation Runs & Observability
# ==============================================================================
@admin_router.get("/generations")
def list_generation_runs(
    status_filter: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Detailed log of all subtitle generation runs including re-runs and token costs."""
    q = db.query(SubtitleGenerationRun).join(User, SubtitleGenerationRun.user_id == User.id)

    if status_filter:
        q = q.filter(SubtitleGenerationRun.status == status_filter.strip().lower())
    if user_email:
        q = q.filter(func.lower(User.email).like(f"%{user_email.strip().lower()}%"))

    total_count = q.count()
    runs = q.order_by(desc(SubtitleGenerationRun.started_at)).offset(offset).limit(limit).all()

    result = []
    for r in runs:
        result.append({
            "id": r.id,
            "video_id": r.video_id,
            "user_name": r.user.name if r.user else "Unknown",
            "user_email": r.user.email if r.user else "Unknown",
            "run_index": r.run_index_for_video,
            "is_rerun": r.run_index_for_video > 1,
            "target_language": r.target_language,
            "mode": r.mode,
            "status": r.status,
            "batches_completed": r.batches_completed,
            "total_batches": r.total_batches,
            "gemini_input_tokens": r.gemini_input_tokens,
            "gemini_output_tokens": r.gemini_output_tokens,
            "total_tokens": r.gemini_input_tokens + r.gemini_output_tokens,
            "scribe_audio_seconds": round(r.whisper_audio_seconds, 1),
            "whisper_audio_seconds": round(r.whisper_audio_seconds, 1),
            "total_duration_seconds": round(r.total_duration_seconds, 1),
            "gemini_cost_usd": round(r.gemini_cost_usd, 4),
            "scribe_cost_usd": round(r.whisper_cost_usd, 4),
            "whisper_cost_usd": round(r.whisper_cost_usd, 4),
            "total_run_cost_usd": round(r.total_run_cost_usd, 4),
            "error_message": r.error_message,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None
        })

    return {
        "success": True,
        "total": total_count,
        "runs": result
    }


# ==============================================================================
# 5. Live Server Hardware & Infrastructure
# ==============================================================================
@admin_router.get("/hardware/live")
def get_live_hardware(
    admin: User = Depends(get_current_admin_user)
):
    """Returns instant snapshot of CPU, RAM, Disk, and active SSE generation streams."""
    return {
        "success": True,
        "metrics": get_live_hardware_stats()
    }


@admin_router.get("/hardware/history")
def get_hardware_history(
    limit: int = Query(60, ge=10, le=1440),
    admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_auth_db)
):
    """Returns recent background hardware snapshots for time-series charts."""
    records = db.query(SystemHardwareSnapshot).order_by(
        desc(SystemHardwareSnapshot.recorded_at)
    ).limit(limit).all()

    # Return chronological order (oldest to newest for graphing)
    chronological = list(reversed(records))

    return {
        "success": True,
        "history": [
            {
                "time": r.recorded_at.strftime("%H:%M:%S") if r.recorded_at else "",
                "cpu_percent": r.cpu_percent,
                "memory_percent": r.memory_percent,
                "memory_used_mb": r.memory_used_mb,
                "disk_percent": r.disk_percent,
                "active_streams": r.active_sse_streams
            }
            for r in chronological
        ]
    }


# ==============================================================================
# 6. User-Facing Notification Endpoints (accessible by any authenticated user)
# ==============================================================================
@admin_router.get("/me/notifications")
def get_my_notifications(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Returns all in-app notifications for the currently logged-in user."""
    notifications = db.query(AdminNotification).filter(
        AdminNotification.user_id == current_user.id
    ).order_by(desc(AdminNotification.created_at)).limit(50).all()

    return {
        "success": True,
        "unread_count": sum(1 for n in notifications if not n.is_read),
        "notifications": [
            {
                "id": n.id,
                "title": n.title,
                "message": n.message,
                "notification_type": n.notification_type,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat() if n.created_at else None
            }
            for n in notifications
        ]
    }


@admin_router.post("/me/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Mark a specific notification as read for the current user."""
    notif = db.query(AdminNotification).filter(
        AdminNotification.id == notification_id,
        AdminNotification.user_id == current_user.id
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found.")
    notif.is_read = True
    db.commit()
    return {"success": True}


@admin_router.post("/me/notifications/read-all")
def mark_all_notifications_read(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Mark all notifications as read for the current user."""
    db.query(AdminNotification).filter(
        AdminNotification.user_id == current_user.id,
        AdminNotification.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"success": True, "message": "All notifications marked as read."}
