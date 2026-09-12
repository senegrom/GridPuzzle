import test from "node:test";
import assert from "node:assert/strict";
import { makePuzzle } from "../model.js";
import { createLiveSession } from "../live-session.js";
import { createLiveSolver } from "../live-solver.js";
import { createLiveCamera } from "../live-camera.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function found() { const puzzle=makePuzzle("latinsquare",2);puzzle.cells=[1,null,null,1];return {puzzle,cellUncertain:[],cageUncertain:[],markedCells:[0,3],needsReview:true,notes:[]}; }
const unique = {status:"unique",complete:true,solutions:[{cells:[1,2,2,1]}]};

function session(t, timers = {}){
 const reads=[],solves=[],statuses=[],changes=[];let time=0,readCancels=0,solveCancels=0;
 const s=createLiveSession({read(frame,progress){const d=deferred();reads.push({...d,frame,progress});return d.promise;},
 solve(puzzle){const d=deferred();solves.push({...d,puzzle});return d.promise;},cancelRead(){readCancels++;},cancelSolve(){solveCancels++;},
 onStatus:m=>statuses.push(m),onChange:v=>changes.push(v),now:()=>time,...timers});
 const frame=()=>({key:"latin:2",width:200,corners:[{x:0,y:0},{x:199,y:0},{x:199,y:199},{x:0,y:199}],signature:new Uint8Array(4096).fill(180),sharpness:200});
 s.start();t.after(()=>s.stop());return {s,frame,reads,solves,statuses,changes,advance(n=4000){time+=n;},get readCancels(){return readCancels;},get solveCancels(){return solveCancels;}};
}
function workerHarness(){const workers=[],timers=new Map();let count=0;
 const solver=createLiveSolver({makeWorker(){const w={messages:[],terminated:false,postMessage(m){this.messages.push(m);},terminate(){this.terminated=true;}};workers.push(w);return w;},
 setTimer(fn,ms){timers.set(++count,{fn,ms});return count;},clearTimer(id){timers.delete(id);}});
 return {solver,workers,timers,result(w,result){w.onmessage({data:{id:w.messages.at(-1).id,type:"result",result}});}};
}
const flush = tick;
function harness(t, solver = { solve: async () => null, cancel() {} }) {
  let time = 0, serial = 0, cancellations = 0;
  const timers = new Map(), detections = [], readings = [], nodes = new Map();
  const previous = globalThis.document;
  const context = { drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(180) }) };
  const canvas = () => ({ width: 700, height: 700, dataset: {}, getContext: () => context, setAttribute() {} });
  globalThis.document = { createElement: canvas };
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "" }); return nodes.get(id); };
  const settings = { type: "latinsquare", rows: 2, cols: 2, boxRows: 1, boxCols: 2, enabled: true };
  const camera = createLiveCamera({ $, video: { videoWidth: 700, videoHeight: 700 }, canvas: canvas(),
    getSettings: () => ({ ...settings }),
    detector: { detect() { const job = deferred(); detections.push(job); return job.promise; }, cancel() { cancellations++; } },
    reader: { read() { const job = deferred(); readings.push(job); return job.promise; }, cancel() {} },
    solver, now: () => time,
    setTimer(fn, ms) { timers.set(++serial, { fn, at: time + ms }); return serial; },
    clearTimer(id) { timers.delete(id); },
  });
  async function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next; time = job.at; timers.delete(id); job.fn(); await flush();
    }
    time = end; await flush();
  }
  function result(job = detections.at(-1)) {
    job.resolve({ confidence: .99, rows: 2, cols: 2, sharpness: 200,
      corners: [{ x: 0, y: 0 }, { x: 639, y: 0 }, { x: 639, y: 639 }, { x: 0, y: 639 }] });
    return flush();
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, timers, detections, readings, settings, advance, result, $, get cancellations() { return cancellations; } };
}


for (const outcome of ["unread", "error"]) test(`a ${outcome} scan retries using live pixels, never a released sample`, async t => {
 const h=session(t), first={...h.frame(),image:{frame:1},sharpness:500};
 h.s.observe(first);h.s.observe(first);
 if(outcome==="error")h.reads[0].reject(Error("OCR unavailable"));
 else{const f=found();f.markedCells.push(1);h.reads[0].resolve(f);}
 await tick();assert.equal(first.image,null);
 h.advance();const fresh={...h.frame(),image:{frame:2},sharpness:200};h.s.observe(fresh);
 assert.equal(h.reads.length,2);
 assert.equal(h.reads[1].frame,fresh,"the sharper but already released sample must not win selection");
 assert.deepEqual(h.reads[1].frame.image,{frame:2});
});

test("frames observed during OCR cannot starve a retry with an old sharper sample", async t => {
 const h=session(t), first={...h.frame(),image:{frame:1},sharpness:300};
 h.s.observe(first);h.s.observe(first);
 h.s.observe({...h.frame(),image:{frame:2},sharpness:900});
 const f=found();f.markedCells.push(1);h.reads[0].resolve(f);await tick();
 h.advance();const fresh={...h.frame(),image:{frame:3},sharpness:200};h.s.observe(fresh);
 assert.equal(h.reads[1].frame,fresh,"select the retry from frames seen after OCR settled");
});

test("a substantially sharper frame retries unresolved OCR before the backoff expires", async t => {
 const h=session(t), unread=()=>{const f=found();f.markedCells.push(1);return f;};
 h.s.observe(h.frame());h.s.observe(h.frame());h.reads[0].resolve(unread());await tick();
 h.advance(3100);h.s.observe(h.frame());h.reads[1].resolve(unread());await tick();
 // This attempt would normally wait six seconds. Ignore tiny focus noise.
 h.advance(1100);h.s.observe({...h.frame(),sharpness:205});assert.equal(h.reads.length,2);
 const focused={...h.frame(),image:{focused:true},sharpness:320};h.s.observe(focused);
 assert.equal(h.reads.length,3);assert.equal(h.reads[2].frame,focused);
});

test("a clearer frame can improve a solved but uncertain preview without continuous rereading", async t => {
 const h=session(t), uncertain=found();uncertain.cellUncertain=[0];
 h.s.observe(h.frame());h.s.observe(h.frame());h.reads[0].resolve(uncertain);await tick();
 h.solves[0].resolve(unique);await tick();
 h.advance(1100);h.s.observe({...h.frame(),sharpness:205});assert.equal(h.reads.length,1);
 h.s.observe({...h.frame(),image:{focused:true},sharpness:320});assert.equal(h.reads.length,2);
 // Results must still come from recognition, not the old solution.
 assert.equal(h.solves.length,1);
});

test("preview invalidation keeps an idle warmed runtime but cancels active search", async()=>{
 const h=workerHarness();h.solver.prepare();const w=h.workers[0];
 h.solver.invalidate();assert.equal(w.terminated,false);
 const first=h.solver.solve(found().puzzle);assert.equal(h.workers.length,1);
 h.result(w,unique);await first;h.solver.invalidate();assert.equal(w.terminated,false);
 const second=h.solver.solve(found().puzzle);h.solver.invalidate();
 assert.equal(await second,null);assert.equal(w.terminated,true);
 h.solver.cancel();
});

test("warm-up failures retire their worker and the next solve retries immediately", async()=>{
 for(const failure of ["warm-error","error","timeout"]){
  const h=workerHarness();h.solver.prepare();const w=h.workers[0];
  if(failure==="warm-error")w.onmessage({data:{type:"warm-error",message:"Download failed"}});
  else if(failure==="error")w.onerror({message:"Worker failed"});
  else{assert.equal([...h.timers.values()][0].ms,90000);[...h.timers.values()][0].fn();}
  assert.equal(w.terminated,true);assert.equal(h.timers.size,0);
  const pending=h.solver.solve(found().puzzle);assert.equal(h.workers.length,2);
  h.result(h.workers[1],unique);assert.equal(await pending,unique);h.solver.cancel();
 }
});

test("ready warm-up clears its deadline and an obsolete warm message cannot stop a replacement",async()=>{
 const h=workerHarness();h.solver.prepare();const first=h.workers[0],oldMessage=first.onmessage;
 first.onmessage({data:{type:"ready"}});assert.equal(h.timers.size,0);
 h.solver.cancel();h.solver.prepare();const second=h.workers[1];
 oldMessage({data:{type:"warm-error"}});assert.equal(second.terminated,false);assert.equal(h.timers.size,1);
 h.solver.cancel();assert.equal(h.timers.size,0);
});

test("a failed warm-up post terminates the worker rather than leaking it",()=>{
 let terminated=0;
 const solver=createLiveSolver({makeWorker(){return{postMessage(){throw Error("post failed");},terminate(){terminated++;}};}});
 solver.prepare();assert.equal(terminated,1);solver.cancel();
});

test("first-frame settings and ordinary realignment preserve an idle prewarmed solver",async t=>{
 const workers=[];
 const solver=createLiveSolver({makeWorker(){const w={postMessage(){},terminate(){this.terminated=true;}};workers.push(w);return w;}});
 const h=harness(t,solver);assert.equal(workers.length,1);
 await h.advance(100);assert.notEqual(workers[0].terminated,true,"initial settings must not undo camera warm-up");
 h.settings.type="sudoku";await h.advance(100);
 assert.notEqual(workers[0].terminated,true,"rule changes only cancel an active search");
 h.camera.stop();assert.equal(workers[0].terminated,true,"closing still releases the interpreter");
});
