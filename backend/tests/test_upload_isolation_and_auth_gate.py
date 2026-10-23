"""Uploads never delete other users' files; every route needs a session except the public ones."""
import uuid

from fastapi.testclient import TestClient

from tests.test_usage_limits import _login, _make_user, _wav, main_app  # noqa: F401  (fixtures)


def _upload(client, headers, path, wav_bytes, name):
    return client.post(path, headers=headers, files={"file": (name, wav_bytes, "audio/wav")})


def test_overlapping_names_from_two_users_all_survive(main_app, tmp_path):
    client = TestClient(main_app.app)
    _, e1 = _make_user(hours=None)
    _, e2 = _make_user(hours=None)
    h1, h2 = _login(client, e1), _login(client, e2)
    wav = _wav(tmp_path).read_bytes()
    tag = uuid.uuid4().hex[:5]

    for path in ("/api/subtitle/upload", "/api/upload"):
        if path == "/api/upload":
            continue  # transcription upload keeps the raw file only; covered below
        a = _upload(client, h1, path, wav, f"meeting{tag}_recording.wav")
        b = _upload(client, h2, path, wav, f"meeting{tag}.wav")
        c = _upload(client, h2, path, wav, f"meeting{tag}.wav")  # same user, same name again
        assert a.status_code == b.status_code == c.status_code == 200, (a.text, b.text, c.text)
        ids = [r.json()["video_id"] for r in (a, b, c)]
        assert len(set(ids)) == 3
        for vid in ids:
            assert client.get(f"/api/subtitle/waveform/{vid}", headers=h1).status_code == 200, vid
            assert main_app.resolve_active_session_video(vid), vid

    ids_first = _upload(client, h1, "/api/upload", wav, f"ep{tag}.wav")
    ids_second = _upload(client, h2, "/api/upload", wav, f"ep{tag}_final.wav")
    assert ids_first.status_code == ids_second.status_code == 200
    names = {p.name for p in main_app.UPLOAD_DIR.glob(f"*ep{tag}*")}
    assert len(names) == 2, names


def test_discard_only_removes_that_session(main_app, tmp_path):
    client = TestClient(main_app.app)
    _, email = _make_user(hours=None)
    h = _login(client, email)
    wav = _wav(tmp_path).read_bytes()
    tag = uuid.uuid4().hex[:5]
    a = _upload(client, h, "/api/subtitle/upload", wav, f"clip{tag}.wav").json()["video_id"]
    b = _upload(client, h, "/api/subtitle/upload", wav, f"clip{tag}_long.wav").json()["video_id"]
    res = client.post("/api/subtitle/discard", headers=h, json={"video_id": a})
    assert res.status_code == 200 and res.json()["deleted_count"] >= 1
    assert not list(main_app.UPLOAD_DIR.glob(f"{a}.*"))
    assert list(main_app.UPLOAD_DIR.glob(f"{b}.*"))


def test_signed_out_requests_are_refused_except_public_routes(main_app):
    client = TestClient(main_app.app)
    for method, path in (("post", "/api/upload"), ("post", "/api/subtitle/upload"), ("get", "/api/projects"),
                         ("get", "/api/subtitle/projects"), ("post", "/api/export"), ("post", "/api/subtitle/lint"),
                         ("post", "/api/subtitle/qc"), ("post", "/api/lint"), ("get", "/api/subtitle/waveform/abc"),
                         ("post", "/api/subtitle/export"), ("get", "/api/centroid/status"),
                         ("get", "/api/audio/extract_status/qa-nonexistent"), ("post", "/api/projects/save"),
                         ("delete", "/api/projects/abc"), ("delete", "/api/subtitle/projects/abc"),
                         ("post", "/api/subtitle/projects/save"), ("delete", "/api/cleanup/abc"),
                         # admin routes named for the action (what the browser Network tab shows)
                         ("get", "/api/admin/users/refresh"), ("get", "/api/admin/overview/refresh"),
                         ("delete", "/api/admin/users/x/delete"), ("patch", "/api/admin/users/x/edit"),
                         ("patch", "/api/admin/users/x/disable"), ("patch", "/api/admin/users/x/enable"),
                         ("patch", "/api/admin/users/x/role")):
        res = getattr(client, method)(path)
        assert res.status_code == 401, (path, res.status_code)
    assert client.get("/api/health").status_code == 200
    assert client.get("/").status_code == 200
    assert client.post("/api/auth/login", json={"email": "no@example.com", "password": "x"}).status_code in (400, 401, 404, 422)
    # public media GET: 404 for an unknown file, not 401
    assert client.get("/api/audio/does-not-exist.wav").status_code == 404
    assert client.get("/api/audio/*").status_code == 404


def test_signed_in_user_reaches_gated_routes(main_app):
    client = TestClient(main_app.app)
    _, email = _make_user(hours=None)
    h = _login(client, email)
    assert client.get("/api/projects", headers=h).status_code != 401
    assert client.post("/api/export?format=exe", headers=h, json={}).status_code != 401


def test_forwarded_for_only_trusted_from_proxy(main_app):
    class Req:
        def __init__(self, peer, xff):
            self.client = type("C", (), {"host": peer})()
            self.headers = {"x-forwarded-for": xff} if xff else {}

    assert main_app.get_client_ip(Req("203.0.113.9", "1.2.3.4")) == "203.0.113.9"  # direct caller: header ignored
    assert main_app.get_client_ip(Req("127.0.0.1", "6.6.6.6, 198.51.100.7")) == "198.51.100.7"  # proxy: last hop
    assert main_app.get_client_ip(Req("127.0.0.1", None)) == "127.0.0.1"


def test_export_unknown_format_is_400(main_app):
    client = TestClient(main_app.app)
    _, email = _make_user(hours=None)
    h = _login(client, email)
    res = client.post("/api/subtitle/export", headers=h, json={"events": [], "format": "exe"})
    assert res.status_code == 400, res.text
