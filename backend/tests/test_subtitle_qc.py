from app.subtitle_qc import run_local_qc, merge_qc


def cue(src, tgt, start=0.0, end=3.0):
    return {"start": start, "end": end, "source": src, "target": tgt}


def by_cat(issues, cat):
    return [i for i in issues if i["category"] == cat]


def test_bad_line_break_gets_applicable_fix():
    c = cue("x", "from the Shadow\nWorld was a total failure?")
    iss = by_cat(run_local_qc([c], "en"), "line-break")
    assert iss and iss[0]["suggestion"]
    assert not any(l.endswith("Shadow") for l in iss[0]["suggestion"].split("\n"))


def test_too_long_line_is_rebroken():
    c = cue("x", "because your mission to steal the super crystal was a failure")
    iss = by_cat(run_local_qc([c], "en"), "line-length")
    assert iss and iss[0]["severity"] == "error"
    assert all(len(l) <= 42 for l in iss[0]["suggestion"].split("\n"))


def test_missing_question_mark_and_spacing():
    iss = run_local_qc([cue("Are you sure?", "Tu pakka hai ."), cue("Hi", "Hello  there!!")], "en", "hi")
    q = by_cat(iss, "punctuation")
    fixes = {i["index"]: i["suggestion"] for i in q if i["suggestion"]}
    assert fixes[1].endswith("?")
    assert fixes[2] == "Hello there!"


def test_numbers_untranslated_and_empty():
    iss = run_local_qc([cue("I have 25 coins", "मेरे पास सिक्के हैं"), cue("Hello there friend", "Hello there friend"), cue("Hi", "")], "hi", "en")
    assert by_cat(iss, "number") and by_cat(iss, "untranslated") and by_cat(iss, "omission")


def test_dual_speaker_and_reading_speed():
    iss = run_local_qc([cue("-Hi.\n-Hello.", "Hi. Hello.")], "en", "hi")
    s = by_cat(iss, "speaker")
    assert s and s[0]["suggestion"] == "-Hi.\n-Hello."
    fast = run_local_qc([cue("x", "a" * 80, 0, 2)], "en")
    assert by_cat(fast, "reading-speed")[0]["severity"] == "error"


def test_consistency_and_glossary():
    cues = [cue("Shadow World", "छाया लोक"), cue("Shadow World", "छाया लोक"), cue("Shadow World", "शैडो वर्ल्ड")]
    iss = by_cat(run_local_qc(cues, "hi", "en"), "consistency")
    assert len(iss) == 1 and iss[0]["index"] == 3 and iss[0]["suggestion"] == "छाया लोक"
    g = run_local_qc([cue("the Shadow World", "अंधेरी दुनिया")], "hi", "en", glossary=[{"source": "Shadow World", "target": "छाया लोक"}])
    assert by_cat(g, "terminology")


def test_cue_ending_mid_phrase():
    cues = [cue("a", "because your mission to steal the", 0, 2), cue("b", "super crystal failed.", 2.1, 4)]
    assert by_cat(run_local_qc(cues, "en"), "split")


def test_merge_keeps_one_fix_per_cue_and_summary():
    local = run_local_qc([cue("Are you sure?", "Hello  there .")], "en", "hi")
    ai = {"summary": {"mqm_score": 99, "ai_checked": True}, "issues": [
        {"index": 1, "category": "accuracy", "severity": "error", "suggestion": "Are you sure?"}]}
    out = merge_qc(ai, local, 1)
    assert sum(1 for i in out["issues"] if i["suggestion"]) == 1
    assert out["summary"]["error_count"] == 1 and out["summary"]["mqm_score"] <= 99
    off = merge_qc(None, local, 1, "Centroid down")
    assert off["summary"]["ai_checked"] is False and off["centroid_error"]


def test_segment_unit_skips_card_rules():
    long_text = "नमस्ते मैं गीता गुरुमूर्ति हूँ हमारे साथ जुड़ने के लिए धन्यवाद ऑस्ट्रेलियाई अधिकारियों ने पुष्टि की है कि एक टीम जांच कर रही है"
    c = cue("Hello there everyone", long_text, 0, 12)
    assert by_cat(run_local_qc([c], "hi", "en"), "line-length")
    assert not by_cat(run_local_qc([c], "hi", "en", constraints={"unit": "segment"}), "line-length")


def test_reading_speed_fix_extends_end_when_room():
    cues = [cue("x", "a" * 60, 0, 2), cue("y", "ok", 5, 6)]
    iss = by_cat(run_local_qc(cues, "en"), "reading-speed")
    assert iss and iss[0]["suggestion_end"] and 2 < iss[0]["suggestion_end"] <= 5
    tight = by_cat(run_local_qc([cue("x", "a" * 60, 0, 2), cue("y", "ok", 2, 3)], "en"), "reading-speed")
    assert tight and tight[0]["suggestion_end"] is None
