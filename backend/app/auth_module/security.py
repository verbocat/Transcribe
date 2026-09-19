import re
import secrets
import hashlib
from typing import Tuple, List, Dict, Any

# Domain constraint
ALLOWED_DOMAIN_SUFFIX = ".verbolabs.com"
ALLOWED_PRIMARY_DOMAIN = "@verbolabs.com"

def validate_verbolabs_email(email: str) -> Tuple[bool, str]:
    """
    Validates that the email belongs to verbolabs.com domain.
    Accepts e.g. name@verbolabs.com or name@dept.verbolabs.com
    """
    if not email or not isinstance(email, str):
        return False, "Email is required."
    
    clean_email = email.strip().lower()
    
    # Must contain @
    if "@" not in clean_email:
        return False, "Invalid email format."
    
    local_part, domain_part = clean_email.split("@", 1)
    if not local_part:
        return False, "Invalid email username."
        
    if not (domain_part == "verbolabs.com" or domain_part.endswith(ALLOWED_DOMAIN_SUFFIX)):
        return False, "Access restricted: Only official @verbolabs.com email addresses are permitted to register or log in."
        
    return True, ""


def check_password_policy(password: str) -> Dict[str, Any]:
    """
    Checks all individual password criteria required by VerboLabs:
    - At least 8 characters
    - At least one lowercase letter
    - At least one uppercase letter
    - At least one numeric digit
    - At least one special symbol
    (Space is optional)
    """
    if not password:
        password = ""

    criteria = {
        "min_length": len(password) >= 8,
        "has_lowercase": bool(re.search(r"[a-z]", password)),
        "has_uppercase": bool(re.search(r"[A-Z]", password)),
        "has_number": bool(re.search(r"[0-9]", password)),
        "has_symbol": bool(re.search(r"[!@#$%^&*(),.?\":{}|<>[\]\\/'`~_+=;-]", password)),
    }
    
    criteria["is_valid"] = all(criteria.values())
    return criteria


def validate_password(password: str) -> Tuple[bool, List[str]]:
    """
    Validates password and returns list of human-readable error messages for failing criteria.
    """
    policy = check_password_policy(password)
    errors = []
    
    if not policy["min_length"]:
        errors.append("Password must be at least 8 characters long.")
    if not policy["has_lowercase"]:
        errors.append("Password must contain at least one lowercase letter (a-z).")
    if not policy["has_uppercase"]:
        errors.append("Password must contain at least one uppercase letter (A-Z).")
    if not policy["has_number"]:
        errors.append("Password must contain at least one numeric digit (0-9).")
    if not policy["has_symbol"]:
        errors.append("Password must contain at least one special symbol (e.g. !@#$%^&*).")
        
    return len(errors) == 0, errors


def hash_password(password: str, salt: str = None) -> Tuple[str, str]:
    """
    Hashes a password using PBKDF2-HMAC-SHA256 with 100,000 iterations and a secure salt.
    """
    if not salt:
        salt = secrets.token_hex(16)
    
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return key.hex(), salt


def verify_password(password: str, hashed: str, salt: str) -> bool:
    """
    Secure constant-time verification of password against stored hash and salt.
    """
    candidate_key, _ = hash_password(password, salt)
    return secrets.compare_digest(candidate_key, hashed)


def generate_token() -> str:
    """Generates a cryptographically strong random token."""
    return secrets.token_urlsafe(32)


def generate_secure_otp() -> str:
    """Generates a cryptographically secure 6-digit numeric OTP (e.g. 042781)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def get_otp_secret() -> str:
    """Reads server OTP secret from env or generates a consistent fallback."""
    import os
    secret = os.getenv("OTP_SECRET", "").strip()
    if not secret or secret == "Arpit":
        secret = os.getenv("DATABASE_URL", "verbolabs_default_otp_secret_key_2026")
    return secret


def hash_otp(otp: str) -> str:
    """
    Hashes a 6-digit OTP using HMAC-SHA256 with server-side secret.
    Prevents rainbow table precomputation attacks against 6-digit codes.
    """
    import hmac
    secret = get_otp_secret()
    h = hmac.new(secret.encode('utf-8'), otp.strip().encode('utf-8'), hashlib.sha256)
    return h.hexdigest()


def verify_otp_hash(otp: str, stored_hash: str) -> bool:
    """
    Constant-time comparison of candidate OTP hash against stored HMAC hash.
    """
    import hmac
    candidate_hash = hash_otp(otp)
    return hmac.compare_digest(candidate_hash, stored_hash)

