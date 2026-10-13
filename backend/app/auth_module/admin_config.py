"""Who counts as an administrator. Admin status is derived from this list only (never from a column
a user could edit), so there is no API path that promotes an account."""
import os
from typing import Optional, Set

# Long-standing super admin; kept so existing deployments do not lose their admin on upgrade.
BUILTIN_ADMIN_EMAILS = frozenset({"arpit.purohit@verbolabs.com", "arpit.purohit@verbolab.com"})


def admin_emails() -> Set[str]:
    """Built-in admins plus anything in the ADMIN_EMAILS env var (comma separated, any domain)."""
    extra = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
    return set(BUILTIN_ADMIN_EMAILS) | extra


def is_admin_email(email: Optional[str]) -> bool:
    return bool(email) and email.strip().lower() in admin_emails()
