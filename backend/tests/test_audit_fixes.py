"""Fixes from the project audit: client IP, enumeration, challenge replay, secrets, token hashing, owners, ranges."""
import hashlib
import hmac
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth_module.database import SessionLocal
from app.auth_module.models import AuthSession
from app.auth_module.security import get_otp_secret, hash_token
from tests.test_usage_limits import PASSWORD, _login, _make_user, main_app  # noqa: F401  (fixtures)


def _challenge_token(answer="5"):
    cid, ts = uuid.uuid4().hex, int(time.time())
    sig = hmac.new(get_otp_secret().encode(), f"{cid}:{answer}:{ts}".encode(), hashlib.sha256).hexdigest()
    return f"{cid}:{answer}:{ts}:{sig}"


def test_login_throttle_ignores_spoofed_forwarded_for(main_app):
    client = TestClient(main_app.app, client=("10.1.1.1", 5000))  # own peer address: failures must not lock other tests out
    _, email = _make_user(hours=None)
    for i in range(5):  # a different spoofed address each time must not dodge the lockout
        client.post("/api/auth/login", headers={"X-Forwarded-For": f"9.9.9.{i}"}, json={"email": email, "password": "wrong"})
    r = client.post("/api/auth/login", headers={"X-Forwarded-For": "8.8.8.8"}, json={"email": email, "password": PASSWORD})
    assert r.status_code in (403, 429), r.text


def test_unknown_email_looks_like_wrong_password(main_app):
    client = TestClient(main_app.app, client=("10.2.2.2", 5000))
    _, email = _make_user(hours=None)
    known = client.post("/api/auth/login", json={"email": email, "password": "nope"})
    ghost = client.post("/api/auth/login", json={"email": f"ghost_{uuid.uuid4().hex[:6]}@example.com", "password": "nope"})
    assert known.status_code == ghost.status_code == 401
    assert known.json()["detail"].split(".")[0] == ghost.json()["detail"].split(".")[0]
    fp = client.post("/api/auth/forgot-password", json={"email": f"ghost_{uuid.uuid4().hex[:6]}@example.com"})
    assert fp.status_code == 200
    rv = client.post("/api/auth/resend-verification", json={"email": f"ghost_{uuid.uuid4().hex[:6]}@example.com"})
    assert rv.status_code == 200


def test_bot_challenge_cannot_be_replayed(main_app):
    from app.auth_module.database import SessionLocal as S
    from app.auth_module.routes import verify_bot_challenge
    tok = _challenge_token()
    db = S()
    try:
        assert verify_bot_challenge(tok, db) is True
        assert verify_bot_challenge(tok, db) is False
    finally:
        db.close()


def test_otp_secret_fails_closed(monkeypatch):
    for bad in ("", "Arpit", "short"):
        monkeypatch.setenv("OTP_SECRET", bad)
        with pytest.raises(RuntimeError):
            get_otp_secret()


def test_session_token_is_stored_hashed_and_legacy_raw_still_works(main_app):
    client = TestClient(main_app.app)
    _, email = _make_user(hours=None)
    h = _login(client, email)
    raw = h["Authorization"].split()[1]
    db = SessionLocal()
    try:
        assert db.query(AuthSession).filter(AuthSession.session_token == raw).count() == 0
        row = db.query(AuthSession).filter(AuthSession.session_token == hash_token(raw)).first()
        assert row is not None
        row.session_token = raw  # a session issued before hashing existed
        db.commit()
    finally:
        db.close()
    assert client.get("/api/auth/me", headers=h).status_code == 200
    db = SessionLocal()
    try:
        assert db.query(AuthSession).filter(AuthSession.session_token == hash_token(raw)).count() == 1  # upgraded
    finally:
        db.close()


def test_projects_are_private_to_their_owner(main_app):
    from app.db import init_db
    init_db()
    client = TestClient(main_app.app)
    _, e1 = _make_user(hours=None)
    _, e2 = _make_user(hours=None)
    h1, h2 = _login(client, e1), _login(client, e2)
    pid = "t" + uuid.uuid4().hex[:7]
    body = {"result": {"audio_id": pid, "filename": "a.wav", "segments": [{"segment_id": 1, "transcript": "hi"}]}}
    assert client.post("/api/projects/save", json=body).status_code == 401
    assert client.post("/api/projects/save", headers=h1, json=body).json()["status"] == "success"
    assert pid in [p["id"] for p in client.get("/api/projects", headers=h1).json()["projects"]]
    assert pid not in [p["id"] for p in client.get("/api/projects", headers=h2).json()["projects"]]
    assert client.get(f"/api/projects/{pid}", headers=h1).status_code == 200
    assert client.get(f"/api/projects/{pid}", headers=h2).status_code == 404
    assert client.post("/api/projects/save", headers=h2, json=body).status_code == 404
    assert client.delete(f"/api/projects/{pid}", headers=h2).status_code == 404
    assert client.delete(f"/api/projects/{pid}", headers=h1).status_code == 200


def test_legacy_project_without_owner_is_admin_only(main_app, monkeypatch):
    from app.db import DBProject, get_db_session, init_db
    init_db()
    monkeypatch.setenv("ADMIN_EMAILS", "boss@example.com")
    client = TestClient(main_app.app)
    _, e1 = _make_user(hours=None)
    _, adm = _make_user(email="boss@example.com", hours=None, is_admin=True)
    pid = "l" + uuid.uuid4().hex[:7]
    s = get_db_session()
    s.add(DBProject(id=pid, filename="old.wav"))
    s.commit()
    s.close()
    assert client.get(f"/api/projects/{pid}", headers=_login(client, e1)).status_code == 404
    assert client.get(f"/api/projects/{pid}", headers=_login(client, adm)).status_code == 200


def test_timecodes_carry_instead_of_overflowing():
    from app.export_service import _clock_parts
    assert _clock_parts(59.9997) == (0, 1, 0, 0)
    assert _clock_parts(3599.9996) == (1, 0, 0, 0)
    assert _clock_parts(1.5) == (0, 0, 1, 500)


def test_range_header_parsing():
    from fastapi import HTTPException
    from app.main import _parse_byte_range
    assert _parse_byte_range("bytes=0-9", 100) == (0, 9)
    assert _parse_byte_range("bytes=90-", 100) == (90, 99)
    assert _parse_byte_range("bytes=-10", 100) == (90, 99)
    assert _parse_byte_range("bytes=50-500", 100) == (50, 99)
    for bad in ("bytes=abc-", "bytes=100-", "bytes=9-3", "items=0-1", "bytes=-"):
        with pytest.raises(HTTPException) as e:
            _parse_byte_range(bad, 100)
        assert e.value.status_code == 416


def test_upload_filename_is_reduced_to_one_safe_component():
    from app.main import _clean_upload_name
    assert _clean_upload_name("../../etc/passwd") == "passwd"
    assert _clean_upload_name("a\\b\\C.MP4") == "C.mp4"
    assert _clean_upload_name(None) == "upload"


def test_rate_limiter_drops_idle_addresses(main_app, monkeypatch):
    m = main_app
    m._client_request_history.clear()
    m._client_request_history["1.1.1.1"] = [time.time() - 120]
    monkeypatch.setattr(m, "_rate_limit_last_sweep", 0.0)
    m._check_rate_limit("2.2.2.2")
    assert "1.1.1.1" not in m._client_request_history
