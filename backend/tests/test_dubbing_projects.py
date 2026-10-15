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


def test_speech_per_line_controls_and_mix(monkeypatch, tmp_path):
    import subprocess
    from app.video_processor import get_ffmpeg_path
    monkeypatch.setattr(dp, "ROOT", tmp_path)
    monkeypatch.setattr(dp, "get_elevenlabs_api_key", lambda: "k")
    spoken = []

    async def fake_speak(client, voice_id, text, settings, sem):
        spoken.append((voice_id, text, settings))
        out = tmp_path / f"t{len(spoken)}.mp3"
        subprocess.run([get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=300:duration={len(text) * 0.1}", str(out)], check=True)
        return out.read_bytes()
    monkeypatch.setattr(eng, "speak", fake_speak)

    pid = "abc123"
    (tmp_path / pid).mkdir()
    proj = {
        "id": pid, "owner": "u1", "filename": "clip.wav", "media_path": str(tmp_path / pid / "source.wav"), "is_video": False,
        "duration": 10.0, "status": "ready", "stage": "translated", "percent": 100, "detail": "", "error": None,
        "source_language": "Hindi", "target_language": "English", "created": 0,
        "segments": [
            {"id": 1, "speaker": "A", "gender": "Male", "start": 0.5, "end": 3.0, "text": "x", "translation": "y" * 20},  # 2.0 s fits
            {"id": 2, "speaker": "B", "gender": "Female", "start": 4.0, "end": 6.0, "text": "x", "translation": "z" * 30},  # 3.0 s, slot 2 s
            {"id": 3, "speaker": "B", "gender": "Female", "start": 7.0, "end": 8.0, "text": "x", "translation": ""},  # nothing to say
        ],
        "speakers": {"A": {"voice": {"mode": "stock", "voice_id": "va"}, "energy": "medium"}, "B": {"voice": {"mode": "stock", "voice_id": "vb"}, "energy": "high"}},
    }
    dp._projects[pid] = proj
    dp._save(proj)
    app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
    try:
        with TestClient(app) as c:
            def wait():
                for _ in range(200):
                    j = c.get(f"/api/dubbing/projects/{pid}").json()
                    if j["status"] not in dp.BUSY:
                        return j
                    time.sleep(0.05)
                raise AssertionError(j)

            assert c.put(f"/api/dubbing/projects/{pid}/speakers/B/tts", json={"stability": 0.9, "pitch": 99, "bogus": 1}).json()["speakers"]["B"]["tts"] == {"stability": 0.9, "pitch": 6.0}
            assert c.post(f"/api/dubbing/projects/{pid}/speak", json={}).status_code == 200
            j = wait()
            a, b, n = j["segments"]
            assert a["audio"]["ready"] and not a["audio"]["stale"] and a["audio"]["tempo"] == 1.0
            assert b["audio"]["tempo"] > 1.3 and abs(b["audio"]["duration"] - 3.0 / b["audio"]["tempo"]) < 0.2  # sped up to fit
            assert not n["audio"]["ready"]
            assert spoken[0][2]["stability"] == 0.45 and any(s[2]["stability"] == 0.9 for s in spoken)  # speaker control reached the engine
            assert c.get(f"/api/dubbing/projects/{pid}/lines/1/audio").status_code == 200

            # editing a line's text makes only that line stale; regenerating stale lines speaks just that one
            segs = j["segments"]
            rows = [dict(s, translation="w" * 10 if s["id"] == 1 else s["translation"]) for s in segs]
            j = c.put(f"/api/dubbing/projects/{pid}/segments", json={"segments": rows}).json()
            assert [s["audio"].get("stale") for s in j["segments"][:2]] == [True, False]
            before = len(spoken)
            c.post(f"/api/dubbing/projects/{pid}/speak", json={"only_stale": True}); wait()
            assert len(spoken) == before + 1

            # mute line 2 -> it is missing from the mix; the speaker file for B then has no speech
            rows = [dict(s, mute=s["id"] == 2) for s in wait()["segments"]]
            c.put(f"/api/dubbing/projects/{pid}/segments", json={"segments": rows})
            assert c.post(f"/api/dubbing/projects/{pid}/mix").status_code == 200
            j = wait()
            assert j["outputs"]["audio"] == "dub.mp3" and set(j["outputs"]["speakers"]) == {"A"}
            assert c.get(f"/api/dubbing/projects/{pid}/download/audio").status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_background_separation_basic_and_mix_with_background(tmp_path):
    import asyncio
    from app import dubbing_stems as stems
    t = np.arange(44100 * 3) / 44100
    left = 0.3 * np.sin(2 * np.pi * 220 * t) + 0.3 * np.sin(2 * np.pi * 440 * t)   # centred "voice" (440) + side "music" (220)
    right = 0.3 * np.sin(2 * np.pi * 330 * t) + 0.3 * np.sin(2 * np.pi * 440 * t)
    src = tmp_path / "in.wav"
    sf.write(str(src), np.stack([left, right], 1).astype("float32"), 44100)
    out = tmp_path / "stems"
    asyncio.run(stems.separate(str(src), out, "basic"))
    bg, sr = sf.read(str(out / "background.wav"))
    spec = np.abs(np.fft.rfft(bg[:, 0]))
    freqs = np.fft.rfftfreq(len(bg), 1 / sr)
    assert spec[np.argmin(abs(freqs - 440))] < 0.05 * spec[np.argmin(abs(freqs - 220))]  # centred voice removed, side music kept
    assert (out / "background.mp3").exists() and (out / "vocals.mp3").exists()

    dub = tmp_path / "dub.wav"
    sf.write(str(dub), np.zeros(24000 * 3, dtype="float32") + 0.1, 24000)
    stems.mix_with_background(str(out / "background.wav"), str(dub), 0.5, str(tmp_path / "mixed.mp3"))
    mixed, sr2 = sf.read(str(tmp_path / "mixed.mp3"))
    assert abs(len(mixed) / sr2 - 3.0) < 0.3 and np.abs(mixed).max() > 0.05
