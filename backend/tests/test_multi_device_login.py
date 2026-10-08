import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth_module.database import SessionLocal, init_auth_db
from app.auth_module.models import User
from app.auth_module.routes import auth_router
from app.auth_module.security import hash_password

PASSWORD = "SecurePassword123!"


def _client_and_email():
    init_auth_db()
    db = SessionLocal()
    h, s = hash_password(PASSWORD)
    email = f"multi_{uuid.uuid4().hex[:6]}@verbolabs.com"
    db.add(User(name="Multi Device", email=email, password_hash=h, salt=s, is_verified=True))
    db.commit()
    db.close()
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")
    return TestClient(app), email


def _login(client, email):
    res = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    body = res.json()
    assert "takeover_pending" not in body
    return {"Authorization": f"Bearer {body['token']}"}


def test_second_login_does_not_wait_or_end_first_session():
    client, email = _client_and_email()
    device_a = _login(client, email)
    device_b = _login(client, email)
    assert device_a != device_b
    for headers in (device_a, device_b):
        res = client.get("/api/auth/me", headers=headers)
        assert res.status_code == 200
        assert "takeover" not in res.json()


def test_logout_only_ends_that_device():
    client, email = _client_and_email()
    device_a = _login(client, email)
    device_b = _login(client, email)
    assert client.post("/api/auth/logout", headers=device_a).status_code == 200
    assert client.get("/api/auth/me", headers=device_a).status_code == 401
    assert client.get("/api/auth/me", headers=device_b).status_code == 200


def test_takeover_endpoints_are_gone():
    client, _ = _client_and_email()
    assert client.get("/api/auth/takeover/status", params={"takeover_id": "x"}).status_code == 404
    assert client.post("/api/auth/takeover/decision", json={"takeover_id": "x", "decision": "keep"}).status_code == 404
