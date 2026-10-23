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

Each test reports PASS/FAIL/SKIP with its endpoint, HTTP status and failure reason in the terminal
("live results" section) and in the HTML report.

## Safety rails

- The test token is only sent with GET/HEAD and a fixed list of compute POSTs (`SAFE_AUTH_POSTS`).
- Other writes are sent only without a token, and only to routes whose auth dependency rejects them before the handler runs.
- Requests are at least `LIVE_MIN_INTERVAL` seconds apart (default 1.0s).
- One login per run, no retry, and no wrong-password tests, because failed logins lock out the IP.
- The run stops if the test account is an admin.
