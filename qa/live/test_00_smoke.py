"""Smoke: the live backend is up and its route table matches what this suite knows about."""
import pytest

from catalog import CATALOG
from conftest import expect

pytestmark = pytest.mark.smoke


def test_root(client):
    # When Nginx serves the frontend and the API on one domain, "/" is the web app, not the API root.
    r = client.get("/", auth=False)
    expect(r, 200)
    if "text/html" in r.headers.get("content-type", ""):
        assert "noun" in r.text.lower(), "'/' serves HTML that is not the Noun app"
    else:
        assert r.json().get("status") == "healthy", f"root status is {r.json().get('status')!r}"


@pytest.mark.parametrize("path", ["/health", "/api/health"])
def test_health(client, path):
    r = client.get(path, auth=False)
    expect(r, 200)
    body = r.json()
    assert body.get("status") == "healthy", f"status is {body.get('status')!r}"
    assert body.get("has_gemini_api_key") is True, "server reports no Gemini API key configured"


def test_health_head(client):
    expect(client.request("HEAD", "/api/health", auth=False), 200)


def test_security_headers(client):
    r = client.get("/api/health", auth=False)
    expect(r, 200)
    assert r.headers.get("X-Content-Type-Options") == "nosniff", "X-Content-Type-Options header missing"
    assert r.headers.get("Referrer-Policy"), "Referrer-Policy header missing"


def test_centroid_status(client):
    r = client.get("/api/centroid/status", auth=False)
    expect(r, 200)
    assert isinstance(r.json(), dict), "centroid status is not a JSON object"


def test_bot_challenge(client):
    r = client.get("/api/auth/bot-challenge", auth=False)
    expect(r, 200)
    body = r.json()
    missing = {"challenge_id", "question", "timestamp", "signature"} - body.keys()
    assert not missing, f"bot-challenge missing fields: {sorted(missing)}"


def test_route_table_matches_catalog(client):
    """Every live route must be in catalog.py, so nothing new ships untested (or unclassified)."""
    r = client.get("/openapi.json", auth=False)
    if r.status_code == 404 or "json" not in r.headers.get("content-type", ""):
        pytest.skip("/openapi.json is not reachable on production (disabled, or Nginx serves the "
                    "frontend there); route drift check not possible")
    expect(r, 200)
    live = {f"{m.upper()} {p}" for p, ops in r.json().get("paths", {}).items()
            for m in ops if m.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE")}
    known = {e.id for e in CATALOG}
    new = sorted(live - known)
    gone = sorted(known - live)
    assert not new and not gone, f"not in catalog: {new}; in catalog but not live: {gone}"
