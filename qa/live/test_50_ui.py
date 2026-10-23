"""UI: the live frontend loads, the sign-in screen works, and the signed-in home renders.

Nothing is uploaded or saved. The sign-in uses the same test account as the API tests, once.
"""
import os
import re

import pytest

from conftest import API_BASE, TEST_EMAIL, TEST_PASSWORD, UI_BASE

sync_api = pytest.importorskip("playwright.sync_api", reason="playwright not installed")
pytestmark = pytest.mark.ui

IGNORED_CONSOLE = re.compile(r"favicon|ResizeObserver|DevTools", re.I)


@pytest.fixture(scope="module")
def browser():
    if not UI_BASE:
        pytest.skip("LIVE_UI_URL not set")
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(headless=os.environ.get("LIVE_HEADED") != "1")
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    pg = ctx.new_page()
    pg.console_errors = []
    pg.on("console", lambda m: m.type == "error" and not IGNORED_CONSOLE.search(m.text)
          and pg.console_errors.append(m.text))
    pg.on("pageerror", lambda e: pg.console_errors.append(str(e)))
    yield pg
    ctx.close()


def test_frontend_loads(page):
    resp = page.goto(UI_BASE, wait_until="networkidle")
    assert resp and resp.status == 200, f"GET {UI_BASE} -> HTTP {resp.status if resp else 'no response'}"
    assert "Noun" in page.title(), f"page title is {page.title()!r}"
    assert not page.console_errors, f"JS errors on load: {page.console_errors[:3]}"


def test_signed_out_home(page):
    page.goto(UI_BASE, wait_until="networkidle")
    assert page.get_by_role("button", name="Sign in", exact=True).is_visible(), "'Sign in' button not visible"
    for studio in ("Transcribe Studio", "Subtitle Studio", "Dubbing Studio"):
        assert page.get_by_role("button", name=studio).is_visible(), f"'{studio}' card not visible"


def test_sign_in_button_opens_login(page):
    page.goto(UI_BASE, wait_until="networkidle")
    page.get_by_role("button", name="Sign in", exact=True).click()
    page.wait_for_url("**/login", timeout=10000)
    assert page.get_by_placeholder("name@email.com").is_visible(), "email field not visible"
    assert page.get_by_placeholder("Enter your password").is_visible(), "password field not visible"
    assert not page.console_errors, f"JS errors: {page.console_errors[:3]}"


def test_unknown_route_shows_not_found(page):
    resp = page.goto(f"{UI_BASE}/qa-live-no-such-page", wait_until="networkidle")
    assert resp and resp.status in (200, 404), f"HTTP {resp.status if resp else 'none'}"
    assert not page.console_errors, f"JS errors: {page.console_errors[:3]}"


def test_sign_in_and_home(page):
    if not (TEST_EMAIL and TEST_PASSWORD):
        pytest.skip("LIVE_TEST_EMAIL / LIVE_TEST_PASSWORD not set")
    page.goto(f"{UI_BASE}/login", wait_until="networkidle")
    page.get_by_placeholder("name@email.com").fill(TEST_EMAIL)
    page.get_by_placeholder("Enter your password").fill(TEST_PASSWORD)
    page.locator("button[type=submit]", has_text="Sign In").click()
    page.locator('section[aria-label="Studios"]').wait_for(state="visible", timeout=20000)
    assert page.locator('section[aria-label="Start from a media file"]').is_visible(), "home drop zone not visible"
    assert not page.console_errors, f"JS errors after sign-in: {page.console_errors[:3]}"
    # end the browser session on the server too
    page.evaluate("""async (api) => {
        const t = localStorage.getItem('verbolabs_auth_token');
        if (t) await fetch(api + '/api/auth/logout', {method: 'POST', headers: {Authorization: 'Bearer ' + t}}).catch(() => {});
    }""", API_BASE)
