"""Guards that stop minutes (and provider spend) being had for free: sign-up default, squeezed translation timings,
the per-project caps inside a dubbing project, and the AI-helper rate limit."""
import subprocess
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import dubbing_engines as eng
from app import dubbing_projects as dp
from app.auth_module import routes as auth_routes
from app.auth_module.database import SessionLocal
from app.auth_module.models import User
from app.auth_module.routes import get_current_user_from_token, get_optional_user_from_token
from app.auth_module.usage import signup_limit_ms
from tests.test_translation_billing import _fake_centroid
from tests.test_usage_limits import _login, _make_user, _state, main_app  # noqa: F401  (fixture)


# ---- sign-up ---------------------------------------------------------------------------------------------

def test_signup_default_minutes(monkeypatch):
    monkeypatch.delenv("SIGNUP_DEFAULT_MINUTES", raising=False)
    assert signup_limit_ms() == 0
    monkeypatch.setenv("SIGNUP_DEFAULT_MINUTES", "15")
    assert signup_limit_ms() == 15 * 60_000
    monkeypatch.setenv("SIGNUP_DEFAULT_MINUTES", "unlimited")
    assert signup_limit_ms() is None


def test_a_new_signup_has_no_minutes(main_app, monkeypatch):
    monkeypatch.delenv("SIGNUP_DEFAULT_MINUTES", raising=False)
    monkeypatch.setattr(auth_routes, "send_verification_email", lambda *a, **k: {"success": True})
    client = TestClient(main_app.app)
    email = f"new.joiner.{time.time_ns()}@verbolabs.com"
    pwd = "Str0ng!Passw0rd"
    r = client.post("/api/auth/signup", json={"name": "New Joiner", "email": email, "password": pwd, "confirm_password": pwd})
    assert r.status_code == 201, r.text
    db = SessionLocal()
    try:
        assert db.query(User).filter(User.email == email).first().hours_limit_ms == 0
    finally:
        db.close()


# ---- translation billing ---------------------------------------------------------------------------------

def test_squeezed_timings_do_not_make_a_translation_much_cheaper(main_app, monkeypatch):
    _fake_centroid(monkeypatch)
    client = TestClient(main_app.app)
    uid, email = _make_user(hours=5)
    headers = _login(client, email)
    track = [{"start_time": i * 2.0, "end_time": i * 2.0 + 1.9, "text": f"This is spoken line number {i:03d}."} for i in range(300)]
    client.post("/api/centroid/translate", json={"events": track, "source_lang": "hi", "target_langs": ["en"]}, headers=headers)
    honest = _state(uid)["translate_used_ms"]
    squeezed = [dict(e, start_time=i * 0.2, end_time=i * 0.2 + 0.19) for i, e in enumerate(track)]
    client.post("/api/centroid/translate", json={"events": squeezed, "source_lang": "hi", "target_langs": ["en"]}, headers=headers)
    cheat = _state(uid)["translate_used_ms"] - honest
    assert cheat >= 0.85 * honest  # was about 0.62 with the old 25 characters-per-second floor


# ---- dubbing project caps --------------------------------------------------------------------------------

def _project(tmp_path, **extra):
    pid = "guard" + str(time.time_ns())[-6:]
    (tmp_path / pid).mkdir()
    proj = {
        "id": pid, "owner": "u1", "filename": "clip.wav", "media_path": str(tmp_path / pid / "source.wav"), "is_video": False,
        "duration": 10.0, "status": "ready", "stage": "translated", "percent": 100, "detail": "", "error": None,
        "source_language": "Hindi", "target_language": "English", "created": 0,
        "segments": [
            {"id": 1, "speaker": "A", "gender": "Male", "start": 0.5, "end": 3.0, "text": "x", "translation": "y" * 20},
            {"id": 2, "speaker": "A", "gender": "Male", "start": 4.0, "end": 6.0, "text": "x", "translation": "z" * 30},
        ],
        "speakers": {"A": {"voice": {"mode": "stock", "voice_id": "va"}, "energy": "medium"}},
        **extra,
    }
    dp._projects[pid] = proj
    dp._save(proj)
    return pid, proj


@pytest.fixture
def dub_client(monkeypatch, tmp_path):
    from app.main import app
    monkeypatch.setattr(dp, "ROOT", tmp_path)
    monkeypatch.setattr(dp, "get_elevenlabs_api_key", lambda: "k")
    app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
    app.dependency_overrides[get_optional_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c", role="coordinator", is_admin=False)
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _wait(c, pid):
    for _ in range(200):
        j = c.get(f"/api/dubbing/projects/{pid}").json()
        if j["status"] not in dp.BUSY:
            return j
        time.sleep(0.05)
    raise AssertionError(j)


def test_dubbing_speech_is_counted_and_capped(dub_client, monkeypatch, tmp_path):
    from app.video_processor import get_ffmpeg_path

    async def fake_speak(client, voice_id, text, settings, sem):
        out = tmp_path / f"s{time.time_ns()}.mp3"
        subprocess.run([get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=1", str(out)], check=True)
        return out.read_bytes()
    monkeypatch.setattr(eng, "speak", fake_speak)
    pid, proj = _project(tmp_path)
    assert dub_client.post(f"/api/dubbing/projects/{pid}/speak", json={}).status_code == 200
    j = _wait(dub_client, pid)
    assert j["speech_chars"] == 50                                   # both lines counted
    proj["speech_chars"] = dp.speech_budget(proj) - 10                 # almost used up
    r = dub_client.post(f"/api/dubbing/projects/{pid}/speak", json={})
    assert r.status_code == 429 and "speech allowance" in r.json()["detail"]
    assert dub_client.post(f"/api/dubbing/projects/{pid}/speak", json={"ids": []}).status_code == 429


def test_dubbing_line_length_clone_and_translation_caps(dub_client, monkeypatch, tmp_path):
    pid, proj = _project(tmp_path)
    rows = [dict(s) for s in proj["segments"]]
    rows[0]["translation"] = "a" * (dp.MAX_LINE_CHARS + 1)
    assert dub_client.put(f"/api/dubbing/projects/{pid}/segments", json={"segments": rows}).status_code == 400

    (tmp_path / pid / "samples").mkdir()
    (tmp_path / pid / "samples" / "A.mp3").write_bytes(b"x")
    proj["speakers"]["A"].update(sample_file="A.mp3", sample_seconds=60)
    proj["clones"] = dp.MAX_CLONES
    assert dub_client.post(f"/api/dubbing/projects/{pid}/speakers/A/clone").status_code == 429

    async def fake_translate(segs, speakers, src, tgt, progress=None):
        return {s["id"]: f"{tgt}:{s['text']}" for s in segs}
    monkeypatch.setattr(eng, "translate_lines", fake_translate)
    proj["translated_lines"] = 2 * dp.MAX_AI_RUNS - 1                # one line of allowance left
    assert dub_client.post(f"/api/dubbing/projects/{pid}/translate", json={"target_language": "English", "ids": [1]}).status_code == 200
    _wait(dub_client, pid)
    assert dub_client.post(f"/api/dubbing/projects/{pid}/translate", json={"target_language": "English", "ids": [1]}).status_code == 429


# ---- AI helpers ------------------------------------------------------------------------------------------

def test_ai_helpers_are_rate_limited_per_user(main_app):
    m = main_app
    m._ai_calls.clear()
    for _ in range(m.AI_CALLS_PER_MINUTE):
        m._ai_rate_limit("someone")
    with pytest.raises(HTTPException) as e:
        m._ai_rate_limit("someone")
    assert e.value.status_code == 429
    m._ai_rate_limit("someone-else")  # a different user is not affected
