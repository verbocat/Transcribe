import math
import re
from typing import List, Optional, Any, Dict

from pydantic import BaseModel, ConfigDict, Field, model_validator


def format_timestamp(seconds: float) -> str:
    """Converts float seconds to 'HH:MM:SS.mmm' string."""
    if seconds is None or math.isnan(seconds):
        return "00:00:00.000"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int(round((seconds - int(seconds)) * 1000))
    if milliseconds >= 1000:
        milliseconds -= 1000
        secs += 1
        if secs >= 60:
            secs -= 60
            minutes += 1
            if minutes >= 60:
                minutes -= 60
                hours += 1
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"


def format_srt_timestamp(seconds: float) -> str:
    """Converts float seconds to 'HH:MM:SS,mmm' (SRT uses comma)."""
    ts = format_timestamp(seconds)
    return ts.replace(".", ",")


def calculate_cps(text: str, duration: float) -> float:
    """
    Calculates characters per second.
    Excludes HTML tags (e.g. <i>, </i>).
    Counts spaces/whitespace, but does not count newline characters.
    """
    if duration <= 0:
        return 0.0
    
    clean_text = re.sub(r'<[^>]+>|\{\\an[1-9]\}', '', text or '')
    clean_text = clean_text.replace("\n", "")
    
    count = len(clean_text)
    return round(count / duration, 2)


def calculate_cpl(text: str) -> List[int]:
    """Returns list of character counts per line, excluding HTML tags."""
    if not text:
        return [0]
    lines = text.split("\n")
    counts = []
    for line in lines:
        clean_line = re.sub(r'<[^>]+>|\{\\an[1-9]\}', '', line)
        counts.append(len(clean_line))
    return counts


class NetflixQCError(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    event_id: Optional[int] = 0
    rule_id: Optional[str] = "NF-QC"
    field: Optional[str] = "text"
    message: Optional[str] = ""
    severity: Optional[str] = "error"
    suggested_fix: Optional[str] = None


class SubtitleEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    id: Optional[int] = 1
    start_time: float = 0.0
    end_time: float = 0.0
    start: Optional[float] = None
    end: Optional[float] = None
    start_time_str: Optional[str] = ""
    end_time_str: Optional[str] = ""
    duration: Optional[float] = 0.0
    text: str = ""
    lines: Optional[List[str]] = Field(default_factory=list)
    speaker_count: Optional[int] = 1
    speakers: Optional[List[str]] = Field(default_factory=list)
    speaker: Optional[str] = "Speaker 1"
    speaker_id: Optional[str] = "speaker_0"
    primary_speaker: Optional[str] = "Speaker 1"
    is_italic: Optional[bool] = False
    is_forced_narrative: Optional[bool] = False
    cps: Optional[float] = 0.0
    cpl: Optional[List[int]] = Field(default_factory=list)
    qc_errors: Optional[List[Any]] = Field(default_factory=list)
    is_valid: Optional[bool] = True

    @model_validator(mode="after")
    def sync_speaker_and_time_fields(self):
        if not self.primary_speaker and self.speaker:
            self.primary_speaker = self.speaker
        elif not self.speaker and self.primary_speaker:
            self.speaker = self.primary_speaker
        elif not self.speaker and not self.primary_speaker:
            spk = self.speakers[0] if (self.speakers and len(self.speakers) > 0) else "Speaker 1"
            self.speaker = spk
            self.primary_speaker = spk
        if self.start is None:
            self.start = self.start_time
        if self.end is None:
            self.end = self.end_time
        return self


class CPSStats(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    min_cps: Optional[float] = 0.0
    max_cps: Optional[float] = 0.0
    avg_cps: Optional[float] = 0.0
    p95_cps: Optional[float] = 0.0
    events_over_limit: Optional[int] = 0
    total_events: Optional[int] = 0


class NetflixQCResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    video_id: str
    filename: str
    language: str = "en"
    events: List[SubtitleEvent] = Field(default_factory=list)
    total_events: int = 0
    total_errors: int = 0
    total_warnings: int = 0
    compliance_score: float = 100.0
    cps_stats: Optional[CPSStats] = None
    shot_changes: List[float] = Field(default_factory=list)
    frame_rate: float = 24.0
    content_type: str = "adult"
    audio_duration: float = 0.0
    video_resolution: str = ""


class SubtitleGenerationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    video_id: str
    language: Optional[str] = "auto"
    script: Optional[str] = "auto"
    content_type: Optional[str] = "adult"
    sdh_mode: Optional[bool] = False


class SubtitleLintRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    events: List[Any] = Field(default_factory=list)
    shot_changes: Optional[List[float]] = Field(default_factory=list)
    frame_rate: Optional[float] = 24.0
    content_type: Optional[str] = "adult"
    custom_cpl: Optional[int] = None
    custom_cps: Optional[float] = None
    custom_max_lines: Optional[int] = None
    custom_min_duration: Optional[float] = None
    custom_max_duration: Optional[float] = None


class SubtitleAutoFixRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    events: List[Any] = Field(default_factory=list)
    shot_changes: Optional[List[float]] = Field(default_factory=list)
    frame_rate: Optional[float] = 24.0
    content_type: Optional[str] = "adult"
    custom_cpl: Optional[int] = None
    custom_cps: Optional[float] = None
    custom_max_lines: Optional[int] = None
    custom_min_duration: Optional[float] = None
    custom_max_duration: Optional[float] = None


class SubtitleExportRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    
    events: List[Any] = Field(default_factory=list)
    filename: Optional[str] = "subtitles"
    format: Optional[str] = "srt"
    language: Optional[str] = "en"
