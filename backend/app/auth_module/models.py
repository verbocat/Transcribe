import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Integer, Text
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
    is_verified = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    tokens = relationship("VerificationToken", back_populates="user", cascade="all, delete-orphan")
    login_logs = relationship("LoginHistory", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("AuthSession", back_populates="user", cascade="all, delete-orphan")
    reset_tokens = relationship("PasswordResetToken", back_populates="user", cascade="all, delete-orphan")
    login_otps = relationship("LoginOTP", back_populates="user", cascade="all, delete-orphan")


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
