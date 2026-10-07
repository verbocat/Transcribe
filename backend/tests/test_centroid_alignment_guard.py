"""A translated language is only loaded as a track when it lines up with the source cue for cue."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.centroid_client import drop_misaligned_translations

SOURCE = [
    {"start": 216.98, "end": 219.99, "text": "We used elements\nfrom the old battle caves,"},
    {"start": 220.07, "end": 221.12, "text": "and we've taken a lot"},
    {"start": 221.2, "end": 225.0, "text": "of inspiration from the mini-creatures'\nconstruction techniques."},
]


def _result(cues):
    return {"results": {"hi": {"cues": cues, "srt": ""}}, "errors": {}}


def test_aligned_translation_is_kept():
    data = _result([{"start": c["start"], "end": c["end"], "target": "x"} for c in SOURCE])
    drop_misaligned_translations(data, SOURCE)
    assert "hi" in data["results"] and data["errors"] == {}


def test_missing_cue_is_reported_instead_of_loaded():
    data = _result([{"start": c["start"], "end": c["end"], "target": "x"} for c in SOURCE[:2]])
    drop_misaligned_translations(data, SOURCE)
    assert data["results"] == {}
    assert "2 subtitles for 3" in data["errors"]["hi"]


def test_changed_timing_is_reported_instead_of_loaded():
    cues = [{"start": c["start"], "end": c["end"], "target": "x"} for c in SOURCE]
    cues[1]["start"] = 220.5
    data = _result(cues)
    drop_misaligned_translations(data, SOURCE)
    assert data["results"] == {} and "hi" in data["errors"]
