"""Read-only: authenticated GETs of the test account's own data.

Lookups by id use ids that cannot exist (QA_ID), so they exercise auth + routing + 404 handling
without ever reading another user's records.
"""
import pytest

from conftest import expect

pytestmark = pytest.mark.readonly

# Long and unique on purpose: some lookups glob the upload folder for *{id}*, so a short id could
# match a real user's file.
QA_ID = "qa-live-nonexistent-7f3c9e1a"


def test_me(api, session_user):
    r = api.get("/api/auth/me")
    expect(r, 200)
    body = r.json()
    user = body.get("user", body)
    assert user.get("email", "").lower() == session_user.get("email", "").lower(), "/me returned a different user"
    assert not user.get("is_admin"), "test account is reported as admin"


def test_me_usage(api):
    r = api.get("/api/auth/me/usage")
    expect(r, 200)
    assert r.json().get("success") is True and "usage" in r.json(), "usage payload missing"


def test_notifications(api):
    r = api.get("/api/auth/notifications")
    expect(r, 200)


def test_admin_me_notifications(api):
    expect(api.get("/api/admin/me/notifications"), 200)


def test_preference_known_key(api):
    r = api.get("/api/auth/preferences/{key}", params={"key": "transcribe_layout"})
    expect(r, 200)
    assert "value" in r.json(), "preference response has no 'value'"


def test_preference_unknown_key_404(api):
    expect(api.get("/api/auth/preferences/{key}", params={"key": "qa_unknown_key"}), 404)


# ── dubbing ─────────────────────────────────────────────────────────────────────────────
def test_dubbing_config(api):
    r = api.get("/api/dubbing/config")
    expect(r, 200)
    assert isinstance(r.json().get("languages"), list), "dubbing config has no languages list"


def test_dubbing_stems_status(api):
    expect(api.get("/api/dubbing/stems/status"), 200)


def test_dubbing_voices(api):
    # Lists the ElevenLabs account's voices (one read-only call to ElevenLabs).
    r = api.get("/api/dubbing/voices")
    expect(r, 200, 502)
    if r.status_code == 200:
        assert isinstance(r.json().get("voices"), list), "voices is not a list"


def test_dubbing_projects_list(api):
    r = api.get("/api/dubbing/projects")
    expect(r, 200)


FAKE_DUB_PROJECT_GETS = [
    "/api/dubbing/projects/{pid}",
    "/api/dubbing/projects/{pid}/media",
    "/api/dubbing/projects/{pid}/edit",
    "/api/dubbing/projects/{pid}/thumbs",
    "/api/dubbing/projects/{pid}/thumbs.jpg",
    "/api/dubbing/projects/{pid}/overlays",
    "/api/dubbing/projects/{pid}/overlays/{name}.png",
    "/api/dubbing/projects/{pid}/speakers/{name}/sample",
    "/api/dubbing/projects/{pid}/lines/{sid}/audio",
    "/api/dubbing/projects/{pid}/waveform/lines",
    "/api/dubbing/projects/{pid}/waveform/{track}",
    "/api/dubbing/projects/{pid}/download/{kind}",
]


@pytest.mark.parametrize("template", FAKE_DUB_PROJECT_GETS)
def test_dubbing_project_unknown_id_404(api, template):
    p = {"pid": QA_ID, "name": "qa", "sid": 1, "track": "dub", "kind": "mix"}
    expect(api.get(template, params=p), 404)


@pytest.mark.parametrize("template", ["/api/dubbing/jobs/{job_id}", "/api/dubbing/jobs/{job_id}/download/{kind}"])
def test_dubbing_job_unknown_id_404(api, template):
    expect(api.get(template, params={"job_id": QA_ID, "kind": "audio"}), 404)


# ── transcription / subtitle lookups ────────────────────────────────────────────────────
@pytest.mark.parametrize("template,param", [
    ("/api/transcribe_status/{job_id}", "job_id"),
    ("/api/audio/extract_status/{job_id}", "job_id"),
    ("/api/projects/{project_id}", "project_id"),
    ("/api/subtitle/projects/{project_id}", "project_id"),
    ("/api/subtitle/waveform/{video_id}", "video_id"),
])
def test_lookup_unknown_id_404(api, template, param):
    expect(api.get(template, params={param: QA_ID}), 404)


# ── sharing ─────────────────────────────────────────────────────────────────────────────
def test_shares_mine(api):
    expect(api.get("/api/shares/projects/mine"), 200)


def test_shares_with_me(api):
    expect(api.get("/api/shares/with-me"), 200)


def test_shares_linguists(api, session_user):
    # Coordinators may list linguists; other roles get 403. Either is a correct answer.
    r = api.get("/api/shares/linguists")
    expect(r, 200, 403)


@pytest.mark.parametrize("template", ["/api/shares/projects/{project_id}", "/api/shares/projects/{project_id}/video-link"])
def test_shares_unknown_project(api, template):
    expect(api.get(template, params={"project_id": QA_ID}), 403, 404)


def test_shares_video_forged_link_token(api):
    # The video link is signed; a forged 't' must be refused, never streamed.
    r = api.get("/api/shares/projects/{project_id}/video", params={"project_id": QA_ID},
                query={"t": "qa-forged-token"}, auth=False)
    expect(r, 401, 403, 404)
