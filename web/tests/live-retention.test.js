import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSession } from "../live-session.js";
import { makePuzzle } from "../model.js";
import { overlayCells } from "../live-overlay.js";
const flush = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return { resolve,reject,promise }; };
const corners = [{x:10,y:10},{x:190,y:10},{x:190,y:190},{x:10,y:190}];
function reading() { const puzzle=makePuzzle("latinsquare",2);puzzle.cells=[1,null,null,1];return {puzzle,markedCells:[0,3],cellUncertain:[3],needsReview:true,notes:[]}; }
const solution = { status:"unique", complete:true, solutions:[{cells:[1,2,2,1]}] };
function harness(t) {
  let time=0, visible=true, scene="A", dx=0, cancels=0, serial=0;
  const reads=[],solves=[],messages=[],timers=new Map();
  const session=createLiveSession({
    read(frame,progress,onPreview) { const d=defer(); reads.push({...d,frame,progress,onPreview});return d.promise; },
    solve(puzzle) { const d=defer();solves.push({...d,puzzle});return d.promise; },
    cancelRead(){cancels++;},cancelSolve(){},onChange(){},onStatus:m=>messages.push(m),now:()=>time,
    isCurrent:f=>visible&&f.scene===scene ? {corners:corners.map(p=>({...p,x:p.x+dx}))}:false,
    sameScene:(a,b)=>a.scene===b.scene,
    setTimer(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimer:id=>timers.delete(id),
  });
  const frame=()=>({scene,key:"latin2",width:220,height:220,corners,signature:new Uint8Array(4096).fill(180),sharpness:200,image:{width:220,height:220}});
  session.start();t.after(()=>session.stop());
  return {session,reads,solves,messages,timers,frame,
    observe(){session.observe(frame());},move(v,offset=0){visible=v;dx=offset;session.motion(new Uint8Array(4096));},
    scene(s){scene=s;},advance(ms){time+=ms;session.validate();},get cancels(){return cancels;}};
}
test("small motion hides the overlay but retains a running OCR job and its completed reading",async t=>{
 const h=harness(t);h.observe();h.observe();const before=h.cancels;
 h.move(false);assert.equal(h.session.busy,true);assert.equal(h.session.preview,null);assert.equal(h.cancels,before);
 h.reads[0].resolve(reading());await flush();assert.equal(h.solves.length,0);assert.equal(h.session.preview,null);
 h.move(true,3);assert.equal(h.reads.length,1);assert.equal(h.solves.length,1);
 assert.equal(h.session.preview.corners[0].x,13);assert.equal(h.session.preview.found.needsReview,true);
 h.solves[0].resolve(solution);await flush();assert.equal(h.session.preview.result,solution);
});
test("background fingerprint changes cannot cancel content-verified work",async t=>{
 const h=harness(t);h.observe();h.observe();const before=h.cancels;
 for(let i=0;i<10;i++)h.move(true,i/10);
 assert.equal(h.reads.length,1);assert.equal(h.cancels,before);
 h.reads[0].resolve(reading());await flush();h.solves[0].resolve(solution);await flush();
 assert.equal(h.session.preview.result,solution);
});
test("a late solver reply is hidden until that exact OCR sample is verified again",async t=>{
 const h=harness(t);h.observe();h.observe();h.reads[0].resolve(reading());await flush();h.move(false);
 h.solves[0].resolve(solution);await flush();assert.equal(h.session.preview,null);
 h.move(true,2);assert.equal(h.session.preview.result,solution);assert.equal(h.reads.length,1);
});
test("changed-clue detections retire old ownership without showing or solving the old reading",async t=>{
 const h=harness(t);h.observe();h.observe();const before=h.cancels;
 h.scene("B");h.move(true);assert.equal(h.session.preview,null);
 h.observe();assert.equal(h.cancels,before,"one mismatch merely hides");
 h.observe();assert.equal(h.cancels,before+1,"two consistent fresh views establish changed content");
 h.reads[0].resolve(reading());await flush();assert.equal(h.solves.length,0);assert.equal(h.session.preview,null);
 h.observe();assert.equal(h.reads.length,2);assert.equal(h.reads[1].frame.scene,"B");
});
test("registration failures cannot create a chain of increasingly different accepted boards",t=>{
 const h=harness(t);h.observe();h.observe();const before=h.cancels;
 for(const s of ["B","C","D"]){h.scene(s);h.move(true);h.observe();assert.equal(h.session.preview,null);}
 assert.equal(h.cancels,before);assert.equal(h.reads.length,1);
});
test("long loss is bounded and a late OCR completion remains obsolete",async t=>{
 const h=harness(t);h.observe();h.observe();const before=h.cancels;
 h.move(false);h.advance(4999);assert.equal(h.cancels,before);h.advance(1);
 assert.equal(h.cancels,before+1);assert.equal(h.session.busy,false);assert.equal(h.timers.size,0);
 h.reads[0].resolve(reading());await flush();assert.equal(h.session.preview,null);assert.equal(h.solves.length,0);
 h.move(true);h.observe();h.observe();assert.equal(h.reads.length,2);
});
test("closing during motion cancels retained work and clears every deadline",async t=>{
 const h=harness(t);h.observe();h.observe();h.move(false);h.session.stop();assert.equal(h.timers.size,0);
 h.reads[0].resolve(reading());await flush();assert.equal(h.session.preview,null);assert.equal(h.solves.length,0);
});
test("provisional results do not become confirmed and do not start solving",t=>{
 const h=harness(t);h.observe();h.observe();h.reads[0].onPreview({...reading(),refining:true});
 assert.equal(h.session.preview.found.refining,true);assert.equal(h.solves.length,0);
 h.move(false);assert.equal(h.session.preview,null);h.move(true);
 assert.equal(h.session.preview.found.refining,true);assert.equal(h.solves.length,0);
});
test("outline-only initial boards and genuine blank cells have no red placeholders",()=>{
 const empty={puzzle:makePuzzle("sudoku",9)};assert.deepEqual(overlayCells(empty),[]);
 const f=reading();assert.deepEqual(overlayCells(f).map(i=>i.cell),[0,3]);
 f.markedCells.push(1);assert.equal(overlayCells(f).find(i=>i.cell===1).kind,"unknown");
 assert.equal(overlayCells(f,solution).find(i=>i.cell===1).kind,"unknown");
});
