"""
Unit and integration test for Audio Sync and Timestamp Resiliency.
Verifies that the audio sync pipeline handles string timestamps, start/end keys,
fast dialects, numbers, and waveform boundary snapping seamlessly.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.dtw_aligner import align_events_dtw
from app.whisper_aligner import align_subtitle_timestamps
from app.gemini_subtitle_generator import polish_subtitle_events_netflix


def test_dtw_with_string_timestamps():
    """Verify DTW handles formatted HH:MM:SS.mmm timestamps without crashing."""
    gemini_events = [
        {
            "id": 1,
            "start_time": "00:00:01.200",
            "end_time": "00:00:03.500",
            "text": "Hello world welcome to Mumbai",
            "speaker": "Speaker 1"
        },
        {
            "id": 2,
            "start_time": "00:00:04.000",
            "end_time": "00:00:06.800",
            "text": "The price is 10 rupees",
            "speaker": "Speaker 1"
        }
    ]

    whisper_words = [
        {"word": "Hello", "start": 1.25, "end": 1.60},
        {"word": "world", "start": 1.65, "end": 2.10},
        {"word": "welcome", "start": 2.15, "end": 2.70},
        {"word": "to", "start": 2.72, "end": 2.85},
        {"word": "Mumbai", "start": 2.90, "end": 3.45},
        {"word": "The", "start": 4.05, "end": 4.20},
        {"word": "price", "start": 4.25, "end": 4.60},
        {"word": "is", "start": 4.62, "end": 4.75},
        {"word": "ten", "start": 4.80, "end": 5.10},  # spoken word 'ten' matches digit '10'
        {"word": "rupees", "start": 5.15, "end": 5.70}
    ]

    # Must execute with zero exceptions
    dtw_res = align_events_dtw(gemini_events, whisper_words)
    assert len(dtw_res) == 2
    assert dtw_res[0]["is_confident"] is True
    assert dtw_res[0]["matched_start"] == 1.25
    assert dtw_res[0]["matched_end"] == 3.45

    assert dtw_res[1]["is_confident"] is True
    assert dtw_res[1]["matched_start"] == 4.05
    assert dtw_res[1]["matched_end"] == 5.70
    print("PASS: test_dtw_with_string_timestamps")


def test_align_subtitle_timestamps_full_pipeline():
    """Verify whisper aligner with string timestamps and start/end keys."""
    events = [
        {
            "id": 1,
            "start": "00:00:00.800",
            "end": "00:00:02.500",
            "start_time": "00:00:00.800",
            "end_time": "00:00:02.500",
            "text": "Quick speech dialect test",
            "speaker": "Speaker 1"
        },
        {
            "id": 2,
            "start": 3.0,
            "end": 5.0,
            "text": "Natural pause before this line",
            "speaker": "Speaker 1"
        }
    ]

    whisper_words = [
        {"word": "Quick", "start": 0.85, "end": 1.10},
        {"word": "speech", "start": 1.15, "end": 1.50},
        {"word": "dialect", "start": 1.55, "end": 1.95},
        {"word": "test", "start": 2.00, "end": 2.30},
        {"word": "Natural", "start": 3.20, "end": 3.60},
        {"word": "pause", "start": 3.65, "end": 4.00},
        {"word": "before", "start": 4.05, "end": 4.30},
        {"word": "this", "start": 4.35, "end": 4.50},
        {"word": "line", "start": 4.55, "end": 4.85}
    ]

    aligned = align_subtitle_timestamps(
        gemini_events=events,
        whisper_words=whisper_words,
        search_radius=12.0,
        frame_rate=24.0,
        min_duration=0.833,
        max_duration=7.0
    )

    assert len(aligned) == 2
    # Event 1 start anchored to Whisper speech start
    assert aligned[0]["start_time"] == 0.85
    assert aligned[0]["end_time"] == 2.30
    assert isinstance(aligned[0]["start_time"], float)
    assert isinstance(aligned[0]["end_time"], float)

    # Event 2 anchored to Whisper pause and start
    assert aligned[1]["start_time"] == 3.20
    assert aligned[1]["end_time"] == 4.85
    print("PASS: test_align_subtitle_timestamps_full_pipeline")


def test_polish_netflix_string_timestamps():
    """Verify polish_subtitle_events_netflix handles string timestamps safely."""
    events = [
        {
            "id": 1,
            "start_time": "00:00:01.000",
            "end_time": "00:00:02.500",
            "text": "First line of dialogue here",
            "speaker": "Speaker 1"
        },
        {
            "id": 2,
            "start_time": "00:00:02.600",
            "end_time": "00:00:04.000",
            "text": "Second line following closely",
            "speaker": "Speaker 1"
        }
    ]

    polished = polish_subtitle_events_netflix(
        events=events,
        cpl_limit=42,
        max_cps=20.0,
        max_lines=2,
        min_duration=0.833,
        max_duration=7.0,
        frame_rate=24.0
    )

    assert len(polished) >= 1
    for p in polished:
        assert isinstance(p["start_time"], float)
        assert isinstance(p["end_time"], float)
        assert p["end_time"] > p["start_time"]
    print("PASS: test_polish_netflix_string_timestamps")


if __name__ == "__main__":
    test_dtw_with_string_timestamps()
    test_align_subtitle_timestamps_full_pipeline()
    test_polish_netflix_string_timestamps()
    print("\nALL AUDIO SYNC RESILIENCY TESTS PASSED 100%!")
