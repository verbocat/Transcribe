// Sends the signed-in user's session token with every request to our own API, and reports "Out of hours".
// The server is the only place limits are enforced; this file just makes sure it knows who is asking.
import { getApiBase } from '../config';

const TOKEN_KEY = 'verbolabs_auth_token';
// Routes that spend transcription / translation hours; when one finishes, the remaining-hours display refreshes.
const METERED = /\/api\/(transcribe|transcribe_async|subtitle\/(generate|generate_stream|acoustic_sync)|centroid\/translate)(\?|$)/;

const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

function isOurApi(url) {
  const base = getApiBase();
  const u = String(url || '');
  if (u.startsWith('/api/')) return true;
  return Boolean(base) && u.startsWith(`${base}/api/`);
}

function announce(url, status, bodyText) {
  if (status === 402) {
    try {
      const body = JSON.parse(bodyText);
      if (body && body.code === 'out_of_hours') {
        window.dispatchEvent(new CustomEvent('lt-out-of-hours', { detail: body }));
      }
    } catch { /* not our JSON */ }
  }
  if (METERED.test(String(url))) window.dispatchEvent(new CustomEvent('lt-usage-refresh'));
}

export function installApiAuth() {
  if (typeof window === 'undefined' || window.__ltApiAuth) return;
  window.__ltApiAuth = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isOurApi(url)) return realFetch(input, init);
    const t = token();
    let nextInit = init;
    if (t) {
      const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${t}`);
      nextInit = { ...(init || {}), headers };
    }
    const res = await realFetch(input, nextInit);
    if (res.status === 402) res.clone().text().then((txt) => announce(url, 402, txt)).catch(() => {});
    else if (METERED.test(url)) announce(url, res.status, '');
    return res;
  };

  const proto = window.XMLHttpRequest.prototype;
  const open = proto.open;
  const setHeader = proto.setRequestHeader;
  const send = proto.send;
  proto.open = function (method, url, ...rest) {
    this.__ltUrl = String(url);
    this.__ltAuth = false;
    return open.call(this, method, url, ...rest);
  };
  proto.setRequestHeader = function (name, value) {
    if (/^authorization$/i.test(name)) this.__ltAuth = true;
    return setHeader.call(this, name, value);
  };
  proto.send = function (body) {
    if (isOurApi(this.__ltUrl)) {
      const t = token();
      if (t && !this.__ltAuth) setHeader.call(this, 'Authorization', `Bearer ${t}`);
      this.addEventListener('loadend', () => announce(this.__ltUrl, this.status, this.responseType === '' || this.responseType === 'text' ? this.responseText : ''));
    }
    return send.call(this, body);
  };
}
