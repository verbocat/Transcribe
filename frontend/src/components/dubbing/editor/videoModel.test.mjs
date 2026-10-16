import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionAt, videoClips, videoLayers, overlaysAt, cssFilter, setEffects, setTransition, applyDefaultTransition,
  addText, setText, subtitlesFromLines, overlayName, DEFAULT_TITLE,
} from './videoModel.js';
import { razor } from './editModel.js';

// Same case as PLAN_EDIT in backend/tests/test_dubbing_edit.py
const ctx = { duration: 10, lines: {} };
const plan = () => ({
  tracks: [{ id: 'T2', kind: 'overlay' }, { id: 'T1', kind: 'overlay' }, { id: 'V1', kind: 'video' }],
  clips: [
    { id: 'A', track: 'V1', source: 'media', start: 0, in: 0, out: 4 },
    { id: 'B', track: 'V1', source: 'media', start: 4, in: 6, out: 9, transition: { type: 'dissolve', duration: 2 } },
    { id: 'C', track: 'V1', source: 'media', start: 7, in: 0, out: 2, transition: { type: 'dip', duration: 1 } },
    { id: 'D', track: 'V1', source: 'media', start: 10, in: 5, out: 6, transition: { type: 'dissolve', duration: 1 } },
  ],
});

test('transitions are limited like the server limits them', () => {
  const clips = videoClips(plan());
  assert.deepEqual([1, 2, 3].map((i) => transitionAt(clips, i, ctx)?.duration ?? null), [2, 1, null]);
  const tight = [{ ...clips[0], out: 9.8 }, { ...clips[1], start: 9.8, in: 0.3 }];
  assert.equal(transitionAt(tight, 1, ctx).duration, 0.4);
});

test('layers through a dissolve, a dip and a gap', () => {
  const e = plan();
  const at = (T) => videoLayers(e, ctx, T).map((l) => [l.clip.id, +l.src.toFixed(3), +l.opacity.toFixed(3)]);
  assert.deepEqual(at(1), [['A', 1, 1]]);
  assert.deepEqual(at(3.5), [['A', 3.5, 1], ['B', 5.5, 0.25]]); // the second clip plays its head handle (before its in)
  assert.deepEqual(at(6.75), [['B', 8.75, 0.5]]);                // dipping to black
  assert.deepEqual(at(7.25), [['C', 0.25, 0.5]]);                // and up again
  assert.deepEqual(at(9.5), []);                                 // gap: black
  assert.deepEqual(at(10.5), [['D', 5.5, 1]]);
  const hidden = { ...e, tracks: e.tracks.map((t) => (t.id === 'V1' ? { ...t, mute: true } : t)) };
  assert.deepEqual(videoLayers(hidden, ctx, 1), []);
  const faded = { ...e, clips: e.clips.map((c) => (c.id === 'A' ? { ...c, fade_in: 2 } : c)) };
  assert.equal(videoLayers(faded, ctx, 0.5)[0].opacity, 0.25);
});

test('effects become CSS filters; transitions and effects are set and cleared; Ctrl+D finds the nearest cut', () => {
  assert.equal(cssFilter({ brightness: 1.2, contrast: 1, saturation: 0, blur: 0.01 }, 300), 'brightness(1.2) saturate(0) blur(3.00px)');
  assert.equal(cssFilter(undefined, 300), 'none');
  let e = setEffects(plan(), ['A'], { saturation: 0 });
  assert.equal(e.clips[0].effects.saturation, 0);
  e = setEffects(e, ['A'], { saturation: 1 });
  assert.equal(e.clips[0].effects, undefined);
  e = setTransition(e, 'B', null);
  assert.equal(e.clips[1].transition, undefined);
  const r = applyDefaultTransition(e, ctx, 4.6);
  assert.equal(r.cut, 4);
  assert.deepEqual(r.edit.clips[1].transition, { type: 'dissolve', duration: 1 });
  assert.ok(applyDefaultTransition({ ...e, clips: [e.clips[0]] }, ctx, 1).error);
  const cut = razor(plan(), ['B'], 5, ctx);
  assert.ok(cut.clips.find((c) => c.id === 'B').transition && !cut.clips.find((c) => c.start === 5).transition);
});

test('text clips: add, restyle (new picture name), overlays with fades, subtitles from the dub', () => {
  const dims = { width: 1280, height: 720 };
  let { edit: e, id, error } = addText(plan(), 1, dims);
  assert.equal(error, null);
  const first = e.clips.find((c) => c.id === id);
  assert.equal(first.image, overlayName('Title', DEFAULT_TITLE, dims));
  assert.ok(addText(e, 2, dims).error); // the Text track is busy at 2 s
  e = setText(e, [id], { text: 'नमस्ते', style: { color: '#ff0000' } }, dims);
  const changed = e.clips.find((c) => c.id === id);
  assert.notEqual(changed.image, first.image);
  assert.equal(changed.style.size, DEFAULT_TITLE.size);
  e = { ...e, clips: e.clips.map((c) => (c.id === id ? { ...c, fade_in: 1 } : c)) };
  assert.deepEqual(overlaysAt(e, 1.5).map((o) => [o.clip.id, o.alpha]), [[id, 0.5]]);
  assert.deepEqual(overlaysAt(e, 4.5), []);
  const lctx = { duration: 10, lines: { 1: { id: 1, text: 'मूल', translation: 'Hello', start: 1, end: 2, audio: { ready: true, duration: 1 } }, 2: { id: 2, text: 'x', translation: '', start: 3, end: 4, audio: { ready: true, duration: 1 } } } };
  const withLines = { ...e, tracks: [...e.tracks, { id: 'S:A' }], clips: [...e.clips, { id: 'L1', track: 'S:A', source: 'line', line: 1, start: 1, in: 0, out: null }, { id: 'L2', track: 'S:A', source: 'line', line: 2, start: 3, in: 0, out: null }] };
  const subs = subtitlesFromLines(withLines, lctx, dims).clips.filter((c) => c.track === 'T2');
  assert.deepEqual(subs.map((s) => [s.text, s.start, s.out]), [['Hello', 1, 1]]); // empty translations are skipped
  assert.equal(subtitlesFromLines(withLines, lctx, dims, { from: 'original' }).clips.filter((c) => c.track === 'T2').length, 2);
});
