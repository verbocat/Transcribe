"""Account roles, enforced on the server.

* admin       - the configured administrators (admin_config.py); everything.
* coordinator - transcribes, translates, generates subtitles (spends the hours pool) and shares projects with linguists.
* linguist    - only reviews and edits subtitles that a coordinator shared with them. Cannot upload media, run any
                transcription / generation / translation / AI action, and never spends hours.

Every request passes `role_gate`: a linguist can reach only the paths in LINGUIST_PATHS (plus the shared-project
routes, which check the individual share). Metered routes also refuse linguists in policy.check_job, so a
route that is added later and forgotten here still cannot spend hours for a linguist.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Request

from .models import User

ADMIN, COORDINATOR, LINGUIST = "admin", "coordinator", "linguist"
ASSIGNABLE = (COORDINATOR, LINGUIST)

# Everything a linguist may call. Local checks only: nothing here calls an AI provider or spends hours.
LINGUIST_PATHS = ("/api/auth/", "/api/shares/", "/api/subtitle/lint", "/api/subtitle/qc", "/api/health", "/health")
LINGUIST_EXACT = ("/", "/api/shares")


def normalize(role: Optional[str]) -> str:
    r = (role or "").strip().lower()
    return r if r in (ADMIN, LINGUIST) else COORDINATOR  # old "editor" / "viewer" / "pending" accounts are coordinators


def is_linguist(user: Optional[User]) -> bool:
    return user is not None and not getattr(user, "is_admin", False) and normalize(user.role) == LINGUIST


def linguist_may_call(path: str) -> bool:
    return path in LINGUIST_EXACT or path.startswith(LINGUIST_PATHS)


def forbid_linguist(user: Optional[User]) -> None:
    if is_linguist(user):
        raise HTTPException(status_code=403, detail="Linguist accounts can only review and edit subtitles shared with them. Ask a project coordinator.")


def make_role_gate(get_optional_user):
    """Dependency for the whole app (FastAPI(dependencies=[Depends(gate)])): blocks linguists from every other route."""
    def role_gate(request: Request, user: Optional[User] = Depends(get_optional_user)) -> None:
        if request.method != "OPTIONS" and is_linguist(user) and not linguist_may_call(request.url.path):
            forbid_linguist(user)
    return role_gate
