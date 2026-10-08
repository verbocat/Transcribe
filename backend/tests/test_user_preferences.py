import uuid
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth_module.database import SessionLocal, init_auth_db
from app.auth_module.models import User, AuthSession
from app.auth_module.routes import auth_router
from app.auth_module.security import hash_password


def _client_and_token():
    init_auth_db()
    db = SessionLocal()
    h, s = hash_password("SecurePassword123!")
    user = User(name="Layout Tester", email=f"layout_{uuid.uuid4().hex[:6]}@verbolabs.com", password_hash=h, salt=s, is_verified=True)
    db.add(user)
    db.commit()
    token = uuid.uuid4().hex
    db.add(AuthSession(user_id=user.id, session_token=token, expires_at=datetime.now(timezone.utc) + timedelta(hours=4)))
    db.commit()
    db.close()
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")
    return TestClient(app), {"Authorization": f"Bearer {token}"}


def test_layout_round_trip_per_account():
    client, auth = _client_and_token()
    assert client.get("/api/auth/preferences/transcribe_layout", headers=auth).json() == {"value": None}
    layout = {"speakersPos": "right", "speakersW": 320}
    assert client.put("/api/auth/preferences/transcribe_layout", json={"value": layout}, headers=auth).status_code == 200
    assert client.get("/api/auth/preferences/transcribe_layout", headers=auth).json()["value"] == layout
    # a second account does not see it
    other, other_auth = _client_and_token()
    assert other.get("/api/auth/preferences/transcribe_layout", headers=other_auth).json() == {"value": None}


def test_preferences_require_login_and_known_key():
    client, auth = _client_and_token()
    assert client.get("/api/auth/preferences/transcribe_layout").status_code == 401
    assert client.put("/api/auth/preferences/anything", json={"value": {}}, headers=auth).status_code == 404
