"""Translation is billed by the media's exact length (x languages); QC fixes only by the lines they redo."""
import shutil
import uuid

from fastapi.testclient import TestClient

from app.auth_module.database import SessionLocal
from app.auth_module.models import UsageReservation
from app.config import UPLOAD_DIR
from tests.test_usage_limits import _login, _make_user, _state, _wav, main_app  # noqa: F401  (fixture)


def _fake_centroid(monkeypatch):
    from app import centroid_client

    async def ok(path, body):
        return {"results": {}}
    monkeypatch.setattr(centroid_client, "post", ok)


def _cues(spans):
    return [{"start_time": a, "end_time": b, "text": "hello there"} for a, b in spans]


def _last_ref(uid):
    db = SessionLocal()
    try:
        return db.query(UsageReservation).filter(UsageReservation.user_id == uid).order_by(UsageReservation.created_at.desc()).first().ref
    finally:
        db.close()


def test_full_translation_costs_the_whole_video_times_languages(main_app, tmp_path, monkeypatch):
    _fake_centroid(monkeypatch)
    client = TestClient(main_app.app)
    uid, email = _make_user(translate_h=1)
    headers = _login(client, email)
    vid = f"bill_{uuid.uuid4().hex[:8]}"
    shutil.copy(_wav(tmp_path, 30), UPLOAD_DIR / f"{vid}.wav")  # a 30 s video whose subtitles cover only 4 s
    try:
        body = {"events": _cues([(2, 4), (10, 12)]), "source_lang": "hi", "target_langs": ["en", "fr"], "video_id": vid}
        assert client.post("/api/centroid/translate", json=body, headers=headers).status_code == 200
        assert _state(uid)["translate_used_ms"] == 60_000  # 30 s x 2 languages, not 4 s of on-screen text
        assert f"{vid}.wav" in _last_ref(uid) and "2 languages" in _last_ref(uid)
    finally:
        (UPLOAD_DIR / f"{vid}.wav").unlink(missing_ok=True)


def test_without_media_the_subtitle_timeline_is_billed(main_app, monkeypatch):
    _fake_centroid(monkeypatch)
    client = TestClient(main_app.app)
    uid, email = _make_user(translate_h=1)
    headers = _login(client, email)
    # gaps between lines are still part of the programme: billed to where the last line ends (95 s), not 4 s
    body = {"events": _cues([(1, 3), (93, 95)]), "source_lang": "hi", "target_langs": ["en"]}
    assert client.post("/api/centroid/translate", json=body, headers=headers).status_code == 200
    assert _state(uid)["translate_used_ms"] == 95_000
    # a media id that does not exist on the server cannot lower it either
    body["video_id"] = "no-such-video"
    assert client.post("/api/centroid/translate", json=body, headers=headers).status_code == 200
    assert _state(uid)["translate_used_ms"] == 190_000


def test_qc_fix_bills_only_the_lines_it_redoes(main_app, monkeypatch):
    _fake_centroid(monkeypatch)
    client = TestClient(main_app.app)
    uid, email = _make_user(translate_h=1)
    headers = _login(client, email)
    body = {"events": _cues([(600, 603), (900, 902)]), "source_lang": "hi", "target_langs": ["en"], "purpose": "fix"}
    assert client.post("/api/centroid/translate", json=body, headers=headers).status_code == 200
    assert _state(uid)["translate_used_ms"] == 5_000
    assert _last_ref(uid).startswith("QC fix · 2 lines")
