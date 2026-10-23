"""Every backend endpoint, with how the live suite treats it on production.

auth:  none | optional | user | admin       (what the server enforces today, from the route code)
tier:  smoke    - always safe, no auth, no data
       read     - authenticated GET of the test account's own data
       compute  - POST that only computes a response from the request body (no DB, no disk, no paid API)
       blocked  - never sent on production; listed so the report shows full coverage and why

Write endpoints with auth "user"/"admin" are also covered by the no-token sweep in test_30_authz.py:
the auth dependency rejects the request with 401 before the handler runs, so nothing executes.
Write endpoints with auth "none"/"optional" are never sent at all: their handlers would run.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    auth: str
    tier: str
    why: str = ""

    @property
    def id(self) -> str:
        return f"{self.method} {self.path}"


E = Endpoint

# reasons reused below
UPLOAD = "uploads media and writes files on the production server"
METERED = "spends the account's minutes and calls paid AI APIs (Gemini / ElevenLabs / Centroid)"
EMAIL = "sends a real email through Brevo and uses the email quota"
MUTATES = "changes or deletes stored data"
OPEN_WRITE = "unauthenticated write: the handler would run, so it is never sent"
ADMIN_WRITE = "admin-only write on real user accounts"
DISK = "writes an export file to the production server disk"
LOCKOUT = "failed attempts lock out the account AND the caller's IP (shared office IP) for 15 minutes"

CATALOG = [
    # ── health / root ──────────────────────────────────────────────────────────────
    E("GET", "/", "none", "smoke"),
    E("GET", "/health", "none", "smoke"),
    E("GET", "/api/health", "none", "smoke"),
    E("GET", "/api/centroid/status", "none", "smoke"),

    # ── auth ───────────────────────────────────────────────────────────────────────
    E("POST", "/api/auth/signup", "none", "blocked", "creates a real account and " + EMAIL),
    E("GET", "/api/auth/bot-challenge", "none", "smoke"),
    E("POST", "/api/auth/login", "none", "read", "called once per run with the test account; wrong-password tests are excluded: " + LOCKOUT),
    E("POST", "/api/auth/login/otp/request", "none", "blocked", EMAIL),
    E("POST", "/api/auth/verify-otp", "none", "blocked", "needs an emailed code; " + LOCKOUT),
    E("POST", "/api/auth/request-otp", "none", "blocked", EMAIL),
    E("POST", "/api/auth/resend-otp", "none", "blocked", EMAIL),
    E("GET", "/api/auth/verify-email", "none", "blocked", "consumes a real verification token"),
    E("POST", "/api/auth/resend-verification", "none", "blocked", EMAIL),
    E("POST", "/api/auth/forgot-password", "none", "blocked", EMAIL),
    E("POST", "/api/auth/reset-password", "none", "blocked", "changes a password"),
    E("GET", "/api/auth/me", "user", "read"),
    E("GET", "/api/auth/me/usage", "user", "read"),
    E("POST", "/api/auth/logout", "none", "read", "called once at the end of the run to end the test session"),
    E("POST", "/api/auth/validate-password", "none", "compute"),
    E("GET", "/api/auth/notifications", "user", "read"),
    E("POST", "/api/auth/notifications/{notification_id}/read", "user", "blocked", MUTATES),
    E("DELETE", "/api/auth/notifications/clear-all", "user", "blocked", MUTATES),
    E("POST", "/api/auth/notifications/clear-all", "user", "blocked", MUTATES),
    E("DELETE", "/api/auth/notifications/{notification_id}", "user", "blocked", MUTATES),
    E("PATCH", "/api/auth/profile", "user", "blocked", MUTATES),
    E("GET", "/api/auth/preferences/{key}", "user", "read"),
    E("PUT", "/api/auth/preferences/{key}", "user", "blocked", MUTATES),

    # ── admin (test account must NOT be an admin; GETs are expected to return 403) ──
    E("POST", "/api/admin/claim-initial-admin", "user", "blocked", "could promote the test account to admin"),
    E("GET", "/api/admin/overview", "admin", "read"),
    E("GET", "/api/admin/users", "admin", "read"),
    E("GET", "/api/admin/users/{user_id}", "admin", "read"),
    E("PATCH", "/api/admin/users/{user_id}/status", "admin", "blocked", ADMIN_WRITE),
    E("POST", "/api/admin/users/{user_id}/approve-workflow", "admin", "blocked", ADMIN_WRITE),
    E("POST", "/api/admin/users/{user_id}/feedback", "admin", "blocked", ADMIN_WRITE),
    E("POST", "/api/admin/users/{user_id}/kick", "admin", "blocked", ADMIN_WRITE),
    E("GET", "/api/admin/uploads", "admin", "read"),
    E("GET", "/api/admin/hardware/live", "admin", "read"),
    E("GET", "/api/admin/hardware/history", "admin", "read"),
    E("GET", "/api/admin/me/notifications", "user", "read"),
    E("POST", "/api/admin/me/notifications/{notification_id}/read", "user", "blocked", MUTATES),
    E("POST", "/api/admin/me/notifications/read-all", "user", "blocked", MUTATES),
    E("POST", "/api/admin/users", "admin", "blocked", ADMIN_WRITE),
    E("PATCH", "/api/admin/users/{user_id}/profile", "admin", "blocked", ADMIN_WRITE),
    E("GET", "/api/admin/users/{user_id}/access", "admin", "read"),
    E("PUT", "/api/admin/users/{user_id}/access", "admin", "blocked", ADMIN_WRITE),
    E("DELETE", "/api/admin/users/{user_id}", "admin", "blocked", ADMIN_WRITE),
    E("GET", "/api/admin/users/{user_id}/usage", "admin", "read"),
    E("GET", "/api/admin/jobs", "admin", "read"),
    E("GET", "/api/admin/usage-overview", "admin", "read"),

    # ── transcription (main.py) ────────────────────────────────────────────────────
    E("POST", "/api/upload", "none", "blocked", UPLOAD),
    E("POST", "/api/transcribe", "user", "blocked", METERED),
    E("GET", "/api/projects", "none", "blocked", "unauthenticated list of every user's projects (see exposure test)"),
    E("GET", "/api/projects/{project_id}", "none", "read"),
    E("POST", "/api/projects/save", "none", "blocked", OPEN_WRITE),
    E("DELETE", "/api/projects/{project_id}", "none", "blocked", OPEN_WRITE),
    E("POST", "/api/transcribe_async", "user", "blocked", METERED),
    E("GET", "/api/transcribe_status/{job_id}", "none", "read"),
    E("GET", "/api/audio/{filename}", "none", "blocked", "unauthenticated prefix-glob file lookup; probing it could stream another user's audio"),
    E("POST", "/api/audio/extract", "none", "blocked", UPLOAD),
    E("POST", "/api/audio/extract_async", "none", "blocked", UPLOAD),
    E("POST", "/api/jobs/{job_id}/cancel", "none", "blocked", OPEN_WRITE),
    E("GET", "/api/audio/extract_status/{job_id}", "none", "read"),
    E("POST", "/api/speakers/refine", "user", "blocked", METERED),
    E("POST", "/api/lint", "none", "compute"),
    E("POST", "/api/autofix", "none", "compute"),
    E("POST", "/api/export", "optional", "compute"),
    E("POST", "/api/export/dubbing", "optional", "blocked", DISK),
    E("POST", "/api/export/multi", "optional", "compute"),

    # ── subtitle studio (main.py) ──────────────────────────────────────────────────
    E("POST", "/api/subtitle/upload", "none", "blocked", UPLOAD),
    E("POST", "/api/subtitle/upload_chunk", "none", "blocked", UPLOAD),
    E("DELETE", "/api/subtitle/upload_chunk/{upload_id}", "none", "blocked", OPEN_WRITE),
    E("GET", "/api/subtitle/waveform/{video_id}", "optional", "read"),
    E("POST", "/api/subtitle/probe_media", "none", "blocked", UPLOAD),
    E("POST", "/api/media/discard", "none", "blocked", OPEN_WRITE),
    E("POST", "/api/subtitle/discard", "none", "blocked", OPEN_WRITE),
    E("POST", "/api/subtitle/generate", "user", "blocked", METERED),
    E("POST", "/api/subtitle/generate_stream", "user", "blocked", METERED),
    E("POST", "/api/subtitle/context_autofill", "user", "blocked", METERED),
    E("POST", "/api/subtitle/context_polish", "user", "blocked", METERED),
    E("POST", "/api/subtitle/extract_glossary_file", "none", "blocked", UPLOAD),
    E("POST", "/api/centroid/translate", "user", "blocked", METERED),
    E("POST", "/api/centroid/analyze", "user", "blocked", METERED),
    E("POST", "/api/centroid/qc", "user", "blocked", METERED),
    E("POST", "/api/subtitle/qc", "none", "compute"),
    E("POST", "/api/subtitle/lint", "none", "compute"),
    E("POST", "/api/subtitle/gemini_fix", "user", "blocked", METERED),
    E("POST", "/api/subtitle/acoustic_sync", "user", "blocked", METERED),
    E("POST", "/api/subtitle/autofix", "none", "compute"),
    E("POST", "/api/subtitle/export", "optional", "compute"),
    E("GET", "/api/subtitle/video/{filename}", "none", "blocked", "unauthenticated prefix-glob file lookup; probing it could stream another user's video"),
    E("POST", "/api/subtitle/rebreak", "none", "compute"),
    E("POST", "/api/subtitle/projects/save", "none", "blocked", OPEN_WRITE),
    E("GET", "/api/subtitle/projects", "none", "blocked", "unauthenticated list of every user's subtitle projects (see exposure test)"),
    E("GET", "/api/subtitle/projects/{project_id}", "none", "read"),
    E("DELETE", "/api/subtitle/projects/{project_id}", "none", "blocked", OPEN_WRITE),
    E("DELETE", "/api/cleanup/{audio_id}", "none", "blocked", OPEN_WRITE),

    # ── dubbing: quick jobs ────────────────────────────────────────────────────────
    E("GET", "/api/dubbing/config", "user", "read"),
    E("POST", "/api/dubbing/jobs", "user", "blocked", UPLOAD + "; " + METERED),
    E("GET", "/api/dubbing/jobs/{job_id}", "user", "read"),
    E("POST", "/api/dubbing/jobs/{job_id}/cancel", "user", "blocked", MUTATES),
    E("GET", "/api/dubbing/jobs/{job_id}/download/{kind}", "user", "read"),
    E("DELETE", "/api/dubbing/jobs/{job_id}", "user", "blocked", MUTATES),

    # ── dubbing: projects ──────────────────────────────────────────────────────────
    E("GET", "/api/dubbing/projects", "user", "read"),
    E("POST", "/api/dubbing/projects", "user", "blocked", UPLOAD + "; " + METERED),
    E("GET", "/api/dubbing/projects/{pid}", "user", "read"),
    E("GET", "/api/dubbing/projects/{pid}/media", "user", "read"),
    E("DELETE", "/api/dubbing/projects/{pid}", "user", "blocked", MUTATES),
    E("POST", "/api/dubbing/projects/{pid}/cancel", "user", "blocked", MUTATES),
    E("PUT", "/api/dubbing/projects/{pid}/segments", "user", "blocked", MUTATES),
    E("POST", "/api/dubbing/projects/{pid}/profiles", "user", "blocked", METERED),
    E("GET", "/api/dubbing/voices", "user", "read"),
    E("PUT", "/api/dubbing/projects/{pid}/speakers/{name}/voice", "user", "blocked", MUTATES),
    E("POST", "/api/dubbing/projects/{pid}/speakers/{name}/clone", "user", "blocked", METERED),
    E("GET", "/api/dubbing/projects/{pid}/speakers/{name}/sample", "user", "read"),
    E("POST", "/api/dubbing/projects/{pid}/translate", "user", "blocked", METERED),
    E("POST", "/api/dubbing/projects/{pid}/speak", "user", "blocked", METERED),
    E("PUT", "/api/dubbing/projects/{pid}/speakers/{name}/tts", "user", "blocked", MUTATES),
    E("GET", "/api/dubbing/projects/{pid}/lines/{sid}/audio", "user", "read"),
    E("GET", "/api/dubbing/stems/status", "user", "read"),
    E("POST", "/api/dubbing/projects/{pid}/stems", "user", "blocked", "heavy CPU job on the production server"),
    E("POST", "/api/dubbing/projects/{pid}/mix", "user", "blocked", "heavy CPU job on the production server"),
    E("GET", "/api/dubbing/projects/{pid}/edit", "user", "read"),
    E("GET", "/api/dubbing/projects/{pid}/thumbs", "user", "read"),
    E("GET", "/api/dubbing/projects/{pid}/thumbs.jpg", "user", "read"),
    E("GET", "/api/dubbing/projects/{pid}/overlays", "user", "read"),
    E("PUT", "/api/dubbing/projects/{pid}/overlays/{name}", "user", "blocked", MUTATES),
    E("GET", "/api/dubbing/projects/{pid}/overlays/{name}.png", "user", "read"),
    E("PUT", "/api/dubbing/projects/{pid}/edit", "user", "blocked", MUTATES),
    E("DELETE", "/api/dubbing/projects/{pid}/edit", "user", "blocked", MUTATES),
    E("GET", "/api/dubbing/projects/{pid}/waveform/lines", "user", "read"),
    E("GET", "/api/dubbing/projects/{pid}/waveform/{track}", "user", "read"),
    E("GET", "/api/dubbing/projects/{pid}/download/{kind}", "user", "read"),

    # ── sharing ────────────────────────────────────────────────────────────────────
    E("GET", "/api/shares/linguists", "user", "read"),
    E("POST", "/api/shares/projects", "user", "blocked", MUTATES),
    E("GET", "/api/shares/projects/mine", "user", "read"),
    E("PUT", "/api/shares/projects/{project_id}/linguists", "user", "blocked", MUTATES),
    E("DELETE", "/api/shares/projects/{project_id}", "user", "blocked", MUTATES),
    E("GET", "/api/shares/with-me", "user", "read"),
    E("GET", "/api/shares/projects/{project_id}", "user", "read"),
    E("PUT", "/api/shares/projects/{project_id}/draft", "user", "blocked", MUTATES),
    E("GET", "/api/shares/projects/{project_id}/video-link", "user", "read"),
    E("GET", "/api/shares/projects/{project_id}/video", "none", "read"),
]

BY_ID = {e.id: e for e in CATALOG}
