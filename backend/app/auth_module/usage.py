"""Hour budgets for transcription and translation.

Everything here is server-side. A job reserves its hours *before* it starts, in one conditional UPDATE
(`used + reserved + job <= limit`), so two concurrent requests can never both pass a nearly-empty
budget. When the job ends the reservation is settled (charged) or refunded. Every step is also written
to the append-only usage_ledger.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import UsageLedger, UsageReservation, User

logger = logging.getLogger(__name__)

TRANSCRIBE = "transcribe"
TRANSLATE = "translate"
KINDS = (TRANSCRIBE, TRANSLATE)
MS_PER_HOUR = 3_600_000
MAX_HOURS = 100_000  # sanity cap for an admin-entered limit
STALE_AFTER = timedelta(hours=6)  # a reservation this old belongs to a job that can no longer be running

_COLS = {
    TRANSCRIBE: ("transcribe_limit_ms", "transcribe_used_ms", "transcribe_reserved_ms"),
    TRANSLATE: ("translate_limit_ms", "translate_used_ms", "translate_reserved_ms"),
}
_LABEL = {TRANSCRIBE: "transcription", TRANSLATE: "translation"}


class OutOfHours(HTTPException):
    """402: the account does not have enough hours left for this job."""

    def __init__(self, kind: str, needed_ms: int, remaining_ms: int):
        super().__init__(
            status_code=402,
            detail=(
                f"Out of hours: this {_LABEL[kind]} needs {_fmt(needed_ms)} but only "
                f"{_fmt(remaining_ms)} of {_LABEL[kind]} time is left on your account. "
                "Ask your administrator for more hours."
            ),
        )
        # Sent next to `detail` so the UI can tell this error from any other 402.
        self.extra = {
            "code": "out_of_hours", "kind": kind,
            "needed_hours": round(needed_ms / MS_PER_HOUR, 4),
            "remaining_hours": round(remaining_ms / MS_PER_HOUR, 4),
        }


def _fmt(ms: int) -> str:
    s = max(0, int(ms // 1000))
    return f"{s // 3600}h {s % 3600 // 60:02d}m {s % 60:02d}s"


def hours_to_ms(hours: Optional[float]) -> Optional[int]:
    """Admin input (hours, or None for unlimited) -> whole milliseconds, validated."""
    if hours is None:
        return None
    try:
        h = float(hours)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Hours must be a number.")
    if h != h or h < 0 or h > MAX_HOURS:  # NaN, negative, absurd
        raise HTTPException(status_code=400, detail=f"Hours must be between 0 and {MAX_HOURS}.")
    return int(round(h * MS_PER_HOUR))


def usage_summary(user: User) -> Dict[str, Any]:
    """What the UI shows: limits, used, in-flight and remaining hours per budget (None = unlimited)."""
    out: Dict[str, Any] = {}
    for kind, (lim_c, used_c, res_c) in _COLS.items():
        limit, used, reserved = getattr(user, lim_c), getattr(user, used_c) or 0, getattr(user, res_c) or 0
        out[kind] = {
            "limit_hours": None if limit is None else round(limit / MS_PER_HOUR, 4),
            "used_hours": round(used / MS_PER_HOUR, 4),
            "reserved_hours": round(reserved / MS_PER_HOUR, 4),
            "remaining_hours": None if limit is None else round(max(0, limit - used - reserved) / MS_PER_HOUR, 4),
            "unlimited": limit is None,
        }
    return out


def _ledger(db: Session, user_id: str, email: Optional[str], kind: str, event_name: str, ms: int,
            reservation_id: Optional[str] = None, route: Optional[str] = None, ref: Optional[str] = None,
            note: Optional[str] = None, actor_id: Optional[str] = None) -> None:
    db.add(UsageLedger(user_id=user_id, user_email=email, kind=kind, event=event_name, ms=int(ms),
                       reservation_id=reservation_id, route=route, ref=(ref or "")[:255] or None,
                       note=note, actor_id=actor_id))


def reserve(db: Session, user_id: str, kind: str, ms: int, route: str, ref: Optional[str] = None) -> str:
    """Atomically hold `ms` of the user's budget. Returns the reservation id, or raises OutOfHours (402)."""
    if kind not in KINDS:
        raise ValueError(f"unknown usage kind {kind!r}")
    ms = int(ms)
    if ms <= 0:
        raise HTTPException(status_code=422, detail="Could not measure the length of this job.")
    reap_stale(db)
    lim_c, used_c, res_c = _COLS[kind]
    # One statement: the check and the increment cannot be separated by another request.
    done = db.execute(
        text(
            f"UPDATE auth_users SET {res_c} = {res_c} + :ms "
            f"WHERE id = :uid AND is_blocked = 0 AND ({lim_c} IS NULL OR {used_c} + {res_c} + :ms <= {lim_c})"
        ),
        {"ms": ms, "uid": user_id},
    )
    if done.rowcount != 1:
        db.rollback()
        user = db.query(User).filter(User.id == user_id).first()
        if user is None or user.is_blocked:
            raise HTTPException(status_code=403, detail="Your account has been suspended by an administrator.")
        remaining = max(0, getattr(user, _COLS[kind][0]) - (getattr(user, used_c) or 0) - (getattr(user, res_c) or 0))
        raise OutOfHours(kind, ms, remaining)
    user = db.query(User).filter(User.id == user_id).first()
    rid = None
    try:
        res = UsageReservation(user_id=user_id, kind=kind, ms=ms, route=route, ref=(ref or "")[:255] or None)
        db.add(res)
        db.flush()
        rid = res.id
        _ledger(db, user_id, user.email if user else None, kind, "reserve", ms, rid, route, ref)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return rid


def _close(db: Session, rid: str, outcome: str, note: Optional[str]) -> bool:
    """Close a reservation exactly once (status guard), moving its hours to used or back to free."""
    res = db.query(UsageReservation).filter(UsageReservation.id == rid).first()
    if res is None:
        return False
    flipped = db.execute(
        text("UPDATE usage_reservations SET status = :s, closed_at = :now WHERE id = :id AND status = 'reserved'"),
        {"s": outcome, "now": datetime.now(timezone.utc), "id": rid},
    )
    if flipped.rowcount != 1:
        db.rollback()
        return False  # already settled or refunded
    _, used_c, res_c = _COLS[res.kind]
    add_used = f", {used_c} = {used_c} + :ms" if outcome == "settled" else ""
    db.execute(
        text(f"UPDATE auth_users SET {res_c} = MAX(0, {res_c} - :ms){add_used} WHERE id = :uid"),
        {"ms": res.ms, "uid": res.user_id},
    )
    user = db.query(User).filter(User.id == res.user_id).first()
    _ledger(db, res.user_id, user.email if user else None, res.kind,
            "settle" if outcome == "settled" else "refund", res.ms, rid, res.route, res.ref, note)
    db.commit()
    return True


def settle(db: Session, rid: str, note: Optional[str] = None) -> bool:
    return _close(db, rid, "settled", note)


def refund(db: Session, rid: str, note: Optional[str] = None) -> bool:
    return _close(db, rid, "refunded", note)


def reap_stale(db: Session, older_than: Optional[timedelta] = STALE_AFTER) -> int:
    """Close reservations whose job can no longer be running (server restarted, task lost). They are
    charged, not refunded: the provider call may already have happened, and the rule is that nobody
    gets more hours than they were given. An admin can raise the limit to compensate."""
    q = db.query(UsageReservation.id).filter(UsageReservation.status == "reserved")
    if older_than is not None:
        q = q.filter(UsageReservation.created_at < datetime.now(timezone.utc) - older_than)
    n = 0
    for (rid,) in q.all():
        if settle(db, rid, note="orphaned: job ended without reporting back"):
            n += 1
    return n


def record_limit_change(db: Session, user: User, kind: str, old_ms: Optional[int], new_ms: Optional[int], actor_id: str) -> None:
    def h(v):
        return "unlimited" if v is None else f"{v / MS_PER_HOUR:g}h"
    _ledger(db, user.id, user.email, kind, "limit_change", 0, note=f"limit {h(old_ms)} -> {h(new_ms)}", actor_id=actor_id)


def list_ledger(db: Session, user_id: str, limit: int = 200, offset: int = 0) -> List[Dict[str, Any]]:
    rows = (db.query(UsageLedger).filter(UsageLedger.user_id == user_id)
            .order_by(UsageLedger.id.desc()).offset(offset).limit(limit).all())
    return [{
        "id": r.id, "kind": r.kind, "event": r.event, "hours": round(r.ms / MS_PER_HOUR, 4),
        "route": r.route, "ref": r.ref, "note": r.note, "reservation_id": r.reservation_id,
        "at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


# Belt and braces with the SQLite triggers: the ORM refuses to modify an existing ledger row too.
@event.listens_for(UsageLedger, "before_update")
@event.listens_for(UsageLedger, "before_delete")
def _ledger_is_append_only(mapper, connection, target):  # pragma: no cover - exercised by tests
    raise RuntimeError("usage_ledger is append-only")


def new_session() -> Session:
    return SessionLocal()
