from app.gemini_subtitle_generator import merge_short_fragments, polish_subtitle_events_netflix
from app.whisper_aligner import align_subtitle_timestamps

def test_all():
    # Test 1: merge_short_fragments does NOT merge across terminal punctuation if pause >= 0.15s
    evs = [
        {'start_time': 1.0, 'end_time': 2.0, 'text': 'I will call you tomorrow.', 'speakers': ['Speaker 1']},
        {'start_time': 2.2, 'end_time': 2.6, 'text': "Don't worry.", 'speakers': ['Speaker 1']}
    ]
    res1 = merge_short_fragments(evs)
    assert len(res1) == 2, f"Expected 2 events, got {len(res1)}"

    # Test 2: conversational starters are kept distinct
    evs2 = [
        {'start_time': 1.0, 'end_time': 2.0, 'text': 'Are you coming?', 'speakers': ['Speaker 1']},
        {'start_time': 2.1, 'end_time': 2.4, 'text': 'Haan bilkul.', 'speakers': ['Speaker 1']}
    ]
    res2 = merge_short_fragments(evs2)
    assert len(res2) == 2, f"Expected 2 events, got {len(res2)}"

    # Test 3: polish_subtitle_events_netflix NEVER pushes start_time backward
    evs3 = [
        {'start_time': 1.0, 'end_time': 1.4, 'text': 'Wait!', 'speakers': ['Speaker 1']},
        {'start_time': 1.5, 'end_time': 3.0, 'text': 'What do you want to say?', 'speakers': ['Speaker 2']}
    ]
    res3 = polish_subtitle_events_netflix(evs3, frame_rate=24.0, min_duration=0.833)
    assert res3[0]['start_time'] == 1.0, f"Expected start_time 1.0, got {res3[0]['start_time']}"
    assert res3[0]['end_time'] <= 1.5 - (2.0 / 24.0) + 0.001, f"Expected end_time <= 1.417, got {res3[0]['end_time']}"

    # Test 4: Whisper circuit breaker with repetition runaway
    events_in = [{'text': 'Hello world this is a realistic test with more than ten words in subtitle', 'start_time': 1.0, 'end_time': 4.0}]
    fake_whisper = [{'word': 'word', 'start': float(i)*0.1, 'end': float(i)*0.1 + 0.05} for i in range(100)]
    res4 = align_subtitle_timestamps(events_in, fake_whisper)
    assert res4 == events_in, "Circuit breaker should have triggered on repetition runaway"

    # Test 5: Whisper circuit breaker with severe word drop (fast/slurred speech)
    fake_whisper_sparse = [{'word': 'Hello', 'start': 1.0, 'end': 1.2}]
    res5 = align_subtitle_timestamps(events_in, fake_whisper_sparse)
    assert res5 == events_in, "Circuit breaker should have triggered on undercount drop"

    print("ALL 5 CHECKS PASSED PERFECTLY!")

if __name__ == "__main__":
    test_all()
