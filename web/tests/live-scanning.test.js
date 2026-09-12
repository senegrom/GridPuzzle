import test from "node:test";
import assert from "node:assert/strict";
import { makePuzzle } from "../model.js";
import { overlayCells, previewAllowed, sameFrame, SCAN_COLOURS, drawLiveOverlay } from "../live-overlay.js";
import { createLiveSession } from "../live-session.js";
import { createLiveSolver } from "../live-solver.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function found() { const puzzle=makePuzzle("latinsquare",2);puzzle.cells=[1,null,null,1];return {puzzle,cellUncertain:[],cageUncertain:[],markedCells:[0,3],needsReview:true,notes:[]}; }
const unique = {status:"unique",complete:true,solutions:[{cells:[1,2,2,1]}]};

test("live colours distinguish readings, uncertainty, unresolved cells and solution entries",()=>{
 const f=found();f.cellUncertain=[3];
 assert.deepEqual(overlayCells(f).map(c=>c.kind),["recognised","unknown","unknown","uncertain"]);
 assert.deepEqual(overlayCells(f,unique).map(c=>c.kind),["recognised","solution","solution","uncertain"]);
 assert.equal(SCAN_COLOURS.recognised,"#22c55e");assert.equal(SCAN_COLOURS.uncertain,"#facc15");
 assert.equal(SCAN_COLOURS.unknown,"#ef4444");assert.equal(SCAN_COLOURS.solution,"#3b82f6");
});
test("unknown printed clues cannot be hidden by a computed value",()=>{
 const f=found();f.markedCells.push(1);
 assert.equal(overlayCells(f,unique)[1].kind,"unknown");assert.equal(previewAllowed(f),false);
 delete f.markedCells;f.cellUncertain=[1];assert.equal(previewAllowed(f),false);
});
test("missed numbered black cells remain red and prevent speculative solving",()=>{
 const f=found();f.puzzle.type="str8ts";f.puzzle.black=[1];f.puzzle.cells[1]="#";f.markedCells.push(1);
 assert.equal(overlayCells(f,unique).find(c=>c.cell===1).kind,"unknown");assert.equal(previewAllowed(f),false);
});
for(const result of [{...unique,status:"multiple"},{...unique,complete:false},{...unique,status:"error"},{...unique,solutions:[{cells:[1]}]}])
 test(`no blue entries for ${result.status}/${result.complete}/${result.solutions[0].cells.length}`,()=>{
 assert.equal(overlayCells(found(),result).some(c=>c.kind==="solution"),false);
});
test("conflicting clues are yellow and never justify a live solve",()=>{
 const f=found();f.puzzle.cells[1]=1;
 assert.equal(previewAllowed(f),false);assert.equal(overlayCells(f)[0].kind,"uncertain");
});
test("live preview accepts inferred rules without confirming the saved puzzle",()=>{
 const f=found();assert.equal(previewAllowed(f),true);assert.equal(f.needsReview,true);
 const empty=found();empty.puzzle.cells.fill(null);assert.equal(previewAllowed(empty),false);
});
test("local frame changes invalidate the overlay even with a small total difference",()=>{
 const a=new Uint8Array(4096).fill(180),b=a.slice();b.fill(10,0,64);
 assert.equal(sameFrame(a,b),false);assert.equal(sameFrame(a,a.slice()),true);
 assert.equal(sameFrame(a,new Uint8Array(4096).fill(182)),true);assert.equal(sameFrame(a,null),false);
});
test("drawing keeps source clues and uses perspective positions and readable question marks",()=>{
 const text=[],transforms=[],fills=[];
 const ctx={save(){},restore(){},translate(x,y){transforms.push([x,y]);},rotate(){},fillRect(){},fillText(t){text.push(t);fills.push(this.fillStyle);}};
 const f=found();f.cellUncertain=[3];
 drawLiveOverlay(ctx,200,200,[{x:0,y:0},{x:199,y:0},{x:199,y:199},{x:0,y:199}],f,unique);
 assert.deepEqual(text,["1","2","2","1?"]);assert.equal(fills[0],SCAN_COLOURS.recognised);
 assert.equal(fills[3],SCAN_COLOURS.uncertain);assert.ok(transforms.every(([x,y])=>x>=0&&y>=0&&x<200&&y<200));
});
function session(t, timers = {}){
 const reads=[],solves=[],statuses=[],changes=[];let time=0,readCancels=0,solveCancels=0;
 const s=createLiveSession({read(frame,progress){const d=deferred();reads.push({...d,frame,progress});return d.promise;},
 solve(puzzle){const d=deferred();solves.push({...d,puzzle});return d.promise;},cancelRead(){readCancels++;},cancelSolve(){solveCancels++;},
 onStatus:m=>statuses.push(m),onChange:v=>changes.push(v),now:()=>time,...timers});
 const frame=()=>({key:"latin:2",width:200,corners:[{x:0,y:0},{x:199,y:0},{x:199,y:199},{x:0,y:199}],signature:new Uint8Array(4096).fill(180),sharpness:200});
 s.start();t.after(()=>s.stop());return {s,frame,reads,solves,statuses,changes,advance(n=4000){time+=n;},get readCancels(){return readCancels;},get solveCancels(){return solveCancels;}};
}
test("two stable frames choose the sharper photo and run one OCR at a time",async t=>{
 const h=session(t);const a=h.frame(),b={...h.frame(),sharpness:500};h.s.observe(a);assert.equal(h.reads.length,0);
 h.s.observe(b);assert.equal(h.reads.length,1);assert.equal(h.reads[0].frame,b);
 for(let i=0;i<8;i++)h.s.observe(h.frame());assert.equal(h.reads.length,1);
 h.reads[0].resolve(found());await tick();assert.equal(h.solves.length,1);assert.equal(h.s.preview.found.needsReview,true);
 h.solves[0].resolve(unique);await tick();assert.equal(h.s.preview.result,unique);assert.equal(h.s.busy,false);
 assert.match(h.statuses.at(-1),/Solution preview/);
});
for(const end of ["success","error","progress"])test(`motion ignores stale OCR ${end} and removes overlays`,async t=>{
 const h=session(t);h.s.observe(h.frame());h.s.observe(h.frame());
 h.s.motion(new Uint8Array(4096));const status=h.statuses.at(-1);
 if(end==="success")h.reads[0].resolve(found());else if(end==="error")h.reads[0].reject(Error("obsolete"));else h.reads[0].progress("obsolete");
 await tick();assert.equal(h.s.preview,null);assert.equal(h.solves.length,0);assert.equal(h.statuses.at(-1),status);
});
test("camera close cancels both pipelines and ignores a delayed solution",async t=>{
 const h=session(t);h.s.observe(h.frame());h.s.observe(h.frame());h.reads[0].resolve(found());await tick();
 h.s.stop();h.solves[0].resolve(unique);await tick();assert.equal(h.s.preview,null);assert.ok(h.readCancels>=2);assert.ok(h.solveCancels>=2);
 h.s.observe(h.frame());assert.equal(h.reads.length,1);
});
test("settings and geometry changes cancel ownership of an in-flight preview",async t=>{
 const h=session(t);h.s.observe(h.frame());h.s.observe(h.frame());h.s.observe({...h.frame(),key:"sudoku:2"});
 h.reads[0].resolve(found());await tick();assert.equal(h.s.preview,null);assert.equal(h.solves.length,0);
});
test("unread clues display without a solve; a later clear frame can recover",async t=>{
 const h=session(t);h.s.observe(h.frame());h.s.observe(h.frame());const f=found();f.markedCells.push(1);
 h.reads[0].resolve(f);await tick();assert.equal(h.solves.length,0);assert.equal(h.s.busy,false);
 h.advance();h.s.observe(h.frame());h.reads[1].resolve(found());await tick();h.solves[0].resolve(unique);await tick();assert.equal(h.s.preview.result.status,"unique");
});
test("ambiguous or failed solving leaves readings but no blue solution",async t=>{
 const h=session(t);h.s.observe(h.frame());h.s.observe(h.frame());h.reads[0].resolve(found());await tick();h.solves[0].resolve({...unique,status:"multiple"});await tick();
 assert.equal(h.s.preview.result,null);assert.match(h.statuses.at(-1),/More than one/);
});
function workerHarness(){const workers=[],timers=new Map();let count=0;
 const solver=createLiveSolver({makeWorker(){const w={messages:[],terminated:false,postMessage(m){this.messages.push(m);},terminate(){this.terminated=true;}};workers.push(w);return w;},
 setTimer(fn,ms){timers.set(++count,{fn,ms});return count;},clearTimer(id){timers.delete(id);}});
 return {solver,workers,timers,result(w,result){w.onmessage({data:{id:w.messages.at(-1).id,type:"result",result}});}};
}
test("preview solver limits runtime initialization and search independently",async()=>{
 const h=workerHarness(),pending=h.solver.solve(found().puzzle),w=h.workers[0];
 assert.equal([...h.timers.values()][0].ms,90000);w.onmessage({data:{id:1,type:"status",message:"Solving and checking uniqueness…"}});
 assert.equal([...h.timers.values()][0].ms,8000);[...h.timers.values()][0].fn();assert.equal(await pending,null);assert.equal(w.terminated,true);
});
test("preview solver reuses its runtime and settles cancelled requests",async()=>{
 const h=workerHarness(),one=h.solver.solve(found().puzzle),w=h.workers[0];h.result(w,unique);assert.equal(await one,unique);
 const two=h.solver.solve(found().puzzle);assert.equal(h.workers.length,1);h.solver.cancel();assert.equal(await two,null);
 h.result(w,unique);assert.equal(h.timers.size,0);
});
for(const failure of ["construction","post"])test(`preview worker ${failure} failure never leaves an unresolved request`,async()=>{
 const s=createLiveSolver({makeWorker(){if(failure==="construction")throw Error("no worker");return{postMessage(){throw Error("post failed");},terminate(){}};}});
 assert.equal(await s.solve(found().puzzle),null);
});

test("cage-only puzzles can show blue answers without accepting structural review",()=>{
 const f=found();f.puzzle=makePuzzle("kenken",2);f.puzzle.cages=[1,2,2,1].map((target,cell)=>({cells:[cell],target,op:"="}));
 f.markedCells=[];f.cageUncertain=[0,1,2,3];
 assert.equal(previewAllowed(f),true);assert.equal(overlayCells(f,unique).filter(c=>c.kind==="solution").length,4);
 assert.equal(f.needsReview,true);
});


test("stalled live OCR times out without stopping the camera and ignores late replies", async t => {
 const timers=new Map();let serial=0;
 const h=session(t,{setTimer(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimer(id){timers.delete(id);}});
 h.s.observe(h.frame());h.s.observe(h.frame());
 assert.equal([...timers.values()][0].ms,90000);[...timers.values()][0].fn();
 assert.equal(h.s.busy,false);assert.equal(timers.size,0);assert.match(h.statuses.at(-1),/timed out/);
 h.reads[0].resolve(found());await tick();assert.equal(h.s.preview,null);assert.equal(h.solves.length,0);
 h.s.observe(h.frame());h.s.observe(h.frame());assert.equal(h.reads.length,2);
 h.reads[1].resolve(found());await tick();assert.equal(timers.size,0,"OCR deadline must not terminate the later solver");
 h.solves[0].resolve(unique);await tick();assert.equal(h.s.preview.result,unique);
});

async function playbackHarness(t) {
 const {setupPhotoFlow}=await import("../photo-flow.js"),nodes=new Map(),statuses=[];
 let attempts=0,started=0,stopped=0;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,style:{},getContext:()=>({clearRect(){}})});return nodes.get(id);};
 for(const key of ["navigator","document"]){const previous=Object.getOwnPropertyDescriptor(globalThis,key);t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);}
 globalThis.document={body:{classList:{add(){},remove(){}}},addEventListener(){}};
 const stream={getTracks:()=>[{stop(){stopped++;}}]};
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}});
 $("video").play=async()=>{if(++attempts===1)throw Object.assign(Error("Playback needs a tap"),{name:"NotAllowedError"});};
 const flow=setupPhotoFlow({$,state:{},scanner:{},stopTask(){},status:(...args)=>statuses.push(args),liveFactory:()=>({start(){started++;},stop(){}})});
 return {$,flow,statuses,get started(){return started;},get stopped(){return stopped;}};
}
test("blocked autoplay keeps the camera and an explicit tap starts muted inline playback",async t=>{
 const h=await playbackHarness(t);await h.$("camera").onclick();
 assert.equal(h.$("video").muted,true);assert.equal(h.$("video").playsInline,true);
 assert.equal(h.$("start-camera").hidden,false);assert.equal(h.$("camera-panel").hidden,false);assert.equal(h.stopped,0);
 assert.match(h.$("camera-help").textContent,/Start preview/);assert.equal(h.started,0);
 await h.$("start-camera").onclick();assert.equal(h.started,1);assert.equal(h.$("start-camera").hidden,true);
 h.flow.stopCamera();assert.equal(h.stopped,1);
});
test("closing a playback-blocked camera invalidates its pending start button",async t=>{
 const h=await playbackHarness(t);await h.$("camera").onclick();h.flow.stopCamera();await h.$("start-camera").onclick();
 assert.equal(h.started,0);assert.equal(h.stopped,1);assert.equal(h.$("start-camera").hidden,true);
});

test("stalled playback offers a bounded retry and closing clears its timer",async t=>{
 const h=await playbackHarness(t),oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout,timers=new Map();let next=0;
 t.after(()=>{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;});
 globalThis.setTimeout=fn=>{timers.set(++next,fn);return next;};globalThis.clearTimeout=id=>timers.delete(id);
 h.$("video").play=()=>new Promise(()=>{});
 const opening=h.$("camera").onclick();await tick();assert.equal(timers.size,1);
 [...timers.values()][0]();await opening;
 assert.equal(h.$("start-camera").hidden,false);assert.match(h.$("camera-help").textContent,/No camera frame/);assert.equal(timers.size,0);
 h.flow.stopCamera();assert.equal(h.$("start-camera").hidden,true);assert.equal(timers.size,0);
});

test("a finished unique preview stops periodic re-reading until the scene changes", async t => {
 const h=session(t);h.s.observe(h.frame());h.s.observe(h.frame());
 h.reads[0].resolve(found());await tick();h.solves[0].resolve(unique);await tick();
 assert.equal(h.s.preview.result,unique);
 for(let i=0;i<12;i++){h.advance(5000);h.s.observe(h.frame());}
 assert.equal(h.reads.length,1,"a solved stable scene must not be re-read every few seconds");
 h.s.motion(new Uint8Array(4096));h.s.observe(h.frame());h.s.observe(h.frame());
 assert.equal(h.reads.length,2,"motion starts a fresh read");
});
test("an unresolved scene backs off between recognition attempts",async t=>{
 const h=session(t);const unread=()=>{const f=found();f.markedCells.push(1);return f;};
 h.s.observe(h.frame());h.s.observe(h.frame());assert.equal(h.reads.length,1);
 h.reads[0].resolve(unread());await tick();assert.equal(h.solves.length,0);
 const attempt=async(wait,expected)=>{h.advance(wait);h.s.observe(h.frame());
  assert.equal(h.reads.length,expected,`after ${wait}ms`);
  if(h.reads.length===expected&&h.reads.at(-1).resolve&&!h.reads.at(-1).done){h.reads.at(-1).done=true;h.reads.at(-1).resolve(unread());await tick();}};
 await attempt(2900,1);await attempt(200,2);
 await attempt(5900,2);await attempt(200,3);
 await attempt(11900,3);await attempt(200,4);
 await attempt(23900,4);await attempt(200,5);
 await attempt(23900,5);await attempt(200,6);
});
test("sampled frames release their pixels once recognition has used them",async t=>{
 const h=session(t);const a={...h.frame(),image:{pixels:true}},b={...h.frame(),image:{pixels:true},sharpness:500};
 h.s.observe(a);h.s.observe(b);assert.equal(h.reads[0].frame,b);
 h.reads[0].resolve(found());await tick();
 assert.equal(b.image,null,"the recognised sample keeps only its signature and geometry");
 assert.equal(h.s.preview.sample.image,null);
});
test("an exhausted search budget warms a replacement runtime for the next preview",async()=>{
 const h=workerHarness(),pending=h.solver.solve(found().puzzle),w=h.workers[0];
 w.onmessage({data:{id:1,type:"status",message:"Solving and checking uniqueness…"}});
 [...h.timers.values()][0].fn();assert.equal(await pending,null);assert.equal(w.terminated,true);
 assert.equal(h.workers.length,2);assert.deepEqual(h.workers[1].messages,[{type:"warm"}]);
 const next=h.solver.solve(found().puzzle);assert.equal(h.workers.length,2,"the warmed worker serves the next preview");
 assert.equal(h.workers[1].messages.length,2);h.result(h.workers[1],unique);assert.equal(await next,unique);
});
test("closing the camera or a runtime-loading timeout does not warm another worker",async()=>{
 const h=workerHarness(),one=h.solver.solve(found().puzzle);h.solver.cancel();assert.equal(await one,null);
 assert.equal(h.workers.length,1);
 const two=h.solver.solve(found().puzzle);[...h.timers.values()][0].fn();assert.equal(await two,null);
 assert.equal(h.workers.length,2,"a loading timeout terminates without an immediate reload");
});
test("preparing the preview solver warms one worker that the first preview reuses",async()=>{
 const h=workerHarness();h.solver.prepare();h.solver.prepare();
 assert.equal(h.workers.length,1);assert.deepEqual(h.workers[0].messages,[{type:"warm"}]);
 const pending=h.solver.solve(found().puzzle);assert.equal(h.workers.length,1);
 assert.equal(h.workers[0].messages[1].puzzle,undefined===h.workers[0].messages[1].puzzle?undefined:h.workers[0].messages[1].puzzle);
 h.result(h.workers[0],unique);assert.equal(await pending,unique);
});
