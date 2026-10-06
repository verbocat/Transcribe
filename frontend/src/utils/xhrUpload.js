/**
 * Upload helpers that report REAL progress.
 *
 * fetch() cannot report how many bytes of a request body have left the browser, XMLHttpRequest
 * can (xhr.upload.onprogress). Everything here is measured, never estimated:
 *   - loaded / total are bytes the browser has actually sent
 *   - speed is a moving average over the last few seconds
 *   - eta is remaining bytes divided by that measured speed
 */

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 5) return 'a few seconds left';
  if (seconds < 90) return `${Math.round(seconds)} s left`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `about ${m} min left`;
  return `about ${Math.floor(m / 60)} h ${m % 60} min left`;
}

/** Moving-average throughput meter. push(totalBytesSoFar) then read speed(). */
export function createRateMeter(windowMs = 4000) {
  const samples = [];
  return {
    push(loaded) {
      const now = performance.now();
      samples.push([now, loaded]);
      while (samples.length > 2 && now - samples[0][0] > windowMs) samples.shift();
    },
    speed() {
      if (samples.length < 2) return 0;
      const [t0, b0] = samples[0];
      const [t1, b1] = samples[samples.length - 1];
      const dt = (t1 - t0) / 1000;
      return dt > 0.25 ? Math.max(0, (b1 - b0) / dt) : 0;
    },
  };
}

/** Standard progress payload from raw numbers. */
export function progressFrom(loaded, total, speed) {
  const remaining = Math.max(0, total - loaded);
  return {
    percent: total > 0 ? Math.min(100, (loaded / total) * 100) : null,
    loaded,
    total,
    speed,
    eta: speed > 0 ? remaining / speed : null,
  };
}

/**
 * POST a FormData body and resolve with { ok, status, data }.
 * onProgress({ percent, loaded, total, speed, eta }) fires as bytes are sent;
 * onSent() fires once the whole body has left the browser (the server may still be working).
 * `baseLoaded` / `grandTotal` let a caller that sends several requests (chunks) report one overall bar.
 */
export function xhrPostForm(url, formData, { onProgress, onSent, meter, baseLoaded = 0, grandTotal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const rate = meter || createRateMeter();
    xhr.open('POST', url);
    xhr.responseType = 'text';

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const loaded = baseLoaded + e.loaded;
      const total = grandTotal || baseLoaded + e.total;
      rate.push(loaded);
      if (onProgress) onProgress(progressFrom(loaded, total, rate.speed()));
    };
    xhr.upload.onload = () => { if (onSent) onSent(); };

    xhr.onload = () => {
      let data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (_) { data = null; }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data, text: xhr.responseText });
    };
    xhr.onerror = () => reject(Object.assign(new Error('Network error while uploading. Check your connection.'), { status: 0 }));
    xhr.ontimeout = () => reject(Object.assign(new Error('The upload timed out.'), { status: 0 }));
    xhr.onabort = () => reject(Object.assign(new Error('The upload was cancelled.'), { status: 0 }));
    xhr.send(formData);
  });
}

/** Download as a Blob with real byte progress (falls back to a plain download if streaming is unavailable). */
export async function fetchBlobWithProgress(url, { onProgress, expectedBytes = 0 } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || expectedBytes || 0;
  if (!res.body || !res.body.getReader) return res.blob();

  const reader = res.body.getReader();
  const rate = createRateMeter();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    rate.push(loaded);
    if (onProgress) onProgress(progressFrom(loaded, total || loaded, rate.speed()));
  }
  return new Blob(parts, { type: res.headers.get('content-type') || 'application/octet-stream' });
}
