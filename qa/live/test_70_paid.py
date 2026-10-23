"""Paid media flows (opt-in, -m paid): upload a 21 s synthetic English clip and run every
transcription, subtitle, translation and dubbing step on it with the test account.

Costs: each AI step spends roughly 21 s of the test account's minutes and a little Gemini /
ElevenLabs / Centroid credit. Everything the tests create is deleted at the end: the uploaded
files (cleanup / discard), the saved projects (DELETE), the dubbing project (which also deletes
any cloned ElevenLabs voice) and the quick-dub job.

Several routes have no login check in the GitHub code (save / delete project, cleanup, discard,
cancel); production requires one. Either way they are only ever called on ids this module created.
"""
import io
import json
import struct
import time
import zlib
from pathlib import Path

import pytest

from cleanup_qa import TAG, cleanup
from conftest import expect

pytestmark = pytest.mark.paid

CLIP = Path(__file__).parent / "fixtures" / "qa_live_7f3c9e1a_clip.wav"
SLOW = 240  # seconds, for synchronous AI calls


@pytest.fixture(scope="module", autouse=True)
def _sweep(client, session_user):
    """Production saves projects under its own ids, so finish with a sweep for anything tagged."""
    yield
    cleanup(client)


def _find_project(client, list_path, tries=6):
    # project lists are cached for ~10 s on the server
    for _ in range(tries):
        hits = [p for p in client.get(list_path).json().get("projects", []) if TAG in str(p.get("filename", ""))]
        if hits:
            return hits[0]
        time.sleep(3)
    return None


def _file(name=CLIP.name):
    return {"file": (name, CLIP.read_bytes(), "audio/wav")}


def _events_from(segments):
    return [{"id": i + 1, "start_time": s["start_time"], "end_time": s["end_time"],
             "text": s.get("transcript") or s.get("text") or ""} for i, s in enumerate(segments)]


# ── transcription studio ─────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def audio(client, session_user):
    r = client.request("POST", "/api/upload", files=_file(), write=True, timeout=120)
    expect(r, 200)
    body = r.json()
    yield body
    client.request("DELETE", "/api/projects/{project_id}", params={"project_id": body["audio_id"]}, write=True)
    client.request("DELETE", "/api/cleanup/{audio_id}", params={"audio_id": body["audio_id"]}, write=True)


@pytest.fixture(scope="module")
def transcript(client, audio):
    r = client.request("POST", "/api/transcribe_async", write=True, timeout=60,
                       data={"audio_id": audio["audio_id"], "language": "English", "script": "Latin"})
    expect(r, 200)
    job = r.json()["job_id"]
    done = client.poll("/api/transcribe_status/{job_id}", lambda j: j.get("stage") in ("done", "error", "cancelled"),
                       params={"job_id": job}, timeout=SLOW)
    expect(done, 200)
    state = done.json()
    assert state.get("stage") == "done", f"transcription ended as {state.get('stage')}: {state.get('error')}"
    return state["result"]


def test_upload_returns_audio_id(audio):
    assert audio.get("audio_id") and not audio.get("is_rejected"), f"upload response: {audio}"


def test_audio_stream_own_file(client, audio):
    r = client.get("/api/audio/{filename}", params={"filename": audio["audio_id"]}, stream=True)
    expect(r, 200)
    r.close()


def test_transcribe_async(transcript):
    text = " ".join(s.get("transcript", "") for s in transcript.get("segments", [])).lower()
    assert transcript.get("segments"), "transcription returned no segments"
    assert "quality" in text or "noun" in text or "weather" in text, f"transcript does not match the clip: {text[:120]!r}"


def test_transcribe_sync(client, audio):
    r = client.request("POST", "/api/transcribe", write=True, timeout=SLOW,
                       data={"audio_id": audio["audio_id"], "language": "English", "script": "Latin"})
    expect(r, 200)
    result = r.json()
    # the sync call saves its own project under a new id: remove it
    if result.get("audio_id") and result["audio_id"] != audio["audio_id"]:
        client.request("DELETE", "/api/projects/{project_id}", params={"project_id": result["audio_id"]}, write=True)
        client.request("DELETE", "/api/cleanup/{audio_id}", params={"audio_id": result["audio_id"]}, write=True)
    assert result.get("segments"), "sync transcription returned no segments"


def test_saved_project_readable(client, audio, transcript):
    found = _find_project(client, "/api/projects")
    assert found, "the finished transcription was not saved as a project"
    expect(client.get("/api/projects/{project_id}", params={"project_id": found["id"]}), 200)


def test_project_save_open_delete(client, transcript):
    r = client.request("POST", "/api/projects/save", json=transcript, write=True)
    expect(r, 200)
    body = r.json()
    assert body.get("status") == "success" and body.get("project_id"), f"save response: {body}"
    pid = {"project_id": body["project_id"]}
    expect(client.get("/api/projects/{project_id}", params=pid), 200)
    expect(client.request("DELETE", "/api/projects/{project_id}", params=pid, write=True), 200)
    expect(client.get("/api/projects/{project_id}", params=pid), 404)


def test_speakers_refine(client, transcript):
    r = client.request("POST", "/api/speakers/refine", write=True, timeout=SLOW,
                       json={"segments": transcript["segments"], "language": "English"})
    expect(r, 200)


def test_export_dubbing_script(client, transcript):
    r = client.request("POST", "/api/export/dubbing", write=True, json={"result": transcript, "speaker_map": {}})
    expect(r, 200)
    assert r.content[:2] == b"PK", "dubbing script is not an .xlsx file"


def test_audio_extract_sync(client):
    r = client.request("POST", "/api/audio/extract", files=_file(), write=True, timeout=SLOW)
    expect(r, 200)


def test_audio_extract_async_and_cancel(client):
    r = client.request("POST", "/api/audio/extract_async", files=_file(), write=True, timeout=120)
    expect(r, 200)
    job = r.json()["job_id"]
    done = client.poll("/api/audio/extract_status/{job_id}",
                       lambda j: j.get("stage") in ("done", "error", "cancelled"), params={"job_id": job})
    expect(done, 200)
    assert done.json().get("stage") == "done", f"extract ended as {done.json()}"
    # cancelling a finished job must not error
    expect(client.request("POST", "/api/jobs/{job_id}/cancel", params={"job_id": job}, write=True), 200, 404)


def test_cleanup_unknown_audio(client):
    r = client.request("DELETE", "/api/cleanup/{audio_id}", params={"audio_id": "qa-live-nonexistent-7f3c9e1a"},
                       write=True)
    expect(r, 200)
    assert r.json().get("status") == "not_found", f"cleanup of an unknown id said {r.json()}"


# ── subtitle studio ──────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def video(client, session_user):
    r = client.request("POST", "/api/subtitle/upload", files=_file(), write=True, timeout=180)
    expect(r, 200)
    body = r.json()
    yield body
    client.request("DELETE", "/api/subtitle/projects/{project_id}", params={"project_id": body["video_id"]},
                   write=True)
    client.request("POST", "/api/subtitle/discard", json={"video_id": body["video_id"]}, write=True)


@pytest.fixture(scope="module")
def subs(client, video):
    r = client.request("POST", "/api/subtitle/generate", write=True, timeout=SLOW,
                       json={"video_id": video["video_id"], "language": "en"})
    expect(r, 200)
    events = r.json().get("events") or []
    assert events, f"subtitle generation returned no events: {str(r.json())[:200]}"
    return events


def test_subtitle_upload(video):
    assert video.get("video_id"), f"upload response: {video}"


def test_subtitle_video_stream_own_file(client, video):
    r = client.get("/api/subtitle/video/{filename}", params={"filename": video["filename"]},
                   headers={"Range": "bytes=0-1023"}, stream=True)
    expect(r, 200, 206)
    r.close()


def test_subtitle_waveform(client, video):
    r = client.get("/api/subtitle/waveform/{video_id}", params={"video_id": video["video_id"]}, timeout=120)
    expect(r, 200)
    assert r.json().get("peaks"), "waveform has no peaks"


def test_probe_media(client):
    expect(client.request("POST", "/api/subtitle/probe_media", files=_file(), write=True, timeout=120), 200)


def test_upload_chunk_and_abort(client):
    uid = "qa_live_7f3c9e1a_chunked"
    data = CLIP.read_bytes()
    half = len(data) // 2
    r = client.request("POST", "/api/subtitle/upload_chunk", write=True, timeout=120,
                       files={"chunk": ("blob", data[:half], "application/octet-stream")},
                       data={"upload_id": uid, "chunk_index": 0, "total_chunks": 2, "filename": CLIP.name})
    expect(r, 200)
    # abandon the upload before the second chunk
    expect(client.request("DELETE", "/api/subtitle/upload_chunk/{upload_id}", params={"upload_id": uid},
                          write=True), 200)


def test_subtitle_generate(subs):
    text = " ".join(e.get("text", "") for e in subs).lower()
    assert "quality" in text or "weather" in text or "noun" in text, f"subtitles do not match the clip: {text[:120]!r}"


def test_subtitle_generate_stream(client, video):
    r = client.request("POST", "/api/subtitle/generate_stream", write=True, timeout=SLOW, stream=True,
                       json={"video_id": video["video_id"], "language": "en"})
    expect(r, 200)
    body = r.content.decode("utf-8", "replace")
    assert body.strip(), "stream returned nothing"
    assert "error" not in body[-300:].lower() or "events" in body, f"stream ended with an error: {body[-200:]}"


def test_context_autofill(client, subs):
    expect(client.request("POST", "/api/subtitle/context_autofill", write=True, timeout=SLOW,
                          json={"events": subs, "language": "en"}), 200)


def test_context_polish(client, subs):
    expect(client.request("POST", "/api/subtitle/context_polish", write=True, timeout=SLOW,
                          json={"events": subs, "context": {}, "glossary": ["Noun"]}), 200)


def test_gemini_fix(client, video, subs):
    expect(client.request("POST", "/api/subtitle/gemini_fix", write=True, timeout=SLOW,
                          json={"video_id": video["video_id"], "events": subs}), 200)


def test_acoustic_sync(client, video, subs):
    expect(client.request("POST", "/api/subtitle/acoustic_sync", write=True, timeout=SLOW,
                          json={"video_id": video["video_id"], "events": subs, "language": "en"}), 200)


def test_extract_glossary_file(client):
    terms = "Noun\nVerboLabs\nSubtitle Studio\n".encode()
    r = client.request("POST", "/api/subtitle/extract_glossary_file", write=True, timeout=SLOW,
                       files={"file": ("qa_live_glossary.txt", terms, "text/plain")})
    expect(r, 200)


def test_centroid_translate(client, subs):
    r = client.request("POST", "/api/centroid/translate", write=True, timeout=SLOW,
                       json={"events": subs, "source_lang": "en", "target_langs": ["hi"]})
    expect(r, 200)


def test_centroid_analyze(client, subs):
    expect(client.request("POST", "/api/centroid/analyze", write=True, timeout=SLOW,
                          json={"events": subs, "source_lang": "en", "target_langs": ["hi"]}), 200)


def test_centroid_qc(client, subs):
    expect(client.request("POST", "/api/centroid/qc", write=True, timeout=SLOW,
                          json={"cues": subs, "target_lang": "en", "source_lang": "en"}), 200)


def test_subtitle_project_save_open_delete(client, video, subs):
    r = client.request("POST", "/api/subtitle/projects/save", write=True,
                       json={"project": {"video_id": video["video_id"], "filename": video["filename"], "events": subs}})
    expect(r, 200)
    assert r.json().get("project_id"), f"save response: {r.json()}"
    pid = {"project_id": r.json()["project_id"]}
    expect(client.get("/api/subtitle/projects/{project_id}", params=pid), 200)
    expect(client.request("DELETE", "/api/subtitle/projects/{project_id}", params=pid, write=True), 200)
    expect(client.get("/api/subtitle/projects/{project_id}", params=pid), 404)


def test_media_discard_own_upload(client):
    r = client.request("POST", "/api/subtitle/upload", files=_file(), write=True, timeout=180)
    expect(r, 200)
    vid = r.json()["video_id"]
    d = client.request("POST", "/api/media/discard", json={"video_id": vid}, write=True)
    expect(d, 200)
    assert d.json().get("deleted_count", 0) >= 1, f"discard removed nothing: {d.json()}"


def test_discard_requires_target(client):
    expect(client.request("POST", "/api/subtitle/discard", json={}, write=True), 400)


# ── dubbing studio: project lifecycle ────────────────────────────────────────────────────
def _png(w=4, h=4):
    raw = b"".join(b"\x00" + b"\x00\x00\x00\x00" * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _idle(p):
    return p.get("status") not in ("transcribing", "profiling", "translating", "speaking", "separating", "mixing")


@pytest.fixture(scope="module")
def dub(client, session_user):
    r = client.request("POST", "/api/dubbing/projects", files=_file(), data={"source_language": "English"},
                       write=True, timeout=180)
    expect(r, 200)
    pid = r.json()["id"]
    p = client.poll("/api/dubbing/projects/{pid}", _idle, params={"pid": pid}, timeout=SLOW)
    yield {"pid": pid, "first": p.json()}
    client.request("DELETE", "/api/dubbing/projects/{pid}", params={"pid": pid}, write=True)


def _wait(client, pid):
    r = client.poll("/api/dubbing/projects/{pid}", _idle, params={"pid": pid}, timeout=SLOW)
    expect(r, 200)
    return r.json()


def test_dub_project_transcribed(dub):
    p = dub["first"]
    assert p.get("status") == "ready" and p.get("segments"), f"project ended as {p.get('status')}: {p.get('error')}"


def test_dub_media_and_thumbs(client, dub):
    pid = {"pid": dub["pid"]}
    r = client.get("/api/dubbing/projects/{pid}/media", params=pid, stream=True)
    expect(r, 200)
    r.close()
    expect(client.get("/api/dubbing/projects/{pid}/waveform/lines", params=pid, timeout=120), 200)
    # audio-only project: no video, so no thumbnails
    expect(client.get("/api/dubbing/projects/{pid}/thumbs", params=pid), 200, 404)


def test_dub_profiles(client, dub):
    expect(client.request("POST", "/api/dubbing/projects/{pid}/profiles", params={"pid": dub["pid"]}, write=True), 200)
    p = _wait(client, dub["pid"])
    assert p.get("speakers"), f"no speakers after profiling: {p.get('error')}"


def test_dub_save_segments_unchanged(client, dub):
    p = _wait(client, dub["pid"])
    r = client.request("PUT", "/api/dubbing/projects/{pid}/segments", params={"pid": dub["pid"]}, write=True,
                       json={"segments": p["segments"]})
    expect(r, 200)


def test_dub_speaker_sample_voice_and_tts(client, dub):
    p = _wait(client, dub["pid"])
    name = next(iter(p["speakers"]))
    sp = {"pid": dub["pid"], "name": name}
    expect(client.get("/api/dubbing/projects/{pid}/speakers/{name}/sample", params=sp), 200, 404)
    voices = client.get("/api/dubbing/voices").json().get("voices") or []
    if voices:
        v = voices[0]
        r = client.request("PUT", "/api/dubbing/projects/{pid}/speakers/{name}/voice", params=sp, write=True,
                           json={"voice_id": v.get("voice_id") or v.get("id"), "voice_name": v.get("name", "")})
        expect(r, 200)
    r = client.request("PUT", "/api/dubbing/projects/{pid}/speakers/{name}/tts", params=sp, write=True,
                       json={"stability": 0.5, "similarity": 0.75, "speed": 1.0})
    expect(r, 200)


def test_dub_clone_voice(client, dub):
    p = _wait(client, dub["pid"])
    name = next(iter(p["speakers"]))
    r = client.request("POST", "/api/dubbing/projects/{pid}/speakers/{name}/clone",
                       params={"pid": dub["pid"], "name": name}, write=True, timeout=SLOW)
    # 400 = not enough clean speech for a clone, which is a correct answer for a short clip
    expect(r, 200, 400)


def test_dub_translate(client, dub):
    r = client.request("POST", "/api/dubbing/projects/{pid}/translate", params={"pid": dub["pid"]}, write=True,
                       json={"target_language": "Hindi"})
    expect(r, 200)
    p = _wait(client, dub["pid"])
    assert p.get("target_language") and not p.get("error"), f"translation: {p.get('error')}"


def test_dub_speak_and_line_audio(client, dub):
    expect(client.request("POST", "/api/dubbing/projects/{pid}/speak", params={"pid": dub["pid"]}, write=True,
                          json={}), 200)
    p = _wait(client, dub["pid"])
    assert not p.get("error"), f"speech: {p.get('error')}"
    sid = p["segments"][0]["id"]
    r = client.get("/api/dubbing/projects/{pid}/lines/{sid}/audio", params={"pid": dub["pid"], "sid": sid}, stream=True)
    expect(r, 200)
    r.close()


def test_dub_stems(client, dub):
    expect(client.request("POST", "/api/dubbing/projects/{pid}/stems", params={"pid": dub["pid"]}, write=True,
                          json={"mode": "basic"}), 200)
    p = _wait(client, dub["pid"])
    assert not p.get("error"), f"stems: {p.get('error')}"


def test_dub_mix_and_download(client, dub):
    pid = {"pid": dub["pid"]}
    expect(client.request("POST", "/api/dubbing/projects/{pid}/mix", params=pid, write=True, json={}, timeout=SLOW), 200)
    p = _wait(client, dub["pid"])
    assert not p.get("error"), f"mix: {p.get('error')}"
    for kind in ("audio", "mixed"):
        r = client.get("/api/dubbing/projects/{pid}/download/{kind}", params={**pid, "kind": kind}, stream=True)
        expect(r, 200, 404)
        r.close()
    expect(client.get("/api/dubbing/projects/{pid}/waveform/{track}", params={**pid, "track": "dub"}, timeout=120), 200, 404)


def test_dub_overlay_put_get(client, dub):
    p = {"pid": dub["pid"], "name": "0a1b2c3d4e5f6a7b"}
    r = client.request("PUT", "/api/dubbing/projects/{pid}/overlays/{name}", params=p, write=True,
                       data=_png(), headers={"Content-Type": "image/png"})
    expect(r, 200)
    expect(client.get("/api/dubbing/projects/{pid}/overlays", params={"pid": dub["pid"]}), 200)
    g = client.get("/api/dubbing/projects/{pid}/overlays/{name}.png", params=p)
    expect(g, 200)
    assert g.content.startswith(b"\x89PNG"), "overlay is not a PNG"


def test_dub_overlay_rejects_non_png(client, dub):
    r = client.request("PUT", "/api/dubbing/projects/{pid}/overlays/{name}", params={"pid": dub["pid"], "name": "0a1b2c3d4e5f6a7c"},
                       write=True, data=b"not a png")
    expect(r, 400)


def test_dub_edit_save_and_reset(client, dub):
    pid = {"pid": dub["pid"]}
    current = client.get("/api/dubbing/projects/{pid}/edit", params=pid)
    expect(current, 200)
    edit = current.json().get("edit")
    expect(client.request("PUT", "/api/dubbing/projects/{pid}/edit", params=pid, write=True, json={"edit": edit}), 200)
    r = client.request("DELETE", "/api/dubbing/projects/{pid}/edit", params=pid, write=True)
    expect(r, 200)
    assert r.json().get("stored") is False, "edit was not reset"


def test_dub_cancel_when_idle(client, dub):
    expect(client.request("POST", "/api/dubbing/projects/{pid}/cancel", params={"pid": dub["pid"]}, write=True), 200)


def test_dub_project_delete(client, session_user):
    r = client.request("POST", "/api/dubbing/projects", files=_file(), data={"source_language": "English"},
                       write=True, timeout=180)
    expect(r, 200)
    pid = {"pid": r.json()["id"]}
    expect(client.request("DELETE", "/api/dubbing/projects/{pid}", params=pid, write=True), 200)
    expect(client.get("/api/dubbing/projects/{pid}", params=pid), 404)


# ── dubbing studio: quick dub job ────────────────────────────────────────────────────────
def test_quick_dub_job(client, session_user):
    r = client.request("POST", "/api/dubbing/jobs", files=_file(), write=True, timeout=180,
                       data={"target_language": "Hindi", "source_language": "English", "num_speakers": 1})
    expect(r, 200)
    jid = {"job_id": r.json().get("id") or r.json().get("job_id")}
    try:
        done = client.poll("/api/dubbing/jobs/{job_id}", lambda j: j.get("status") in ("done", "error"),
                           params=jid, timeout=600, every=10)
        expect(done, 200)
        assert done.json().get("status") == "done", f"quick dub ended as {done.json().get('status')}: {done.json().get('error')}"
        a = client.get("/api/dubbing/jobs/{job_id}/download/{kind}", params={**jid, "kind": "audio"}, stream=True)
        expect(a, 200)
        a.close()
        expect(client.request("POST", "/api/dubbing/jobs/{job_id}/cancel", params=jid, write=True), 200)
    finally:
        client.request("DELETE", "/api/dubbing/jobs/{job_id}", params=jid, write=True)
