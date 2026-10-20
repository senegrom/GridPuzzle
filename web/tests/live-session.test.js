import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle } from '../model.js';
import { createLiveSession, turnedPage } from '../live-session.js';
import { HALF_TURN_BAR } from '../scanner.js';
const UNREAD='Some printed marks could not be read (unread clue ? in the legend). Move closer for a clearer read.';
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
 assert.ok(h.events.includes('retry-expired'),'dropped more than five seconds after it finished');assert.ok(!h.events.includes('targeted-complete'));
 assert.equal(h.s.settled,true);assert.equal(h.s.preview.found.puzzle.cells[1],2);
 assert.equal(h.s.preview.result,SOLVED,'the reading keeps its solution');assert.equal(h.solves.length,1);
 const later=retrySession(t),frame=await retryOfSolved(later);
 later.hide(frame);later.retries[0].resolve(later.retried());await flush();
 later.setTime(3000);later.s.validate();assert.equal(later.s.preview.found.puzzle.cells[1],2);
 later.show(frame);later.setTime(3100);later.s.validate();
 assert.equal(later.s.preview.found.puzzle.cells[1],3,'applied once its frame verifies, within the five seconds');
 assert.ok(later.events.includes('targeted-complete'));
});

// A Sudoku whose boxes the camera guessed from the grid's size and that are
// not square (found.guessedBoxes, live-camera.js): a reading the guess leaves
// without a single solution, or in conflict, names the guess and the settings
// that replace it instead of asking to move closer. With boxes from the
// settings the messages stay as they were.
function boxedSession(t,cells,{guessed=true,marked=null}={}){
 const statuses=[],solves=[];
 const s=createLiveSession({read:async()=>{const puzzle=makePuzzle('sudoku',6);puzzle.cells=[...cells];
   return {puzzle,markedCells:marked??cells.flatMap((v,i)=>v===null?[]:[i]),cellUncertain:[],notes:[],...(guessed?{guessedBoxes:true}:{})};},
  solve:()=>{const d=defer();solves.push(d);return d.promise;},cancelRead(){},cancelSolve(){},onChange(){},onStatus:m=>statuses.push(m),
  isCurrent:()=>true,sameScene:()=>true});
 const corners=[{x:0,y:0},{x:60,y:0},{x:60,y:60},{x:0,y:60}];
 s.start();t.after(()=>s.stop());
 for(let i=0;i<2;i++)s.observe({key:'6',width:61,height:61,corners,sharpness:200,image:{width:61,height:61}});
 return {s,statuses,solves};
}
const SET_BOXES_TEXT='If the printed boxes differ, close the camera and set Rows, Columns, Box height and Box width in Grid size & settings.';
test('a reading with a guessed box layout that is not square names it and the settings when it has no single solution',async t=>{
 const clue=[1,...Array(35).fill(null)];
 for(const [answer,guessed,plain] of [
  [{status:'no-solution',complete:true,solutions:[]},'No solution with boxes of 2 rows × 3 columns, guessed from the grid size.','No solution to these readings — move closer or review the clues.'],
  [{status:'multiple',complete:true,solutions:[]},'More than one solution with boxes of 2 rows × 3 columns, guessed from the grid size.','More than one solution — check the readings and puzzle type.']]){
  const h=boxedSession(t,clue);await flush();
  assert.equal(h.solves.length,1);assert.equal(h.s.preview.found.puzzle.boxRows,2);
  h.solves[0].resolve(answer);await flush();
  assert.equal(h.statuses.at(-1),`${guessed} ${SET_BOXES_TEXT}`);
  const chosen=boxedSession(t,clue,{guessed:false});await flush();
  chosen.solves[0].resolve(answer);await flush();
  assert.equal(chosen.statuses.at(-1),plain,'boxes from the settings keep the message');
 }
});
test('readings in conflict in a guessed box layout that is not square name it and the settings',async t=>{
 // Two 1s in the first 2 x 3 box, which 3 x 2 boxes would keep apart.
 const clash=[1,null,null,null,null,null,null,null,1,...Array(27).fill(null)];
 const h=boxedSession(t,clash);await flush();
 assert.equal(h.solves.length,0,'not solved');
 assert.equal(h.statuses.at(-1),`Conflicting readings (uncertain ? in the legend) with boxes of 2 rows × 3 columns, guessed from the grid size. ${SET_BOXES_TEXT}`);
 const chosen=boxedSession(t,clash,{guessed:false});await flush();
 assert.equal(chosen.statuses.at(-1),'Conflicting readings (uncertain ? in the legend) must be corrected before a solution can be shown.');
});
// Only readings in conflict, which the guess may cause, name it: an unread
// mark in a guessed layout, with nothing in conflict, asks to move closer
// as in any other reading.
test('an unread mark in a guessed box layout that is not square says nothing of conflicts or boxes',async t=>{
 const h=boxedSession(t,[1,...Array(35).fill(null)],{marked:[0,7]});await flush();
 assert.equal(h.solves.length,0,'not solved');
 assert.equal(h.statuses.at(-1),UNREAD);
});

// A live reading is never turned, but the help line names the turn its page
// looks to lie at, by the cue the still photograph's check reads its turns
// on (turnedPage): in a poor reading, glyphs wider than tall (a quarter turn),
// or upright-shaped glyphs read with confidence without one number with a 2,
// 3 or 5 (half a turn). Moving closer and waiting for a clearer frame, which
// the help line asked for, cannot mend such a page. The 4 x 4 reading here
// has 12 printed marks, 5 of them read with confidence (`digits`, in cells
// 0, 5, 10, 15 and 1), as many as the upside-down cue needs (HALF_TURN_BAR);
// `size` is every mark's glyph box, [height, width].
function turnedFound({digits=[1,1,4,4,4],size=[40,28],uncertain=[]}={}){
 const marked=[0,1,2,3,4,5,6,7,8,10,12,15],puzzle=makePuzzle('latinsquare',4);
 [0,5,10,15,1].forEach((cell,i)=>{puzzle.cells[cell]=digits[i];});
 return {puzzle,markedCells:[...marked],cellUncertain:[...uncertain],uncertain:[...uncertain],cageUncertain:[],notes:[],
  entries:marked.map(cell=>({cell,kind:'value',h:size[0],w:size[1],text:Number.isInteger(puzzle.cells[cell])?String(puzzle.cells[cell]):'',
   confidence:Number.isInteger(puzzle.cells[cell])?90:0}))};
}
function turnedSession(t,options={}){
 let time=0;const statuses=[],events=[],found=()=>turnedFound(options);
 const s=createLiveSession({read:async()=>found(),readCells:()=>new Promise(()=>{}),solve:()=>new Promise(()=>{}),cancelRead(){},cancelSolve(){},
  onChange(){},onStatus:m=>statuses.push(m),onEvent:e=>events.push(e.reason),isCurrent:()=>true,sameScene:()=>true,now:()=>time});
 const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
 const observe=()=>s.observe({key:'4',rows:4,cols:4,width:100,height:100,corners,image:{width:100,height:100},sharpness:20,
  quality:{score:20,cellPixels:30,cells:[{cell:0,score:20,contrast:100}]}});
 s.start();t.after(()=>s.stop());observe();observe();
 return {s,statuses,events,found,observe,setTime(v){time=v;}};
}
const SIDEWAYS='The grid looks sideways. Turn the page or the phone a quarter turn so the numbers stand upright; if they already do, move closer.';
const UPSIDE_DOWN='The grid looks upside down. Turn the page or the phone half a turn so the numbers stand upright; if they already do, move closer.';
test('a poor reading of glyphs wider than tall says the grid looks sideways, not to move closer, and is not turned',async t=>{
 const h=turnedSession(t,{size:[20,40]});await flush();
 assert.equal(h.statuses.at(-1),SIDEWAYS,'in place of the unread clues\' "Move closer"');
 assert.deepEqual(h.events.filter(e=>e.startsWith('grid-')),['grid-sideways']);
 assert.deepEqual(h.s.preview.found.puzzle.cells,h.found().puzzle.cells,'the reading is shown as it was read');
 // Waiting for a clearer frame of an uncertain clue: the turn, again.
 const w=turnedSession(t,{size:[20,40],uncertain:[0]});await flush();
 w.setTime(2000);w.observe();
 assert.equal(w.statuses.at(-1),SIDEWAYS,'in place of "Waiting for a clearer frame"');
 assert.equal(w.events.at(-1),'grid-sideways');assert.ok(!w.events.includes('clearer-frame-needed'));
});
test('a poor reading of upright glyphs without a 2, 3 or 5 says the grid looks upside down; one with a 2 does not',async t=>{
 const h=turnedSession(t);await flush();
 assert.equal(h.statuses.at(-1),UPSIDE_DOWN);
 assert.deepEqual(h.events.filter(e=>e.startsWith('grid-')),['grid-upside-down']);
 const two=turnedSession(t,{digits:[1,2,4,4,4]});await flush();
 assert.equal(two.statuses.at(-1),UNREAD);
 assert.deepEqual(two.events.filter(e=>e.startsWith('grid-')),[]);
 // Nor does a reading without a confident digit, or one of glyphs as tall
 // as wide, which say nothing of the way up.
 const none=turnedSession(t,{uncertain:[0,5,10,15,1]});await flush();
 assert.equal(none.statuses.at(-1),UNREAD);
 const square=turnedSession(t,{size:[30,30]});await flush();
 assert.equal(square.statuses.at(-1),UNREAD);
});
// Nor an upright page read poorly with one or two confident digits and no
// 2, 3 or 5 among them, which is common by chance (a third of a Sudoku's
// digits are one): below HALF_TURN_BAR confident digits the line stays.
test('a poor reading with fewer than HALF_TURN_BAR confident digits, none a 2, 3 or 5, keeps its line',async t=>{
 assert.equal(HALF_TURN_BAR,5);
 for(const uncertain of [[0,5,10,15],[0,5,10],[0]]){
  const h=turnedSession(t,{uncertain});await flush();
  assert.equal(h.statuses.at(-1),UNREAD,`${5-uncertain.length} confident digits`);
  assert.deepEqual(h.events.filter(e=>e.startsWith('grid-')),[]);
 }
});
test('the turn cue needs a poor reading of at least six glyphs, and the upside-down cue HALF_TURN_BAR confident digits',()=>{
 const found=turnedFound();
 assert.equal(turnedPage(found),'upside-down','5 confident of 12 value regions');
 found.puzzle.cells[4]=4;assert.equal(turnedPage(found),null,'6 confident of 12: no poor reading');
 found.puzzle.cells[4]=null;found.puzzle.cells[1]=null;assert.equal(turnedPage(found),null,'4 confident of 12: too few to tell the way up');
 const few=turnedFound({digits:[1,1,null,null,null],size:[20,40]});
 assert.equal(turnedPage(few),'sideways','glyphs wider than tall, whatever the digits');
 assert.equal(turnedPage({...few,entries:few.entries.slice(0,5)}),null,'five glyphs say nothing either way');
});

// The turn takes the place of every line that would ask to move closer or
// to wait for a clearer frame: after a retry that found nothing new, after a
// merged retry, once the retries are spent, with solving off, and when the
// reading has no single solution. A sideways page (glyphs 20 tall and 40
// wide): `full` reads every mark, 4 of them with confidence, and the rest as
// uncertain digits, so that it can be solved; otherwise cell 0 alone is
// uncertain, and retried.
const GRID=[1,2,3,4,2,1,4,3,3,4,1,2,4,3,2,1],TURN_MARKED=[0,1,2,3,4,5,6,7,8,10,12,15];
function sidewaysFound({full=false}={}){
 const puzzle=makePuzzle('latinsquare',4),confident=[0,5,10,15];
 for(const cell of full?TURN_MARKED:confident)puzzle.cells[cell]=GRID[cell];
 const uncertain=full?TURN_MARKED.filter(c=>!confident.includes(c)):[0];
 return {puzzle,markedCells:[...TURN_MARKED],cellUncertain:[...uncertain],uncertain:[...uncertain],cageUncertain:[],notes:[],
  entries:TURN_MARKED.map(cell=>({cell,kind:'value',h:20,w:40,text:Number.isInteger(puzzle.cells[cell])?String(puzzle.cells[cell]):'',
   confidence:Number.isInteger(puzzle.cells[cell])&&!uncertain.includes(cell)?90:0}))};
}
function sidewaysSession(t,{full=false,autoSolve=true,answer=null}={}){
 let time=0,auto=autoSolve;const statuses=[],events=[],retries=[],solves=[];
 const s=createLiveSession({read:async()=>sidewaysFound({full}),readCells:(sample,base,cells)=>new Promise(resolve=>retries.push({cells,resolve})),
  solve:()=>{solves.push(1);return answer?Promise.resolve(answer):new Promise(()=>{});},cancelRead(){},cancelSolve(){},
  onChange(){},onStatus:m=>statuses.push(m),onEvent:e=>events.push(e.reason),autoSolve:()=>auto,isCurrent:()=>true,sameScene:()=>true,now:()=>time});
 const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
 const observe=score=>s.observe({key:'4',rows:4,cols:4,width:100,height:100,corners,image:{width:100,height:100},sharpness:score,
  quality:{score,cellPixels:30,cells:[{cell:0,score,contrast:100}]}});
 s.start();t.after(()=>s.stop());observe(20);observe(20);
 return {s,statuses,events,retries,solves,observe,setTime(v){time=v;},autoSolve(v){auto=v;s.validate();}};
}
// A retry's answer for cell 0 that reads it as before (merged, no change).
const sameClue=n=>{const r=sidewaysFound();return {...r,targetCells:[0],blackLayout:[],ocrStats:{calls:1},
 entries:[{cell:0,kind:'value',h:20,w:40,text:'1',confidence:99,evidence:`retry ${n}`}]};};
test('a sideways reading names the turn after a retry that found nothing new, after merged retries and once they are spent',async t=>{
 const skipped=sidewaysSession(t);await flush();
 assert.equal(skipped.statuses.at(-1),SIDEWAYS);
 skipped.setTime(2000);skipped.observe(60);assert.equal(skipped.retries.length,1,'a clearer frame starts a retry');
 skipped.retries[0].resolve({identicalCrops:true,ocrStats:{calls:0}});await flush();await flush();
 assert.ok(skipped.events.includes('retry-skipped'));
 assert.equal(skipped.statuses.at(-1),SIDEWAYS,'not "No new clue evidence… waiting for a clearer frame"');
 const h=sidewaysSession(t);await flush();
 h.setTime(2000);h.observe(60);h.retries[0].resolve(sameClue(1));await flush();await flush();
 assert.ok(h.events.includes('targeted-complete'));assert.equal(turnedPage(h.s.preview.found),'sideways');
 assert.equal(h.statuses.at(-1),SIDEWAYS,'after the merge, not "Move closer"');
 h.setTime(4000);h.observe(100);assert.equal(h.retries.length,2);
 h.retries[1].resolve(sameClue(2));await flush();await flush();
 assert.equal(h.statuses.at(-1),SIDEWAYS,'after the second merge');
 h.setTime(6000);h.observe(140);
 assert.ok(h.events.includes('retry-exhausted'));
 assert.equal(h.statuses.at(-1),SIDEWAYS,'not "Automatic retries finished"');
});
test('a sideways reading names the turn when it has no solution or several, and with solving off',async t=>{
 assert.equal(turnedPage(sidewaysFound({full:true})),'sideways');
 for(const status of ['no-solution','multiple']){
  const h=sidewaysSession(t,{full:true,answer:{status,complete:true,solutions:[]}});await flush();await flush();
  assert.equal(h.solves.length,1);assert.equal(h.statuses.at(-1),SIDEWAYS,`${status}: not "move closer" or "check the readings"`);
 }
 const off=sidewaysSession(t,{full:true,autoSolve:false});await flush();
 assert.equal(off.statuses.at(-1),SIDEWAYS,'not the counts of the clues read');
 // Solving switched off once the reading had its answer.
 const later=sidewaysSession(t,{full:true,answer:{status:'no-solution',complete:true,solutions:[]}});await flush();await flush();
 later.autoSolve(false);
 assert.equal(later.statuses.at(-1),SIDEWAYS);
});
