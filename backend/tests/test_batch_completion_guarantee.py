import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.gemini_subtitle_generator import (
    audit_and_backfill_speech_coverage,
    group_whisper_words_into_subtitles
)
from app.audio_processor import parse_timestamp

def test_coverage_audit_recovers_empty_gemini_batch():
    """Verify that if Gemini returns 0 subtitles while Whisper detected speech, the batch is 100% recovered."""
    # Simulated physical speech words detected by Whisper Medium (30 seconds of dialogue)
    raw_whisper_words = [
        {"word": "Hello", "start": 1.0, "end": 1.5},
        {"word": "everyone", "start": 1.6, "end": 2.2},
        {"word": "welcome", "start": 2.5, "end": 3.0},
        {"word": "to", "start": 3.1, "end": 3.2},
        {"word": "this", "start": 3.3, "end": 3.5},
        {"word": "special", "start": 3.6, "end": 4.1},
        {"word": "presentation", "start": 4.2, "end": 5.0},
        {"word": "today", "start": 5.2, "end": 5.8},
    ]
    
    # Gemini returned empty list (e.g. hallucinated silence or safety block)
    gemini_subs = []
    
    repaired, was_recovered, msg = audit_and_backfill_speech_coverage(
        subs=gemini_subs,
        raw_whisper_words=raw_whisper_words,
        chunk_idx=1,
        total_chunks=5,
        cpl_limit=42,
        target_language="English"
    )
    
    assert was_recovered is True, "Audit must flag and recover missing batch"
    assert len(repaired) > 0, "Repaired subtitles must contain recovered events"
    assert "Hello everyone" in repaired[0]["text"], f"Expected 'Hello everyone' in text, got: {repaired[0]['text']}"
    print(f"PASS: test_coverage_audit_recovers_empty_gemini_batch (recovered {len(repaired)} events)")


def test_coverage_audit_backfills_trailing_cutoff():
    """Verify that if Gemini cuts off early (e.g. at 10s while dialogue continues to 30s), trailing speech is backfilled."""
    # Gemini only transcribed the first 10 seconds
    gemini_subs = [
        {"id": 1, "start_time": "00:00:01.000", "end_time": "00:00:05.500", "text": "We are starting the meeting now."},
        {"id": 2, "start_time": "00:00:06.000", "end_time": "00:00:09.800", "text": "Please take your seats."}
    ]
    
    # Whisper detected speech continuing until 28.0s (18 seconds of untranscribed dialogue!)
    raw_whisper_words = [
        {"word": "We", "start": 1.0, "end": 1.3},
        {"word": "are", "start": 1.4, "end": 1.6},
        {"word": "starting", "start": 1.7, "end": 2.2},
        {"word": "the", "start": 2.3, "end": 2.4},
        {"word": "meeting", "start": 2.5, "end": 3.0},
        {"word": "now.", "start": 3.1, "end": 3.5},
        # Trailing speech missed by Gemini:
        {"word": "Let", "start": 12.0, "end": 12.3},
        {"word": "us", "start": 12.4, "end": 12.6},
        {"word": "discuss", "start": 12.7, "end": 13.2},
        {"word": "the", "start": 13.3, "end": 13.5},
        {"word": "quarterly", "start": 13.6, "end": 14.3},
        {"word": "budget", "start": 14.4, "end": 15.0},
        {"word": "projections.", "start": 15.1, "end": 16.0},
        {"word": "The", "start": 20.0, "end": 20.3},
        {"word": "revenue", "start": 20.4, "end": 21.0},
        {"word": "is", "start": 21.1, "end": 21.3},
        {"word": "up.", "start": 21.4, "end": 22.0}
    ]
    
    repaired, was_recovered, msg = audit_and_backfill_speech_coverage(
        subs=gemini_subs,
        raw_whisper_words=raw_whisper_words,
        chunk_idx=2,
        total_chunks=5,
        cpl_limit=42,
        target_language="English"
    )
    
    assert was_recovered is True, "Audit must flag trailing speech cutoff"
    assert len(repaired) > len(gemini_subs), "Repaired batch must have more events than truncated Gemini batch"
    
    # Check that original Gemini subtitles are preserved
    assert repaired[0]["text"] == "We are starting the meeting now."
    assert repaired[1]["text"] == "Please take your seats."
    
    # Check that trailing dialogue was added
    trailing_text = " ".join([ev["text"] for ev in repaired[2:]])
    assert "quarterly budget" in trailing_text, f"Expected 'quarterly budget' in trailing, got: {trailing_text}"
    
    last_end = parse_timestamp(repaired[-1]["end_time"])
    assert last_end >= 21.0, f"Expected last end time >= 21.0, got: {last_end}"
    print(f"PASS: test_coverage_audit_backfills_trailing_cutoff (extended from {len(gemini_subs)} to {len(repaired)} events, end at {last_end}s)")


def test_coverage_audit_silence_pass_through():
    """Verify that pure silence / music intervals (0-2 words) do NOT trigger false speech backfills."""
    # Chunk has only instrumental music / noise (no actual speech)
    raw_whisper_words = [
        {"word": "[music]", "start": 10.0, "end": 12.0},
        {"word": "♪", "start": 15.0, "end": 16.0}
    ]
    
    gemini_subs = []
    
    repaired, was_recovered, msg = audit_and_backfill_speech_coverage(
        subs=gemini_subs,
        raw_whisper_words=raw_whisper_words,
        chunk_idx=3,
        total_chunks=5,
        cpl_limit=42,
        target_language="English"
    )
    
    assert was_recovered is False, "Pure silence / music must not trigger false speech recovery"
    assert len(repaired) == 0, "Repaired subtitles must remain empty on silence"
    print("PASS: test_coverage_audit_silence_pass_through")


def test_coverage_audit_leading_gap_prepended():
    """Verify that if Gemini skips the first 15 seconds of speech, the leading speech is prepended."""
    # Gemini only transcribed from 18.0s onwards
    gemini_subs = [
        {"id": 1, "start_time": "00:00:18.000", "end_time": "00:00:22.000", "text": "This is where Gemini started listening."}
    ]
    
    # Whisper detected speech from 1.0s to 12.0s
    raw_whisper_words = [
        {"word": "Hey", "start": 1.0, "end": 1.4},
        {"word": "guys", "start": 1.5, "end": 1.9},
        {"word": "can", "start": 2.0, "end": 2.2},
        {"word": "you", "start": 2.3, "end": 2.5},
        {"word": "hear", "start": 2.6, "end": 3.0},
        {"word": "me", "start": 3.1, "end": 3.5},
        {"word": "clearly?", "start": 3.6, "end": 4.2},
        {"word": "This", "start": 18.0, "end": 18.3},
        {"word": "is", "start": 18.4, "end": 18.6},
        {"word": "where", "start": 18.7, "end": 19.0}
    ]
    
    repaired, was_recovered, msg = audit_and_backfill_speech_coverage(
        subs=gemini_subs,
        raw_whisper_words=raw_whisper_words,
        chunk_idx=4,
        total_chunks=5,
        cpl_limit=42,
        target_language="English"
    )
    
    assert was_recovered is True, "Audit must flag leading speech gap"
    assert len(repaired) >= 2, "Must contain leading events prepended before Gemini subtitle"
    assert "hear me" in repaired[0]["text"], f"Expected 'hear me' in prepended event, got: {repaired[0]['text']}"
    assert repaired[-1]["text"] == "This is where Gemini started listening."
    print("PASS: test_coverage_audit_leading_gap_prepended")


if __name__ == "__main__":
    test_coverage_audit_recovers_empty_gemini_batch()
    test_coverage_audit_backfills_trailing_cutoff()
    test_coverage_audit_silence_pass_through()
    test_coverage_audit_leading_gap_prepended()
    print("\nALL BATCH COMPLETION & COVERAGE GUARANTEE TESTS PASSED 100%!")
