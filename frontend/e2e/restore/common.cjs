const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const API = 'http://localhost:8000';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
const state = { saved: [] };

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('  [console]', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.route(`${API}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };
    if (p === '/api/health') return json(route, { status: 'ok', has_elevenlabs_api_key: true });
    if (p === '/api/auth/me') return json(route, { user: { id: 1, email: 'qa@verbolabs.com', name: 'QA', is_admin: false } });
    if (p === '/api/centroid/status') return json(route, { configured: true, reachable: true });
    if (p === '/api/projects' && req.method() === 'GET') return json(route, { projects: state.saved.map((s) => s.meta) });
    if (p === '/api/projects/save') { const r = body().result;  const id = r.audio_id || 'proj1'; state.saved = [{ meta: { id, filename: r.filename, segment_count: r.segments.length, language: r.language, script: r.script, duration: 12, compliance_score: r.compliance_score, total_errors: r.total_errors, total_warnings: r.total_warnings, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, full: { ...r, audio_id: id } }]; return json(route, { status: 'success', project_id: id }); }
    if (p.startsWith('/api/projects/') && req.method() === 'GET') { const s = state.saved[0]; return s ? json(route, s.full) : json(route, {}, 404); }
    if (p === '/api/lint') { const b = body(); return json(route, { segments: b.segments, compliance_score: 91.5, total_errors: 1, total_warnings: 2 }); }
    if (p === '/api/centroid/translate') {
      const b = body(); const results = {};
      b.target_langs.forEach((l) => { const cues = b.events.map((e, i) => ({ index: i + 1, start: e.start_time, end: e.end_time, source: e.text, target: `[${l}] ${e.text}` })); results[l] = { cues, srt: '', warnings: [], stats: {} }; });
      return json(route, { results, errors: {} });
    }
    if (p === '/api/centroid/qc') {
      const b = body();
      return json(route, { summary: { total: 2 }, issues: [
        { index: 1, category: 'accuracy', severity: 'error', title: 'Mistranslation', detail: 'Check term', suggestion: `[fixed] ${b.cues[0].target}` },
        { index: 2, category: 'style', severity: 'warning', title: 'Tone', detail: 'Too formal', suggestion: null } ] });
    }
    if (p === '/api/subtitle/qc') return json(route, { issues: [] });
    if (p.startsWith('/api/audio/')) return route.fulfill({ status: 404, headers: cors, body: '' });
    return json(route, {});
  });
  return page;
}
module.exports = { chromium, BASE, API, newPage, state };
