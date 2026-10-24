"""Dubbing Studio in the browser.

Free checks (ui): the start page, loading and removing a file, and the Quick dub screen up to (not
including) "Dub it". Paid checks (ui + paid): create a project from the 21 s clip, walk the editor
tabs, then delete the project from the list, which also removes it from the server."""
import re

import pytest

from ui_fixtures import CLIP_NAME, gone, goto, no_js_errors, shown, signed_in_context

pytestmark = pytest.mark.ui
SLOW = 300_000  # ms


def test_start_page(page):
    goto(page, "/dubbing")
    assert shown(page.get_by_text("Start a dubbing project")), "start card missing"
    assert shown(page.get_by_text(re.compile("your projects", re.I))), "project list missing"
    assert shown(page.get_by_text(re.compile("Quick dub"))), "quick dub link missing"
    no_js_errors(page)


def test_load_and_remove_file(page, clip_path):
    goto(page, "/dubbing")
    page.locator("input[type=file]").first.set_input_files(str(clip_path))
    assert shown(page.get_by_text(CLIP_NAME)), "file name not shown"
    assert page.get_by_role("button", name="Create project").is_visible(), "Create project missing"
    labels = page.locator("select").first.locator("option").all_inner_texts()
    assert {"Auto-Detect", "Hindi", "English"} <= set(labels), f"spoken language choices: {labels}"
    page.get_by_role("button", name="Remove file").click()
    assert gone(page.get_by_text(CLIP_NAME)), "file still shown after Remove"


def test_quick_dub_needs_consent(page, clip_path):
    goto(page, "/dubbing")
    page.get_by_text(re.compile("Quick dub")).first.click()
    assert shown(page.get_by_text("Drop a video or audio file to dub")), "quick dub screen did not open"
    page.locator("input[type=file]").first.set_input_files(str(clip_path))
    dub_it = page.get_by_role("button", name="Dub it")
    assert shown(dub_it), "'Dub it' button missing after choosing a file"
    consent = page.locator("input[type=checkbox]").first
    assert not consent.is_checked(), "voice-clone consent is pre-ticked"
    assert dub_it.is_disabled(), "'Dub it' is enabled before consent is given"
    consent.check()
    assert dub_it.is_enabled(), "'Dub it' stays disabled after consent"
    # stop here: pressing "Dub it" starts a paid ElevenLabs dub (covered by the API suite)


# ── paid: one dubbing project, created and deleted through the UI ───────────────────────
@pytest.fixture(scope="module")
def dub_tab(browser, client, session_user):
    ctx, pg = signed_in_context(browser, client.token, session_user)
    yield pg
    ctx.close()
    # if a test failed before the UI delete, remove the project through the API
    for p in client.get("/api/dubbing/projects").json().get("projects", []):
        if CLIP_NAME in str(p.get("filename", "")):
            client.request("DELETE", "/api/dubbing/projects/{pid}", params={"pid": p["id"]}, write=True)


@pytest.mark.paid
def test_create_project(dub_tab, clip_path):
    goto(dub_tab, "/dubbing")
    dub_tab.locator("input[type=file]").first.set_input_files(str(clip_path))
    dub_tab.locator("select").first.select_option(label="English")
    dub_tab.get_by_role("button", name="Create project").click()
    assert shown(dub_tab.get_by_role("button", name="Speakers & voices"), 120000), "project editor did not open"
    assert shown(dub_tab.get_by_text(re.compile(r"quality|weather|listening", re.I)), SLOW), "transcript never appeared"
    no_js_errors(dub_tab)


@pytest.mark.paid
@pytest.mark.parametrize("tab", ["Speakers & voices", "Translation", "Voice-over", "Editor", "Transcript"])
def test_editor_tabs(dub_tab, tab):
    dub_tab.get_by_role("button", name=tab, exact=True).click()
    dub_tab.wait_for_load_state("networkidle")
    no_js_errors(dub_tab)


@pytest.mark.paid
def test_back_and_delete_project(dub_tab):
    dub_tab.get_by_role("button", name=re.compile("All projects")).click()
    row = dub_tab.get_by_text(CLIP_NAME).first
    assert shown(row), "new project missing from the list"
    before = dub_tab.get_by_role("button", name="Delete project").count()
    dub_tab.get_by_role("button", name="Delete project").first.click()
    dlg = dub_tab.get_by_role("dialog")
    assert shown(dlg.get_by_text("Delete this project?")), "delete confirmation did not open"
    dlg.get_by_role("button", name=re.compile(r"^Delete")).last.click()
    dub_tab.wait_for_function(f"() => document.querySelectorAll('[aria-label=\"Delete project\"]').length < {before}",
                              timeout=30000)
    no_js_errors(dub_tab)
