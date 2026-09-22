# Developer Setup & Server Deployment Guide

This guide provides complete instructions for developers to install, run, test, and deploy the **Subtitle Studio & AI Audio Transcription Pipeline** both on a local machine (`localhost`) and on a production server (Linux VPS / Cloud).

---

## 1. Architecture & Tech Stack

```mermaid
graph TD
    Client[Web Browser / React Frontend] -->|HTTP / SSE / REST| Nginx[Nginx Reverse Proxy]
    Nginx -->|Static Assets| ViteDist[Vite React SPA Build]
    Nginx -->|Proxy /api| FastAPI[FastAPI Backend :8000]
    
    FastAPI --> Gemini[Google Gemini 2.5 Flash / Pro API]
    FastAPI --> Whisper[Local Whisper Engine - CPU / GPU]
    FastAPI --> VAD[Silero Neural VAD - PyTorch]
    FastAPI --> FFmpeg[FFmpeg dynaudnorm & Audio Slicer]
    FastAPI --> DB[(Neon PostgreSQL Database)]
```

* **Frontend:** React 18, Vite, Tailwind CSS, WaveSurfer.js, Lucide React Icons.
* **Backend:** Python 3.13+, FastAPI, Uvicorn, SQLAlchemy ORM, Pydantic v2.
* **Database:** Neon Serverless PostgreSQL (with automatic connection pooling and schema initialization).
* **AI & Acoustic Stack:**
  * **Google GenAI SDK (`google-genai`):** Multimodal audio-to-text generation via Gemini 2.5 Flash / Pro.
  * **OpenAI Whisper (`openai-whisper`):** Word-level acoustic timestamp extraction.
  * **Silero VAD:** Deep neural network voice activity detection for speech boundary detection.
  * **FFmpeg (`imageio-ffmpeg`):** Audio extraction, dynamic range normalization (`dynaudnorm`), and lossless slicing.
  * **NumPy DTW:** Global monotonic Dynamic Time Warping alignment engine.

---

## 2. Localhost Setup Guide

### Prerequisites

Ensure your local development machine has the following installed:

1. **Python:** Version `3.13.x` (or `3.10+`)
2. **Node.js:** Version `22.x` (or `18+`) with `npm`
3. **FFmpeg:** System FFmpeg or Python -ffmpeg`
4. **Git**

---

### Step 1: Repository Structure

Verify your directory layout:

```text
Transcribe/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI application & API endpoints
│   │   ├── config.py                   # Environment & configuration settings
│   │   ├── db.py                       # SQLAlchemy models & Neon DB connection
│   │   ├── gemini_subtitle_generator.py # Batch streaming & Gemini 2.5 pipeline
│   │   ├── whisper_aligner.py          # Whisper word extraction & alignment
│   │   ├── dtw_aligner.py              # Monotonic Dynamic Time Warping engine
│   │   ├── vad_processor.py            # Silero Neural VAD & 90s cut-point finder
│   │   ├── audio_processor.py          # FFmpeg dynaudnorm & audio slicing
│   │   ├── netflix_linter.py           # Netflix Timed Text quality control linter
│   │   └── gemini_qc_fixer.py          # Gemini AI self-correction pass
│   ├── requirements.txt                # Python dependencies
│   ├── .env                            # Backend environment variables
│   └── venv/                           # Python virtual environment
├── frontend/
│   ├── src/                            # React application source code
│   ├── package.json                    # Node.js dependencies
│   └── vite.config.js                  # Vite bundler configuration
└── run_app.bat                         # 1-Click Windows development launcher
```

---

### Step 2: Backend Setup

1. Open a terminal and navigate to the `backend` directory:

   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   * **Windows (PowerShell / Command Prompt):**

     ```cmd
     python -m venv venv
     venv\Scripts\activate
     ```

   * **Linux / macOS:**

     ```bash
     python3 -m venv venv
     source venv/bin/activate
     ```

3. Install required Python packages:

   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

4. Configure the `.env` file in the `backend/` directory:
   Create or edit `backend/.env` with the following keys:

   ```env
   # Google Gemini API
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   GEMINI_MODEL=gemini-2.5-flash

   # Neon PostgreSQL Database Connection String
   DATABASE_URL=postgresql://user:password@ep-sample-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require

   # Whisper Configuration (options: tiny, base, small, medium)
   WHISPER_MODEL=base

   # Authentication & Security
   JWT_SECRET_KEY=generate_a_random_64_char_secret_key_here
   JWT_ALGORITHM=HS256
   ACCESS_TOKEN_EXPIRE_MINUTES=1440

   # Server Port
   PORT=8000
   ```

5. Start the FastAPI development server:

   ```bash
   venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
   ```

   * The API will be live at: `http://localhost:8000`
   * Interactive Swagger Documentation: `http://localhost:8000/docs`

---

### Step 3: Frontend Setup

1. Open a second terminal and navigate to the `frontend` directory:

   ```bash
   cd frontend
   ```

2. Install Node.js packages:

   ```bash
   npm install
   ```

3. Configure Frontend Environment (Optional):
   By default, Vite proxies requests or connects to `http://localhost:8000`. You can create `frontend/.env.development`:

   ```env
   VITE_API_BASE=http://localhost:8000
   ```

4. Start the Vite development server:

   ```bash
   npm run dev
   ```

   * The React application will be live at: `http://localhost:5173`

---

### Step 4: Running Automated Tests

To verify all audio processing, VAD, and alignment algorithms:

```bash
cd backend
venv\Scripts\python -m pytest tests/ -v
```

---

## 3. Production Server Deployment Guide (Linux / VPS)

This section details how to deploy the entire stack to a Linux server (Ubuntu 22.04 / 24.04 LTS) using **Nginx**, **Systemd**, **Gunicorn/Uvicorn**, and **Let's Encrypt SSL**.

### Server Sizing Recommendations

* **CPU:** 2 to 4 vCPUs (Whisper and audio processing are CPU-bound if no GPU is present).
* **RAM:** 4 GB minimum (8 GB recommended for concurrent batch processing).
* **Storage:** 30 GB+ SSD (to accommodate temporary media uploads and Whisper models).
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
   pip install gunicorn
   ```

2. Configure the production `.env` file:

   ```bash
   nano /var/www/transcribe/backend/.env
   ```

   Paste your production secrets:

   ```env
   GEMINI_API_KEY=your_gemini_api_key
   GEMINI_MODEL=gemini-2.5-flash
   DATABASE_URL=postgresql://user:password@ep-pooler.neon.tech/neondb?sslmode=require
   WHISPER_MODEL=base
   JWT_SECRET_KEY=your_strong_random_secret_key
   PORT=8000
   ```

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
ExecStart=/var/www/transcribe/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --timeout-keep-alive 120
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

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

   Set the API base URL to your domain (or leave empty if using relative paths):

   ```env
   VITE_API_BASE=
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

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CRITICAL for Server-Sent Events (SSE) Batch Streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # 3. Serve Uploaded Audio / Video Previews
    location /uploads/ {
        alias /var/www/transcribe/backend/uploads/;
        add_header Cache-Control "no-cache";
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

#### Scheduled Cleanup of Temporary Audio Chunks (Optional Cron)

To automatically purge leftover audio chunks older than 2 days, add a daily cron job:

```bash
crontab -e
```

Add:

```bash
0 3 * * * find /var/www/transcribe/backend/uploads/ -name "temp_*" -type f -mtime +2 -delete
```
