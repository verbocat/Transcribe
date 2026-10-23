"""Administrators can make other accounts administrators in the admin panel, and take it away again."""
from fastapi.testclient import TestClient

from app.auth_module.database import SessionLocal, init_auth_db
from app.auth_module.models import User
from tests.test_usage_limits import ADMIN_EMAIL, _admin, _login, _make_user, admin_env, main_app  # noqa: F401  (fixtures)


def _set(client, headers, uid, admin):
    return client.put(f"/api/admin/users/{uid}/admin", headers=headers, json={"admin": admin})


def _row(client, headers, email):
    users = client.get("/api/admin/users?limit=200", headers=headers).json()["users"]
    return next(u for u in users if u["email"] == email)


def test_grant_and_revoke_admin(main_app, admin_env):
    client = TestClient(main_app.app)
    boss = _admin(main_app, client)
    a_id, a_email = _make_user()
    b_id, b_email = _make_user()
    a = _login(client, a_email)

    # a plain account cannot use admin routes, or make itself an admin
    assert client.get("/api/admin/users", headers=a).status_code == 403
    assert _set(client, a, a_id, True).status_code == 403

    res = _set(client, boss, a_id, True)
    assert res.status_code == 200, res.text
    assert res.json()["user"]["is_admin"] is True and res.json()["user"]["admin_source"] == "granted"
    assert client.get("/api/admin/users", headers=a).status_code == 200          # at once, no new sign-in needed on the server
    assert _row(client, boss, a_email)["admin_source"] == "granted"
    assert _row(client, boss, ADMIN_EMAIL)["admin_source"] == "server"
    me = client.get("/api/auth/me", headers=a).json()
    assert (me.get("user") or me).get("is_admin") is True

    # a granted admin can grant others, but not remove itself or an admin set on the server
    assert _set(client, a, b_id, True).status_code == 200
    assert _set(client, a, a_id, False).status_code == 400
    boss_id = _row(client, boss, ADMIN_EMAIL)["id"]
    assert _set(client, a, boss_id, False).status_code == 400

    # a restart keeps granted admins (the start-up sync no longer strips them)
    init_auth_db()
    db = SessionLocal()
    try:
        assert {u.email: (u.is_admin, u.role) for u in db.query(User).filter(User.id.in_([a_id, b_id]))} == {a_email: (True, "admin"), b_email: (True, "admin")}
    finally:
        db.close()

    # removing takes the panel away straight away
    res = _set(client, boss, a_id, False)
    assert res.status_code == 200 and res.json()["user"]["is_admin"] is False and res.json()["user"]["role"] == "coordinator"
    assert client.get("/api/admin/users", headers=a).status_code == 403
    assert _row(client, boss, b_email)["is_admin"] is True


def test_disabled_accounts_cannot_be_made_admin(main_app, admin_env):
    client = TestClient(main_app.app)
    boss = _admin(main_app, client)
    uid, _ = _make_user(is_blocked=True)
    res = _set(client, boss, uid, True)
    assert res.status_code == 400 and "disabled" in res.json()["detail"]
    assert _set(client, boss, "no-such-user", True).status_code == 404
