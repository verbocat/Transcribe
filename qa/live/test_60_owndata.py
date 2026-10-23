"""Own data (opt-in, -m owndata): writes that touch only the test account's own records.

Every change is put back or deleted in the same test: the profile name and layout preference are
restored, and the shared project is created by the test and deleted at the end. Notifications
belong to the test account; clear-all removes only its own (they are admin messages to it).
"""
import pytest

from conftest import expect

pytestmark = pytest.mark.owndata

QA_ID = "qa-live-nonexistent-7f3c9e1a"
# The server checks a shared draft looks like a subtitle draft before storing it.
DRAFT = {"events": [{"id": 1, "start_time": 0, "end_time": 2, "text": "QA"}]}


# ── profile and preferences: change, verify, restore ────────────────────────────────────
def test_profile_rename_and_restore(api):
    original = api.get("/api/auth/me").json().get("user", {}).get("name")
    assert original, "could not read the current profile name"
    try:
        r = api.request("PATCH", "/api/auth/profile", json={"name": "QA Live Check"}, write=True)
        expect(r, 200)
        assert r.json()["user"]["name"] == "QA Live Check", "name was not updated"
    finally:
        restore = api.request("PATCH", "/api/auth/profile", json={"name": original}, write=True)
    expect(restore, 200)
    assert restore.json()["user"]["name"] == original, "name was not restored"


def test_profile_blank_name_is_ignored(api):
    before = api.get("/api/auth/me").json().get("user", {}).get("name")
    r = api.request("PATCH", "/api/auth/profile", json={"name": "   "}, write=True)
    expect(r, 200)
    assert r.json()["user"]["name"] == before, "a blank name overwrote the profile name"


def test_preference_put_and_restore(api):
    key = {"key": "transcribe_layout"}
    original = api.get("/api/auth/preferences/{key}", params=key).json().get("value")
    probe = {"qa_live": True, "panes": [1, 2]}
    try:
        expect(api.request("PUT", "/api/auth/preferences/{key}", params=key, json={"value": probe}, write=True), 200)
        got = api.get("/api/auth/preferences/{key}", params=key).json().get("value")
        assert got == probe, f"stored value {got!r} != sent value"
    finally:
        api.request("PUT", "/api/auth/preferences/{key}", params=key, json={"value": original or {}}, write=True)


def test_preference_unknown_key_rejected(api):
    r = api.request("PUT", "/api/auth/preferences/{key}", params={"key": "qa_unknown_key"},
                    json={"value": {}}, write=True)
    expect(r, 404)


def test_preference_too_large_rejected(api):
    r = api.request("PUT", "/api/auth/preferences/{key}", params={"key": "transcribe_layout"},
                    json={"value": {"blob": "x" * 40000}}, write=True)
    expect(r, 413)


# ── notifications (only the test account's own) ─────────────────────────────────────────
@pytest.mark.parametrize("template", ["/api/auth/notifications/{notification_id}/read",
                                      "/api/admin/me/notifications/{notification_id}/read"])
def test_mark_unknown_notification_404(api, template):
    expect(api.request("POST", template, params={"notification_id": QA_ID}, write=True), 404)


def test_delete_unknown_notification_404(api):
    r = api.request("DELETE", "/api/auth/notifications/{notification_id}", params={"notification_id": QA_ID}, write=True)
    expect(r, 404)


def test_mark_own_notification_read(api):
    notes = api.get("/api/auth/notifications").json().get("notifications", [])
    if not notes:
        pytest.skip("the test account has no notifications to mark")
    r = api.request("POST", "/api/auth/notifications/{notification_id}/read",
                    params={"notification_id": notes[0]["id"]}, write=True)
    expect(r, 200)


def test_admin_me_read_all(api):
    expect(api.request("POST", "/api/admin/me/notifications/read-all", write=True), 200)
    unread = api.get("/api/admin/me/notifications").json().get("unread_count")
    assert unread == 0, f"{unread} notifications still unread after read-all"


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_clear_all_notifications(api, method):
    expect(api.request(method, "/api/auth/notifications/clear-all", write=True), 200)
    left = api.get("/api/auth/notifications").json().get("notifications", [])
    assert left == [], f"{len(left)} notifications left after clear-all"


# ── sharing: create a project, use it, delete it ────────────────────────────────────────
@pytest.fixture(scope="module")
def shared(client, session_user):
    r = client.request("POST", "/api/shares/projects", write=True, json={
        "title": "QA live check (auto-deleted)", "filename": "qa_live_7f3c9e1a.srt",
        "draft": DRAFT, "linguist_ids": []})
    if r.status_code == 403:
        pytest.skip("test account is not a coordinator; sharing cannot be tested")
    expect(r, 200)
    proj = r.json()["project"]
    yield proj
    client.request("DELETE", "/api/shares/projects/{project_id}", params={"project_id": proj["id"]}, write=True)


def test_share_publish(shared):
    assert shared["revision"] == 1 and shared["linguists"] == [], f"unexpected new project: {shared}"


def test_share_listed_as_mine(api, shared):
    ids = [p["id"] for p in api.get("/api/shares/projects/mine").json()["projects"]]
    assert shared["id"] in ids, "new shared project missing from /projects/mine"


def test_share_open_and_save_draft(api, shared):
    pid = {"project_id": shared["id"]}
    opened = api.get("/api/shares/projects/{project_id}", params=pid)
    expect(opened, 200)
    rev = opened.json()["project"]["revision"]
    r = api.request("PUT", "/api/shares/projects/{project_id}/draft", params=pid, write=True,
                    json={"draft": {"events": [{**DRAFT["events"][0], "text": "QA edited"}]}, "base_revision": rev})
    expect(r, 200)
    assert r.json()["revision"] == rev + 1, "revision did not advance"


def test_share_stale_save_conflict(api, shared):
    r = api.request("PUT", "/api/shares/projects/{project_id}/draft", params={"project_id": shared["id"]},
                    write=True, json={"draft": DRAFT, "base_revision": 0})
    expect(r, 409)


def test_share_rejects_non_subtitle_draft(api, shared):
    r = api.request("PUT", "/api/shares/projects/{project_id}/draft", params={"project_id": shared["id"]},
                    write=True, json={"draft": {}, "base_revision": 0})
    expect(r, 400)


def test_share_update_by_publish(api, shared):
    r = api.request("POST", "/api/shares/projects", write=True, json={
        "id": shared["id"], "title": "QA live check renamed (auto-deleted)", "draft": DRAFT})
    expect(r, 200)
    assert r.json()["project"]["title"].startswith("QA live check renamed"), "title not updated"


def test_share_set_linguists_empty(api, shared):
    r = api.request("PUT", "/api/shares/projects/{project_id}/linguists", params={"project_id": shared["id"]},
                    write=True, json={"linguist_ids": []})
    expect(r, 200)


def test_share_video_link_without_video(api, shared):
    r = api.get("/api/shares/projects/{project_id}/video-link", params={"project_id": shared["id"]})
    expect(r, 200)
    assert r.json().get("available") is False, "a project without video reports a video link"


def test_share_publish_requires_title(api):
    r = api.request("POST", "/api/shares/projects", write=True, json={"title": "  ", "draft": {}})
    expect(r, 400)


def test_share_delete(client, session_user):
    # Separate project, so the module fixture's teardown is the only other delete.
    r = client.request("POST", "/api/shares/projects", write=True,
                       json={"title": "QA live delete check", "draft": DRAFT, "linguist_ids": []})
    if r.status_code == 403:
        pytest.skip("test account is not a coordinator")
    expect(r, 200)
    pid = {"project_id": r.json()["project"]["id"]}
    expect(client.request("DELETE", "/api/shares/projects/{project_id}", params=pid, write=True), 200)
    expect(client.get("/api/shares/projects/{project_id}", params=pid), 404)


def test_share_cannot_delete_unknown(api):
    r = api.request("DELETE", "/api/shares/projects/{project_id}", params={"project_id": QA_ID}, write=True)
    expect(r, 404)
