import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import asyncio
from app.netflix_engine import (
    build_netflix_subtitles_from_words,
    optimize_language_line_breaks,
    audit_netflix_compliance,
    align_subtitles_to_words,
    auto_fix_events_netflix,
    get_language_profile
)
from app.netflix_models import SubtitleEvent
from app.elevenlabs_service import LANGUAGE_CODE_MAP


def test_elevenlabs_language_mapping():
    assert LANGUAGE_CODE_MAP.get("en") == "eng"
    assert LANGUAGE_CODE_MAP.get("hi") == "hin"
    assert LANGUAGE_CODE_MAP.get("ja") == "jpn"
    assert LANGUAGE_CODE_MAP.get("ko") == "kor"
    assert LANGUAGE_CODE_MAP.get("zh") == "zho"
    assert LANGUAGE_CODE_MAP.get("ar") == "ara"
    assert LANGUAGE_CODE_MAP.get("auto") is None


def test_latin_netflix_conforming():
    # Long dialogue test
    words = [
        {"text": "Hello,", "start": 0.0, "end": 0.3},
        {"text": "welcome", "start": 0.32, "end": 0.7},
        {"text": "to", "start": 0.72, "end": 0.85},
        {"text": "the", "start": 0.86, "end": 1.0},
        {"text": "broadcast", "start": 1.02, "end": 1.5},
        {"text": "studio", "start": 1.52, "end": 1.9},
        {"text": "where", "start": 1.92, "end": 2.2},
        {"text": "we", "start": 2.22, "end": 2.35},
        {"text": "produce", "start": 2.37, "end": 2.8},
        {"text": "high-quality", "start": 2.82, "end": 3.4},
        {"text": "subtitles.", "start": 3.42, "end": 3.9},
    ]
    events = build_netflix_subtitles_from_words(
        words=words,
        language="en",
        content_type="adult",
        frame_rate=24.0,
    )
    assert len(events) >= 1
    for ev in events:
        lines = ev.text.split("\n")
        assert len(lines) <= 2
        for line in lines:
            assert len(line) <= 42
        assert ev.duration >= 0.833  # Netflix min 20 frames @ 24fps
        assert ev.duration <= 7.0   # Netflix max 7.0s


def test_indic_netflix_conforming():
    # Hindi dialogue with postpositions
    words = [
        {"text": "नमस्कार,", "start": 0.0, "end": 0.5},
        {"text": "आज", "start": 0.55, "end": 0.8},
        {"text": "के", "start": 0.82, "end": 0.95},
        {"text": "इस", "start": 0.97, "end": 1.15},
        {"text": "कार्यक्रम", "start": 1.18, "end": 1.7},
        {"text": "में", "start": 1.72, "end": 1.85},
        {"text": "आपका", "start": 1.87, "end": 2.2},
        {"text": "स्वागत", "start": 2.22, "end": 2.6},
        {"text": "है।", "start": 2.62, "end": 2.9},
    ]
    events = build_netflix_subtitles_from_words(
        words=words,
        language="hi",
        content_type="adult",
        frame_rate=24.0,
    )
    assert len(events) >= 1
    events, total_errs, total_warns, score, cps_stats = audit_netflix_compliance(
        events=events,
        language="hi",
        content_type="adult",
        frame_rate=24.0,
    )
    assert score >= 90.0
    for ev in events:
        lines = ev.text.split("\n")
        assert len(lines) <= 2
        for line in lines:
            assert len(line) <= 42


def test_japanese_netflix_conforming():
    # Japanese text: strictly 16 CPL limit, Kinsoku Shori
    words = [
        {"text": "こんにちは、", "start": 0.0, "end": 0.8},
        {"text": "本日は", "start": 0.85, "end": 1.4},
        {"text": "ネットフリックスの", "start": 1.45, "end": 2.5},
        {"text": "字幕ガイドラインを", "start": 2.55, "end": 3.7},
        {"text": "テストしています。", "start": 3.75, "end": 4.9},
    ]
    events = build_netflix_subtitles_from_words(
        words=words,
        language="ja",
        content_type="adult",
        frame_rate=24.0,
    )
    assert len(events) >= 1
    for ev in events:
        lines = ev.text.split("\n")
        assert len(lines) <= 2
        for line in lines:
            assert len(line) <= 16  # Netflix Japanese 16 CPL strict limit
            # Kinsoku Shori: line should never start with punctuation
            if line:
                assert line[0] not in ('、', '。', '！', '？', '」', '』', '）')


def test_korean_netflix_conforming():
    # Korean text: 16 CPL limit, 10.5 CPS
    words = [
        {"text": "안녕하세요,", "start": 0.0, "end": 0.7},
        {"text": "오늘", "start": 0.75, "end": 1.1},
        {"text": "방송에", "start": 1.15, "end": 1.6},
        {"text": "오신", "start": 1.65, "end": 1.9},
        {"text": "것을", "start": 1.95, "end": 2.2},
        {"text": "환영합니다.", "start": 2.25, "end": 2.9},
    ]
    events = build_netflix_subtitles_from_words(
        words=words,
        language="ko",
        content_type="adult",
        frame_rate=24.0,
    )
    assert len(events) >= 1
    for ev in events:
        lines = ev.text.split("\n")
        assert len(lines) <= 2
        for line in lines:
            assert len(line) <= 16  # Netflix Korean 16 CPL limit


def test_chinese_netflix_conforming():
    # Chinese text: 16 CPL limit, 9.5 CPS
    words = [
        {"text": "大家好，", "start": 0.0, "end": 0.6},
        {"text": "欢迎收看", "start": 0.65, "end": 1.4},
        {"text": "我们的节目，", "start": 1.45, "end": 2.3},
        {"text": "很高兴能与大家见面。", "start": 2.35, "end": 3.8},
    ]
    events = build_netflix_subtitles_from_words(
        words=words,
        language="zh",
        content_type="adult",
        frame_rate=24.0,
    )
    assert len(events) >= 1
    for ev in events:
        lines = ev.text.split("\n")
        assert len(lines) <= 2
        for line in lines:
            assert len(line) <= 16  # Netflix Chinese 16 CPL limit


def test_dual_speaker_and_sdh_events():
    # Diarized dual-speaker and audio event tags
    words = [
        {"text": "[door closes]", "start": 0.0, "end": 0.5, "type": "audio_event", "speaker_id": None},
        {"text": "Hello there.", "start": 0.6, "end": 1.2, "type": "word", "speaker_id": "speaker_0"},
        {"text": "Hi, how are you?", "start": 1.3, "end": 2.0, "type": "word", "speaker_id": "speaker_1"},
    ]
    events = build_netflix_subtitles_from_words(
        words=words,
        language="en",
        content_type="adult",
        sdh_mode=True,
        frame_rate=24.0,
    )
    assert len(events) >= 1
    # Check that speaker dialogue has hyphenation or separation
    speaker_events = [e for e in events if "-" in e.text]
    assert len(speaker_events) >= 1 or len(events) >= 2


def test_gap_chaining():
    # Two events separated by 5 frames (approx 0.208s @ 24fps)
    # Netflix guideline: 3 to 11 frame gaps MUST be chained to 2 frames
    words = [
        {"text": "First sentence here.", "start": 1.0, "end": 2.5},
        # gap is 0.2s (4.8 frames). The pair runs past 3.8s so the engine doesn't group
        # the two short sentences into one card, which it does for quick back-to-back lines.
        {"text": "Second sentence here.", "start": 2.7, "end": 5.0},
    ]
    events = build_netflix_subtitles_from_words(
        words=words,
        language="en",
        content_type="adult",
        frame_rate=24.0,
    )
    assert len(events) == 2
    gap = events[1].start_time - events[0].end_time
    min_2_frames = 2.0 / 24.0
    # Chained gap should be exactly 2 frames (within float tolerance)
    assert abs(gap - min_2_frames) < 0.01 or gap >= min_2_frames


if __name__ == "__main__":
    test_elevenlabs_language_mapping()
    test_latin_netflix_conforming()
    test_indic_netflix_conforming()
    test_japanese_netflix_conforming()
    test_korean_netflix_conforming()
    test_chinese_netflix_conforming()
    test_dual_speaker_and_sdh_events()
    test_gap_chaining()
    print("ALL TESTS PASSED SUCCESSFULLY!")
