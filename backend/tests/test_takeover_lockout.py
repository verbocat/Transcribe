import sys
from pathlib import Path
import uuid
from datetime import datetime, timezone, timedelta

# Ensure backend is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.auth_module.database import SessionLocal, init_auth_db
from app.auth_module.models import User, AuthSession, SessionTakeoverRequest, LoginOTP
from app.auth_module.security import hash_password, hash_otp

def run_tests():
    init_auth_db()
    db = SessionLocal()

    test_email = f"export_editor_{uuid.uuid4().hex[:6]}@verbolabs.com"
    pwd = "SecurePassword123!"
    h, s = hash_password(pwd)

    # 1. Create user
    user = User(
        name="Test Export Editor",
        email=test_email,
        password_hash=h,
        salt=s,
        is_verified=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    now_utc = datetime.now(timezone.utc)

    # 2. Simulate Device A active session (e.g. Exporting subtitles)
    token_a = f"token_a_{uuid.uuid4().hex}"
    session_a = AuthSession(
        user_id=user.id,
        session_token=token_a,
        device_info="Workstation-A (Chrome / Windows)",
        is_active=True,
        expires_at=now_utc + timedelta(hours=4)
    )
    db.add(session_a)
    db.commit()
    db.refresh(session_a)

    print("[PASS] Step 1: Device A active session created.")

    # 3. Simulate Device B requesting takeover
    token_b = f"token_b_{uuid.uuid4().hex}"
    takeover = SessionTakeoverRequest(
        user_id=user.id,
        existing_session_id=session_a.id,
        new_session_token=token_b,
        new_device_info="Workstation-B (Firefox / MacOS)",
        created_at=now_utc,
        expires_at=now_utc + timedelta(seconds=60),
        status="pending"
    )
    db.add(takeover)
    db.commit()
    db.refresh(takeover)

    print("[PASS] Step 2: Takeover request created for Device B.")

    # 4. Device A denies within 1 minute ("Keep Working on This Device")
    from app.auth_module.routes import submit_takeover_decision, TakeoverDecisionRequest, get_takeover_status, login, LoginRequest
    from unittest.mock import MagicMock

    req_payload = TakeoverDecisionRequest(takeover_id=takeover.id, decision="keep")
    decision_res = submit_takeover_decision(
        payload=req_payload,
        authorization=f"Bearer {token_a}",
        db=db
    )
    print(f"[PASS] Step 3: Device A decision submitted: {decision_res}")
    assert decision_res["decision"] == "keep"
    assert decision_res["lockout_minutes"] == 30

    db.refresh(session_a)
    lockout_ts = session_a.takeover_lockout_until.replace(tzinfo=timezone.utc) if session_a.takeover_lockout_until.tzinfo is None else session_a.takeover_lockout_until
    assert lockout_ts > now_utc
    print(f"[PASS] Step 4: Active session takeover_lockout_until set to: {session_a.takeover_lockout_until}")

    # 5. Device B polling /takeover/status receives rejected with 30-min lockout message
    status_res = get_takeover_status(takeover_id=takeover.id, db=db)
    print(f"[PASS] Step 5: Device B status response: {status_res}")
    assert status_res["status"] == "rejected"
    assert status_res["lockout_minutes"] >= 29
    assert "30 minutes" in status_res["message"] or "minutes" in status_res["message"]

    # 6. Device B attempts to log in again immediately -> MUST BE BLOCKED WITH 403
    mock_request = MagicMock()
    mock_request.client.host = "192.168.1.50"
    mock_request.headers.get.return_value = "Workstation-B"

    login_payload = LoginRequest(
        email=test_email,
        password=pwd
    )

    from fastapi import HTTPException
    blocked = False
    try:
        login(payload=login_payload, request=mock_request, db=db)
    except HTTPException as e:
        blocked = True
        print(f"[PASS] Step 6: Subsequent login blocked with HTTP {e.status_code}: {e.detail}")
        assert e.status_code == 403
        assert "Active workstation declined remote login" in e.detail

    assert blocked, "Subsequent login should have been blocked during 30-minute lockout!"

    # 7. Device A finishes exporting subtitles and voluntarily logs out
    from app.auth_module.routes import logout
    logout_res = logout(authorization=f"Bearer {token_a}", db=db)
    print(f"[PASS] Step 7: Device A logged out: {logout_res}")

    # 8. Device B attempts to log in now -> Device A is gone, so a password login signs in directly (no OTP)
    login_after_logout = login(payload=login_payload, request=mock_request, db=db)
    print(f"[PASS] Step 8: Device B login succeeded after Device A logged out: {bool(login_after_logout.get('token'))}")
    assert login_after_logout.get("token")

    # Clean up test data
    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete()
    db.query(SessionTakeoverRequest).filter(SessionTakeoverRequest.user_id == user.id).delete()
    db.query(LoginOTP).filter(LoginOTP.user_id == user.id).delete()
    db.query(User).filter(User.id == user.id).delete()
    db.commit()
    db.close()

    print("\nALL 8 WORKSTATION TAKEOVER LOCKOUT TESTS PASSED PERFECTLY!\n")

if __name__ == "__main__":
    run_tests()
