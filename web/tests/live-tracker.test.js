import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createLiveTracker, ANCHOR_DEADLINE, VERIFY_DEADLINE, HANDSHAKE_WAIT, PROBE } from '../live-tracker.js';
import { createTrackingCore } from '../live-tracking-core.js';
import { gridAnchor, matchGrid } from '../live-registration.js';
const flush = () => new Promise(r => setImmediate(r));
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
  let serial = 0, made = 0;
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
    probe: typeof probe === 'function' ? probe : probes[probe],
  });
  const last = () => workers.at(-1);
  return { tracker, workers, timers, bitmaps, bitmap, last,
    get made() { return made; },
    started: (w = last()) => w.onmessage({ data: { started: true } }),
    answer: (pixels = [...PROBE], w = last()) => w.onmessage({ data: { probe: { pixels } } }),
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
  h.started();
  assert.deepEqual(h.delays(), [HANDSHAKE_WAIT], 'the wait for the probe starts when the worker has started');
  h.answer(PROBE.map((value, i) => i % 4 === 3 ? value : value + (i % 2 ? 2 : -2)), worker);
  assert.equal(await ready, 'bitmap', 'every value within 2');
  assert.equal(h.tracker.transport, 'bitmap'); assert.equal(h.tracker.stats.transport, 'bitmap');
  assert.equal(h.tracker.stats.active, 0); assert.equal(h.timers.size, 0);
  assert.equal(await h.tracker.ready(), 'bitmap', 'decided once per worker');
  assert.equal(worker.sent.length, 1, 'no second probe');
  assert.equal(h.tracker.stats.failures, 0);
  h.answer([...PROBE].fill(0), worker); assert.equal(h.tracker.transport, 'bitmap', 'a late second answer changes nothing');
  h.tracker.reset();
});

for (const [name, setup, act] of [
  ['a value off by 3', {}, async h => { h.started(); h.answer(PROBE.map((v, i) => i === 5 ? v + 3 : v)); }],
  ['no pixels (no OffscreenCanvas or 2D context in the worker)', {}, async h => { h.started(); h.answer(null); }],
  ['too few values', {}, async h => { h.started(); h.answer(PROBE.slice(1)); }],
  ['300 ms without an answer after the worker started', {}, async h => { h.started(); h.fire(HANDSHAKE_WAIT); }],
  ['a reply that cannot be received', {}, async h => { h.started(); h.last().onmessageerror(); }],
  ['a probe that cannot be transferred', { refuse: true }, async h => { assert.equal(h.bitmaps[0].closed, true, 'the probe bitmap is closed'); }],
  ['no bitmap from this thread', { probe: 'none' }, async h => { assert.deepEqual(h.last().sent, [], 'nothing is probed'); h.started(); }],
  ['a bitmap that cannot be made', { probe: 'rejects' }, async () => {}],
  ['a canvas that cannot be made', { probe: 'throws' }, async () => {}],
]) test(`the handshake decides "imagedata", with no failure counted, on ${name}`, async () => {
  const h = transport(setup), ready = h.tracker.ready();
  if (setup.refuse) h.last().refuse = data => data.op === 'probe';
  await flush();
  await act(h);
  assert.equal(await ready, 'imagedata');
  assert.equal(h.tracker.stats.failures, 0); assert.equal(h.timers.size, 0, 'no handshake timer left');
  assert.equal(h.last().terminated, undefined, 'the worker is kept');
  // Its jobs carry the camera's own readback, transferred as before.
  const pixels = image(), done = h.tracker.verify({ image: pixels, anchors: [] });
  assert.equal(h.last().sent.at(-1).op, 'verify'); assert.equal(pixels.data.byteLength, 0);
  h.reply(); await done; h.tracker.reset();
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
  await assert.rejects(stray, { name: 'AbortError' });
  assert.equal(h.last().sent.at(-1).op, 'verify', 'not posted'); assert.equal(h.last().sent.length, 3);
  assert.equal(h.tracker.stats.failures, 0); h.tracker.reset();
});

test('a bitmap job for an "imagedata" worker is retired and its bitmap closed', async () => {
  const h = transport({ probe: 'none' });
  assert.equal(await h.tracker.ready(), 'imagedata');
  const job = h.frame(), stray = h.tracker.verify(job);
  await assert.rejects(stray, { name: 'AbortError' });
  assert.equal(job.bitmap.closed, true); assert.deepEqual(h.last().sent, []);
  h.tracker.reset();
});

test('a reset during the handshake rejects every waiter, and a probe bitmap made after it is closed', async () => {
  let resolveProbe;
  const h = transport({ probe: () => new Promise(resolve => { resolveProbe = resolve; }) });
  const first = h.tracker.ready(), second = h.tracker.ready();
  const rejected = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
  h.tracker.reset(); await rejected;
  assert.equal(h.workers[0].terminated, true); assert.equal(h.timers.size, 0);
  const late = h.bitmap('probe'); resolveProbe(late); await flush();
  assert.equal(late.closed, true, 'closed, not posted'); assert.deepEqual(h.workers[0].sent, []);
  // The next ready() starts a new worker with its own handshake.
  const again = h.tracker.ready(); await flush();
  assert.equal(h.workers.length, 2);
  h.started(); h.answer(); assert.equal(await again, 'bitmap'); h.tracker.reset();
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

for (const [name, provoke] of [
  ['replies "bitmap-unsupported"', h => h.reply(h.last(), { result: undefined, error: 'bitmap-unsupported' })],
  ['never answers the first bitmap job', h => h.fire(ANCHOR_DEADLINE)],
  ['sends a reply that cannot be received before a bitmap job completed', h => h.last().onmessageerror()],
]) test(`bitmaps are given up, without a failure, when the worker ${name}`, async () => {
  const h = transport(); await h.handshake();
  const job = h.frame('anchor'), queued = h.frame(), anchored = h.tracker.anchor(job), verified = h.tracker.verify(queued);
  const both = Promise.all([assert.rejects(anchored, { name: 'NotSupportedError' }), assert.rejects(verified, { name: 'NotSupportedError' })]);
  provoke(h);
  await both;
  assert.equal(h.tracker.stats.failures, 0, 'not a tracking failure');
  assert.equal(h.workers[0].terminated, true);
  assert.ok(job.bitmap.closed || job.bitmap.transferred); assert.equal(queued.bitmap.closed, true);
  // Every later worker uses the ImageData transport, without a probe.
  assert.equal(await h.tracker.ready(), 'imagedata');
  assert.equal(h.workers.length, 2); assert.deepEqual(h.workers[1].sent, []);
  const later = h.frame(), retired = h.tracker.verify(later);
  await assert.rejects(retired, { name: 'AbortError' }); assert.equal(later.bitmap.closed, true, 'a bitmap prepared before is closed');
  h.tracker.reset();
});

test('a bitmap that cannot be transferred (DataCloneError) is closed and gives bitmaps up, without a failure', async () => {
  const h = transport(); await h.handshake();
  h.last().refuse = data => !!data.bitmap;
  const job = h.frame('anchor'), anchored = h.tracker.anchor(job);
  await assert.rejects(anchored, { name: 'NotSupportedError' });
  assert.equal(job.bitmap.closed, true); assert.equal(h.tracker.stats.failures, 0);
  assert.equal(h.workers[0].terminated, true); assert.equal(await h.tracker.ready(), 'imagedata');
  h.tracker.reset();
});

test('once a bitmap job has completed, a deadline or an unreadable reply counts as a failure, as before', async () => {
  for (const provoke of [h => h.fire(VERIFY_DEADLINE), h => h.last().onmessageerror()]) {
    const h = transport(); await h.handshake();
    const first = h.tracker.anchor(h.frame('anchor')); h.reply(); await first;
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
  assert.equal(h.tracker.stats.failures, 0); assert.equal(await h.tracker.ready(), 'imagedata');
  h.tracker.reset();
});

test('the worker reports the tracking core\'s time and the transport\'s apart; only the core\'s is "milliseconds"', async () => {
  const h = transport(); await h.handshake();
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
  const next = () => new Promise(resolve => thread.once('message', data => { messages.push(data); resolve(data); }));
  assert.deepEqual(await next(), { started: true });
  thread.postMessage({ op: 'probe', bitmap: { width: 2, height: 2 } });
  assert.deepEqual(await next(), { probe: { pixels: null } });
  thread.postMessage({ op: 'verify', id: 4, bitmap: { width: 2, height: 2 }, width: 64, height: 64, anchors: [] });
  assert.deepEqual(await next(), { id: 4, error: 'bitmap-unsupported' });
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
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.createImageBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = saved.createImageBitmap;
  }
});

test('a probe bitmap made after the handshake ran out is closed, not posted', async () => {
  let resolveProbe;
  const h = transport({ probe: () => new Promise(resolve => { resolveProbe = resolve; }) });
  const ready = h.tracker.ready(); h.started(); h.fire(HANDSHAKE_WAIT);
  assert.equal(await ready, 'imagedata');
  const late = h.bitmap('probe'); resolveProbe(late); await flush();
  assert.equal(late.closed, true); assert.deepEqual(h.last().sent, []);
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
  await assert.rejects(stray, { name: 'AbortError' });
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
});

test('the actual tracking worker draws a transferred bitmap and reads it back, timing that apart from the tracking core', async t => {
  const url = new URL('../live-tracking-worker.js', import.meta.url).href;
  // A stand-in OffscreenCanvas: drawing takes the "bitmap"'s own pixels (a
  // plain object carrying them), after `wait` ms; reading back returns them.
  const script = `const {parentPort}=require('node:worker_threads');
class OffscreenCanvas{constructor(w,h){this.width=w;this.height=h;}getContext(){const c=this;return{clearRect(){},
drawImage(b,x,y,w,h){const end=Date.now()+(b.wait||0);while(Date.now()<end);c.drawn=[x,y,w,h];c.pixels=b.pixels;},
getImageData(x,y,w,h){return{width:w,height:h,data:Uint8ClampedArray.from(c.pixels)};}};}}
global.OffscreenCanvas=OffscreenCanvas;global.self={postMessage:m=>parentPort.postMessage(m)};
import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`;
  const thread = new NodeWorker(script, { eval: true });
  t.after(() => thread.terminate());
  const next = () => new Promise(resolve => thread.once('message', resolve));
  assert.deepEqual(await next(), { started: true });
  thread.postMessage({ op: 'probe', bitmap: { pixels: [...PROBE] } });
  assert.deepEqual(await next(), { probe: { pixels: [...PROBE] } }, 'the probe read back as drawn');
  const frame = image(64, 64), corners = [{ x: 1, y: 1 }, { x: 62, y: 1 }, { x: 62, y: 62 }, { x: 1, y: 62 }];
  thread.postMessage({ op: 'anchor', id: 7, bitmap: { pixels: [...frame.data], wait: 80 }, width: 64, height: 64, corners, rows: 2, cols: 2, anchors: [] });
  const anchored = await next();
  assert.equal(anchored.id, 7); assert.ok(anchored.result.anchor.id > 0, 'tracked on the pixels read back');
  assert.ok(anchored.transportMilliseconds >= 75, `the draw and readback: ${anchored.transportMilliseconds} ms`);
  assert.ok(anchored.milliseconds < 75, `the tracking core alone: ${anchored.milliseconds} ms`);
  thread.postMessage({ op: 'verify', id: 8, bitmap: { pixels: [...frame.data] }, width: 64, height: 64, anchors: [anchored.result.anchor.id] });
  const verified = await next();
  assert.ok(verified.result.proofs[anchored.result.anchor.id], 'the same frame verifies');
});
