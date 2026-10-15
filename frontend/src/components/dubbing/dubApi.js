import { getApiBase } from '../../config';

export const GRAD = 'linear-gradient(100deg, #1a6dff 0%, #5b3cff 55%, #8a10ff 100%)';
export const MEDIA_RE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
export const VIDEO_RE = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
export const api = (path) => `${getApiBase()}/api/dubbing${path}`;

export async function call(path, opts) {
  const res = await fetch(api(path), opts);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${res.status})`);
  return data;
}
export const send = (method, path, body) => call(path, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

export const fmtTime = (s) => {
  const v = Math.max(0, Number(s) || 0);
  const m = Math.floor(v / 60);
  return `${m}:${(v % 60).toFixed(1).padStart(4, '0')}`;
};
