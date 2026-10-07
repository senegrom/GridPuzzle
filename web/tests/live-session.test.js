import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle } from '../model.js';
import { createLiveSession } from '../live-session.js';
function state() {
  const puzzle = makePuzzle('latinsquare', 2); puzzle.cells[0] = 1;
  return { puzzle, uncertain: new Set([0]), cageUncertain: new Set(), needsReview: true,
    notes: ['Check the photograph'], blackReadings: [], play: [null, 2, null, null], hints: new Set([1]) };
}
const flush=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function live(t, enabled) {
 let auto=enabled,cancels=0,reads=0;const solves=[];const d=defer();
 const s=createLiveSession({read:()=>{reads++;return d.promise;},solve:()=>{const p=defer();solves.push(p);return p.promise;},
  cancelRead(){},cancelSolve(){cancels++;},autoSolve:()=>auto,onChange(){},onStatus(){},isCurrent:()=>true,
  sameScene:()=>true});
 const corners=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
 const observe=()=>s.observe({key:'2',width:21,height:21,corners,sharpness:200,image:{width:21,height:21}});
 s.start();observe();observe();t.after(()=>s.stop());
 return {s,solves,resolve:()=>d.resolve({puzzle:state().puzzle,markedCells:[0],notes:[]}),observe,
  toggle(value){auto=value;s.validate();},get cancels(){return cancels;},get reads(){return reads;}};
}
test('auto-solve off still finishes OCR, avoids solver calls and retains the same read when enabled',async t=>{
 const h=live(t,false);h.resolve();await flush();assert.equal(h.solves.length,0);assert.ok(h.s.preview.found);
 h.toggle(true);assert.equal(h.solves.length,1);assert.equal(h.reads,1);
});
test('turning off during solving cancels only the solve and fences a late reply even after re-enabling',async t=>{
 const h=live(t,true);h.resolve();await flush();assert.equal(h.solves.length,1);const before=h.cancels;
 h.toggle(false);assert.equal(h.cancels,before+1);assert.equal(h.s.preview.result,null);assert.equal(h.s.busy,false);
 h.toggle(true);assert.equal(h.solves.length,2);
 h.solves[0].resolve({status:'unique',complete:true,solutions:[{cells:[1,2,2,1]}]});await flush();
 assert.equal(h.s.preview.result,null);assert.equal(h.s.busy,true);assert.equal(h.reads,1);
 h.solves[1].resolve({status:'unique',complete:true,solutions:[{cells:[1,2,2,1]}]});await flush();
 assert.equal(h.s.preview.result.status,'unique');
 h.toggle(false);assert.equal(h.s.preview.result,null);
});
test('turning auto-solve off during OCR never cancels recognition or invokes solve',async t=>{
 const h=live(t,true);h.toggle(false);h.resolve();await flush();assert.equal(h.solves.length,0);assert.equal(h.reads,1);
 assert.equal(h.s.preview.readComplete,true);
});

test('invalidate retires the reading and reports why: frozen, cleared, or settings and detection by default',async t=>{
 for(const reason of ['frozen','cleared',undefined]){
  const events=[];
  const s=createLiveSession({read:async()=>({puzzle:state().puzzle,markedCells:[0],notes:[]}),solve:()=>new Promise(()=>{}),
   cancelRead(){},cancelSolve(){},onChange(){},onStatus(){},onEvent:e=>events.push(e),isCurrent:()=>true,sameScene:()=>true});
  s.start();t.after(()=>s.stop());
  const corners=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
  for(let i=0;i<2;i++)s.observe({key:'2',width:21,height:21,corners,sharpness:200,image:{width:21,height:21}});
  await flush();assert.ok(s.preview?.found);assert.equal(s.busy,true,'the solve is running');
  s.invalidate(reason);
  assert.equal(s.preview,null);assert.equal(s.busy,false);
  assert.deepEqual(events.at(-1),{stage:'tracking',reason:reason??'settings-or-detection',cancelledRead:false,cancelledSolve:true});
 }
});

// Without automatic solving live video shows no clue digits, so the status
// names the counts (the legend shows them too).
test('the status of a complete reading without automatic solving names its counts',async t=>{
 const statuses=[],d=defer();let auto=false;
 const s=createLiveSession({read:()=>d.promise,solve:()=>new Promise(()=>{}),cancelRead(){},cancelSolve(){},autoSolve:()=>auto,
  onChange(){},onStatus:m=>statuses.push(m),isCurrent:()=>true,sameScene:()=>true});
 const corners=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
 s.start();t.after(()=>s.stop());
 for(let i=0;i<2;i++)s.observe({key:'2',width:21,height:21,corners,sharpness:200,image:{width:21,height:21}});
 const puzzle=makePuzzle('latinsquare',2);puzzle.cells=[1,2,null,null];
 d.resolve({puzzle,markedCells:[0,1],cellUncertain:[1],notes:[]});await flush();
 assert.equal(statuses.at(-1),'Clues read (1 recognised, 1 uncertain). Automatic solving is off; capture to review or play.');
 // Turned off after a solve: the same counted line.
 auto=true;s.validate();auto=false;s.validate();
 assert.equal(statuses.at(-1),'Clues read (1 recognised, 1 uncertain). Automatic solving is off; capture to review or play.');
});

// refining: whether a complete reading may still change, which the camera's
// freeze waits for. Cell 1 is a marked, uncertain clue with two automatic
// retries; each retry needs a clearer frame and 1.5 s since the last.
function refiningSession(t,{readCells=true,marked=[0,1],autoSolve=false}={}){
 let time=0;const retries=[],reads=[],solves=[];
 const found=()=>{const puzzle=makePuzzle('latinsquare',2);puzzle.cells=[1,2,null,null];
  return {puzzle,cellUncertain:[1],cageUncertain:[],markedCells:[...marked],uncertain:[1],needsReview:true,notes:[],
   entries:[{cell:1,kind:'value',text:'2',confidence:0,evidence:'first'}]};};
 const s=createLiveSession({read:()=>{const d=defer();reads.push(d);return d.promise;},
  readCells:readCells?(sample,base,cells)=>new Promise(resolve=>retries.push({cells,resolve})):null,
  solve:()=>{const d=defer();solves.push(d);return d.promise;},cancelRead(){},cancelSolve(){},onChange(){},onStatus(){},
  autoSolve:()=>autoSolve,isCurrent:()=>true,sameScene:()=>true,now:()=>time});
 const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
 const quality=score=>({score,cellPixels:30,cells:[{cell:1,score,contrast:100}]});
 const observe=score=>s.observe({key:'same',rows:2,cols:2,width:100,height:100,corners,image:{width:100,height:100},sharpness:score,quality:quality(score)});
 const retry=(n)=>{const r=found();return {...r,targetCells:[1],blackLayout:[],entries:[{cell:1,kind:'value',text:'2',confidence:99,evidence:`retry ${n}`}]};};
 s.start();t.after(()=>s.stop());
 return {s,retries,reads,solves,observe,found,retry,setTime(v){time=v;}};
}
test('refining holds while a marked uncertain clue has retries left, and ends when they are spent',async t=>{
 const h=refiningSession(t);
 assert.equal(h.s.refining,false,'nothing is read yet');
 h.observe(20);h.observe(20);
 assert.equal(h.s.refining,false,'a read in progress is not a complete reading');
 h.reads[0].resolve(h.found());await flush();
 assert.equal(h.s.refining,true,'cell 1 has two automatic retries left');
 h.setTime(1600);h.observe(60);assert.equal(h.retries.length,1);
 assert.equal(h.s.refining,true,'a retry is running');
 h.retries[0].resolve(h.retry(1));await flush();
 assert.equal(h.s.refining,true,'one retry is left');
 h.setTime(2000);h.observe(200);assert.equal(h.retries.length,1,'the next needs 1.5 s since the last');
 h.setTime(3200);h.observe(400);assert.equal(h.retries.length,2);
 h.retries[1].resolve(h.retry(2));await flush();
 assert.equal(h.s.refining,false,'both automatic retries are spent');
});
test('refining is false without targeted retries or retryable clues, and true while a solve runs',async t=>{
 const without=refiningSession(t,{readCells:false});
 without.observe(20);without.observe(20);without.reads[0].resolve(without.found());await flush();
 assert.equal(without.s.refining,false,'a reader that cannot retry cells');
 const unmarked=refiningSession(t,{marked:[0]});
 unmarked.observe(20);unmarked.observe(20);unmarked.reads[0].resolve(unmarked.found());await flush();
 assert.equal(unmarked.s.refining,false,'an uncertain cell that is not a marked printed clue is never retried');
 const solving=refiningSession(t,{marked:[0],autoSolve:true});
 solving.observe(20);solving.observe(20);solving.reads[0].resolve(solving.found());await flush();
 assert.equal(solving.solves.length,1);assert.equal(solving.s.refining,true,'the solve is still running');
 solving.solves[0].resolve({status:'unique',complete:true,solutions:[{cells:[1,2,2,1]}]});await flush();
 assert.equal(solving.s.refining,false);assert.equal(solving.s.preview.result.status,'unique');
});
