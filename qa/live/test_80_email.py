"""Email and account flows (opt-in, -m email).

Sends at most two real emails, both to the test account's own inbox: a sign-in code and a password
reset link. Neither changes the account: the code is never used, and the reset link is never opened.
Every other check uses inputs the server rejects before it creates, changes or emails anything,
and none of them records a failed sign-in (so they cannot trigger the IP lockout).
"""
import pytest

from conftest import TEST_EMAIL, expect

pytestmark = pytest.mark.email

QA_ID = "qa-live-nonexistent-7f3c9e1a"
STRONG = "Qa-Live-Check-2026!"


@pytest.fixture(scope="module")
def otp_challenge(client):
    r = client.request("POST", "/api/auth/login/otp/request", auth=False, write=True, json={"email": TEST_EMAIL})
    expect(r, 200)
    return r.json()


def test_otp_request_sends_code(otp_challenge):
    assert otp_challenge.get("challenge_id") and otp_challenge.get("email_masked"), f"response: {otp_challenge}"


@pytest.mark.parametrize("path", ["/api/auth/resend-otp", "/api/auth/request-otp"])
def test_otp_resend_cooldown(client, otp_challenge, path):
    # Within 60 s of the first code the server must refuse to send another one.
    r = client.request("POST", path, auth=False, write=True, json={"challenge_id": otp_challenge["challenge_id"]})
    expect(r, 429)


def test_otp_resend_unknown_challenge(client):
    expect(client.request("POST", "/api/auth/resend-otp", auth=False, write=True, json={"challenge_id": QA_ID}), 404)


def test_verify_otp_unknown_challenge(client):
    # Unknown challenge is rejected before any failed attempt is recorded.
    r = client.request("POST", "/api/auth/verify-otp", auth=False, write=True, json={"challenge_id": QA_ID, "otp": "000000"})
    expect(r, 404)


def test_forgot_password_sends_link(client):
    r = client.request("POST", "/api/auth/forgot-password", auth=False, write=True, json={"email": TEST_EMAIL})
    expect(r, 200)


def test_forgot_password_unknown_address_sends_nothing(client):
    # Refused either way. Note: production answers 404 "No account found", which tells anyone
    # whether an address has an account (account enumeration).
    expect(client.request("POST", "/api/auth/forgot-password", auth=False, write=True,
                          json={"email": "qa-live-nobody@verbolabs.com"}), 400, 404)


def test_reset_password_unknown_token(client):
    r = client.request("POST", "/api/auth/reset-password", auth=False, write=True,
                       json={"token": QA_ID, "password": STRONG, "confirm_password": STRONG})
    expect(r, 404)


def test_verify_email_unknown_token(client):
    expect(client.get("/api/auth/verify-email", query={"token": QA_ID}, auth=False), 404)


def test_resend_verification_already_verified(client):
    # The test account is verified, so the server answers without sending an email.
    r = client.request("POST", "/api/auth/resend-verification", auth=False, write=True, json={"email": TEST_EMAIL})
    expect(r, 200)


def test_signup_existing_account_conflict(client):
    # Passes every check, then stops at "account exists": nothing is created and no email is sent.
    r = client.request("POST", "/api/auth/signup", auth=False, write=True,
                       json={"name": "QA Live", "email": TEST_EMAIL, "password": STRONG, "confirm_password": STRONG})
    expect(r, 409)


def test_signup_rejects_other_domain(client):
    r = client.request("POST", "/api/auth/signup", auth=False, write=True,
                       json={"name": "QA Live", "email": "qa-live@example.com", "password": STRONG, "confirm_password": STRONG})
    expect(r, 400)


def test_signup_rejects_mismatched_passwords(client):
    r = client.request("POST", "/api/auth/signup", auth=False, write=True,
                       json={"name": "QA Live", "email": "qa-live-nobody@verbolabs.com", "password": STRONG,
                             "confirm_password": STRONG + "x"})
    expect(r, 400)


def test_signup_rejects_weak_password(client):
    r = client.request("POST", "/api/auth/signup", auth=False, write=True,
                       json={"name": "QA Live", "email": "qa-live-nobody@verbolabs.com", "password": "weak",
                             "confirm_password": "weak"})
    expect(r, 400)
