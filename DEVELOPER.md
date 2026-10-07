# Developer Setup & Server Deployment Guide

How to install, run, test and deploy the **Karya Transcription & Subtitle Studio** on a local machine and on a Linux server. For what the app does and how to use it, see [README.md](README.md).

---

## 1. Architecture & Tech Stack

```mermaid
graph TD
    Client[React SPA - Vercel or Nginx] -->|REST + SSE| FastAPI[FastAPI backend :8000]

    FastAPI --> Scribe[ElevenLabs Scribe v2 API - words, speakers, audio events]
    FastAPI --> Engine[Local Netflix engine - card building, QC audit]
    FastAPI --> Gemini[Google Gemini API - proofreading, QC fixes, context helpers]
    FastAPI --> Centroid[Centroid API - translation and translation QC, optional]
    FastAPI --> FFmpeg[FFmpeg - audio extraction, shot detection]
    FastAPI --> AuthDB[(SQLite - users, sessions, audit logs)]
    FastAPI --> ProjDB[(Neon PostgreSQL - saved projects, optional)]
    FastAPI --> Brevo[Brevo - verification and OTP email]
```

* **Frontend:** React 19, Vite 8, Tailwind CSS 4, WaveSurfer.js 7, Lucide icons, ffmpeg.wasm for in-browser audio extraction. Linted with oxlint. Deployed to Vercel (`frontend/vercel.json`).
* **Backend:** Python 3.13, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic v2, httpx.
* **Speech and timing:** ElevenLabs Scribe v2 (`app/elevenlabs_service.py`) provides word-level timestamps, diarization and audio-event tags for the whole file in one request. There is no Whisper model, DTW aligner or fixed-length batching any more.
* **Subtitle building and QC:** the local Netflix engine (`app/netflix_engine.py`, `app/netflix_linter.py`) turns Scribe words into cards and audits CPS, CPL, line count, duration, gaps and shot changes.
* **Gemini (`google-genai`):** optional context proofreading, "Fix QC issues with Gemini", glossary extraction and context auto-fill. Transcription itself does not need Gemini.
* **Databases:** a SQLite file for accounts, sessions, quotas and audit logs (always on), and an optional Neon PostgreSQL database for saved projects (`DATABASE_URL`).
* **Silero VAD (optional):** `app/vad_processor.py` loads `backend/models/silero_vad.jit` with PyTorch to refine Karya segment boundaries. PyTorch is not in `requirements.txt`; without it the app runs and skips VAD refinement.

### Subtitle pipeline (`POST /api/subtitle/generate_stream`)

Implemented in `app/scribe_subtitle_generator.py` and streamed to the browser as Server-Sent Events:

1. Read media info and extract 16 kHz mono WAV with FFmpeg (`app/video_processor.py`); detect shot changes.
2. Transcribe with Scribe v2, passing Context and glossary terms as key terms.
3. Smooth diarization flickers and relabel speakers.
4. Enforce the native script for the target language (`app/transliteration_service.py`).
5. Build Netflix-conformant cards from the words (`build_netflix_subtitles_from_words`).
6. Optionally apply Context corrections and Gemini proofreading (`app/context_polisher.py`).
7. Audit compliance (`audit_netflix_compliance`) and emit the final result.

`POST /api/subtitle/acoustic_sync` re-aligns existing cards to Scribe words (cached per session after the first call).

### Transcription pipeline (`POST /api/transcribe`)

Implemented in `app/scribe_transcriber.py`: Scribe v2 transcription, Karya segmentation (`app/audio_processor.py`), speaker gender detection (`app/segment_gender.py`, local models, with extra Gemini votes when `GEMINI_ASSIST=true`), and the Karya linter (`app/linter_engine.py`).

---

## 2. Localhost Setup Guide

### Prerequisites

1. **Python** 3.13 (3.10+ should work)
2. **Node.js** 22 (18+) with `npm`
3. **Git**
4. An **ElevenLabs API key** with Scribe access. A Gemini API key is optional but needed for the AI features.

FFmpeg does not need to be installed separately: the backend uses the binary bundled with `imageio-ffmpeg` and adds it to `PATH` at startup.

---

### Step 1: Repository Structure

```text
Transcribe/
├── backend/
│   ├── app/
│   │   ├── main.py                       # FastAPI app and API endpoints
│   │   ├── config.py                     # Environment and settings
│   │   ├── auth_module/                  # Sign-up, login, OTP, sessions (SQLite) and Brevo email
│   │   ├── admin_routes.py               # /api/admin endpoints: users, quotas, audit logs
│   │   ├── db.py                         # Neon PostgreSQL models for saved projects
│   │   ├── elevenlabs_service.py         # ElevenLabs Scribe v2 client
│   │   ├── scribe_subtitle_generator.py  # Subtitle Studio pipeline (SSE)
│   │   ├── scribe_transcriber.py         # Transcription Studio pipeline
│   │   ├── netflix_engine.py             # Card building, alignment and compliance audit
│   │   ├── netflix_linter.py             # Netflix QC rules and rule-based auto-fix
│   │   ├── gemini_qc_fixer.py            # Gemini QC fix pass
│   │   ├── context_polisher.py           # Context corrections and Gemini proofreading
│   │   ├── transliteration_service.py    # Native script enforcement
│   │   ├── centroid_client.py            # Centroid translation and QC client
│   │   ├── video_processor.py            # FFmpeg extraction, metadata, shot detection
│   │   ├── audio_processor.py            # Karya segmentation
│   │   ├── vad_processor.py              # Silero VAD (needs PyTorch)
│   │   ├── linter_engine.py              # Karya transcription linter
│   │   └── export_service.py             # SRT, VTT, TTML, CSV, DOCX, XLSX exports
│   ├── models/silero_vad.jit             # Silero VAD weights
│   ├── tests/                            # pytest suite
│   ├── requirements.txt
│   └── .env.example                      # Copy to .env
├── frontend/
│   ├── src/                              # React app
│   ├── scripts/copy-ffmpeg-core.mjs      # Copies ffmpeg.wasm core into public/ before dev/build
│   ├── package.json
│   ├── vite.config.js                    # Dev server on 5173, proxies /api to the backend
│   └── vercel.json
└── run_app.bat                           # One-click Windows launcher
```

Some older modules (`gemini_subtitle_generator.py`, `gemini_subtitle_structurer.py`, `gemini_transcriber.py`, `dialogue_harmonizer.py`) are still in `app/` but are not imported by `main.py`.

---

### Step 2: Backend Setup

1. Go to the backend directory and create a virtual environment:

   ```bash
   cd backend
   python -m venv venv
   # Windows
   venv\Scripts\activate
   # Linux / macOS
   source venv/bin/activate
   ```

2. Install dependencies:

   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   # Optional, for Silero VAD refinement in Transcription Studio:
   # pip install torch
   ```

3. Copy `backend/.env.example` to `backend/.env` and fill it in. The backend also reads a `.env` in the repository root.

   ```env
   # ElevenLabs Scribe v2 (required for transcription and subtitle generation).
   # If empty, users are asked for their own key in the browser.
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   ELEVENLABS_MODEL_ID=scribe_v2

   # Google Gemini (optional: proofreading, Gemini QC fix, context helpers)
   GEMINI_API_KEY=your_gemini_api_key
   GEMINI_MODEL=gemini-3.8-flash
   # Extra Gemini gender votes in Transcription Studio
   GEMINI_ASSIST=false
   # Text-only Gemini pass that corrects speaker labels during transcription (the Speakers panel can also run it on demand)
   SPEAKER_AI_REVIEW=false

   # Defaults when a file has no language/script chosen
   DEFAULT_LANGUAGE=Hindi
   DEFAULT_SCRIPT=Devanagari

   # Karya segmentation limits
   MAX_SEGMENT_DURATION=20.0
   MIN_SEGMENT_DURATION=0.5
   SEGMENT_BUFFER_SEC=0.3
   MAX_SILENCE_SEC=4.0

   # Accounts database (SQLite). Defaults to backend/data/transcribe_app.db when unset.
   SERVER_DB_PATH=
   # Saved projects (Neon PostgreSQL, optional). Project saving is disabled when unset.
   DATABASE_URL=postgresql://user:password@ep-sample-pooler.neon.tech/neondb?sslmode=require

   # Links in verification emails point here
   FRONTEND_URL=http://localhost:5173

   # Brevo email. Without a key, verification links and OTPs are printed to the backend console.
   BREVO_API_KEY=
   BREVO_SENDER_EMAIL=noreply@verbolabs.com
   BREVO_SENDER_NAME=VerboLabs Verification
   OTP_SECRET=a_long_random_secret

   # Centroid translation + QC (optional)
   CENTROID_API_URL=
   CENTROID_API_KEY=
   ```

   Other optional settings:
   * `ALLOWED_ORIGINS`: extra comma-separated CORS origins. Localhost, `*.verbolabs.com` and `transcribe.verbolabs.com` are always allowed; `ALLOWED_ORIGIN_REGEX` replaces the default origin pattern.
   * `ENABLE_SHOT_DETECTION`: shot detection is on by default locally but **off when `PORT` or `RENDER` is set** (treated as a cloud host). Set `ENABLE_SHOT_DETECTION=true` to force it on.
   * `CENTROID_TIMEOUT_SEC`: Centroid request timeout, default 600.

4. Start the API:

   ```bash
   python -m uvicorn app.main:app --reload --port 8000
   ```

   * API: `http://localhost:8000` (health check at `/api/health`)
   * Swagger docs: `http://localhost:8000/docs`

---

### Step 3: Frontend Setup

1. In a second terminal:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   `npm run dev` first copies the ffmpeg.wasm core into `public/`, then starts Vite on `http://localhost:5173`.

2. Backend URL: on localhost the app probes `http://localhost:8000` and `:8001` and uses whichever answers `/api/health`, so no configuration is needed. To point at another backend, set `VITE_API_URL` (for example in `frontend/.env.local`). The Vite dev proxy for `/api` targets `VITE_BACKEND_URL`, default `http://127.0.0.1:8000`.

3. Lint with `npm run lint`.

On Windows, `run_app.bat` (or `npm start` in the repository root) creates the venv, installs both sides and starts the backend and frontend in separate windows.

---

### Step 4: Accounts

Sign-up accepts any valid email address and requires email verification. Without `BREVO_API_KEY`, verification links, password-reset links and login OTPs are printed in the backend console instead of being emailed. Accounts live in the SQLite file (`backend/data/transcribe_app.db` by default). Super-admin accounts are a fixed list in `app/auth_module/routes.py`; admins can manage other users from `/admin`.

---

### Step 5: Running Tests

```bash
cd backend
python -m pytest tests/ -v
```

The suite still contains tests written for the removed Whisper/DTW pipeline. Many of them (for example `test_phase*`, `test_aligner_margin.py`, `test_dtw_extrapolation.py`, `test_real_*`) fail at import because they need `app.whisper_aligner`, `app.dtw_aligner` or PyTorch. The files that import cleanly against the current code are:

```bash
python -m pytest tests/test_pipeline.py tests/test_elevenlabs_netflix_engine.py tests/test_phonetic_translit.py tests/test_auth_service.py tests/test_all_phases_improvements.py -v
```

Even these are not fully green yet: `test_auth_service.py` still expects sign-up to be limited to `@verbolabs.com`, `test_all_phases_improvements.py` has Whisper, DTW and batching cases, and `test_gap_chaining` in `test_elevenlabs_netflix_engine.py` fails. There is no CI, so run the suite locally before pushing.

---

## 3. Production Server Deployment Guide (Linux / VPS)

This section details how to deploy the entire stack to a Linux server (Ubuntu 22.04 / 24.04 LTS) using **Nginx**, **Systemd**, **Uvicorn**, and **Let's Encrypt SSL**. The hosted frontend is deployed to Vercel from `frontend/` instead; in that case set `VITE_API_URL` in the Vercel project to the backend's public URL and skip the frontend and static-file parts below.

### Server Sizing Recommendations

* **CPU:** 2 vCPUs is enough; transcription runs on ElevenLabs, so the server mainly runs FFmpeg and the Netflix engine.
* **RAM:** 4 GB minimum (more if you install PyTorch for Silero VAD).
* **Storage:** 30 GB+ SSD for uploaded media and extracted audio.
* **OS:** Ubuntu 22.04 LTS or 24.04 LTS.

---

### Step 1: Install System Dependencies

Connect to your server via SSH and install required packages:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv ffmpeg nginx git curl
```

Install Node.js 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify installations:

```bash
python3 --version
node -v
ffmpeg -version
```

---

### Step 2: Clone the Project and Set Permissions

```bash
sudo mkdir -p /var/www/transcribe
sudo chown -R $USER:$USER /var/www/transcribe
git clone <your-repository-url> /var/www/transcribe
cd /var/www/transcribe
```

---

### Step 3: Set Up Backend on the Server

1. Create a production virtual environment:

   ```bash
   cd /var/www/transcribe/backend
   python3 -m venv venv
   source venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

2. Configure the production `.env` file:

   ```bash
   nano /var/www/transcribe/backend/.env
   ```

   Use the same keys as the local `.env` above, with production values:

   ```env
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   GEMINI_API_KEY=your_gemini_api_key
   GEMINI_MODEL=gemini-3.8-flash
   DATABASE_URL=postgresql://user:password@ep-pooler.neon.tech/neondb?sslmode=require
   SERVER_DB_PATH=/var/www/transcribe/backend/data/transcribe_app.db
   FRONTEND_URL=https://yourdomain.com
   BREVO_API_KEY=your_brevo_api_key
   OTP_SECRET=your_strong_random_secret
   ALLOWED_ORIGINS=https://yourdomain.com
   ```

   Do not set `PORT` in this file unless you also set `ENABLE_SHOT_DETECTION=true`, because `PORT` turns shot detection off.

3. Create the uploads directory and set permissions:

   ```bash
   mkdir -p /var/www/transcribe/backend/uploads
   chmod 775 /var/www/transcribe/backend/uploads
   ```

---

### Step 4: Configure Systemd Service for the Backend

Create a systemd unit file so the backend runs automatically as a background service and restarts on failure:

```bash
sudo nano /etc/systemd/system/transcribe-backend.service
```

Paste the following configuration:

```ini
[Unit]
Description=Transcribe Studio FastAPI Backend Service
After=network.target

[Service]
User=ubuntu
Group=ubuntu
WorkingDirectory=/var/www/transcribe/backend
EnvironmentFile=/var/www/transcribe/backend/.env
ExecStart=/var/www/transcribe/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --timeout-keep-alive 120
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Keep a single worker: upload sessions and audio-extraction jobs are held in process memory, so a second worker would not see them.

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable transcribe-backend
sudo systemctl start transcribe-backend
sudo systemctl status transcribe-backend
```

---

### Step 5: Build the Frontend for Production

1. Navigate to the frontend directory:

   ```bash
   cd /var/www/transcribe/frontend
   ```

2. Create a production environment file:

   ```bash
   nano .env.production
   ```

   Set the backend URL. Leave it empty when Nginx serves the API on the same domain (the app then calls `/api/...` on the same origin):

   ```env
   VITE_API_URL=
   ```

3. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

   * This creates an optimized production bundle inside `/var/www/transcribe/frontend/dist`.

---

### Step 6: Configure Nginx as Reverse Proxy

Create a new Nginx server configuration block:

```bash
sudo nano /etc/nginx/sites-available/transcribe
```

Paste the following configuration (replace `yourdomain.com` with your actual domain name or server IP):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Maximum file upload size for video files (2 GB)
    client_max_body_size 2048M;

    # 1. Serve Frontend Static Build
    root /var/www/transcribe/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 2. Proxy API Endpoints to FastAPI Backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

    # Standard headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for the Server-Sent Events generation stream
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

}
```

Enable the configuration and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/transcribe /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

### Step 7: Secure with SSL (HTTPS) via Let's Encrypt

Install Certbot and obtain a free SSL certificate:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

* Certbot will automatically configure HTTPS, rewrite SSL certificates, and set up automatic renewal cron jobs.

---

### Step 8: Maintenance & Monitoring

#### View Live Backend Logs

```bash
sudo journalctl -u transcribe-backend -f
```

#### View Nginx Access & Error Logs

```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

#### Restart Services After Code Updates

```bash
cd /var/www/transcribe
git pull origin main

# Rebuild frontend if UI changed
cd frontend && npm install && npm run build

# Restart backend service
sudo systemctl restart transcribe-backend
```

#### Scheduled Cleanup of Old Uploads (Optional Cron)

Uploaded media and extracted audio stay in `backend/uploads/` until the user discards them. To purge files older than 2 days, add a daily cron job:

```bash
crontab -e
```

Add:

```bash
0 3 * * * find /var/www/transcribe/backend/uploads/ -type f -mtime +2 -delete
```
