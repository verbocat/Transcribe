"""First-admin bootstrap, run on the server:

    python -m app.manage_admin you@example.com            # prompts for a password (not echoed)
    ADMIN_PASSWORD=... python -m app.manage_admin you@example.com   # non-interactive

Admin status itself comes from the ADMIN_EMAILS environment variable (comma separated, any domain); this
command only creates the account if it does not exist yet, or resets its password. Nothing is stored in
the repository and there is no default password.
"""
import getpass
import os
import sys

from app.auth_module.admin_config import admin_emails
from app.auth_module.database import SessionLocal, init_auth_db
from app.auth_module.models import AuthSession, User
from app.auth_module.security import hash_password, validate_password, validate_verbolabs_email


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    email = argv[1].strip().lower()
    ok, err = validate_verbolabs_email(email)
    if not ok:
        print(err)
        return 2
    if email not in admin_emails():
        print(f"{email} is not in ADMIN_EMAILS. Add it to the server environment first, then run this again.")
        return 2
    password = os.getenv("ADMIN_PASSWORD") or getpass.getpass("New password: ")
    ok, errs = validate_password(password)
    if not ok:
        print("Password does not satisfy requirements: " + "; ".join(errs))
        return 2
    init_auth_db()
    db = SessionLocal()
    try:
        pwd_hash, salt = hash_password(password)
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(name=email.split("@")[0], email=email, password_hash=pwd_hash, salt=salt, is_verified=True)
            db.add(user)
            print(f"Created account {email}.")
        else:
            user.password_hash, user.salt, user.is_verified, user.is_blocked = pwd_hash, salt, True, False
            db.query(AuthSession).filter(AuthSession.user_id == user.id).update({"is_active": False})
            print(f"Reset the password of {email} (other sessions signed out).")
        db.commit()
    finally:
        db.close()
    init_auth_db()  # re-applies admin status from ADMIN_EMAILS
    print("Done. Sign in and open /admin.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
