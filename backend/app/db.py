import os
import json
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from sqlalchemy import create_engine, Column, String, Float, Integer, Boolean, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

from app.config import DATABASE_URL

Base = declarative_base()

class DBProject(Base):
    __tablename__ = "transcription_projects"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String(255), nullable=False)
    audio_path = Column(String(512), nullable=True)
    language = Column(String(64), default="Hindi")
    script = Column(String(64), default="Devanagari")
    duration = Column(Float, default=0.0)
    compliance_score = Column(Float, default=100.0)
    total_errors = Column(Integer, default=0)
    total_warnings = Column(Integer, default=0)
    audio_info = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    segments = relationship("DBSegment", back_populates="project", cascade="all, delete-orphan", order_by="DBSegment.segment_id")


class DBSegment(Base):
    __tablename__ = "project_segments"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(64), ForeignKey("transcription_projects.id", ondelete="CASCADE"), nullable=False)
    segment_id = Column(Integer, nullable=False)
    speaker = Column(String(64), default="Speaker 1")
    gender = Column(String(32), default="Male")
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    duration = Column(Float, default=0.0)
    transcript = Column(Text, default="")
    confidence = Column(Float, default=1.0)
    words_data = Column(Text, nullable=True)
    qc_errors_data = Column(Text, nullable=True)
    is_valid = Column(Boolean, default=True)

    project = relationship("DBProject", back_populates="segments")


class DBSubtitleProject(Base):
    __tablename__ = "subtitle_projects"
    
    id = Column(String, primary_key=True)
    filename = Column(String, nullable=False)
    video_path = Column(String, nullable=True)
    language = Column(String, default="en")
    content_type = Column(String, default="adult")  # "adult" or "children"
    frame_rate = Column(Float, default=24.0)
    audio_duration = Column(Float, default=0.0)
    video_resolution = Column(String, default="")
    total_events = Column(Integer, default=0)
    compliance_score = Column(Float, default=0.0)
    total_errors = Column(Integer, default=0)
    total_warnings = Column(Integer, default=0)
    shot_changes = Column(Text, default="[]")  # JSON string
    cps_stats = Column(Text, default="{}")  # JSON string
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    events = relationship("DBSubtitleEvent", back_populates="project", cascade="all, delete-orphan")


class DBSubtitleEvent(Base):
    __tablename__ = "subtitle_events"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String, ForeignKey("subtitle_projects.id", ondelete="CASCADE"), nullable=False)
    event_id = Column(Integer, nullable=False)  # The subtitle event number (1, 2, 3...)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    duration = Column(Float, default=0.0)
    text = Column(Text, default="")
    lines = Column(Text, default="[]")  # JSON string
    speaker_count = Column(Integer, default=1)
    speakers = Column(Text, default="[]")  # JSON string
    is_italic = Column(Boolean, default=False)
    is_forced_narrative = Column(Boolean, default=False)
    cps = Column(Float, default=0.0)
    cpl = Column(Text, default="[]")  # JSON string
    qc_errors = Column(Text, default="[]")  # JSON string
    is_valid = Column(Boolean, default=True)
    
    project = relationship("DBSubtitleProject", back_populates="events")


# Engine and Session factory
engine = None
SessionLocal = None

def init_db():
    global engine, SessionLocal
    db_url = DATABASE_URL or os.getenv("DATABASE_URL", "")
    if not db_url:
        return None
    # SQLAlchemy 2.1 maps a bare postgresql:// URL to psycopg (v3); requirements ship psycopg2-binary
    if db_url.startswith("postgres://"):
        db_url = "postgresql+psycopg2://" + db_url[len("postgres://"):]
    elif db_url.startswith("postgresql://"):
        db_url = "postgresql+psycopg2://" + db_url[len("postgresql://"):]
    try:
        engine = create_engine(db_url, pool_pre_ping=True, pool_size=5, max_overflow=10)
        Base.metadata.create_all(bind=engine)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        print("Neon PostgreSQL Database initialized successfully!")
        return SessionLocal
    except Exception as e:
        print(f"Neon DB initialization warning: {e}")
        return None

def get_db_session():
    global SessionLocal
    if SessionLocal is None:
        init_db()
    if SessionLocal:
        return SessionLocal()
    return None
