import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from sqlalchemy.orm import Session

from .database import get_auth_db, init_auth_db
from .models import (
    User,
    VerificationToken,
    LoginHistory,
    AuthSession,
    PasswordResetToken,
    LoginOTP,
    AuthFailedAttempt,
    SessionTakeoverRequest,
    AdminNotification
)
from .security import (
    validate_verbolabs_email,
    validate_password,
    check_password_policy,
    hash_password,
    verify_password,
    generate_token,
    generate_secure_otp,
    hash_otp,
    verify_otp_hash,
    get_otp_secret
)
from .brevo_service import send_verification_email, send_password_reset_email, send_mfa_login_otp_email

SUPER_ADMIN_EMAILS = {"arpit.purohit@verbolabs.com", "arpit.purohit@verbolab.com"}

def is_super_admin(email: Optional[str]) -> bool:
    if not email:
        return False
    return email.strip().lower() in SUPER_ADMIN_EMAILS

auth_router = APIRouter()

def get_client_ip(request: Request) -> str:
    """Extract client IP address, handling proxy headers."""
    x_forwarded = request.headers.get("x-forwarded-for")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"

def get_device_summary(request: Request, op_loc: str = "In Office") -> str:
    """Creates a user-friendly device & location description."""
    ua = request.headers.get("user-agent", "")
    browser = "Browser"
    if "Chrome" in ua and "Edg" not in ua:
        browser = "Chrome"
    elif "Edg" in ua:
        browser = "Edge"
    elif "Safari" in ua and "Chrome" not in ua:
        browser = "Safari"
    elif "Firefox" in ua:
        browser = "Firefox"

    os_name = "Workstation"
    if "Windows" in ua:
        os_name = "Windows"
    elif "Macintosh" in ua or "Mac OS" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"
    elif "Android" in ua:
        os_name = "Android"
    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"

    return f"{os_name} {browser} • {op_loc}"

def verify_bot_challenge(token: Optional[str]) -> bool:
    """Verifies a signed bot defense challenge token."""
    if not token or ":" not in token:
        return False
    try:
        parts = token.split(":")
        if len(parts) != 4:
            return False
        challenge_id, user_ans, ts_str, signature = parts
        import time, hmac, hashlib
        now_ts = int(time.time())
        ts = int(ts_str)
        if abs(now_ts - ts) > 300:  # 5 min expiry
            return False
        secret = get_otp_secret().encode('utf-8')
        expected_sig = hmac.new(secret, f"{challenge_id}:{user_ans.strip()}:{ts}".encode('utf-8'), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected_sig)
    except Exception:
        return False

def get_caller_origin(request: Request) -> Optional[str]:
    """Extract caller origin (e.g. https://transcribes.vercel.app or http://localhost:5173)."""
    origin = request.headers.get("origin")
    if origin and origin.startswith("http"):
        return origin.rstrip("/")
    referer = request.headers.get("referer")
    if referer and referer.startswith("http"):
        from urllib.parse import urlparse
        p = urlparse(referer)
        return f"{p.scheme}://{p.netloc}"
    return None

# Pydantic Schemas
class SignupRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(...)
    confirm_password: str = Field(...)
    employee_id: Optional[str] = Field(None, max_length=64)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(...)


class ResetPasswordRequest(BaseModel):
    token: str = Field(...)
    password: str = Field(...)
    confirm_password: str = Field(...)


class LoginRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    email: str = Field(...)
    password: str = Field(...)
    operating_location: str = Field(...)  # "In Office" or "Remote"
    bot_challenge_token: Optional[str] = None


class ResendVerificationRequest(BaseModel):
    email: str = Field(...)


class VerifyTokenRequest(BaseModel):
    token: str = Field(...)


class VerifyOtpRequest(BaseModel):
    challenge_id: str = Field(...)
    otp: str = Field(..., min_length=6, max_length=6)


class TakeoverDecisionRequest(BaseModel):
    takeover_id: str = Field(...)
    decision: str = Field(...)  # "keep" or "release"


class ResendOtpRequest(BaseModel):
    challenge_id: str = Field(...)


def get_current_user_from_token(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_auth_db)
) -> User:
    """Dependency to retrieve currently authenticated user from Bearer session token with 4-hour inactivity check."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token."
        )
    token = authorization.split(" ")[1].strip()
    session = db.query(AuthSession).filter(
        AuthSession.session_token == token,
        AuthSession.is_active == True
    ).first()

    if not session or not session.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication session. Please log in again."
        )

    now_utc = datetime.now(timezone.utc)
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if now_utc > expires_at:
        session.is_active = False
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired due to 4 hours of inactivity. Please log in again."
        )

    if session.user.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been suspended by an administrator."
        )

    # Slide 4-hour inactivity window forward on active use
    session.expires_at = now_utc + timedelta(hours=4)
    db.commit()

    return session.user


def get_current_admin_user(
    current_user: User = Depends(get_current_user_from_token)
) -> User:
    """Dependency ensuring caller is strictly the Super Administrator (Arpit Purohit)."""
    if not is_super_admin(current_user.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Enterprise Admin Command Center is restricted strictly to the Super Administrator."
        )
    return current_user


def get_optional_user_from_token(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_auth_db)
) -> Optional[User]:
    """Dependency that extracts user if Bearer token is provided, or None if anonymous/unauthenticated."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        token = authorization.split(" ")[1].strip()
        session = db.query(AuthSession).filter(
            AuthSession.session_token == token,
            AuthSession.is_active == True
        ).first()
        if not session or not session.user:
            return None
        now_utc = datetime.now(timezone.utc)
        exp = session.expires_at.replace(tzinfo=timezone.utc) if session.expires_at.tzinfo is None else session.expires_at
        if now_utc > exp or session.user.is_blocked:
            return None
        return session.user
    except Exception:
        return None


@auth_router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, request: Request, db: Session = Depends(get_auth_db)):
    """
    Registers a new VerboLabs user:
    - Strictly checks @verbolabs.com email domain
    - Strictly checks password policy (length, lower, upper, digit, symbol, space)
    - Confirms passwords match
    - Detects duplicate existing accounts
    - Sends verification email with link via Brevo
    """
    email_clean = payload.email.strip().lower()
    name_clean = payload.name.strip()

    # 1. Domain verification
    is_valid_domain, domain_err = validate_verbolabs_email(email_clean)
    if not is_valid_domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=domain_err)

    # 2. Confirm password match
    if payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match. Please re-enter identical passwords."
        )

    # 3. Password criteria check
    is_valid_pwd, pwd_errors = validate_password(payload.password)
    if not is_valid_pwd:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password does not satisfy requirements: {'; '.join(pwd_errors)}"
        )

    # 4. Check if account already exists
    existing_user = db.query(User).filter(User.email == email_clean).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists with this email address. Please log in instead."
        )

    # 5. Hash password
    pwd_hash, salt = hash_password(payload.password)

    # 6. Create User record
    new_user = User(
        name=name_clean,
        email=email_clean,
        password_hash=pwd_hash,
        salt=salt,
        employee_id=payload.employee_id.strip() if payload.employee_id else None,
        is_verified=False
    )
    db.add(new_user)
    db.flush()

    # 7. Generate Verification Token (24 hours expiry)
    token_str = generate_token()
    token_record = VerificationToken(
        user_id=new_user.id,
        token=token_str,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24)
    )
    db.add(token_record)
    db.commit()

    # 8. Send verification email via Brevo
    brevo_result = send_verification_email(
        user_name=new_user.name,
        user_email=new_user.email,
        verification_token=token_str,
        base_url=get_caller_origin(request)
    )

    if not brevo_result.get("success"):
        # Atomically delete user and token so account is not trapped in an unverified state
        db.delete(token_record)
        db.delete(new_user)
        db.commit()
        err = brevo_result.get("error", "Email dispatch failed.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Verification email could not be sent to your inbox: {err}"
        )

    return {
        "success": True,
        "account_created": True,
        "message": "Account created successfully! A verification email has been sent to your @verbolabs.com email.",
        "email": new_user.email,
        "email_status": brevo_result
    }


@auth_router.get("/bot-challenge")
def get_bot_challenge():
    """
    Generates a lightweight, zero-dependency sovereign human verification challenge.
    Protects Brevo transactional email quota from automated scripts.
    """
    import secrets
    import time
    import hmac
    import hashlib

    num1 = secrets.randbelow(9) + 2
    num2 = secrets.randbelow(9) + 1
    ans = str(num1 + num2)
    challenge_id = secrets.token_hex(16)
    ts = int(time.time())

    secret = get_otp_secret().encode('utf-8')
    sig = hmac.new(secret, f"{challenge_id}:{ans}:{ts}".encode('utf-8'), hashlib.sha256).hexdigest()

    return {
        "challenge_id": challenge_id,
        "question": f"Security check: What is {num1} + {num2}?",
        "timestamp": ts,
        "signature": sig
    }


@auth_router.get("/takeover/status")
def get_takeover_status(takeover_id: str, db: Session = Depends(get_auth_db)):
    """
    Polled by Device B during the 60-second waiting period.
    Evaluates whether Device A rejected the takeover, or 60s expired (auto-approved).
    """
    takeover = db.query(SessionTakeoverRequest).filter(SessionTakeoverRequest.id == takeover_id).first()
    if not takeover:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Takeover request not found.")

    now_utc = datetime.now(timezone.utc)
    exp = takeover.expires_at.replace(tzinfo=timezone.utc) if takeover.expires_at.tzinfo is None else takeover.expires_at

    if takeover.status == "rejected":
        # Check lockout on active session to inform Device B of the exact cooldown
        active_sess = db.query(AuthSession).filter(AuthSession.id == takeover.existing_session_id).first()
        remaining_secs = 1800
        if active_sess and active_sess.takeover_lockout_until:
            exp_lockout = active_sess.takeover_lockout_until.replace(tzinfo=timezone.utc) if active_sess.takeover_lockout_until.tzinfo is None else active_sess.takeover_lockout_until
            remaining_secs = max(0, int((exp_lockout - now_utc).total_seconds()))
        remaining_mins = max(1, int((remaining_secs + 59) // 60))
        return {
            "success": False,
            "status": "rejected",
            "lockout_seconds": remaining_secs,
            "lockout_minutes": remaining_mins,
            "message": f"Login request was declined by the active workstation. To prevent interruptions during active work/exporting, remote logins for this account are locked for {remaining_mins} minutes."
        }

    if takeover.status == "approved" or (takeover.status == "pending" and now_utc >= exp):
        # 60-second window expired without rejection -> Yield session to Device B!
        old_session = db.query(AuthSession).filter(AuthSession.id == takeover.existing_session_id).first()
        if old_session:
            old_session.is_active = False

        # Activate Device B session
        existing_new = db.query(AuthSession).filter(AuthSession.session_token == takeover.new_session_token).first()
        if not existing_new:
            new_session = AuthSession(
                user_id=takeover.user_id,
                session_token=takeover.new_session_token,
                operating_location=takeover.new_operating_location,
                device_info=takeover.new_device_info,
                is_active=True,
                expires_at=now_utc + timedelta(hours=4)
            )
            db.add(new_session)

        takeover.status = "approved"
        db.commit()

        user = db.query(User).filter(User.id == takeover.user_id).first()
        return {
            "success": True,
            "status": "approved",
            "token": takeover.new_session_token,
            "expires_in": 4 * 3600,
            "user": {
                "id": user.id if user else takeover.user_id,
                "name": user.name if user else "Editor",
                "email": user.email if user else "",
                "employee_id": user.employee_id if user else None,
                "operating_location": takeover.new_operating_location
            }
        }

    # Still pending
    remaining = max(0, int((exp - now_utc).total_seconds()))
    return {
        "success": True,
        "status": "pending",
        "remaining_seconds": remaining
    }


@auth_router.post("/takeover/decision")
def submit_takeover_decision(
    payload: TakeoverDecisionRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_auth_db)
):
    """
    Called by Device A when user clicks 'Keep Working' (reject) or 'Log Out' (release).
    If 'keep', activates a 30-minute lockout so Device B cannot repeatedly interrupt work/exporting.
    """
    from .routes import get_current_user_from_token
    user = get_current_user_from_token(authorization=authorization, db=db)
    token = authorization.split(" ")[1].strip()

    takeover = db.query(SessionTakeoverRequest).filter(
        SessionTakeoverRequest.id == payload.takeover_id,
        SessionTakeoverRequest.user_id == user.id
    ).first()

    if not takeover:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Takeover request not found.")

    now_utc = datetime.now(timezone.utc)
    if payload.decision.lower() == "keep":
        takeover.status = "rejected"
        # Protect active session from any further takeover interruptions for 30 minutes
        active_sess = db.query(AuthSession).filter(AuthSession.id == takeover.existing_session_id).first()
        if active_sess:
            active_sess.takeover_lockout_until = now_utc + timedelta(minutes=30)
        db.commit()
        return {
            "success": True,
            "decision": "keep",
            "lockout_minutes": 30,
            "message": "You chose to keep working on this workstation. Remote login attempts are paused for 30 minutes so your work is not interrupted."
        }
    else:
        # User explicitly chooses to log out and allow Device B
        takeover.status = "approved"
        curr_session = db.query(AuthSession).filter(AuthSession.session_token == token).first()
        if curr_session:
            curr_session.is_active = False
        db.commit()
        return {
            "success": True,
            "decision": "release",
            "message": "Session released. You are now logged out."
        }


@auth_router.post("/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_auth_db)):
    """
    Authenticates a VerboLabs user:
    - Checks @verbolabs.com domain
    - Validates required operating location dropdown
    - Checks IP & Account brute-force lockout (5 attempts in 10 min -> 15 min lock)
    - Enforces bot challenge after 2 failed attempts to protect Brevo quota
    - Verifies password against salt and PBKDF2 hash
    - Dispatches temporary 6-digit OTP via Brevo
    - Issues MFA challenge_id
    """
    email_clean = payload.email.strip().lower()
    client_ip = get_client_ip(request)
    now_utc = datetime.now(timezone.utc)
    window_start = now_utc - timedelta(minutes=10)

    # 1. Domain verification
    is_valid_domain, domain_err = validate_verbolabs_email(email_clean)
    if not is_valid_domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=domain_err)

    # 2. Operating location check
    op_loc = payload.operating_location.strip()
    if not op_loc or op_loc.lower() not in ["in office", "remote", "in-office"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please select a valid operating location ('In Office' or 'Remote')."
        )
    op_loc_normalized = "In Office" if "office" in op_loc.lower() else "Remote"

    # 3. Brute-Force & Lockout Check (>= 5 failures within 10 minutes)
    recent_failures = db.query(AuthFailedAttempt).filter(
        (AuthFailedAttempt.email == email_clean) | (AuthFailedAttempt.ip_address == client_ip),
        AuthFailedAttempt.attempt_time >= window_start
    ).count()

    if recent_failures >= 5:
        latest_fail = db.query(AuthFailedAttempt).filter(
            (AuthFailedAttempt.email == email_clean) | (AuthFailedAttempt.ip_address == client_ip)
        ).order_by(AuthFailedAttempt.attempt_time.desc()).first()

        if latest_fail:
            lock_exp = latest_fail.attempt_time.replace(tzinfo=timezone.utc) if latest_fail.attempt_time.tzinfo is None else latest_fail.attempt_time
            lock_exp += timedelta(minutes=15)
            if now_utc < lock_exp:
                rem_sec = max(1, int((lock_exp - now_utc).total_seconds()))
                rem_min = int((rem_sec + 59) // 60)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Access temporarily locked due to {recent_failures} failed attempts. Please try again in {rem_min} minute{'s' if rem_min != 1 else ''}."
                )

    # 4. Brevo Email Quota & Bot Defense (>= 2 failures requires human verification)
    if recent_failures >= 2:
        if not payload.bot_challenge_token or not verify_bot_challenge(payload.bot_challenge_token):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Security verification required. Please solve the human verification puzzle to proceed."
            )

    # 5. Check if user exists in database
    user = db.query(User).filter(User.email == email_clean).first()
    if not user:
        # Record failed attempt against IP
        db.add(AuthFailedAttempt(email=email_clean, ip_address=client_ip, attempt_time=now_utc))
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email address. Please sign up first."
        )

    # 6. Check restricted / blocked status
    if user.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been restricted or suspended by an administrator. Please contact support."
        )

    # 7. Verify password
    if not verify_password(payload.password, user.password_hash, user.salt):
        db.add(AuthFailedAttempt(email=email_clean, ip_address=client_ip, attempt_time=now_utc))
        db.commit()
        new_fail_count = recent_failures + 1
        rem = max(0, 5 - new_fail_count)
        if new_fail_count >= 5:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Account temporarily locked for 15 minutes."
            )
        err_msg = f"Incorrect password. {rem} attempt{'s' if rem != 1 else ''} remaining before temporary account lock."
        if new_fail_count >= 2:
            err_msg += " (Security verification will be required on your next attempt)."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_msg
        )

    # Optional: update name if user submitted a non-empty name during login
    if payload.name and payload.name.strip() and payload.name.strip() != user.name:
        user.name = payload.name.strip()

    # 7.5 Check 30-Minute Workstation Takeover Lockout
    # If the active workstation previously declined remote takeover (e.g. during export or editing),
    # block new remote login attempts for 30 minutes to prevent interruptions and protect Brevo email quota.
    active_session = db.query(AuthSession).filter(
        AuthSession.user_id == user.id,
        AuthSession.is_active == True,
        AuthSession.expires_at > now_utc
    ).order_by(AuthSession.created_at.desc()).first()

    if active_session and active_session.takeover_lockout_until:
        lockout_end = active_session.takeover_lockout_until.replace(tzinfo=timezone.utc) if active_session.takeover_lockout_until.tzinfo is None else active_session.takeover_lockout_until
        if lockout_end > now_utc:
            rem_sec = int((lockout_end - now_utc).total_seconds())
            rem_min = int((rem_sec + 59) // 60)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Active workstation declined remote login to protect uninterrupted work (e.g. exporting/editing). Remote login for this account is locked for {rem_min} more minute{'s' if rem_min != 1 else ''}."
            )

    # 8. ATOMIC CHALLENGE INVALIDATION (Multi-Device Prevention):
    # Whenever a new login attempt occurs for this account, immediately invalidate and purge
    # all prior pending MFA challenges for this user. Only the newest challenge remains valid!
    db.query(LoginOTP).filter(LoginOTP.user_id == user.id).delete()
    db.commit()

    # 9. Generate cryptographically secure 6-digit OTP and HMAC hash
    otp_code = generate_secure_otp()
    otp_hash_val = hash_otp(otp_code)
    challenge_id = uuid.uuid4().hex

    new_challenge = LoginOTP(
        user_id=user.id,
        challenge_id=challenge_id,
        otp_hash=otp_hash_val,
        expires_at=now_utc + timedelta(minutes=5),
        attempts=0,
        created_at=now_utc,
        last_resend_at=now_utc,
        operating_location=op_loc_normalized
    )
    db.add(new_challenge)
    db.commit()

    # 10. Send plaintext OTP strictly to user's registered email via Brevo Transactional Email API
    brevo_res = send_mfa_login_otp_email(
        user_name=user.name,
        user_email=user.email,
        otp=otp_code
    )

    if not brevo_res.get("success"):
        # Roll back challenge if email dispatch failed completely
        db.delete(new_challenge)
        db.commit()
        err_msg = brevo_res.get("error", "Email dispatch error.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Verification email code could not be sent: {err_msg}"
        )

    # Return MFA challenge response (NO JWT/session issued yet!)
    parts = user.email.split("@")
    masked_name = parts[0][0] + "***" + (parts[0][-1] if len(parts[0]) > 1 else "")
    masked_email = f"{masked_name}@{parts[1]}"

    return {
        "success": True,
        "mfa_required": True,
        "challenge_id": challenge_id,
        "email_masked": masked_email,
        "expires_in_seconds": 300,
        "message": f"A 6-digit verification code has been sent to {masked_email}."
    }


@auth_router.post("/verify-otp")
def verify_login_otp(
    payload: VerifyOtpRequest,
    request: Request,
    db: Session = Depends(get_auth_db)
):
    """
    Step 2 MFA: Verifies 6-digit email OTP:
    - Finds challenge by challenge_id
    - Checks 5-minute expiration
    - Checks maximum attempts (max 5)
    - Compares HMAC-SHA256 hash using constant-time comparison
    - DELETES challenge record immediately upon match (prevents multi-device reuse / replay)
    - Enforces Single Active Session with 1-minute takeover grace period
    """
    challenge_id = payload.challenge_id.strip()
    otp_candidate = payload.otp.strip()

    challenge = db.query(LoginOTP).filter(LoginOTP.challenge_id == challenge_id).first()
    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Verification challenge not found or has already been used. Please log in again."
        )

    now_utc = datetime.now(timezone.utc)
    exp = challenge.expires_at.replace(tzinfo=timezone.utc) if challenge.expires_at.tzinfo is None else challenge.expires_at

    # 1. Expiration check (5 minutes)
    if now_utc > exp:
        db.delete(challenge)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please sign in again to receive a fresh code."
        )

    # 2. Attempts check (max 5 attempts)
    if challenge.attempts >= 5:
        db.delete(challenge)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. For security, this challenge has been revoked. Please sign in again."
        )

    # 3. Verify HMAC hash
    if not verify_otp_hash(otp_candidate, challenge.otp_hash):
        challenge.attempts += 1
        db.commit()
        remaining_attempts = max(0, 5 - challenge.attempts)
        if remaining_attempts == 0:
            db.delete(challenge)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many incorrect attempts. This code has been revoked. Please sign in again."
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid verification code. {remaining_attempts} attempt{'s' if remaining_attempts > 1 else ''} remaining."
        )

    # ── SUCCESS: IMMEDIATELY DELETE CHALLENGE TO PREVENT ANY REPLAY / MULTI-DEVICE REUSE ──
    user = challenge.user
    op_loc = challenge.operating_location or "In Office"
    client_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent", "")
    device_summary = get_device_summary(request, op_loc)

    db.delete(challenge)
    db.commit()

    # Record login audit history
    log_entry = LoginHistory(
        user_id=user.id,
        operating_location=op_loc,
        ip_address=client_ip,
        user_agent=user_agent
    )
    db.add(log_entry)

    # ── SINGLE ACTIVE SESSION ENFORCEMENT WITH 1-MINUTE TAKEOVER GRACE PERIOD ──
    existing_session = db.query(AuthSession).filter(
        AuthSession.user_id == user.id,
        AuthSession.is_active == True,
        AuthSession.expires_at > now_utc
    ).order_by(AuthSession.created_at.desc()).first()

    new_session_token = generate_token()

    if existing_session:
        # Check if active session is in 30-minute protected mode from a previous decline
        if existing_session.takeover_lockout_until:
            lockout_end = existing_session.takeover_lockout_until.replace(tzinfo=timezone.utc) if existing_session.takeover_lockout_until.tzinfo is None else existing_session.takeover_lockout_until
            if lockout_end > now_utc:
                rem_sec = int((lockout_end - now_utc).total_seconds())
                rem_min = int((rem_sec + 59) // 60)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Active workstation declined remote login to protect uninterrupted work (e.g. exporting/editing). Remote login for this account is locked for {rem_min} more minute{'s' if rem_min != 1 else ''}."
                )

        # Device A is active on another device! Create 60-second takeover request
        db.query(SessionTakeoverRequest).filter(
            SessionTakeoverRequest.user_id == user.id,
            SessionTakeoverRequest.status == "pending"
        ).delete()

        takeover = SessionTakeoverRequest(
            user_id=user.id,
            existing_session_id=existing_session.id,
            new_session_token=new_session_token,
            new_operating_location=op_loc,
            new_device_info=device_summary,
            created_at=now_utc,
            expires_at=now_utc + timedelta(seconds=60),
            status="pending"
        )
        db.add(takeover)
        db.commit()

        return {
            "success": True,
            "takeover_pending": True,
            "takeover_id": takeover.id,
            "wait_seconds": 60,
            "existing_device": existing_session.device_info or "Active Workstation",
            "message": f"Another workstation ({existing_session.device_info or 'Active Device'}) is currently logged in. A 60-second authorization request has been sent to it."
        }

    # No existing active session: Issue 4-hour active session immediately
    session = AuthSession(
        user_id=user.id,
        session_token=new_session_token,
        operating_location=op_loc,
        device_info=device_summary,
        is_active=True,
        expires_at=now_utc + timedelta(hours=4)
    )
    db.add(session)

    # Clear failed attempts on successful login
    db.query(AuthFailedAttempt).filter(
        (AuthFailedAttempt.email == user.email) | (AuthFailedAttempt.ip_address == client_ip)
    ).delete()

    db.commit()

    return {
        "success": True,
        "token": new_session_token,
        "expires_in": 4 * 3600,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "employee_id": user.employee_id,
            "role": user.role or "editor",
            "is_admin": bool(user.is_admin or (user.role and user.role.lower() == "admin")),
            "operating_location": op_loc
        }
    }


@auth_router.post("/resend-otp")
def resend_login_otp(
    payload: ResendOtpRequest,
    db: Session = Depends(get_auth_db)
):
    """
    Resends fresh OTP with 60-second cooldown protection.
    """
    challenge_id = payload.challenge_id.strip()
    challenge = db.query(LoginOTP).filter(LoginOTP.challenge_id == challenge_id).first()
    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Verification challenge not found. Please log in again."
        )

    now_utc = datetime.now(timezone.utc)
    last_resend = challenge.last_resend_at.replace(tzinfo=timezone.utc) if challenge.last_resend_at.tzinfo is None else challenge.last_resend_at

    # 60s cooldown
    elapsed = (now_utc - last_resend).total_seconds()
    if elapsed < 60:
        wait_time = int(60 - elapsed)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Please wait {wait_time} second{'s' if wait_time > 1 else ''} before requesting another code."
        )

    user = challenge.user
    new_otp = generate_secure_otp()
    challenge.otp_hash = hash_otp(new_otp)
    challenge.expires_at = now_utc + timedelta(minutes=5)
    challenge.attempts = 0
    challenge.last_resend_at = now_utc
    db.commit()

    brevo_res = send_mfa_login_otp_email(
        user_name=user.name,
        user_email=user.email,
        otp=new_otp
    )

    if not brevo_res.get("success"):
        err_msg = brevo_res.get("error", "Email dispatch failed.")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to resend code: {err_msg}")

    return {
        "success": True,
        "message": "A fresh verification code has been sent to your email.",
        "expires_in_seconds": 300
    }


@auth_router.get("/verify-email")
def verify_email(token: str, db: Session = Depends(get_auth_db)):
    """
    Verifies a user's account using the verification token sent via Brevo.
    """
    if not token or not token.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token is required.")

    token_clean = token.strip()
    record = db.query(VerificationToken).filter(VerificationToken.token == token_clean).first()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid or unrecognized verification token."
        )

    if record.used:
        return {
            "success": True,
            "already_verified": True,
            "message": "This account is already verified. You can proceed to log in."
        }

    # Ensure timezone awareness
    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification link has expired. Please request a new verification link."
        )

    # Mark token used and activate user
    record.used = True
    user = db.query(User).filter(User.id == record.user_id).first()
    if user:
        user.is_verified = True
        db.commit()
        return {
            "success": True,
            "message": "Your email has been successfully verified! You may now log in to Subtitle Studio."
        }

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Associated user account not found.")


@auth_router.post("/resend-verification")
def resend_verification(payload: ResendVerificationRequest, request: Request, db: Session = Depends(get_auth_db)):
    """
    Resends an activation email if the account exists and is not yet verified.
    """
    email_clean = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email_clean).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email address."
        )

    if user.is_verified:
        return {
            "success": True,
            "message": "This account is already verified. You can log in directly."
        }

    # Create a fresh token
    new_token_str = generate_token()
    token_record = VerificationToken(
        user_id=user.id,
        token=new_token_str,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24)
    )
    db.add(token_record)
    db.commit()

    brevo_result = send_verification_email(
        user_name=user.name,
        user_email=user.email,
        verification_token=new_token_str,
        base_url=get_caller_origin(request)
    )

    if not brevo_result.get("success"):
        err = brevo_result.get("error", "Email service failure.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Brevo email dispatch failed: {err}"
        )

    return {
        "success": True,
        "message": "A fresh verification link has been sent to your email.",
        "email_status": brevo_result
    }


@auth_router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, request: Request, db: Session = Depends(get_auth_db)):
    """
    Initiates a password reset flow:
    - Verifies @verbolabs.com email
    - Checks user exists
    - Generates 1-hour secure single-use reset token
    - Dispatches reset link via Brevo
    """
    email_clean = payload.email.strip().lower()

    # 1. Domain verification
    is_valid_domain, domain_err = validate_verbolabs_email(email_clean)
    if not is_valid_domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=domain_err)

    # 2. Check if user exists
    user = db.query(User).filter(User.email == email_clean).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email address. Please sign up first."
        )

    # 3. Create fresh single-use password reset token (1 hour expiry)
    reset_token_str = generate_token()
    reset_record = PasswordResetToken(
        user_id=user.id,
        token=reset_token_str,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
    )
    db.add(reset_record)
    db.commit()

    # 4. Dispatch email via Brevo
    brevo_res = send_password_reset_email(
        user_name=user.name,
        user_email=user.email,
        reset_token=reset_token_str,
        base_url=get_caller_origin(request)
    )

    if not brevo_res.get("success"):
        err = brevo_res.get("error", "Email service failure.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Brevo email dispatch failed: {err}"
        )

    return {
        "success": True,
        "message": "Password reset instructions have been sent to your @verbolabs.com email.",
        "email_status": brevo_res
    }


@auth_router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_auth_db)):
    """
    Resets user password:
    - Validates token from email
    - Checks passwords match
    - Validates strict password policy (lower, upper, digit, symbol, space, 8+ chars)
    - Re-hashes with fresh salt
    - Invalidates reset token and old user sessions
    """
    token_clean = payload.token.strip()
    if not token_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset token is required.")

    token_record = db.query(PasswordResetToken).filter(PasswordResetToken.token == token_clean).first()
    if not token_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired reset token.")

    if token_record.used:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link has already been used.")

    # Check expiry
    expires_at = token_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link has expired. Please request a new one."
        )

    # Validate passwords match
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")

    # Validate password policy
    is_valid_pwd, pwd_errors = validate_password(payload.password)
    if not is_valid_pwd:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password does not meet requirements: {'; '.join(pwd_errors)}"
        )

    user = db.query(User).filter(User.id == token_record.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")

    # Hash new password with fresh salt
    new_hash, new_salt = hash_password(payload.password)
    user.password_hash = new_hash
    user.salt = new_salt
    user.updated_at = datetime.now(timezone.utc)

    # Invalidate token
    token_record.used = True

    # Invalidate all existing sessions for security
    db.query(AuthSession).filter(AuthSession.user_id == user.id).update({"is_active": False})

    db.commit()

    return {
        "success": True,
        "message": "Password updated successfully! You can now log in with your new password."
    }


@auth_router.get("/me")
def get_current_user_profile(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_auth_db)
):
    """
    Returns profile information of the currently authenticated user, slides 4-hour session,
    and checks if another device is requesting session takeover.
    """
    user = get_current_user_from_token(authorization=authorization, db=db)
    token = authorization.split(" ")[1].strip()
    session = db.query(AuthSession).filter(AuthSession.session_token == token).first()
    remaining = 4 * 3600
    now_utc = datetime.now(timezone.utc)

    takeover_info = None
    if session:
        exp = session.expires_at.replace(tzinfo=timezone.utc) if session.expires_at.tzinfo is None else session.expires_at
        remaining = max(0, int((exp - now_utc).total_seconds()))

        # Check for active takeover request targeting this session
        pending = db.query(SessionTakeoverRequest).filter(
            SessionTakeoverRequest.existing_session_id == session.id,
            SessionTakeoverRequest.status == "pending",
            SessionTakeoverRequest.expires_at > now_utc
        ).first()

        if pending:
            p_exp = pending.expires_at.replace(tzinfo=timezone.utc) if pending.expires_at.tzinfo is None else pending.expires_at
            takeover_info = {
                "takeover_id": pending.id,
                "requesting_device": pending.new_device_info,
                "remaining_seconds": max(0, int((p_exp - now_utc).total_seconds()))
            }

    return {
        "success": True,
        "expires_in": remaining,
        "takeover_requested": bool(takeover_info),
        "takeover": takeover_info,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "employee_id": user.employee_id,
            "role": user.role or "editor",
            "is_admin": is_super_admin(user.email),
            "total_spend_usd": getattr(user, "total_spend_usd", 0.0) or 0.0,
            "monthly_budget_usd": getattr(user, "monthly_budget_usd", 50.0) or 50.0,
            "max_videos_quota": getattr(user, "max_videos_quota", -1) if getattr(user, "max_videos_quota", None) is not None else -1,
            "can_export": getattr(user, "can_export", True) if getattr(user, "can_export", None) is not None else True,
            "can_ai_optimize": getattr(user, "can_ai_optimize", True) if getattr(user, "can_ai_optimize", None) is not None else True,
            "can_audio_peaks": getattr(user, "can_audio_peaks", True) if getattr(user, "can_audio_peaks", None) is not None else True,
            "is_verified": user.is_verified,
            "created_at": user.created_at.isoformat() if user.created_at else None
        }
    }


@auth_router.post("/logout")
def logout(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_auth_db)
):
    """
    Terminates the active session token and any user sessions.
    """
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1].strip()
        session = db.query(AuthSession).filter(AuthSession.session_token == token).first()
        if session:
            user_id = session.user_id
            db.query(AuthSession).filter(
                AuthSession.user_id == user_id,
                AuthSession.is_active == True
            ).update({"is_active": False})
            db.commit()
    return {"success": True, "message": "Successfully logged out."}


@auth_router.post("/validate-password")
def validate_password_live(payload: dict):
    """
    Helper endpoint for real-time frontend password requirement feedback.
    """
    pwd = payload.get("password", "")
    return check_password_policy(pwd)


@auth_router.get("/notifications")
def get_user_notifications(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Fetch notifications and feedback sent to current user."""
    notes = db.query(AdminNotification).filter(
        AdminNotification.user_id == current_user.id
    ).order_by(AdminNotification.created_at.desc()).limit(50).all()

    unread_count = sum(1 for n in notes if not n.is_read)

    return {
        "success": True,
        "unread_count": unread_count,
        "notifications": [
            {
                "id": n.id,
                "title": n.title,
                "message": n.message,
                "notification_type": n.notification_type,
                "admin_email": n.admin_email,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat() if n.created_at else None
            }
            for n in notes
        ]
    }


@auth_router.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Mark a notification as read."""
    note = db.query(AdminNotification).filter(
        AdminNotification.id == notification_id,
        AdminNotification.user_id == current_user.id
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Notification not found.")
    note.is_read = True
    db.commit()
    return {"success": True, "message": "Notification marked as read."}


@auth_router.delete("/notifications/clear-all")
@auth_router.post("/notifications/clear-all")
def clear_all_notifications(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Dismisses and clears all administrative notifications for current user."""
    db.query(AdminNotification).filter(
        AdminNotification.user_id == current_user.id
    ).delete()
    db.commit()
    return {"success": True, "message": "All notifications cleared."}


@auth_router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Dismisses/deletes an individual notification by ID."""
    note = db.query(AdminNotification).filter(
        AdminNotification.id == notification_id,
        AdminNotification.user_id == current_user.id
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Notification not found.")
    db.delete(note)
    db.commit()
    return {"success": True, "message": "Notification dismissed."}


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    operating_location: Optional[str] = None

@auth_router.patch("/profile")
def update_profile(
    payload: UpdateProfileRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_auth_db)
):
    """Allows authenticated user to update their profile name and operating location."""
    if payload.name is not None and payload.name.strip():
        current_user.name = payload.name.strip()
    if payload.operating_location is not None:
        current_user.operating_location = payload.operating_location.strip()
    db.commit()
    return {
        "success": True,
        "message": "Profile updated successfully.",
        "user": {
            "id": current_user.id,
            "name": current_user.name,
            "email": current_user.email,
            "role": current_user.role or "editor",
            "is_admin": is_super_admin(current_user.email),
            "is_verified": current_user.is_verified
        }
    }

