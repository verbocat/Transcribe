import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.netflix_engine import (
    build_netflix_subtitles_from_words,
    optimize_language_line_breaks,
    get_language_profile,
    tidy_punctuation_spacing,
    tidy_quotation_marks,
)
from app.netflix_linter import auto_fix_subtitles, optimize_line_breaks, lint_subtitle_event


def W(spk, start, text, wdur=0.28, gap=0.06):
    """Word timings for `text` spoken by `spk` from `start`, one word every wdur + gap seconds."""
    out, t = [], start
    for w in text.split():
        out.append({"text": w, "start": round(t, 3), "end": round(t + wdur, 3), "speaker_id": spk, "type": "word"})
        t += wdur + gap
    return out


def build(words, **kw):
    return build_netflix_subtitles_from_words(words, language=kw.pop("language", "hi"), frame_rate=24.0, **kw)


def test_light_cards_of_one_speaker_merge():
    events = build(W("speaker_0", 0.0, "अरे यार,") + W("speaker_0", 1.1, "आज तो बहुत गर्मी है।"))
    assert [e.text for e in events] == ["अरे यार, आज तो बहुत गर्मी है।"]


def test_merged_card_stays_within_cpl_and_two_lines():
    words = (
        W("speaker_0", 0.0, "बड़े क्रिएचर्स को इसे लेने दो।")
        + W("speaker_0", 2.6, "हमारे लिए मेरे पास नया प्लान है।")
    )
    events = build(words)
    assert len(events) == 1
    assert events[0].text == "बड़े क्रिएचर्स को इसे लेने दो।\nहमारे लिए मेरे पास नया प्लान है।"
    for e in events:
        assert len(e.text.split("\n")) <= 2
        assert all(n <= 42 for n in e.cpl)


def test_merge_follows_adjustable_cpl():
    words = W("speaker_0", 0.0, "अरे यार,") + W("speaker_0", 1.1, "आज तो बहुत गर्मी है।")
    events = build(words, custom_cpl=16)
    assert all(n <= 16 for e in events for n in e.cpl)
    assert all(len(e.text.split("\n")) <= 2 for e in events)
    assert len(build(words, custom_cpl=12)) == 2


def test_long_pause_keeps_cards_apart():
    words = W("speaker_0", 0.0, "हाँ।") + W("speaker_0", 1.6, "चलो चलते हैं।")
    assert len(build(words)) == 2


def test_two_long_cards_are_not_merged():
    words = (
        W("speaker_0", 0.0, "तुम उनसे ज़्यादा मज़बूत नहीं होते अगर मेरी शक्ति न होती।")
        + W("speaker_0", 4.2, "हम तब तक चैन से नहीं बैठेंगे जब तक एल्ड्राडोर जीत नहीं लेते।")
    )
    assert len(build(words)) == 2


def test_merged_card_never_breaks_inside_a_sentence():
    words = (
        W("speaker_0", 0.0, "वाह।")
        + W("speaker_0", 0.9, "हमने पुराने युद्ध गुफाओं के हिस्सों का इस्तेमाल किया।")
    )
    events = build(words)
    for e in events:
        lines = e.text.split("\n")
        if len(lines) == 2 and "।" in lines[0][:-1]:
            assert lines[0].endswith("।")


def test_dual_speaker_card_uses_hyphen_without_space():
    events = build(W("speaker_0", 10.0, "भागो, भागो।") + W("speaker_1", 11.0, "हम भाग रहे हैं।"))
    assert len(events) == 1
    ev = events[0]
    assert ev.text == "-भागो, भागो।\n-हम भाग रहे हैं।"
    assert ev.speaker_count == 2
    assert ev.speakers == ["Speaker 1", "Speaker 2"]


def test_dual_speaker_with_speaker_tags():
    events = build(W("speaker_0", 10.0, "भागो।", wdur=0.8) + W("speaker_1", 11.0, "हाँ।", wdur=0.8), include_speaker_tags=True)
    assert events[0].text == "-[Speaker 1] भागो।\n-[Speaker 2] हाँ।"


def test_no_dual_card_when_a_line_would_pass_cpl():
    words = (
        W("speaker_0", 0.0, "हम तब तक चैन से नहीं बैठेंगे जब तक एल्ड्राडोर जीत नहीं लेते।")
        + W("speaker_1", 4.3, "तुम उनसे ज़्यादा मज़बूत नहीं होते।")
    )
    events = build(words)
    assert len(events) == 2
    assert not any(e.text.startswith("-") for e in events)


def test_no_dual_card_when_line_continues_into_next_subtitle():
    # The second speaker's sentence is unfinished and carries on into the next card.
    words = (
        W("speaker_0", 0.0, "कौन है?")
        + W("speaker_1", 0.9, "मैं हूँ, और मैं ये")
        + W("speaker_1", 3.0, "कहने आया हूँ कि हमें अभी यहाँ से निकलना होगा।")
    )
    events = build(words)
    assert not any(e.speaker_count == 2 for e in events)


def test_interruption_gets_ellipsis():
    events = build(W("speaker_0", 20.0, "मैं तुम्हें बताना चाहता था कि") + W("speaker_1", 22.1, "चुप रहो!"))
    assert events[0].text.split("\n")[0] == "-मैं तुम्हें बताना चाहता था कि…"


def test_two_second_pause_mid_sentence_gets_ellipsis_on_both_sides():
    events = build(W("speaker_0", 30.0, "मुझे सोचने दो,") + W("speaker_0", 33.0, "शायद कोई और रास्ता निकल आए।"))
    assert [e.text for e in events] == ["मुझे सोचने दो…", "…शायद कोई और रास्ता निकल आए।"]


def test_sentence_split_over_continuous_subtitles_has_no_ellipsis():
    words = (
        W("speaker_0", 40.0, "मानो या न मानो, स्नातक बनने के लिए हमें बस")
        + W("speaker_0", 43.2, "दो और कक्षाएँ पास करनी हैं और फिर हम आज़ाद होंगे।")
    )
    events = build(words)
    assert len(events) >= 2
    assert not any("…" in e.text for e in events)


def test_finished_sentence_before_long_pause_has_no_ellipsis():
    events = build(W("speaker_0", 0.0, "ठीक है।") + W("speaker_0", 3.0, "चलो।"))
    assert not any("…" in e.text for e in events)


def test_no_space_before_punctuation():
    events = build(W("speaker_0", 50.0, "क्या तुम आ रहे हो ? हाँ , मैं आ रहा हूँ ।"))
    assert events[0].text == "क्या तुम आ रहे हो? हाँ, मैं आ रहा हूँ।"
    assert tidy_punctuation_spacing("Hello , world ...") == "Hello, world…"
    assert tidy_punctuation_spacing("Quoi ?", "fr") == "Quoi ?"


def test_quotation_marks():
    assert tidy_quotation_marks(['उसने कहा, " मैं कल आऊँगा "']) == ['उसने कहा, "मैं कल आऊँगा"']
    assert tidy_quotation_marks(['उसने कहा "चलो".']) == ['उसने कहा "चलो."']
    # A quotation spanning two cards: marks only at its start and end
    assert tidy_quotation_marks(['उसने कहा, " हम कल', 'सुबह चलेंगे। "']) == ['उसने कहा, "हम कल', 'सुबह चलेंगे।"']
    assert tidy_quotation_marks(['“ नमस्ते ”']) == ['“नमस्ते”']


def test_dual_card_survives_rebreak_and_autofix():
    profile = get_language_profile("hi")
    dual = "-तुम्हें इस पर काम करना चाहिए।\n-धड़ाम।"
    assert optimize_language_line_breaks(dual, profile, custom_cpl=42) == dual
    assert optimize_line_breaks(dual, 42) == dual
    fixed = auto_fix_subtitles(
        [
            {"id": 1, "start_time": 0.0, "end_time": 2.5, "text": dual, "speakers": ["Speaker 1", "Speaker 2"]},
            {"id": 2, "start_time": 3.0, "end_time": 5.0, "text": "ठीक है, चलो।", "speakers": ["Speaker 1"]},
        ],
        script="devanagari",
    )
    assert fixed[0]["text"] == dual


def test_lint_flags_hyphen_space_and_space_before_punctuation():
    errs = lint_subtitle_event({"id": 1, "start_time": 0.0, "end_time": 2.0, "text": "- हाँ।\n- नहीं ।"})
    ids = {e["rule_id"] for e in errs}
    assert "NF-DUAL-SPEAKER-SPACE" in ids
    assert "NF-PUNCT-SPACE" in ids
    clean = lint_subtitle_event({"id": 1, "start_time": 0.0, "end_time": 2.0, "text": "-हाँ।\n-नहीं।"})
    assert not {"NF-DUAL-SPEAKER-SPACE", "NF-PUNCT-SPACE"} & {e["rule_id"] for e in clean}
