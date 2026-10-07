"""Shared pytest setup for the backend tests."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Point the auth database at a throwaway SQLite file so test runs never touch
# backend/data/transcribe_app.db and always start from an empty database.
os.environ.setdefault("SERVER_DB_PATH", str(Path(tempfile.mkdtemp()) / "test_auth.db"))
