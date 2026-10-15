"""Dubbing Studio project editor: transcript, speakers, voices and translation stages (providers faked)."""
import time
from types import SimpleNamespace

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import dubbing_engines as eng
from app import dubbing_projects as dp
from app.auth_module.routes import get_current_user_from_token
from app.main import app


class FakeMeter:
    closed = None
    def __init__(self, *a, **k): FakeMeter.closed = None
    def reserve(self): return self
    def finish(self, charge, note=None): FakeMeter.closed = charge
    def on_error(self, exc): pass
    def note_stage(self, s): pass


def test_project_stages(monkeypatch, tmp_path):
    monkeypatch.setattr(dp, "ROOT", tmp_path)
    monkeypatch.setattr(dp, "get_elevenlabs_api_key", lambda: "k")
    monkeypatch.setattr(dp.metering, "Metered", FakeMeter)

    async def probe(path): return 8000
    monkeypatch.setattr(dp.metering, "probe_duration_ms", probe)

    async def fake_process(audio_path, language, script, video_path=None, progress_cb=None):
        seg = lambda t, s, e, sp: SimpleNamespace(speaker=sp, gender="Male", start_time=s, end_time=e, transcript=t)
        return SimpleNamespace(language="Hindi", segments=[seg("नमस्ते", 0.2, 2.0, "Speaker 1"), seg("कैसे हो", 2.5, 4.0, "Speaker 2")])
    import app.scribe_transcriber as st
    monkeypatch.setattr(st, "process_audio_file", fake_process)

    async def fake_profiles(media, segs, lang, pdir, progress=None):
        return {n: {"gender": "Male", "tone": ["warm"], "energy": "medium", "sample_file": None, "sample_seconds": 0}
                for n in sorted({s["speaker"] for s in segs})}
    monkeypatch.setattr(eng, "speaker_profiles", fake_profiles)

    async def fake_stock(client): return {"male": [{"id": "m1", "age": ""}, {"id": "m2", "age": ""}], "female": [{"id": "f1", "age": ""}]}
    monkeypatch.setattr(eng, "list_stock_voices", fake_stock)

    async def fake_translate(segs, speakers, src, tgt, progress=None):
        return {s["id"]: f"{tgt}:{s['text']}" for s in segs}
    monkeypatch.setattr(eng, "translate_lines", fake_translate)

    wav = tmp_path / "in.wav"
    sf.write(str(wav), np.zeros(16000 * 8, dtype="float32"), 16000)
    app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
    try:
        with TestClient(app) as c:
            def wait(pid):
                for _ in range(100):
                    j = c.get(f"/api/dubbing/projects/{pid}").json()
                    if j["status"] not in dp.BUSY:
                        return j
                    time.sleep(0.05)
                raise AssertionError(j)

            pid = c.post("/api/dubbing/projects", files={"file": ("in.wav", wav.read_bytes(), "audio/wav")}).json()["id"]
            j = wait(pid)
            assert j["status"] == "ready" and len(j["segments"]) == 2 and "media_path" not in j, j
            assert FakeMeter.closed is True
            assert j["speakers"]["Speaker 1"]["voice"]["voice_id"] != j["speakers"]["Speaker 2"]["voice"]["voice_id"]

            # edit: change text, move the second line to a new speaker, split the first line
            segs = j["segments"]
            edited = [
                {"id": segs[0]["id"], "speaker": "Speaker 1", "start": 0.2, "end": 1.0, "text": "नमस्ते"},
                {"speaker": "Speaker 1", "start": 1.0, "end": 2.0, "text": "दोस्तों"},
                {"id": segs[1]["id"], "speaker": "Narrator", "start": 2.5, "end": 4.0, "text": "कैसे हो"},
            ]
            j = c.put(f"/api/dubbing/projects/{pid}/segments", json={"segments": edited}).json()
            assert [s["text"] for s in j["segments"]] == ["नमस्ते", "दोस्तों", "कैसे हो"]
            assert len({s["id"] for s in j["segments"]}) == 3 and set(j["speakers"]) == {"Speaker 1", "Narrator"}
            assert c.put(f"/api/dubbing/projects/{pid}/segments", json={"segments": [{"speaker": "x", "start": 5, "end": 4, "text": "a"}]}).status_code == 400

            assert c.put(f"/api/dubbing/projects/{pid}/speakers/Narrator/voice", json={"voice_id": "f1", "voice_name": "Rachel"}).json()["speakers"]["Narrator"]["voice"]["voice_id"] == "f1"
            assert c.post(f"/api/dubbing/projects/{pid}/speakers/Narrator/clone").status_code == 400  # no usable sample

            assert c.post(f"/api/dubbing/projects/{pid}/translate", json={"target_language": "Hindi"}).status_code == 400
            assert c.post(f"/api/dubbing/projects/{pid}/translate", json={"target_language": "English", "ids": [j["segments"][0]["id"]]}).status_code == 200
            j = wait(pid)
            assert j["segments"][0]["translation"] == "English:नमस्ते" and j["segments"][1]["translation"] == ""

            app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="other", email="x@y.z")
            assert c.get(f"/api/dubbing/projects/{pid}").status_code == 404
            app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
            assert c.delete(f"/api/dubbing/projects/{pid}").status_code == 200
    finally:
        app.dependency_overrides.clear()
