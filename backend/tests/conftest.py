"""Shared pytest setup for the backend tests."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Point the auth database at a throwaway SQLite file so test runs never touch the real accounts
# database (Postgres, DATABASE_URL) and always start from an empty database.
os.environ["AUTH_DATABASE_URL"] = "sqlite:///" + (Path(tempfile.mkdtemp()) / "test_auth.db").as_posix()

os.environ.setdefault("OTP_SECRET", "test-secret-for-pytest-0123456789")
