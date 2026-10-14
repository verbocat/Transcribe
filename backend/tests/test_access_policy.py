"""Limits & access set by an admin: studio switches, file length, jobs per day, exports, AI assistance, end date."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth_module import usage
from app.auth_module.database import SessionLocal
from app.auth_module.models import User
from tests.test_usage_limits import ADMIN_EMAIL, _admin, _login, _make_user, admin_env, main_app  # noqa: F401  (fixtures)


def _reserve(uid, kind, seconds, route):
    db = SessionLocal()
    try:
        rid = usage.reserve(db, uid, kind, seconds * 1000, route, "f.wav")
        usage.refund(db, rid)
    finally:
        db.close()


def _put(client, admin, uid, **body):
    res = client.put(f"/api/admin/users/{uid}/access", headers=admin, json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_admin_sets_and_reads_back_every_limit(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    uid, _ = _make_user()
    until = (date.today() + timedelta(days=30)).isoformat()
    out = _put(client, admin, uid, transcribe_hours=12.5, translate_unlimited=True, max_file_minutes=90, max_jobs_per_day=5,
               access_until=until, can_subtitle_studio=False, can_export=False)
    a = out["user"]["access"]
    assert a["max_file_minutes"] == 90 and a["max_jobs_per_day"] == 5 and a["access_until"] == until
    assert a["can_subtitle_studio"] is False and a["can_export"] is False and a["can_transcribe_studio"] is True
    assert out["user"]["usage"]["transcribe"]["limit_hours"] == 12.5 and out["user"]["usage"]["translate"]["unlimited"]
    assert len(out["changes"]) == 7
    # null clears a limit; fields that are not sent stay as they were
    a = _put(client, admin, uid, max_file_minutes=None, access_until=None)["user"]["access"]
    assert a["max_file_minutes"] is None and a["access_until"] is None and a["max_jobs_per_day"] == 5
    got = client.get(f"/api/admin/users/{uid}/access", headers=admin).json()["user"]["access"]
    assert got["jobs_last_24h"] == 0 and got["can_export"] is False
    # bad values are refused
    assert client.put(f"/api/admin/users/{uid}/access", headers=admin, json={"max_jobs_per_day": 0}).status_code == 400
    assert client.put(f"/api/admin/users/{uid}/access", headers=admin, json={"access_until": "next week"}).status_code == 400


def test_studio_and_translation_switches_block_jobs(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    uid, _ = _make_user(transcribe_h=None, translate_h=None)
    _put(client, admin, uid, can_transcribe_studio=False, can_translate=False)
    for kind, route in ((usage.TRANSCRIBE, "/api/transcribe_async"), (usage.TRANSLATE, "/api/centroid/translate")):
        with pytest.raises(HTTPException) as e:
            _reserve(uid, kind, 10, route)
        assert e.value.status_code == 403
    _reserve(uid, usage.TRANSCRIBE, 10, "/api/subtitle/generate_stream")  # Subtitle Studio is still on


def test_file_length_and_jobs_per_day(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    uid, _ = _make_user(transcribe_h=None, translate_h=None)
    _put(client, admin, uid, max_file_minutes=30, max_jobs_per_day=2)
    with pytest.raises(HTTPException) as e:
        _reserve(uid, usage.TRANSCRIBE, 31 * 60, "/api/transcribe")
    assert e.value.status_code == 403 and "30 min" in e.value.detail

    db = SessionLocal()
    rids = [usage.reserve(db, uid, usage.TRANSCRIBE, 60_000, "/api/transcribe", "a.wav") for _ in range(2)]
    with pytest.raises(HTTPException) as e:
        usage.reserve(db, uid, usage.TRANSCRIBE, 60_000, "/api/transcribe", "b.wav")
    assert e.value.status_code == 429
    usage.refund(db, rids[0])  # refunded jobs do not count
    usage.refund(db, usage.reserve(db, uid, usage.TRANSCRIBE, 60_000, "/api/transcribe", "c.wav"))
    usage.refund(db, rids[1])
    db.close()


def test_exports_and_ai_assistance_switches(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    uid, email = _make_user()
    headers = _login(client, email)
    _put(client, admin, uid, can_export=False, can_ai_optimize=False)
    body = {"result": {"segments": []}, "formats": ["txt"]}
    assert client.post("/api/export/multi", headers=headers, json=body).status_code == 403
    assert client.post("/api/export/dubbing", headers=headers, json=body).status_code == 403
    assert client.post("/api/subtitle/context_autofill", headers=headers, json={"events": []}).status_code == 403
    _put(client, admin, uid, can_export=True)
    assert client.post("/api/export/multi", headers=headers, json=body).status_code != 403


def test_end_date_blocks_sign_in_and_api(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    uid, email = _make_user()
    headers = _login(client, email)
    _put(client, admin, uid, access_until=(date.today() - timedelta(days=1)).isoformat())
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 403 and "ended on" in res.json()["detail"]
    assert client.post("/api/auth/login", json={"email": email, "password": "SecurePassword123!"}).status_code == 403
    _put(client, admin, uid, access_until=(date.today() + timedelta(days=1)).isoformat())
    assert client.get("/api/auth/me", headers=headers).status_code == 200


def test_admin_account_cannot_be_locked_out(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    db = SessionLocal()
    admin_id = db.query(User).filter(User.email == ADMIN_EMAIL).first().id
    db.close()
    for body in ({"access_until": "2020-01-01"}, {"can_export": False}):
        assert client.put(f"/api/admin/users/{admin_id}/access", headers=admin, json=body).status_code == 400


def test_access_endpoints_are_admin_only(main_app, admin_env):
    client = TestClient(main_app.app)
    uid, email = _make_user()
    headers = _login(client, email)
    assert client.get(f"/api/admin/users/{uid}/access", headers=headers).status_code == 403
    assert client.put(f"/api/admin/users/{uid}/access", headers=headers, json={"can_export": True}).status_code == 403
