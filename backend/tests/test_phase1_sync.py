import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.netflix_linter import auto_chain_gaps
from app.gemini_subtitle_generator import (
    polish_subtitle_events_netflix,
    split_and_balance_event,
    resolve_batch_timestamps
)


def test_no_cascading_forward_drift_resolve_batch():
    """Verify resolve_batch_timestamps does NOT push subsequent events forward when curr event is short."""
    subs = [
        {"start_time": 0.2, "end_time": 0.4, "text": "Yes."},
        {"start_time": 0.5, "end_time": 2.0, "text": "I understand completely."}
    ]
    resolved = resolve_batch_timestamps(
        subs,
        chunk_s=0.0,
        chunk_e=10.0,
        min_gap_sec=0.083,
        min_duration=0.833
    )

    # Event 2 start must remain anchored to speech onset at 0.5s, NEVER pushed forward!
    assert resolved[1]["start_time"] <= 0.50, f"Expected event 2 start <= 0.50, got {resolved[1]['start_time']}"
    # Event 1 end must not collide with Event 2 start
    assert resolved[0]["end_time"] <= resolved[1]["start_time"] - 0.083, f"Expected event 1 end <= {resolved[1]['start_time'] - 0.083}, got {resolved[0]['end_time']}"
    print(f"PASS: test_no_cascading_forward_drift_resolve_batch (ev1: {resolved[0]['start_time']}->{resolved[0]['end_time']}, ev2 start: {resolved[1]['start_time']})")


def test_no_cascading_forward_drift_linter():
    """Verify auto_chain_gaps does NOT push next_start forward when curr event is short."""
    events = [
        {"id": 1, "start_time": 1.0, "end_time": 1.4, "text": "Yes."},
        {"id": 2, "start_time": 1.45, "end_time": 3.0, "text": "I understand completely."}
    ]
    chained = auto_chain_gaps(events, frame_rate=24.0)

    # Next event start must NEVER be pushed into the future (past its acoustic speech onset)
    assert chained[1]["start_time"] <= 1.45, f"Expected next_start <= 1.45, got {chained[1]['start_time']}"
    assert chained[0]["end_time"] <= chained[1]["start_time"] - 0.083
    print("PASS: test_no_cascading_forward_drift_linter")


def test_no_cascading_forward_drift_polish():
    """Verify polish_subtitle_events_netflix does NOT push subsequent events forward."""
    events = [
        {"id": 1, "start_time": 10.0, "end_time": 10.5, "text": "No."},
        {"id": 2, "start_time": 10.55, "end_time": 12.5, "text": "That is completely wrong."}
    ]
    polished = polish_subtitle_events_netflix(events, frame_rate=24.0, min_duration=0.833)

    # Event 2 start time must remain pinned to speech onset (~10.55), not delayed
    assert polished[1]["start_time"] <= 10.56, f"Expected start <= 10.56, got {polished[1]['start_time']}"
    print("PASS: test_no_cascading_forward_drift_polish")


def test_tamed_gap_chaining():
    """Verify that subtitles do NOT linger across natural 400ms conversational pauses."""
    events = [
        {"id": 1, "start_time": 1.0, "end_time": 2.5, "text": "This is a clean sentence."},
        {"id": 2, "start_time": 2.9, "end_time": 4.5, "text": "Followed by another clean sentence."}
    ]
    # Gap is 0.40s (9.6 frames @ 24fps)
    polished = polish_subtitle_events_netflix(events, frame_rate=24.0)

    # Subtitle 1 has duration 1.5s (CPS ~17) -> comfortable. It should NOT stretch across the 400ms pause!
    assert polished[0]["end_time"] <= 2.65, f"Expected end <= 2.65, got {polished[0]['end_time']}"
    print("PASS: test_tamed_gap_chaining")


def test_acoustic_word_split_anchoring():
    """Verify split_and_balance_event anchors split_time directly to Whisper word start."""
    long_event = {
        "id": 1,
        "start_time": 5.0,
        "end_time": 10.0,
        "text": "This is an extremely long subtitle line that definitely needs to be split across two separate events because it exceeds forty-two characters."
    }
    whisper_words = [
        {"word": "This", "start": 5.0, "end": 5.2},
        {"word": "is", "start": 5.25, "end": 5.35},
        {"word": "an", "start": 5.4, "end": 5.5},
        {"word": "because", "start": 7.82, "end": 8.10},
        {"word": "it", "start": 8.12, "end": 8.20},
    ]
    # Split event passing whisper_words
    splits = split_and_balance_event(long_event, cpl_limit=42, max_lines=2, whisper_words=whisper_words)
    assert len(splits) >= 2, "Expected event to be split"
    print(f"Splits count: {len(splits)}, Part 1 end: {splits[0]['end_time']}, Part 2 start: {splits[1]['start_time']}")
    print("PASS: test_acoustic_word_split_anchoring")


if __name__ == "__main__":
    test_no_cascading_forward_drift_resolve_batch()
    test_no_cascading_forward_drift_linter()
    test_no_cascading_forward_drift_polish()
    test_tamed_gap_chaining()
    test_acoustic_word_split_anchoring()
    print("\nALL PHASE 1 SYNCHRONIZATION TESTS PASSED SUCCESSFULLY!")
