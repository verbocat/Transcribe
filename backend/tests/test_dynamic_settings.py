import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.netflix_linter import auto_chain_gaps
from app.gemini_subtitle_generator import (
    resolve_batch_timestamps,
    split_and_balance_event,
    polish_subtitle_events_netflix
)
from app.whisper_aligner import align_subtitle_timestamps


def test_auto_chain_gaps_dynamic_settings():
    """Verify auto_chain_gaps dynamically respects user min_duration, max_cps, and frame_rate."""
    # Test with custom min_duration = 0.5s instead of default 0.833s
    events = [
        {"id": 1, "start_time": 1.0, "end_time": 1.4, "text": "Short phrase."},
        {"id": 2, "start_time": 1.45, "end_time": 2.5, "text": "Second phrase."}
    ]
    # At 25 fps, min_gap is 2/25 = 0.080s. With min_duration = 0.5s
    chained = auto_chain_gaps(events, frame_rate=25.0, min_duration=0.5, max_cps=22.0)
    assert chained[1]["start_time"] <= 1.45, "Start time of next event must never shift forward"
    assert chained[0]["end_time"] <= round(1.45 - (2.0 / 25.0), 3) + 0.001
    print("PASS: test_auto_chain_gaps_dynamic_settings (min_duration=0.5s, fps=25)")

    # Test with custom max_cps = 25.0 (does not trigger gap chaining if CPS is under 25)
    events2 = [
        {"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "Twenty characters!!"},  # len=20, dur=1.0 -> cps=20
        {"id": 2, "start_time": 2.3, "end_time": 3.5, "text": "Next phrase."}  # gap=0.3s (~7.2 frames @ 24fps)
    ]
    # With max_cps=25.0, cps=20 is comfortable, gap=0.3s (>0.18s) should NOT be bridged
    chained2 = auto_chain_gaps(events2, frame_rate=24.0, min_duration=0.833, max_cps=25.0)
    assert chained2[0]["end_time"] <= 2.05, f"Expected end <= 2.05, got {chained2[0]['end_time']}"
    print("PASS: test_auto_chain_gaps_dynamic_settings (max_cps=25.0 unbridged)")


def test_whisper_aligner_dynamic_frame_rate():
    """Verify align_subtitle_timestamps computes min_gap based on custom frame_rate."""
    gemini_events = [
        {"id": 1, "text": "Hello world", "start_time": 1.0, "end_time": 2.0},
        {"id": 2, "text": "Another test", "start_time": 2.02, "end_time": 3.0}
    ]
    whisper_words = [
        {"word": "Hello", "start": 1.05, "end": 1.35},
        {"word": "world", "start": 1.40, "end": 1.70},
        {"word": "Another", "start": 2.05, "end": 2.40},
        {"word": "test", "start": 2.45, "end": 2.80},
    ]

    # At 60 fps, min_gap = 2 / 60 = 0.033s
    aligned_60 = align_subtitle_timestamps(
        gemini_events,
        whisper_words,
        frame_rate=60.0,
        min_duration=0.5,
        max_duration=6.0
    )
    gap_60 = aligned_60[1]["start_time"] - aligned_60[0]["end_time"]
    assert gap_60 >= 0.030, f"Expected gap >= 0.030s for 60fps, got {gap_60}"
    print(f"PASS: test_whisper_aligner_dynamic_frame_rate (60fps gap: {gap_60:.3f}s)")

    # At 25 fps, min_gap = 2 / 25 = 0.080s
    aligned_25 = align_subtitle_timestamps(
        gemini_events,
        whisper_words,
        frame_rate=25.0,
        min_duration=0.5,
        max_duration=6.0
    )
    gap_25 = aligned_25[1]["start_time"] - aligned_25[0]["end_time"]
    assert gap_25 >= 0.075, f"Expected gap >= 0.075s for 25fps, got {gap_25}"
    print(f"PASS: test_whisper_aligner_dynamic_frame_rate (25fps gap: {gap_25:.3f}s)")


def test_split_and_balance_event_dynamic():
    """Verify split_and_balance_event uses custom min_duration and frame_rate."""
    long_ev = {
        "id": 1,
        "start_time": 0.0,
        "end_time": 4.0,
        "text": "This is a sentence that is deliberately very long so that it exceeds twenty-eight characters on a single line."
    }
    # Custom 50 fps (min_gap = 2/50 = 0.040s) and min_duration = 0.6s
    splits = split_and_balance_event(long_ev, cpl_limit=28, max_lines=2, min_duration=0.6, frame_rate=50.0)
    assert len(splits) >= 2, "Expected splits"
    for s in splits:
        dur = s["end_time"] - s["start_time"]
        assert dur >= 0.55, f"Expected dur >= 0.55s, got {dur}"
    gap = round(splits[1]["start_time"] - splits[0]["end_time"], 3)
    assert abs(gap - 0.040) < 0.005, f"Expected 50fps gap ~0.040s, got {gap}"
    print(f"PASS: test_split_and_balance_event_dynamic (50fps gap: {gap}s)")


def test_resolve_batch_timestamps_dynamic():
    """Verify resolve_batch_timestamps uses custom min_duration and gap."""
    subs = [
        {"start_time": 0.1, "end_time": 0.3, "text": "Very quick sound."}
    ]
    # Pass custom min_duration=0.5s instead of default 0.833s
    resolved = resolve_batch_timestamps(
        subs,
        chunk_s=10.0,
        chunk_e=20.0,
        min_gap_sec=0.067,
        min_duration=0.5
    )
    dur = resolved[0]["end_time"] - resolved[0]["start_time"]
    assert abs(dur - 0.5) < 0.01, f"Expected dur=0.5s, got {dur}"
    print(f"PASS: test_resolve_batch_timestamps_dynamic (dur: {dur}s)")


if __name__ == "__main__":
    test_auto_chain_gaps_dynamic_settings()
    test_whisper_aligner_dynamic_frame_rate()
    test_split_and_balance_event_dynamic()
    test_resolve_batch_timestamps_dynamic()
    print("\nALL DYNAMIC SETTINGS & FRAME RATE TESTS PASSED!")
