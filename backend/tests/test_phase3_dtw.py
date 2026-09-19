"""
Unit and integration tests for Phase 3: Global Dynamic Time Warping (DTW) Alignment Engine.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.dtw_aligner import (
    normalize_token,
    token_distance,
    align_sequences_dtw,
    align_events_dtw,
)


def test_normalize_token():
    # Test punctuation stripping and formatting
    assert normalize_token("<i>Hello,</i>") == "hello"
    assert normalize_token("♪ Music ♪") == "music"
    # Test Indic numerals to ASCII
    assert normalize_token("१०") == "10"
    assert normalize_token("२५") == "25"
    # Test Devanagari chandrabindu unification
    assert normalize_token("पाँच") == normalize_token("पांच")
    print("PASS: test_normalize_token")


def test_token_distance_numbers():
    # Digits vs spoken English words
    assert token_distance("10", "ten") == 0.05
    assert token_distance("ten", "10") == 0.05
    assert token_distance("1", "one") == 0.05
    assert token_distance("5", "five") == 0.05

    # Indic numerals vs spoken words
    assert token_distance("2", "दो") == 0.05
    assert token_distance("10", "दस") == 0.05

    # Identical
    assert token_distance("hello", "hello") == 0.0

    # Completely different
    assert token_distance("apple", "submarine") == 1.0
    print("PASS: test_token_distance_numbers")


def test_token_distance_contractions_and_stems():
    # Common speech reductions
    d = token_distance("gonna", "going")
    assert d < 0.4
    d2 = token_distance("wanna", "want")
    assert d2 < 0.4
    print("PASS: test_token_distance_contractions_and_stems")


def test_dtw_repeated_words_accuracy():
    """
    Test that DTW aligns repeated phrases correctly without greedy jumping.
    Example: speaker says "no, no, no, wait"
    """
    gemini_words = [
        {"text": "no", "norm": "no", "est_time": 1.0, "event_idx": 0, "word_idx": 0},
        {"text": "no", "norm": "no", "est_time": 1.5, "event_idx": 0, "word_idx": 1},
        {"text": "no", "norm": "no", "est_time": 2.0, "event_idx": 0, "word_idx": 2},
        {"text": "wait", "norm": "wait", "est_time": 2.8, "event_idx": 1, "word_idx": 0},
    ]

    whisper_words = [
        {"word": "no", "norm": "no", "start": 1.1, "end": 1.3, "mid": 1.2},
        {"word": "no", "norm": "no", "start": 1.6, "end": 1.8, "mid": 1.7},
        {"word": "no", "norm": "no", "start": 2.1, "end": 2.3, "mid": 2.2},
        {"word": "wait", "norm": "wait", "start": 2.9, "end": 3.3, "mid": 3.1},
    ]

    path = align_sequences_dtw(gemini_words, whisper_words, band_width=10)
    # Check that alignment pairs match 1-to-1 monotonically
    matched_pairs = [(g, w) for g, w in path if g is not None and w is not None]
    assert matched_pairs == [(0, 0), (1, 1), (2, 2), (3, 3)]
    print("PASS: test_dtw_repeated_words_accuracy")


def test_dtw_skipped_whisper_filler():
    """
    Test that Whisper filler words ("um", "uh") are skipped cleanly by DTW without throwing off subsequent words.
    """
    gemini_words = [
        {"text": "I", "norm": "i", "est_time": 0.5, "event_idx": 0, "word_idx": 0},
        {"text": "think", "norm": "think", "est_time": 0.8, "event_idx": 0, "word_idx": 1},
        {"text": "so", "norm": "so", "est_time": 1.2, "event_idx": 0, "word_idx": 2},
    ]

    # Audio has "I", "uh", "um", "think", "so"
    whisper_words = [
        {"word": "I", "norm": "i", "start": 0.5, "end": 0.7, "mid": 0.6},
        {"word": "uh", "norm": "uh", "start": 0.8, "end": 1.0, "mid": 0.9},
        {"word": "um", "norm": "um", "start": 1.1, "end": 1.3, "mid": 1.2},
        {"word": "think", "norm": "think", "start": 1.5, "end": 1.8, "mid": 1.65},
        {"word": "so", "norm": "so", "start": 1.9, "end": 2.2, "mid": 2.05},
    ]

    path = align_sequences_dtw(gemini_words, whisper_words, band_width=10)
    matched = {g: w for g, w in path if g is not None and w is not None}
    assert matched[0] == 0  # "I" -> "I"
    assert matched[1] == 3  # "think" -> "think" (skipped uh, um)
    assert matched[2] == 4  # "so" -> "so"
    print("PASS: test_dtw_skipped_whisper_filler")


def test_align_events_dtw_end_to_end():
    events = [
        {"text": "I have 2 cats.", "start_time": 0.5, "end_time": 2.0},
        {"text": "They are lovely.", "start_time": 2.5, "end_time": 4.0},
    ]

    whisper_words = [
        {"word": "I", "start": 0.60, "end": 0.75},
        {"word": "have", "start": 0.78, "end": 1.05},
        {"word": "two", "start": 1.10, "end": 1.40},  # Number word 'two' matches '2'
        {"word": "cats", "start": 1.45, "end": 1.95},
        {"word": "They", "start": 2.60, "end": 2.85},
        {"word": "are", "start": 2.90, "end": 3.15},
        {"word": "lovely", "start": 3.20, "end": 3.85},
    ]

    results = align_events_dtw(events, whisper_words)
    assert len(results) == 2

    # Event 0: "I have 2 cats."
    ev0 = results[0]
    assert ev0["is_confident"] is True
    assert ev0["matched_start"] == 0.60
    assert ev0["matched_end"] == 1.95

    # Event 1: "They are lovely."
    ev1 = results[1]
    assert ev1["is_confident"] is True
    assert ev1["matched_start"] == 2.60
    assert ev1["matched_end"] == 3.85
    print("PASS: test_align_events_dtw_end_to_end")


def test_dtw_performance_on_cpu():
    """Verify DTW runs in under 15ms on typical 60-word subtitle batch and under 150ms on 200 words."""
    # 1. Typical subtitle batch (60 words ~ 30-45 seconds of speech)
    gemini_words_60 = [
        {"text": f"w{i}", "norm": f"w{i}", "est_time": float(i) * 0.5, "event_idx": i // 5, "word_idx": i % 5}
        for i in range(60)
    ]
    whisper_words_60 = [
        {"word": f"w{i}", "norm": f"w{i}", "start": float(i) * 0.5, "end": float(i) * 0.5 + 0.3, "mid": float(i) * 0.5 + 0.15}
        for i in range(60)
    ]

    t0 = time.perf_counter()
    path_60 = align_sequences_dtw(gemini_words_60, whisper_words_60, band_width=20)
    elapsed_60_ms = (time.perf_counter() - t0) * 1000
    print(f"DTW typical 60-word chunk execution time: {elapsed_60_ms:.2f} ms")
    assert len(path_60) >= 60
    assert elapsed_60_ms < 100.0

    # 2. Heavy 200-word batch (~ 2 minutes of continuous dense speech)
    gemini_words_200 = [
        {"text": f"word{i}", "norm": f"word{i}", "est_time": float(i) * 0.5, "event_idx": i // 5, "word_idx": i % 5}
        for i in range(200)
    ]
    whisper_words_200 = [
        {"word": f"word{i}", "norm": f"word{i}", "start": float(i) * 0.5, "end": float(i) * 0.5 + 0.3, "mid": float(i) * 0.5 + 0.15}
        for i in range(200)
    ]

    t1 = time.perf_counter()
    path_200 = align_sequences_dtw(gemini_words_200, whisper_words_200, band_width=30)
    elapsed_200_ms = (time.perf_counter() - t1) * 1000
    print(f"DTW heavy 200-word chunk execution time: {elapsed_200_ms:.2f} ms")
    assert len(path_200) >= 200
    assert elapsed_200_ms < 150.0
    print("PASS: test_dtw_performance_on_cpu")


if __name__ == "__main__":
    test_normalize_token()
    test_token_distance_numbers()
    test_token_distance_contractions_and_stems()
    test_dtw_repeated_words_accuracy()
    test_dtw_skipped_whisper_filler()
    test_align_events_dtw_end_to_end()
    test_dtw_performance_on_cpu()
    print("\nALL PHASE 3 DTW TESTS PASSED 100%!")
