"""Admin Jobs list and usage overview: built from the metered-job reservations, admin-only."""
from fastapi.testclient import TestClient

from app.auth_module import usage
from app.auth_module.database import SessionLocal
from tests.test_usage_limits import _admin, _login, _make_user, admin_env, main_app  # noqa: F401  (fixtures)


def _job(uid, kind, seconds, route, ref, outcome):
    db = SessionLocal()
    try:
        rid = usage.reserve(db, uid, kind, seconds * 1000, route, ref)
        if outcome == "settle":
            usage.settle(db, rid)
        elif outcome == "refund":
            usage.refund(db, rid)
        return rid
    finally:
        db.close()


def test_jobs_and_overview_report_real_usage(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    uid, email = _make_user(transcribe_h=None, translate_h=None)
    _job(uid, usage.TRANSCRIBE, 1800, "/api/transcribe_async", "episode_01.wav", "settle")
    _job(uid, usage.TRANSCRIBE, 600, "/api/subtitle/generate_stream", "vid123", "refund")
    _job(uid, usage.TRANSLATE, 360, "/api/centroid/translate", "2 language(s)", "settle")
    running = _job(uid, usage.TRANSCRIBE, 60, "/api/subtitle/generate", "vid456", None)

    res = client.get("/api/admin/jobs", headers=admin, params={"query": email})
    assert res.status_code == 200
    jobs = res.json()["jobs"]
    assert res.json()["total"] == 4 and len(jobs) == 4
    by_route = {(j["studio"], j["action"], j["status"]) for j in jobs}
    assert ("transcribe", "Transcription", "charged") in by_route
    assert ("subtitle", "Subtitle generation", "refunded") in by_route
    assert ("subtitle", "Translation", "charged") in by_route
    assert ("subtitle", "Subtitle generation", "running") in by_route
    assert all(j["user_email"] == email for j in jobs)

    only = client.get("/api/admin/jobs", headers=admin, params={"query": email, "studio": "transcribe"}).json()
    assert only["total"] == 1 and only["jobs"][0]["file"] == "episode_01.wav" and only["jobs"][0]["hours"] == 0.5
    assert client.get("/api/admin/jobs", headers=admin, params={"query": email, "status_filter": "refunded"}).json()["total"] == 1
    assert client.get("/api/admin/jobs", headers=admin, params={"query": email, "kind": "translate"}).json()["total"] == 1

    ov = client.get("/api/admin/usage-overview", headers=admin).json()
    assert ov["hours"]["transcribe_total"] >= 0.5 and ov["hours"]["translate_total"] >= 0.1
    assert ov["jobs"]["running"] >= 1
    me = next(r for r in ov["top_users"] if r["user_id"] == uid)
    assert me["transcribe_hours"] == 0.5 and me["translate_hours"] == 0.1 and me["jobs"] == 2
    assert any(j["id"] == running for j in ov["recent_jobs"])

    db = SessionLocal()
    usage.refund(db, running)
    db.close()


def test_jobs_endpoints_are_admin_only(main_app, admin_env):
    client = TestClient(main_app.app)
    _, email = _make_user()
    headers = _login(client, email)
    for path in ("/api/admin/jobs", "/api/admin/usage-overview"):
        assert client.get(path, headers=headers).status_code == 403
        assert client.get(path).status_code == 401
