const { chromium, BASE, newPage, state } = require('./common.cjs');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails += 1; };
const text = (page) => page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('textarea,input')].map((e) => e.value).join('\n'));
const idbDump = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('lowerthird-transcribe'); r.onerror = () => res(null);
  r.onsuccess = () => { const db = r.result; const out = {}; const names = [...db.objectStoreNames]; let n = names.length; if (!n) return res(out);
    names.forEach((s) => { const g = db.transaction(s).objectStore(s).getAll(); g.onsuccess = () => { out[s] = g.result.map((x) => ({ name: x.name, hasAudio: !!x.audio, hasVideo: !!x.video, tracks: x.data ? Object.keys(x.data.tracks || {}) : undefined, peaks: x.data ? (x.data.peaks || []).length : undefined, qc: x.data ? !!(x.data.centroid && x.data.centroid.qc) : undefined })); if (!--n) res(out); }; }); };
}));
const idbDeleteMedia = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lowerthird-transcribe'); r.onsuccess = () => { const tx = r.result.transaction('media', 'readwrite'); tx.objectStore('media').clear(); tx.oncomplete = () => res(true); }; }));

async function openStudio(ctx) {
  const page = await newPage(ctx);
  await page.goto(`${BASE}/transcribe`);
  await page.waitForSelector('#ts-media-input', { state: 'attached' });
  return page;
}
async function openProjectsRestore(page, name) {
  await page.getByText('Saved projects').first().click().catch(async () => { await page.getByRole('button', { name: /project/i }).first().click(); });
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('verbolabs_auth_token')) { localStorage.setItem('verbolabs_auth_token', 't'); localStorage.setItem('verbolabs_auth_user', JSON.stringify({ id: 1, email: 'qa@verbolabs.com', name: 'QA' })); } } catch {} });

  // ---------- session 1: build up work ----------
  console.log('\n== Session 1: transcript fixture, translate, QC, fix, speaker edit, draft save ==');
  let page = await openStudio(ctx);
  await page.setInputFiles('#ts-media-input', 'clip.wav');
  await page.waitForTimeout(1200);
  await page.setInputFiles('input[accept=".srt,.vtt,.txt"]', 'clip.srt');
  await page.waitForTimeout(1500);
  await page.getByText('Translate to…').first().click();
  await page.locator('.ts-menu-item', { hasText: /^Hindi$/ }).first().click();
  await page.waitForTimeout(2500);
  // a second language
  await page.getByText('Hindi').first().click();
  await page.locator('.ts-menu-item', { hasText: /^French$/ }).first().click();
  await page.waitForTimeout(2500);
  check('S1 translated track shown', (await text(page)).includes('[fr] Hello, this is the first line.'));
  await page.getByRole('button', { name: /^QC/ }).first().click();
  await page.getByText('Centroid QC').first().click();
  await page.getByText('Run Centroid QC').click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Apply fix' }).first().click();
  await page.waitForTimeout(1200);
  const s1 = await text(page);
  check('S1 fix applied to track text', s1.includes('[fixed]'));
  const s1Tab = s1.match(/Centroid QC · (\d+)/);
  console.log('   QC tab after fix:', s1Tab ? s1Tab[0] : '(none)');
  // speaker gender edit (applies to the whole speaker)
  await page.locator('button', { hasText: /^F$/ }).first().click();
  await page.waitForTimeout(500);
  await page.waitForTimeout(8000); // debounced autosave
  const draft1 = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('karya_autosave_')); return k ? { k, d: JSON.parse(localStorage.getItem(k)) } : null; });
  check('S1 draft written with version 2', draft1 && draft1.d.version === 2, draft1 ? `${draft1.k} v${draft1.d.version}` : 'none');
  check('S1 draft says media stored', draft1 && draft1.d.media.stored === true);
  check('S1 gender saved in draft', draft1 && draft1.d.segments.every((s) => s.gender === 'Female'));
  const dump1 = await idbDump(page);
  console.log('   IDB:', JSON.stringify(dump1));
  check('S1 IDB has media for clip.wav', dump1?.media?.some((m) => m.name === 'clip.wav' && m.hasAudio));
  check('S1 IDB studio has 2 tracks, QC and peaks', dump1?.studio?.[0]?.tracks?.length === 2 && dump1.studio[0].qc && dump1.studio[0].peaks > 100);
  // cloud save too
  await page.getByText('File', { exact: true }).first().click(); await page.getByText('Save to cloud').click();
  await page.waitForTimeout(1500);
  check('S1 server save carried extras', !!state.saved[0]?.full?.extras?.tracks && Object.keys(state.saved[0].full.extras.tracks).length === 2 && state.saved[0].full.extras.centroid?.qc, state.saved[0]?.full?.extras ? `peaks=${state.saved[0].full.extras.peaks.length} pps=${state.saved[0].full.extras.peaksPps}` : 'not saved');
  await page.close();

  const verify = async (p, label, { mediaExpected }) => {
    const t = await text(p);
    check(`${label}: transcript back`, t.includes('Hello, this is the first line.') && t.includes('The final line of the clip.'));
    check(`${label}: translated language back and active`, t.includes('[fixed]') || t.includes('[fr]'), '');
    check(`${label}: FR track is the active one`, t.includes('[fr] And this is the second line'));
    const tabs = await p.evaluate(() => window.__t = 1);
    // open QC drawer and look at Centroid QC state
    await p.getByRole('button', { name: /^QC/ }).first().click();
    await p.waitForTimeout(500);
    const t2 = await text(p);
    check(`${label}: Centroid QC findings back`, /Centroid QC · \d/.test(t2), (t2.match(/Centroid QC[^\n]*/) || [''])[0]);
    await p.getByText('Centroid QC').first().click();
    await p.waitForTimeout(400);
    const t3 = await text(p);
    check(`${label}: applied-fix state back (fixed list / reduced count)`, /Fixed|fixed/.test(t3) || /Centroid QC · 1\b/.test(t3), (t3.match(/\d+ to review|Fixed[^\n]*/g) || []).join(' / '));
    check(`${label}: fixed text kept in track`, t3.includes('[fixed]'));
    check(`${label}: rule-check score back`, (await (async () => { await p.getByText('Rule checks').first().click(); return text(p); })()).includes('91.5%'));
    // timeline
    check(`${label}: timeline blocks (text) present`, (await text(p)).includes('Third line here.'));
    const canvasCount = await p.locator('canvas').count();
    const relink = await p.getByTestId('relink-media').count();
    if (mediaExpected) check(`${label}: no relink needed, media loaded`, relink === 0 && (await p.locator('audio').first().getAttribute('src')) !== null);
    else check(`${label}: relink offered, no media`, relink === 1);
    console.log('   canvases:', canvasCount);
    // speaker gender
    const f = await p.locator('button[class*="active"], button[aria-pressed="true"]').allInnerTexts().catch(() => []);
  };

  // ---------- A: upload the same file again, banner restore ----------
  console.log('\n== A: reload, upload the same video again, banner "Restore draft" ==');
  page = await openStudio(ctx);
  await page.setInputFiles('#ts-media-input', 'clip.wav');
  await page.waitForSelector('text=Restore draft', { timeout: 8000 });
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await page.waitForTimeout(2500);
  await verify(page, 'A', { mediaExpected: true });
  await page.close();

  // ---------- B: no upload at all: Saved projects -> Restore draft ----------
  console.log('\n== B: reload, NO upload, Saved projects > Restore draft ==');
  page = await openStudio(ctx);
  await page.getByText('File', { exact: true }).first().click(); await page.getByText('Saved projects…').first().click();
  await page.waitForTimeout(800);
  const clicked = await page.getByRole('button', { name: /Restore/ }).first().click().then(() => true).catch(() => false);
  check('B: found a Restore draft button in Saved projects', clicked);
  await page.waitForTimeout(3000);
  await verify(page, 'B', { mediaExpected: true });
  await page.close();

  // ---------- C: media gone from this browser ----------
  console.log('\n== C: media removed from browser storage, restore shows timeline from transcript + Relink ==');
  page = await openStudio(ctx);
  await idbDeleteMedia(page);
  await page.reload(); await page.waitForSelector('#ts-media-input', { state: 'attached' });
  await page.getByText('File', { exact: true }).first().click(); await page.getByText('Saved projects…').first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Restore/ }).first().click();
  await page.waitForTimeout(3000);
  await verify(page, 'C', { mediaExpected: false });
  const peaksDrawn = await page.evaluate(() => document.querySelectorAll('canvas').length);
  console.log('   canvases without media:', peaksDrawn);
  await page.setInputFiles('#ts-relink-input', 'clip.wav');
  await page.waitForTimeout(2500);
  const tR = await text(page);
  check('C: after Relink the transcript and translations are still there', tR.includes('Hello, this is the first line.') && tR.includes('[fr] And this is the second line'));
  check('C: after Relink playback is live', (await page.getByTestId('relink-media').count()) === 0 && (await page.locator('audio').first().getAttribute('src')) !== null);
  await page.close();

  // ---------- D: older (version 1) draft ----------
  console.log('\n== D: version-1 draft (no version field, tracks in the old per-file key) still loads ==');
  page = await openStudio(ctx);
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('karya_')).forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('karya_autosave_old.wav', JSON.stringify({ segments: [{ segment_id: 1, speaker: 'Speaker 1', gender: 'Male', start_time: 0, end_time: 2, duration: 2, transcript: 'old draft line', confidence: 1, words: [], qc_errors: [], is_valid: true }], complianceScore: 99, totalErrors: 0, totalWarnings: 0, timestamp: new Date().toISOString() }));
    localStorage.setItem('transcribe_tracks_old.wav', JSON.stringify({ tracks: { hi: [{ id: 1, event_id: 1, start_time: 0, end_time: 2, start: 0, end: 2, text: 'पुरानी पंक्ति', lines: ['पुरानी पंक्ति'] }] }, active: 'hi' }));
  });
  await page.reload(); await page.waitForSelector('#ts-media-input', { state: 'attached' });
  await page.getByText('File', { exact: true }).first().click(); await page.getByText('Saved projects…').first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Restore/ }).first().click();
  await page.waitForTimeout(2500);
  const tD = await text(page);
  check('D: v1 transcript loads', tD.includes('old draft line'));
  check('D: v1 translated track loads and is active', tD.includes('पुरानी पंक्ति'));
  await page.close();

  // ---------- E: cloud project on a "different computer" (no local draft, no media) ----------
  console.log('\n== E: cloud project opened with empty browser storage ==');
  page = await openStudio(ctx);
  await page.evaluate(async () => { Object.keys(localStorage).filter((k) => k.startsWith('karya_') || k.startsWith('transcribe_tracks_')).forEach((k) => localStorage.removeItem(k)); await new Promise((r) => { const q = indexedDB.deleteDatabase('lowerthird-transcribe'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload(); await page.waitForSelector('#ts-media-input', { state: 'attached' });
  await page.getByText('File', { exact: true }).first().click(); await page.getByText('Saved projects…').first().click();
  await page.waitForTimeout(1000);
  await page.getByText('Open', { exact: true }).first().click({ timeout: 8000 }).catch((e) => console.log('   load btn?', e.message.slice(0, 200)));
  await page.waitForTimeout(3000);
  await verify(page, 'E', { mediaExpected: false });
  await page.close();

  await browser.close();
  console.log(`\n${fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'}`);
  process.exit(fails ? 1 : 0);
})();
