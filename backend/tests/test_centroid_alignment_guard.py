"""A translation that does not line up with the source is still loaded, with an error on the affected subtitles."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.centroid_client import align_translations

SOURCE = [
    {"start": 216.98, "end": 219.99, "text": "We used elements\nfrom the old battle caves,"},
    {"start": 220.07, "end": 221.12, "text": "and we've taken a lot"},
    {"start": 221.2, "end": 225.0, "text": "of inspiration from the mini-creatures'\nconstruction techniques."},
]


def _cue(i, target, **kw):
    s = SOURCE[i]
    return {"index": i + 1, "start": s["start"], "end": s["end"], "source": s["text"], "target": target, **kw}


def _data(cues):
    return {"results": {"hi": {"cues": cues, "srt": "orig", "warnings": []}}, "errors": {}}


def test_aligned_translation_is_untouched():
    data = _data([_cue(0, "a"), _cue(1, "b"), _cue(2, "c")])
    align_translations(data, SOURCE)
    assert data["results"]["hi"]["srt"] == "orig" and "align" not in data["results"]["hi"]


def test_missing_cue_is_loaded_with_an_error_on_that_subtitle_only():
    data = _data([_cue(0, "a"), _cue(2, "c")])
    align_translations(data, SOURCE)
    cues = data["results"]["hi"]["cues"]
    assert [c["target"] for c in cues] == ["a", "", "c"]
    assert [bool(c.get("align_error")) for c in cues] == [False, True, False]
    assert cues[1]["source"] == SOURCE[1]["text"] and cues[2]["index"] == 3
    assert data["errors"] == {}
    assert [w["index"] for w in data["results"]["hi"]["warnings"]] == [2]
    srt = data["results"]["hi"]["srt"]
    assert srt.count("-->") == 3 and "and we've taken a lot" in srt  # original text stands in for the missing one


def test_shifted_text_keeps_each_translation_on_its_own_timing():
    # extra cue at the wrong time, plus a real cue 2 translation: the stray one is dropped, nothing shifts
    stray = {"index": 9, "start": 300.0, "end": 301.0, "source": "x", "target": "stray"}
    data = _data([_cue(0, "a"), stray, _cue(1, "b"), _cue(2, "c")])
    align_translations(data, SOURCE)
    res = data["results"]["hi"]
    assert [c["target"] for c in res["cues"]] == ["a", "b", "c"]
    assert res["align"]["unmatched_extra"] == 1 and res["align"]["flagged"] == 0


def test_changed_timing_flags_that_subtitle():
    changed = _cue(1, "b")
    changed["start"] = 220.5
    data = _data([_cue(0, "a"), changed, _cue(2, "c")])
    align_translations(data, SOURCE)
    cues = data["results"]["hi"]["cues"]
    assert cues[1].get("align_error") and not cues[0].get("align_error") and not cues[2].get("align_error")
