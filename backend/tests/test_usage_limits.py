"""Hour budgets: limits are enforced on the server, atomically, and every route that spends hours is covered."""
import asyncio
import threading
import uuid
import wave
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth_module import usage
from app.auth_module.database import SessionLocal, engine, init_auth_db
from app.auth_module.models import User, UsageLedger
from app.auth_module.security import hash_password

PASSWORD = "SecurePassword123!"
ADMIN_EMAIL = "boss@example.org"


@pytest.fixture(scope="module")
def main_app():
    import app.main as m
    init_auth_db()
    return m


@pytest.fixture()
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN_EMAIL)


def _make_user(email=None, hours=1.0, **kw):
    email = email or f"u_{uuid.uuid4().hex[:8]}@example.com"
    h, s = hash_password(PASSWORD)
    db = SessionLocal()
    u = User(name="Test User", email=email, password_hash=h, salt=s, is_verified=True,
             hours_limit_ms=None if hours is None else int(hours * 3_600_000), **kw)
    db.add(u)
    db.commit()
    uid = u.id
    db.close()
    return uid, email


def _login(client, email):
    res = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def _state(uid):
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == uid).first()
        return {k: getattr(u, k) for k in (
            "transcribe_used_ms", "transcribe_reserved_ms", "translate_used_ms", "translate_reserved_ms")}
    finally:
        db.close()


def _wav(tmp_path, seconds=10):
    p = tmp_path / f"{uuid.uuid4().hex[:6]}.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 8000 * seconds)
    return p


def _cues(n, each=2.0):
    return [{"start_time": i * each, "end_time": (i + 1) * each, "text": f"line {i}"} for i in range(n)]


# ---- limits are enforced -----------------------------------------------------------------------------

def test_transcribe_over_limit_is_rejected_before_any_work(main_app, tmp_path, monkeypatch):
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=5 / 3600)  # 5 seconds of budget
    headers = _login(client, email)
    called = []
    monkeypatch.setattr(main_app, "process_audio_file", lambda **k: called.append(1))
    with open(_wav(tmp_path, 10), "rb") as f:  # a 10 s file against a 5 s budget
        res = client.post("/api/transcribe", files={"file": ("a.wav", f, "audio/wav")}, headers=headers)
    assert res.status_code == 402
    assert res.json()["code"] == "out_of_hours" and "Out of hours" in res.json()["detail"]
    assert not called
    assert _state(uid)["transcribe_reserved_ms"] == 0 and _state(uid)["transcribe_used_ms"] == 0


def test_client_supplied_duration_is_ignored(main_app, tmp_path):
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=5 / 3600)
    headers = _login(client, email)
    with open(_wav(tmp_path, 10), "rb") as f:
        res = client.post("/api/transcribe_async", headers=headers,
                          files={"file": ("a.wav", f, "audio/wav")}, data={"duration": "1", "duration_seconds": "1"})
    assert res.status_code == 402


def test_translation_over_limit_rejected_and_falsified_timings_do_not_help(main_app, monkeypatch):
    from app import centroid_client
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=10 / 3600)  # 10 s of translation
    headers = _login(client, email)
    posted = []

    async def fake_post(path, body):
        posted.append(path)
        return {"results": {}}
    monkeypatch.setattr(centroid_client, "post", fake_post)
    body = {"events": _cues(10), "source_lang": "hi", "target_langs": ["en"]}  # 20 s of subtitles
    assert client.post("/api/centroid/translate", json=body, headers=headers).status_code == 402
    # zero-length cues but lots of text: still billed for the text
    lie = {"events": [{"start_time": 0, "end_time": 0, "text": "x" * 2000}], "source_lang": "hi", "target_langs": ["en"]}
    assert client.post("/api/centroid/translate", json=lie, headers=headers).status_code == 402
    assert posted == []
    # two languages cost twice
    ok_one = {"events": _cues(3), "source_lang": "hi", "target_langs": ["en"]}   # 6 s
    ok_two = {"events": _cues(3), "source_lang": "hi", "target_langs": ["en", "fr"]}  # 12 s
    assert client.post("/api/centroid/translate", json=ok_two, headers=headers).status_code == 402
    assert client.post("/api/centroid/translate", json=ok_one, headers=headers).status_code == 200


def test_all_metered_routes_require_login(main_app):
    client = TestClient(main_app.app)
    for path in ("/api/transcribe", "/api/transcribe_async", "/api/subtitle/generate", "/api/subtitle/generate_stream",
                 "/api/subtitle/acoustic_sync", "/api/centroid/translate", "/api/centroid/qc", "/api/centroid/analyze",
                 "/api/subtitle/gemini_fix", "/api/subtitle/context_polish", "/api/subtitle/context_autofill",
                 "/api/speakers/refine"):
        assert client.post(path, json={}).status_code == 401, path


def test_blocked_user_cannot_reserve():
    uid, _ = _make_user()
    db = SessionLocal()
    db.query(User).filter(User.id == uid).update({"is_blocked": True})
    db.commit()
    with pytest.raises(HTTPException) as e:
        usage.reserve(db, uid, usage.TRANSCRIBE, 1000, "t")
    assert e.value.status_code == 403
    db.close()


# ---- concurrency -------------------------------------------------------------------------------------

def test_concurrent_requests_cannot_overshoot():
    uid, _ = _make_user(hours=10)  # room for exactly 10 one-hour jobs
    results, barrier = [], threading.Barrier(40)

    def worker():
        db = SessionLocal()
        try:
            barrier.wait()
            usage.reserve(db, uid, usage.TRANSCRIBE, 3_600_000, "race")
            results.append("ok")
        except HTTPException as e:
            results.append(e.status_code)
        finally:
            db.close()

    threads = [threading.Thread(target=worker) for _ in range(40)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count("ok") == 10
    assert results.count(402) == 30
    st = _state(uid)
    assert st["transcribe_reserved_ms"] == 10 * 3_600_000 and st["transcribe_used_ms"] == 0


def test_reserved_hours_count_against_the_limit_until_refunded():
    uid, _ = _make_user(hours=1)
    db = SessionLocal()
    rid = usage.reserve(db, uid, usage.TRANSCRIBE, 3_600_000, "a")
    with pytest.raises(usage.OutOfHours):
        usage.reserve(db, uid, usage.TRANSCRIBE, 1000, "b")
    assert usage.refund(db, rid)
    assert not usage.refund(db, rid) and not usage.settle(db, rid)  # closes once only
    usage.reserve(db, uid, usage.TRANSCRIBE, 3_600_000, "c")
    db.close()


# ---- settle / refund ---------------------------------------------------------------------------------

def test_success_is_charged_and_failure_is_refunded(main_app, monkeypatch):
    from app import centroid_client
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=1)
    headers = _login(client, email)
    body = {"events": _cues(5), "source_lang": "hi", "target_langs": ["en"]}  # 10 s

    async def ok(path, b):
        return {"results": {}}
    monkeypatch.setattr(centroid_client, "post", ok)
    assert client.post("/api/centroid/translate", json=body, headers=headers).status_code == 200
    assert _state(uid)["translate_used_ms"] == 10_000 and _state(uid)["translate_reserved_ms"] == 0

    async def boom(path, b):
        raise HTTPException(status_code=502, detail="upstream down")
    monkeypatch.setattr(centroid_client, "post", boom)
    assert client.post("/api/centroid/translate", json=body, headers=headers).status_code == 502
    st = _state(uid)
    assert st["translate_used_ms"] == 10_000 and st["translate_reserved_ms"] == 0  # refunded


def test_failed_transcription_is_refunded(main_app, tmp_path, monkeypatch):
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=1)
    headers = _login(client, email)

    async def fail(**kw):
        kw["progress_cb"]("uploading", 1, "")
        raise RuntimeError("speech engine unavailable")
    monkeypatch.setattr(main_app, "process_audio_file", fail)
    with open(_wav(tmp_path, 10), "rb") as f:
        res = client.post("/api/transcribe", files={"file": ("a.wav", f, "audio/wav")}, headers=headers)
    assert res.status_code == 500
    st = _state(uid)
    assert st["transcribe_used_ms"] == 0 and st["transcribe_reserved_ms"] == 0


def test_cancel_after_the_paid_call_started_is_still_charged(tmp_path):
    from app import metering
    uid, _ = _make_user(hours=1)
    ref = {"id": uid, "email": "x"}
    m = metering.Metered(ref, usage.TRANSCRIBE, 5000, "t").reserve()
    m.note_stage("transcribing")
    m.on_error(asyncio.CancelledError())
    assert _state(uid)["transcribe_used_ms"] == 5000
    m2 = metering.Metered(ref, usage.TRANSCRIBE, 5000, "t").reserve()
    m2.on_error(asyncio.CancelledError())  # cancelled before any provider call
    assert _state(uid)["transcribe_used_ms"] == 5000 and _state(uid)["transcribe_reserved_ms"] == 0


def test_stream_settles_on_complete_and_refunds_on_early_error(main_app, tmp_path, monkeypatch):
    import json
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=1)
    headers = _login(client, email)
    wav = _wav(tmp_path, 10)
    monkeypatch.setattr(main_app, "resolve_active_session_video", lambda vid: str(wav))

    def gen(events):
        async def g(**kw):
            for e in events:
                yield f"data: {json.dumps(e)}\n\n"
        return g
    monkeypatch.setattr(main_app, "generate_subtitles_stream", gen([{"type": "error", "message": "no audio"}]))
    client.post("/api/subtitle/generate_stream", json={"video_id": "v"}, headers=headers)
    assert _state(uid)["transcribe_used_ms"] == 0 and _state(uid)["transcribe_reserved_ms"] == 0

    monkeypatch.setattr(main_app, "generate_subtitles_stream", gen([
        {"type": "progress", "stage_key": "transcribe", "step_progress": 0.5},
        {"type": "progress", "stage_key": "speakers", "step_progress": 0.1},
        {"type": "complete", "total_events": 1}]))
    client.post("/api/subtitle/generate_stream", json={"video_id": "v"}, headers=headers)
    st = _state(uid)
    assert 9_000 <= st["transcribe_used_ms"] <= 11_000 and st["transcribe_reserved_ms"] == 0


def test_stale_reservations_are_charged_not_leaked():
    uid, _ = _make_user(hours=1)
    db = SessionLocal()
    usage.reserve(db, uid, usage.TRANSCRIBE, 7000, "orphan")
    assert usage.reap_stale(db, older_than=None) >= 1
    assert _state(uid)["transcribe_used_ms"] == 7000 and _state(uid)["transcribe_reserved_ms"] == 0
    db.close()


# ---- ledger ------------------------------------------------------------------------------------------

def test_ledger_is_append_only():
    uid, _ = _make_user()
    db = SessionLocal()
    usage.refund(db, usage.reserve(db, uid, usage.TRANSCRIBE, 1000, "r", "file.mp4"))
    rows = usage.list_ledger(db, uid)
    assert [r["event"] for r in rows] == ["refund", "reserve"] and rows[1]["ref"] == "file.mp4"
    with pytest.raises(Exception):
        with engine.begin() as c:
            c.execute(text("UPDATE usage_ledger SET ms = 0 WHERE user_id = :u"), {"u": uid})
    with pytest.raises(Exception):
        with engine.begin() as c:
            c.execute(text("DELETE FROM usage_ledger WHERE user_id = :u"), {"u": uid})
    row = db.query(UsageLedger).filter(UsageLedger.user_id == uid).first()
    row.ms = 5
    with pytest.raises(Exception):
        db.commit()
    db.rollback()
    db.close()


# ---- admin -------------------------------------------------------------------------------------------

def _admin(main_app, client):
    db = SessionLocal()
    exists = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    db.close()
    if not exists:
        _make_user(email=ADMIN_EMAIL, hours=None)
    init_auth_db()  # applies admin status from ADMIN_EMAILS
    return _login(client, ADMIN_EMAIL)


def test_non_admin_cannot_use_admin_routes_or_change_own_limits(main_app, admin_env):
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=1)
    headers = _login(client, email)
    calls = [
        ("get", "/api/admin/users", None),
        ("post", "/api/admin/users", {"name": "Eve", "email": "eve@example.com", "unlimited": True}),
        ("put", f"/api/admin/users/{uid}/access", {"unlimited": True}),
        ("patch", f"/api/admin/users/{uid}/profile", {"name": "Hacker"}),
        ("patch", f"/api/admin/users/{uid}/status", {"role": "admin", "is_admin": True}),
        ("delete", f"/api/admin/users/{uid}", None),
        ("get", f"/api/admin/users/{uid}/usage", None),
    ]
    for method, path, body in calls:
        res = getattr(client, method)(path, headers=headers, **({"json": body} if body is not None else {}))
        assert res.status_code == 403, (method, path, res.status_code)
        assert getattr(client, method)(path, **({"json": body} if body is not None else {})).status_code == 401
    # extra fields on the self-service profile endpoint do nothing
    client.patch("/api/auth/profile", headers=headers,
                 json={"name": "Me", "hours_limit_ms": None, "hours": 999, "is_admin": True, "role": "admin"})
    db = SessionLocal()
    u = db.query(User).filter(User.id == uid).first()
    assert u.hours_limit_ms == 3_600_000 and not u.is_admin and u.role != "admin"
    db.close()
    assert client.get("/api/auth/me", headers=headers).json()["user"]["is_admin"] is False


def test_admin_creates_user_on_any_domain_sets_hours_and_user_sees_them(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    email = f"new_{uuid.uuid4().hex[:6]}@gmail.com"
    # public sign-up stays @verbolabs.com only
    assert client.post("/api/auth/signup", json={"name": "Pub Lic", "email": email, "password": PASSWORD, "confirm_password": PASSWORD}).status_code == 400
    # hours must be explicit
    assert client.post("/api/admin/users", headers=admin, json={"name": "New Person", "email": email}).status_code == 400
    assert client.post("/api/admin/users", headers=admin, json={"name": "New Person", "email": email, "hours": -1}).status_code == 400
    res = client.post("/api/admin/users", headers=admin, json={"name": "New Person", "email": email, "hours": 2.5})
    assert res.status_code == 201, res.text
    body = res.json()
    pwd = body["generated_password"]
    assert body["user"]["usage"]["pool"]["limit_hours"] == 2.5
    assert client.post("/api/admin/users", headers=admin, json={"name": "Dupe", "email": email.upper(), "unlimited": True}).status_code == 409
    login = client.post("/api/auth/login", json={"email": email, "password": pwd})
    assert login.status_code == 200
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['token']}"}).json()["user"]
    assert me["usage"]["pool"]["remaining_hours"] == 2.5 and not me["is_admin"]
    # zero hours: translation is refused
    h = {"Authorization": f"Bearer {login.json()['token']}"}
    assert client.put(f"/api/admin/users/{body['user']['id']}/access", headers=admin, json={"hours": 0}).status_code == 200
    r = client.post("/api/centroid/translate", headers=h, json={"events": _cues(1), "source_lang": "hi", "target_langs": ["en"]})
    assert r.status_code == 402
    # admin edits hours; ledger records the change; delete keeps the ledger
    uid = body["user"]["id"]
    assert client.put(f"/api/admin/users/{uid}/access", headers=admin, json={"hours": 3}).json()["user"]["usage"]["pool"]["limit_hours"] == 3
    led = client.get(f"/api/admin/users/{uid}/usage", headers=admin).json()["ledger"]
    assert any(r["event"] == "limit_change" for r in led)
    assert client.delete(f"/api/admin/users/{uid}", headers=admin).status_code == 200
    db = SessionLocal()
    assert db.query(UsageLedger).filter(UsageLedger.user_id == uid).count() >= 2
    db.close()
    assert client.post("/api/auth/login", json={"email": email, "password": pwd}).status_code == 404


def test_admin_accounts_are_protected(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    me = client.get("/api/auth/me", headers=admin).json()["user"]
    assert me["is_admin"] is True
    assert client.delete(f"/api/admin/users/{me['id']}", headers=admin).status_code == 400
    assert client.patch(f"/api/admin/users/{me['id']}/profile", headers=admin, json={"email": "other@example.com"}).status_code == 400
    # nobody can be promoted through the API
    uid, _ = _make_user()
    r = client.patch(f"/api/admin/users/{uid}/status", headers=admin, json={"role": "admin", "is_admin": True})
    assert r.status_code == 400


def test_migration_is_idempotent_and_leaves_existing_accounts_unlimited():
    uid, _ = _make_user(hours=None)
    init_auth_db(); init_auth_db()
    db = SessionLocal()
    u = db.query(User).filter(User.id == uid).first()
    assert u.hours_limit_ms is None and u.transcribe_used_ms == 0
    db.close()


def test_duration_comes_from_the_decoded_audio(tmp_path):
    from app import metering
    ms = metering.probe_duration_ms_sync(str(_wav(tmp_path, 10)))
    assert 9_800 <= ms <= 10_300
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"not audio")
    with pytest.raises(HTTPException) as e:
        metering.probe_duration_ms_sync(str(junk))
    assert e.value.status_code == 422  # unmeasurable media is refused, never run for free


def test_fix_purpose_cannot_discount_a_whole_track(main_app, monkeypatch):
    from app import centroid_client
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=1)
    headers = _login(client, email)

    async def ok(path, b):
        return {"results": {}}
    monkeypatch.setattr(centroid_client, "post", ok)
    few = {"events": _cues(3, each=2.0), "source_lang": "hi", "target_langs": ["en"], "purpose": "fix"}
    many = {"events": [{"start_time": i * 5, "end_time": i * 5 + 0.5, "text": "hi"} for i in range(100)],
            "source_lang": "hi", "target_langs": ["en"], "purpose": "fix"}
    assert client.post("/api/centroid/translate", json=few, headers=headers).status_code == 200
    assert _state(uid)["translate_used_ms"] == 6_000          # only the three lines' time
    assert client.post("/api/centroid/translate", json=many, headers=headers).status_code == 200
    assert _state(uid)["translate_used_ms"] >= 6_000 + 495_000  # a 100-line "fix" is billed up to the last subtitle's end


# ---- one shared pool -----------------------------------------------------------------------------------

def test_transcription_and_translation_spend_from_one_pool():
    from app.auth_module import usage
    uid, _ = _make_user(hours=60 / 3600)  # a 60 s pool
    db = SessionLocal()
    try:
        r1 = usage.reserve(db, uid, usage.TRANSCRIBE, 10_000, "/t")
        usage.settle(db, r1)                                   # 10 s of transcription
        r2 = usage.reserve(db, uid, usage.TRANSLATE, 50_000, "/x")  # 50 s of translation: exactly fills the pool
        with pytest.raises(HTTPException) as e:
            usage.reserve(db, uid, usage.TRANSCRIBE, 1_000, "/t")  # nothing left for either kind
        assert e.value.status_code == 402 and e.value.extra["remaining_hours"] == 0
        usage.refund(db, r2)
        r3 = usage.reserve(db, uid, usage.TRANSCRIBE, 50_000, "/t")  # the refunded part is usable by the other kind
        with pytest.raises(HTTPException):
            usage.reserve(db, uid, usage.TRANSLATE, 1_000, "/x")
        usage.settle(db, r3)
        s = usage.usage_summary(db.query(User).filter(User.id == uid).first())
        assert s["pool"]["used_hours"] == round(60 / 3600, 4) and s["pool"]["remaining_hours"] == 0
        assert s["transcribe"]["used_hours"] == round(60 / 3600, 4) and s["translate"]["used_hours"] == 0
    finally:
        db.close()


def test_old_per_kind_limits_become_one_pool_once():
    from sqlalchemy import text
    from app.auth_module.database import engine
    ids = {}
    db = SessionLocal()
    for name, t, l in (("both", 3_600_000, 7_200_000), ("t_only", 3_600_000, None), ("none", None, None)):
        _, email = _make_user(hours=None)
        u = db.query(User).filter(User.email == email).first()
        u.transcribe_limit_ms, u.translate_limit_ms = t, l
        u.translate_used_ms = 600_000
        ids[name] = u.id
    db.commit()
    db.close()
    with engine.begin() as conn:  # simulate the database as it was before this change
        conn.execute(text("ALTER TABLE auth_users DROP COLUMN hours_limit_ms"))
    init_auth_db(); init_auth_db()
    db = SessionLocal()
    got = {k: db.query(User).filter(User.id == v).first().hours_limit_ms for k, v in ids.items()}
    db.close()
    assert got["both"] == 3 * 3_600_000                  # 1h + 2h
    assert got["t_only"] == 3_600_000 + 600_000          # unlimited translation counts only what it already used
    assert got["none"] is None                           # unlimited stays unlimited
