"""
Antigravity Terminal Logger
===========================

Provides high-visibility, timestamped, flushed terminal logging for the
FastAPI backend. Ensures all pipeline stages, ElevenLabs Scribe v2 events,
diarization refinements, transliteration details, and Netflix conforming steps
are printed immediately to stdout with microsecond precision and visual tags.
"""

import sys
import logging
from datetime import datetime
from typing import Any, Optional

# ANSI color codes for rich terminal visibility (supported in modern Windows Terminal, PowerShell & CMD)
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

COLORS = {
    "SUBTITLE-API": "\033[94m",     # Bright Blue
    "MEDIA-PIPELINE": "\033[96m",   # Bright Cyan
    "SHOT-DETECTOR": "\033[36m",    # Cyan
    "ELEVENLABS-STT": "\033[95m",   # Bright Magenta / Purple
    "ELEVENLABS-API": "\033[35m",   # Magenta
    "DIARIZATION": "\033[93m",      # Bright Yellow
    "TRANSLITERATION": "\033[33m",  # Yellow
    "NETFLIX-ENGINE": "\033[92m",   # Bright Green
    "NETFLIX-QC": "\033[32m",       # Green
    "SSE-STREAM": "\033[97m",       # Bright White
    "ERROR": "\033[91m",            # Bright Red
    "WARN": "\033[33m",             # Yellow
    "INFO": "\033[37m",             # White
}

def log_terminal(tag: str, message: Any, level: str = "INFO"):
    """
    Prints a timestamped, color-tagged log line directly to sys.stdout with immediate flush.
    Also forwards the message to standard Python logger.
    """
    now_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    color = COLORS.get(tag, COLORS.get(level.upper(), "\033[37m"))
    
    # Text line for terminal
    line = f"{DIM}[{now_str}]{RESET} {color}{BOLD}[{tag}]{RESET} {message}"
    try:
        print(line, file=sys.stdout, flush=True)
    except UnicodeEncodeError:
        # Non-UTF-8 stdout (e.g. redirected cp1252 console): never let logging abort a pipeline
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        print(line.encode(encoding, errors="backslashreplace").decode(encoding), file=sys.stdout, flush=True)

    # Forward to python logging
    py_logger = logging.getLogger(f"app.{tag.lower()}")
    if level.upper() == "ERROR":
        py_logger.error(str(message))
    elif level.upper() == "WARN" or level.upper() == "WARNING":
        py_logger.warning(str(message))
    else:
        py_logger.info(str(message))
