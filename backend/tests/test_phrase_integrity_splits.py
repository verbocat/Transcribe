"""Regression tests: card splits and line breaks must not cut inside a noun phrase, name or verb group."""
from app.netflix_engine import (
    build_netflix_subtitles_from_words,
    find_best_split_point,
    optimize_language_line_breaks,
    get_language_profile,
    phrase_break_cost,
)


def _words(text, speaker="speaker_0", t0=0.0, step=0.33):
    words, t = [], t0
    for w in text.split():
        words.append({"text": w, "start": t, "end": t + 0.28, "speaker": speaker})
        t += step
        if w.endswith((".", "?", "!")):
            t += 0.1
    return words


def _cards(text, lang="en"):
    return [e.text.replace("\n", " ") for e in build_netflix_subtitles_from_words(_words(text), lang)]


def test_super_crystal_is_not_split():
    cards = _cards(
        "You're not still moping around because your mission to steal the super "
        "crystal from the Shadow World was a total failure?"
    )
    assert not any(c.endswith("the super") or c.startswith("crystal") for c in cards), cards
    assert any("super crystal" in c for c in cards), cards
    assert not any(c.endswith("Shadow") for c in cards), cards


def test_line_break_keeps_proper_name_together():
    profile = get_language_profile("en")
    out = optimize_language_line_breaks("from the Shadow World was a total failure that nobody saw", profile)
    for line in out.split("\n"):
        assert not line.endswith("Shadow") and not line.startswith("World"), out


def test_split_point_prefers_clause_over_noun_phrase():
    tokens = [{"text": w, "start": i * 0.3, "end": i * 0.3 + 0.25} for i, w in enumerate(
        "because your mission to steal the super crystal from the Shadow World".split())]
    k = find_best_split_point(tokens, 42)
    assert tokens[k - 1]["text"] != "super"
    assert tokens[k]["text"] not in {"crystal", "World"}


def test_verb_group_and_dangling_conjunction_cost():
    assert phrase_break_cost("was", "a") > phrase_break_cost("failure?", "Of")
    assert phrase_break_cost("because", "your") > phrase_break_cost("around", "because")
    assert phrase_break_cost("steal", "the") >= 0
    assert phrase_break_cost("Shadow", "World") > phrase_break_cost("World", "was")


def test_hindi_postposition_stays_with_noun():
    text = "मुझे गनाडोर की बहुत फ़िक्र हो रही है क्योंकि वह अकेला है और बहुत दूर चला गया है"
    profile = get_language_profile("hi")
    out = optimize_language_line_breaks(text, profile, custom_cpl=45)
    lines = out.split("\n")
    assert len(lines) == 2
    assert lines[1].split()[0] not in {"की", "है", "रही", "से", "में", "को", "के", "का"}, out
    assert lines[0].split()[-1] not in {"क्योंकि", "और", "की", "के"}, out
