"""Dubbing Studio job flow with the ElevenLabs Dubbing API faked."""
import time
from types import SimpleNamespace

import httpx
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import dubbing_routes as routes
from app.auth_module.routes import get_current_user_from_token, get_optional_user_from_token
from app.main import app


class FakeMeter:
    instances = []

    def __init__(self, *a, **k):
        self.closed = None
        self.work_started = self.work_done = False
        FakeMeter.instances.append(self)

    def reserve(self): return self
    def finish(self, charge, note=None): self.closed = self.closed if self.closed is not None else charge
    def on_error(self, exc):
        if self.closed is None:
            self.closed = self.work_started


def _setup(monkeypatch, tmp_path, handler):
    monkeypatch.setattr(routes, "DUB_DIR", tmp_path)
    monkeypatch.setattr(routes, "POLL_SEC", 0.05)
    monkeypatch.setattr(routes, "get_elevenlabs_api_key", lambda: "k")
    monkeypatch.setattr(routes.metering, "Metered", FakeMeter)

    async def fake_probe(path): return 6000
    monkeypatch.setattr(routes.metering, "probe_duration_ms", fake_probe)
    real = httpx.AsyncClient
    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda *a, **k: real(transport=httpx.MockTransport(handler)))
    app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
    app.dependency_overrides[get_optional_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c", role="coordinator", is_admin=False)
    FakeMeter.instances.clear()
    wav = tmp_path / "in.wav"
    sf.write(str(wav), np.zeros(16000 * 6, dtype="float32"), 16000)
    return wav


def _wait(c, jid):
    for _ in range(100):
        j = c.get(f"/api/dubbing/jobs/{jid}").json()
        if j["status"] != "dubbing":
            return j
        time.sleep(0.05)
    raise AssertionError(j)


def test_dub_keeps_background_and_bills_on_success(monkeypatch, tmp_path):
    seen = {}

    def handler(req: httpx.Request):
        if req.method == "POST":
            seen["body"] = req.content
            return httpx.Response(200, json={"dubbing_id": "d1", "expected_duration_sec": 6})
        if req.method == "DELETE":
            return httpx.Response(200, json={})
        if req.url.path.endswith("/audio/hi"):
            return httpx.Response(200, content=b"MP3DATA", headers={"content-type": "audio/mpeg"})
        calls = seen["polls"] = seen.get("polls", 0) + 1
        return httpx.Response(200, json={"status": "dubbing" if calls < 2 else "dubbed"})

    wav = _setup(monkeypatch, tmp_path, handler)
    try:
        with TestClient(app) as c:
            r = c.post("/api/dubbing/jobs", files={"file": ("in.wav", wav.read_bytes(), "audio/wav")},
                       data={"target_language": "Hindi", "source_language": "English"})
            assert r.status_code == 200, r.text
            j = _wait(c, r.json()["job_id"])
            assert j["status"] == "done", j["error"]
            assert "media_path" not in j and "eleven_id" not in j
            assert b"drop_background_audio" not in seen["body"]  # the original background stays under the dub
            assert b'name="target_lang"' in seen["body"] and b"hi" in seen["body"]
            assert c.get(f"/api/dubbing/jobs/{j['id']}/download/audio").content == b"MP3DATA"
            assert FakeMeter.instances[0].closed is True
    finally:
        app.dependency_overrides.clear()


def test_failed_dub_is_refunded_and_message_shown(monkeypatch, tmp_path):
    def handler(req):
        return httpx.Response(402, json={"detail": {"status": "payment_required", "message": "Upgrade your plan"}})

    wav = _setup(monkeypatch, tmp_path, handler)
    try:
        with TestClient(app) as c:
            r = c.post("/api/dubbing/jobs", files={"file": ("in.wav", wav.read_bytes(), "audio/wav")}, data={"target_language": "English"})
            j = _wait(c, r.json()["job_id"])
            assert j["status"] == "error" and "Upgrade your plan" in j["error"]
            assert not FakeMeter.instances[0].closed  # refunded
            assert c.post("/api/dubbing/jobs", files={"file": ("in.wav", b"x", "audio/wav")}, data={"target_language": "Klingon"}).status_code == 400
            other = SimpleNamespace(id="other", email="x@y.z", role="coordinator", is_admin=False)
            app.dependency_overrides[get_current_user_from_token] = lambda: other
            app.dependency_overrides[get_optional_user_from_token] = lambda: other
            assert c.get(f"/api/dubbing/jobs/{j['id']}").status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_watermark_retry_when_plan_does_not_allow_clean_dub(monkeypatch, tmp_path):
    marks = []

    def handler(req: httpx.Request):
        if req.method == "POST":
            mark = b"true" if b'name="watermark"\r\n\r\ntrue' in req.content else b"false"
            marks.append(mark)
            if mark == b"false":
                return httpx.Response(403, json={"detail": {"status": "watermark_not_allowed", "message": "Starter+ only"}})
            return httpx.Response(200, json={"dubbing_id": "d1"})
        if req.method == "DELETE":
            return httpx.Response(200, json={})
        if req.url.path.endswith("/audio/en"):
            return httpx.Response(200, content=b"MP3", headers={"content-type": "audio/mpeg"})
        return httpx.Response(200, json={"status": "dubbed"})

    wav = _setup(monkeypatch, tmp_path, handler)
    try:
        with TestClient(app) as c:
            r = c.post("/api/dubbing/jobs", files={"file": ("in.wav", wav.read_bytes(), "audio/wav")}, data={"target_language": "English"})
            j = _wait(c, r.json()["job_id"])
            assert j["status"] == "done", j["error"]
            assert marks == [b"false", b"true"] and j["watermarked"] is True
    finally:
        app.dependency_overrides.clear()
