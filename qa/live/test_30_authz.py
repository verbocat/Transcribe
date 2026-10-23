"""Authorization: protected endpoints must refuse callers without a valid token, and admin
endpoints must refuse a normal user.

Write endpoints are included in the no-token sweep only when their auth is "user"/"admin": the auth
dependency raises 401 before the handler runs, and no request body is sent, so nothing executes.
The client's guard (conftest.LiveClient._guard) enforces this independently of the lists below.
"""
import pytest

from catalog import CATALOG
from conftest import expect

pytestmark = pytest.mark.authz

QA_ID = "qa-live-nonexistent-7f3c9e1a"
FILL = {"notification_id": QA_ID, "key": "transcribe_layout", "user_id": QA_ID, "pid": QA_ID,
        "name": "qa", "sid": 1, "track": "dub", "kind": "mix", "job_id": QA_ID, "project_id": QA_ID}

PROTECTED = [e for e in CATALOG if e.auth in ("user", "admin")]
PROTECTED_GETS = [e for e in PROTECTED if e.method == "GET"]
ADMIN_GETS = [e for e in CATALOG if e.auth == "admin" and e.method == "GET"]


@pytest.mark.parametrize("ep", PROTECTED, ids=lambda e: e.id)
def test_no_token_is_401(client, ep):
    expect(client.request(ep.method, ep.path, params=FILL, auth=False), 401)


@pytest.mark.parametrize("ep", PROTECTED_GETS, ids=lambda e: e.id)
def test_invalid_token_is_401(client, ep):
    expect(client.get(ep.path, params=FILL, token="qa-invalid-token-000"), 401)


@pytest.mark.parametrize("ep", ADMIN_GETS, ids=lambda e: e.id)
def test_admin_route_forbidden_for_test_user(api, ep):
    expect(api.get(ep.path, params=FILL), 403)


# Routes with no login check in the GitHub code that production protects anyway. Sent without a
# token and with an id nothing can match, so even an open route would find nothing to read or change.
FORMERLY_OPEN = [
    ("GET", "/api/projects/{project_id}", None), ("DELETE", "/api/projects/{project_id}", None),
    ("GET", "/api/subtitle/projects/{project_id}", None), ("DELETE", "/api/subtitle/projects/{project_id}", None),
    ("GET", "/api/transcribe_status/{job_id}", None), ("GET", "/api/audio/extract_status/{job_id}", None),
    ("POST", "/api/jobs/{job_id}/cancel", None), ("DELETE", "/api/cleanup/{audio_id}", None),
    ("DELETE", "/api/subtitle/upload_chunk/{upload_id}", None),
    ("POST", "/api/media/discard", {"video_id": QA_ID}), ("POST", "/api/subtitle/discard", {"video_id": QA_ID}),
]


@pytest.mark.parametrize("method,path,body", FORMERLY_OPEN, ids=lambda v: v if isinstance(v, str) else "")
def test_open_in_code_but_protected_live(client, method, path, body):
    r = client.request(method, path, params={**FILL, "audio_id": QA_ID, "upload_id": QA_ID},
                       json=body, auth=False, write=True)
    expect(r, 401)


# Admin writes with the (non-admin) test token: the admin dependency answers 403 before the handler
# runs, and no body is sent. claim-initial-admin checks the caller is the super admin before changing anything.
ADMIN_WRITES = [e for e in CATALOG if e.method != "GET" and
                (e.auth == "admin" or e.path == "/api/admin/claim-initial-admin")]


@pytest.mark.parametrize("ep", ADMIN_WRITES, ids=lambda e: e.id)
def test_admin_write_forbidden_for_test_user(api, ep):
    expect(api.request(ep.method, ep.path, params=FILL, write=True), 403)
