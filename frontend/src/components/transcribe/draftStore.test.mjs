import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, normalizeStudioDoc, buildDraft, buildStudioDoc, resamplePeaks, studioDocForServer, DRAFT_VERSION } from './draftStore.js';

test('a version-1 draft (no version field) still loads', () => {
  const d = normalizeDraft({ segments: [{ segment_id: 1 }], complianceScore: 90, timestamp: 't' });
  assert.equal(d.version, 1);
  assert.equal(d.segments.length, 1);
  assert.deepEqual(d.media, { stored: false, video: false, duration: 0 });
  assert.equal(normalizeDraft({ nope: true }), null);
});

test('a new draft carries the version and media flags', () => {
  const d = buildDraft({ segments: [], complianceScore: 1, totalErrors: 0, totalWarnings: 0, filename: 'a.mp4', hasMedia: true, hasVideo: false, duration: 12 });
  assert.equal(d.version, DRAFT_VERSION);
  assert.equal(normalizeDraft(d).media.stored, true);
});

test('studio documents from any shape normalize, and a missing active track is dropped', () => {
  const doc = normalizeStudioDoc({ tracks: { hi: [{ id: 1, text: 'x' }] }, active: 'hi' });
  assert.equal(doc.activeTrack, 'hi');
  assert.equal(normalizeStudioDoc({ tracks: {}, activeTrack: 'fr' }).activeTrack, null);
  assert.equal(normalizeStudioDoc(null), null);
});

test('server copy of the peaks is coarser but keeps the loudest value of each bucket', () => {
  assert.deepEqual(resamplePeaks([0.1, 0.9, 0.2, 0.3, 0.4, 0.2], 6, 2), [0.9, 0.4]);
  const doc = buildStudioDoc({ studio: { tracks: {} }, peaks: new Array(500).fill(0.5), peaksPps: 50, duration: 10 });
  const server = studioDocForServer(doc);
  assert.equal(server.peaks.length, 100);
  assert.equal(server.peaksPps, 10);
});
