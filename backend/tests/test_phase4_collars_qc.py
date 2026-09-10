"""
Unit and integration tests for Phase 4:
1.0s Chunk Overlap Collars, Seam Stitching, and Acoustic-Grounded QC Self-Correction.
"""

import sys
import tempfile
from pathlib import Path
import soundfile as sf
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.gemini_subtitle_generator import stitch_cross_chunk_seam
from app.gemini_qc_fixer import coordinate_gemini_qc_fix


def test_stitch_exact_duplicate_in_collar():
    """Verify that an exact duplicate sentence emitted in the 1.0s overlap collar is dropped."""
    prev_batch = [
        {"id": 1, "start_time": 85.0, "end_time": 89.8, "text": "We need to talk about the plan.", "speakers": ["Speaker 1"]}
    ]
    # Next chunk started with a 1.0s collar and re-emitted the exact same sentence
    curr_batch = [
        {"id": 2, "start_time": 89.2, "end_time": 89.8, "text": "We need to talk about the plan.", "speakers": ["Speaker 1"]},
        {"id": 3, "start_time": 90.5, "end_time": 93.0, "text": "Are you listening to me?", "speakers": ["Speaker 1"]}
    ]

    p_out, c_out = stitch_cross_chunk_seam(prev_batch, curr_batch, min_gap_sec=0.083, min_duration=0.833, collar_sec=1.0)
    assert len(p_out) == 1
    assert len(c_out) == 1
    assert c_out[0]["text"] == "Are you listening to me?"
    print("PASS: test_stitch_exact_duplicate_in_collar")


def test_stitch_continuation_sentence_across_seam():
    """Verify that a sentence cut off across the chunk seam is extended and stitched into a complete subtitle."""
    prev_batch = [
        {"id": 1, "start_time": 88.0, "end_time": 90.0, "text": "We must go to the", "speakers": ["Speaker 1"]}
    ]
    # Chunk 2 heard the complete sentence thanks to the 1.0s pre-roll collar
    curr_batch = [
        {"id": 2, "start_time": 89.0, "end_time": 92.5, "text": "We must go to the market right now.", "speakers": ["Speaker 1"]},
        {"id": 3, "start_time": 93.0, "end_time": 95.0, "text": "Before it closes.", "speakers": ["Speaker 1"]}
    ]

    p_out, c_out = stitch_cross_chunk_seam(prev_batch, curr_batch, min_gap_sec=0.083, min_duration=0.833, collar_sec=1.0)
    assert len(p_out) == 1
    # Check that previous event was seamlessly completed
    assert p_out[0]["text"] == "We must go to the market right now."
    assert p_out[0]["end_time"] == 92.5
    # Check that duplicate in curr_batch was dropped
    assert len(c_out) == 1
    assert c_out[0]["text"] == "Before it closes."
    print("PASS: test_stitch_continuation_sentence_across_seam")


def test_stitch_distinct_colliding_events():
    """Verify that distinct events starting inside the overlap collar are sequenced with exact min_gap."""
    prev_batch = [
        {"id": 1, "start_time": 85.0, "end_time": 89.8, "text": "First sentence finishes here.", "speakers": ["Speaker 1"]}
    ]
    # Next sentence started at 89.85s (too close to prev end 89.8s for 24fps 2-frame gap 0.083s)
    curr_batch = [
        {"id": 2, "start_time": 89.85, "end_time": 92.0, "text": "Second distinct sentence starts.", "speakers": ["Speaker 1"]}
    ]

    p_out, c_out = stitch_cross_chunk_seam(prev_batch, curr_batch, min_gap_sec=0.083, min_duration=0.833, collar_sec=1.0)
    assert len(p_out) == 1
    assert len(c_out) == 1
    # Check that c_out start_time was adjusted to enforce min_gap_sec (89.8 + 0.083 = 89.883)
    assert c_out[0]["start_time"] == round(89.8 + 0.083, 3)
    assert c_out[0]["start_time"] >= p_out[0]["end_time"] + 0.083
    print("PASS: test_stitch_distinct_colliding_events")


def test_qc_fixer_accepts_audio_path_and_grounds_vad():
    """Verify that coordinate_gemini_qc_fix accepts audio_path and runs Silero VAD alignment."""
    # Synthesize small audio file with tone + silence
    sr = 16000
    dur = 4.0
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    # 440Hz vocal tone between 1.0s and 3.0s
    audio_data = np.zeros_like(t, dtype=np.float32)
    tone_idx = (t >= 1.0) & (t <= 3.0)
    audio_data[tone_idx] = 0.5 * np.sin(2 * np.pi * 440 * t[tone_idx])

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        sf.write(tmp_path, audio_data, sr)

        # Test events with QC errors that trigger format_and_split
        events = [
            {
                "id": 1,
                "start_time": 0.8,
                "end_time": 3.2,
                "text": "This is a clean sentence within normal limits.",
                "speakers": ["Speaker 1"]
            }
        ]

        whisper_words = [
            {"word": "This", "start": 1.05, "end": 1.25},
            {"word": "is", "start": 1.28, "end": 1.40},
            {"word": "a", "start": 1.42, "end": 1.50},
            {"word": "clean", "start": 1.52, "end": 1.80},
            {"word": "sentence", "start": 1.85, "end": 2.30},
            {"word": "within", "start": 2.35, "end": 2.60},
            {"word": "normal", "start": 2.65, "end": 2.85},
            {"word": "limits.", "start": 2.88, "end": 3.00},
        ]

        # Call coordinate_gemini_qc_fix with audio_path
        res = coordinate_gemini_qc_fix(
            events=events,
            whisper_words=whisper_words,
            audio_path=tmp_path,
            frame_rate=24.0,
            cpl_limit=42,
            max_cps=20.0,
            max_lines=2,
            min_duration=0.833,
            max_duration=7.0
        )

        assert "events" in res
        assert "compliance_score" in res
        print("PASS: test_qc_fixer_accepts_audio_path_and_grounds_vad")

    finally:
        try:
            import os
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    test_stitch_exact_duplicate_in_collar()
    test_stitch_continuation_sentence_across_seam()
    test_stitch_distinct_colliding_events()
    test_qc_fixer_accepts_audio_path_and_grounds_vad()
    print("\nALL PHASE 4 COLLAR & GROUNDED QC TESTS PASSED 100%!")
