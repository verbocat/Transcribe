"""Dubbing Studio: language handling, voice choice, timing fit and mixing (ElevenLabs and Gemini are faked)."""
import asyncio
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app import dubbing_service as svc
from app.video_processor import get_ffmpeg_path


def _tone_mp3(path: Path, seconds: float):
    subprocess.run([get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}",
                    "-b:a", "64k", str(path)], check=True)


def test_normalize_language():
    assert svc.normalize_language("hindi") == "Hindi"
    assert svc.normalize_language("en") == "English"
    with pytest.raises(svc.DubbingError):
        svc.normalize_language("French")


def test_pick_stock_voice_matches_gender_and_avoids_reuse():
    groups = {"male": [{"id": "m1", "age": "young"}, {"id": "m2", "age": "young"}], "female": [{"id": "f1", "age": "old"}]}
    assert svc.pick_stock_voice(groups, {"gender": "Male", "age_range": "adult"}, [], 0) == "m1"
    assert svc.pick_stock_voice(groups, {"gender": "Male", "age_range": "young adult"}, ["m1"], 1) == "m2"
    assert svc.pick_stock_voice(groups, {"gender": "Female"}, [], 2) == "f1"


def test_voice_settings_follow_energy_and_clamp_speed():
    assert svc.voice_settings({"energy": "high"})["stability"] < svc.voice_settings({"energy": "low"})["stability"]
    assert svc.voice_settings({}, speed=3.0)["speed"] == svc.FIRST_STRETCH


def test_render_fits_lines_to_their_slots(tmp_path, monkeypatch):
    jdir = tmp_path / "job1"
    (jdir / "samples").mkdir(parents=True)
    media = jdir / "source.wav"
    sf.write(str(media), np.zeros(16000 * 12, dtype="float32"), 16000)
    _tone_mp3(jdir / "samples" / "Speaker_1.mp3", 10)

    spoken, deleted = [], []

    async def fake_speak(client, voice_id, text, settings, sem):
        spoken.append((voice_id, text))
        p = tmp_path / f"t{len(spoken)}.mp3"
        _tone_mp3(p, len(text) * 0.1)  # 0.1 s per character
        return p.read_bytes()

    async def fake_clone(client, name, sample, desc):
        return "clonedvoice"

    async def fake_delete(client, vid):
        deleted.append(vid)

    async def fake_stock(client):
        return {"male": [{"id": "stockm", "age": ""}], "female": [{"id": "stockf", "age": ""}]}

    async def fake_shorten(text, n, lang, prof):
        return text[:n]

    monkeypatch.setattr(svc, "speak", fake_speak)
    monkeypatch.setattr(svc, "clone_voice", fake_clone)
    monkeypatch.setattr(svc, "delete_voice", fake_delete)
    monkeypatch.setattr(svc, "list_stock_voices", fake_stock)
    monkeypatch.setattr(svc, "shorten_line", fake_shorten)
    monkeypatch.setattr(svc, "_headers", lambda: {"xi-api-key": "x"})

    segs = [
        {"id": 1, "speaker": "Speaker 1", "gender": "Male", "start": 0.5, "end": 3.0, "text": "a"},
        {"id": 2, "speaker": "Speaker 2", "gender": "Female", "start": 4.0, "end": 6.0, "text": "b"},
    ]
    profiles = {
        "Speaker 1": {"gender": "Male", "sample_file": "Speaker_1.mp3", "sample_seconds": 10, "energy": "medium"},
        "Speaker 2": {"gender": "Female", "sample_file": None, "sample_seconds": 0, "energy": "high"},
    }
    texts = {1: "x" * 20, 2: "y" * 60}  # 2.0 s fits a 2.5 s slot; 6.0 s must be shortened into a 2 s slot
    out = asyncio.run(svc.render_dub(jdir, str(media), False, 12.0, segs, profiles, texts, "English", {}))

    assert out["voices"]["Speaker 1"] == {"voice_id": "clonedvoice", "mode": "clone"}
    assert out["voices"]["Speaker 2"]["mode"] == "stock" and out["voices"]["Speaker 2"]["voice_id"] == "stockf"
    assert deleted == ["clonedvoice"]
    assert len(out["texts"][2]) < 60
    mix, sr = sf.read(str(jdir / "dub.mp3"))
    assert abs(len(mix) / sr - 12.0) < 1.0
    assert (jdir / out["files"]["audio"]).exists()
    assert set(out["files"]["speakers"]) == {"Speaker 1", "Speaker 2"}
    # line 1 sounds from 0.5 s, silence before it
    assert np.abs(mix[: int(0.3 * sr)]).max() < 0.05
    assert np.abs(mix[int(0.8 * sr): int(1.5 * sr)]).max() > 0.05


def test_job_flow_over_http(tmp_path, monkeypatch):
    """Upload -> analyse -> translate -> render through the API, with the paid providers faked."""
    import time
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    from app import dubbing_routes as routes
    from app.main import app
    from app.auth_module.routes import get_current_user_from_token

    monkeypatch.setattr(routes, "DUB_DIR", tmp_path)
    monkeypatch.setattr(routes, "get_elevenlabs_api_key", lambda: "k")
    user = SimpleNamespace(id="u1", email="a@b.c")
    app.dependency_overrides[get_current_user_from_token] = lambda: user

    class FakeMeter:
        def __init__(self, *a, **k): self.closed = None
        def reserve(self): return self
        def finish(self, charge, note=None): self.closed = charge
        def on_error(self, exc): pass
        def note_stage(self, s): pass
    monkeypatch.setattr(routes.metering, "Metered", FakeMeter)

    async def fake_probe(path): return 6000
    monkeypatch.setattr(routes.metering, "probe_duration_ms", fake_probe)

    async def fake_process(audio_path, language, script, video_path=None, progress_cb=None):
        seg = lambda t, s, e, sp: SimpleNamespace(speaker=sp, gender="Male", start_time=s, end_time=e, transcript=t)
        return SimpleNamespace(language="Hindi", segments=[seg("नमस्ते दोस्तों", 0.2, 2.0, "Speaker 1"), seg("कैसे हो", 2.5, 4.0, "Speaker 2")])
    import app.scribe_transcriber as st
    monkeypatch.setattr(st, "process_audio_file", fake_process)

    async def fake_profiles(media, segs, lang, jdir, progress=None):
        return {n: {"gender": "Male", "sample_file": None, "sample_seconds": 0, "energy": "medium", "tone": ["warm"], "lines": 1} for n in ("Speaker 1", "Speaker 2")}
    monkeypatch.setattr(svc, "speaker_profiles", fake_profiles)

    async def fake_translate(segs, profiles, src, tgt, progress=None):
        return {s["id"]: f"line {s['id']}" for s in segs}
    monkeypatch.setattr(svc, "translate_lines", fake_translate)

    async def fake_render(jdir, media, is_video, total, segs, profiles, texts, target, modes, progress=None):
        (jdir / "dub.mp3").write_bytes(b"mp3")
        return {"files": {"audio": "dub.mp3", "speakers": {}}, "notes": [], "voices": {}, "texts": texts, "overruns": []}
    monkeypatch.setattr(svc, "render_dub", fake_render)

    wav = tmp_path / "in.wav"
    sf.write(str(wav), np.zeros(16000 * 6, dtype="float32"), 16000)
    c = TestClient(app)

    def wait(job_id, want):
        for _ in range(100):
            j = c.get(f"/api/dubbing/jobs/{job_id}").json()
            if j["status"] in want:
                return j
            time.sleep(0.1)
        raise AssertionError(j)

    try:
        r = c.post("/api/dubbing/jobs", files={"file": ("in.wav", wav.read_bytes(), "audio/wav")}, data={"source_language": "Auto-Detect"})
        assert r.status_code == 200, r.text
        jid = r.json()["job_id"]
        j = wait(jid, {"analyzed", "error"})
        assert j["status"] == "analyzed", j
        assert j["source_language"] == "Hindi" and len(j["segments"]) == 2 and "media_path" not in j

        assert c.post(f"/api/dubbing/jobs/{jid}/translate", json={"target_language": "Hindi"}).status_code == 400
        assert c.post(f"/api/dubbing/jobs/{jid}/translate", json={"target_language": "English"}).status_code == 200
        j = wait(jid, {"translated", "analyzed"})
        assert j["status"] == "translated" and j["translations"]["1"] == "line 1"

        assert c.post(f"/api/dubbing/jobs/{jid}/edit", json={"lines": {"1": "hello friends"}}).status_code == 200
        assert c.post(f"/api/dubbing/jobs/{jid}/render", json={}).status_code == 400  # needs consent
        assert c.post(f"/api/dubbing/jobs/{jid}/render", json={"consent": True}).status_code == 200
        j = wait(jid, {"done", "translated"})
        assert j["status"] == "done" and j["translations"]["1"] == "hello friends"
        assert c.get(f"/api/dubbing/jobs/{jid}/download/audio").content == b"mp3"

        app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="other", email="x@y.z")
        assert c.get(f"/api/dubbing/jobs/{jid}").status_code == 404  # someone else's job
    finally:
        app.dependency_overrides.clear()
