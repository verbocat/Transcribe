"""Subtitle Studio in the browser (opt-in: -m paid). Generates subtitles once for the 21 s test
clip, then edits a card, undoes it, opens QC and settings, and exports an .srt. One shared tab;
anything saved is removed by the qa_live_7f3c9e1a sweep at the end."""
import re

import pytest

from cleanup_qa import cleanup
from ui_fixtures import CLIP_NAME, gone, goto, no_js_errors, shown, signed_in_context

pytestmark = [pytest.mark.ui, pytest.mark.paid]
SLOW = 300_000  # ms


@pytest.fixture(scope="module")
def st(browser, client, session_user):
    ctx, pg = signed_in_context(browser, client.token, session_user)
    yield pg
    ctx.close()
    cleanup(client)


def _rows(pg):
    return pg.locator("[data-event-id]")


def _cards(pg):
    # each card shows its text in a "Click to edit" cell; the text box only appears after a click
    return pg.locator('[data-event-id] [title="Click to edit"]')


def test_open_studio(st):
    goto(st, "/subtitle")
    assert shown(st.get_by_title("Open a video or audio file")), "media picker missing"
    assert st.get_by_role("button", name="Generate").first.is_disabled(), "Generate is enabled before media is loaded"
    no_js_errors(st)


def test_load_media(st, clip_path):
    st.locator('input[type=file][accept^="video/mp4"]').first.set_input_files(str(clip_path))
    if shown(st.get_by_role("button", name="Discard draft"), 3000):  # draft banner from an earlier run
        st.get_by_role("button", name="Discard draft").click()
    assert shown(st.get_by_text(CLIP_NAME)), "file name not shown in the header"
    gen = st.get_by_role("button", name="Generate").first
    st.wait_for_function("b => !b.disabled", arg=gen.element_handle(), timeout=60000)


def test_choose_language(st):
    sel = st.locator('select[aria-label="Spoken language"]').first
    english = next((l for l in sel.locator("option").all_inner_texts() if l.strip().lower().startswith("english")), None)
    assert english, "English not offered"
    sel.select_option(label=english)


def test_generate(st):
    st.get_by_role("button", name="Generate").first.click()
    assert shown(st.locator('[role="progressbar"]'), 30000), "no progress shown after Generate"
    assert shown(_rows(st), SLOW), "no subtitle cards appeared"
    text = " ".join(_cards(st).all_inner_texts()).lower()
    assert re.search(r"quality|weather|noun|listening", text), f"subtitles do not match the clip: {text[:120]!r}"
    no_js_errors(st)


def test_edit_card_and_undo(st):
    rid = _rows(st).first.get_attribute("data-event-id")
    row = st.locator(f'[data-event-id="{rid}"]')
    cell = row.locator('[title="Click to edit"]')
    before = cell.inner_text().strip()
    cell.click()
    box = row.locator("textarea")
    assert shown(box), "clicking a card did not open its text box"
    assert box.input_value().strip() == before, "text box does not hold the card text"
    box.click()
    st.keyboard.press("Control+End")
    st.keyboard.type(" QA", delay=120)
    # a selected card stays in edit mode and saves every keystroke (updateText)
    st.wait_for_timeout(500)
    after = box.input_value().strip()
    assert after == before + " QA", f"edit did not stick: ...{after[-30:]!r}"
    undo = st.locator('button[aria-label="Undo (Ctrl+Z)"]:not([disabled])')  # header and toolbar both have one
    if not shown(undo, 5000):
        raise AssertionError("Undo stays disabled after editing a subtitle")
    undo.first.click()
    st.wait_for_timeout(800)
    restored = (box.input_value() if box.is_visible() else cell.inner_text()).strip()
    assert restored == before, f"Undo did not restore the card: {restored[-30:]!r}"


def test_search(st):
    total = _rows(st).count()
    search = st.get_by_placeholder(re.compile("Search text"))
    search.fill("qa-live-no-such-word")
    st.wait_for_timeout(800)
    filtered = _rows(st).count()
    search.fill("")
    st.wait_for_timeout(800)
    assert filtered < total, "search did not filter the subtitle list"
    assert _rows(st).count() == total, "clearing the search did not bring the cards back"


def test_qc_panel(st):
    st.get_by_role("button", name="QC").first.click()
    assert shown(st.get_by_role("button", name="Close QC")), "QC panel did not open"
    st.get_by_role("button", name="Close QC").click()


def test_settings_modal(st):
    st.get_by_role("button", name=re.compile(r"^Settings")).first.click()
    dlg = st.get_by_role("dialog", name="Settings")
    assert shown(dlg), "settings dialog did not open"
    assert dlg.get_by_role("navigation", name="Settings pages").is_visible(), "settings pages missing"
    dlg.get_by_role("button", name="Done").click()
    assert gone(dlg), "settings dialog did not close"


def test_export_srt(st):
    st.get_by_role("button", name="Export", exact=True).first.click()
    dlg = st.get_by_role("dialog", name="Export subtitles")
    assert shown(dlg), "export dialog did not open"
    for fmt in ("TTML", "SubRip", "WebVTT", "Plain Text"):
        assert dlg.get_by_text(re.compile(fmt)).count(), f"{fmt} format missing"
    dlg.get_by_text(re.compile("SubRip")).first.click()
    with st.expect_download(timeout=60000) as dl:
        dlg.get_by_role("button", name=re.compile(r"Export \.srt")).click()
    path = dl.value.path()
    body = open(path, encoding="utf-8", errors="replace").read()
    assert "-->" in body, "exported .srt has no cue timings"
    no_js_errors(st)
