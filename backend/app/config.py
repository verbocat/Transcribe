import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory or root directory
BASE_DIR = Path(__file__).resolve().parent.parent

# Ensure local bin and bundled ffmpeg from imageio_ffmpeg are on PATH
local_bin = BASE_DIR / "bin"
if local_bin.exists():
    os.environ["PATH"] = str(local_bin) + os.pathsep + os.environ.get("PATH", "")

try:
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    if ffmpeg_exe and Path(ffmpeg_exe).exists():
        bin_dir = str(Path(ffmpeg_exe).parent)
        if bin_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass
load_dotenv(BASE_DIR / ".env")
if not os.getenv("ELEVENLABS_API_KEY") or not os.getenv("GEMINI_API_KEY"):
    load_dotenv(BASE_DIR.parent / ".env", override=True)
else:
    load_dotenv(BASE_DIR.parent / ".env")

# ElevenLabs Scribe v2 Configuration
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "scribe_v2")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
# Transcription runs fully offline (local models + CMU phonetics) unless this is switched on.
# When on, Gemini adds extra gender votes and handles words the offline phonetics do not know.
GEMINI_ASSIST = os.getenv("GEMINI_ASSIST", "false").strip().lower() in ("1", "true", "yes", "on")
# Text-only Gemini pass that fixes speaker labels from the conversation (merged people, wrong short replies).
# Costs one cheap call per ~120 lines, so it is off in the pipeline by default; the Speakers panel can run it on demand.
SPEAKER_AI_REVIEW = os.getenv("SPEAKER_AI_REVIEW", "false").strip().lower() in ("1", "true", "yes", "on")
DATABASE_URL = os.getenv("DATABASE_URL", "")
DEFAULT_LANGUAGE = os.getenv("DEFAULT_LANGUAGE", "English")
DEFAULT_SCRIPT = os.getenv("DEFAULT_SCRIPT", "Latin")

# Audio processing constants based on Karya guidelines
MAX_SEGMENT_DURATION = float(os.getenv("MAX_SEGMENT_DURATION", "20.0"))
MIN_SEGMENT_DURATION = float(os.getenv("MIN_SEGMENT_DURATION", "0.5"))
SEGMENT_BUFFER_SEC = float(os.getenv("SEGMENT_BUFFER_SEC", "0.3"))
MAX_SILENCE_SEC = float(os.getenv("MAX_SILENCE_SEC", "4.0"))

UPLOAD_DIR = BASE_DIR / "uploads"
EXPORTS_DIR = BASE_DIR / "exports"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Centroid translation + QC API (server-to-server; the key never reaches the browser)
CENTROID_API_URL = os.getenv("CENTROID_API_URL", "").rstrip("/")
CENTROID_API_KEY = os.getenv("CENTROID_API_KEY", "")
CENTROID_TIMEOUT_SEC = float(os.getenv("CENTROID_TIMEOUT_SEC", "600"))
