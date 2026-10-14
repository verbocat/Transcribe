"""Per-account limits and feature access, set by an admin and enforced on the server.

* Access window: `access_expires_at` (NULL = never). After it passes the account cannot sign in or use the API.
* Studio / feature switches: Transcribe Studio, Subtitle Studio, AI translation, AI assistance, exports, waveforms.
* Job limits: longest file per transcription job (`max_file_minutes`) and jobs per rolling 24 hours (`max_jobs_per_day`).
  NULL means no limit.

Hour budgets live in usage.py; `check_job` runs inside usage.reserve, so every metered route gets these checks
before any hours are held or any provider is called.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import User, UsageReservation

TRANSCRIBE_ROUTES = {"/api/transcribe", "/api/transcribe_async"}
SUBTITLE_ROUTES = {"/api/subtitle/generate", "/api/subtitle/generate_stream", "/api/subtitle/acoustic_sync"}
TRANSLATE_ROUTES = {"/api/centroid/translate"}

FLAGS = {  # column -> (label shown to admins, message shown to the user when it is off)
    "can_transcribe_studio": ("Transcribe Studio", "Transcribe Studio is not enabled for your account."),
    "can_subtitle_studio": ("Subtitle Studio", "Subtitle Studio is not enabled for your account."),
    "can_translate": ("AI translation", "AI translation is not enabled for your account."),
    "can_ai_optimize": ("AI assistance", "AI assistance (context autofill, AI proofreading, speaker review, script analysis) is not enabled for your account."),
    "can_export": ("Exports & downloads", "Exporting files is not enabled for your account."),
    "can_audio_peaks": ("Audio waveform", "Audio waveforms are not enabled for your account."),
}
_ASK = " Ask your administrator if you need it."


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def flag(user: User, name: str) -> bool:
    v = getattr(user, name, True)
    return True if v is None else bool(v)


def is_expired(user: User, now: Optional[datetime] = None) -> bool:
    exp = _utc(getattr(user, "access_expires_at", None))
    return exp is not None and (now or datetime.now(timezone.utc)) >= exp


def expiry_message(user: User) -> str:
    exp = _utc(user.access_expires_at)
    last_day = (exp - timedelta(seconds=1)).strftime("%d %b %Y")
    return f"Your access to Lower Third ended on {last_day}." + _ASK


def ensure_active(user: User) -> None:
    if is_expired(user):
        raise HTTPException(status_code=403, detail=expiry_message(user))


def require(user: Optional[User], name: str) -> None:
    """Raise 403 when a signed-in user has this feature switched off (anonymous callers are left to the route)."""
    if user is not None and not flag(user, name):
        raise HTTPException(status_code=403, detail=FLAGS[name][1] + _ASK)


def jobs_last_24h(db: Session, user_id: str) -> int:
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).replace(tzinfo=None)
    return db.query(UsageReservation).filter(
        UsageReservation.user_id == user_id,
        UsageReservation.created_at >= since,
        UsageReservation.status != "refunded",
    ).count()


def check_job(db: Session, user: User, kind: str, ms: int, route: str) -> None:
    """Everything except the hour budget: access window, studio/feature switches, file length, jobs per day."""
    ensure_active(user)
    if route in TRANSCRIBE_ROUTES:
        require(user, "can_transcribe_studio")
    elif route in SUBTITLE_ROUTES:
        require(user, "can_subtitle_studio")
    elif route in TRANSLATE_ROUTES:
        require(user, "can_translate")

    max_min = getattr(user, "max_file_minutes", None)
    if kind == "transcribe" and max_min and ms > max_min * 60_000:
        raise HTTPException(
            status_code=403,
            detail=f"This file is {ms / 60_000:.0f} min long; your account allows files up to {max_min} min." + _ASK,
        )

    per_day = getattr(user, "max_jobs_per_day", None)
    if per_day is not None and jobs_last_24h(db, user.id) >= per_day:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit reached: your account allows {per_day} job{'s' if per_day != 1 else ''} per 24 hours." + _ASK,
        )


def summary(user: User, db: Optional[Session] = None) -> Dict[str, Any]:
    exp = _utc(getattr(user, "access_expires_at", None))
    out: Dict[str, Any] = {name: flag(user, name) for name in FLAGS}
    out.update({
        "max_file_minutes": getattr(user, "max_file_minutes", None),
        "max_jobs_per_day": getattr(user, "max_jobs_per_day", None),
        # the last day the account can still be used, as YYYY-MM-DD (stored as the midnight after it)
        "access_until": (exp - timedelta(seconds=1)).date().isoformat() if exp else None,
        "expired": is_expired(user),
    })
    if db is not None:
        out["jobs_last_24h"] = jobs_last_24h(db, user.id)
    return out


def expiry_from_date(day: Optional[str]) -> Optional[datetime]:
    """'2026-12-31' -> the midnight (UTC) after that day, so the account works through the whole day."""
    if not day:
        return None
    try:
        d = datetime.strptime(day.strip()[:10], "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Access end date must look like 2026-12-31.")
    return (d + timedelta(days=1)).replace(tzinfo=timezone.utc)
