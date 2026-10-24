"""Transcribe Studio in the browser (opt-in: -m paid). One transcription of the 21 s test clip,
then the editor, search, QC drawer and export. Tests run in order on one shared tab; the project
the transcription saves is removed by the qa_live_7f3c9e1a sweep at the end."""
import re

import pytest

from cleanup_qa import cleanup
from ui_fixtures import CLIP_NAME, gone, goto, no_js_errors, shown, signed_in_context

pytestmark = [pytest.mark.ui, pytest.mark.paid]
SLOW = 300_000  # ms


@pytest.fixture(scope="module")
def ts(browser, client, session_user):
    ctx, pg = signed_in_context(browser, client.token, session_user)
    yield pg
    ctx.close()
    cleanup(client)


def test_open_studio(ts):
    goto(ts, "/transcribe")
    assert shown(ts.locator('label[for="ts-media-input"]')), "empty-state drop card missing"
    assert ts.get_by_title("Import media first").first.is_visible() or ts.get_by_role("button", name="Transcribe").first.is_disabled(), \
        "Transcribe should be disabled before media is loaded"
    no_js_errors(ts)


def test_load_media(ts, clip_path):
    ts.locator("#ts-media-input").set_input_files(str(clip_path))
    later = ts.get_by_role("button", name="Later")
    if shown(later, 3000):  # "Found earlier work for ..." banner from an earlier run
        later.click()
    assert shown(ts.get_by_text(CLIP_NAME)), "file name not shown after loading"
    assert shown(ts.get_by_text(re.compile("press Transcribe", re.I)), 60000), "media did not finish loading"


def test_choose_language(ts):
    sel = ts.locator('select[aria-label="Spoken language"]').first
    labels = sel.locator("option").all_inner_texts()
    english = next((l for l in labels if l.strip().lower().startswith("english")), None)
    assert english, f"English not offered: {labels[:10]}"
    sel.select_option(label=english)


def test_transcribe(ts):
    ts.get_by_title("Transcribe this media").first.click()
    assert shown(ts.locator('[role="progressbar"]'), 30000), "no progress shown after pressing Transcribe"
    assert shown(ts.locator('section[aria-label="Transcript"] .ts-row'), SLOW), "no transcript rows appeared"
    text = " ".join(ts.locator('textarea[aria-label="Transcript text"]').evaluate_all("els => els.map(e => e.value)")).lower()
    assert re.search(r"quality|weather|noun|listening", text), f"transcript does not match the clip: {text[:120]!r}"
    no_js_errors(ts)


def test_edit_line_and_undo(ts):
    box = ts.locator('textarea[aria-label="Transcript text"]').first
    before = box.input_value()
    box.click()
    ts.keyboard.press("Control+End")  # plain End only reaches the end of the wrapped visual line
    ts.keyboard.type(" QA edit", delay=120)  # normal typing speed
    ts.locator('input[aria-label="Search transcript"]').click()  # move focus away to commit the edit
    got = box.input_value()
    assert got == before + " QA edit", f"typed text landed wrong: ...{got[-30:]!r} (cursor jumps while typing)"
    undo = ts.get_by_role("button", name="Undo").first
    try:
        undo.wait_for(state="visible")
        ts.wait_for_function("b => !b.disabled", arg=undo.element_handle(), timeout=10000)
    except Exception:
        box.fill(before)
        raise AssertionError("Undo stays disabled after typing in a transcript line: setField / remove in TranscriptList.jsx never call pushToHistory")
    undo.click()
    assert shown(ts.locator('textarea[aria-label="Transcript text"]').first), "editor vanished after undo"
    assert ts.locator('textarea[aria-label="Transcript text"]').first.input_value() == before, "Undo did not restore the line"


def test_search_filters_rows(ts):
    rows = ts.locator('section[aria-label="Transcript"] .ts-row')
    total = rows.count()
    search = ts.locator('input[aria-label="Search transcript"]')
    search.fill("qa-live-no-such-word")
    ts.wait_for_timeout(800)
    assert rows.count() < total or shown(ts.get_by_text(re.compile("no (lines|results|match)", re.I)), 3000), \
        "search did not filter the transcript"
    search.fill("")
    ts.wait_for_timeout(800)
    assert rows.count() == total, "clearing the search did not bring the rows back"


def test_qc_drawer(ts):
    ts.locator('aside[aria-label="Tools"]').get_by_role("button", name="QC").click()
    qc = ts.locator('aside[aria-label="QC"]')
    assert shown(qc), "QC drawer did not open"
    assert shown(qc.get_by_role("radio", name="Rule checks")), "rule checks option missing"
    ts.get_by_role("button", name="Close QC").click()
    assert gone(qc), "QC drawer did not close"


def test_export_download(ts):
    ts.locator('aside[aria-label="Tools"]').get_by_role("button", name="Export").click()
    menu = ts.get_by_role("menu")
    assert shown(menu), "export menu did not open"
    for fmt in ("Excel", "CSV", "Word", "SubRip", "JSON"):
        assert menu.get_by_role("menuitemcheckbox", name=re.compile(fmt)).count(), f"{fmt} format missing"
    with ts.expect_download(timeout=120000) as dl:
        menu.get_by_role("button", name=re.compile(r"Download \d+ formats?")).click()
    assert dl.value.suggested_filename, "download has no file name"
    no_js_errors(ts)
