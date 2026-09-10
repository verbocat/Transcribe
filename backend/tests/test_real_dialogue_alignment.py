import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.whisper_aligner import (
    align_subtitle_timestamps,
    get_whisper_word_timestamps,
    _normalize_text
)

# Test real clip repeated dialogue lines
def test_real_dialogue_accuracy():
    wav_path = r"d:\Older-transcribe\Transcribe\backend\uploads\temp_chunk_6c861ed5_4.wav"
    words = get_whisper_word_timestamps(wav_path, language="hi", model_name="tiny")
    assert len(words) > 50

    # Test Case 1: The repeated phrase "I am not able to save him"
    # Occurrence A: ~12.0s
    # Occurrence B: ~14.5s
    # Occurrence C: ~16.5s
    events = [
        {"id": 1, "start_time": 12.0, "end_time": 13.0, "text": "I will not be able to save him."},
        {"id": 2, "start_time": 14.2, "end_time": 15.2, "text": "I am not able to save him."},
        {"id": 3, "start_time": 16.2, "end_time": 17.5, "text": "No, I am not able to save him."},
        {"id": 4, "start_time": 53.0, "end_time": 55.5, "text": "So he had to go to the same game."}
    ]

    aligned = align_subtitle_timestamps(events, words, search_radius=8.0, prev_batch_end=0.0)

    # Event 1 should align near 12s, not 14s or 16s
    print(f"Event 1 aligned start: {aligned[0]['start_time']}s (target ~12.0s)")
    assert 11.0 <= aligned[0]['start_time'] <= 13.5

    # Event 2 should align near 14.5s, not jump to 12s or 16s
    print(f"Event 2 aligned start: {aligned[1]['start_time']}s (target ~14.5s)")
    assert 13.5 <= aligned[1]['start_time'] <= 15.5

    # Event 3 should align near 16.0s
    print(f"Event 3 aligned start: {aligned[2]['start_time']}s (target ~16.5s)")
    assert 15.5 <= aligned[2]['start_time'] <= 18.0

    # Event 4 should align near 53.0s, not the earlier repetition at 50s!
    print(f"Event 4 aligned start: {aligned[3]['start_time']}s (target ~53.0s)")
    assert 52.0 <= aligned[3]['start_time'] <= 55.0

    print("ALL REAL DIALOGUE OCCURRENCES ALIGNED TO THEIR EXACT INDIVIDUAL POSITIONS!")

if __name__ == "__main__":
    test_real_dialogue_accuracy()
