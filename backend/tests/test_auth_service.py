import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.auth_module.database import get_auth_db, SessionLocal, AuthBase, engine
from app.auth_module.security import validate_verbolabs_email, validate_signup_email, validate_password, check_password_policy
from app.auth_module.models import User, VerificationToken, LoginHistory, AuthFailedAttempt, LoginOTP

client = TestClient(app)


def login_with_password(email, password):
    """Password sign-in: a correct password signs in directly, with no OTP step."""
    return client.post("/api/auth/login", json={"email": email, "password": password})


def login_with_otp(email):
    """OTP sign-in: request a code for the email (no password), then verify it."""
    sent = {}
    def capture_otp(user_name, user_email, otp):
        sent["otp"] = otp
        return {"success": True, "mode": "mock", "message": "OK"}

    with patch("app.auth_module.routes.send_mfa_login_otp_email", side_effect=capture_otp):
        req = client.post("/api/auth/login/otp/request", json={"email": email})
    if req.status_code != 200:
        return req
    return client.post("/api/auth/verify-otp", json={"challenge_id": req.json()["challenge_id"], "otp": sent["otp"]})

class TestAuthService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        AuthBase.metadata.create_all(bind=engine)

    def tearDown(self):
        # Clean up test users
        db = SessionLocal()
        try:
            db.query(User).filter(User.email.like("%test_%@verbolabs.com")).delete(synchronize_session=False)
            # Failed logins are counted per IP, and every TestClient request shares one,
            # so clear them to keep one test's failures from tripping the next one's bot check.
            db.query(AuthFailedAttempt).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()

    def test_email_domain_validation(self):
        # Valid domain
        valid, msg = validate_verbolabs_email("john.doe@verbolabs.com")
        self.assertTrue(valid)
        self.assertEqual(msg, "")

        valid_sub, msg = validate_verbolabs_email("tech@dev.verbolabs.com")
        self.assertTrue(valid_sub)

        # Sign-in accepts any well-formed domain so older accounts keep working
        other1, _ = validate_verbolabs_email("user@gmail.com")
        self.assertTrue(other1)

        other2, _ = validate_verbolabs_email("user@yahoo.co.in")
        self.assertTrue(other2)

        # Malformed addresses are rejected
        invalid1, msg1 = validate_verbolabs_email("notanemail")
        self.assertFalse(invalid1)
        self.assertIn("valid email", msg1.lower())

        invalid2, _ = validate_verbolabs_email("")
        self.assertFalse(invalid2)

    def test_signup_email_domain_restricted(self):
        self.assertTrue(validate_signup_email("john.doe@verbolabs.com")[0])
        self.assertTrue(validate_signup_email("John.Doe@VerboLabs.com ")[0])
        for bad in ["user@gmail.com", "user@verbolabs.co", "user@dev.verbolabs.com",
                    "user@verbolabs.com.evil.io", "user@notverbolabs.com"]:
            ok, msg = validate_signup_email(bad)
            self.assertFalse(ok, bad)
            self.assertIn("@verbolabs.com", msg)
        self.assertFalse(validate_signup_email("notanemail")[0])

    @patch("app.auth_module.routes.send_verification_email", return_value={"success": True, "mode": "mock", "message": "OK"})
    def test_signup_rejects_other_domains_at_api(self, mock_email):
        res = client.post("/api/auth/signup", json={
            "name": "Mallory Tester",
            "email": "test_mallory@gmail.com",
            "password": "Secure Pass#2026",
            "confirm_password": "Secure Pass#2026"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("@verbolabs.com", res.json()["detail"])
        mock_email.assert_not_called()

    @patch("app.auth_module.routes.send_verification_email", return_value={"success": True, "mode": "mock", "message": "OK"})
    def test_otp_login_and_legacy_account(self, mock_email):
        """OTP sign-in needs no password; accounts with stored employee ID / other domains still work."""
        email = "test_otp_user@verbolabs.com"
        pwd = "Secure Pass#2026"
        client.post("/api/auth/signup", json={"name": "Otto Tester", "email": email, "password": pwd, "confirm_password": pwd})
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            user.is_verified = True
            user.employee_id = "EMP-LEGACY"  # data from before the field was removed
            db.commit()
        finally:
            db.close()

        res = login_with_otp(email)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["user"]["email"], email)
        self.assertNotIn("employee_id", data["user"])

        # A second code cannot be requested straight away (cooldown), and a wrong code fails
        with patch("app.auth_module.routes.send_mfa_login_otp_email", return_value={"success": True}):
            client.post("/api/auth/logout", headers={"Authorization": f"Bearer {data['token']}"})
            first = client.post("/api/auth/login/otp/request", json={"email": email})
            self.assertEqual(first.status_code, 200)
            again = client.post("/api/auth/login/otp/request", json={"email": email})
            self.assertEqual(again.status_code, 429)
        bad = client.post("/api/auth/verify-otp", json={"challenge_id": first.json()["challenge_id"], "otp": "000000"})
        self.assertIn(bad.status_code, (401,))

    def test_password_policy(self):
        # Valid password: 8+ chars, lower, UPPER, number, symbol, SPACE
        valid_pwd = "Verbo Pass@123"
        valid, errors = validate_password(valid_pwd)
        self.assertTrue(valid, f"Expected valid, got errors: {errors}")

        # Space is optional: password without space is now valid
        no_space = "VerboPass@123"
        valid, errors = validate_password(no_space)
        self.assertTrue(valid)

        # Missing symbol
        no_symbol = "Verbo Pass 123"
        valid, errors = validate_password(no_symbol)
        self.assertFalse(valid)
        self.assertTrue(any("symbol" in e.lower() for e in errors))

        # Missing number
        no_number = "Verbo Pass@xyz"
        valid, errors = validate_password(no_number)
        self.assertFalse(valid)
        self.assertTrue(any("digit" in e.lower() or "numeric" in e.lower() for e in errors))

        # Missing uppercase
        no_upper = "verbo pass@123"
        valid, errors = validate_password(no_upper)
        self.assertFalse(valid)
        self.assertTrue(any("uppercase" in e.lower() for e in errors))

        # Too short (< 8 chars)
        too_short = "V p@1"
        valid, errors = validate_password(too_short)
        self.assertFalse(valid)
        self.assertTrue(any("8 characters" in e.lower() for e in errors))

    @patch("app.auth_module.routes.send_verification_email", return_value={"success": True, "mode": "mock", "message": "OK"})
    def test_signup_login_flow(self, mock_email):
        test_email = "test_alice@verbolabs.com"
        test_password = "Secure Pass#2026"

        # 1. Signup with a malformed email
        bad_signup = client.post("/api/auth/signup", json={
            "name": "Alice Tester",
            "email": "alice-at-nowhere",
            "password": test_password,
            "confirm_password": test_password
        })
        self.assertEqual(bad_signup.status_code, 400)
        self.assertIn("valid email", bad_signup.json()["detail"].lower())

        # 2. Signup with valid credentials
        signup_res = client.post("/api/auth/signup", json={
            "name": "Alice Tester",
            "email": test_email,
            "password": test_password,
            "confirm_password": test_password
        })
        self.assertEqual(signup_res.status_code, 201)
        self.assertTrue(signup_res.json()["success"])

        # 3. Duplicate signup check
        dup_res = client.post("/api/auth/signup", json={
            "name": "Alice Tester",
            "email": test_email,
            "password": test_password,
            "confirm_password": test_password
        })
        self.assertEqual(dup_res.status_code, 409)
        self.assertIn("already exists", dup_res.json()["detail"].lower())

        # 5. Attempt login with non-existent email -> should return 404
        login_not_found = client.post("/api/auth/login", json={
            "email": "test_ghost@verbolabs.com",
            "password": test_password
        })
        self.assertEqual(login_not_found.status_code, 404)
        self.assertIn("no account found", login_not_found.json()["detail"].lower())

        # 6. Verify email using database token
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == test_email).first()
            self.assertIsNotNone(user)
            token_obj = db.query(VerificationToken).filter(VerificationToken.user_id == user.id).first()
            self.assertIsNotNone(token_obj)
            token_str = token_obj.token
        finally:
            db.close()

        verify_res = client.get(f"/api/auth/verify-email?token={token_str}")
        self.assertEqual(verify_res.status_code, 200)
        self.assertTrue(verify_res.json()["success"])

        # 7. Login with wrong password -> should return 401
        login_wrong_pwd = client.post("/api/auth/login", json={
            "email": test_email,
            "password": "Wrong Pass!999"
        })
        self.assertEqual(login_wrong_pwd.status_code, 401)
        self.assertIn("incorrect password", login_wrong_pwd.json()["detail"].lower())

        # 8. Two failures so far (unknown email, wrong password): login now needs the bot check
        login_needs_check = client.post("/api/auth/login", json={
            "email": test_email,
            "password": test_password
        })
        self.assertEqual(login_needs_check.status_code, 403)
        self.assertIn("security verification", login_needs_check.json()["detail"].lower())

        db = SessionLocal()
        try:
            db.query(AuthFailedAttempt).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()

        # 9. Successful password login: signs in directly, no OTP asked for
        login_success = login_with_password(test_email, test_password)
        self.assertEqual(login_success.status_code, 200)
        login_data = login_success.json()
        self.assertTrue(login_data["success"])
        session_token = login_data["token"]
        self.assertNotIn("operating_location", login_data["user"])
        self.assertNotIn("employee_id", login_data["user"])

        # 10. Check /api/auth/me with session token
        me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {session_token}"})
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()["user"]["email"], test_email)

        # 11. Verify login history recorded
        db = SessionLocal()
        try:
            history = db.query(LoginHistory).filter(LoginHistory.user_id == user.id).all()
            self.assertEqual(len(history), 1)
        finally:
            db.close()

    @patch("app.auth_module.routes.send_password_reset_email", return_value={"success": True, "mode": "mock", "message": "OK"})
    @patch("app.auth_module.routes.send_verification_email", return_value={"success": True, "mode": "mock", "message": "OK"})
    def test_forgot_and_reset_password_flow(self, mock_verify, mock_reset):
        from app.auth_module.models import PasswordResetToken

        test_email = "test_bob@verbolabs.com"
        old_password = "Old Password#123"
        new_password = "New Password$2026"

        # 1. Signup and activate Bob
        signup_res = client.post("/api/auth/signup", json={
            "name": "Bob Reset",
            "email": test_email,
            "password": old_password,
            "confirm_password": old_password
        })
        self.assertEqual(signup_res.status_code, 201)

        # Activate user in DB
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == test_email).first()
            user.is_verified = True
            db.commit()
            user_id = user.id
        finally:
            db.close()

        # 2. Request forgot password for non-existent email -> 404
        bad_fp = client.post("/api/auth/forgot-password", json={"email": "test_ghost@verbolabs.com"})
        self.assertEqual(bad_fp.status_code, 404)

        # 3. Request forgot password for Bob -> 200
        fp_res = client.post("/api/auth/forgot-password", json={"email": test_email})
        self.assertEqual(fp_res.status_code, 200)
        self.assertTrue(fp_res.json()["success"])

        # Fetch reset token from DB
        db = SessionLocal()
        try:
            reset_record = db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user_id, PasswordResetToken.used == False).first()
            self.assertIsNotNone(reset_record)
            reset_token = reset_record.token
        finally:
            db.close()

        # 4. Attempt reset with mismatching passwords -> 400
        mismatch_res = client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": new_password,
            "confirm_password": "Different Password!99"
        })
        self.assertEqual(mismatch_res.status_code, 400)
        self.assertIn("do not match", mismatch_res.json()["detail"].lower())

        # 5. Attempt reset with weak password (missing symbol) -> 400
        weak_res = client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": "NewPassword2026",
            "confirm_password": "NewPassword2026"
        })
        self.assertEqual(weak_res.status_code, 400)
        self.assertIn("symbol", weak_res.json()["detail"].lower())

        # 6. Valid reset password -> 200
        valid_reset = client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": new_password,
            "confirm_password": new_password
        })
        self.assertEqual(valid_reset.status_code, 200)
        self.assertTrue(valid_reset.json()["success"])

        # 7. Token cannot be reused -> 400
        reuse_res = client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": new_password,
            "confirm_password": new_password
        })
        self.assertEqual(reuse_res.status_code, 400)

        # 8. Attempt login with OLD password -> should fail (401)
        old_login = client.post("/api/auth/login", json={
            "email": test_email,
            "password": old_password
        })
        self.assertEqual(old_login.status_code, 401)

        # 9. Attempt login with NEW password -> should SUCCEED (200)
        new_login = login_with_password(test_email, new_password)
        self.assertEqual(new_login.status_code, 200)
        self.assertTrue(new_login.json()["success"])


if __name__ == "__main__":
    unittest.main()
