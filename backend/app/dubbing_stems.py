"""Background (music + effects) separation for the Dubbing Studio.

Two modes:
  * "demucs": AI source separation (Demucs htdemucs), run in a separate process (app/stem_worker.py). Needs the optional
    packages `torch` and `demucs`; about 0.5 to 1x real time on a 4-core CPU server (1 hour of video: 30 to 60 minutes).
  * "basic": ffmpeg centre-channel removal. Instant and needs nothing installed, but the background sounds thin and any
    centred music is lost too. Only a fallback.
"""
import asyncio
import importlib.util
import logging
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable, Dict, Optional

from app.dubbing_engines import DubbingError, _ffmpeg, _run

logger = logging.getLogger(__name__)
BACKEND_DIR = Path(__file__).resolve().parent.parent


def status() -> Dict[str, object]:
    has = bool(importlib.util.find_spec("demucs") and importlib.util.find_spec("torch"))
    return {"demucs": has, "basic": True,
            "hint": None if has else "Install Demucs on the server for studio-quality separation: pip install torch demucs --extra-index-url https://download.pytorch.org/whl/cpu"}


def _to_mp3(wav: Path) -> None:
    r = _run([_ffmpeg(), "-y", "-loglevel", "error", "-i", str(wav), "-b:a", "192k", str(wav.with_suffix(".mp3"))], timeout=1800)
    if r.returncode != 0:
        raise DubbingError("Could not encode a stem.")


async def separate(media: str, out_dir: Path, mode: str, progress: Optional[Callable[[float, str], None]] = None) -> Dict[str, object]:
    """Writes out_dir/background.(wav|mp3) and vocals.(wav|mp3). Returns {"mode": ...}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    src = out_dir / "source.wav"
    r = await asyncio.to_thread(_run, [_ffmpeg(), "-y", "-loglevel", "error", "-i", media, "-vn", "-ac", "2", "-ar", "44100", str(src)], 3600)
    if r.returncode != 0:
        raise DubbingError("Could not read the audio of this file.")
    if mode == "demucs":
        if not status()["demucs"]:
            raise DubbingError("Demucs is not installed on the server. Use the basic mode, or install Demucs (see the hint).")
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.stem_worker", str(src), str(out_dir),
            cwd=str(BACKEND_DIR), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        err_tail = []

        async def drain_err():
            async for line in proc.stderr:
                err_tail.append(line.decode("utf-8", "replace").strip())
                del err_tail[:-8]
        err_task = asyncio.create_task(drain_err())
        try:
            async for line in proc.stdout:
                m = re.match(r"PROGRESS ([0-9.]+)", line.decode("utf-8", "replace"))
                if m and progress:
                    progress(float(m.group(1)), "Separating the background")
            code = await proc.wait()
            await err_task
        except asyncio.CancelledError:
            proc.kill()
            raise
        if code != 0:
            raise DubbingError("Background separation failed: " + (" | ".join(err_tail[-3:]) or f"exit code {code}"))
    elif mode == "basic":
        if progress:
            progress(0.2, "Removing the centre channel")
        bg = await asyncio.to_thread(_run, [_ffmpeg(), "-y", "-loglevel", "error", "-i", str(src), "-af", "pan=stereo|c0=c0-c1|c1=c1-c0", str(out_dir / "background.wav")], 3600)
        vo = await asyncio.to_thread(_run, [_ffmpeg(), "-y", "-loglevel", "error", "-i", str(src), "-af", "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1", str(out_dir / "vocals.wav")], 3600)
        if bg.returncode != 0 or vo.returncode != 0:
            raise DubbingError("Basic separation failed.")
    else:
        raise DubbingError("Unknown separation mode.")
    src.unlink(missing_ok=True)
    for name in ("background", "vocals"):
        await asyncio.to_thread(_to_mp3, out_dir / f"{name}.wav")
    if progress:
        progress(1.0, "Background ready")
    return {"mode": mode}


def mix_with_background(bg_wav: str, dub_wav: str, gain: float, out_mp3: str) -> None:
    """Dub over the background; `gain` is the background level (1.0 = original loudness)."""
    def run(fc: str) -> bool:
        cmd = [_ffmpeg(), "-y", "-loglevel", "error", "-i", bg_wav, "-i", dub_wav, "-filter_complex", fc, "-map", "[o]", "-b:a", "192k", out_mp3]
        return subprocess.run(cmd, capture_output=True, timeout=3600).returncode == 0

    chain = "[bg][dub]amix=inputs=2:duration=longest:dropout_transition=0{norm},alimiter=limit=0.97[o]"
    pre = "[0:a]volume={g:.3f},aresample=44100[bg];[1:a]{v}aresample=44100,pan=stereo|c0=c0|c1=c0[dub];"
    if run(pre.format(g=gain, v="") + chain.format(norm=":normalize=0")):
        return
    # older ffmpeg without amix normalize=0: amix halves each input, so double both to compensate
    if not run(pre.format(g=gain * 2, v="volume=2,") + chain.format(norm="")):
        raise DubbingError("Could not mix the dub with the background.")
