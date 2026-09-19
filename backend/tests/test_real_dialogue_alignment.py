import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from app.audio_processor import snap_to_acoustic_boundaries
from app.vad_processor import get_speech_timestamps_vad
from app.netflix_linter import auto_chain_gaps

def test_real_dialogue_accuracy():
    """Test actual Hindi dialogue alignment and repetition discrimination from Battleground episode."""
    uploads_dir = Path(__file__).parent.parent / "uploads"
    wav_path = uploads_dir / "up_6k2nca80_Battleground_S2_Ep28_Tod_Dunga_Shiva_Ko_2_new_-_Copy_audio.wav"
    if not wav_path.exists():
        wav_path = uploads_dir / "temp_diagnostic_slice.wav"
    if not wav_path.exists():
        print(f"SKIP: Real dialogue audio file not found at {wav_path}")
        return

    # Real Hindi dialogue events from Battleground S2 Ep28
    # Notice the repeated competition phrase:
    # Occurrence A: "सब मेरे कॉम्पिटीशन ही हैं।" (~31.8s)
    # Occurrence B: "सब भी मेरे कॉम्पिटीशन हैं, रेखा, आप भी मेरे कॉम्पिटीशन हो।" (~33.4s)
    events = [
        {"id": 1, "start_time": 10.65, "end_time": 13.10, "text": "सामने मुझे दिख रहा है, मैं कैसे नहीं समझूँ?"},
        {"id": 2, "start_time": 13.25, "end_time": 15.50, "text": "द रीज़न इज़ गेम है, वी आर इन द सेमीफ़ाइनल्स..."},
        {"id": 3, "start_time": 31.80, "end_time": 33.30, "text": "सब मेरे कॉम्पिटीशन ही हैं।"},
        {"id": 4, "start_time": 33.45, "end_time": 36.80, "text": "सब भी मेरे कॉम्पिटीशन हैं, रेखा, आप भी मेरे कॉम्पिटीशन हो।"},
        {"id": 5, "start_time": 54.50, "end_time": 56.80, "text": "भाई, एक मिनट! 1 मिनट!"}
    ]

    snapped = []
    for ev in events:
        s_time, e_time = snap_to_acoustic_boundaries(str(wav_path), ev["start_time"], ev["end_time"], collar_sec=0.80)
        snapped.append({
            "id": ev["id"],
            "start_time": s_time,
            "end_time": e_time,
            "text": ev["text"]
        })

    chained = auto_chain_gaps(snapped, frame_rate=24.0, min_duration=0.60)

    # Event 1 ("सामने मुझे दिख रहा है") should align near ~10.6s
    print(f"Event 1 aligned: {chained[0]['start_time']:.2f}s -> {chained[0]['end_time']:.2f}s")
    assert 10.0 <= chained[0]["start_time"] <= 12.0

    # Event 2 ("द रीज़न इज़ गेम है") should align near ~12.7s
    print(f"Event 2 aligned: {chained[1]['start_time']:.2f}s -> {chained[1]['end_time']:.2f}s")
    assert 12.0 <= chained[1]["start_time"] <= 14.0

    # Event 3 ("सब मेरे कॉम्पिटीशन ही हैं") should align near ~31.8s
    print(f"Event 3 aligned: {chained[2]['start_time']:.2f}s -> {chained[2]['end_time']:.2f}s")
    assert 31.0 <= chained[2]["start_time"] <= 33.0

    # Event 4 ("सब भी मेरे कॉम्पिटीशन हैं, रेखा") must NOT collapse into Event 3
    print(f"Event 4 aligned: {chained[3]['start_time']:.2f}s -> {chained[3]['end_time']:.2f}s")
    assert 33.0 <= chained[3]["start_time"] <= 35.0
    assert chained[3]["start_time"] >= chained[2]["end_time"] + 0.08  # Strictly no overlap

    # Event 5 ("भाई, एक मिनट! 1 मिनट!") snapped to real acoustic onset near 53.7s
    print(f"Event 5 aligned: {chained[4]['start_time']:.2f}s -> {chained[4]['end_time']:.2f}s")
    assert 53.0 <= chained[4]["start_time"] <= 55.0

    print("ALL REAL HINDI DIALOGUE EVENTS ALIGNED WITH ZERO COLLISION!")

if __name__ == "__main__":
    test_real_dialogue_accuracy()
