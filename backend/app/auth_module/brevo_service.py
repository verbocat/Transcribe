import os
import logging
import requests
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"

def _extract_brevo_error(response) -> str:
    """Parses clean error message from Brevo API response."""
    try:
        data = response.json()
        if isinstance(data, dict):
            msg = data.get("message") or data.get("error")
            if msg:
                return str(msg)
    except Exception:
        pass
    return f"Brevo HTTP {response.status_code}: {response.text[:250]}"

def _resolve_frontend_url(base_url: Optional[str] = None) -> str:
    """Resolves frontend base URL, preferring dynamic caller origin, then env, then localhost."""
    if base_url and isinstance(base_url, str) and base_url.strip():
        clean = base_url.strip().rstrip("/")
        if clean.startswith("http://") or clean.startswith("https://"):
            return clean
    env_url = os.getenv("FRONTEND_URL", "http://localhost:5173").strip().rstrip("/")
    return env_url or "http://localhost:5173"


def send_verification_email(
    user_name: str,
    user_email: str,
    verification_token: str,
    base_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Sends a verification email with activation link using Brevo Transactional Email API.
    If BREVO_API_KEY is not configured yet, logs the link clearly to console for local testing.
    """
    api_key = os.getenv("BREVO_API_KEY", "").strip()
    sender_email = os.getenv("BREVO_SENDER_EMAIL", "noreply@verbolabs.com").strip()
    sender_name = os.getenv("BREVO_SENDER_NAME", "VerboLabs Verification").strip()
    frontend_url = _resolve_frontend_url(base_url)

    verification_link = f"{frontend_url}/verify-email?token={verification_token}"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Verify your VerboLabs Account</title>
      <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }}
        .card {{ max-width: 520px; margin: 0 auto; background: #1e293b; border-radius: 12px; border: 1px solid #334155; padding: 36px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }}
        .brand {{ font-size: 22px; font-weight: 700; color: #38bdf8; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }}
        h2 {{ color: #ffffff; margin-top: 0; font-size: 24px; }}
        p {{ color: #cbd5e1; line-height: 1.6; font-size: 15px; }}
        .btn-container {{ text-align: center; margin: 32px 0; }}
        .btn {{ display: inline-block; background: linear-gradient(135deg, #0284c7, #2563eb); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; letter-spacing: 0.5px; box-shadow: 0 4px 14px 0 rgba(37,99,235,0.4); }}
        .link-text {{ word-break: break-all; color: #38bdf8; font-size: 13px; }}
        .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">VerboLabs Studios</div>
        <h2>Verify Your Email Address</h2>
        <p>Hello <strong>{user_name}</strong>,</p>
        <p>Thank you for signing up with your official VerboLabs account (<code>{user_email}</code>). To activate your account and access the Subtitle & Transcription platform, please verify your email address below:</p>
        <div class="btn-container">
          <a href="{verification_link}" class="btn" target="_blank">Verify Email Address</a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p class="link-text">{verification_link}</p>
        <p style="font-size: 13px; color: #94a3b8; margin-top: 24px;">This link will expire in 24 hours. If you did not create this account, please disregard this email.</p>
        <div class="footer">
          &copy; {2026} VerboLabs. Internal and authorized personnel only.
        </div>
      </div>
    </body>
    </html>
    """

    if not api_key:
        logger.warning("=================================================================")
        logger.warning("[BREVO NOTICE] BREVO_API_KEY is not set in .env.")
        logger.warning(f"[BREVO NOTICE] Simulation mode active for: {user_email}")
        logger.warning(f"[BREVO NOTICE] Verification Link: {verification_link}")
        logger.warning("=================================================================")
        print(f"\n[BREVO EMAIL SIMULATION] To: {user_email}\nLink: {verification_link}\n", flush=True)
        return {
            "success": True,
            "mode": "simulated",
            "message": "Verification email generated (Simulated - set BREVO_API_KEY in .env to send real email).",
            "verification_url": verification_link
        }

    headers = {
        "api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    payload = {
        "sender": {
            "name": sender_name,
            "email": sender_email
        },
        "to": [
            {
                "email": user_email,
                "name": user_name
            }
        ],
        "subject": "Verify your VerboLabs Account",
        "htmlContent": html_content
    }

    try:
        response = requests.post(BREVO_API_URL, json=payload, headers=headers, timeout=10)
        if 200 <= response.status_code < 300:
            logger.info(f"Brevo email dispatched successfully to {user_email}")
            return {
                "success": True,
                "mode": "live",
                "message": "Verification email dispatched via Brevo.",
                "brevo_id": response.json().get("messageId", "")
            }
        else:
            err_msg = _extract_brevo_error(response)
            logger.error(f"Brevo API error ({response.status_code}): {err_msg}")
            return {
                "success": False,
                "mode": "live",
                "error": err_msg,
                "verification_url": verification_link
            }
    except Exception as e:
        logger.error(f"Failed to communicate with Brevo API: {e}")
        return {
            "success": False,
            "mode": "live",
            "error": str(e),
            "verification_url": verification_link
        }


def send_password_reset_email(
    user_name: str,
    user_email: str,
    reset_token: str,
    base_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Sends a password reset email with secure token link using Brevo.
    """
    api_key = os.getenv("BREVO_API_KEY", "").strip()
    sender_email = os.getenv("BREVO_SENDER_EMAIL", "noreply@verbolabs.com").strip()
    sender_name = os.getenv("BREVO_SENDER_NAME", "VerboLabs Security").strip()
    frontend_url = _resolve_frontend_url(base_url)

    reset_link = f"{frontend_url}/reset-password?token={reset_token}"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Reset Your VerboLabs Password</title>
      <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }}
        .card {{ max-width: 520px; margin: 0 auto; background: #1e293b; border-radius: 12px; border: 1px solid #334155; padding: 36px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }}
        .brand {{ font-size: 22px; font-weight: 700; color: #38bdf8; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }}
        h2 {{ color: #ffffff; margin-top: 0; font-size: 24px; }}
        p {{ color: #cbd5e1; line-height: 1.6; font-size: 15px; }}
        .btn-container {{ text-align: center; margin: 32px 0; }}
        .btn {{ display: inline-block; background: linear-gradient(135deg, #e11d48, #be123c); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; letter-spacing: 0.5px; box-shadow: 0 4px 14px 0 rgba(225,29,72,0.4); }}
        .link-text {{ word-break: break-all; color: #38bdf8; font-size: 13px; }}
        .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">VerboLabs Security</div>
        <h2>Password Reset Request</h2>
        <p>Hello <strong>{user_name}</strong>,</p>
        <p>We received a request to reset the password for your VerboLabs account (<code>{user_email}</code>). Click the button below to choose a new password:</p>
        <div class="btn-container">
          <a href="{reset_link}" class="btn" target="_blank">Reset Password</a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p class="link-text">{reset_link}</p>
        <p style="font-size: 13px; color: #94a3b8; margin-top: 24px;">This password reset link is single-use and will expire in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
        <div class="footer">
          &copy; {2026} VerboLabs. Internal and authorized personnel only.
        </div>
      </div>
    </body>
    </html>
    """

    if not api_key:
        logger.warning("=================================================================")
        logger.warning("[BREVO NOTICE] BREVO_API_KEY is not set in .env.")
        logger.warning(f"[BREVO NOTICE] Password Reset Simulation for: {user_email}")
        logger.warning(f"[BREVO NOTICE] Reset Link: {reset_link}")
        logger.warning("=================================================================")
        print(f"\n[BREVO RESET SIMULATION] To: {user_email}\nLink: {reset_link}\n", flush=True)
        return {
            "success": True,
            "mode": "simulated",
            "message": "Password reset link generated (Simulated - set BREVO_API_KEY in .env to send real email).",
            "reset_url": reset_link
        }

    headers = {
        "api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    payload = {
        "sender": {
            "name": sender_name,
            "email": sender_email
        },
        "to": [
            {
                "email": user_email,
                "name": user_name
            }
        ],
        "subject": "Reset your VerboLabs Account Password",
        "htmlContent": html_content
    }

    try:
        response = requests.post(BREVO_API_URL, json=payload, headers=headers, timeout=10)
        if 200 <= response.status_code < 300:
            logger.info(f"Brevo password reset email dispatched successfully to {user_email}")
            return {
                "success": True,
                "mode": "live",
                "message": "Password reset email dispatched via Brevo.",
                "brevo_id": response.json().get("messageId", "")
            }
        else:
            err_msg = _extract_brevo_error(response)
            logger.error(f"Brevo API error ({response.status_code}): {err_msg}")
            return {
                "success": False,
                "mode": "live",
                "error": err_msg,
                "reset_url": reset_link
            }
    except Exception as e:
        logger.error(f"Failed to communicate with Brevo API for reset: {e}")
        return {
            "success": False,
            "mode": "live",
            "error": str(e),
            "reset_url": reset_link
        }


def send_mfa_login_otp_email(
    user_name: str,
    user_email: str,
    otp: str
) -> Dict[str, Any]:
    """
    Dispatches a single-use 6-digit MFA login verification code to the user's registered email via Brevo.
    Expires in 5 minutes.
    """
    api_key = os.getenv("BREVO_API_KEY", "").strip()
    sender_email = os.getenv("BREVO_SENDER_EMAIL", "noreply@verbolabs.com").strip()
    sender_name = os.getenv("BREVO_SENDER_NAME", "VerboLabs Security").strip()

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Your VerboLabs Verification Code</title>
      <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0e0f12; color: #f1f2f6; margin: 0; padding: 36px 20px; }}
        .card {{ max-width: 480px; margin: 0 auto; background: #14151a; border-radius: 14px; border: 1px solid #262734; padding: 36px 32px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }}
        .brand {{ font-size: 20px; font-weight: 800; color: #00e5be; margin-bottom: 20px; letter-spacing: 0.5px; }}
        h2 {{ color: #ffffff; margin-top: 0; font-size: 22px; font-weight: 700; }}
        p {{ color: #94a3b8; line-height: 1.6; font-size: 14px; margin: 12px 0; }}
        .otp-box {{ text-align: center; margin: 28px 0; padding: 20px; background: #0a0b0e; border-radius: 10px; border: 1px solid #00e5be; }}
        .otp-code {{ font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #00e5be; }}
        .badge {{ display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #f59e0b; background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.3); padding: 4px 10px; border-radius: 6px; margin-top: 8px; }}
        .footer {{ margin-top: 28px; padding-top: 18px; border-top: 1px solid #262734; font-size: 12px; color: #64748b; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">VerboLabs Studio</div>
        <h2>Login Verification Code</h2>
        <p>Hello <strong>{user_name}</strong>,</p>
        <p>You recently requested to sign in to VerboLabs Subtitle & Transcription Studio. Use the one-time verification code below to complete your login:</p>
        
        <div class="otp-box">
          <div class="otp-code">{otp}</div>
          <div class="badge">Valid for 5 minutes · Single Use</div>
        </div>

        <p style="font-size: 13px; color: #cbd5e1;">This code is tied strictly to your current login attempt and will be immediately invalidated after use. If you did not attempt to sign in, someone may know your password—please update your credentials immediately.</p>

        <div class="footer">
          &copy; 2026 VerboLabs. Enterprise Audio & Subtitle Intelligence.
        </div>
      </div>
    </body>
    </html>
    """

    if not api_key:
        logger.warning(f"[BREVO SIMULATION] OTP for {user_email}: {otp}")
        print(f"\n=======================================================", flush=True)
        print(f"[MFA EMAIL SIMULATION] To: {user_email}", flush=True)
        print(f"[MFA CODE] {otp} (Expires in 5 minutes)", flush=True)
        print(f"=======================================================\n", flush=True)
        return {
            "success": True,
            "mode": "simulated",
            "message": "OTP generated (Simulated mode)."
        }

    headers = {
        "api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    payload = {
        "sender": {
            "name": sender_name,
            "email": sender_email
        },
        "to": [
            {
                "email": user_email,
                "name": user_name
            }
        ],
        "subject": "Your VerboLabs Login Verification Code",
        "htmlContent": html_content
    }

    try:
        response = requests.post(BREVO_API_URL, json=payload, headers=headers, timeout=10)
        if 200 <= response.status_code < 300:
            logger.info(f"Brevo MFA OTP email dispatched successfully to {user_email}")
            return {
                "success": True,
                "mode": "live",
                "message": "Verification code dispatched via Brevo."
            }
        else:
            err_msg = _extract_brevo_error(response)
            logger.error(f"Brevo API error ({response.status_code}): {err_msg}")
            return {
                "success": False,
                "mode": "live",
                "error": err_msg
            }
    except Exception as e:
        logger.error(f"Failed to communicate with Brevo: {e}")
        return {
            "success": False,
            "mode": "live",
            "error": str(e)
        }

