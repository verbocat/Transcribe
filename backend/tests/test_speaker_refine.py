from app.speaker_refine import apply_plan, parse_plan, speaker_profiles, _chunks, renumber_by_first_appearance


def L(i, spk, g="Male", t="x"):
    return {"id": i, "speaker": spk, "gender": g, "start": i * 2.0, "end": i * 2.0 + 1.5, "text": t}


LINES = [L(1, "Speaker 1"), L(2, "Speaker 2"), L(3, "Speaker 1"), L(4, "Speaker 3"), L(5, "Speaker 2", "Female"),
         L(6, "Speaker 1"), L(7, "Speaker 3"), L(8, "Speaker 1"), L(9, "Speaker 2", "Female"), L(10, "Speaker 1")]


def plan(merge=(), fix=()):
    return {"merge": [{"from": a, "into": b} for a, b in merge], "fix": [{"id": i, "speaker": s} for i, s in fix]}


def test_parse_plan_ignores_garbage():
    assert parse_plan("not json") == {"merge": [], "fix": []}
    assert parse_plan('{"merge": [{"from": 1}], "fix": [{"id": 3, "speaker": "Speaker 1"}]}') == {
        "merge": [], "fix": [{"id": 3, "speaker": "Speaker 1"}]}


def test_merge_same_gender_ok_and_cross_gender_rejected():
    out = apply_plan(LINES, [plan(merge=[("Speaker 3", "Speaker 1"), ("Speaker 2", "Speaker 1")])])
    assert out["speaker_map"] == {"Speaker 3": "Speaker 1"}


def test_fix_rejects_unknown_speaker_and_gender_clash():
    out = apply_plan(LINES, [plan(fix=[(4, "Speaker 9"), (4, "Speaker 2"), (6, "Speaker 3")])])
    assert out["reassign"] == {6: "Speaker 3"}


def test_chains_collapse_and_overreach_is_ignored():
    out = apply_plan(LINES, [plan(merge=[("Speaker 3", "Speaker 1")], fix=[(2, "Speaker 1")])])
    assert out == {"speaker_map": {"Speaker 3": "Speaker 1"}, "reassign": {}}  # line 2 is male->female clash
    big = apply_plan(LINES, [plan(fix=[(1, "Speaker 3"), (3, "Speaker 3"), (6, "Speaker 3"), (8, "Speaker 3")])])
    assert big == {"speaker_map": {}, "reassign": {}}


def test_chunks_give_lead_in_context():
    lines = [L(i, "Speaker 1") for i in range(1, 300)]
    chunks = _chunks(lines)
    assert chunks[0][0] == [] and len(chunks[1][0]) == 8 and sum(len(c[1]) for c in chunks) == len(lines)


def test_profiles_and_renumber():
    assert speaker_profiles(LINES)["Speaker 2"]["gender"] in ("Male", "Female")

    class S:
        def __init__(self, s): self.speaker = s
    segs = [S("Speaker 3"), S("Speaker 1"), S("Speaker 3")]
    renumber_by_first_appearance(segs)
    assert [s.speaker for s in segs] == ["Speaker 1", "Speaker 2", "Speaker 1"]
