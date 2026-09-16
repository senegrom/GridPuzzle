import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applyDigitVotes, digitSamples } from '../scanner.js';
const aspect = [{ factor: 1.5, png: 'wide15' }, { factor: 2, png: 'wide2' }];
const samples = (index = 0, extra = {}) => [
  { index, kind: 'binary', psm: '10', png: 'binary' },
  { index, kind: 'gray', psm: '10', png: 'gray', aspect, ...extra },
];
function host(read = (png) => ({ text: typeof png !== 'string' || png === 'gray' ? '' : png.startsWith('wide') ? '7' : '1', confidence: 95 })) {
  const messages = [], calls = []; let mode;
  const self = { Worker: class {}, location: { href: 'https://example.test/ocr-host-worker.js' },
    postMessage(m) { messages.push(m); }, close() {} };
  const worker = { async setParameters(p) { if (p.tessedit_pageseg_mode) mode = p.tessedit_pageseg_mode; },
    async recognize(png) { calls.push([mode, png]); return { data: await read(png, mode, self) }; },
    async terminate() {} };
  vm.runInNewContext(fs.readFileSync(new URL('../ocr-host-worker.js', import.meta.url), 'utf8'),
    { self, URL, Uint8Array, importScripts() { self.Tesseract = { createWorker: async () => worker }; } });
  return { calls, messages, async run(singles, id = 1) {
    await self.onmessage({ data: { id, keepAlive: true, png: new ArrayBuffer(0), singles } });
    return messages.find((m) => m.id === id && m.result && !m.type)?.result;
  } };
}

test('the host reads both widths in line mode and the final voter keeps them review-only', async () => {
  const h = host((png) => ({ text: typeof png !== 'string' || png === 'gray' ? '' : png.startsWith('wide') ? '7' : '1', confidence: 95 }));
  const result = await h.run(samples());
  assert.equal(result.retryCount, 3); assert.equal(result.ocrStats.aspectReads, 2);
  assert.deepEqual(h.calls.slice(-2), [['7','wide15'],['7','wide2']]);
  const entry = { kind: 'value', w: 14, h: 44, text: '', confidence: 0 };
  applyDigitVotes([entry], result.singles);
  assert.equal(entry.text, '7'); assert.equal(entry.confidence, 0); assert.equal(entry.aspectRecovered, true);
});
test('full-crop consensus never triggers speculative aspect retries', async () => {
  const h = host(() => ({ text: '1', confidence: 99 }));
  const r = await h.run(samples()); assert.equal(r.retryCount, 0); assert.equal(r.ocrStats.aspectReads, 0);
});
test('the original 24 ordinary retries retain priority over widened samples', async () => {
  const h = host((png) => ({ text: png === 'gray' ? '' : '1', confidence: 95 }));
  const r = await h.run(Array.from({length: 24},(_,i)=>samples(i)).flat());
  assert.equal(r.retryCount, 24); assert.equal(r.ocrStats.aspectReads, 0);
  assert.deepEqual(Array.from(r.singles.filter((s)=>s.kind==='retry'),(s)=>s.index), Array.from({length:24},(_,i)=>i));
});
test('one spare call cannot start a partial aspect pair', async () => {
  const h = host((png) => ({ text: png === 'gray' ? '' : '1', confidence: 95 }));
  const r = await h.run(Array.from({length: 23},(_,i)=>samples(i)).flat());
  assert.equal(r.retryCount, 23); assert.equal(r.ocrStats.aspectReads, 0);
});
test('original per-glyph retries also retain priority within the shared ceiling', async () => {
  const h = host((png) => ({ text: '1', confidence: 95 }));
  const r = await h.run(Array.from({length: 8},(_,i)=>samples(i,{segments:['left','right']})).flat());
  assert.equal(r.retryCount, 24); assert.equal(r.ocrStats.segmentReads, 16); assert.equal(r.ocrStats.aspectReads, 0);
});
test('malformed, duplicate and oversized variants never reach the engine', async () => {
  for (const variants of [[], [aspect[0]], [aspect[0],aspect[0]], [null,aspect[1]],
    [aspect[0],{factor:2,png:''}], [aspect[0],{factor:2,png:'x'.repeat(100001)}]]) {
    const h = host((png)=>({text:png==='gray'?'':'1',confidence:95}));
    const r=await h.run(samples(0,{aspect:variants}));
    assert.equal(r.retryCount,1);assert.equal(r.ocrStats.aspectReads,0);
  }
});
test('exact-image caches retain scale evidence but never stale cell indices', async () => {
  const h=host((png)=>({text:png==='gray'?'':'7',confidence:95}));
  await h.run(samples()); const before=h.calls.length;
  const r=await h.run(samples(12),2);
  assert.equal(h.calls.length,before+1);
  assert.ok(r.singles.filter((s)=>s.kind==='aspect').every((s)=>s.index===12));
  assert.equal(r.ocrStats.cacheHits,5);
});
test('cancelling the first width suppresses the second width and final result', async () => {
  const h=host(async(png,mode,self)=>{
    if(png==='wide15')await self.onmessage({data:{cancel:1}});
    return {text:png==='gray'?'':'7',confidence:95};
  });
  assert.equal(await h.run(samples()),undefined);
  assert.ok(h.messages.some((m)=>m.id===1&&m.cancelled));
  assert.ok(!h.calls.some(([,png])=>png==='wide2'));
});
test('aspect-only messages cannot outvote a confident original reading', () => {
  const entry={kind:'value',w:14,h:44,text:'1',confidence:99};
  applyDigitVotes([entry],[{index:0,kind:'binary',text:'1',confidence:99},
    {index:0,kind:'gray',text:'1',confidence:99},
    ...aspect.map(({factor})=>({index:0,kind:'aspect',factor,text:'7',confidence:99}))]);
  assert.equal(entry.text,'1');assert.equal(entry.confidence,99);
});
test('packing is bounded at 48 variants and large-board grayscale limits remain unchanged', (t) => {
  const old=globalThis.document;
  globalThis.document={createElement(){const c={toDataURL:()=> 'encoded'};c.getContext=()=>({
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){},fillRect(){},drawImage(){}});return c;}};
  t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old;});
  for(const count of [40,151]){
    const entries=Array.from({length:count},()=>({kind:'value',cell:0,x:40,y:28,w:14,h:44}));
    const result=digitSamples(entries,new Map(entries.map((_,i)=>[i,{width:24,height:54}])),new Uint8Array(10000).fill(255),100,100,100,100,1);
    assert.equal(result.reduce((n,s)=>n+(s.aspect?.length||0),0),count===40?48:0);
  }
});
