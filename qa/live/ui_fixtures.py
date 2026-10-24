"""Shared browser fixtures for the UI tests in ui/ (loaded as a plugin by conftest.py).

The test account signs in once through the API (the session_user fixture in conftest.py); the
token is then placed in each new browser context's localStorage, the same keys the app's
AuthContext reads, so every test starts signed in without typing the password again.
"""
import json
import os
import re
from pathlib import Path

import pytest

from conftest import UI_BASE

try:
    from playwright import sync_api
except ImportError:  # UI tests skip themselves; the API suite must still load
    sync_api = None

IGNORED_CONSOLE = re.compile(r"favicon|ResizeObserver|DevTools|Failed to load resource", re.I)
TAG = "qa_live_7f3c9e1a"
CLIP_NAME = f"{TAG}_clip.wav"
CLIP = Path(__file__).parent / "fixtures" / CLIP_NAME


@pytest.fixture(scope="session")
def clip_path():
    return CLIP


@pytest.fixture(scope="session")
def browser():
    if sync_api is None:
        pytest.skip("playwright not installed")
    if not UI_BASE:
        pytest.skip("LIVE_UI_URL not set")
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(headless=os.environ.get("LIVE_HEADED") != "1")
        yield b
        b.close()


def _new_page(browser, init_script=None, viewport=(1440, 900)):
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, accept_downloads=True)
    if init_script:
        ctx.add_init_script(init_script)
    pg = ctx.new_page()
    pg.set_default_timeout(15000)
    pg.console_errors = []
    pg.on("console", lambda m: m.type == "error" and not IGNORED_CONSOLE.search(m.text)
          and pg.console_errors.append(m.text))
    pg.on("pageerror", lambda e: pg.console_errors.append(str(e)))
    return ctx, pg


@pytest.fixture
def anon_page(browser):
    ctx, pg = _new_page(browser)
    yield pg
    ctx.close()


def signed_in_context(browser, token, user):
    """New browser context that starts signed in with this token (seeded once per tab, so a
    sign-out inside the test sticks). Native confirm() dialogs are accepted."""
    seed = json.dumps({"token": token, "user": user})
    ctx, pg = _new_page(browser, init_script=f"""(() => {{
        const s = {seed};
        if (!sessionStorage.getItem('qa_seeded')) {{
            localStorage.setItem('verbolabs_auth_token', s.token);
            localStorage.setItem('verbolabs_auth_user', JSON.stringify(s.user));
            localStorage.setItem('verbolabs_last_activity', String(Date.now()));
            sessionStorage.setItem('qa_seeded', '1');
        }}
    }})();""")
    pg.on("dialog", lambda d: d.accept())
    return ctx, pg


ADMIN_EMAIL = os.environ.get("LIVE_ADMIN_EMAIL", "").strip()
ADMIN_PASSWORD = os.environ.get("LIVE_ADMIN_PASSWORD", "").strip()
# The built-in super admin is a real person's account: the suite refuses to sign in with it.
PERSONAL_ADMINS = {"divyanshusinghchouhan@verbolabs.com"}


@pytest.fixture(scope="session")
def admin_session():
    """Signs a dedicated admin TEST account in once (API), yields (token, user), signs out at the end."""
    import requests
    from conftest import API_BASE, detail
    if not (ADMIN_EMAIL and ADMIN_PASSWORD):
        pytest.skip("LIVE_ADMIN_EMAIL / LIVE_ADMIN_PASSWORD not set: admin UI tests skipped")
    if ADMIN_EMAIL.lower() in PERSONAL_ADMINS:
        pytest.exit("LIVE_ADMIN_EMAIL is a personal super-admin account. Use a dedicated admin test account.", returncode=4)
    r = requests.post(f"{API_BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.exit(f"Admin test-account login failed (HTTP {r.status_code}: {detail(r)}); not retrying.", returncode=3)
    data = r.json()
    if not data["user"].get("is_admin"):
        pytest.skip("LIVE_ADMIN_EMAIL is not an admin on this server (add it to ADMIN_EMAILS)")
    yield data["token"], data["user"]
    requests.post(f"{API_BASE}/api/auth/logout", headers={"Authorization": f"Bearer {data['token']}"}, timeout=30)


@pytest.fixture
def admin_page(browser, admin_session):
    ctx, pg = signed_in_context(browser, *admin_session)
    yield pg
    ctx.close()


@pytest.fixture
def page(browser, client, session_user):
    """A signed-in page using the run's API session token; nothing is typed into the login form."""
    ctx, pg = signed_in_context(browser, client.token, session_user)
    yield pg
    ctx.close()


def goto(pg, path=""):
    resp = pg.goto(f"{UI_BASE}{path}", wait_until="domcontentloaded")
    pg.wait_for_load_state("networkidle")
    return resp


def shown(locator, timeout=10000):
    """True once the element is visible (waits for animations and route changes)."""
    try:
        locator.first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def gone(locator, timeout=10000):
    try:
        locator.first.wait_for(state="hidden", timeout=timeout)
        return True
    except Exception:
        return False


def no_js_errors(pg):
    assert not pg.console_errors, f"JavaScript errors: {pg.console_errors[:3]}"
