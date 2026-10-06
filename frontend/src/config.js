// API Base URL configuration:
// 1. Build-time environment variable (VITE_API_URL from Vercel / .env)
//    Takes highest priority on deployed sites (e.g. Vercel).
// 2. User manual override stored in browser (localStorage: karya_api_url)
// 3. Dynamic Localhost Auto-Detection:
//    When running locally on localhost/127.0.0.1, auto-detects whichever backend port
//    is running (defaults to 8001 where uvicorn runs, or probes 8001 / 8000).

export const cleanUrl = (raw) => {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return '';
  let url = raw.trim().replace(/\/+$/, '');
  // Strip Swagger/OpenAPI doc paths e.g. /docs, /docs/..., /redoc
  url = url.replace(/\/(docs|redoc)(\/.*)?$/i, '');
  url = url.replace(/\/api\/?$/i, '');
  return url.replace(/\/+$/, '');
};

export const isLocalhostHost = () => {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0';
};

const getInitialApiBase = () => {
  const envUrl = cleanUrl(import.meta.env.VITE_API_URL);
  const isLocal = isLocalhostHost();

  // If on a remote deployed domain (e.g. Vercel):
  if (!isLocal) {
    if (envUrl) {
      try {
        const lastEnv = localStorage.getItem('karya_last_env_api_url');
        const saved = localStorage.getItem('karya_api_url');
        if (lastEnv !== envUrl || (saved && cleanUrl(saved) !== envUrl)) {
          localStorage.removeItem('karya_api_url');
          localStorage.setItem('karya_last_env_api_url', envUrl);
        }
      } catch {}
      return envUrl;
    }

    try {
      const saved = localStorage.getItem('karya_api_url');
      if (saved && saved.trim()) {
        const cleaned = cleanUrl(saved);
        if (cleaned !== saved) {
          if (cleaned) localStorage.setItem('karya_api_url', cleaned);
          else localStorage.removeItem('karya_api_url');
        }
        return cleaned;
      }
    } catch {}

    return '';
  }

  // If on localhost / 127.0.0.1:
  try {
    const saved = localStorage.getItem('karya_api_url');
    if (saved && saved.trim()) {
      const cleaned = cleanUrl(saved);
      if (cleaned !== saved) {
        if (cleaned) localStorage.setItem('karya_api_url', cleaned);
        else localStorage.removeItem('karya_api_url');
      }
      if (cleaned) return cleaned;
    }
  } catch {}

  if (envUrl) {
    return envUrl;
  }

  try {
    const sessionDetected = sessionStorage.getItem('karya_detected_api_url');
    if (sessionDetected && sessionDetected.trim()) {
      const cleaned = cleanUrl(sessionDetected);
      if (cleaned) return cleaned;
    }
  } catch {}

  // Local development default: Project backend uvicorn is configured on 8000
  return 'http://localhost:8000';
};

export let API_BASE = getInitialApiBase();

export const getApiBase = () => API_BASE;

export const setCustomApiBase = (url) => {
  try {
    const cleaned = cleanUrl(url);
    const envUrl = cleanUrl(import.meta.env.VITE_API_URL);
    if (!cleaned || cleaned === envUrl) {
      localStorage.removeItem('karya_api_url');
      API_BASE = envUrl || (isLocalhostHost() ? 'http://localhost:8001' : '');
    } else {
      localStorage.setItem('karya_api_url', cleaned);
      API_BASE = cleaned;
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('karya_api_url_changed', { detail: { url: API_BASE } }));
    }
  } catch {}
};

/**
 * Fast health check test against a target backend URL.
 */
export const testBackendHealth = async (targetUrl, timeoutMs = 2500) => {
  const base = cleanUrl(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const res = await fetch(`${base}/api/health`, {
      method: 'GET',
      signal: controller.signal
    });
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, status: res.status, latencyMs, data };
    }
    return { ok: false, status: res.status, latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return { ok: false, status: 0, latencyMs, error: err.name === 'AbortError' ? 'Timed out' : (err.message || 'Network error') };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Automatically probes candidate localhost ports to discover the active running backend.
 */
export const detectAndSelectLiveBackend = async () => {
  if (!isLocalhostHost()) {
    return API_BASE;
  }

  // If user explicitly saved a manual override, verify that first
  try {
    const userSaved = localStorage.getItem('karya_api_url');
    if (userSaved && userSaved.trim()) {
      const check = await testBackendHealth(userSaved, 1500);
      if (check.ok) return cleanUrl(userSaved);
    }
  } catch {}

  const candidates = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:8001',
    'http://127.0.0.1:8001'
  ];

  for (const candidate of candidates) {
    const check = await testBackendHealth(candidate, 1200);
    if (check.ok) {
      const resolved = cleanUrl(candidate);
      if (API_BASE !== resolved) {
        API_BASE = resolved;
        try {
          sessionStorage.setItem('karya_detected_api_url', resolved);
        } catch {}
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('karya_api_url_changed', { detail: { url: resolved } }));
        }
      }
      return resolved;
    }
  }

  return API_BASE;
};

// Initiate non-blocking auto-probe on boot if on localhost
if (typeof window !== 'undefined' && isLocalhostHost()) {
  setTimeout(() => {
    detectAndSelectLiveBackend().catch(() => {});
  }, 100);
}


