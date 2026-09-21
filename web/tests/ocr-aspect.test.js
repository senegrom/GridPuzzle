import test from 'node:test';
import assert from 'node:assert/strict';
import { aspectEligible, aspectSamples, applyAspectReading } from '../ocr-aspect.js';
const clue = (overrides = {}) => ({ kind: 'value', w: 14, h: 44,
  text: '1', confidence: 0, ...overrides });
const pair = (text) => [1.5, 2].map((factor) =>
  ({ kind: 'aspect', factor, text, confidence: 95 }));

test('only bounded narrow numeric crops qualify', () => {
  assert.ok(aspectEligible(clue()));
  assert.ok(aspectEligible(clue({ kind: 'blackvalue' })));
  assert.ok(aspectEligible(clue({ glyphCount: 2, w: 40 })));
  for (const change of [{ w: 50 }, { h: 0 }, { w: NaN }, { w: -1 },
    { h: Infinity }, { glyphCount: 0 }, { recoveredMark: true }, { glyphCount: 4 }, { glyphCount: 1.5 }, { kind: 'label' }])
    assert.equal(aspectEligible(clue(change)), false);
});
test('two agreeing widths recover an uncertain digit but never promote confidence', () => {
  const entry = clue(); applyAspectReading(entry, pair('7'));
  assert.equal(entry.text, '7'); assert.equal(entry.confidence, 0);
  assert.equal(entry.aspectRecovered, true);
});
test('a confident ordinary reading is never overwritten', () => {
  const entry = clue({ confidence: 95 }); applyAspectReading(entry, pair('7'));
  assert.equal(entry.text, '1'); assert.equal(entry.confidence, 95);
});
test('missing, invalid, duplicate and disagreeing results cannot manufacture agreement', () => {
  for (const reads of [[], pair('7').slice(0, 1), [...pair('7'), pair('7')[0]],
    [pair('7')[0], pair('7')[0]], [pair('7')[0], pair('1')[1]],
    pair('x'), pair(''), pair('1111'), pair('1.0')]) {
    const entry = clue(); applyAspectReading(entry, reads);
    assert.equal(entry.text, '1'); assert.equal(entry.aspectRecovered, undefined);
  }
});
test('existing complete numbers cannot be lengthened or shortened', () => {
  for (const [old, next] of [['1', '11'], ['11', '1'], ['111', '11']]) {
    const entry = clue({ text: old }); applyAspectReading(entry, pair(next));
    assert.equal(entry.text, old);
  }
});
test('a known truncation can recover a complete number from two scales', () => {
  const entry = clue({ glyphCount: 2, w: 35 }); applyAspectReading(entry, pair('71'));
  assert.equal(entry.text, '71'); assert.equal(entry.confidence, 0);
});
test('touching digits do not force a longer reading down to a component count', () => {
  const entry = clue({ glyphCount: 2, text: '111', w: 35 });
  applyAspectReading(entry, pair('11')); assert.equal(entry.text, '111');
});
test('longer original OCR evidence blocks shortening by two transformed readings', () => {
  const entry = clue({ glyphCount: 2, w: 35 });
  applyAspectReading(entry, [{ kind: 'gray', text: '111' }, ...pair('11')]);
  assert.equal(entry.text, '1');
});
test('agreement with the existing value preserves all earlier review reasons', () => {
  const entry = clue({ recoveredMark: true }); applyAspectReading(entry, pair('1'));
  assert.equal(entry.confidence, 0); assert.equal(entry.recoveredMark, true);
  assert.equal(entry.aspectRecovered, undefined);
});
test('an unread crop can acquire a bounded numeric reading', () => {
  const entry = clue({ text: '' }); applyAspectReading(entry, pair('8'));
  assert.equal(entry.text, '8'); assert.equal(entry.confidence, 0);
});
test('sample generation widens the entire raster without mutating the source', (t) => {
  const previous = globalThis.document, calls = [];
  globalThis.document = { createElement() {
    const canvas = { toDataURL: () => 'encoded' };
    canvas.getContext = () => ({ fillRect() {}, drawImage(...args) { calls.push(args); } });
    return canvas;
  } };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const source = { width: 60, height: 96 };
  assert.deepEqual(aspectSamples(source), [{factor:1.5,png:'encoded'}, {factor:2,png:'encoded'}]);
  assert.deepEqual(calls, [[source,0,0,90,96],[source,0,0,120,96]]);
  assert.deepEqual(source, {width:60,height:96});
});
test('oversized and invalid samples allocate no canvases', () => {
  for (const source of [null, {}, {width: 0,height:96}, {width:513,height:96},
    {width:60,height:257}, {width:NaN,height:96}, {width:60.5,height:96}])
    assert.deepEqual(aspectSamples(source), []);
});

test('two low-scored readings do not justify overriding original evidence', () => {
  for (const confidence of [0, 74, NaN, Infinity, 101, undefined]) {
    const entry = clue(), proposals = pair('7'); proposals[0].confidence = confidence;
    applyAspectReading(entry, proposals); assert.equal(entry.text, '1');
  }
});
