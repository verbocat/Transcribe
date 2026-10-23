"""Exposure (opt-in, run with -m exposure): project lists that answer without any token.

The code shows these routes have no auth, so an anonymous caller gets every user's projects.
The test asserts the safe behaviour (401) and therefore FAILS while the gap exists. It records only
the status code and the number of projects returned; response bodies are never printed or saved.
"""
import pytest

pytestmark = pytest.mark.exposure


@pytest.mark.parametrize("path", ["/api/projects", "/api/subtitle/projects"])
def test_project_list_requires_auth(client, path):
    r = client.get(path, auth=False)
    count = None
    if r.status_code == 200:
        try:
            count = len(r.json().get("projects", []))
        except Exception:
            pass
    assert r.status_code in (401, 403), (
        f"GET {path} without a token -> HTTP {r.status_code}; "
        f"anonymous caller received {count if count is not None else 'an unknown number of'} projects"
    )
