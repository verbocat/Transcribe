/**
 * Cancellation helpers shared by Transcribe Studio and Subtitle Studio.
 *
 * startJob() gives a request an AbortSignal plus a job id. Send the id as the `X-Job-Id` header
 * (jobHeaders) and the backend can stop the work itself when cancel() is called, not just the browser's wait for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CancelledError';
    this.cancelled = true;
  }
}

export const isCancelError = (err) =>
  !!err && (err.name === 'AbortError' || err.name === 'CancelledError' || err.cancelled === true);

const makeId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

export const jobHeaders = (job, extra = {}) => (job ? { ...extra, 'X-Job-Id': job.id } : extra);

/** Tell the server to stop a job. Best effort: the browser side is already aborted. */
export function cancelServerJob(apiBase, jobId) {
  try {
    const base = (apiBase || '').replace(/\/$/, '');
    return fetch(`${base}/api/jobs/${jobId}/cancel`, { method: 'POST', keepalive: true }).catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

/** One cancellable operation. */
export function startJob(apiBase, { id } = {}) {
  const controller = new AbortController();
  const job = {
    id: id || makeId(),
    signal: controller.signal,
    get cancelled() { return controller.signal.aborted; },
    cancel() {
      if (controller.signal.aborted) return;
      controller.abort();
      cancelServerJob(apiBase, job.id);
    },
    throwIfCancelled() {
      if (controller.signal.aborted) throw new CancelledError();
    },
  };
  return job;
}

/** Sleep that ends early (throwing CancelledError) when the job is cancelled. */
export function sleepCancellable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new CancelledError()); return; }
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new CancelledError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs named tasks that show up in a strip with a Cancel button.
 *   const { tasks, notice, run, cancel } = useTaskRunner(API_BASE);
 *   await run('Translating subtitles', async (job) => { await fetch(url, { signal: job.signal, headers: jobHeaders(job) }); });
 * A cancelled task resolves to undefined, shows "<label> cancelled" in `notice`, and leaves the caller's state untouched
 * (the callback only applies results after its awaits succeed). Other errors are re-thrown.
 */
export function useTaskRunner(apiBase) {
  const [tasks, setTasks] = useState([]); // [{ id, label, detail }]
  const [notice, setNotice] = useState('');
  const jobs = useRef(new Map());
  const noticeTimer = useRef(null);

  useEffect(() => () => {
    clearTimeout(noticeTimer.current);
    jobs.current.forEach((j) => j.cancel());
  }, []);

  const flash = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 3500);
  }, []);

  const run = useCallback(async (label, fn) => {
    const job = startJob(apiBase);
    jobs.current.set(job.id, job);
    setTasks((t) => [...t, { id: job.id, label }]);
    const setDetail = (detail) => setTasks((t) => t.map((x) => (x.id === job.id ? { ...x, detail } : x)));
    try {
      return await fn(job, setDetail);
    } catch (err) {
      if (job.cancelled || isCancelError(err)) {
        flash(`${label} cancelled. Nothing was changed.`);
        return undefined;
      }
      throw err;
    } finally {
      jobs.current.delete(job.id);
      setTasks((t) => t.filter((x) => x.id !== job.id));
    }
  }, [apiBase, flash]);

  const cancel = useCallback((id) => { jobs.current.get(id)?.cancel(); }, []);

  return { tasks, notice, run, cancel };
}
