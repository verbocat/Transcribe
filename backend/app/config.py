import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory or root directory
BASE_DIR = Path(__file__).resolve().parent.parent

# Ensure bundled ffmpeg from imageio_ffmpeg is on PATH for whisper, pydub, and audio decoders
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
if not os.getenv("GEMINI_API_KEY"):
    load_dotenv(BASE_DIR.parent / ".env", override=True)
else:
    load_dotenv(BASE_DIR.parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
DATABASE_URL = os.getenv("DATABASE_URL", "")
DEFAULT_LANGUAGE = os.getenv("DEFAULT_LANGUAGE", "auto")
DEFAULT_SCRIPT = os.getenv("DEFAULT_SCRIPT", "auto")

# Audio processing constants based on Karya guidelines
MAX_SEGMENT_DURATION = float(os.getenv("MAX_SEGMENT_DURATION", "20.0"))
MIN_SEGMENT_DURATION = float(os.getenv("MIN_SEGMENT_DURATION", "0.5"))
SEGMENT_BUFFER_SEC = float(os.getenv("SEGMENT_BUFFER_SEC", "0.3"))
MAX_SILENCE_SEC = float(os.getenv("MAX_SILENCE_SEC", "4.0"))

UPLOAD_DIR = BASE_DIR / "uploads"
EXPORTS_DIR = BASE_DIR / "exports"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
