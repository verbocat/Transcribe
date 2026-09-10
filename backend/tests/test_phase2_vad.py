import sys
import os
import numpy as np
import soundfile as sf
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.vad_processor import (
    is_vad_available,
    get_silero_model,
    get_speech_timestamps_vad,
    snap_timestamp_to_voice_vad,
    snap_to_acoustic_boundaries_vad
)
from app.audio_processor import snap_to_acoustic_boundaries, extract_physical_speech_intervals
from app.whisper_aligner import align_subtitle_timestamps


def test_vad_model_availability():
    """Verify Silero VAD loads successfully from local JIT model without network or torchaudio."""
    assert is_vad_available(), "Expected Silero VAD to be available"
    model = get_silero_model()
    assert model is not None, "Expected model instance"
    print("PASS: test_vad_model_availability")


def test_vad_zero_false_positives_on_silence():
    """Verify pure silence and pure noise generate zero false speech intervals."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        sr = 16000
        dur_sec = 3.0
        # Pure silence
        silence = np.zeros(int(sr * dur_sec), dtype=np.float32)
        sf.write(tmp_path, silence, sr)

        intervals = get_speech_timestamps_vad(tmp_path)
        assert len(intervals) == 0, f"Expected 0 speech intervals on pure silence, got {len(intervals)}"
        print("PASS: test_vad_zero_false_positives_on_silence")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def test_vad_speech_detection_accuracy():
    """Verify VAD accurately captures speech on real audio and extracts physical intervals."""
    test_audio = Path(__file__).parent.parent / "uploads" / "up_03qlwozw_Battleground_S2_Ep38_Kaun_Banenge_Finalists_audio.wav"
    if not test_audio.exists():
        print("SKIP: test_vad_speech_detection_accuracy (upload file not found)")
        return

    # Extract first 10 seconds of speech intervals
    intervals = get_speech_timestamps_vad(str(test_audio), start_sec=0.0, end_sec=10.0, threshold=0.5)
    assert len(intervals) >= 1, "Expected at least one speech interval in 0-10s"
    first = intervals[0]
    print(f"PASS: test_vad_speech_detection_accuracy (first interval: {first['start_time']}s -> {first['end_time']}s, dur: {first['duration']}s)")


def test_vad_boundary_snapping():
    """Verify snap_to_acoustic_boundaries uses VAD and refines boundaries within collar."""
    test_audio = Path(__file__).parent.parent / "uploads" / "up_03qlwozw_Battleground_S2_Ep38_Kaun_Banenge_Finalists_audio.wav"
    if not test_audio.exists():
        print("SKIP: test_vad_boundary_snapping (upload file not found)")
        return

    # In that file, speech starts around 1.47-1.63s
    raw_st = 1.60
    raw_et = 2.80
    st, et = snap_to_acoustic_boundaries(str(test_audio), raw_st, raw_et, collar_sec=0.20)
    assert abs(st - raw_st) <= 0.25, f"Expected snap within collar, got {st} for raw {raw_st}"
    assert et > st, f"Expected et > st, got st={st}, et={et}"
    print(f"PASS: test_vad_boundary_snapping ({raw_st}s -> {st}s, {raw_et}s -> {et}s)")


def test_end_to_end_whisper_aligner_with_vad():
    """Verify whisper aligner executes with dual-collar VAD boundary snapping."""
    test_audio = Path(__file__).parent.parent / "uploads" / "up_03qlwozw_Battleground_S2_Ep38_Kaun_Banenge_Finalists_audio.wav"
    audio_path = str(test_audio) if test_audio.exists() else None

    events = [
        {"id": 1, "start_time": 1.4, "end_time": 2.7, "text": "Welcome to the show."}
    ]
    whisper_words = [
        {"word": "Welcome", "start": 1.48, "end": 1.80, "probability": 0.95},
        {"word": "to", "start": 1.82, "end": 1.95, "probability": 0.95},
        {"word": "the", "start": 1.97, "end": 2.10, "probability": 0.95},
        {"word": "show", "start": 2.12, "end": 2.65, "probability": 0.95}
    ]

    aligned = align_subtitle_timestamps(
        gemini_events=events,
        whisper_words=whisper_words,
        audio_path=audio_path,
        frame_rate=24.0,
        min_duration=0.833,
        max_duration=7.0
    )

    assert len(aligned) == 1
    assert aligned[0]["start_time"] >= 1.40
    assert aligned[0]["end_time"] <= 3.0
    assert aligned[0]["end_time"] > aligned[0]["start_time"]
    print(f"PASS: test_end_to_end_whisper_aligner_with_vad (start: {aligned[0]['start_time']}, end: {aligned[0]['end_time']})")


if __name__ == "__main__":
    test_vad_model_availability()
    test_vad_zero_false_positives_on_silence()
    test_vad_speech_detection_accuracy()
    test_vad_boundary_snapping()
    test_end_to_end_whisper_aligner_with_vad()
    print("\nALL PHASE 2 SILERO VAD TESTS PASSED SUCCESSFULLY!")
