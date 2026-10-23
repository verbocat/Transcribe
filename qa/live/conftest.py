"""Live production suite: throttled client, one test-account session, report columns.

Safety rails (enforced in code, not just by convention):
  * Only GET/HEAD go out with the test account's token, plus the POSTs listed in SAFE_AUTH_POSTS.
  * PUT/PATCH/DELETE and any other POST may only be sent WITHOUT a token, and only to endpoints whose
    catalog auth is "user"/"admin" (the server's auth dependency rejects them before the handler runs).
  * Requests are spaced at least LIVE_MIN_INTERVAL seconds apart (default 1.0s).
  * The run aborts if the test account turns out to be an admin.
"""
import json
import os
import re
import time
from pathlib import Path

import pytest
import requests

from catalog import BY_ID

HERE = Path(__file__).parent


def _load_env_file():
    env = HERE / ".env.live"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_load_env_file()

API_BASE = os.environ.get("LIVE_API_URL", "").rstrip("/")
UI_BASE = os.environ.get("LIVE_UI_URL", "").rstrip("/")
TEST_EMAIL = os.environ.get("LIVE_TEST_EMAIL", "")
TEST_PASSWORD = os.environ.get("LIVE_TEST_PASSWORD", "")
MIN_INTERVAL = float(os.environ.get("LIVE_MIN_INTERVAL", "1.0"))
TIMEOUT = float(os.environ.get("LIVE_TIMEOUT", "30"))

# POSTs that may carry the test token: login/logout of the test session and pure compute endpoints.
SAFE_AUTH_POSTS = {
    "/api/auth/login", "/api/auth/logout", "/api/auth/validate-password",
    "/api/lint", "/api/autofix", "/api/export", "/api/export/multi",
    "/api/subtitle/qc", "/api/subtitle/lint", "/api/subtitle/autofix",
    "/api/subtitle/export", "/api/subtitle/rebreak",
}


class UnsafeRequest(RuntimeError):
    pass


class LiveClient:
    def __init__(self, base: str):
        self.base = base
        self.http = requests.Session()
        self.http.headers["User-Agent"] = "noun-live-qa/1.0 (pytest; read-only)"
        self.token = None
        self._last = 0.0
        self.calls = []  # (method, path, status) for the current test, reset per test

    def _guard(self, method: str, template: str, with_token: bool):
        if method in ("GET", "HEAD"):
            return
        if method == "POST" and template in SAFE_AUTH_POSTS:
            return
        ep = BY_ID.get(f"{method} {template}")
        if with_token:
            raise UnsafeRequest(f"refusing authenticated {method} {template}: not on the safe list")
        if not ep or ep.auth not in ("user", "admin"):
            raise UnsafeRequest(f"refusing {method} {template}: its handler would run without auth")

    def request(self, method, template, *, params=None, query=None, auth=True, token=None, write=False, **kw):
        """template is the catalog path (e.g. /api/dubbing/projects/{pid}); params fills it in,
        query becomes the query string. write=True is the explicit opt-in the lifecycle tests use
        (test_60+) to change data they created themselves; the guard still blocks everything else."""
        method = method.upper()
        path = template.format(**(params or {}))
        headers = kw.pop("headers", {}) or {}
        sent_token = token if token is not None else (self.token if auth else None)
        if not write:
            self._guard(method, template, with_token=bool(sent_token))
        elif f"{method} {template}" not in BY_ID:
            raise UnsafeRequest(f"refusing write to {method} {template}: not a known route")
        if sent_token:
            headers["Authorization"] = f"Bearer {sent_token}"
        wait = MIN_INTERVAL - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        try:
            resp = self.http.request(method, self.base + path, params=query, headers=headers,
                                     timeout=kw.pop("timeout", TIMEOUT), allow_redirects=False, **kw)
        finally:
            self._last = time.monotonic()
        self.calls.append((method, path, resp.status_code))
        return resp

    def get(self, template, **kw):
        return self.request("GET", template, **kw)

    def post(self, template, **kw):
        return self.request("POST", template, **kw)

    def poll(self, template, done, *, params=None, timeout=300, every=3.0, **kw):
        """GET template until done(json) is true; returns the last response."""
        end = time.monotonic() + timeout
        while True:
            r = self.get(template, params=params, **kw)
            if r.status_code != 200 or done(r.json()) or time.monotonic() > end:
                return r
            time.sleep(every)


def detail(resp) -> str:
    """Short server-side reason for a failure message (never the full body)."""
    try:
        body = resp.json()
        d = body.get("detail", body) if isinstance(body, dict) else body
        text = json.dumps(d) if not isinstance(d, str) else d
    except Exception:
        text = resp.text
    text = re.sub(r"\s+", " ", text or "").strip()
    return text[:200] or "<empty body>"


def expect(resp, *codes):
    assert resp.status_code in codes, (
        f"{resp.request.method} {resp.request.path_url} -> HTTP {resp.status_code}, "
        f"expected {'/'.join(map(str, codes))}. Server said: {detail(resp)}"
    )


# ── fixtures ─────────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def client():
    if not API_BASE:
        pytest.exit("LIVE_API_URL is not set (see qa/live/.env.live.example)", returncode=2)
    c = LiveClient(API_BASE)
    yield c
    if c.token:
        try:
            c.post("/api/auth/logout")
        except Exception:
            pass


@pytest.fixture(scope="session")
def session_user(client):
    """Logs the test account in once for the whole run. Never retries: wrong passwords lock the IP."""
    if not (TEST_EMAIL and TEST_PASSWORD):
        pytest.skip("LIVE_TEST_EMAIL / LIVE_TEST_PASSWORD not set: authenticated tests skipped")
    r = client.post("/api/auth/login", auth=False, json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code != 200:
        pytest.exit(f"Test-account login failed (HTTP {r.status_code}: {detail(r)}). "
                    "Stopping so no retry can trigger the IP lockout.", returncode=3)
    data = r.json()
    user = data.get("user", {})
    if user.get("is_admin") or user.get("role") == "admin":
        client.token = data.get("token")
        pytest.exit("The test account is an ADMIN. Use a dedicated non-admin account.", returncode=4)
    client.token = data["token"]
    return user


@pytest.fixture
def api(client, session_user):
    return client


@pytest.fixture(autouse=True)
def _reset_calls(client):
    client.calls = []


# ── reporting ────────────────────────────────────────────────────────────────────────────
_ROWS = []
_RESULT = {"passed": "PASS", "failed": "FAIL", "skipped": "SKIP"}


def _reason(report) -> str:
    if report.passed:
        return ""
    if report.skipped:
        lr = report.longrepr
        return (lr[2] if isinstance(lr, tuple) else str(lr)).replace("Skipped: ", "")
    text = (getattr(report, "longreprtext", "") or "").strip()
    lines = []
    for l in text.splitlines():
        if l.startswith("E "):
            l = l[1:].strip()
            if l.startswith("assert ") or l.startswith("+"):  # pytest's rewritten-assert detail
                break
            lines.append(l)
    return (" ".join(lines) or (text.splitlines() or ["error"])[-1])[:400]


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    rep = (yield).get_result()
    if rep.when == "call" or (rep.when == "setup" and not rep.passed):
        c = item.funcargs.get("client")
        calls = list(c.calls) if c and rep.when == "call" else []  # setup failures sent nothing
        ep = getattr(item, "callspec", None) and item.callspec.params.get("ep")
        rep.live_endpoint = ep.id if ep is not None else (f"{calls[-1][0]} {calls[-1][1]}" if calls else "")
        rep.live_status = ", ".join(str(s) for _, _, s in calls) or "-"
        _ROWS.append((_RESULT.get(rep.outcome, rep.outcome.upper()), item.nodeid.split("::", 1)[-1],
                      rep.live_endpoint, rep.live_status, _reason(rep)))


def pytest_html_results_table_header(cells):
    cells.insert(2, "<th>API endpoint</th>")
    cells.insert(3, "<th>HTTP status</th>")


def pytest_html_results_table_row(report, cells):
    cells.insert(2, f"<td>{getattr(report, 'live_endpoint', '')}</td>")
    cells.insert(3, f"<td>{getattr(report, 'live_status', '')}</td>")


def pytest_html_report_title(report):
    report.title = "Noun - live production API & UI validation"


def pytest_terminal_summary(terminalreporter):
    if not _ROWS:
        return
    tr = terminalreporter
    tr.section("live results")
    tr.write_line(f"{'RESULT':7} {'HTTP':10} {'ENDPOINT':58} TEST / REASON")
    for res, name, ep, status, reason in _ROWS:
        tr.write_line(f"{res:7} {status[:10]:10} {ep[:58]:58} {name}")
        if reason and res != "PASS":
            tr.write_line(f"{'':7} {'':10} {'':58} -> {reason}")
