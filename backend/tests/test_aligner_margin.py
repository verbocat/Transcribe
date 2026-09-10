import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.whisper_aligner import (
    _find_best_span,
    _normalize_text,
    align_subtitle_timestamps,
    DISTINCT_OCCURRENCE_GAP_SEC
)


def match_candidate(clean_words, orig_st, audio_cursor, whisper_words):
    """Adapter invoking the real production _find_best_span function."""
    clean_words = [_normalize_text(w) for w in clean_words if _normalize_text(w)]
    target_norm = " ".join(clean_words)
    target_len = len(clean_words)
    total_w = len(whisper_words)
    search_start = 0

    best_s_idx, best_e_idx, best_score, second_best_score, is_confident = _find_best_span(
        clean_words=clean_words,
        target_norm=target_norm,
        target_len=target_len,
        orig_st=orig_st,
        audio_cursor=audio_cursor,
        whisper_words=whisper_words,
        search_start=search_start,
        total_w=total_w
    )

    matched_start = whisper_words[best_s_idx]["start"] if (is_confident and best_s_idx is not None) else orig_st

    return {
        "best_score": best_score,
        "second_best_score": second_best_score,
        "best_s_idx": best_s_idx,
        "best_e_idx": best_e_idx,
        "is_confident": is_confident,
        "matched_start": matched_start
    }


def test_repeated_phrase_selection():
    # Word 'okay' repeated at 5s and 25s; target subtitle at 25s
    whisper_words = [
        {"word": "okay", "start": 5.0, "end": 5.5},
        {"word": "let", "start": 5.6, "end": 6.0},
        {"word": "us", "start": 6.1, "end": 6.5},
        {"word": "okay", "start": 24.8, "end": 25.2},
        {"word": "done", "start": 25.3, "end": 25.8},
    ]
    res = match_candidate(["okay"], orig_st=25.0, audio_cursor=0.0, whisper_words=whisper_words)
    assert res["is_confident"] is True
    assert res["matched_start"] == 24.8, f"Expected 24.8, got {res['matched_start']}"
    assert res["best_score"] - res["second_best_score"] > 0.08


def test_ambiguous_repetition_falls_back():
    # Identical phrase occurring equidistant from orig_st (ambiguous)
    whisper_words = [
        {"word": "haan", "start": 10.0, "end": 10.5},
        {"word": "haan", "start": 14.0, "end": 14.5},
    ]
    # orig_st is right in the middle at 12.0s
    res = match_candidate(["haan"], orig_st=12.0, audio_cursor=0.0, whisper_words=whisper_words)
    # Scores for both candidates are identical, so margin is 0.0 -> must fall back to orig_st!
    assert res["is_confident"] is False
    assert res["matched_start"] == 12.0


def test_low_confidence_falls_back():
    # Weak phonetic match
    whisper_words = [
        {"word": "something", "start": 10.0, "end": 10.8},
        {"word": "different", "start": 11.0, "end": 11.8},
    ]
    res = match_candidate(["hello", "world"], orig_st=10.0, audio_cursor=0.0, whisper_words=whisper_words)
    assert res["is_confident"] is False
    assert res["matched_start"] == 10.0


def test_distinct_occurrence_gap_tightened():
    # Fix 2: Rapid filler exchange 1.0s apart (<1.5s, but >0.6s)
    whisper_words = [
        {"word": "haan", "start": 10.0, "end": 10.4},
        {"word": "haan", "start": 11.0, "end": 11.4},
    ]
    # If target is at 10.5s equidistant between them, both candidates are competing occurrences
    # With 0.6s threshold, the second 'haan' at 11.0s (> 0.6s from 10.0s) MUST register as second_best_score!
    res = match_candidate(["haan"], orig_st=10.5, audio_cursor=0.0, whisper_words=whisper_words)
    assert res["second_best_score"] > 0.0, "Competing occurrence 1.0s away was wrongly ignored!"
    assert res["is_confident"] is False, "Equidistant rapid filler repetition must be marked ambiguous!"


def test_overlap_trimming_protects_confident_line():
    # Fix 1: Confident previous line must NEVER be trimmed by an overlapping follower
    whisper_words = [
        {"word": "first", "start": 5.0, "end": 5.8},
        {"word": "sentence", "start": 5.9, "end": 7.0},
    ]
    events = [
        # Line 0 matches whisper words with high confidence (5.0s - 7.0s)
        {"id": 1, "start_time": 5.0, "end_time": 7.0, "text": "first sentence"},
        # Line 1 has low confidence text that falls back to orig_st = 6.8s (collides with Line 0 end 7.0s)
        {"id": 2, "start_time": 6.8, "end_time": 8.5, "text": "unmatched fallback line"},
    ]

    aligned = align_subtitle_timestamps(events, whisper_words, search_radius=8.0, prev_batch_end=0.0)

    # Line 0 was confident, so its end_time must NOT be trimmed to < 7.0s!
    assert aligned[0]["end_time"] == 7.0, f"Line 0 was corrupted! end_time was {aligned[0]['end_time']}, expected 7.0"
    # Line 1 must be pushed after Line 0 (7.0 + min_gap 0.083 = 7.083s)
    assert aligned[1]["start_time"] >= 7.083, f"Line 1 was not pushed properly: {aligned[1]['start_time']}"
    # Ensure internal private tag is stripped
    assert "_aligned_confident" not in aligned[0]
    assert "_aligned_confident" not in aligned[1]


def test_devanagari_hindi_alignment():
    # Verify Devanagari Hindi alignment with matras, dandas, and chandrabindu/anusvara variations
    whisper_words = [
        {"word": "हाँ", "start": 3.2, "end": 3.6},
        {"word": "ठीक", "start": 3.7, "end": 4.1},
        {"word": "है", "start": 4.2, "end": 4.5},
        {"word": "नमस्ते", "start": 12.0, "end": 12.8},
        {"word": "आप", "start": 12.9, "end": 13.2},
        {"word": "कैसे", "start": 13.3, "end": 13.7},
        {"word": "हैं", "start": 13.8, "end": 14.1},
    ]
    events = [
        # Gemini wrote 'हां ठीक है।' with anusvara and danda
        {"id": 1, "start_time": 3.0, "end_time": 4.5, "text": "हां ठीक है।"},
        # Gemini wrote 'नमस्ते! आप कैसे हैं?' with punctuation
        {"id": 2, "start_time": 12.1, "end_time": 14.2, "text": "नमस्ते! आप कैसे हैं?"},
    ]

    aligned = align_subtitle_timestamps(events, whisper_words, search_radius=8.0, prev_batch_end=0.0)

    # Event 1: Matched Devanagari words accurately
    assert aligned[0]["start_time"] == 3.2, f"Expected 3.2, got {aligned[0]['start_time']}"
    assert aligned[0]["end_time"] == 4.5, f"Expected 4.5, got {aligned[0]['end_time']}"

    # Event 2: Matched Devanagari sentence accurately
    assert aligned[1]["start_time"] == 12.0, f"Expected 12.0, got {aligned[1]['start_time']}"
    assert aligned[1]["end_time"] == 14.1, f"Expected 14.1, got {aligned[1]['end_time']}"


if __name__ == "__main__":
    test_repeated_phrase_selection()
    test_ambiguous_repetition_falls_back()
    test_low_confidence_falls_back()
    test_distinct_occurrence_gap_tightened()
    test_overlap_trimming_protects_confident_line()
    test_devanagari_hindi_alignment()
    print("ALL TESTS PASSED SUCCESSFULLY!")

