"""Copy the accounts database from a SQLite file into Postgres (DATABASE_URL), run on the server or locally:

    python -m app.migrate_auth_to_postgres data/transcribe_app.db              # target tables must be empty
    python -m app.migrate_auth_to_postgres data/transcribe_app.db --replace    # re-sync: empty the auth tables first
    python -m app.migrate_auth_to_postgres data/transcribe_app.db --dry-run    # read and check only, write nothing

Uses the app's own table definitions, so values are converted on the way (0/1 -> booleans, text -> timestamps).
Everything runs in one transaction: either every row lands or nothing changes. Only the auth tables are touched;
the saved-project tables in the same database are never read or written. Tables that exist in the file but not
in the models (auth_session_takeovers, left over from a removed feature) are skipped and listed.

Take the source file as a consistent copy (sqlite3 ".backup" or Connection.backup), never a raw copy of a live
file: recent writes sit in the -wal file next to it.
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Boolean, DateTime, Integer, String, func, select, text

from app.auth_module import models  # noqa: F401  (registers every table on AuthBase.metadata)
from app.auth_module.database import IS_SQLITE, AuthBase, _install_ledger_guard, engine, widen_columns

CHUNK = 500


def _value(col, v):
    """A SQLite value as the Postgres column expects it. Timestamps come in two spellings (the ORM writes
    '2026-10-23 08:12:00.000000', raw SQL with an aware datetime '2026-10-23T08:12:00+00:00'); both become
    naive UTC, as the app stores them."""
    if v is None:
        return None
    if isinstance(col.type, Boolean):
        return bool(int(v))
    if isinstance(col.type, DateTime):
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v, tz=timezone.utc).replace(tzinfo=None)
        d = datetime.fromisoformat(str(v).strip())
        return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d
    return v


def main(argv) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = {a for a in argv[1:] if a.startswith("--")}
    if len(args) != 1 or flags - {"--replace", "--dry-run"}:
        print(__doc__)
        return 2
    src_path = Path(args[0])
    if not src_path.is_file():
        print(f"Source file not found: {src_path}")
        return 2
    if IS_SQLITE:
        print("The target is SQLite. Set DATABASE_URL to the Postgres database first.")
        return 2

    src = sqlite3.connect(src_path.resolve().as_uri() + "?mode=ro", uri=True)  # read-only: the file is never changed
    src_tables = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    tables = [t for t in AuthBase.metadata.sorted_tables if t.name in src_tables]  # parents before children
    skipped = sorted(src_tables - {t.name for t in AuthBase.metadata.sorted_tables} - {"sqlite_sequence"})

    # Read everything first, and check it fits the Postgres column types before anything is written.
    data, problems = {}, []
    for table in tables:
        have = {r[1] for r in src.execute(f'PRAGMA table_info("{table.name}")')}
        cols = [c for c in table.columns if c.name in have]
        names = ", ".join(f'"{c.name}"' for c in cols)
        try:
            rows = [{c.name: _value(c, v) for c, v in zip(cols, raw)}
                    for raw in src.execute(f'SELECT {names} FROM "{table.name}"')]
        except ValueError as exc:
            problems.append(f"{table.name}: {exc}")
            continue
        for col in cols:
            if isinstance(col.type, String) and col.type.length:
                longest = max((len(r[col.name]) for r in rows if isinstance(r[col.name], str)), default=0)
                if longest > col.type.length:
                    problems.append(f"{table.name}.{col.name}: a value of {longest} characters, column allows {col.type.length}")
        data[table.name] = rows
    src.close()

    print(f"Source: {src_path} ({sum(len(r) for r in data.values())} rows in {len(tables)} tables)")
    if skipped:
        print(f"Skipped (not in the models): {', '.join(skipped)}")
    if problems:
        print("Cannot copy, values do not fit:\n  " + "\n  ".join(problems))
        return 1
    if "--dry-run" in flags:
        for table in tables:
            print(f"  {table.name}: {len(data[table.name])}")
        print("Dry run: nothing written.")
        return 0

    AuthBase.metadata.create_all(bind=engine)
    widen_columns()  # tables created by an older version of the models may have narrower columns
    with engine.begin() as conn:
        counts = {t.name: conn.execute(select(func.count()).select_from(t)).scalar() for t in tables}
        if any(counts.values()) and "--replace" not in flags:
            filled = ", ".join(f"{k}={v}" for k, v in counts.items() if v)
            print(f"The target already has rows ({filled}). Nothing changed. Use --replace to re-sync.")
            return 1
        if "--replace" in flags:
            # TRUNCATE skips the row-level append-only triggers on usage_ledger; listing every table (no CASCADE)
            # makes Postgres refuse if anything outside the auth tables referenced them.
            conn.execute(text("TRUNCATE " + ", ".join(t.name for t in tables) + " RESTART IDENTITY"))
        for table in tables:
            rows = data[table.name]
            for i in range(0, len(rows), CHUNK):
                conn.execute(table.insert(), rows[i:i + CHUNK])
            pk = list(table.primary_key.columns)
            if len(pk) == 1 and isinstance(pk[0].type, Integer) and rows:
                conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table.name}', '{pk[0].name}'), "
                    f"(SELECT MAX({pk[0].name}) FROM {table.name}))"
                ))
        print(f"{'table':28} {'source':>7} {'postgres':>9}")
        for table in tables:
            n = conn.execute(select(func.count()).select_from(table)).scalar()
            print(f"{table.name:28} {len(data[table.name]):7} {n:9}")
            if n != len(data[table.name]):
                raise RuntimeError(f"{table.name}: copied {n} of {len(data[table.name])} rows; rolled back")

    # Only the append-only trigger: admin flags are copied as they were, not re-derived from this machine's ADMIN_EMAILS.
    _install_ledger_guard()
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
