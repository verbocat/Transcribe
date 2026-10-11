import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSuggestion, isRespelling } from './qcSafe.js';

test('a suggestion for only the last line keeps the first line', () => {
  const cur = 'टायसन? टायसन कौन है? मैं टायसन हूँ,\nलेकिन अब मैं एक ब्लैक बड़ा आदमी हूँ।';
  const out = safeSuggestion(cur, 'लेकिन अब मैं एक काले रंग का बड़ा आदमी हूँ।');
  assert.equal(out, 'टायसन? टायसन कौन है? मैं टायसन हूँ,\nलेकिन अब मैं एक काले रंग का बड़ा आदमी हूँ।');
});

test('a suggestion for one sentence of a one-line cue keeps the other sentences', () => {
  const cur = 'टायसन? टायसन कौन है? मैं टायसन हूँ, लेकिन अब मैं एक ब्लैक बड़ा आदमी हूँ। अच्छा।';
  const out = safeSuggestion(cur, 'लेकिन अब मैं एक काले रंग का बड़ा आदमी हूँ।');
  assert.ok(out.includes('टायसन? टायसन कौन है?'));
  assert.ok(out.includes('अच्छा'));
});

test('a full replacement is used as it is', () => {
  assert.equal(safeSuggestion('हम साथ रह रहे हैं। सुनो,', 'हम साथ रह रहे हैं। जानू,'), 'हम साथ रह रहे हैं। जानू,');
});

test('an unrelated short suggestion for a long cue is refused', () => {
  assert.equal(safeSuggestion('यह एक बहुत लंबा वाक्य है।\nऔर यह दूसरी पंक्ति है।', 'xyz'), null);
});

test('a one-word respelling is detected', () => {
  assert.equal(isRespelling('मैं हूँ, जैनीस।', 'मैं हूँ, जनिस।'), true);
  assert.equal(isRespelling('हम साथ रह रहे हैं। सुनो,', 'हम साथ रह रहे हैं। जानू,'), false);
});
