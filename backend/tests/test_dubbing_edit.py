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
