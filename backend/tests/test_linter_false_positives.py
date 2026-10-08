"""Regression tests for QC false positives (and the fixers that must agree with the rules)."""
import sys
import types as _types

try:  # apply_auto_fixes imports audio_processor (pydub), which may be missing where only the rules are tested
    import app.audio_processor  # noqa: F401
except Exception:
    _stub = _types.ModuleType("app.audio_processor")
    _stub.format_timestamp = lambda t: f"{int(t // 60):02d}:{t % 60:06.3f}"
    sys.modules["app.audio_processor"] = _stub

from app.models import Segment
from app.linter_engine import lint_segment, lint_dataset, apply_auto_fixes, convert_all_digits_to_words, sanitize_karya_punctuation
from app.subtitle_qc import run_local_qc
from app.netflix_linter import lint_subtitle_event


def seg(text, start=0.0, end=3.0, i=1, gender="Male"):
    return Segment(segment_id=i, speaker="Speaker 1", gender=gender, start_time=start, end_time=end,
                   duration=end - start, transcript=text)


def types(text, language="English", script="Latin", **kw):
    return [e.error_type for e in lint_segment(seg(text, **kw), language=language, script=script)]


EN_SENTENCE = ("They're made up of, um, officers from the, the federal police, the Victorian state police, and ASIO, "
               "the Australian Security and Intelligence Organization, which is the, uh, equivalent of")


# ---- Karya rule checks -------------------------------------------------------------------------------------

def test_clean_english_sentence_has_no_findings():
    assert types(EN_SENTENCE, end=10.28) == []


def test_digit_flag_names_the_offending_word():
    errs = lint_segment(seg(EN_SENTENCE + " MI5."), language="English", script="Latin")
    assert [e.error_type for e in errs] == ["DIGITS_DETECTED"]
    assert "MI5" in errs[0].message and errs[0].snippet == "MI5"
    assert errs[0].suggested_fix.endswith("MI five.")


def test_digit_snippet_keeps_reading_order():
    errs = lint_segment(seg("There were 3 of them in 2024."), language="English", script="Latin")
    assert errs[0].snippet == "3, 2024"


def test_number_fixer_handles_separators_decimals_ordinals_and_glued_digits():
    f = lambda t: convert_all_digits_to_words(t, "English")
    assert f("about 1,000 people") == "about one thousand people"
    assert f("3.5 million") == "three point five million"
    assert f("the 3rd time") == "the third time"
    assert f("equivalent of MI5") == "equivalent of MI five"
    assert f("a 5G phone") == "a five G phone"
    assert f("in 2024") == "in two thousand and twenty-four"
    assert convert_all_digits_to_words("मेरे १२ भाई", "Hindi") == "मेरे बारह भाई"
    assert "लाख" in convert_all_digits_to_words("12,50,000 रुपये", "Hindi")


def test_curly_apostrophe_is_not_disallowed_punctuation():
    assert types("They’re not here, it’s fine.") == []


def test_wrong_tag_is_reported_once_not_also_as_stray_brackets():
    assert types("I think [crosstalk] there") == ["INVALID_TAG"]
    assert types("I think [Inaudible] there") == ["INVALID_TAG"]
    assert types("I think [inaudible] there") == []


def test_ellipsis_and_dashes_are_fixable():
    fixed = sanitize_karya_punctuation("Well… maybe — or not", "English")
    assert fixed == "Well... maybe -- or not"
    assert types(fixed) == []


def test_english_text_is_never_code_mixed():
    assert types("Hello there", language="English", script="Devanagari") == []
    assert types("Aap kaise ho?", language="Hindi", script="Latin") == []


def test_hindi_with_english_word_is_code_mixed():
    assert types("यह meeting कल है।", language="Hindi", script="Devanagari") == ["CODE_MIXED_SCRIPT"]
    assert types("यह meeting कल है।", language="Hindi", script="Auto-Detect") == ["CODE_MIXED_SCRIPT"]


def test_hindi_clean_and_real_violations_still_flagged():
    assert types("यह एक सीधा वाक्य है।", "Hindi", "Devanagari") == []
    assert "DIGITS_DETECTED" in types("मेरे १२ भाई हैं।", "Hindi", "Devanagari")
    assert "DISALLOWED_PUNCTUATION" in types("50% of them", "English", "Latin")
    assert "DURATION_TOO_SHORT" in types("ok", "English", "Latin", end=0.3)
    assert "DURATION_TOO_LONG" in types("ok", "English", "Latin", end=20.5)


def test_overlap_tolerance_and_autofix_roundtrip():
    prev, cur = seg("a", 0, 3), seg("b", 2.9995, 5, i=2)
    assert "TIMESTAMP_OVERLAP" not in [e.error_type for e in lint_segment(cur, prev_segment=prev, language="English", script="Latin")]
    messy = [seg("equivalent of MI5… 3rd time, 1,000 ‘fans’ “yes”", 0, 3), seg("50% done", 2.0, 5, i=2)]
    fixed = apply_auto_fixes(messy, language="English", script="Latin")
    assert all(not s.qc_errors for s in fixed), [e.message for s in fixed for e in s.qc_errors]


# ---- Centroid QC tab (local checks) -------------------------------------------------------------------------

def _qc(cues, lang="hi", src="en", unit="segment"):
    return run_local_qc(cues, lang, src, None, {"unit": unit})


def test_number_written_in_words_is_not_a_missing_number():
    c = {"start": 0, "end": 3, "source": "I have 3 cats", "target": "मेरे पास तीन बिल्लियाँ हैं"}
    assert not [i for i in _qc([c]) if i["category"] == "number"]
    c = {"start": 0, "end": 3, "source": "I have 25 coins", "target": "मेरे पास पच्चीस सिक्के हैं"}
    assert not [i for i in _qc([c]) if i["category"] == "number"]


def test_dropped_number_is_still_reported():
    c = {"start": 0, "end": 3, "source": "I have 25 coins", "target": "मेरे पास सिक्के हैं"}
    assert [i for i in _qc([c]) if i["category"] == "number"]
    c = {"start": 0, "end": 3, "source": "I have 25 coins", "target": "मेरे पास 52 सिक्के हैं"}
    assert [i for i in _qc([c]) if i["category"] == "number" and i["severity"] == "error"]


def test_segment_unit_keeps_ellipsis_dots_and_ignores_quote_pairs():
    cues = [{"start": 0, "end": 3, "source": 'He said, "I never thought', "target": 'He said, "I never thought'},
            {"start": 3.1, "end": 6, "source": 'Well... it would end."', "target": 'Well... it would end."'}]
    assert _qc(cues, "en", "en") == []
    cards = _qc(cues, "en", "en", unit="cue")
    assert any(i["title"] == "Unbalanced quotation marks" for i in cards)


# ---- Subtitle Studio (Netflix) lint -------------------------------------------------------------------------

def _nf(text):
    return [e["rule_id"] for e in lint_subtitle_event({"id": 1, "text": text, "start_time": 0, "end_time": 3})]


def test_title_before_a_comma_is_not_a_split_title():
    assert _nf("Yes, sir,\nI will go there now.") == []
    assert "NF-LINE-BREAK" in _nf("I saw Dr.\nSmith today.")


def test_en_dash_dual_speaker_is_consistent():
    assert _nf("-Hi.\n–Hello.") == []
