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
    Prioritizes:
    1. Explicit SERVER_DB_PATH env var if provided.
    2. Project local backend/data/transcribe_app.db (preferred for self-contained server deployment).
    """
    env_path = os.getenv("SERVER_DB_PATH")
    if env_path:
        p = Path(env_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    backend_dir = Path(__file__).resolve().parent.parent.parent
    local_db_dir = backend_dir / "data"
    local_db_dir.mkdir(parents=True, exist_ok=True)
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
    AuthBase.metadata.create_all(bind=engine)
    # Check and migrate columns if necessary
    with engine.connect() as conn:
        try:
            from sqlalchemy import text
            res = conn.execute(text("PRAGMA table_info(auth_sessions)")).fetchall()
            existing_cols = {row[1] for row in res}
            if "takeover_lockout_until" not in existing_cols:
                conn.execute(text("ALTER TABLE auth_sessions ADD COLUMN takeover_lockout_until DATETIME"))
                conn.commit()
                logger.info("Migrated auth_sessions table: added takeover_lockout_until column.")
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
