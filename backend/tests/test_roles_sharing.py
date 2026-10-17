"""Roles (admin / coordinator / linguist) and sharing a subtitle project with linguists."""
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth_module import usage
from app.auth_module.database import SessionLocal, engine, init_auth_db
from app.auth_module.models import User, UserMediaAsset
from tests.test_usage_limits import _admin, _login, _make_user, _wav, admin_env, main_app  # noqa: F401  (fixtures)

DRAFT = {"events": [{"id": 1, "start_time": 0, "end_time": 2, "text": "hello"}], "tracks": {}, "activeTrack": None}


def _linguist():
    return _make_user(hours=0, role="linguist")


def _setup(client):
    c_id, c_email = _make_user(hours=1, role="coordinator")
    l_id, l_email = _linguist()
    return (c_id, _login(client, c_email)), (l_id, _login(client, l_email))


def test_existing_editor_accounts_become_coordinators(main_app):
    uid, _ = _make_user(role="editor")
    init_auth_db()
    db = SessionLocal()
    assert db.query(User).filter(User.id == uid).first().role == "coordinator"
    db.close()


def test_linguist_is_locked_out_of_everything_but_review(main_app):
    client = TestClient(main_app.app)
    _, (_, lh) = _setup(client)
    for method, path in (("post", "/api/transcribe"), ("post", "/api/transcribe_async"), ("post", "/api/subtitle/generate"),
                         ("post", "/api/subtitle/generate_stream"), ("post", "/api/centroid/translate"), ("post", "/api/centroid/qc"),
                         ("post", "/api/subtitle/gemini_fix"), ("post", "/api/subtitle/upload"), ("post", "/api/upload"),
                         ("post", "/api/subtitle/context_autofill"), ("post", "/api/subtitle/acoustic_sync"),
                         ("get", "/api/projects"), ("get", "/api/subtitle/projects"), ("post", "/api/export")):
        assert getattr(client, method)(path, headers=lh, **({"json": {}} if method == "post" else {})).status_code == 403, path
    assert client.get("/api/auth/me", headers=lh).json()["user"]["role"] == "linguist"
    assert client.get("/api/shares/with-me", headers=lh).status_code == 200
    assert client.post("/api/subtitle/lint", headers=lh, json={}).status_code != 403  # free local check stays available
    assert client.get("/api/admin/users", headers=lh).status_code == 403


def test_linguist_can_never_spend_hours_even_if_a_route_forgot_the_gate():
    uid, _ = _make_user(hours=100, role="linguist")  # even with hours on the account
    db = SessionLocal()
    try:
        with pytest.raises(HTTPException) as e:
            usage.reserve(db, uid, usage.TRANSLATE, 1000, "/api/centroid/translate")
        assert e.value.status_code == 403
    finally:
        db.close()


def test_admin_creates_linguists_and_changes_roles(main_app, admin_env):
    client = TestClient(main_app.app)
    admin = _admin(main_app, client)
    email = f"lin_{uuid.uuid4().hex[:6]}@example.com"
    assert client.post("/api/admin/users", headers=admin, json={"name": "Bad Role", "email": "x" + email, "hours": 1, "role": "owner"}).status_code == 400
    res = client.post("/api/admin/users", headers=admin, json={"name": "Lin Guist", "email": email, "role": "linguist"})
    assert res.status_code == 201, res.text
    user = res.json()["user"]
    assert user["role"] == "linguist" and user["usage"]["pool"]["limit_hours"] == 0  # no hours, ever
    uid = user["id"]
    assert client.patch(f"/api/admin/users/{uid}/status", headers=admin, json={"role": "coordinator"}).status_code == 200
    assert client.patch(f"/api/admin/users/{uid}/status", headers=admin, json={"role": "wizard"}).status_code == 400
    login = client.post("/api/auth/login", json={"email": email, "password": res.json()["generated_password"]})
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['token']}"}).json()["user"]
    assert me["role"] == "coordinator"
    admin_id = client.get("/api/auth/me", headers=admin).json()["user"]["id"]
    assert client.patch(f"/api/admin/users/{admin_id}/status", headers=admin, json={"role": "linguist"}).status_code == 400


def test_share_edit_and_revoke(main_app):
    client = TestClient(main_app.app)
    (cid, ch), (lid, lh) = _setup(client)
    other_id, other_h = _linguist()[0], None
    # a linguist cannot publish; a coordinator cannot share with a coordinator
    assert client.post("/api/shares/projects", headers=lh, json={"title": "x", "draft": DRAFT}).status_code == 403
    peer_id, _ = _make_user(hours=1)
    assert client.post("/api/shares/projects", headers=ch, json={"title": "x", "draft": DRAFT, "linguist_ids": [peer_id]}).status_code == 400
    assert client.post("/api/shares/projects", headers=ch, json={"title": "x", "draft": {"nope": 1}}).status_code == 400

    linguists = client.get("/api/shares/linguists", headers=ch).json()["linguists"]
    assert any(x["id"] == lid for x in linguists)
    pub = client.post("/api/shares/projects", headers=ch, json={"title": "Episode 1", "filename": "ep1.mp4", "draft": DRAFT, "linguist_ids": [lid]})
    assert pub.status_code == 200, pub.text
    pid = pub.json()["project"]["id"]
    assert pub.json()["project"]["revision"] == 1

    # only the shared linguist sees it
    assert [p["id"] for p in client.get("/api/shares/with-me", headers=lh).json()["projects"]] == [pid]
    stranger = _login(client, _linguist()[1])
    assert client.get("/api/shares/with-me", headers=stranger).json()["projects"] == []
    assert client.get(f"/api/shares/projects/{pid}", headers=stranger).status_code == 404

    opened = client.get(f"/api/shares/projects/{pid}", headers=lh).json()
    assert opened["draft"]["events"][0]["text"] == "hello" and not opened["is_owner"]
    edited = {**DRAFT, "events": [{"id": 1, "start_time": 0, "end_time": 2, "text": "hello, world"}]}
    saved = client.put(f"/api/shares/projects/{pid}/draft", headers=lh, json={"draft": edited, "base_revision": 1})
    assert saved.status_code == 200 and saved.json()["revision"] == 2
    # a save from a stale copy is refused instead of overwriting
    stale = client.put(f"/api/shares/projects/{pid}/draft", headers=ch, json={"draft": DRAFT, "base_revision": 1})
    assert stale.status_code == 409
    seen = client.get(f"/api/shares/projects/{pid}", headers=ch).json()
    assert seen["draft"]["events"][0]["text"] == "hello, world" and seen["project"]["updated_by"] == "Test User"
    assert client.put(f"/api/shares/projects/{pid}/draft", headers=stranger, json={"draft": DRAFT, "base_revision": 2}).status_code == 404

    # revoke: gone at once
    assert client.put(f"/api/shares/projects/{pid}/linguists", headers=ch, json={"linguist_ids": []}).status_code == 200
    assert client.get(f"/api/shares/projects/{pid}", headers=lh).status_code == 404
    assert client.put(f"/api/shares/projects/{pid}/draft", headers=lh, json={"draft": DRAFT, "base_revision": 2}).status_code == 404
    # other coordinators cannot touch or remove it
    _, other_coord = _make_user(hours=1)
    oc = _login(client, other_coord)
    assert client.put(f"/api/shares/projects/{pid}/linguists", headers=oc, json={"linguist_ids": [lid]}).status_code == 404
    assert client.delete(f"/api/shares/projects/{pid}", headers=oc).status_code == 404
    assert client.delete(f"/api/shares/projects/{pid}", headers=ch).status_code == 200


def test_shared_video_streams_only_to_people_with_access(main_app, tmp_path):
    client = TestClient(main_app.app)
    (cid, ch), (lid, lh) = _setup(client)
    wav = _wav(tmp_path, 3)
    db = SessionLocal()
    db.add(UserMediaAsset(user_id=cid, video_id="vid123", filename="a.wav", storage_path=str(wav)))
    db.commit(); db.close()
    # someone else's media id cannot be attached
    sneaky = client.post("/api/shares/projects", headers=ch, json={"title": "t", "draft": DRAFT, "video_id": "not-mine", "linguist_ids": [lid]})
    assert sneaky.json()["project"]["has_video"] is False
    pid = client.post("/api/shares/projects", headers=ch, json={"title": "t", "draft": DRAFT, "video_id": "vid123", "linguist_ids": [lid]}).json()["project"]["id"]
    link = client.get(f"/api/shares/projects/{pid}/video-link", headers=lh).json()
    assert link["available"]
    full = client.get(link["url"])
    assert full.status_code == 200 and len(full.content) == wav.stat().st_size
    part = client.get(link["url"], headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert client.get(f"/api/shares/projects/{pid}/video?t=garbage").status_code == 403
    client.put(f"/api/shares/projects/{pid}/linguists", headers=ch, json={"linguist_ids": []})
    assert client.get(link["url"]).status_code == 403  # a link made before the revoke stops working
