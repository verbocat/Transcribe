import pytest
import numpy as np
import soundfile as sf
from pathlib import Path
import tempfile
import json

from app.models import Segment, TranscriptionResult, AudioAnalysis
from app.linter_engine import (
    lint_segment, lint_dataset, apply_auto_fixes,
    convert_all_digits_to_words, sanitize_karya_punctuation
)
from app.export_service import (
    export_to_csv, export_to_tsv, export_to_txt,
    export_to_docx, export_to_xlsx, export_to_json, export_to_srt,
    export_rejection_csv
)
from app.rejection_engine import evaluate_audio_quality


def test_digits_and_punctuation_linter():
    # Segment with digits, invalid punctuation (&, %, "), and code-mixing
    seg = Segment(
        segment_id=1,
        speaker="Speaker 1",
        gender="Male",
        start_time=0.5,
        end_time=4.2,
        duration=3.7,
        transcript="वह 3 आम लेकर meeting में 50% late पहुँचा & उसने कहा \"हेलो\"."
    )

    errors = lint_segment(seg, language="Hindi", script="Devanagari")
    err_types = [e.error_type for e in errors]

    assert "DIGITS_DETECTED" in err_types
    assert "DISALLOWED_PUNCTUATION" in err_types
    assert "CODE_MIXED_SCRIPT" in err_types


def test_number_conversion_and_punctuation_autofix():
    hindi_text = "मेरे पास 3 आम और 25 संतरे हैं 100% शुद्ध।"
    fixed_digits = convert_all_digits_to_words(hindi_text, language="Hindi")
    assert "तीन" in fixed_digits
    assert "पच्चीस" in fixed_digits

    sanitized = sanitize_karya_punctuation(fixed_digits, language="Hindi")
    assert "प्रतिशत" in sanitized
    assert "%" not in sanitized


def test_duration_and_overlap_linter():
    # Segment 1: Over 20s
    seg1 = Segment(
        segment_id=1,
        speaker="Speaker 1",
        gender="Male",
        start_time=0.0,
        end_time=25.0,
        duration=25.0,
        transcript="लंबा वाक्य।"
    )
    # Segment 2: Starts before seg1 ends (overlap)
    seg2 = Segment(
        segment_id=2,
        speaker="Speaker 2",
        gender="Female",
        start_time=20.0,
        end_time=22.0,
        duration=2.0,
        transcript="छोटा वाक्य।"
    )

    linted, score, total_errors, total_warnings = lint_dataset([seg1, seg2], language="Hindi")
    
    seg1_err_types = [e.error_type for e in linted[0].qc_errors]
    seg2_err_types = [e.error_type for e in linted[1].qc_errors]

    assert "DURATION_TOO_LONG" in seg1_err_types
    assert "TIMESTAMP_OVERLAP" in seg2_err_types


def test_auto_fix_pipeline():
    seg1 = Segment(
        segment_id=1,
        speaker="Speaker 1",
        gender="Male",
        start_time=0.0,
        end_time=4.0,
        duration=4.0,
        transcript="वह 2 लोग थे & खुश थे;"
    )
    seg2 = Segment(
        segment_id=2,
        speaker="Speaker 2",
        gender="Female",
        start_time=3.5, # Overlap
        end_time=6.0,
        duration=2.5,
        transcript="हाँ, बिल्कुल।"
    )

    fixed = apply_auto_fixes([seg1, seg2], language="Hindi", script="Devanagari")
    
    # Check no overlap
    assert fixed[1].start_time >= fixed[0].end_time
    # Check digits converted
    assert "दो" in fixed[0].transcript
    # Check & sanitized
    assert "&" not in fixed[0].transcript


def test_export_all_formats():
    seg = Segment(
        segment_id=1,
        speaker="Speaker 1",
        gender="Male",
        start_time=0.5,
        end_time=3.5,
        start_time_str="00:00:00.500",
        end_time_str="00:00:03.500",
        duration=3.0,
        transcript="वह काम बहुत जल्द कर दिया।",
        qc_errors=[],
        is_valid=True
    )
    res = TranscriptionResult(
        audio_id="test1234",
        filename="sample_conversation.wav",
        language="Hindi",
        script="Devanagari",
        audio_info=AudioAnalysis(
            filename="sample_conversation.wav",
            duration=3.5,
            sample_rate=16000,
            channels=1,
            rms_db=-18.5,
            snr_db=28.0
        ),
        segments=[seg],
        compliance_score=100.0,
        total_errors=0,
        total_warnings=0
    )

    # 1. CSV
    csv_out = export_to_csv(res)
    assert "sample_conversation.wav" not in csv_out  # filename column dropped
    assert "00:00:03.000" in csv_out  # duration as HH:MM:SS.mmm
    assert "QC" not in csv_out
    assert "वह काम बहुत जल्द कर दिया।" in csv_out

    # 2. TSV
    tsv_out = export_to_tsv(res, delimiter="\t")
    assert "\t" in tsv_out

    # 3. TXT
    txt_out = export_to_txt(res)
    assert "LOWER THIRD TRANSCRIPTION DELIVERABLE" in txt_out

    # 4. SRT (Clean speaker prefix)
    srt_out = export_to_srt(res)
    assert "00:00:00,500 --> 00:00:03,500" in srt_out
    assert "[Speaker 1] वह काम बहुत जल्द कर दिया।" in srt_out
    assert "(Male):" not in srt_out  # BUG-07: Ensure speaker gender isn't mangling subtitle body

    # 4b. WebVTT (SRT-07)
    from app.export_service import export_to_vtt
    vtt_out = export_to_vtt(res)
    assert vtt_out.startswith("WEBVTT")
    assert "00:00:00.500 --> 00:00:03.500" in vtt_out
    assert "[Speaker 1] वह काम बहुत जल्द कर दिया।" in vtt_out

    # 5. JSON
    json_out = export_to_json(res)
    parsed = json.loads(json_out)
    assert isinstance(parsed, list)
    assert parsed[0]["start_sec"] == 0.5
    assert parsed[0]["end_sec"] == 3.5
    assert parsed[0]["transcription"] == "वह काम बहुत जल्द कर दिया।"
    assert parsed[0]["speaker"] == "Speaker 1"
    assert parsed[0]["gender_label"] == "Male"

    # 6. DOCX & XLSX
    with tempfile.TemporaryDirectory() as tmp_dir:
        docx_path = Path(tmp_dir) / "test.docx"
        xlsx_path = Path(tmp_dir) / "test.xlsx"
        export_to_docx(res, str(docx_path))
        export_to_xlsx(res, str(xlsx_path))
        assert docx_path.exists()
        assert xlsx_path.exists()

    # 7. Rejection CSV
    rej_out = export_rejection_csv([{
        "filename": "bad_audio.wav",
        "rejection_category": "Corrupted audio file",
        "rejection_reason": "Header invalid",
        "duration": 0.0,
        "rms_db": -100.0,
        "snr_db": 0.0
    }])
    assert "bad_audio.wav" in rej_out
    assert "Corrupted audio file" in rej_out


def test_split_segment_qc_error_type():
    from app.models import QCError
    # Test float segment_id (BUG-W5)
    qc = QCError(
        segment_id=1.1,
        field="transcript",
        error_type="DIGITS_DETECTED",
        message="Test digit error",
        snippet="123",
        severity="error"
    )
    assert qc.segment_id == 1.1


def test_rate_limiting_and_session_eviction():
    from app.main import _check_rate_limit, _evict_expired_sessions, active_sessions, _client_request_history
    import time
    from fastapi import HTTPException

    # Rate limiting test up to RATE_LIMIT_PER_MINUTE
    test_ip = "192.168.1.100"
    _client_request_history[test_ip] = []
    
    from app.main import RATE_LIMIT_PER_MINUTE
    for _ in range(RATE_LIMIT_PER_MINUTE):
        _check_rate_limit(test_ip)
    
    # Next call triggers 429
    with pytest.raises(HTTPException) as exc_info:
        _check_rate_limit(test_ip)
    assert exc_info.value.status_code == 429

    # Session TTL eviction test
    active_sessions["old_session"] = {"created_at": time.time() - 8000}
    active_sessions["new_session"] = {"created_at": time.time()}
    _evict_expired_sessions()
    assert "old_session" not in active_sessions
    assert "new_session" in active_sessions


def test_audio_rejection_evaluator():
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        temp_wav = f.name

    try:
        sr = 16000
        samples = np.zeros(int(sr * 1.0), dtype=np.float32)
        sf.write(temp_wav, samples, sr)

        is_rej, cat, reason, info = evaluate_audio_quality(temp_wav)
        # Tool never auto-rejects audio
        assert is_rej is False
        assert info["duration"] > 0
    finally:
        if Path(temp_wav).exists():
            Path(temp_wav).unlink()


def test_dialogue_aware_subtask_chunking():
    from app.audio_processor import find_dialogue_split_points, extract_audio_slice

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        temp_wav = f.name

    try:
        sr = 16000
        # Create a 200-second synthetic audio with silence gaps at ~100s
        t = np.linspace(0, 200, sr * 200, endpoint=False)
        # Speech tone
        signal = 0.3 * np.sin(2 * np.pi * 440 * t)
        # Add 1.5-second dialogue silence gap between 98s and 102s
        silence_idx_s = int(98.5 * sr)
        silence_idx_e = int(101.5 * sr)
        signal[silence_idx_s:silence_idx_e] = 0.0

        sf.write(temp_wav, signal.astype(np.float32), sr)

        chunks = find_dialogue_split_points(
            temp_wav,
            target_chunk_sec=100.0,
            min_chunk_sec=70.0,
            max_chunk_sec=140.0
        )
        assert len(chunks) == 2
        # Verify chunk 1 ends in the silence gap (between 98s and 102s)
        assert 98.0 <= chunks[0][1] <= 102.0
        # Verify chunk 2 starts exactly where chunk 1 ends
        assert chunks[1][0] == chunks[0][1]
        assert chunks[1][1] == 200.0

        # Verify extract_audio_slice
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f_slice:
            slice_path = f_slice.name
        try:
            extract_audio_slice(temp_wav, chunks[0][0], chunks[0][1], slice_path)
            slice_info = sf.info(slice_path)
            assert round(slice_info.duration, 1) == round(chunks[0][1] - chunks[0][0], 1)
        finally:
            if Path(slice_path).exists():
                Path(slice_path).unlink()
    finally:
        if Path(temp_wav).exists():
            Path(temp_wav).unlink()


def test_dual_channel_detection_and_physical_vad():
    from app.audio_processor import detect_dual_channel_layout, extract_physical_speech_intervals

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        stereo_wav = f.name

    try:
        sr = 16000
        total_len = sr * 10  # 10 seconds
        left = np.zeros(total_len, dtype=np.float32)
        right = np.zeros(total_len, dtype=np.float32)

        # Speaker 1 on Left Channel from 1.0s to 4.0s
        t_left = np.linspace(0, 3, sr * 3, endpoint=False)
        left[sr * 1:sr * 4] = 0.35 * np.sin(2 * np.pi * 300 * t_left)

        # Speaker 2 on Right Channel from 4.5s to 8.0s
        t_right = np.linspace(0, 3.5, int(sr * 3.5), endpoint=False)
        right[int(sr * 4.5):int(sr * 8.0)] = 0.35 * np.sin(2 * np.pi * 600 * t_right)

        stereo_data = np.column_stack([left, right])
        sf.write(stereo_wav, stereo_data, sr)

        # 1. Test dual channel detection
        layout = detect_dual_channel_layout(stereo_wav)
        assert layout["is_dual_channel"] is True
        assert layout["channels"] == 2
        assert layout["correlation"] < 0.2

        # 2. Test physical interval extraction
        intervals = extract_physical_speech_intervals(stereo_wav)
        assert len(intervals) >= 2
        # First interval must be Speaker 1 on Left Channel around 1.0s - 4.0s
        assert intervals[0]["speaker"] == "Speaker 1"
        assert intervals[0]["channel"] == 0
        assert 0.90 <= intervals[0]["start_time"] <= 1.10
        assert 3.90 <= intervals[0]["end_time"] <= 4.10

        # Second interval must be Speaker 2 on Right Channel around 4.5s - 8.0s
        assert intervals[1]["speaker"] == "Speaker 2"
        assert intervals[1]["channel"] == 1
        assert 4.40 <= intervals[1]["start_time"] <= 4.60
        assert 7.90 <= intervals[1]["end_time"] <= 8.10
    finally:
        if Path(stereo_wav).exists():
            Path(stereo_wav).unlink()
