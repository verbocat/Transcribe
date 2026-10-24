"""UI shell: home page, navigation, account menu, profile, notifications, appearance, sign-out,
auth screens and the home drop zone. Nothing is uploaded, saved or emailed."""
import re

import pytest

from conftest import API_BASE, TEST_EMAIL, TEST_PASSWORD, detail
from ui_fixtures import CLIP_NAME, gone, goto, no_js_errors, shown

pytestmark = pytest.mark.ui


# ── signed out ───────────────────────────────────────────────────────────────────────────
def test_signed_out_home(anon_page):
    pg = anon_page
    resp = goto(pg)
    assert resp and resp.status == 200, f"home -> HTTP {resp.status if resp else 'none'}"
    assert "Noun" in pg.title(), f"title is {pg.title()!r}"
    assert pg.get_by_role("heading", level=1).inner_text().strip(), "no h1 on the home page"
    for name in ("Sign in", "Create account"):
        assert shown(pg.get_by_role("button", name=name, exact=True)), f"'{name}' button missing"
    studios = pg.locator('section[aria-label="Studios"]')
    for tile in ("Transcribe Studio", "Subtitle Studio", "Dubbing Studio"):
        assert studios.get_by_role("button", name=re.compile(tile)).is_visible(), f"{tile} tile missing"
    no_js_errors(pg)


@pytest.mark.parametrize("path", ["/transcribe", "/subtitle", "/dubbing"])
def test_studio_url_needs_sign_in(anon_page, path):
    goto(anon_page, path)
    anon_page.wait_for_url(re.compile(r"/(login)?$"), timeout=10000)


def test_studio_tile_signed_out_goes_to_login(anon_page):
    goto(anon_page)
    anon_page.locator('section[aria-label="Studios"]').get_by_role("button", name=re.compile("Subtitle Studio")).click()
    anon_page.wait_for_url("**/login", timeout=10000)


def test_unknown_page_shows_404(anon_page):
    goto(anon_page, "/qa-live-no-such-page")
    assert anon_page.get_by_text("Page Not Found").first.is_visible(), "404 page not shown"
    assert anon_page.get_by_role("button", name="Return to Landing Page").is_visible()


def test_forgot_password_url(anon_page):
    # The page is reachable from the login form; a direct link to /forgot-password should work too.
    goto(anon_page, "/forgot-password")
    assert not anon_page.get_by_text("Page Not Found").first.is_visible(), \
        "/forgot-password shows the 404 page (only 'login', 'signup', 'verify', 'reset' paths reach the auth screen)"


# ── auth screens (nothing is submitted except one client-side validation) ───────────────
def test_login_screen(anon_page):
    pg = anon_page
    goto(pg, "/login")
    assert pg.get_by_text("Welcome back").first.is_visible(), "login heading missing"
    assert pg.locator("input[type=email]").first.is_visible()
    assert pg.locator("#login-password").is_visible()
    pg.get_by_role("button", name="Show password").click()
    assert pg.locator("#login-password").get_attribute("type") == "text", "show password did not reveal it"
    pg.get_by_role("tab", name="Email code").click()
    assert pg.get_by_role("button", name="Send me a code").is_visible(), "email-code tab has no send button"
    no_js_errors(pg)


def test_forgot_password_view(anon_page):
    pg = anon_page
    goto(pg, "/login")
    pg.get_by_role("button", name=re.compile("Forgot password", re.I)).click()
    assert pg.get_by_role("button", name="Send Reset Link").is_visible(), "forgot-password form not shown"
    no_js_errors(pg)


def test_signup_url_opens_create_account(anon_page):
    goto(anon_page, "/signup")
    assert shown(anon_page.get_by_text("Create your account"), 5000),         "/signup opens the Sign in tab, not Create account"


def test_signup_screen_rejects_mismatched_passwords(anon_page):
    pg = anon_page
    goto(pg, "/login")
    pg.get_by_role("tab", name="Create account").click()
    assert shown(pg.get_by_text("Create your account")), "create-account form not shown"
    pg.get_by_placeholder("Your name").fill("QA Live")
    pg.locator("input[type=email]").first.fill("qa-live-nobody@verbolabs.com")
    pg.locator("#signup-password").fill("Qa-Live-Check-2026!")
    pg.locator("#signup-confirm").fill("Qa-Live-Check-2026!x")
    pg.locator("button[type=submit]", has_text="Create account").click()
    assert shown(pg.get_by_text(re.compile("Passwords do not match", re.I))), "no mismatch error shown"


# ── signed in ────────────────────────────────────────────────────────────────────────────
def test_signed_in_home(page, session_user):
    goto(page)
    h1 = page.get_by_role("heading", level=1).inner_text()
    first = (session_user.get("name") or "").split(" ")[0]
    assert first and first in h1, f"greeting {h1!r} does not name the user"
    assert page.get_by_role("button", name="Account menu").is_visible(), "account menu missing"
    assert page.locator('section[aria-label="Recent projects"]').is_visible(), "recent projects missing"
    no_js_errors(page)


@pytest.mark.parametrize("tile,path", [("Transcribe Studio", "/transcribe"), ("Subtitle Studio", "/subtitle"),
                                       ("Dubbing Studio", "/dubbing")])
def test_studio_tiles_open_studios(page, tile, path):
    goto(page)
    page.locator('section[aria-label="Studios"]').get_by_role("button", name=re.compile(tile)).click()
    page.wait_for_url(f"**{path}", timeout=15000)
    page.wait_for_load_state("networkidle")
    no_js_errors(page)


def test_account_menu(page):
    goto(page)
    page.get_by_role("button", name="Account menu").click()
    for item in ("Edit Profile", "Preferences & Settings", "User Manual & Shortcuts", "Sign Out"):
        assert page.get_by_role("button", name=item).is_visible(), f"'{item}' missing from the account menu"
    assert not page.get_by_role("button", name="Admin Command Center").is_visible(), "non-admin sees the admin entry"
    assert page.locator('[data-testid="usage-menu"]').is_visible(), "usage block missing"


def test_profile_modal_opens_and_closes(page, session_user):
    goto(page)
    page.get_by_role("button", name="Account menu").click()
    page.get_by_role("button", name="Edit Profile").click()
    dlg = page.get_by_role("dialog", name="Account and settings")
    assert shown(dlg), "profile dialog did not open"
    assert dlg.get_by_placeholder("Enter your full name").input_value() == session_user.get("name"), "name field not prefilled"
    for tab in ("Settings & Preferences", "User Manual & Shortcuts", "Profile & Account"):
        dlg.get_by_role("button", name=tab).click()
    dlg.get_by_title("Close modal").click()
    assert gone(dlg), "profile dialog did not close"


def test_notification_bell(page):
    goto(page)
    page.locator('button[title="Notifications"], button[title*="unread"], button[title="Notifications Muted"]').first.click()
    assert page.get_by_text("All caught up!").first.is_visible() or page.get_by_role("button", name="Mark all read").is_visible(), \
        "notification panel did not open"


def test_appearance_dialog_cancel(page):
    goto(page)
    page.get_by_role("button", name="Appearance").click()
    dlg = page.get_by_role("dialog", name="Appearance settings")
    assert shown(dlg), "appearance dialog did not open"
    assert dlg.get_by_role("button", name="Apply").is_disabled(), "Apply is enabled before any change"
    dlg.get_by_role("button", name="Cancel").click()
    assert gone(dlg), "appearance dialog did not close"


# ── home drop zone (checked in the browser; nothing is uploaded) ─────────────────────────
def test_drop_zone_rejects_unsupported_file(page):
    goto(page)
    page.locator('section[aria-label="Start from a media file"] input[type=file]').set_input_files(
        files=[{"name": "qa_live_notes.txt", "mimeType": "text/plain", "buffer": b"not media"}])
    assert page.get_by_text(re.compile("file type is not supported", re.I)).first.is_visible(), "no unsupported-type message"


def test_drop_zone_accepts_media_and_remove(page, clip_path):
    goto(page)
    page.locator('section[aria-label="Start from a media file"] input[type=file]').set_input_files(str(clip_path))
    assert page.get_by_text(CLIP_NAME).first.is_visible(), "file name not shown"
    for b in ("Transcribe", "Subtitle", "Dub"):
        assert page.get_by_role("button", name=b, exact=True).is_visible(), f"'{b}' choice missing"
    page.get_by_role("button", name="Remove file").click()
    assert not page.get_by_text(CLIP_NAME).first.is_visible(), "file still shown after Remove"


# ── sign-out (own session, so the shared test token stays valid) ─────────────────────────
def test_sign_out_confirm_flow(browser, client):
    import requests
    r = requests.post(f"{API_BASE}/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"second login for the sign-out test failed: HTTP {r.status_code} {detail(r)}"
    from ui_fixtures import signed_in_context
    ctx, pg = signed_in_context(browser, r.json()["token"], r.json()["user"])
    try:
        goto(pg)
        pg.get_by_role("button", name="Account menu").click()
        pg.get_by_role("button", name="Sign Out").click()
        dlg = pg.get_by_role("dialog")
        assert shown(dlg.get_by_text("Sign Out of Noun?")), "sign-out confirmation missing"
        dlg.get_by_role("button", name="Stay Signed In").click()
        assert pg.get_by_role("button", name="Account menu").is_visible(), "'Stay Signed In' signed the user out"
        pg.get_by_role("button", name="Account menu").click()
        pg.get_by_role("button", name="Sign Out").click()
        pg.get_by_role("button", name="Yes, Sign Out").click()
        assert shown(pg.get_by_role("button", name="Sign in", exact=True)), "still signed in"
        assert pg.evaluate("localStorage.getItem('verbolabs_auth_token')") is None, "token left in localStorage"
        me = requests.get(f"{API_BASE}/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}, timeout=30)
        assert me.status_code == 401, f"session still valid on the server after sign-out (HTTP {me.status_code})"
    finally:
        ctx.close()
