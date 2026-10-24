# Live production checks

Read-only pytest suite for the live Noun backend and frontend. It is separate from `backend/tests`
(CI never runs it). `catalog.py` lists all 142 backend routes and says how each one is handled.

## Setup

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m playwright install chromium   # UI tests only
copy .env.live.example .env.live                      # then fill it in
```

## Run

| Stage | Command |
|---|---|
| 1. Smoke (no login) | `.venv/Scripts/python -m pytest -m smoke --html=reports/smoke.html --self-contained-html` |
| 2. Read-only + compute | `.venv/Scripts/python -m pytest -m "readonly or compute" --html=reports/readonly.html --self-contained-html` |
| 3. Authorization | `.venv/Scripts/python -m pytest -m authz --html=reports/authz.html --self-contained-html` |
| 4. UI | `.venv/Scripts/python -m pytest -m ui --html=reports/ui.html --self-contained-html` |
| Full run | `.venv/Scripts/python -m pytest --html=reports/live.html --self-contained-html` |
| Exposure (opt-in) | `.venv/Scripts/python -m pytest -m exposure` |
| Own data (opt-in) | `.venv/Scripts/python -m pytest -m owndata` |
| Email (opt-in, sends 2 emails to the test inbox) | `.venv/Scripts/python -m pytest -m email` |
| Paid (opt-in, spends minutes and API credit) | `.venv/Scripts/python -m pytest -m paid --html=reports/paid.html --self-contained-html` |
| UI, free (shell, auth screens, account) | `.venv/Scripts/python -m pytest -m "ui and not paid" --html=reports/ui.html --self-contained-html` |
| UI admin (needs LIVE_ADMIN_* for a test admin account) | `.venv/Scripts/python -m pytest -m ui ui/test_ui_40_admin.py --html=reports/ui_admin.html --self-contained-html` |
| UI studios (opt-in, uploads the test clip) | `.venv/Scripts/python -m pytest -m "ui and paid" --html=reports/ui_studios.html --self-contained-html` |
| Remove leftover test data | `.venv/Scripts/python cleanup_qa.py` |

UI tests in `ui/` start signed in: the run's API session token is placed in the browser's
localStorage (`ui_fixtures.py`), so the password is only sent once, by the API login. Set
`LIVE_HEADED=1` to watch the browser.

The default run (no `-m`) is read-only; `owndata`, `paid`, `email` and `exposure` run only when named.

Each test reports PASS/FAIL/SKIP with its endpoint, HTTP status and failure reason in the terminal
("live results" section) and in the HTML report.

## Safety rails

- The test token is only sent with GET/HEAD and a fixed list of compute POSTs (`SAFE_AUTH_POSTS`).
- Other writes are sent only without a token, and only to routes whose auth dependency rejects them before the handler runs.
- The opt-in tests pass `write=True` to change data; they only touch records the test account owns or creates,
  restore or delete them, and finish with a sweep for anything tagged `qa_live_7f3c9e1a`.
- Requests are at least `LIVE_MIN_INTERVAL` seconds apart (default 1.0s).
- One login per run, no retry, and no wrong-password tests, because failed logins lock out the IP.
- The run stops if the test account is an admin.
