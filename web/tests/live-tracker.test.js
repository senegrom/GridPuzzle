import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createLiveTracker, ANCHOR_DEADLINE, VERIFY_DEADLINE, HANDSHAKE_WAIT, HANDSHAKE_LATE, PROBE, TRANSPORT_REASONS } from '../live-tracker.js';
import { createTrackingCore } from '../live-tracking-core.js';
import { gridAnchor, matchGrid } from '../live-registration.js';
const flush = () => new Promise(r => setImmediate(r));
// A promise that must have settled by now (its decision was made synchronously
// in what the test just did): a regression fails at once, not at the timeout.
const settled = promise => Promise.race([promise, flush().then(() => { throw Error('still pending'); })]);
// The next message of a real worker thread: a worker that never sends it fails
// the test here, not at its timeout (unharmed, one comes within a second).
const nextMessage = (thread, ms = 10000) => new Promise((resolve, reject) => {
  const on = data => { clearTimeout(timer); resolve(data); };
  const timer = setTimeout(() => { thread.off('message', on); reject(Error(`no message from the worker within ${ms} ms`)); }, ms);
  thread.once('message', on);
});
const image = (width=64,height=64) => ({width,height,data:new Uint8ClampedArray(width*height*4).fill(180)});
function harness() {
  const workers=[],timers=new Map();let serial=0;
  const tracker=createLiveTracker({makeWorker(){const worker={sent:[],postMessage(data,transfer){
    this.sent.push(structuredClone(data,{transfer}));},terminate(){this.terminated=true;}};workers.push(worker);return worker;},
    setTimer(fn){timers.set(++serial,fn);return serial;},clearTimer(id){timers.delete(id);}});
  const reply=(worker,result={proofs:{}})=>worker.onmessage({data:{id:worker.sent.at(-1).id,result,milliseconds:3}});
  return {tracker,workers,timers,reply};
}
test('only the latest unsent video frame survives; pixels are transferred, not reused',async()=>{
  const h=harness(),a=image();const first=h.tracker.verify({image:a,anchors:[]});assert.equal(a.data.byteLength,0);
  const second=h.tracker.verify({image:image(),anchors:[]});const cancelled=assert.rejects(second,{name:'AbortError'});
  const third=h.tracker.verify({image:image(),anchors:[]});await cancelled;
  assert.equal(h.tracker.stats.queuedFrames,1);assert.equal(h.workers[0].sent.length,1);
  h.reply(h.workers[0]);await first;assert.equal(h.workers[0].sent.length,2);h.reply(h.workers[0]);await third;
  assert.equal(h.tracker.stats.dropped,1);assert.equal(h.timers.size,0);h.tracker.reset();
});
test('anchor creation is bounded and runs before a queued video verification',async()=>{
  const h=harness(),one=h.tracker.verify({image:image(),anchors:[]}),next=h.tracker.verify({image:image(),anchors:[]});
  const anchor=h.tracker.anchor({image:image(),anchors:[]});h.reply(h.workers[0]);await one;
  assert.equal(h.workers[0].sent.at(-1).op,'anchor');h.reply(h.workers[0],{anchor:{id:1}});await anchor;
  assert.equal(h.workers[0].sent.at(-1).op,'verify');h.reply(h.workers[0]);await next;h.tracker.reset();
});
test('an anchor has its own, longer deadline; a verification keeps two seconds',()=>{
  const delays=[],tracker=createLiveTracker({makeWorker:()=>({postMessage(){},terminate(){}}),
    setTimer(_fn,ms){delays.push(ms);return delays.length;},clearTimer(){}});
  tracker.anchor({image:image(),anchors:[]}).catch(()=>{});tracker.reset();
  tracker.verify({image:image(),anchors:[]}).catch(()=>{});tracker.reset();
  assert.deepEqual(delays,[ANCHOR_DEADLINE,VERIFY_DEADLINE]);
  assert.equal(VERIFY_DEADLINE,2000);assert.ok(ANCHOR_DEADLINE>=10*VERIFY_DEADLINE,'about ten verifications per anchor');
});
test('stop rejects active and queued work and late old-worker replies cannot settle a restart',async()=>{
  const h=harness(),a=h.tracker.verify({image:image(),anchors:[]}),b=h.tracker.verify({image:image(),anchors:[]});
  const old=h.workers[0],late=old.onmessage;const ar=assert.rejects(a,{name:'AbortError'}),br=assert.rejects(b,{name:'AbortError'});
  h.tracker.reset();await Promise.all([ar,br]);assert.ok(old.terminated);assert.equal(h.timers.size,0);
  let settled=false;const current=h.tracker.verify({image:image(),anchors:[]}).then(()=>{settled=true;});
  late({data:{id:h.workers[1].sent[0].id,result:{proofs:{1:{corners:[]}}}}});await flush();assert.equal(settled,false);
  h.reply(h.workers[1]);await current;h.tracker.reset();
});
for(const failure of ['error','message','timeout','post'])test(`tracking ${failure} fails closed and can restart`,async()=>{
 const h=harness();if(failure==='post'){
  const warm=h.tracker.verify({image:image(),anchors:[]});h.reply(h.workers[0]);await warm;
  h.workers[0].postMessage=()=>{throw Error('post failed');};
 }
 const p=h.tracker.verify({image:image(),anchors:[]}),rejected=assert.rejects(p);
 const old=h.workers[0];
 if(failure==='error')old.onerror({message:'failed'});
 if(failure==='message')old.onmessageerror();
 if(failure==='timeout')[...h.timers.values()][0]();
 await rejected;assert.ok(old.terminated);assert.equal(h.tracker.stats.failures,1);
 const next=h.tracker.verify({image:image(),anchors:[]});h.reply(h.workers[1]);await next;h.tracker.reset();
});
test('worker anchor cache is bounded, protects retained anchors and returns no source rasters',()=>{
 const core=createTrackingCore(),corners=[{x:1,y:1},{x:62,y:1},{x:62,y:62},{x:1,y:62}];
 let original;
 for(let i=0;i<20;i++){
  const result=core.run({op:'anchor',image:image(),corners,rows:2,cols:2,anchors:original?[original]:[]});
  original??=result.anchor.id;assert.ok(core.size<=8);assert.equal(result.anchor.image,undefined);assert.equal(result.anchor.gray,undefined);
 }
 const result=core.run({op:'verify',image:image(),anchors:[original,999]});assert.ok(result.proofs[original]);assert.equal(result.proofs[999],null);
});
test('worker matcher preserves existing identity decisions for motion and changed ink',()=>{
 const w=400,h=400,base=image(w,h);base.data.fill(255);
 const paint=(img,x,y,ww,hh,v)=>{for(let yy=y;yy<y+hh;yy++)for(let xx=x;xx<x+ww;xx++)for(let k=0;k<3;k++)img.data[4*(yy*w+xx)+k]=v;};
 for(let i=0;i<=4;i++){paint(base,40+i*80,40,2,322,20);paint(base,40,40+i*80,322,2,20);}
 for(let r=0;r<4;r++)for(let c=0;c<4;c++){paint(base,65+c*80, sixty(r),5,35,20);paint(base,65+c*80,sixty(r),19,5,20);}
 function sixty(r){return 62+r*80;}
 const corners=[{x:40,y:40},{x:360,y:40},{x:360,y:360},{x:40,y:360}],core=createTrackingCore();
 const id=core.run({op:'anchor',image:base,corners,rows:4,cols:4,anchors:[]}).anchor.id,anchor=gridAnchor(base,corners,4,4);
 for(const changed of [false,true]){
  const next=image(w,h);next.data.fill(255);
  for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++)for(let k=0;k<4;k++)next.data[4*((y+1)*w+x+1)+k]=base.data[4*(y*w+x)+k];
  if(changed)paint(next,150,145,40,60,100);
  const direct=matchGrid(anchor,next),reply=core.run({op:'verify',image:next,anchors:[id]});
  assert.equal(!!reply.proofs[id],!!direct);assert.equal(!!direct,!changed);
 }
});
test('the actual tracking worker runs in a separate thread with transferred frames',async t=>{
 let thread;
 const url=new URL('../live-tracking-worker.js',import.meta.url).href;
 const tracker=createLiveTracker({makeWorker(){
  const script=`const {parentPort}=require('node:worker_threads');global.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`;
  thread=new NodeWorker(script,{eval:true});
  const host={postMessage:(data,transfer)=>thread.postMessage(data,transfer),terminate:()=>thread.terminate()};
  thread.on('message',data=>host.onmessage?.({data}));thread.on('error',error=>host.onerror?.(error));return host;
 }});t.after(()=>tracker.reset());
 const pixels=image(),corners=[{x:1,y:1},{x:62,y:1},{x:62,y:62},{x:1,y:62}];
 const created=await tracker.anchor({image:pixels,corners,rows:2,cols:2,anchors:[]});
 assert.equal(pixels.data.byteLength,0);assert.ok(thread.threadId>0);
 const verified=await tracker.verify({image:image(),anchors:[created.anchor.id]});assert.ok(verified.proofs[created.anchor.id]);
});

// The pixel transport (SPEC 4.4). A fake worker records what it is sent and
// what is transferred; fake bitmaps record close() and transfer (both detach
// them: width and height 0); the handshake's probe is a fake bitmap too.
// Timers are recorded with their delay and fired by it.
function transport({ probe = 'bitmap' } = {}) {
  const workers = [], timers = new Map(), bitmaps = [];
  let serial = 0, made = 0, clock = 0;
  const bitmap = (label = 'frame') => {
    const b = { label, width: 960, height: 1280, closed: false, transferred: false,
      close() { if (!this.transferred) this.closed = true; this.width = this.height = 0; } };
    bitmaps.push(b); return b;
  };
  const probes = { bitmap: () => Promise.resolve(bitmap('probe')), none: () => null,
    rejects: () => Promise.reject(Error('no bitmap')), throws: () => { throw Error('no canvas'); } };
  const tracker = createLiveTracker({
    makeWorker() {
      const worker = { sent: [], transfers: [], refuse: null, postMessage(data, transfer = []) {
        if (worker.refuse?.(data)) throw new DOMException('Not transferable', 'DataCloneError');
        for (const item of transfer) if (bitmaps.includes(item)) { item.transferred = true; item.width = item.height = 0; }
        else structuredClone(item, { transfer: [item] }); // detaches a pixel buffer
        worker.sent.push(data); worker.transfers.push(transfer);
      }, terminate() { worker.terminated = true; } };
      workers.push(worker); made++; return worker;
    },
    setTimer(fn, ms) { timers.set(++serial, { fn, ms }); return serial; }, clearTimer(id) { timers.delete(id); },
    probe: typeof probe === 'function' ? probe : probes[probe], now: () => clock,
  });
  const last = () => workers.at(-1);
  return { tracker, workers, timers, bitmaps, bitmap, last, answered: undefined,
    get made() { return made; }, tick(ms) { clock += ms; },
    started: (w = last()) => w.onmessage({ data: { started: true } }),
    // `answered`: the values of the latest answer to a probe.
    answer(pixels = [...PROBE], w = last()) { this.answered = pixels; w.onmessage({ data: { probe: { pixels } } }); },
    reply: (w = last(), extra = {}) => w.onmessage({ data: { id: w.sent.at(-1).id, result: { proofs: {} }, milliseconds: 3, transportMilliseconds: 7, ...extra } }),
    fire(ms) { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } },
    delays: () => [...timers.values()].map(t => t.ms).sort((a, b) => a - b),
    // The probe's handshake through to `decision`: "bitmap" answers it with
    // the probe's own values.
    async handshake() { const ready = tracker.ready(); await flush(); this.started(); this.answer(); return ready; },
    frame: (op = 'verify') => ({ bitmap: bitmap(), width: 960, height: 1280, anchors: [], ...(op === 'anchor' ? { corners: [], rows: 2, cols: 2 } : {}) }),
  };
}

test('the handshake transfers a probe bitmap once the worker has started and decides "bitmap" on its readback', async () => {
  const h = transport(), ready = h.tracker.ready();
  assert.equal(h.made, 1, 'ready() starts the worker');
  await flush();
  const [worker] = h.workers, [message] = worker.sent;
  assert.equal(message.op, 'probe'); assert.deepEqual(worker.transfers[0], [message.bitmap], 'transferred, not copied');
  assert.equal(message.bitmap.transferred, true);
  assert.equal(h.tracker.transport, null); assert.equal(h.tracker.stats.transport, null);
  assert.equal(h.tracker.stats.active, 1, 'the handshake is the worker\'s work');
  assert.deepEqual(h.delays(), [ANCHOR_DEADLINE], 'until the worker starts, only a start deadline runs');
  h.tick(40); h.started();
  assert.deepEqual(h.delays(), [HANDSHAKE_WAIT], 'the wait for the probe starts when the worker has started');
  h.tick(22); h.answer(PROBE.map((value, i) => i % 4 === 3 ? value : value + (i % 2 ? 2 : -2)), worker);
  assert.equal(await settled(ready), 'bitmap', 'every value within 2');
  assert.equal(h.tracker.transport, 'bitmap'); assert.equal(h.tracker.stats.transport, 'bitmap');
  assert.equal(h.tracker.stats.transportReason, 'probe'); assert.equal(h.tracker.stats.probePixels, null, 'values only on a mismatch');
  assert.equal(h.tracker.stats.handshakeMilliseconds, 22, 'from the worker\'s start to the answer');
  assert.equal(h.tracker.stats.active, 0); assert.equal(h.timers.size, 0);
  assert.equal(await h.tracker.ready(), 'bitmap', 'decided once per worker');
  assert.equal(worker.sent.length, 1, 'no second probe');
  assert.equal(h.tracker.stats.failures, 0);
  h.answer([...PROBE].fill(0), worker); assert.equal(h.tracker.transport, 'bitmap', 'a late second answer changes nothing');
  h.tracker.reset();
  assert.equal(h.tracker.stats.transportReason, null, 'a reset forgets why'); assert.equal(h.tracker.stats.handshakeMilliseconds, null);
});

for (const [name, setup, act, reason] of [
  ['a value off by 3', {}, async h => { h.started(); h.answer(PROBE.map((v, i) => i === 5 ? v + 3 : v)); }, 'mismatch'],
  // All sixteen values count, the alpha channel's too.
  ['an alpha value off by 3', {}, async h => { h.started(); h.answer(PROBE.map((v, i) => i === 7 ? v - 3 : v)); }, 'mismatch'],
  ['no pixels (no OffscreenCanvas or 2D context in the worker)', {}, async h => { h.started(); h.answer(null); }, 'no-pixels'],
  ['too few values', {}, async h => { h.started(); h.answer(PROBE.slice(1)); }, 'mismatch'],
  ['too many values (a readback of the wrong size)', {}, async h => { h.started(); h.answer([...PROBE, ...PROBE]); }, 'mismatch'],
  // The report keeps at most a 4 x 4 readback's values.
  ['a readback of 8 x 8 pixels', {}, async h => { h.started(); h.answer(Array.from({ length: 256 }, (_, i) => i)); }, 'mismatch'],
  ['a reply that cannot be received', {}, async h => { h.started(); h.last().onmessageerror(); }, 'unreadable'],
  ['a probe that cannot be transferred', { refuse: true }, async h => { assert.equal(h.bitmaps[0].closed, true, 'the probe bitmap is closed'); }, 'probe-failed'],
  ['no bitmap from this thread', { probe: 'none' }, async h => { assert.deepEqual(h.last().sent, [], 'nothing is probed'); h.started(); }, 'no-bitmaps'],
  ['a bitmap that cannot be made', { probe: 'rejects' }, async () => {}, 'probe-failed'],
  ['a canvas that cannot be made', { probe: 'throws' }, async () => {}, 'probe-failed'],
]) test(`the handshake decides "imagedata", with no failure counted, on ${name}`, async () => {
  const h = transport(setup), ready = h.tracker.ready();
  if (setup.refuse) h.last().refuse = data => data.op === 'probe';
  await flush();
  await act(h);
  assert.equal(await settled(ready), 'imagedata');
  assert.equal(h.tracker.stats.transportReason, reason, 'why, for the diagnostic report');
  assert.ok(TRANSPORT_REASONS.includes(reason));
  // On a mismatch the report gets the values read back, and nothing else.
  assert.deepEqual(h.tracker.stats.probePixels, reason === 'mismatch' ? h.answered.slice(0, 64) : null);
  assert.equal(h.tracker.stats.failures, 0); assert.equal(h.timers.size, 0, 'no handshake timer left');
  assert.equal(h.last().terminated, undefined, 'the worker is kept');
  // Its jobs carry the camera's own readback, transferred as before.
  const pixels = image(), done = h.tracker.verify({ image: pixels, anchors: [] });
  assert.equal(h.last().sent.at(-1).op, 'verify'); assert.equal(pixels.data.byteLength, 0);
  h.reply(); await done; h.tracker.reset();
  assert.equal(h.tracker.stats.transportReason, null); assert.equal(h.tracker.stats.probePixels, null, 'a reset forgets the values');
});

// A worker that has not answered its probe when a second wait ends on time,
// 600 ms after it started, may be stuck on it, and every job would wait behind
// the probe: it is replaced at once by a worker on the camera's own readback,
// without a probe. No failure counts. Its first wait that ends on time is
// renewed: a task that ended just before may hold the answer back.
test('a worker without an answer when its second wait ends on time, 600 ms after it started, is replaced at once by one on the camera\'s own readback', async () => {
  const h = transport(), ready = h.tracker.ready(); await flush();
  // However long its modules took to load: the wait runs from its start.
  h.tick(1000); h.started();
  assert.deepEqual(h.delays(), [HANDSHAKE_WAIT]);
  // On time: no later than HANDSHAKE_LATE after the wait's end.
  h.tick(HANDSHAKE_WAIT + HANDSHAKE_LATE); h.fire(HANDSHAKE_WAIT);
  assert.equal(h.workers.length, 1); assert.equal(h.workers[0].terminated, undefined, 'kept at its first wait');
  assert.deepEqual(h.delays(), [HANDSHAKE_WAIT], 'and waited for again'); assert.equal(h.tracker.transport, null);
  h.tick(HANDSHAKE_WAIT); h.fire(HANDSHAKE_WAIT);
  assert.equal(await settled(ready), 'imagedata', 'the waiters get the new worker\'s transport');
  assert.equal(h.tracker.stats.transportReason, 'timeout');
  assert.equal(h.tracker.stats.handshakeMilliseconds, null, 'the new worker has no handshake to time');
  assert.equal(h.workers.length, 2); assert.equal(h.workers[0].terminated, true, 'the stalled worker is ended');
  assert.deepEqual(h.workers[1].sent, [], 'the new worker gets no probe');
  assert.equal(h.tracker.stats.failures, 0); assert.equal(h.timers.size, 0);
  const pixels = image(), done = h.tracker.verify({ image: pixels, anchors: [] });
  assert.equal(h.workers[1].sent.at(-1).op, 'verify', 'jobs go to the new worker'); assert.equal(pixels.data.byteLength, 0);
  h.reply(); await done;
  // The stalled worker's handlers are detached: a late answer cannot reach the tracker.
  assert.equal(h.workers[0].onmessage, null); assert.equal(h.tracker.transport, 'imagedata');
  h.tracker.reset();
});

// A wait that ends late ran behind a long task on this thread, which the
// worker's answer may have waited for: Chromium hands a new worker its first
// message only once the page's task has ended, and WebKit runs the overdue
// timer before a reply that is already queued. Such a wait is renewed, from
// its late end, and the answer that comes then decides; a renewed wait that
// ends on time replaces a worker that still has not answered.
test('a wait that ends late, behind a long task, is renewed, and the answer after it decides "bitmap"', async () => {
  assert.equal(HANDSHAKE_LATE, 50, 'late: more than 50 ms after its end (LIVE_CAMERA.md)');
  const h = transport(), ready = h.tracker.ready(); await flush();
  h.started();
  h.tick(HANDSHAKE_WAIT + HANDSHAKE_LATE + 1); h.fire(HANDSHAKE_WAIT);
  assert.equal(h.workers.length, 1); assert.equal(h.workers[0].terminated, undefined, 'the worker is kept');
  assert.deepEqual(h.delays(), [HANDSHAKE_WAIT], 'and waited for again');
  assert.equal(h.tracker.transport, null); assert.equal(h.tracker.stats.active, 1, 'the handshake still runs');
  h.tick(HANDSHAKE_WAIT + 700); h.fire(HANDSHAKE_WAIT);
  assert.equal(h.workers.length, 1); assert.deepEqual(h.delays(), [HANDSHAKE_WAIT], 'again after another late end');
  h.tick(3); h.answer();
  assert.equal(await settled(ready), 'bitmap');
  assert.equal(h.tracker.stats.transportReason, 'probe');
  assert.equal(h.tracker.stats.handshakeMilliseconds, 2 * HANDSHAKE_WAIT + HANDSHAKE_LATE + 704, 'from the worker\'s start');
  assert.equal(h.tracker.stats.failures, 0); assert.equal(h.timers.size, 0);
  h.tracker.reset();
  // Renewed once late, then twice ending on time without an answer: replaced
  // at the second (the late renewal is no on-time end).
  const next = h.tracker.ready(); await flush();
  h.started(); h.tick(HANDSHAKE_WAIT + 400); h.fire(HANDSHAKE_WAIT);
  assert.equal(h.workers.length, 2, 'renewed');
  h.tick(HANDSHAKE_WAIT); h.fire(HANDSHAKE_WAIT);
  assert.equal(h.workers.length, 2, 'renewed at the first wait ending on time'); assert.deepEqual(h.delays(), [HANDSHAKE_WAIT]);
  h.tick(HANDSHAKE_WAIT); h.fire(HANDSHAKE_WAIT);
  assert.equal(await settled(next), 'imagedata'); assert.equal(h.tracker.stats.transportReason, 'timeout');
  assert.equal(h.workers.length, 3); assert.equal(h.workers[1].terminated, true); assert.deepEqual(h.workers[2].sent, []);
  assert.equal(h.tracker.stats.failures, 0);
  h.tracker.reset();
});

// A main-thread task that ends within HANDSHAKE_LATE after the wait's end
// holds the answer back as a longer one does (Chromium delivers a new
// worker's first OffscreenCanvas work only after it, WebKit runs the overdue
// timer before a reply already queued), but the timer counts as on time. The
// worker's first wait that ends on time is therefore renewed, and the answer
// that comes right after it decides; so does an answer after a renewal of a
// late wait in between. Each worker gets its own renewal.
test('a wait that ends on time with the answer right behind it is renewed, and the answer decides "bitmap"', async () => {
  for (const lateness of [0, 20, HANDSHAKE_LATE]) {
    const h = transport(), ready = h.tracker.ready(); await flush();
    h.started(); h.tick(HANDSHAKE_WAIT + lateness); h.fire(HANDSHAKE_WAIT);
    assert.equal(h.workers.length, 1, `kept, ${lateness} ms after the wait's end`); assert.equal(h.workers[0].terminated, undefined);
    assert.deepEqual(h.delays(), [HANDSHAKE_WAIT], 'and waited for again'); assert.equal(h.tracker.stats.active, 1);
    h.tick(1); h.answer();
    assert.equal(await settled(ready), 'bitmap'); assert.equal(h.tracker.stats.transportReason, 'probe');
    assert.equal(h.tracker.stats.handshakeMilliseconds, HANDSHAKE_WAIT + lateness + 1, 'from the worker\'s start');
    assert.equal(h.tracker.stats.failures, 0); assert.equal(h.timers.size, 0);
    // The next worker has a renewal of its own: kept at its first on-time
    // end too, after a late renewal in between, and replaced at its second.
    h.tracker.reset();
    const next = h.tracker.ready(); await flush();
    h.started(); h.tick(HANDSHAKE_WAIT); h.fire(HANDSHAKE_WAIT);
    assert.equal(h.workers.length, 2, 'the next worker is kept at its first on-time end');
    h.tick(HANDSHAKE_WAIT + HANDSHAKE_LATE + 1); h.fire(HANDSHAKE_WAIT);
    assert.equal(h.workers.length, 2, 'and at a late one');
    h.tick(HANDSHAKE_WAIT + lateness); h.fire(HANDSHAKE_WAIT);
    assert.equal(await settled(next), 'imagedata', 'replaced at its second on-time end');
    assert.equal(h.tracker.stats.transportReason, 'timeout'); assert.equal(h.workers.length, 3);
    assert.equal(h.workers[1].terminated, true); assert.deepEqual(h.workers[2].sent, [], 'its replacement gets no probe');
    assert.equal(h.tracker.stats.failures, 0); h.tracker.reset();
  }
});

// A page whose timers all fire late must not keep a worker that never answers:
// the renewals end ANCHOR_DEADLINE after the worker started.
test('a worker that never answers is replaced at the first wait ending ANCHOR_DEADLINE after its start, however late every wait ends', async () => {
  const h = transport(), ready = h.tracker.ready(); await flush();
  h.started();
  const late = HANDSHAKE_WAIT + 200;
  let elapsed = 0;
  for (;;) {
    h.tick(late); elapsed += late; h.fire(HANDSHAKE_WAIT);
    if (h.workers.length > 1) break;
    assert.ok(elapsed < ANCHOR_DEADLINE, `still waiting ${elapsed} ms after the worker started`);
    assert.deepEqual(h.delays(), [HANDSHAKE_WAIT]);
  }
  assert.equal(elapsed, Math.ceil(ANCHOR_DEADLINE / late) * late, 'at the first end at or past the bound');
  assert.equal(await settled(ready), 'imagedata'); assert.equal(h.tracker.stats.transportReason, 'timeout');
  assert.equal(h.workers[0].terminated, true); assert.deepEqual(h.workers[1].sent, [], 'its replacement gets no probe');
  assert.equal(h.tracker.stats.failures, 0); assert.equal(h.timers.size, 0);
  h.tracker.reset();
});

// A worker replaced for missing the wait gives bitmaps up only for itself:
// the worker after the next reset probes again.
test('after a worker was replaced for missing the wait, the worker after the next reset probes again', async () => {
  const h = transport(), ready = h.tracker.ready(); await flush();
  // Two waits that end on time.
  h.started(); h.fire(HANDSHAKE_WAIT); h.fire(HANDSHAKE_WAIT);
  assert.equal(await settled(ready), 'imagedata'); assert.equal(h.tracker.stats.transportReason, 'timeout');
  h.tracker.reset();
  assert.equal(await h.handshake(), 'bitmap', 'the next worker probes again');
  assert.equal(h.workers.length, 3); assert.equal(h.workers[2].sent[0].op, 'probe');
  assert.equal(h.tracker.stats.transportReason, 'probe'); assert.equal(h.tracker.stats.failures, 0);
  h.tracker.reset();
});

// The second worker replaced for missing the wait in the tracker's life, with
// a worker whose handshake decided in between, gives bitmaps up: no later
// worker probes, and each says why.
test('a second worker replaced for missing the wait gives bitmaps up for the tracker\'s life', async () => {
  const h = transport(), timeout = async () => {
    const ready = h.tracker.ready(); await flush();
    assert.equal(h.last().sent[0]?.op, 'probe', 'probed');
    h.started(); h.fire(HANDSHAKE_WAIT); h.fire(HANDSHAKE_WAIT);
    assert.equal(await settled(ready), 'imagedata'); assert.equal(h.tracker.stats.transportReason, 'timeout');
    assert.deepEqual(h.last().sent, [], 'its replacement gets no probe');
    h.tracker.reset();
  };
  await timeout();
  assert.equal(await h.handshake(), 'bitmap'); h.tracker.reset();
  await timeout();
  for (let i = 0; i < 2; i++) {
    assert.equal(await settled(h.tracker.ready()), 'imagedata', 'no later worker probes');
    assert.deepEqual(h.last().sent, []);
    assert.equal(h.tracker.stats.transportReason, 'timeout', 'and it says why');
    assert.equal(h.tracker.stats.handshakeMilliseconds, null);
    h.tracker.reset();
  }
  assert.equal(h.workers.length, 7); assert.equal(h.tracker.stats.failures, 0);
});

test('a worker that never starts fails as its first anchor would have, counted', async () => {
  const h = transport(), ready = h.tracker.ready(); await flush();
  const failed = assert.rejects(ready, /timed out/);
  h.fire(ANCHOR_DEADLINE); await failed;
  assert.equal(h.tracker.stats.failures, 1); assert.equal(h.workers[0].terminated, true);
});

test('jobs wait for the handshake, which dispatches them; a job of the other transport is retired', async () => {
  const h = transport(), ready = h.tracker.ready(); await flush();
  const anchorJob = h.frame('anchor'), verifyJob = h.frame();
  const anchored = h.tracker.anchor(anchorJob), verified = h.tracker.verify(verifyJob);
  assert.deepEqual(h.last().sent.map(m => m.op), ['probe'], 'nothing but the probe before the decision');
  assert.equal(h.tracker.stats.queuedAnchors + h.tracker.stats.queuedFrames, 2);
  h.started(); h.answer(); await ready;
  assert.deepEqual(h.last().sent.map(m => m.op), ['probe', 'anchor'], 'the anchor first, as before');
  assert.deepEqual(h.last().transfers.at(-1), [h.last().sent.at(-1).bitmap], 'its bitmap transferred');
  h.reply(); await anchored; h.reply(); await verified;
  assert.equal(anchorJob.bitmap.transferred && verifyJob.bitmap.transferred, true);
  // A frame read back for an "imagedata" worker that was replaced meanwhile.
  const stray = h.tracker.verify({ image: image(), anchors: [] });
  await assert.rejects(settled(stray), { name: 'AbortError' });
  assert.equal(h.last().sent.at(-1).op, 'verify', 'not posted'); assert.equal(h.last().sent.length, 3);
  assert.equal(h.tracker.stats.failures, 0); h.tracker.reset();
});

test('a bitmap job for an "imagedata" worker is retired and its bitmap closed', async () => {
  const h = transport({ probe: 'none' });
  assert.equal(await h.tracker.ready(), 'imagedata');
  const job = h.frame(), stray = h.tracker.verify(job);
  await assert.rejects(settled(stray), { name: 'AbortError' });
  assert.equal(job.bitmap.closed, true); assert.deepEqual(h.last().sent, []);
  h.tracker.reset();
});

test('a reset during the handshake rejects every waiter, and a probe bitmap made after it is closed', async () => {
  let resolveProbe;
  const h = transport({ probe: () => new Promise(resolve => { resolveProbe = resolve; }) });
  const first = h.tracker.ready(), second = h.tracker.ready();
  assert.equal(h.tracker.stats.active, 1, 'the handshake is the worker\'s work');
  const rejected = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
  h.tracker.reset(); await rejected;
  assert.equal(h.workers[0].terminated, true); assert.equal(h.timers.size, 0);
  // No worker, no handshake: nothing in progress (the export after a freeze).
  assert.equal(h.tracker.stats.active, 0);
  const late = h.bitmap('probe'); resolveProbe(late); await flush();
  assert.equal(late.closed, true, 'closed, not posted'); assert.deepEqual(h.workers[0].sent, []);
  // The next ready() starts a new worker with its own handshake.
  const again = h.tracker.ready(); await flush();
  assert.equal(h.workers.length, 2);
  h.started(); h.answer(); assert.equal(await again, 'bitmap'); h.tracker.reset();
});

// The camera's continuation of a reply runs before the next job goes out. A
// reply whose render freezes the view resets the tracker there (the freeze),
// so the queued frame's bitmap is closed here rather than posted to the
// worker the reset ends: WebKit (from iOS 18) keeps a bitmap posted to an
// ended worker that had not started its message in the GPU process.
test('a reply whose continuation resets the tracker closes the queued bitmap instead of posting it to the ended worker', async () => {
  const h = transport(); await h.handshake();
  const sent = h.frame(), queued = h.frame();
  const first = h.tracker.verify(sent), next = h.tracker.verify(queued);
  const frozen = first.then(() => h.tracker.reset()), retired = assert.rejects(next, { name: 'AbortError' });
  h.reply(); await frozen; await retired;
  assert.equal(queued.bitmap.closed, true, 'closed on this thread'); assert.equal(queued.bitmap.transferred, false);
  assert.deepEqual(h.workers[0].sent.map(m => m.op), ['probe', 'verify'], 'only the replied frame was posted');
  // Without such a reset the queued job goes out right after the continuation.
  await h.handshake();
  const a = h.tracker.verify(h.frame()), b = h.frame(), queuedNext = h.tracker.verify(b);
  let posted = null; const seen = a.then(() => { posted = h.last().sent.length; });
  h.reply(); await seen; await flush();
  assert.equal(posted, 2, 'not yet posted in the continuation'); assert.equal(h.last().sent.length, 3, 'posted after it');
  assert.equal(b.bitmap.transferred, true); h.reply(); await queuedNext; h.tracker.reset();
});

test('every bitmap handed over is transferred or closed: a replaced queued frame, a reset, a failed post', async () => {
  const h = transport(); await h.handshake();
  const active = h.frame(), queued = h.frame(), newer = h.frame();
  const a = h.tracker.verify(active), b = h.tracker.verify(queued), c = h.tracker.verify(newer);
  await assert.rejects(b, { name: 'AbortError' });
  assert.equal(queued.bitmap.closed, true, 'the replaced queued frame'); assert.equal(h.tracker.stats.dropped, 1);
  assert.equal(active.bitmap.transferred, true);
  const resetting = Promise.all([assert.rejects(a, { name: 'AbortError' }), assert.rejects(c, { name: 'AbortError' })]);
  h.tracker.reset(); await resetting;
  assert.equal(newer.bitmap.closed, true, 'the queued frame at a reset');
  assert.equal(active.bitmap.closed, false, 'a transferred one is not closed here (the worker closes it)');
  assert.ok(h.bitmaps.every(b => b.closed || b.transferred), JSON.stringify(h.bitmaps.map(b => [b.label, b.closed, b.transferred])));
});

for (const [name, provoke, cause] of [
  ['replies "bitmap-unsupported"', h => h.reply(h.last(), { result: undefined, error: 'bitmap-unsupported' }), 'refused'],
  ['never answers the first bitmap job', h => h.fire(ANCHOR_DEADLINE), 'unanswered'],
  ['sends a reply that cannot be received before a bitmap job completed', h => h.last().onmessageerror(), 'unanswered'],
]) test(`bitmaps are given up, without a failure, when the worker ${name}`, async () => {
  const h = transport(); await h.handshake();
  const job = h.frame('anchor'), queued = h.frame(), anchored = h.tracker.anchor(job), verified = h.tracker.verify(queued);
  const both = Promise.all([assert.rejects(anchored, { name: 'NotSupportedError' }), assert.rejects(verified, { name: 'NotSupportedError' })]);
  provoke(h);
  await both;
  assert.equal(h.tracker.stats.failures, 0, 'not a tracking failure');
  assert.equal(h.workers[0].terminated, true);
  assert.ok(job.bitmap.closed || job.bitmap.transferred); assert.equal(queued.bitmap.closed, true);
  // Every later worker uses the ImageData transport, without a probe, and
  // says why.
  assert.equal(await settled(h.tracker.ready()), 'imagedata');
  assert.equal(h.workers.length, 2); assert.deepEqual(h.workers[1].sent, []);
  assert.equal(h.tracker.stats.transportReason, cause); assert.equal(h.tracker.stats.handshakeMilliseconds, null, 'no handshake ran');
  const later = h.frame(), retired = h.tracker.verify(later);
  await assert.rejects(settled(retired), { name: 'AbortError' }); assert.equal(later.bitmap.closed, true, 'a bitmap prepared before is closed');
  h.tracker.reset();
});

// SPEC 4.4.3: also after bitmap jobs of the worker have completed.
for (const completed of [false, true]) test(`a bitmap that cannot be transferred (DataCloneError) is closed and gives bitmaps up, without a failure${completed ? ', also after bitmap jobs completed' : ''}`, async () => {
  const h = transport(); await h.handshake();
  if (completed) { const first = h.tracker.anchor(h.frame('anchor')); h.reply(); await first; }
  h.last().refuse = data => !!data.bitmap;
  const job = h.frame(completed ? 'verify' : 'anchor'), sent = completed ? h.tracker.verify(job) : h.tracker.anchor(job);
  await assert.rejects(sent, { name: 'NotSupportedError' });
  assert.equal(job.bitmap.closed, true); assert.equal(h.tracker.stats.failures, 0);
  assert.equal(h.workers[0].terminated, true); assert.equal(await settled(h.tracker.ready()), 'imagedata');
  assert.equal(h.tracker.stats.transportReason, 'untransferable');
  h.tracker.reset();
});

test('once a bitmap job has completed, a deadline or an unreadable reply counts as a failure, as before', async () => {
  // The completed job may be an anchor or a verification: a worker that died
  // idle failed no job, so the camera's next verification can be the first
  // job a new worker completes.
  for (const op of ['anchor', 'verify']) for (const provoke of [h => h.fire(VERIFY_DEADLINE), h => h.last().onmessageerror()]) {
    const h = transport(); await h.handshake();
    const first = op === 'anchor' ? h.tracker.anchor(h.frame('anchor')) : h.tracker.verify(h.frame()); h.reply(); await first;
    const late = h.tracker.verify(h.frame()), failed = assert.rejects(late, error => error.name !== 'NotSupportedError');
    provoke(h); await failed;
    assert.equal(h.tracker.stats.failures, 1);
    // Bitmaps stay: the next worker probes again.
    h.tracker.ready().catch(() => {}); await flush(); assert.equal(h.last().sent[0]?.op, 'probe'); h.tracker.reset();
  }
});

test('"bitmap-unsupported" from a job of the camera\'s own readback is an ordinary failure', async () => {
  const h = transport({ probe: 'none' }); await h.tracker.ready();
  const job = h.tracker.verify({ image: image(), anchors: [] }), failed = assert.rejects(job, /bitmap-unsupported/);
  h.reply(h.last(), { result: undefined, error: 'bitmap-unsupported' }); await failed;
  assert.equal(h.tracker.stats.failures, 1);
});

test('the camera\'s own bitmap failure gives bitmaps up and resets', async () => {
  const h = transport(); await h.handshake();
  const sent = h.frame(), queued = h.frame(), active = h.tracker.verify(sent), waiting = h.tracker.verify(queued);
  const both = Promise.all([assert.rejects(active, { name: 'NotSupportedError' }), assert.rejects(waiting, { name: 'NotSupportedError' })]);
  const error = h.tracker.bitmapFailed();
  assert.equal(error.name, 'NotSupportedError', 'the error the camera throws');
  await both;
  assert.equal(queued.bitmap.closed, true); assert.equal(sent.bitmap.transferred, true);
  assert.equal(h.tracker.stats.failures, 0); assert.equal(await settled(h.tracker.ready()), 'imagedata');
  assert.equal(h.tracker.stats.transportReason, 'unmade');
  h.tracker.reset();
});

test('the worker reports the tracking core\'s time and the transport\'s apart; only the core\'s is "milliseconds"', async () => {
  const h = transport();
  // Before any job completed both are zero, not missing.
  assert.equal(h.tracker.stats.milliseconds, 0); assert.equal(h.tracker.stats.transportMilliseconds, 0);
  await h.handshake();
  const job = h.tracker.verify(h.frame()); h.reply(h.last(), { milliseconds: 12.5, transportMilliseconds: 31 }); await job;
  assert.equal(h.tracker.stats.milliseconds, 12.5); assert.equal(h.tracker.stats.transportMilliseconds, 31);
  const next = h.tracker.verify(h.frame()); h.reply(h.last(), { milliseconds: -1, transportMilliseconds: 'x' }); await next;
  assert.equal(h.tracker.stats.milliseconds, 0); assert.equal(h.tracker.stats.transportMilliseconds, 0);
  h.tracker.reset();
});

test('the actual tracking worker announces its start, and without OffscreenCanvas answers the probe with no pixels', async t => {
  const url = new URL('../live-tracking-worker.js', import.meta.url).href;
  const script = `const {parentPort}=require('node:worker_threads');global.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`;
  const thread = new NodeWorker(script, { eval: true }), messages = [];
  t.after(() => thread.terminate());
  const next = () => nextMessage(thread).then(data => { messages.push(data); return data; });
  assert.deepEqual(await next(), { started: true });
  thread.postMessage({ op: 'probe', bitmap: { width: 2, height: 2 } });
  assert.deepEqual(await next(), { probe: { pixels: null } });
  thread.postMessage({ op: 'verify', id: 4, bitmap: { width: 64, height: 64 }, width: 64, height: 64, anchors: [] });
  assert.deepEqual(await next(), { id: 4, error: 'bitmap-unsupported' });
  // A bitmap that arrived as null (WebKit from iOS 18, when it could not move
  // the bitmap to the worker) is a bitmap that cannot be read back, not a
  // frame without pixels for the tracking core.
  thread.postMessage({ op: 'verify', id: 6, bitmap: null, width: 64, height: 64, anchors: [] });
  assert.deepEqual(await next(), { id: 6, error: 'bitmap-unsupported' });
  const pixels = image();
  thread.postMessage({ op: 'verify', id: 5, image: pixels, anchors: [] }, [pixels.data.buffer]);
  const reply = await next();
  assert.equal(reply.id, 5); assert.deepEqual(reply.result.proofs, {});
  assert.ok(reply.milliseconds >= 0 && reply.transportMilliseconds >= 0);
});

test('the default probe is a bitmap of a 2 x 2 page canvas holding PROBE; without createImageBitmap or a page there is none', async () => {
  const saved = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  const sent = [], made = [], canvases = [];
  const worker = () => ({ postMessage(data, transfer) { sent.push({ data, transfer }); }, terminate() {} });
  try {
    globalThis.document = { createElement(tag) {
      const canvas = { tag, width: 300, height: 150, getContext: (type) => ({ type,
        createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
        putImageData(image, x, y) { canvas.put = { data: [...image.data], width: image.width, height: image.height, x, y }; } }) };
      canvases.push(canvas); return canvas;
    } };
    delete globalThis.createImageBitmap;
    assert.equal(await createLiveTracker({ makeWorker: worker, setTimer: () => 1, clearTimer() {} }).ready(), 'imagedata', 'no createImageBitmap');
    assert.equal(canvases.length, 0); assert.deepEqual(sent, []);
    globalThis.createImageBitmap = async (source) => { const bitmap = { source, close() {} }; made.push(bitmap); return bitmap; };
    const tracker = createLiveTracker({ makeWorker: worker, setTimer: () => 1, clearTimer() {} });
    tracker.ready().catch(() => {}); await flush();
    assert.equal(canvases.length, 1); assert.equal(canvases[0].tag, 'canvas'); assert.deepEqual([canvases[0].width, canvases[0].height], [2, 2]);
    assert.deepEqual(canvases[0].put, { data: [...PROBE], width: 2, height: 2, x: 0, y: 0 }, 'the four colours, exactly');
    assert.equal(made.length, 1); assert.equal(made[0].source, canvases[0]);
    assert.deepEqual(sent.map(s => s.data.op), ['probe']); assert.equal(sent[0].data.bitmap, made[0]); assert.deepEqual(sent[0].transfer, [made[0]]);
    tracker.reset();
    delete globalThis.document;
    assert.equal(await createLiveTracker({ makeWorker: worker, setTimer: () => 1, clearTimer() {} }).ready(), 'imagedata', 'no page (a worker, or Node)');
    assert.equal(made.length, 1); assert.equal(sent.length, 1);
    globalThis.document = { createElement: () => ({ getContext: () => null }) };
    assert.equal(await createLiveTracker({ makeWorker: worker, setTimer: () => 1, clearTimer() {} }).ready(), 'imagedata', 'no 2D context');
    assert.equal(made.length, 1); assert.equal(sent.length, 1);
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.createImageBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = saved.createImageBitmap;
  }
});

test('a probe bitmap made after the handshake ran out is closed, not posted', async () => {
  let resolveProbe;
  const h = transport({ probe: () => new Promise(resolve => { resolveProbe = resolve; }) });
  const ready = h.tracker.ready(); h.started(); h.fire(HANDSHAKE_WAIT); h.fire(HANDSHAKE_WAIT);
  assert.equal(await settled(ready), 'imagedata');
  const late = h.bitmap('probe'); resolveProbe(late); await flush();
  assert.equal(late.closed, true); assert.deepEqual(h.last().sent, []);
  h.tracker.reset();
});

// A worker whose answer could not be received is decided "imagedata" while
// its probe is still being made, and kept: the probe made after the decision
// is closed, not posted to it.
test('a probe bitmap made after an unreadable answer decided the handshake is closed, not posted to the kept worker', async () => {
  let resolveProbe;
  const h = transport({ probe: () => new Promise(resolve => { resolveProbe = resolve; }) });
  const ready = h.tracker.ready(); h.started(); h.last().onmessageerror();
  assert.equal(await settled(ready), 'imagedata'); assert.equal(h.tracker.stats.transportReason, 'unreadable');
  const late = h.bitmap('probe'); resolveProbe(late); await flush();
  assert.equal(late.closed, true); assert.deepEqual(h.workers[0].sent, [], 'nothing posted to the worker');
  assert.equal(h.workers.length, 1, 'the worker is kept');
  h.tracker.reset();
});

test('the probe of a replaced worker that fails later decides nothing for the next worker', async () => {
  const failures = [];
  const h = transport({ probe: () => new Promise((_resolve, reject) => failures.push(reject)) });
  h.tracker.ready().catch(() => {}); h.tracker.reset();
  const ready = h.tracker.ready();
  failures[0](Error('late')); await flush();
  assert.equal(h.tracker.transport, null, 'the new worker is still undecided');
  assert.equal(h.tracker.stats.active, 1);
  const rejected = assert.rejects(ready, { name: 'AbortError' }); h.tracker.reset(); await rejected;
});

test('a retired job of the other transport does not hold up the next job', async () => {
  const h = transport(), ready = h.tracker.ready(); await flush();
  // An anchor read back for an "imagedata" worker, then a bitmap frame.
  const stray = h.tracker.anchor({ image: image(), corners: [], rows: 2, cols: 2, anchors: [] }), job = h.frame(), verified = h.tracker.verify(job);
  h.started(); h.answer(); await ready;
  await assert.rejects(settled(stray), { name: 'AbortError' });
  assert.deepEqual(h.last().sent.map(m => m.op), ['probe', 'verify'], 'the frame is posted at once');
  h.reply(); await verified; h.tracker.reset();
});

test('a replaced queued anchor\'s bitmap is closed', async () => {
  const h = transport(); await h.handshake();
  const first = h.frame('anchor'), queued = h.frame('anchor'), newer = h.frame('anchor');
  const a = h.tracker.anchor(first), b = h.tracker.anchor(queued), c = h.tracker.anchor(newer);
  await assert.rejects(b, { name: 'AbortError' });
  assert.equal(queued.bitmap.closed, true); assert.equal(first.bitmap.transferred, true); assert.equal(newer.bitmap.closed, false);
  h.reply(); await a; h.reply(); await c;
  assert.equal(newer.bitmap.transferred, true); h.tracker.reset();
});

test('a reset forgets the transport and whether a bitmap job completed', async () => {
  const h = transport(); await h.handshake();
  const first = h.tracker.anchor(h.frame('anchor')); h.reply(); await first;
  h.tracker.reset();
  assert.equal(h.tracker.transport, null); assert.equal(h.tracker.stats.transport, null);
  assert.equal(await h.handshake(), 'bitmap', 'the next worker probes again');
  // Its first bitmap job never answers: bitmaps are given up, which a job
  // completed on the first worker does not prevent.
  const job = h.tracker.anchor(h.frame('anchor')), given = assert.rejects(job, { name: 'NotSupportedError' });
  h.fire(ANCHOR_DEADLINE); await given;
  assert.equal(h.tracker.stats.failures, 0);
});

test('a worker that cannot be made rejects ready() and counts a failure, as a job would', async () => {
  const tracker = createLiveTracker({ makeWorker() { throw Error('no workers here'); }, setTimer: () => 1, clearTimer() {} });
  await assert.rejects(tracker.ready(), /no workers here/);
  assert.equal(tracker.stats.failures, 1); assert.equal(tracker.transport, null);
  // A job reaches the same path when the tracker was reset between the
  // camera's ready() and its submit: each fails, counted, and none stays queued.
  await assert.rejects(tracker.verify({ image: image(), anchors: [] }), /no workers here/);
  assert.equal(tracker.stats.failures, 2); assert.equal(tracker.stats.queuedFrames, 0);
  await assert.rejects(tracker.anchor({ image: image(), corners: [], rows: 2, cols: 2, anchors: [] }), /no workers here/);
  assert.equal(tracker.stats.failures, 3); assert.equal(tracker.stats.queuedAnchors, 0);
});

test('the actual tracking worker draws a transferred bitmap and reads it back, timing that apart from the tracking core', async t => {
  const url = new URL('../live-tracking-worker.js', import.meta.url).href;
  // A stand-in OffscreenCanvas: drawing takes the "bitmap"'s own pixels (a
  // plain object carrying them) and `wait` ms; reading back returns them. The
  // thread's clock moves only while the stand-in draws (nothing else the
  // worker loads reads a clock), so the two times are exact, however busy the
  // host: the core's is 0, the transport's the draw's `wait`.
  const script = `const {parentPort}=require('node:worker_threads');
let clock=0;Object.defineProperty(globalThis,'performance',{value:{now:()=>clock},configurable:true,writable:true});
class OffscreenCanvas{constructor(w,h){this.width=w;this.height=h;}getContext(){const c=this;return{clearRect(){},
drawImage(b,x,y,w,h){clock+=b.wait||0;c.drawn=[x,y,w,h];c.pixels=b.pixels;},
getImageData(x,y,w,h){return{width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>c.pixels[i]??0)};}};}}
global.OffscreenCanvas=OffscreenCanvas;global.self={postMessage:m=>parentPort.postMessage(m)};
import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`;
  const thread = new NodeWorker(script, { eval: true });
  t.after(() => thread.terminate());
  const next = () => nextMessage(thread);
  assert.deepEqual(await next(), { started: true });
  thread.postMessage({ op: 'probe', bitmap: { pixels: [...PROBE], width: 2, height: 2 } });
  assert.deepEqual(await next(), { probe: { pixels: [...PROBE] } }, 'the probe read back as drawn');
  // A camera snapshot is opaque.
  const frame = image(64, 64), corners = [{ x: 1, y: 1 }, { x: 62, y: 1 }, { x: 62, y: 62 }, { x: 1, y: 62 }];
  for (let i = 3; i < frame.data.length; i += 4) frame.data[i] = 255;
  thread.postMessage({ op: 'anchor', id: 7, bitmap: { pixels: [...frame.data], wait: 80, width: 64, height: 64 }, width: 64, height: 64, corners, rows: 2, cols: 2, anchors: [] });
  const anchored = await next();
  assert.equal(anchored.id, 7); assert.ok(anchored.result.anchor.id > 0, 'tracked on the pixels read back');
  assert.equal(anchored.transportMilliseconds, 80, 'the draw and readback');
  assert.equal(anchored.milliseconds, 0, 'the tracking core alone');
  thread.postMessage({ op: 'verify', id: 8, bitmap: { pixels: [...frame.data], width: 64, height: 64 }, width: 64, height: 64, anchors: [anchored.result.anchor.id] });
  const verified = await next();
  assert.ok(verified.result.proofs[anchored.result.anchor.id], 'the same frame verifies');
  // A bitmap of the right size that draws nothing leaves the canvas
  // transparent: it is answered as unreadable, not tracked as a blank frame.
  thread.postMessage({ op: 'verify', id: 9, bitmap: { pixels: [], width: 64, height: 64 }, width: 64, height: 64, anchors: [anchored.result.anchor.id] });
  assert.deepEqual(await next(), { id: 9, error: 'bitmap-unsupported' });
});

// A worker that dies (its error event) while its first bitmap job is in it
// gives bitmaps up, as one that never answers that job does: a bitmap that
// crashes the worker would crash every worker, each counted, until tracking
// paused. The queued frame's bitmap is closed, the active one went to the
// worker, and the next worker uses the camera's own readback without a probe.
test('a worker that dies during its first bitmap job gives bitmaps up, without a failure, and closes the queued bitmap', async () => {
  const h = transport(); await h.handshake();
  const active = h.frame('anchor'), queued = h.frame();
  const anchored = h.tracker.anchor(active), verified = h.tracker.verify(queued);
  const both = Promise.all([assert.rejects(anchored, { name: 'NotSupportedError' }), assert.rejects(verified, { name: 'NotSupportedError' })]);
  h.last().onerror({ message: 'worker crashed' });
  await both;
  assert.equal(h.tracker.stats.failures, 0, 'no tracking failure');
  assert.equal(h.workers[0].terminated, true); assert.equal(h.timers.size, 0, 'no deadline left');
  assert.equal(queued.bitmap.closed, true, "the queued frame's bitmap is closed");
  assert.equal(active.bitmap.closed, false, 'the transferred one went with the worker');
  assert.equal(await settled(h.tracker.ready()), 'imagedata'); assert.deepEqual(h.workers[1].sent, [], 'no probe');
  assert.equal(h.tracker.stats.transportReason, 'unanswered');
  h.tracker.reset();
});

// Once a bitmap job of the worker has completed, a worker that dies is a
// tracking failure, as before: the queued frame's bitmap is closed, the active
// one went to the worker, and the next worker probes for bitmaps again. So is
// one that dies idle, or during a job of the camera's own readback.
test('a worker that dies with a bitmap job active and another queued counts a failure, closes the queued bitmap and keeps bitmaps', async () => {
  const h = transport(); await h.handshake();
  const first = h.tracker.anchor(h.frame('anchor')); h.reply(); await first;
  const active = h.frame('anchor'), queued = h.frame();
  const anchored = h.tracker.anchor(active), verified = h.tracker.verify(queued);
  assert.equal(active.bitmap.transferred, true); assert.equal(h.tracker.stats.queuedFrames, 1);
  const died = error => error.name !== 'NotSupportedError' && error.message === 'worker crashed';
  const both = Promise.all([assert.rejects(anchored, died), assert.rejects(verified, died)]);
  h.last().onerror({ message: 'worker crashed' });
  await both;
  assert.equal(h.tracker.stats.failures, 1, 'a tracking failure, as before');
  assert.equal(h.workers[0].terminated, true); assert.equal(h.timers.size, 0, 'no deadline left');
  assert.equal(queued.bitmap.closed, true, 'the queued frame\'s bitmap is closed');
  assert.equal(active.bitmap.closed, false, 'the transferred one went with the worker');
  assert.ok(h.bitmaps.every(b => b.closed || b.transferred), JSON.stringify(h.bitmaps.map(b => [b.label, b.closed, b.transferred])));
  assert.equal(await h.handshake(), 'bitmap', 'the next worker probes again');
  assert.equal(h.workers[1].sent[0].op, 'probe');
  // Idle, its bitmaps never tried: a failure too, and bitmaps stay.
  h.last().onerror({ message: 'worker crashed' });
  assert.equal(h.tracker.stats.failures, 2); assert.equal(await h.handshake(), 'bitmap');
  // On a job of the camera's own readback (a tracker without bitmaps): a failure.
  const own = transport({ probe: 'none' }); await own.tracker.ready();
  const job = own.tracker.verify({ image: image(), anchors: [] }), failed = assert.rejects(job, /worker crashed/);
  own.last().onerror({ message: 'worker crashed' }); await failed;
  assert.equal(own.tracker.stats.failures, 1);
  h.tracker.reset();
});
