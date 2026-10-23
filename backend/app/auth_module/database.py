import os
import logging
from sqlalchemy import bindparam, create_engine, event, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app import config  # loads backend/.env, so DATABASE_URL is set before the engine is built

logger = logging.getLogger(__name__)

AuthBase = declarative_base()


def get_database_url() -> str:
    """The accounts database: Postgres (Neon), the same DATABASE_URL as saved projects.
    AUTH_DATABASE_URL overrides it (the test suite points it at a throwaway SQLite file).
    There is no fallback to a local file: without a URL the server refuses to start, so a
    missing setting can never silently start an empty accounts database."""
    url = (os.getenv("AUTH_DATABASE_URL") or os.getenv("DATABASE_URL") or config.DATABASE_URL or "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Accounts, sessions and usage live in Postgres (Neon): "
            "set DATABASE_URL in backend/.env."
        )
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url


DATABASE_URL = get_database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()
else:
    # The only engine in the app: accounts and saved projects (app/db.py) share this pool. Token lookups close
    # their session right away (routes.get_optional_user_from_token), so a request does not hold a connection
    # for its whole life. pre_ping/recycle survive Neon closing idle connections.
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_size=20,
        max_overflow=30,
        pool_timeout=15,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_auth_db():
    """Create the auth tables if missing, add columns older databases lack, sync admin status and
    install the append-only guard on usage_ledger. Idempotent; runs on every start."""
    from . import models  # noqa: F401  (registers every table on AuthBase.metadata)

    AuthBase.metadata.create_all(bind=engine)
    _migrate_columns()
    widen_columns()
    _sync_admins()
    _install_ledger_guard()
    logger.info(f"Auth DB ready ({engine.dialect.name}: {engine.url.render_as_string(hide_password=True)})")


# Columns added after the first release, with the DDL that creates them on a database that predates them.
# Written so the same statement runs on Postgres and on SQLite (tests).
_ADDED_USER_COLUMNS = {
    "role": "VARCHAR(32) DEFAULT 'coordinator'",
    "is_admin": "BOOLEAN DEFAULT FALSE",
    "total_spend_usd": "DOUBLE PRECISION DEFAULT 0.0",
    "monthly_budget_usd": "DOUBLE PRECISION DEFAULT 50.0",
    "max_videos_quota": "INTEGER DEFAULT -1",
    "can_export": "BOOLEAN DEFAULT TRUE",
    "can_ai_optimize": "BOOLEAN DEFAULT TRUE",
    "can_audio_peaks": "BOOLEAN DEFAULT TRUE",
    "is_blocked": "BOOLEAN DEFAULT FALSE",
    "transcribe_limit_ms": "BIGINT",
    "translate_limit_ms": "BIGINT",
    "transcribe_used_ms": "BIGINT NOT NULL DEFAULT 0",
    "translate_used_ms": "BIGINT NOT NULL DEFAULT 0",
    "transcribe_reserved_ms": "BIGINT NOT NULL DEFAULT 0",
    "translate_reserved_ms": "BIGINT NOT NULL DEFAULT 0",
    # access and job limits (policy.py); existing accounts keep full access and no limits
    "can_transcribe_studio": "BOOLEAN NOT NULL DEFAULT TRUE",
    "can_subtitle_studio": "BOOLEAN NOT NULL DEFAULT TRUE",
    "can_translate": "BOOLEAN NOT NULL DEFAULT TRUE",
    "max_file_minutes": "INTEGER",
    "max_jobs_per_day": "INTEGER",
    "access_expires_at": "TIMESTAMP",
}


def _migrate_columns():
    """Additive and idempotent. Existing accounts get NULL limits (unlimited) and zero usage, so nothing
    changes for them until an admin sets a limit."""
    with engine.begin() as conn:
        existing = {c["name"] for c in inspect(conn).get_columns("auth_users")}
        for name, ddl in _ADDED_USER_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE auth_users ADD COLUMN {name} {ddl}"))
        if "hours_limit_ms" not in existing:
            # One shared pool replaces the two per-kind limits. Runs exactly once, when the column is created:
            # both unlimited -> unlimited; otherwise old transcription limit + old translation limit (a kind that
            # was unlimited contributes only what it has already used, so nobody gains hours from the change).
            conn.execute(text("ALTER TABLE auth_users ADD COLUMN hours_limit_ms BIGINT"))
            conn.execute(text(
                "UPDATE auth_users SET hours_limit_ms = "
                "COALESCE(transcribe_limit_ms, transcribe_used_ms + transcribe_reserved_ms) + "
                "COALESCE(translate_limit_ms, translate_used_ms + translate_reserved_ms) "
                "WHERE transcribe_limit_ms IS NOT NULL OR translate_limit_ms IS NOT NULL"
            ))
        # Roles: admin | coordinator | linguist. Every account that was "editor" (or anything else) is a coordinator.
        conn.execute(text("UPDATE auth_users SET role = 'coordinator' WHERE role IS NULL OR role NOT IN ('admin', 'coordinator', 'linguist')"))


def widen_columns():
    """create_all never changes an existing table, so a column the models made wider (VARCHAR length, INTEGER ->
    BIGINT) stays narrow in a database created earlier. Postgres enforces both, so widen them here. Widening
    never loses data; a column is never narrowed. SQLite ignores declared sizes, so nothing to do there."""
    if IS_SQLITE:
        return
    from sqlalchemy import BigInteger, String
    with engine.begin() as conn:
        insp = inspect(conn)
        names = set(insp.get_table_names())
        for table in AuthBase.metadata.sorted_tables:
            if table.name not in names:
                continue
            have = {c["name"]: c["type"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                cur = have.get(col.name)
                if cur is None:
                    continue
                if isinstance(col.type, String) and col.type.length and getattr(cur, "length", None) and cur.length < col.type.length:
                    conn.execute(text(f'ALTER TABLE {table.name} ALTER COLUMN "{col.name}" TYPE VARCHAR({col.type.length})'))
                elif isinstance(col.type, BigInteger) and cur.__class__.__name__.upper() == "INTEGER":
                    conn.execute(text(f'ALTER TABLE {table.name} ALTER COLUMN "{col.name}" TYPE BIGINT'))


def _sync_admins():
    """Admin status follows the configured admin e-mails only (see admin_config.py)."""
    from .admin_config import admin_emails
    emails = sorted(admin_emails())
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE auth_users SET is_admin = :no, role = 'coordinator' WHERE is_admin = :yes AND lower(email) NOT IN :emails")
            .bindparams(bindparam("emails", expanding=True)),
            {"no": False, "yes": True, "emails": emails},
        )
        conn.execute(
            text("UPDATE auth_users SET is_admin = :yes, role = 'admin' WHERE lower(email) IN :emails")
            .bindparams(bindparam("emails", expanding=True)),
            {"yes": True, "emails": emails},
        )


def _install_ledger_guard():
    """usage_ledger is append-only: the database itself refuses UPDATE and DELETE (usage.py adds an ORM hook too)."""
    with engine.begin() as conn:
        if IS_SQLITE:
            for op in ("UPDATE", "DELETE"):
                conn.execute(text(
                    f"CREATE TRIGGER IF NOT EXISTS usage_ledger_no_{op.lower()} BEFORE {op} ON usage_ledger "
                    f"BEGIN SELECT RAISE(ABORT, 'usage_ledger is append-only'); END"
                ))
            return
        conn.execute(text(
            "CREATE OR REPLACE FUNCTION usage_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS "
            "$fn$ BEGIN RAISE EXCEPTION 'usage_ledger is append-only'; END $fn$"
        ))
        for op in ("UPDATE", "DELETE"):
            conn.execute(text(
                f"CREATE OR REPLACE TRIGGER usage_ledger_no_{op.lower()} BEFORE {op} ON usage_ledger "
                f"FOR EACH ROW EXECUTE FUNCTION usage_ledger_append_only()"
            ))


def get_auth_db():
    """FastAPI dependency for obtaining a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
