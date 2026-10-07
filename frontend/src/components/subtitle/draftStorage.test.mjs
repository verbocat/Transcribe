import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDraft, readDraft } from './draftStorage.js';

const ev = (id, text, qc = []) => ({ id, text, qc_errors: qc });
const align = [{ rule_id: 'TRANSLATION-ALIGN' }];
const base = { complianceScore: 90, totalErrors: 1, totalWarnings: 0, language: 'hi', contentType: 'x', cplLimit: 42, cpsLimit: 20, frameRate: 24, sdhMode: false };

test('draft keeps translated tracks, active track and per-cue flags', () => {
  const en = [ev(1, 'Hello')];
  const hi = [ev(1, 'नमस्ते', align)];
  const draft = JSON.parse(JSON.stringify(buildDraft({ ...base, events: en, tracks: { en, hi }, activeTrack: 'en', sourceTrack: 'en' })));
  const r = readDraft(draft);
  assert.deepEqual(Object.keys(r.tracks).sort(), ['en', 'hi']);
  assert.equal(r.tracks.hi[0].qc_errors[0].rule_id, 'TRANSLATION-ALIGN');
  assert.equal(r.activeTrack, 'en');
  assert.equal(r.sourceTrack, 'en');
});

test('edits on the visible translated track win over its stored copy', () => {
  const en = [ev(1, 'Hello')];
  const hiOld = [ev(1, 'old')];
  const hiNow = [ev(1, 'new')];
  const r = readDraft(JSON.parse(JSON.stringify(buildDraft({ ...base, events: hiNow, tracks: { en, hi: hiOld }, activeTrack: 'hi', sourceTrack: 'en' }))));
  assert.equal(r.events[0].text, 'new');
  assert.equal(r.tracks.hi[0].text, 'new');
  assert.equal(r.activeTrack, 'hi');
  assert.equal(r.sourceTrack, 'en');
});

test('older drafts without tracks still load', () => {
  const r = readDraft({ events: [ev(1, 'Hi')], complianceScore: 100 });
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.tracks, {});
  assert.equal(r.activeTrack, null);
});

test('no tracks are written for a single-language session', () => {
  const d = buildDraft({ ...base, events: [ev(1, 'Hi')], tracks: {}, activeTrack: null, sourceTrack: null });
  assert.equal('tracks' in d, false);
});

test('garbage track data falls back to the visible events', () => {
  const r = readDraft({ events: [ev(1, 'Hi')], tracks: { hi: 'oops' }, activeTrack: 'hi' });
  assert.deepEqual(r.tracks, {});
  assert.equal(r.events.length, 1);
});
