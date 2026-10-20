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

// A camera aimed at no grid hides the session on every detection without
// one. With no reference and no reading there is nothing to lose: no loss
// clock runs, and neither "Aligning…" nor "Grid lost" is announced. Once a
// grid was found, the same hiding is a loss again.
test('hiding with nothing ever found runs no loss clock and writes nothing',async t=>{
 let time=0,current=true;const statuses=[],events=[];
 const s=createLiveSession({read:()=>new Promise(()=>{}),solve:()=>new Promise(()=>{}),cancelRead(){},cancelSolve(){},
  onChange(){},onStatus:m=>statuses.push(m),onEvent:e=>events.push(e.reason),now:()=>time,isCurrent:()=>current,sameScene:()=>true});
 s.start();t.after(()=>s.stop());
 for(let i=0;i<100;i++){time+=100;s.suspend();}
 assert.deepEqual(statuses,[],'ten seconds of hiding announce nothing');
 assert.deepEqual(events,['started'],'and retire nothing');
 const corners=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
 s.observe({key:'2',width:21,height:21,corners,sharpness:200,image:{width:21,height:21}});
 current=false;
 for(let i=0;i<20;i++){time+=100;s.suspend();}
 assert.deepEqual(statuses,[],'a found grid lost for under two seconds is not announced');
 time+=100;s.suspend();
 assert.deepEqual(statuses,['Aligning the grid — checking the printed clues…']);
 for(let i=0;i<30;i++){time+=100;s.suspend();}
 assert.equal(statuses.at(-1),'Grid lost. Keep the whole puzzle in view to read again.');
 assert.deepEqual(events,['started','grid-lost']);
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

// keep(): the camera holds the help line as it stands while a solved reading
// is about to freeze, so that neither the session's statuses nor a text of
// its own reach the polite live region meanwhile.
test('keep holds the line as it stands: nothing is written until a hold, a release or a note',async t=>{
 const statuses=[],d=defer();
 const s=createLiveSession({read:()=>d.promise,solve:()=>new Promise(()=>{}),cancelRead(){},cancelSolve(){},
  onChange(){},onStatus:m=>statuses.push(m),isCurrent:()=>true,sameScene:()=>true});
 const corners=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
 s.start();t.after(()=>s.stop());
 for(let i=0;i<2;i++)s.observe({key:'2',width:21,height:21,corners,sharpness:200,image:{width:21,height:21}});
 assert.deepEqual(statuses,['Reading printed clues… Keep the grid in view.']);
 s.keep();
 d.resolve({puzzle:state().puzzle,markedCells:[0],notes:[]});await flush();
 assert.equal(s.busy,true,'the reading completed and its solve started');
 s.validate();
 assert.equal(statuses.length,1,'no status is written while the line is kept');
 s.hold('Held.');assert.equal(statuses.at(-1),'Held.','a hold replaces it');
 s.keep();s.validate();assert.equal(statuses.length,2,'keeping a held line writes nothing either');
 s.hold(null);s.validate();
 assert.equal(statuses.at(-1),'Finding a solution on this device…','released, the status returns');
 s.keep();s.notify('Noted.');assert.equal(statuses.at(-1),'Noted.','a note is written over a kept line');
});

// refining: whether a complete reading may still change, which the camera's
// freeze waits for. Cell 1 is a marked, uncertain clue with two automatic
// retries; each retry needs a clearer frame and 1.5 s since the last.
function refiningSession(t,{readCells=true,marked=[0,1],uncertain=[1],autoSolve=false}={}){
 let time=0,visible=true;const retries=[],reads=[],solves=[];
 const found=()=>{const puzzle=makePuzzle('latinsquare',2);puzzle.cells=[1,2,2,null];
  return {puzzle,cellUncertain:[...uncertain],cageUncertain:[],markedCells:[...marked],uncertain:[...uncertain],needsReview:true,notes:[],
   entries:[{cell:1,kind:'value',text:'2',confidence:0,evidence:'first'}]};};
 const s=createLiveSession({read:(frame,progress,onPreview)=>{const d=defer();reads.push({...d,onPreview});return d.promise;},
  readCells:readCells?(sample,base,cells)=>new Promise(resolve=>retries.push({cells,resolve})):null,
  solve:()=>{const d=defer();solves.push(d);return d.promise;},cancelRead(){},cancelSolve(){},onChange(){},onStatus(){},
  autoSolve:()=>autoSolve,isCurrent:()=>visible,sameScene:()=>true,now:()=>time});
 const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
 const quality=score=>({score,cellPixels:30,cells:[{cell:1,score,contrast:100}]});
 const observe=score=>s.observe({key:'same',rows:2,cols:2,width:100,height:100,corners,image:{width:100,height:100},sharpness:score,quality:quality(score)});
 const retry=(n)=>{const r=found();return {...r,targetCells:[1],blackLayout:[],entries:[{cell:1,kind:'value',text:'2',confidence:99,evidence:`retry ${n}`}]};};
 s.start();t.after(()=>s.stop());
 return {s,retries,reads,solves,observe,found,retry,setTime(v){time=v;},visible(v){visible=v;s.validate();}};
}
test('refining holds while a marked uncertain clue has retries left, and ends when they are spent',async t=>{
 const h=refiningSession(t);
 assert.equal(h.s.refining,false,'nothing is read yet');
 h.observe(20);h.observe(20);
 assert.equal(h.s.refining,false,'a read in progress is not a complete reading');
 h.reads[0].onPreview(h.found());
 assert.ok(h.s.preview?.found,'the provisional reading is shown');
 assert.equal(h.s.refining,false,'nor is a provisional reading, its read still running');
 h.reads[0].resolve(h.found());await flush();
 assert.equal(h.s.refining,true,'cell 1 has two automatic retries left');
 h.setTime(1600);h.observe(60);assert.equal(h.retries.length,1);
 assert.equal(h.s.refining,true,'a retry is running');
 h.retries[0].resolve(h.retry(1));await flush();
 assert.equal(h.s.refining,true,'one retry is left');
 h.setTime(2000);h.observe(200);assert.equal(h.retries.length,1,'the next needs 1.5 s since the last');
 h.setTime(3200);h.observe(400);assert.equal(h.retries.length,2);
 // The last retry finishes while the grid does not verify: until it is
 // applied it may still change the reading.
 h.visible(false);h.retries[1].resolve(h.retry(2));await flush();
 assert.equal(h.s.refining,true,'a finished retry waits to be applied');
 h.visible(true);
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
test('refining holds while any marked uncertain clue has a retry left',async t=>{
 // Cells 1 and 2 are marked and uncertain; only cell 1 ever looks clearer.
 const h=refiningSession(t,{marked:[0,1,2],uncertain:[1,2]});
 h.observe(20);h.observe(20);h.reads[0].resolve(h.found());await flush();
 h.setTime(1600);h.observe(60);assert.deepEqual(h.retries[0].cells,[1]);
 h.retries[0].resolve(h.retry(1));await flush();
 h.setTime(3200);h.observe(400);assert.deepEqual(h.retries[1].cells,[1]);
 h.retries[1].resolve(h.retry(2));await flush();
 assert.equal(h.s.refining,true,'cell 1 is spent, but cell 2 still has both retries');
});

// A solved reading's targeted retry with automatic solving on. Cell 1 of a
// 3 x 3 grid is a marked, uncertain clue read as 2; the retry reads it as
// `value`. Every frame verifies unless hidden, so that the reading's own
// frame and the retry's can be told apart.
function retrySession(t,{value=3}={}){
 let time=0;const hidden=new Set(),reads=[],retries=[],solves=[],events=[],statuses=[];
 const found=()=>{const puzzle=makePuzzle('latinsquare',3);puzzle.cells=[1,2,null,null,null,null,null,null,null];
  return {puzzle,cellUncertain:[1],cageUncertain:[],markedCells:[0,1],uncertain:[1],needsReview:true,notes:[],
   entries:[{cell:1,kind:'value',text:'2',confidence:0,evidence:'first'}]};};
 const s=createLiveSession({read:()=>{const d=defer();reads.push(d);return d.promise;},
  readCells:(sample,base,cells)=>new Promise(resolve=>retries.push({cells,resolve})),
  solve:p=>{const d=defer();solves.push({...d,cells:[...p.cells]});return d.promise;},cancelRead(){},cancelSolve(){},
  onChange(){},onStatus:m=>statuses.push(m),onEvent:e=>events.push(e.reason),autoSolve:()=>true,
  isCurrent:f=>!hidden.has(f),sameScene:()=>true,now:()=>time});
 const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
 const frame=score=>({key:'same',rows:3,cols:3,width:100,height:100,corners,image:{width:100,height:100},sharpness:score,
  quality:{score,cellPixels:30,cells:[{cell:1,score,contrast:100}]}});
 const retried=()=>{const r=found();r.puzzle.cells[1]=value;
  return {...r,targetCells:[1],blackLayout:[],entries:[{cell:1,kind:'value',text:String(value),confidence:99,evidence:'retry'}]};};
 s.start();t.after(()=>s.stop());
 return {s,reads,retries,solves,events,statuses,frame,found,retried,setTime(v){time=v;},hide:f=>hidden.add(f),show:f=>hidden.delete(f)};
}
const SOLVED={status:'unique',complete:true,solutions:[{cells:[1,2,3,2,3,1,3,1,2]}]};
// Reads and solves the reading, then starts the retry from a clearer frame
// 1.6 s later, which it returns.
async function retryOfSolved(h){
 h.s.observe(h.frame(20));h.s.observe(h.frame(20));
 h.reads[0].resolve(h.found());await flush();
 h.solves[0].resolve(SOLVED);await flush();
 assert.equal(h.s.preview.result,SOLVED);
 h.setTime(1600);const clearer=h.frame(60);h.s.observe(clearer);
 assert.equal(h.retries.length,1,'a clearer frame starts the retry');
 assert.equal(h.s.preview.result,SOLVED,'the reading keeps its solution while the retry runs');
 return clearer;
}
// A merge that changes a clue withdraws the solution, which belonged to the
// old clues, and the changed puzzle is solved again; a clue read as before
// keeps it. Keeping the old result beside a changed clue let the camera
// freeze a solution of other clues, and kept it through a no-solution answer.
test('a merged retry that changes a clue withdraws the solution and solves the changed puzzle',async t=>{
 const h=retrySession(t);await retryOfSolved(h);
 h.retries[0].resolve(h.retried());await flush();
 assert.equal(h.s.preview.found.puzzle.cells[1],3,'the retry was applied');
 assert.equal(h.s.preview.result,null,'the old clues\' solution is withdrawn');
 assert.equal(h.solves.length,2);assert.equal(h.solves[1].cells[1],3,'the changed puzzle is solved');
 h.solves[1].resolve({status:'no-solution',complete:true,solutions:[]});await flush();
 assert.equal(h.s.preview.result,null,'a clue that leaves no solution leaves none');
 assert.equal(h.statuses.at(-1),'No solution to these readings — move closer or review the clues.');
 const same=retrySession(t,{value:2});await retryOfSolved(same);
 same.retries[0].resolve(same.retried());await flush();
 assert.ok(same.events.includes('targeted-complete'));
 assert.equal(same.s.preview.result,SOLVED,'a clue read as before keeps the solution');assert.equal(same.solves.length,1);
});
// A finished retry is applied only once both the reading's frame and the
// retry's own verify, and is given up five seconds after it finished: a
// retry whose frame stopped verifying while the reading's still does would
// otherwise wait for ever, keeping the reading unsettled and every later
// read and retry off.
test('a finished retry waits for its own frame to verify, and is dropped five seconds after it finished',async t=>{
 const h=retrySession(t),clearer=await retryOfSolved(h);
 h.hide(clearer);h.retries[0].resolve(h.retried());await flush();
 assert.equal(h.s.preview.found.puzzle.cells[1],2,'not applied while its frame does not verify');
 for(const at of [3000,6000,6600]){h.setTime(at);h.s.validate();assert.equal(h.s.settled,false,`still waiting to be applied at ${at} ms`);}
 h.setTime(6700);h.s.validate();
 assert.ok(h.events.includes('retry-expired'));assert.ok(!h.events.includes('targeted-complete'));
 assert.equal(h.s.settled,true);assert.equal(h.s.preview.found.puzzle.cells[1],2);
 assert.equal(h.s.preview.result,SOLVED,'the reading keeps its solution');assert.equal(h.solves.length,1);
 const later=retrySession(t),frame=await retryOfSolved(later);
 later.hide(frame);later.retries[0].resolve(later.retried());await flush();
 later.setTime(3000);later.s.validate();assert.equal(later.s.preview.found.puzzle.cells[1],2);
 later.show(frame);later.setTime(3100);later.s.validate();
 assert.equal(later.s.preview.found.puzzle.cells[1],3,'applied once its frame verifies, within the five seconds');
 assert.ok(later.events.includes('targeted-complete'));
});
