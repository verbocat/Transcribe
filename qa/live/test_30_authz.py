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
