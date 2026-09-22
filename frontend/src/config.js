// API Base URL configuration:
// 1. Build-time environment variable (VITE_API_URL from Vercel / .env)
//    Takes highest priority when set. Automatically purges stale/earlier cached URLs from localStorage.
// 2. User manual override stored in browser (localStorage: karya_api_url)
// 3. Fallback: '' (uses Vite proxy /api -> http://localhost:8000)

export const cleanUrl = (raw) => {
  if (!raw || !raw.trim()) return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '');
};

const getInitialApiBase = () => {
  const envUrl = cleanUrl(import.meta.env.VITE_API_URL);

  if (envUrl) {
    try {
      const lastEnv = localStorage.getItem('karya_last_env_api_url');
      const saved = localStorage.getItem('karya_api_url');

      // If VITE_API_URL is configured (e.g. in Vercel environment variables):
      // Automatically purge any stale or previously saved URL so it connects in one go!
      if (lastEnv !== envUrl || (saved && cleanUrl(saved) !== envUrl)) {
        localStorage.removeItem('karya_api_url');
        localStorage.setItem('karya_last_env_api_url', envUrl);
      }
    } catch {}

    return envUrl;
  }

  // Fallback when VITE_API_URL is not set (e.g. local dev without env var)
  try {
    const saved = localStorage.getItem('karya_api_url');
    if (saved && saved.trim()) {
      return cleanUrl(saved);
    }
  } catch {}

  return '';
};

export const API_BASE = getInitialApiBase();

export const setCustomApiBase = (url) => {
  try {
    const cleaned = cleanUrl(url);
    const envUrl = cleanUrl(import.meta.env.VITE_API_URL);
    // If empty or reset to match VITE_API_URL, remove the manual override so VITE_API_URL is used cleanly
    if (!cleaned || cleaned === envUrl) {
      localStorage.removeItem('karya_api_url');
    } else {
      localStorage.setItem('karya_api_url', cleaned);
    }
  } catch {}
};

