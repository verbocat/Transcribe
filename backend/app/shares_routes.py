"""Sharing subtitle projects between coordinators and linguists.

A coordinator publishes the Subtitle Studio draft (every language track) as a *shared project* and chooses which
linguists may open it. A linguist sees only the projects shared with them, edits the subtitles and saves back to the
same project; the coordinator sees who saved last and can load that version into the studio. Access is per project
and per person: removing the share closes it immediately.

Nothing here spends hours or calls an AI provider.
"""
import base64
import hashlib
import hmac
import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth_module import roles
from app.auth_module.database import get_auth_db
from app.auth_module.models import ProjectShare, SharedProject, User, UserMediaAsset
from app.auth_module.routes import get_current_user_from_token
from app.auth_module.security import get_otp_secret

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/shares", tags=["shares"])

MAX_DRAFT_BYTES = 12 * 1024 * 1024
MAX_LINGUISTS_PER_PROJECT = 50
VIDEO_LINK_TTL = 6 * 3600


def _is_staff(user: User) -> bool:
    return bool(user.is_admin) or roles.normalize(user.role) in (roles.ADMIN, roles.COORDINATOR)


def _require_coordinator(user: User) -> User:
    if not _is_staff(user):
        raise HTTPException(status_code=403, detail="Only project coordinators can share projects.")
    return user


def _load(db: Session, project_id: str) -> SharedProject:
    proj = db.query(SharedProject).filter(SharedProject.id == project_id).first()
    if proj is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return proj


def _can_open(db: Session, user: User, proj: SharedProject) -> bool:
    if proj.owner_id == user.id or user.is_admin:
        return True
    return db.query(ProjectShare).filter(ProjectShare.project_id == proj.id, ProjectShare.linguist_id == user.id).first() is not None


def _open(db: Session, user: User, project_id: str) -> SharedProject:
    proj = _load(db, project_id)
    if not _can_open(db, user, proj):
        raise HTTPException(status_code=404, detail="Project not found.")  # same answer as a missing project
    return proj


def _stamp(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _meta(db: Session, proj: SharedProject, with_people: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "id": proj.id, "title": proj.title, "filename": proj.filename, "revision": proj.revision,
        "has_video": bool(proj.video_id), "updated_at": _stamp(proj.updated_at), "created_at": _stamp(proj.created_at),
        "updated_by": proj.updated_by_name, "updated_by_owner": proj.updated_by_id == proj.owner_id,
    }
    owner = db.query(User).filter(User.id == proj.owner_id).first()
    out["owner"] = {"id": proj.owner_id, "name": owner.name if owner else "Former coordinator"}
    if with_people:
        rows = (db.query(User).join(ProjectShare, ProjectShare.linguist_id == User.id)
                .filter(ProjectShare.project_id == proj.id).order_by(User.name).all())
        out["linguists"] = [{"id": u.id, "name": u.name, "email": u.email} for u in rows]
    return out


# ── Video access ────────────────────────────────────────────────────────────────────────────────
# A <video> tag cannot send the login header, so the page asks for a short-lived signed link first.
def _sign(project_id: str, user_id: str, exp: int) -> str:
    msg = f"{project_id}.{user_id}.{exp}".encode()
    sig = hmac.new(get_otp_secret().encode(), msg, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(msg + b"." + sig).decode().rstrip("=")


def _check_link(project_id: str, token: str) -> str:
    """Returns the user id the link was issued to, or raises 403."""
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        msg, sig = raw.rsplit(b".", 1)
        pid, uid, exp = msg.decode().split(".")
        good = hmac.new(get_otp_secret().encode(), msg, hashlib.sha256).digest()
        if pid == project_id and hmac.compare_digest(sig, good) and int(exp) > time.time():
            return uid
    except Exception:
        pass
    raise HTTPException(status_code=403, detail="This video link has expired. Reopen the project.")


def _media_path(db: Session, proj: SharedProject) -> Optional[Path]:
    """The owner's own uploaded file for this project, nothing else on disk."""
    if not proj.video_id:
        return None
    asset = (db.query(UserMediaAsset)
             .filter(UserMediaAsset.user_id == proj.owner_id, UserMediaAsset.video_id == proj.video_id,
                     UserMediaAsset.is_deleted == False)  # noqa: E712
             .order_by(UserMediaAsset.created_at.desc()).first())
    if asset is None or not asset.storage_path:
        return None
    path = Path(asset.storage_path)
    return path if path.is_file() else None


# ── Requests ────────────────────────────────────────────────────────────────────────────────────
class PublishRequest(BaseModel):
    id: Optional[str] = None  # omit to create a new shared project, send to update your own
    title: str
    filename: Optional[str] = None
    video_id: Optional[str] = None
    draft: Dict[str, Any]
    linguist_ids: Optional[List[str]] = None  # None = leave the people as they are


class SaveRequest(BaseModel):
    draft: Dict[str, Any]
    base_revision: int


class PeopleRequest(BaseModel):
    linguist_ids: List[str]


def _draft_json(draft: Dict[str, Any]) -> str:
    events = draft.get("events")
    if not isinstance(events, list) and not isinstance(draft.get("tracks"), dict):
        raise HTTPException(status_code=400, detail="That doesn't look like a subtitle draft.")
    blob = json.dumps(draft, ensure_ascii=False)
    if len(blob.encode("utf-8")) > MAX_DRAFT_BYTES:
        raise HTTPException(status_code=413, detail="This project is too large to share.")
    return blob


def _set_people(db: Session, proj: SharedProject, ids: List[str], by: User) -> None:
    wanted = list(dict.fromkeys(ids))[:MAX_LINGUISTS_PER_PROJECT]
    valid = {u.id for u in db.query(User).filter(User.id.in_(wanted)).all() if roles.is_linguist(u) and not u.is_blocked} if wanted else set()
    if set(wanted) - valid:
        raise HTTPException(status_code=400, detail="Projects can only be shared with linguist accounts.")
    have = {s.linguist_id: s for s in db.query(ProjectShare).filter(ProjectShare.project_id == proj.id).all()}
    for uid, row in have.items():
        if uid not in valid:
            db.delete(row)
    for uid in valid - set(have):
        db.add(ProjectShare(project_id=proj.id, linguist_id=uid, shared_by_id=by.id))


# ── Coordinator ─────────────────────────────────────────────────────────────────────────────────
@router.get("/linguists")
def list_linguists(user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    _require_coordinator(user)
    rows = db.query(User).filter(User.role == roles.LINGUIST, User.is_blocked == False).order_by(User.name).all()  # noqa: E712
    return {"linguists": [{"id": u.id, "name": u.name, "email": u.email} for u in rows if roles.is_linguist(u)]}


@router.post("/projects")
def publish_project(payload: PublishRequest, user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    """Creates the shared project, or updates one you own with the draft that is on your screen."""
    _require_coordinator(user)
    title = (payload.title or "").strip()[:255]
    if not title:
        raise HTTPException(status_code=400, detail="Give the project a name.")
    blob = _draft_json(payload.draft)
    video_id = (payload.video_id or "").strip()[:128] or None
    if video_id and not db.query(UserMediaAsset).filter(UserMediaAsset.user_id == user.id, UserMediaAsset.video_id == video_id).first():
        video_id = None  # only your own uploads can be streamed to others

    if payload.id:
        proj = _load(db, payload.id)
        if proj.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Project not found.")
        proj.title, proj.filename = title, (payload.filename or proj.filename)
        if video_id:
            proj.video_id = video_id
        proj.draft = blob
        proj.revision = (proj.revision or 1) + 1
    else:
        proj = SharedProject(owner_id=user.id, title=title, filename=payload.filename, video_id=video_id, draft=blob, revision=1)
        db.add(proj)
        db.flush()
    proj.updated_by_id, proj.updated_by_name = user.id, user.name
    if payload.linguist_ids is not None:
        _set_people(db, proj, payload.linguist_ids, user)
    db.commit()
    db.refresh(proj)
    return {"success": True, "project": _meta(db, proj, True)}


@router.get("/projects/mine")
def my_shared_projects(user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    _require_coordinator(user)
    rows = db.query(SharedProject).filter(SharedProject.owner_id == user.id).order_by(SharedProject.updated_at.desc()).all()
    return {"projects": [_meta(db, p, True) for p in rows]}


@router.put("/projects/{project_id}/linguists")
def set_linguists(project_id: str, payload: PeopleRequest, user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    """Replaces the list of linguists who can open this project. Anyone left out loses access immediately."""
    _require_coordinator(user)
    proj = _load(db, project_id)
    if proj.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Project not found.")
    _set_people(db, proj, payload.linguist_ids, user)
    db.commit()
    return {"success": True, "project": _meta(db, proj, True)}


@router.delete("/projects/{project_id}")
def stop_sharing(project_id: str, user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    _require_coordinator(user)
    proj = _load(db, project_id)
    if proj.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Project not found.")
    db.query(ProjectShare).filter(ProjectShare.project_id == proj.id).delete()
    db.delete(proj)
    db.commit()
    return {"success": True}


# ── Linguist (and the owner, to read and save) ───────────────────────────────────────────────────
@router.get("/with-me")
def shared_with_me(user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    rows = (db.query(SharedProject).join(ProjectShare, ProjectShare.project_id == SharedProject.id)
            .filter(ProjectShare.linguist_id == user.id).order_by(SharedProject.updated_at.desc()).all())
    return {"projects": [_meta(db, p, False) for p in rows]}


@router.get("/projects/{project_id}")
def open_project(project_id: str, user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    proj = _open(db, user, project_id)
    try:
        draft = json.loads(proj.draft)
    except Exception:
        draft = {}
    return {"success": True, "project": _meta(db, proj, proj.owner_id == user.id or bool(user.is_admin)), "draft": draft,
            "is_owner": proj.owner_id == user.id}


@router.put("/projects/{project_id}/draft")
def save_draft(project_id: str, payload: SaveRequest, user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    """Saves edits. `base_revision` is the revision you opened; if someone saved since, nothing is overwritten (409)."""
    proj = _open(db, user, project_id)
    blob = _draft_json(payload.draft)
    # One conditional UPDATE: the revision check and the write cannot be split by another save.
    done = db.query(SharedProject).filter(SharedProject.id == proj.id, SharedProject.revision == payload.base_revision).update(
        {"draft": blob, "revision": payload.base_revision + 1, "updated_by_id": user.id, "updated_by_name": user.name},
        synchronize_session=False)
    if done != 1:
        db.rollback()
        cur = _load(db, project_id)
        raise HTTPException(status_code=409, detail=f"{cur.updated_by_name or 'Someone'} saved a newer version. Reload to get it before saving.")
    db.commit()
    db.refresh(proj)
    return {"success": True, "revision": proj.revision, "updated_at": _stamp(proj.updated_at)}


@router.get("/projects/{project_id}/video-link")
def video_link(project_id: str, user: User = Depends(get_current_user_from_token), db: Session = Depends(get_auth_db)):
    proj = _open(db, user, project_id)
    if _media_path(db, proj) is None:
        return {"available": False}
    token = _sign(proj.id, user.id, int(time.time()) + VIDEO_LINK_TTL)
    return {"available": True, "url": f"/api/shares/projects/{proj.id}/video?t={token}"}


@router.get("/projects/{project_id}/video")
def stream_video(project_id: str, request: Request, t: str = Query(...), db: Session = Depends(get_auth_db)):
    uid = _check_link(project_id, t)
    proj = _load(db, project_id)
    user = db.query(User).filter(User.id == uid).first()
    if user is None or user.is_blocked or not _can_open(db, user, proj):
        raise HTTPException(status_code=403, detail="You no longer have access to this project.")  # revoked after the link was made
    path = _media_path(db, proj)
    if path is None:
        raise HTTPException(status_code=404, detail="The video for this project is no longer on the server.")
    import mimetypes
    media_type = mimetypes.guess_type(str(path))[0] or "video/mp4"
    size = path.stat().st_size
    rng = request.headers.get("Range")
    if not rng:
        return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})
    try:
        a, _, b = rng.replace("bytes=", "").partition("-")
        start = int(a) if a else 0
        end = int(b) if b else size - 1
    except ValueError:
        raise HTTPException(status_code=416, detail="Bad range.")
    start = max(0, min(start, size - 1))
    end = max(start, min(end, size - 1))
    length = end - start + 1

    def chunks():
        with open(path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                data = f.read(min(left, 65536))
                if not data:
                    break
                left -= len(data)
                yield data

    return StreamingResponse(chunks(), status_code=206, media_type=media_type, headers={
        "Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes", "Content-Length": str(length)})
