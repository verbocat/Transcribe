"""Who counts as an administrator. Admin status is derived from these sources only (never from a column a user
could edit):
  * the built-in super admin (below),
  * the ADMIN_EMAILS environment variable on the server (comma separated, any domain),
  * accounts an administrator made admin in the admin panel (the auth_admin_grants table).
The first two cannot be removed from the panel; granted ones can, by any administrator other than themselves."""
import logging
import os
import threading
import time
from typing import Optional, Set

logger = logging.getLogger(__name__)

# Built-in super admin; always an admin regardless of ADMIN_EMAILS.
BUILTIN_ADMIN_EMAILS = frozenset({"divyanshusinghchouhan@verbolabs.com"})

_GRANT_TTL = 15.0  # seconds; changes made in this process refresh at once, other processes within this time
_granted: Set[str] = set()
_granted_at = 0.0
_lock = threading.Lock()


def config_admin_emails() -> Set[str]:
    """Built-in admins plus anything in the ADMIN_EMAILS env var."""
    extra = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
    return set(BUILTIN_ADMIN_EMAILS) | extra


def granted_admin_emails(force: bool = False) -> Set[str]:
    """Accounts made admin in the admin panel (cached briefly; the previous list is kept if the database is busy)."""
    global _granted, _granted_at
    with _lock:
        if not force and time.monotonic() - _granted_at < _GRANT_TTL:
            return set(_granted)
        try:
            from .database import SessionLocal
            from .models import AdminGrant
            db = SessionLocal()
            try:
                _granted = {g.email.lower() for g in db.query(AdminGrant).all()}
            finally:
                db.close()
            _granted_at = time.monotonic()
        except Exception as exc:  # the table may not exist yet during the very first start
            logger.debug("admin grants not read: %s", exc)
        return set(_granted)


def admin_emails() -> Set[str]:
    return config_admin_emails() | granted_admin_emails()


def admin_source(email: Optional[str]) -> Optional[str]:
    """'builtin', 'server' (ADMIN_EMAILS), 'granted' (admin panel), or None for a non-admin."""
    e = (email or "").strip().lower()
    if not e:
        return None
    if e in BUILTIN_ADMIN_EMAILS:
        return "builtin"
    if e in config_admin_emails():
        return "server"
    if e in granted_admin_emails():
        return "granted"
    return None


def is_admin_email(email: Optional[str]) -> bool:
    return admin_source(email) is not None
