import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSession } from '../live-session.js';
import { makePuzzle } from '../model.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  let time = 0, serial = 0, current = true, reads = 0, cancelled = 0;
  const timers = new Map(), jobs = [], statuses = [], events = [];
  const puzzle = makePuzzle('latinsquare', 2); puzzle.cells = [1, null, null, null];
  const original = { puzzle, cellUncertain: [1], uncertain: [1], cageUncertain: [], markedCells: [0, 1],
    entries: [{ cell: 0, kind: 'value', text: '1', confidence: 99 }, { cell: 1, kind: 'value', text: '', confidence: 0 }],
    notes: ['Check the original'], rectified: { source: 'original' }, needsReview: true };
  const session = createLiveSession({ read: async () => { reads++; return original; },
    readCells: (sample, base, cells) => new Promise((resolve, reject) => jobs.push({ sample, base, cells, resolve, reject })),
    solve: async () => null, autoSolve: () => false, cancelRead() { cancelled++; }, cancelSolve() {},
    onChange() {}, onStatus: s => statuses.push(s), onEvent: e => events.push(e),
    sameScene: () => true, isCurrent: () => current, now: () => time,
    setTimer(fn, ms) { timers.set(++serial, { fn, at: time + ms }); return serial; }, clearTimer: id => timers.delete(id) });
  const observe = score => session.observe({ key: 'same', width: 100, height: 100, rows: 2, cols: 2,
    image: { width: 100, height: 100 }, corners: [{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}],
    sharpness: score, quality: { cellPixels: 40, cells: [{cell:1, score, contrast:100}] } });
  async function at(value) { time = value; for (const [id, job] of [...timers]) if (job.at <= time) { timers.delete(id); job.fn(); } await flush(); }
  session.start(); observe(20); observe(20); t.after(() => session.stop());
  const result = (value=2) => { const p=makePuzzle('latinsquare',2);p.cells[1]=value;
    return { puzzle:p, targetCells:[1], blackLayout:[], entries:[{cell:1,kind:'value',text:String(value),confidence:99,evidence:'new'}],ocrStats:{calls:3}}; };
  return { session, original, jobs, statuses, events, observe, at, result, timers,
    visible(v) { current=v;session.validate(); }, get reads(){return reads;}, get cancelled(){return cancelled;} };
}
for (const failure of ['reject','timeout']) test(`targeted ${failure} keeps original reading and releases only its own job`, async t => {
  const h=setup(t);await flush();await h.at(1600);h.observe(60);const job=h.jobs[0];
  const cancelled=h.cancelled;
  if(failure==='reject') { job.reject(Error('network stopped'));await flush(); }
  else { await h.at(91600);job.resolve(h.result());await flush(); }
  assert.equal(h.session.busy,false);assert.equal(h.session.preview.found,h.original);
  assert.deepEqual(h.session.preview.found.notes,['Check the original']);assert.equal(h.reads,1);
  assert.equal(h.cancelled,cancelled+1);assert.equal(job.sample.image,null);assert.equal(h.timers.size,0);
  assert.match(h.statuses.at(-1),/Keeping the previous reading/);
  assert.ok(h.events.some(e=>e.reason===(failure==='reject'?'retry-failed':'retry-timeout')));
});
test('zero-OCR skips do not exhaust either cell attempt; unchanged quality is throttled',async t=>{
  const h=setup(t);await flush();
  for(const [i,score] of [60,120].entries()){
    await h.at(1600+i*2000);h.observe(score);h.jobs[i].resolve({identicalCrops:true,ocrStats:{calls:0}});await flush();
    assert.equal(h.session.preview.found,h.original);
    await h.at(3400+i*2000);h.observe(score);assert.equal(h.jobs.length,i+1);
  }
  await h.at(8000);h.observe(200);assert.equal(h.jobs.length,3);h.jobs[2].resolve(h.result());await flush();
  assert.equal(h.session.preview.found.puzzle.cells[1],2);assert.equal(h.reads,1);
  assert.ok(h.session.preview.found.uncertain.includes(1));
});
test('empty zero-OCR retry cannot erase clues, source image or spend the read allowance',async t=>{
  const h=setup(t);await flush();await h.at(1600);h.observe(60);
  h.jobs[0].resolve({entries:[],ocrStats:{calls:0},rectified:{source:'empty'}});await flush();
  assert.equal(h.session.preview.found,h.original);assert.equal(h.events.at(-1).reason,'retry-skipped');
});
test('exhausted cells stop retries and request manual review rather than a better frame forever',async t=>{
  const h=setup(t);await flush();
  for(const [i,score] of [60,120].entries()){
    await h.at(2000+i*2000);h.observe(score);h.jobs[i].reject(Error('failed'));await flush();
  }
  await h.at(8000);h.observe(250);assert.equal(h.jobs.length,2);assert.equal(h.reads,1);
  assert.equal(h.events.at(-1).reason,'retry-exhausted');assert.match(h.statuses.at(-1),/Automatic retries finished/);
  assert.equal(h.session.preview.found,h.original);
});
test('a failed hidden retry cannot show a reading until the original scene is verified',async t=>{
  const h=setup(t);await flush();await h.at(1600);h.observe(60);h.visible(false);
  h.jobs[0].reject(Error('failed'));await flush();assert.equal(h.session.preview,null);
  h.visible(true);assert.equal(h.session.preview.found,h.original);
});
test('obsolete rejection cannot restore a reading after a new puzzle replaces it',async t=>{
  const h=setup(t);await flush();await h.at(1600);h.observe(60);h.session.invalidate();
  h.jobs[0].reject(Error('late failure'));await flush();assert.equal(h.session.preview,null);assert.equal(h.timers.size,0);
});
test('late timed-out result cannot overwrite a subsequent successful retry',async t=>{
  const h=setup(t);await flush();await h.at(1600);h.observe(60);await h.at(91600);
  await h.at(94000);h.observe(150);assert.equal(h.jobs.length,2);h.jobs[1].resolve(h.result(2));await flush();
  h.jobs[0].resolve(h.result(1));await flush();assert.equal(h.session.preview.found.puzzle.cells[1],2);
});
