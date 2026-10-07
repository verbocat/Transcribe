"""Cancellation for long-running requests.

A client tags a request with an `X-Job-Id` header. While that request runs, the job is registered here, so
`POST /api/jobs/{job_id}/cancel` can stop it:
  - the request task is cancelled (every awaited step, including streaming responses, stops),
  - FFmpeg child processes started on behalf of the job are killed,
  - cleanup callbacks registered by the job (deleting partial files, etc.) run.

Work already handed to a plain thread (e.g. a blocking HTTP call to a third-party API) cannot be interrupted;
its result is simply discarded once it returns.
"""
import asyncio
import contextvars
import logging
import subprocess
import threading
from typing import Callable, Dict, Optional

logger = logging.getLogger("backend.jobs")

_current: "contextvars.ContextVar[Optional[Job]]" = contextvars.ContextVar("current_job", default=None)
_jobs: Dict[str, "Job"] = {}
_lock = threading.Lock()


class Job:
    def __init__(self, job_id: str, task: Optional[asyncio.Task] = None):
        self.id = job_id
        self.task = task
        self.cancelled = False
        self.procs: list = []
        self.cleanups: list = []

    def cancel(self) -> None:
        self.cancelled = True
        for proc in list(self.procs):
            try:
                if proc.poll() is None:
                    proc.kill()
            except Exception:
                pass
        for fn in list(self.cleanups):
            try:
                fn()
            except Exception:
                logger.debug("job cleanup failed", exc_info=True)
        self.cleanups.clear()
        if self.task is not None and not self.task.done():
            self.task.cancel()


def register(job_id: str, task: Optional[asyncio.Task] = None) -> "Job":
    job = Job(job_id, task)
    with _lock:
        _jobs[job_id] = job
    return job


def unregister(job_id: str, job: Optional["Job"] = None) -> None:
    """Forget a job. With `job`, only if that exact job is still the one registered (a background run may have taken the id over)."""
    with _lock:
        if job is None or _jobs.get(job_id) is job:
            _jobs.pop(job_id, None)


def cancel(job_id: str) -> bool:
    """Cancel a registered job. Returns False when it is unknown (already finished or never started)."""
    with _lock:
        job = _jobs.get(job_id)
    if job is None:
        return False
    job.cancel()
    return True


def current_job() -> Optional["Job"]:
    return _current.get()


def is_cancelled() -> bool:
    job = _current.get()
    return bool(job and job.cancelled)


def track_process(proc) -> None:
    """Register a child process with the running job so a cancel kills it."""
    job = _current.get()
    if job is None:
        return
    job.procs.append(proc)
    if job.cancelled:
        try:
            proc.kill()
        except Exception:
            pass


def on_cancel(fn: Callable[[], None]) -> None:
    """Run `fn` if the running job is cancelled (e.g. remove a partly written file)."""
    job = _current.get()
    if job is not None:
        job.cleanups.append(fn)


def run_subprocess(cmd, timeout: Optional[float] = None, **kwargs) -> subprocess.CompletedProcess:
    """subprocess.run(capture_output=True, text=True) whose child is killed when the job is cancelled."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kwargs)
    track_process(proc)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise
    return subprocess.CompletedProcess(cmd, proc.returncode, out, err)


class JobScopeMiddleware:
    """Pure ASGI middleware: runs each request carrying `X-Job-Id` as a cancellable job."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        job_id = None
        if scope["type"] == "http":
            for name, value in scope.get("headers", []):
                if name == b"x-job-id":
                    job_id = value.decode("latin-1").strip()[:64] or None
                    break
        if not job_id:
            await self.app(scope, receive, send)
            return

        job = register(job_id, asyncio.current_task())
        token = _current.set(job)
        started = False

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except asyncio.CancelledError:
            if not job.cancelled:
                raise
            # Cancelled on purpose. The task cancellation is consumed here so the server keeps running.
            task = asyncio.current_task()
            if task is not None and hasattr(task, "uncancel"):
                task.uncancel()
            if started:
                # A stream was already open: end it cleanly instead of dropping the connection
                try:
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
                except Exception:
                    pass
            else:
                body = b'{"detail":"Cancelled"}'
                try:
                    await send({"type": "http.response.start", "status": 499,
                                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                    await send({"type": "http.response.body", "body": body})
                except Exception:
                    pass
        finally:
            _current.reset(token)
            unregister(job_id, job)
