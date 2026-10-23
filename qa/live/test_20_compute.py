"""Compute: POSTs that only transform the request body. Tiny synthetic payloads, no stored data."""
import io
import zipfile

import pytest

from conftest import expect

pytestmark = pytest.mark.compute

SEGMENTS = [
    {"segment_id": 1, "speaker": "Speaker 1", "gender": "Male", "start_time": 0.0, "end_time": 2.5,
     "duration": 2.5, "transcript": "QA live check line one."},
    {"segment_id": 2, "speaker": "Speaker 2", "gender": "Female", "start_time": 2.6, "end_time": 5.0,
     "duration": 2.4, "transcript": "QA live check line two."},
]
RESULT = {"audio_id": "qa_live", "filename": "qa_live_check.wav", "language": "English",
          "script": "Latin", "segments": SEGMENTS}
EVENTS = [
    {"id": 1, "start_time": 0.0, "end_time": 2.0, "text": "This is a QA subtitle line."},
    {"id": 2, "start_time": 2.2, "end_time": 4.5, "text": "And a second, slightly longer line for line-break checks."},
]


def test_validate_password_policy(api):
    weak = api.post("/api/auth/validate-password", json={"password": "abc"})
    expect(weak, 200)
    strong = api.post("/api/auth/validate-password", json={"password": "Qa-Live-Check-2026!"})
    expect(strong, 200)
    assert weak.json() != strong.json(), "policy check returns the same verdict for weak and strong passwords"


def test_lint_segments(api):
    r = api.post("/api/lint", json={"segments": SEGMENTS, "language": "English", "script": "Latin"})
    expect(r, 200)
    assert isinstance(r.json(), dict), "lint did not return a JSON object"


def test_autofix_segments(api):
    r = api.post("/api/autofix", json={"segments": SEGMENTS, "language": "English", "script": "Latin"})
    expect(r, 200)


def test_export_csv(api):
    r = api.post("/api/export", query={"format": "csv"}, json=RESULT)
    expect(r, 200)
    assert "text/csv" in r.headers.get("content-type", ""), f"content-type is {r.headers.get('content-type')}"
    assert "QA live check line one." in r.text, "exported CSV does not contain the segment text"


def test_export_multi_zip(api):
    r = api.post("/api/export/multi", json={"result": RESULT, "formats": ["csv", "srt"]})
    expect(r, 200)
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert any(n.endswith(".csv") for n in names) and any(n.endswith(".srt") for n in names), f"zip holds {names}"


def test_subtitle_lint(api):
    expect(api.post("/api/subtitle/lint", json={"events": EVENTS, "frame_rate": 24.0}), 200)


def test_subtitle_autofix(api):
    r = api.post("/api/subtitle/autofix", json={"events": EVENTS, "frame_rate": 24.0})
    expect(r, 200)
    assert isinstance(r.json().get("events"), list), "autofix returned no events list"


def test_subtitle_rebreak(api):
    r = api.post("/api/subtitle/rebreak", json={"events": [dict(e) for e in EVENTS], "max_cpl": 20})
    expect(r, 200)
    assert len(r.json().get("events", [])) == len(EVENTS), "rebreak changed the number of events"


def test_subtitle_qc_local(api):
    r = api.post("/api/subtitle/qc", json={"cues": EVENTS, "target_lang": "en"})
    expect(r, 200)


def test_subtitle_qc_requires_cues(api):
    expect(api.post("/api/subtitle/qc", json={"cues": []}), 400)


@pytest.mark.parametrize("fmt,marker", [("srt", "-->"), ("vtt", "WEBVTT"), ("txt", "QA subtitle")])
def test_subtitle_export(api, fmt, marker):
    r = api.post("/api/subtitle/export", json={"events": EVENTS, "format": fmt, "filename": "qa_live"})
    expect(r, 200)
    assert marker in r.text, f"{fmt} export does not contain {marker!r}"


def test_subtitle_export_bad_format(api):
    expect(api.post("/api/subtitle/export", json={"events": EVENTS, "format": "qa-bogus"}), 400)
