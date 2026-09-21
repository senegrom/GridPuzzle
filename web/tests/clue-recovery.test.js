import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle } from '../model.js';
import { recoveryCells, clearerCells, mergeRecoveredClues, validateRetryCells, evidenceKey } from '../clue-recovery.js';
import { createLiveSession } from '../live-session.js';
const flush=()=>new Promise(r=>setImmediate(r));
function found() {
 const puzzle=makePuzzle('latinsquare',2);puzzle.cells=[1,null,null,null];
 return {puzzle,cellUncertain:[1],cageUncertain:[],markedCells:[0,1],uncertain:[1],needsReview:true,
  entries:[{cell:0,kind:'value',text:'1',confidence:99,evidence:'first'},{cell:1,kind:'value',text:'',confidence:0,evidence:'old'}],notes:[]};
}
function retry() {const r=found();r.puzzle.cells=[2,2,null,null];r.entries=[{cell:0,kind:'value',text:'2',confidence:99,evidence:'bad'},
 {cell:1,kind:'value',text:'2',confidence:99,evidence:'new'}];return {...r,targetCells:[1],blackLayout:[]};}
const quality=score=>({score,cellPixels:30,cells:[{cell:1,score,contrast:100}]});
test('targets exclude confirmed clues, genuine blanks and structural families',()=>{
 const f=found();f.cellUncertain=[0,1,2];f.confirmedCells=[0];assert.deepEqual(recoveryCells(f),[1]);
 assert.deepEqual(recoveryCells(f,[1]),[]);
 for(const type of ['kenken','killersudoku','kakuro']){f.puzzle.type=type;assert.deepEqual(recoveryCells(f),[]);}
});
for(const cells of [[],[1,1],[-1],[4],[1.5],Array.from({length:13},(_,i)=>i)])test(`invalid targeted selection ${JSON.stringify(cells)}`,()=>assert.throws(()=>validateRetryCells(cells,2,2)));
test('only a material local improvement qualifies; noise and repeated-quality frames do not',()=>{
 const f=found();assert.deepEqual(clearerCells(f,quality(30),quality(31)),[]);
 assert.deepEqual(clearerCells(f,quality(30),quality(50)),[1]);
 assert.deepEqual(clearerCells(f,quality(30),quality(50),new Map([[1,2]])),[]);
 assert.deepEqual(clearerCells(f,quality(30),{...quality(50),cells:[{cell:1,score:50,contrast:20}]}),[]);
});
test('targeted merge never replaces a confident clue and every recovery remains reviewable',()=>{
 const f=found(),before=JSON.stringify(f),merged=mergeRecoveredClues(f,retry(),[1]);
 assert.deepEqual(merged.puzzle.cells,[1,2,null,null]);assert.deepEqual(merged.cellUncertain,[1]);
 assert.equal(merged.entries.find(e=>e.cell===0).confidence,99);assert.equal(merged.entries.find(e=>e.cell===1).confidence,0);
 assert.equal(merged.needsReview,true);assert.equal(JSON.stringify(f),before);
});
test('identical evidence and absent marks neither vote nor erase a previous clue',()=>{
 const f=found();f.puzzle.cells[1]=1;
 const r=retry();r.entries[1].evidence='old';let merged=mergeRecoveredClues(f,r,[1]);assert.equal(merged.puzzle.cells[1],1);assert.deepEqual(merged.recovery.repeated,[1]);
 r.puzzle.cells[1]=null;r.entries=[];merged=mergeRecoveredClues(f,r,[1]);assert.equal(merged.puzzle.cells[1],1);
 assert.equal(merged.recovery.proposals,0);
});
test('a source/rule mismatch rejects the entire targeted result',()=>{
 for(const mutate of [r=>r.puzzle.type='numbrix',r=>r.puzzle.rows=3,r=>r.targetCells=[0]]){
  const r=retry();mutate(r);assert.throws(()=>mergeRecoveredClues(found(),r,[1]));
 }
});
test('changed black-cell layout never silently patches a Str8ts board',()=>{
 const f=found();f.puzzle.type='str8ts';f.puzzle.black=[];const r=retry();r.puzzle.type='str8ts';r.puzzle.black=[];r.blackLayout=[3];
 assert.throws(()=>mergeRecoveredClues(f,r,[1]),/layout changed/);
});
test('exact-crop evidence keys are deterministic and distinguish changed pixels',()=>{
 assert.equal(evidenceKey(['png1','gray']),evidenceKey(['png1','gray']));assert.notEqual(evidenceKey(['png1','gray']),evidenceKey(['png2','gray']));
});
function session(t) {
 let time=0,visible=true,reads=0;const retries=[],events=[];
 const s=createLiveSession({read:async()=>{reads++;return found();},readCells:(sample,base,cells)=>new Promise(resolve=>retries.push({sample,base,cells,resolve})),
 solve:async()=>null,cancelRead(){},cancelSolve(){},onChange(){},onStatus(){},onEvent:e=>events.push(e),autoSolve:()=>false,
 isCurrent:()=>visible,sameScene:()=>true,now:()=>time});
 const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
 const observe=(score=20)=>s.observe({key:'same',rows:2,cols:2,width:100,height:100,corners,image:{width:100,height:100},sharpness:score,quality:quality(score)});
 s.start();observe();observe();t.after(()=>s.stop());
 return {s,retries,events,observe,setTime(v){time=v;},visible(v){visible=v;s.validate();},get reads(){return reads;}};
}
test('a clearer live frame retries only the unresolved cell and does not repeat full OCR',async t=>{
 const h=session(t);await flush();h.setTime(1600);h.observe(60);assert.equal(h.reads,1);assert.equal(h.retries.length,1);assert.deepEqual(h.retries[0].cells,[1]);
 h.retries[0].resolve(retry());await flush();assert.deepEqual(h.s.preview.found.puzzle.cells,[1,2,null,null]);assert.ok(h.s.preview.found.cellUncertain.includes(1));
 assert.deepEqual(h.events.find(e=>e.reason==='targeted-complete').found.puzzle.cells,[1,2,null,null],'diagnostics receive the applied reading, not just the original full scan');
 h.setTime(4000);h.observe(60);assert.equal(h.retries.length,1,'identical frame quality must not become another vote');assert.equal(h.reads,1);
});
test('retired targeted replies cannot replace a new scene',async t=>{
 const h=session(t);await flush();h.setTime(1600);h.observe(60);h.s.invalidate();h.retries[0].resolve(retry());await flush();assert.equal(h.s.preview,null);
});
test('targeted results finish while hidden and require re-verification before applying',async t=>{
 const h=session(t);await flush();h.setTime(1600);h.observe(60);h.visible(false);h.retries[0].resolve(retry());await flush();assert.equal(h.s.preview,null);
 h.visible(true);assert.equal(h.s.preview.found.puzzle.cells[1],2);assert.equal(h.reads,1);
});
test('a cell explicitly confirmed before retry merge remains untouched',()=>{
 const f=found();f.confirmedCells=[1];assert.equal(mergeRecoveredClues(f,retry(),[1]).puzzle.cells[1],null);
});

test('accepted retry evidence refreshes the review picture without changing protected clues',()=>{
 const f=found(),r=retry();f.rectified={source:'original'};r.rectified={source:'clearer'};
 const updated=mergeRecoveredClues(f,r,[1]);
 assert.equal(updated.rectified,r.rectified);assert.equal(updated.puzzle.cells[0],f.puzzle.cells[0]);
 r.entries=[];const empty=mergeRecoveredClues(f,r,[1]);assert.equal(empty.rectified,f.rectified,'empty retries do not discard the original review evidence');
});
