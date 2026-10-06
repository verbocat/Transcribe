import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Integer, Text, Float
from sqlalchemy.orm import relationship
from .database import AuthBase

class User(AuthBase):
    __tablename__ = "auth_users"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(128), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    salt = Column(String(64), nullable=False)
    employee_id = Column(String(64), nullable=True)
    role = Column(String(32), default="editor", nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    total_spend_usd = Column(Float, default=0.0, nullable=False)
    monthly_budget_usd = Column(Float, default=50.0, nullable=False)
    max_videos_quota = Column(Integer, default=-1, nullable=False)  # -1 = unlimited, >=0 = quota limit
    can_export = Column(Boolean, default=True, nullable=False)
    can_ai_optimize = Column(Boolean, default=True, nullable=False)
    can_audio_peaks = Column(Boolean, default=True, nullable=False)
    is_blocked = Column(Boolean, default=False, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    tokens = relationship("VerificationToken", back_populates="user", cascade="all, delete-orphan")
    login_logs = relationship("LoginHistory", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("AuthSession", back_populates="user", cascade="all, delete-orphan")
    reset_tokens = relationship("PasswordResetToken", back_populates="user", cascade="all, delete-orphan")
    login_otps = relationship("LoginOTP", back_populates="user", cascade="all, delete-orphan")
    uploaded_media = relationship("UserMediaAsset", back_populates="user", cascade="all, delete-orphan")
    subtitle_runs = relationship("SubtitleGenerationRun", back_populates="user", cascade="all, delete-orphan")
    notifications = relationship("AdminNotification", back_populates="user", cascade="all, delete-orphan")


class VerificationToken(AuthBase):
    __tablename__ = "auth_verification_tokens"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(128), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="tokens")


class PasswordResetToken(AuthBase):
    __tablename__ = "auth_password_reset_tokens"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(128), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="reset_tokens")


class LoginHistory(AuthBase):
    __tablename__ = "auth_login_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False)
    operating_location = Column(String(64), nullable=False)  # "In Office" or "Remote"
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
    login_time = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="login_logs")


class AuthSession(AuthBase):
    __tablename__ = "auth_sessions"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False)
    session_token = Column(String(128), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    operating_location = Column(String(64), nullable=True)
    device_info = Column(String(255), nullable=True)
    takeover_lockout_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="sessions")


class LoginOTP(AuthBase):
    """
    Temporary single-use MFA challenge record for two-step email authentication.
    Stores ONLY the HMAC-SHA256 hash of the 6-digit OTP (never plaintext).
    Expires in 5 minutes and is deleted immediately upon successful verification.
    """
    __tablename__ = "auth_login_otps"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False, index=True)
    challenge_id = Column(String(64), unique=True, index=True, nullable=False)
    otp_hash = Column(String(128), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_resend_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    operating_location = Column(String(64), nullable=True)

    user = relationship("User", back_populates="login_otps")


class AuthFailedAttempt(AuthBase):
    """
    Tracks failed login attempts for IP & Account brute-force lockout
    and triggering Bot Defense / Brevo Quota protection.
    """
    __tablename__ = "auth_failed_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), index=True, nullable=True)
    ip_address = Column(String(64), index=True, nullable=False)
    attempt_time = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class SessionTakeoverRequest(AuthBase):
    """
    Represents an interactive session takeover challenge when a user
    attempts to log in from Device B while Device A has an active session.
    Gives Device A a 60-second window to 'Keep Working' or yields to Device B.
    """
    __tablename__ = "auth_session_takeovers"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False, index=True)
    existing_session_id = Column(String(64), ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False)
    new_session_token = Column(String(128), nullable=False)
    new_operating_location = Column(String(64), nullable=True)
    new_device_info = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime, nullable=False)  # created_at + 60 seconds
    status = Column(String(32), default="pending", nullable=False)  # pending, rejected, approved, expired


class UserMediaAsset(AuthBase):
    """
    Auditing table for all media (video/audio) uploaded by users.
    Tracks file attributes, acoustic properties, and hash fingerprint for deduplication.
    """
    __tablename__ = "user_media_assets"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False, index=True)
    video_id = Column(String(128), index=True, nullable=False)
    filename = Column(String(255), nullable=False)
    file_size_bytes = Column(Integer, default=0, nullable=False)
    duration_seconds = Column(Float, default=0.0, nullable=False)
    video_resolution = Column(String(64), default="")
    frame_rate = Column(Float, default=0.0)
    audio_sample_rate = Column(Integer, default=16000)
    audio_channels = Column(Integer, default=1)
    snr_db = Column(Float, default=0.0)
    file_hash = Column(String(64), index=True, nullable=True)
    storage_path = Column(String(512), nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="uploaded_media")
    runs = relationship("SubtitleGenerationRun", back_populates="media_asset", cascade="all, delete-orphan")


class SubtitleGenerationRun(AuthBase):
    """
    Observability record for every subtitle generation execution.
    Tracks re-runs per video, Gemini token usage, Whisper timing, and financial cost.
    """
    __tablename__ = "subtitle_generation_runs"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False, index=True)
    media_asset_id = Column(String(64), ForeignKey("user_media_assets.id", ondelete="SET NULL"), nullable=True, index=True)
    video_id = Column(String(128), index=True, nullable=False)
    run_index_for_video = Column(Integer, default=1, nullable=False)  # 1 = 1st run, 2 = re-run, 3 = re-run...
    target_language = Column(String(32), default="en", nullable=False)
    mode = Column(String(64), default="default", nullable=False)
    total_batches = Column(Integer, default=0, nullable=False)
    batches_completed = Column(Integer, default=0, nullable=False)
    status = Column(String(32), default="in_progress", nullable=False)  # in_progress, completed, failed, cancelled
    gemini_input_tokens = Column(Integer, default=0, nullable=False)
    gemini_output_tokens = Column(Integer, default=0, nullable=False)
    whisper_audio_seconds = Column(Float, default=0.0, nullable=False)
    total_duration_seconds = Column(Float, default=0.0, nullable=False)
    gemini_cost_usd = Column(Float, default=0.0, nullable=False)
    whisper_cost_usd = Column(Float, default=0.0, nullable=False)
    total_run_cost_usd = Column(Float, default=0.0, nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="subtitle_runs")
    media_asset = relationship("UserMediaAsset", back_populates="runs")


class SystemHardwareSnapshot(AuthBase):
    """
    Periodic system hardware metrics (CPU, RAM, Disk, Concurrency)
    sampled in background for real-time monitoring and historical graphs.
    """
    __tablename__ = "system_hardware_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cpu_percent = Column(Float, default=0.0, nullable=False)
    memory_used_mb = Column(Float, default=0.0, nullable=False)
    memory_total_mb = Column(Float, default=0.0, nullable=False)
    memory_percent = Column(Float, default=0.0, nullable=False)
    disk_used_gb = Column(Float, default=0.0, nullable=False)
    disk_free_gb = Column(Float, default=0.0, nullable=False)
    disk_percent = Column(Float, default=0.0, nullable=False)
    active_sse_streams = Column(Integer, default=0, nullable=False)
    recorded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True, nullable=False)


class AdminAuditLog(AuthBase):
    """
    Audit log of administrative or security actions across the platform.
    """
    __tablename__ = "admin_audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String(64), nullable=False)  # "login", "upload", "generate", "user_blocked", "role_changed"
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
    details = Column(Text, nullable=True)  # JSON or text description
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class AdminNotification(AuthBase):
    """
    Direct in-app communication, feedback, and warning notices sent from Super-Admin to users.
    """
    __tablename__ = "admin_notifications"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=True, index=True)
    admin_email = Column(String(255), default="arpit.purohit@verbolabs.com", nullable=False)
    title = Column(String(128), nullable=False)
    message = Column(Text, nullable=False)
    notification_type = Column(String(32), default="feedback", nullable=False)  # "feedback", "warning", "notice", "quota_limit"
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="notifications")

