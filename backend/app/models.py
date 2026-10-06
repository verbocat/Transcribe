from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field

class QCError(BaseModel):
    # BUG-W5: segment_id uses Union[int, float] because during split operations
    # temporary float IDs like 1.5, 2.5 are assigned before re-indexing.
    segment_id: Union[int, float]
    field: str
    error_type: str
    message: str
    snippet: str
    suggested_fix: Optional[str] = None
    severity: str = "error"  # "error" or "warning"

class WordConfidence(BaseModel):
    word: str
    confidence: float = 1.0  # 0.0 to 1.0 (e.g. 0.95 = 95%)
    start_time: Optional[float] = None
    end_time: Optional[float] = None

class Segment(BaseModel):
    segment_id: int
    speaker: str = "Speaker 1"
    gender: str = "Male"  # Male, Female, Unknown
    start_time: float
    end_time: float
    start_time_str: str = "00:00:00.000"
    end_time_str: str = "00:00:00.000"
    duration: float = 0.0
    transcript: str = ""
    confidence: float = 1.0
    words: List[WordConfidence] = []
    qc_errors: List[QCError] = []
    is_valid: bool = True

class AudioAnalysis(BaseModel):
    filename: str = "audio.wav"
    duration: float = 0.0
    sample_rate: int = 16000
    channels: int = 1
    rms_db: float = -20.0
    snr_db: float = 25.0
    is_rejected: bool = False
    rejection_category: Optional[str] = None
    rejection_reason: Optional[str] = None

class TranscriptionResult(BaseModel):
    audio_id: str = "audio_001"
    filename: str = "audio_transcript.wav"
    language: str = "Hindi"
    script: str = "Devanagari"
    audio_info: Optional[AudioAnalysis] = None
    segments: List[Segment] = []
    compliance_score: float = 100.0
    total_errors: int = 0
    total_warnings: int = 0
    is_rejected: bool = False
    rejection_category: Optional[str] = None
    rejection_reason: Optional[str] = None
    processing_notes: List[str] = []  # warnings about degraded detectors, shown in the UI

class BatchTask(BaseModel):
    task_id: str
    filename: str
    file_path: str
    language: str = "Hindi"
    script: str = "Devanagari"
    status: str = "queued"  # queued, processing, completed, rejected, failed
    progress: float = 0.0
    result: Optional[TranscriptionResult] = None
    error_message: Optional[str] = None

class UpdateSegmentRequest(BaseModel):
    speaker: Optional[str] = None
    gender: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    transcript: Optional[str] = None

class LintRequest(BaseModel):
    segments: List[Segment]
    language: str = "Hindi"
    script: str = "Devanagari"

class AutoFixRequest(BaseModel):
    segments: Optional[List[Segment]] = None
    fix_digits: bool = True
    fix_punctuation: bool = True
    fix_overlaps: bool = True
    fix_tags: bool = True
    fix_code_mixing: bool = True
    language: str = "Hindi"
    script: str = "Devanagari"

class ExportRequest(BaseModel):
    format: str  # csv, tsv, txt, docx, xlsx, json, srt, vtt, rejection_csv
    custom_columns: Optional[Dict[str, str]] = None
