import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipGain, duckPoints, interpPoints, mediaEnvelope, speechRegions, addKeyframe, moveKeyframe, setClipLevels, keyframeDb,
  faderToGain, gainToFader, sampleCurve,
} from './audioModel.js';
import { razor } from './editModel.js';

// Same case and numbers as backend/tests/test_dubbing_edit.py (LEVEL_CLIP / LEVEL_EXPECTED)
const LEVEL_CLIP = { in: 1.0, gain: -6, fade_in: 0.5, fade_out: 1.0, keyframes: [{ t: 1.5, db: 0 }, { t: 2.5, db: -12 }] };
const LEVEL_X = [0, 0.25, 0.5, 1.0, 1.5, 2.5, 2.9];
const LEVEL_EXPECTED = [0.0, 0.354393, 0.501187, 0.251189, 0.125893, 0.089019, 0.019694];

test('clip gain and duck breakpoints match the server', () => {
  LEVEL_X.forEach((x, i) => assert.ok(Math.abs(clipGain(LEVEL_CLIP, x, 3.0) - LEVEL_EXPECTED[i]) < 1e-6, `x=${x}`));
  const d = duckPoints([[1, 2], [2.5, 4], [8, 9]], { amount: -12, attack: 0.25, release: 0.5 });
  assert.deepEqual(d.xs, [0.75, 1, 4, 4.5, 7.75, 8, 9, 9.5]);
  assert.deepEqual(d.ys, [0, -12, -12, 0, 0, -12, -12, 0]);
  assert.equal(interpPoints(d, 0.875), -6);
  assert.equal(interpPoints(d, 6), 0);
  assert.equal(interpPoints(d, 20), 0);
});

const ctx = { duration: 10, lines: { 1: { id: 1, start: 2, end: 4, audio: { ready: true, duration: 2 } }, 2: { id: 2, start: 6, end: 7, audio: { ready: false } } } };
const edit = () => ({
  tracks: [{ id: 'A2', duck: { on: true, amount: -12, attack: 0.5, release: 0.5 } }, { id: 'S:A' }],
  clips: [
    { id: 'bg', track: 'A2', source: 'background', start: 0, in: 0, out: 10 },
    { id: 'L1', track: 'S:A', source: 'line', line: 1, start: 2, in: 0, out: null },
    { id: 'L2', track: 'S:A', source: 'line', line: 2, start: 6, in: 0, out: null },
  ],
});

test('ducking follows the speech that is heard', () => {
  assert.deepEqual(speechRegions(edit(), ctx), [[2, 4]]); // line 2 has no speech yet
  const env = mediaEnvelope(edit(), ctx, 'A2');
  assert.equal(env(0.5), 1);
  assert.ok(Math.abs(env(3) - 0.251189) < 1e-5);
  assert.ok(Math.abs(env(1.75) - 0.501187) < 1e-5); // half-way down the attack: -6 dB
  const muted = { ...edit(), tracks: edit().tracks.map((t) => (t.id === 'S:A' ? { ...t, mute: true } : t)) };
  assert.equal(mediaEnvelope(muted, ctx, 'A2')(3), 1);
  assert.equal(env(11), 0); // past the clip
});

test('keyframes keep the sound when added and stay between neighbours when moved; fades stay inside the clip', () => {
  let e = setClipLevels(edit(), ['bg'], { gain: -3, fade_in: 99 }, ctx);
  assert.deepEqual([e.clips[0].gain, e.clips[0].fade_in], [-3, 10]);
  e = addKeyframe(e, 'bg', 2); e = addKeyframe(e, 'bg', 6);
  e = moveKeyframe(e, 'bg', 1, 6, -10);
  assert.equal(keyframeDb(e.clips[0].keyframes, 4), -5);
  e = moveKeyframe(e, 'bg', 0, 9, 0);
  assert.ok(e.clips[0].keyframes[0].t < 6);
  const before = keyframeDb(e.clips[0].keyframes, 5.9995);
  e = addKeyframe(e, 'bg', 5.9995); // a new keyframe takes the level the curve already has there
  assert.ok(Math.abs(keyframeDb(e.clips[0].keyframes, 5.9995) - before) < 1e-3);
});

test('razor splits fades between the two pieces; faders and curves', () => {
  const e = razor({ ...edit(), clips: [{ ...edit().clips[0], fade_in: 1, fade_out: 2 }] }, ['bg'], 5, ctx);
  assert.deepEqual([e.clips[0].fade_in, e.clips[0].fade_out, e.clips[1].fade_in, e.clips[1].fade_out], [1, 0, 0, 2]);
  assert.equal(faderToGain(-60), 0);
  assert.ok(Math.abs(faderToGain(gainToFader(0.5)) - 0.5) < 1e-9);
  const c = sampleCurve((t) => t, 0, 1, 10);
  assert.equal(c.length, 11);
  assert.ok(Math.abs(c[10] - 1) < 1e-6);
});
