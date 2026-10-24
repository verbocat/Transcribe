"""Admin Command Center (/admin) in the browser. Read-only: tabs, search, refresh, and dialogs opened
then cancelled. Nothing is submitted, and no row action (block, delete, kick, limits save) is used.

Needs a dedicated admin TEST account in .env.live (LIVE_ADMIN_EMAIL / LIVE_ADMIN_PASSWORD) that is
listed in the server's ADMIN_EMAILS; skipped otherwise. The non-admin check runs with the normal
test account."""
import re

import pytest

from ui_fixtures import ADMIN_EMAIL, gone, goto, no_js_errors, shown

pytestmark = pytest.mark.ui

TABS = ["Overview", "Users & Minutes", "Jobs", "Media", "Server"]


def _tab(pg, name):
    return pg.get_by_role("navigation", name="Admin sections").get_by_role("button", name=re.compile(re.escape(name)))


def test_non_admin_gets_404(page):
    goto(page, "/admin")
    assert shown(page.get_by_text("Page Not Found")), "a non-admin account can open /admin"
    assert not page.get_by_role("navigation", name="Admin sections").is_visible(), "admin tabs shown to a non-admin"


def test_admin_dashboard_loads(admin_page):
    goto(admin_page, "/admin")
    assert shown(admin_page.get_by_role("navigation", name="Admin sections"), 20000), "admin dashboard did not load"
    for name in TABS:
        assert _tab(admin_page, name).is_visible(), f"'{name}' tab missing"
    no_js_errors(admin_page)


@pytest.mark.parametrize("name", TABS)
def test_admin_tab_renders(admin_page, name):
    goto(admin_page, "/admin")
    _tab(admin_page, name).click()
    assert _tab(admin_page, name).get_attribute("aria-current") == "page", f"'{name}' tab did not become active"
    admin_page.wait_for_load_state("networkidle")
    assert not admin_page.get_by_text(re.compile(r"failed to load|something went wrong", re.I)).first.is_visible(), \
        f"'{name}' tab shows an error"
    no_js_errors(admin_page)


def test_overview_cards(admin_page):
    goto(admin_page, "/admin")
    for title in ("Recent jobs", "Top users · last 30 days", "Studio activity · last 30 days", "Server"):
        assert shown(admin_page.get_by_role("heading", name=title)), f"overview card '{title}' missing"


def test_users_search_finds_admin_test_account(admin_page):
    goto(admin_page, "/admin")
    _tab(admin_page, "Users & Minutes").click()
    search = admin_page.get_by_placeholder("Search by name or email...")
    search.fill(ADMIN_EMAIL)
    assert shown(admin_page.get_by_text(ADMIN_EMAIL)), "searching for the admin test account found nothing"
    search.fill("qa-live-no-such-user-7f3c9e1a")
    admin_page.wait_for_timeout(1000)
    assert not admin_page.get_by_text(ADMIN_EMAIL).first.is_visible(), "search did not filter the user list"


def test_users_refresh(admin_page):
    goto(admin_page, "/admin")
    _tab(admin_page, "Users & Minutes").click()
    admin_page.get_by_title("Refresh").first.click()
    admin_page.wait_for_load_state("networkidle")
    no_js_errors(admin_page)


def test_create_account_dialog_cancel(admin_page):
    goto(admin_page, "/admin")
    _tab(admin_page, "Users & Minutes").click()
    admin_page.get_by_role("button", name="Create account").first.click()
    assert shown(admin_page.get_by_placeholder("Generated if empty")), "create-account form did not open"
    admin_page.get_by_role("button", name="Cancel").last.click()  # never submitted: no account is created
    assert gone(admin_page.get_by_placeholder("Generated if empty")), "create-account form did not close"


def test_limits_dialog_cancel(admin_page):
    goto(admin_page, "/admin")
    _tab(admin_page, "Users & Minutes").click()
    admin_page.get_by_placeholder("Search by name or email...").fill(ADMIN_EMAIL)
    shown(admin_page.get_by_text(ADMIN_EMAIL))
    admin_page.get_by_title("Usage time, job limits, feature access and end date").first.click()
    dlg = admin_page.get_by_role("dialog", name="Limits and access")
    assert shown(dlg), "limits dialog did not open"
    assert shown(dlg.locator('input[aria-label="Total minutes"]')), "minutes field missing"
    assert dlg.get_by_role("button", name="Save changes").is_visible(), "save button missing"
    dlg.get_by_role("button", name="Cancel").click()  # never saved
    assert gone(dlg), "limits dialog did not close"


@pytest.mark.parametrize("tab,placeholder", [("Jobs", "Search user or file"),
                                             ("Media", "Search file name or user email")])
def test_search_boxes(admin_page, tab, placeholder):
    goto(admin_page, "/admin")
    _tab(admin_page, tab).click()
    box = admin_page.get_by_placeholder(placeholder)
    assert shown(box), f"{tab} search box missing"
    box.fill("qa-live-no-such-file-7f3c9e1a")
    admin_page.wait_for_load_state("networkidle")
    no_js_errors(admin_page)


def test_back_to_home(admin_page):
    goto(admin_page, "/admin")
    admin_page.get_by_title("Back to the home page").first.click()
    admin_page.wait_for_url(re.compile(r"/$"), timeout=10000)
