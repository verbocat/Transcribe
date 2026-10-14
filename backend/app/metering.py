"""Glue between the API routes and the hour budgets in auth_module/usage.py.

Durations are measured on the server (ffprobe of the stored file, or the cue timings and text the server
received for translation), never taken from a client-supplied "duration" field.
"""
import asyncio
import logging
import re
import subprocess
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException

from app.auth_module import usage
from app.auth_module.models import User

logger = logging.getLogger(__name__)

# A real person cannot speak or read faster than this; used as a floor so a client cannot shrink the
# billed time of a translation by sending falsified cue timings.
MAX_CHARS_PER_SECOND = 25.0
MIN_CHARGE_MS = 1000
MAX_CUE_SECONDS = 600.0  # a single cue longer than 10 min is not subtitle data


def user_ref(user: User) -> Dict[str, str]:
    """Copy what we need out of the ORM object now; the request's DB session may close before a stream ends."""
    return {"id": user.id, "email": user.email}


def _decoded_seconds(path: str) -> float:
    """Length of the audio that actually decodes, not what the container header claims (a doctored header
    could otherwise understate a long file). Skips video, so it runs far faster than real time."""
    try:
        out = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-vn", "-f", "null", "-progress", "pipe:1", "-"],
            capture_output=True, text=True, timeout=900,
        ).stdout
        last = 0.0
        for line in out.splitlines():
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    last = max(last, float(line.split("=", 1)[1]) / 1_000_000.0)
                except ValueError:
                    pass
        return last
    except Exception:
        return 0.0


def _header_seconds(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=60,
        ).stdout.strip()
        v = float(out)
        return v if v == v and v != float("inf") else 0.0
    except Exception:
        return 0.0


def probe_duration_ms_sync(path: str) -> int:
    """Billable length of a media file in ms: the larger of what ffprobe reports and what ffmpeg actually
    decodes. Raises 422 when it cannot be measured, because a job of unknown length cannot be metered."""
    seconds = max(_header_seconds(path), _decoded_seconds(path))
    if not (seconds > 0):
        raise HTTPException(status_code=422, detail="Could not read the length of this media file, so it cannot be processed.")
    return max(MIN_CHARGE_MS, int(round(seconds * 1000)))


async def probe_duration_ms(path: str) -> int:
    return await asyncio.to_thread(probe_duration_ms_sync, path)


def _num(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f if f == f and abs(f) != float("inf") else 0.0


def translation_ms(cues: Iterable[Dict[str, Any]], n_langs: int, srt: Optional[str] = None) -> int:
    """Billable translation time: subtitle display time per target language, never less than the time the
    text itself needs at MAX_CHARS_PER_SECOND."""
    shown = 0.0
    chars = 0
    for c in cues or []:
        if not isinstance(c, dict):
            continue
        start = _num(c.get("start_time", c.get("start")))
        end = _num(c.get("end_time", c.get("end")))
        shown += min(MAX_CUE_SECONDS, max(0.0, end - start))
        chars += len(str(c.get("text") or c.get("source") or ""))
    if srt and not chars:
        chars = len(srt)
    seconds = max(shown, chars / MAX_CHARS_PER_SECOND)
    return max(MIN_CHARGE_MS, int(round(seconds * 1000))) * max(1, int(n_langs))


_SRT_TIME = re.compile(r"(\d+):(\d\d):(\d\d)[,.](\d{1,3})")


def timeline_ms(cues: Iterable[Dict[str, Any]], srt: Optional[str] = None) -> int:
    """Where the last subtitle ends (ms from the start of the media). A translation is never billed for less than
    this, so a request cannot point at a short file while translating a long subtitle track."""
    end = 0.0
    for c in cues or []:
        if isinstance(c, dict):
            end = max(end, min(_num(c.get("end_time", c.get("end"))), 24 * 3600.0))
    for h, m, sec, ms in _SRT_TIME.findall(srt or ""):
        end = max(end, int(h) * 3600 + int(m) * 60 + int(sec) + int(ms.ljust(3, "0")) / 1000.0)
    return int(round(end * 1000))


_media_ms_cache: Dict[str, int] = {}


async def media_ms(path: Optional[str]) -> int:
    """Exact length of a stored media file in ms (0 when unknown), cached per file."""
    if not path:
        return 0
    if path not in _media_ms_cache:
        try:
            _media_ms_cache[path] = await probe_duration_ms(path)
        except HTTPException:
            return 0
    return _media_ms_cache[path]


class Metered:
    """`with Metered(...) as m:` holds the hours up front, then charges or refunds when the block ends.

    * normal exit            -> charged
    * error                  -> refunded, unless `m.work_done = True` (the paid-for provider call finished)
    * cancel / disconnect    -> charged if `m.work_started` (the provider call was dispatched), else refunded
    So a client cannot get free work by dropping the connection once the expensive call is under way.
    """

    def __init__(self, user: Dict[str, str], kind: str, ms: int, route: str, ref: Optional[str] = None):
        self.user, self.kind, self.ms, self.route, self.ref = user, kind, int(ms), route, ref
        self.rid: Optional[str] = None
        self.work_started = False
        self.work_done = False
        self.closed = False

    def reserve(self) -> "Metered":
        db = usage.new_session()
        try:
            self.rid = usage.reserve(db, self.user["id"], self.kind, self.ms, self.route, self.ref)
        finally:
            db.close()
        return self

    def finish(self, charge: bool, note: Optional[str] = None) -> None:
        if not self.rid or self.closed:
            return
        self.closed = True
        db = usage.new_session()
        try:
            (usage.settle if charge else usage.refund)(db, self.rid, note)
        except Exception:
            logger.exception("could not close usage reservation %s", self.rid)
        finally:
            db.close()

    def on_error(self, exc: BaseException) -> None:
        """Close after a failure or cancellation (no-op if already closed)."""
        if isinstance(exc, (asyncio.CancelledError, GeneratorExit)):
            self.finish(self.work_started, "cancelled" if self.work_started else "cancelled before the provider call")
        else:
            self.finish(self.work_done, "failed after the provider call" if self.work_done else "failed")

    # Stages that mean the paid provider call has been dispatched / has returned.
    _STARTED = {"uploading", "transcribing"}
    _DONE = {"script", "segmenting", "gender", "linting", "saving", "done"}

    def note_stage(self, stage: str) -> None:
        if stage in self._STARTED:
            self.work_started = True
        elif stage in self._DONE:
            self.work_started = self.work_done = True

    def __enter__(self):
        return self.reserve()

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.finish(True)
        else:
            self.on_error(exc if exc is not None else exc_type())
        return False


def transcribe_stage_hook(meter: Metered):
    """progress_cb for process_audio_file that tells the meter how far the paid call got."""
    def cb(stage, *_args, **_kwargs):
        meter.note_stage(stage)
    return cb
