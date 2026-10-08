import os
import logging
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger(__name__)

AuthBase = declarative_base()

def get_database_path() -> Path:
    """
    Determines the SQLite database file path.
    Prioritizes project local backend/data/transcribe_app.db or valid SERVER_DB_PATH.
    """
    backend_dir = Path(__file__).resolve().parent.parent.parent
    local_db_dir = backend_dir / "data"
    local_db_dir.mkdir(parents=True, exist_ok=True)

    env_path = os.getenv("SERVER_DB_PATH")
    if env_path:
        try:
            p = Path(env_path)
            if not p.drive or Path(p.drive + "\\").exists():
                p.parent.mkdir(parents=True, exist_ok=True)
                return p
        except Exception:
            pass

    return local_db_dir / "transcribe_app.db"

db_file_path = get_database_path()
SQLITE_URL = f"sqlite:///{db_file_path.as_posix()}"

engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_auth_db():
    """Create all auth-related tables in local SQLite database and ensure schema migrations."""
    # Ensure models are imported so metadata includes all tables
    from . import models  # noqa: F401

    AuthBase.metadata.create_all(bind=engine)
    # Check and migrate columns if necessary
    with engine.connect() as conn:
        try:
            from sqlalchemy import text
            res_users = conn.execute(text("PRAGMA table_info(auth_users)")).fetchall()
            existing_user_cols = {row[1] for row in res_users}
            if "role" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN role VARCHAR(32) DEFAULT 'editor'"))
            if "is_admin" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN is_admin BOOLEAN DEFAULT 0"))
            if "total_spend_usd" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN total_spend_usd FLOAT DEFAULT 0.0"))
            if "monthly_budget_usd" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN monthly_budget_usd FLOAT DEFAULT 50.0"))
            if "max_videos_quota" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN max_videos_quota INTEGER DEFAULT -1"))
            if "can_export" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN can_export BOOLEAN DEFAULT 1"))
            if "can_ai_optimize" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN can_ai_optimize BOOLEAN DEFAULT 1"))
            if "can_audio_peaks" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN can_audio_peaks BOOLEAN DEFAULT 1"))
            if "is_blocked" not in existing_user_cols:
                conn.execute(text("ALTER TABLE auth_users ADD COLUMN is_blocked BOOLEAN DEFAULT 0"))

            # Lock admin role strictly to arpit.purohit@verbolabs.com / arpit.purohit@verbolab.com
            conn.execute(text("""
                UPDATE auth_users 
                SET is_admin = 0, role = 'editor' 
                WHERE lower(email) NOT IN ('arpit.purohit@verbolabs.com', 'arpit.purohit@verbolab.com') AND is_admin = 1
            """))
            conn.execute(text("""
                UPDATE auth_users 
                SET is_admin = 1, role = 'admin' 
                WHERE lower(email) IN ('arpit.purohit@verbolabs.com', 'arpit.purohit@verbolab.com')
            """))
            conn.commit()
            logger.info("Migrated auth_users table: verified schema columns and enforced super-admin exclusivity.")
        except Exception as e:
            logger.debug(f"Table inspection/migration note: {e}")

    logger.info(f"Auth SQLite DB initialized at: {db_file_path}")

def get_auth_db():
    """FastAPI dependency for obtaining a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
