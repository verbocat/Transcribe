"""Dubbing Studio editor: the edit (tracks and clips) and how the mix follows it."""
import time
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app import dubbing_edit as ed
from app import dubbing_engines as eng
from app import dubbing_projects as dp
from app.auth_module.routes import get_current_user_from_token
from app.main import app


def _project(**kw):
    p = {"id": "p1", "is_video": True, "duration": 10.0, "stems": {"mode": "basic"},
         "segments": [{"id": 1, "speaker": "A", "start": 1.0, "end": 3.0, "shift": 0.0},
                      {"id": 2, "speaker": "B", "start": 4.0, "end": 6.0, "shift": 0.5}]}
    p.update(kw)
    return p


def test_seed_puts_media_and_every_line_on_its_track():
    e = ed.seed(_project())
    assert [t["id"] for t in e["tracks"]] == ["V1", "A1", "A2", "S:A", "S:B"]
    assert next(t for t in e["tracks"] if t["id"] == "A1")["mute"] is True  # original is a reference only
    lines = {c["line"]: c for c in e["clips"] if c["source"] == "line"}
    assert lines[1]["start"] == 1.0 and lines[2]["start"] == 4.5 and lines[2]["track"] == "S:B"
    assert {c["track"] for c in e["clips"] if c["source"] != "line"} == {"V1", "A1", "A2"}
    assert [t["id"] for t in ed.seed(_project(is_video=False, stems=None))["tracks"]] == ["A1", "S:A", "S:B"]


def test_reconcile_follows_line_changes_and_keeps_track_state():
    p = _project()
    e = ed.seed(p)
    clip = next(c for c in e["clips"] if c.get("line") == 1)
    clip["start"] = 2.0  # moved by hand in the editor: 1 s later than the line's own time
    next(t for t in e["tracks"] if t["id"] == "S:A")["mute"] = True
    p["segments"][0]["shift"] = 0.25           # shift slider moves the clip by the same amount
    p["segments"][1]["speaker"] = "A"          # speaker change moves the clip to that speaker's track
    p["segments"].append({"id": 3, "speaker": "C", "start": 7.0, "end": 8.0})
    e = ed.reconcile(p, e)
    lines = {c["line"]: c for c in e["clips"] if c["source"] == "line"}
    assert lines[1]["start"] == 2.25 and lines[2]["track"] == "S:A" and lines[3]["track"] == "S:C"
    assert [t["id"] for t in e["tracks"]] == ["V1", "A1", "A2", "S:A", "S:C"]
    assert next(t for t in e["tracks"] if t["id"] == "S:A")["mute"] is True
    p["segments"] = p["segments"][:1]
    assert [c["line"] for c in ed.reconcile(p, e)["clips"] if c["source"] == "line"] == [1]


def test_clean_clamps_and_rejects():
    p = _project()
    e = ed.seed(p)
    c = next(c for c in e["clips"] if c.get("line") == 1)
    c.update(start=-5, out=99, bogus=1)
    e["tracks"][0]["volume"] = 9
    got = ed.clean(p, e, {1: 2.0, 2: 1.5})
    c = next(c for c in got["clips"] if c.get("line") == 1)
    assert c["start"] == 0.0 and c["out"] == 2.0 and "bogus" not in c and got["tracks"][0]["volume"] == 2.0
    bad = ed.seed(p)
    next(c for c in bad["clips"] if c.get("line") == 1).update({"in": 1.0, "out": 1.0})
    with pytest.raises(ValueError):
        ed.clean(p, bad, {1: 2.0, 2: 1.5})
    with pytest.raises(ValueError):
        ed.clean(p, {"clips": "x"}, {})


def test_line_placements_trim_disable_mute_solo():
    p = _project()
    p["segments"][0]["gain"] = 0.5
    meta = {"1": {"file": "1.wav", "duration": 2.0}, "2": {"file": "2.wav", "duration": 1.5}}
    e = ed.seed(p)
    clip = next(c for c in e["clips"] if c.get("line") == 1)
    clip.update({"start": 1.2, "in": 0.5, "out": 1.5})
    next(t for t in e["tracks"] if t["id"] == "S:A")["volume"] = 2.0
    got = {l["id"]: l for l in ed.line_placements(p, e, meta)}
    assert got[1]["start"] == 1.2 and got[1]["offset"] == 0.5 and abs(got[1]["duration"] - 1.0) < 1e-9 and got[1]["gain"] == 1.0
    assert got[2]["start"] == 4.5 and got[2]["duration"] == 1.5
    clip["disabled"] = True
    assert [l["id"] for l in ed.line_placements(p, e, meta)] == [2]
    clip["disabled"] = False
    next(t for t in e["tracks"] if t["id"] == "S:B")["solo"] = True
    assert [l["id"] for l in ed.line_placements(p, e, meta)] == [2] and ed.audible(e)["A2"] is False
    p["segments"][1]["mute"] = True
    assert ed.line_placements(p, e, meta) == []


def test_edit_endpoints_and_mix_follow_the_edit(monkeypatch, tmp_path):
    monkeypatch.setattr(dp, "ROOT", tmp_path)
    pid = "ed1234"
    pdir = tmp_path / pid
    (pdir / "lines").mkdir(parents=True)
    for sid in (1, 2):
        sf.write(str(pdir / "lines" / f"{sid}.wav"), np.full(eng.SAMPLE_RATE * 2, 0.2, dtype="float32"), eng.SAMPLE_RATE)
    proj = {
        "id": pid, "owner": "u1", "filename": "clip.wav", "media_path": str(pdir / "source.wav"), "is_video": False,
        "duration": 10.0, "status": "ready", "stage": "speech", "percent": 100, "detail": "", "error": None,
        "source_language": "Hindi", "target_language": "English", "created": 0,
        "segments": [{"id": 1, "speaker": "A", "gender": "Male", "start": 1.0, "end": 3.0, "text": "x", "translation": "y"},
                     {"id": 2, "speaker": "B", "gender": "Male", "start": 5.0, "end": 7.0, "text": "x", "translation": "z"}],
        "speakers": {"A": {"voice": {"voice_id": "va"}}, "B": {"voice": {"voice_id": "vb"}}},
    }
    proj["lines"] = {str(s["id"]): {"file": f"{s['id']}.wav", "duration": 2.0, "rev": 1, "sig": dp._signature(proj, s)} for s in proj["segments"]}
    dp._projects[pid] = proj
    dp._save(proj)
    app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
    try:
        with TestClient(app) as c:
            j = c.get(f"/api/dubbing/projects/{pid}/edit").json()
            assert j["stored"] is False and "edit" not in c.get(f"/api/dubbing/projects/{pid}").json()
            e = j["edit"]
            for clip in e["clips"]:
                if clip.get("line") == 1:
                    clip.update({"start": 0.5, "in": 0.0, "out": 1.0})  # first second of line 1, moved earlier
                if clip.get("line") == 2:
                    clip["disabled"] = True
            j = c.put(f"/api/dubbing/projects/{pid}/edit", json={"edit": e}).json()
            assert j["stored"] is True
            bad = dict(e, clips=[dict(x, out=x["in"]) if x.get("line") == 1 else x for x in e["clips"]])
            assert c.put(f"/api/dubbing/projects/{pid}/edit", json={"edit": bad}).status_code == 400

            peaks = c.get(f"/api/dubbing/projects/{pid}/waveform/lines").json()["lines"]
            assert set(peaks) == {"1", "2"} and len(peaks["1"]["peaks"]) == 100 and peaks["1"]["rev"] == 1

            assert c.post(f"/api/dubbing/projects/{pid}/mix").status_code == 200
            for _ in range(200):
                j = c.get(f"/api/dubbing/projects/{pid}").json()
                if j["status"] not in dp.BUSY:
                    break
                time.sleep(0.05)
            assert j["outputs"]["audio"] == "dub.mp3" and set(j["outputs"]["speakers"]) == {"A"}, j
            mixed, sr = sf.read(str(pdir / "out" / "dub.mp3"))
            loud = np.flatnonzero(np.abs(mixed) > 0.05) / sr
            assert abs(loud.min() - 0.5) < 0.1 and abs(loud.max() - 1.5) < 0.1  # only the trimmed, moved clip plays

            assert c.delete(f"/api/dubbing/projects/{pid}/edit").json()["stored"] is False
    finally:
        app.dependency_overrides.clear()


def test_media_links_seeding_removed_lines_and_split_lines():
    p = _project()
    e = ed.seed(p)
    assert {c["link"] for c in e["clips"] if c["source"] != "line"} == {"m0"} and e["seeded"] == ["V1", "A1", "A2"]
    # an edit saved before linking existed gets its media linked and marked as seeded
    old = {"tracks": e["tracks"], "clips": [dict(c, link=None) if c["source"] != "line" else c for c in e["clips"]]}
    old.pop("seeded", None)
    assert all(c["link"] == "m0" for c in ed.reconcile(p, old)["clips"] if c["source"] != "line")
    # emptying a media track keeps it empty; the line removed on purpose is not put back; a cut line keeps both pieces
    l1 = next(c for c in e["clips"] if c.get("line") == 1)
    e["clips"] = [c for c in e["clips"] if c["track"] != "A2" and c.get("line") != 2] + [dict(l1, id="L1b", start=5.0, **{"in": 1.0})]
    e["removed_lines"] = [2, 99]
    got = ed.reconcile(p, e)
    assert not [c for c in got["clips"] if c["track"] == "A2"]
    assert [c["id"] for c in got["clips"] if c.get("line") == 1] == ["L1", "L1b"] and not [c for c in got["clips"] if c.get("line") == 2]
    assert got["removed_lines"] == [2]
    p["segments"][0]["shift"] = 0.5  # retiming the line moves both of its pieces
    assert [c["start"] for c in ed.reconcile(p, got)["clips"] if c.get("line") == 1] == [1.5, 5.5]


def test_media_placements_plan_and_sequence_end():
    p = _project()
    e = ed.seed(p)
    v = next(c for c in e["clips"] if c["id"] == "V1")
    assert ed.is_identity(ed.media_placements(p, e, "V1"), 10.0)
    v.update({"out": 4.0})
    e["clips"].append({"id": "V1b", "track": "V1", "source": "media", "start": 4.0, "in": 6.0, "out": 10.0, "disabled": False})
    e["clips"].append({"id": "V1c", "track": "V1", "source": "media", "start": 9.0, "in": 0.0, "out": 1.0, "disabled": True})
    pieces = ed.media_placements(p, e, "V1")
    assert pieces == [{"start": 0.0, "in": 0.0, "out": 4.0}, {"start": 4.0, "in": 6.0, "out": 10.0}] and not ed.is_identity(pieces, 10.0)
    assert ed.concat_plan(pieces, 9.0) == [("clip", 0.0, 4.0), ("clip", 6.0, 10.0), ("gap", 1.0)]
    assert ed.concat_plan([{"start": 2.0, "in": 0.0, "out": 1.0}], 3.0) == [("gap", 2.0), ("clip", 0.0, 1.0)]
    meta = {"1": {"file": "1.wav", "duration": 2.0}, "2": {"file": "2.wav", "duration": 1.5}}
    e["clips"] = [c for c in e["clips"] if c["source"] == "line" or c["id"] in ("V1", "V1b")]
    assert ed.sequence_end(p, e, meta) == 8.0  # video 0-8, lines end at 3.0 and 6.0


def test_mix_renders_cut_video_and_background(monkeypatch, tmp_path):
    import subprocess
    from app.video_processor import get_ffmpeg_path
    monkeypatch.setattr(dp, "ROOT", tmp_path)
    pid = "cut12345"
    pdir = tmp_path / pid
    (pdir / "lines").mkdir(parents=True)
    (pdir / "stems").mkdir()
    ff = get_ffmpeg_path()
    subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=6",
                    "-f", "lavfi", "-i", "sine=frequency=300:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", str(pdir / "source.mp4")], check=True)
    sf.write(str(pdir / "stems" / "background.wav"), np.full((44100 * 6, 2), 0.2, dtype="float32"), 44100)
    sf.write(str(pdir / "lines" / "1.wav"), np.full(eng.SAMPLE_RATE, 0.3, dtype="float32"), eng.SAMPLE_RATE)
    proj = {
        "id": pid, "owner": "u1", "filename": "clip.mp4", "media_path": str(pdir / "source.mp4"), "is_video": True,
        "duration": 6.0, "status": "ready", "stage": "speech", "percent": 100, "detail": "", "error": None,
        "source_language": "Hindi", "target_language": "English", "created": 0, "stems": {"mode": "basic"},
        "segments": [{"id": 1, "speaker": "A", "gender": "Male", "start": 0.5, "end": 1.5, "text": "x", "translation": "y"}],
        "speakers": {"A": {"voice": {"voice_id": "va"}}},
    }
    proj["lines"] = {"1": {"file": "1.wav", "duration": 1.0, "rev": 1, "sig": dp._signature(proj, proj["segments"][0])}}
    # ripple-deleted 2 s to 4 s on the video and background: 0-2 then 4-6 played back to back, so the edit is 4 s long
    e = ed.seed(proj)
    for c in list(e["clips"]):
        if c["source"] != "line":
            c["out"] = 2.0
            e["clips"].append(dict(c, id=c["id"] + "b", start=2.0, **{"in": 4.0, "out": 6.0}))
    proj["edit"] = e
    dp._projects[pid] = proj
    dp._save(proj)
    app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
    try:
        with TestClient(app) as c:
            assert c.post(f"/api/dubbing/projects/{pid}/mix").status_code == 200
            for _ in range(600):
                j = c.get(f"/api/dubbing/projects/{pid}").json()
                if j["status"] not in dp.BUSY:
                    break
                time.sleep(0.05)
            assert j["outputs"]["video"] == "dub.mp4" and j["outputs"]["length"] == 4.0, j
            mixed, sr = sf.read(str(pdir / "out" / "mixed.mp3"))
            assert abs(len(mixed) / sr - 4.0) < 0.15
            info = subprocess.run([ff, "-hide_banner", "-i", str(pdir / "out" / "dub.mp4")], capture_output=True, text=True).stderr
            import re
            h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", info).groups()
            assert abs(int(h) * 3600 + int(m) * 60 + float(s) - 4.0) < 0.2, info
    finally:
        app.dependency_overrides.clear()


# ------------------------------------------------------------------ step 3: levels
# The same numbers are checked in frontend/src/components/dubbing/editor/audioModel.test.mjs, so preview and render agree.
LEVEL_CLIP = {"in": 1.0, "gain": -6, "fade_in": 0.5, "fade_out": 1.0, "keyframes": [{"t": 1.5, "db": 0}, {"t": 2.5, "db": -12}]}
LEVEL_X = [0, 0.25, 0.5, 1.0, 1.5, 2.5, 2.9]
LEVEL_EXPECTED = [0.0, 0.354393, 0.501187, 0.251189, 0.125893, 0.089019, 0.019694]


def test_clip_gain_and_duck_points_reference_values():
    assert np.allclose(ed.clip_gain(LEVEL_CLIP, LEVEL_X, 3.0), LEVEL_EXPECTED, atol=1e-6)
    xs, ys = ed.duck_points([(1, 2), (2.5, 4), (8, 9)], {"amount": -12, "attack": 0.25, "release": 0.5})
    assert xs == [0.75, 1, 4, 4.5, 7.75, 8, 9, 9.5] and ys == [0, -12, -12, 0, 0, -12, -12, 0]


def test_clean_keeps_levels_duck_and_master():
    p = _project()
    e = ed.seed(p)
    c = next(c for c in e["clips"] if c["id"] == "A2")
    c.update(gain=-99, fade_in=0.5, keyframes=[{"t": 5, "db": 3}, {"t": 2, "db": -6}, "junk"])
    next(t for t in e["tracks"] if t["id"] == "A2")["duck"] = {"on": True, "amount": -80, "attack": 0.2}
    e["master"] = {"volume": 0.5}
    got = ed.clean(p, e, {1: 2.0, 2: 1.5})
    c = next(c for c in got["clips"] if c["id"] == "A2")
    assert c["gain"] == -60 and c["fade_in"] == 0.5 and [k["t"] for k in c["keyframes"]] == [2, 5]
    assert next(t for t in got["tracks"] if t["id"] == "A2")["duck"] == {"on": True, "amount": -40, "attack": 0.2, "release": 0.5}
    assert got["master"] == {"volume": 0.5}
    assert ed.track_gain_fn(p, ed.seed(p), "A2", {}) is None  # untouched track: no gain pass needed


def test_mix_applies_ducking_clip_levels_and_master(monkeypatch, tmp_path):
    monkeypatch.setattr(dp, "ROOT", tmp_path)
    pid = "lvl12345"
    pdir = tmp_path / pid
    (pdir / "lines").mkdir(parents=True)
    (pdir / "stems").mkdir()
    sf.write(str(pdir / "source.wav"), np.zeros(44100 * 6, dtype="float32"), 44100)
    sf.write(str(pdir / "stems" / "background.wav"), np.full((44100 * 6, 2), 0.2, dtype="float32"), 44100)
    sf.write(str(pdir / "lines" / "1.wav"), np.zeros(eng.SAMPLE_RATE * 2, dtype="float32"), eng.SAMPLE_RATE)  # silent line: only its timing matters
    proj = {
        "id": pid, "owner": "u1", "filename": "a.wav", "media_path": str(pdir / "source.wav"), "is_video": False,
        "duration": 6.0, "status": "ready", "stage": "speech", "percent": 100, "detail": "", "error": None,
        "source_language": "Hindi", "target_language": "English", "created": 0, "stems": {"mode": "basic"},
        "segments": [{"id": 1, "speaker": "A", "gender": "Male", "start": 1.0, "end": 3.0, "text": "x", "translation": "y"}],
        "speakers": {"A": {"voice": {"voice_id": "va"}}},
    }
    proj["lines"] = {"1": {"file": "1.wav", "duration": 2.0, "rev": 1, "sig": dp._signature(proj, proj["segments"][0])}}
    e = ed.seed(proj)
    next(t for t in e["tracks"] if t["id"] == "A2")["duck"] = {"on": True, "amount": -12, "attack": 0.2, "release": 0.2}
    next(c for c in e["clips"] if c["id"] == "A2")["fade_out"] = 1.0
    e["master"] = {"volume": 0.5}
    proj["edit"] = e
    dp._projects[pid] = proj
    dp._save(proj)
    app.dependency_overrides[get_current_user_from_token] = lambda: SimpleNamespace(id="u1", email="a@b.c")
    try:
        with TestClient(app) as c:
            assert c.post(f"/api/dubbing/projects/{pid}/mix").status_code == 200
            for _ in range(400):
                j = c.get(f"/api/dubbing/projects/{pid}").json()
                if j["status"] not in dp.BUSY:
                    break
                time.sleep(0.05)
            assert j["outputs"].get("mixed") == "mixed.mp3", j
            mixed, sr = sf.read(str(pdir / "out" / "mixed.mp3"))
            level = lambda a, b: float(np.median(np.abs(mixed[int(a * sr):int(b * sr), 0])))
            assert abs(level(3.6, 4.4) - 0.1) < 0.015      # master 0.5 on a 0.2 background
            assert abs(level(1.5, 2.5) - 0.1 * 0.2512) < 0.01  # ducked by 12 dB under the line
            assert level(5.6, 5.9) < 0.04                    # fading out over the last second
            assert not list((pdir / "out").glob("background_*.wav")) and not (pdir / "out" / "dub_exact.wav").exists()
    finally:
        app.dependency_overrides.clear()
