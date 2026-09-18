import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parsePuzzleFile, puzzleDefinition } from '../backup.js';
import { makePuzzle, demo, fitPlay, conflicts, playConflicts } from '../model.js';
import { createLiveSession } from '../live-session.js';
import { cameraModal } from '../camera-modal.js';
function state() {
  const puzzle = makePuzzle('latinsquare', 2); puzzle.cells[0] = 1;
  return { puzzle, uncertain: new Set([0]), cageUncertain: new Set(), needsReview: true,
    notes: ['Check the photograph'], blackReadings: [], play: [null, 2, null, null], hints: new Set([1]) };
}
test('backup round trip preserves warnings, notes, progress and hint ownership, not solutions or photos', () => {
  const s=state(); s.photo='PRIVATE PHOTO'; s.result={solutions:['PRIVATE SOLUTION']};
  const file=JSON.stringify(createBackup(s,'play')), r=parsePuzzleFile(JSON.parse(file));
  assert.deepEqual(r.puzzle,s.puzzle); assert.deepEqual(r.uncertain,[0]); assert.equal(r.needsReview,true);
  assert.deepEqual(r.play,s.play); assert.deepEqual(r.hints,[1]); assert.deepEqual(r.notes,s.notes);
  assert.equal(r.editing,'play'); assert.doesNotMatch(file,/PRIVATE/);
});
test('confirmed backups stay confirmed, while legacy definitions explicitly require review', () => {
  const s=state(); s.uncertain.clear();s.needsReview=false;
  assert.equal(parsePuzzleFile(createBackup(s)).needsReview,false);
  const legacy=parsePuzzleFile(puzzleDefinition(s)); assert.equal(legacy.needsReview,true);
  assert.ok(legacy.notes[0].includes('no saved review state')); assert.deepEqual(legacy.play,[null,null,null,null]);
});
test('puzzle-only export cannot discard any outstanding review evidence', () => {
  for (const flags of [{needsReview:true},{uncertain:new Set([0])},{cageUncertain:new Set([0])},{blackReadings:[{cell:0,value:1}]}]) {
    assert.throws(()=>puzzleDefinition({...state(),needsReview:false,uncertain:new Set(),cageUncertain:new Set(),...flags}),/backup|review/i);
  }
});
test('separate cell/cage warnings survive backup and inconsistent unions are rejected',()=>{
  const s=state();s.cageUncertain.add(1);
  const b=createBackup(s),r=parsePuzzleFile(b);assert.deepEqual(r.uncertain,[0]);assert.deepEqual(r.cageUncertain,[1]);
  b.session.uncertain=[];assert.throws(()=>parsePuzzleFile(b),/Inconsistent/);
});
for (const [name,modify] of [
  ['new version',b=>b.version=2],['unknown field',b=>b.solution=[]],['missing flags',b=>delete b.session.cellUncertain],
  ['invalid index',b=>b.session.cellUncertain=[99]],['string review',b=>b.session.needsReview='false'],
  ['progress on given',b=>b.session.play[0]=2],['invalid progress',b=>b.session.play[1]=99],
  ['unowned hint',b=>b.session.hints=[2]],['extra puzzle key',b=>b.session.puzzle.execute='bad'],
  ['invalid notes',b=>b.session.notes=[{}]],['black evidence on white',b=>b.session.blackReadings=[{cell:0,value:7}]],
]) test(`backup rejects ${name} without changing its source`,()=>{
  const b=createBackup(state());modify(b);const prior=JSON.stringify(b);assert.throws(()=>parsePuzzleFile(b));assert.equal(JSON.stringify(b),prior);
});
test('black-cell OCR evidence survives a backup and keeps its cell flagged',()=>{
 const puzzle=makePuzzle('hidato',2);puzzle.cells[0]='#';
 const s={...state(),puzzle,blackReadings:[{cell:0,value:7}],play:fitPlay(puzzle,[]),hints:new Set()};
 const r=parsePuzzleFile(createBackup(s));assert.deepEqual(r.blackReadings,s.blackReadings);assert.ok(r.uncertain.includes(0));
});
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
test('Kakuro duplicate and impossible partial sums have immediate feedback while valid answers do not',()=>{
 const p=demo('kakuro'),play=fitPlay(p,[]);play[5]=1;
 assert.ok(playConflicts(p,play).has(5));play[5]=2;assert.equal(playConflicts(p,play).size,0);
 const q=makePuzzle('kakuro',3,3);q.cells=['#','#','#','#',null,null,'#',null,null];q.clues=[{cell:3,across:17}];
 q.cells[4]=1;assert.ok(conflicts(q).has(4));q.cells[4]=8;assert.equal(conflicts(q).size,0);
});
test('Killer cages enforce distinct digits across different rows and boxes',()=>{
 const p=makePuzzle('killersudoku',4);p.cages=[{cells:[1,2,6],target:6,op:'+'}];p.cells[1]=1;p.cells[2]=4;p.cells[6]=1;
 assert.ok(conflicts(p).has(6));p.cells[2]=3;p.cells[6]=2;assert.equal(conflicts(p).size,0);
 p.cells[6]=null;p.cages[0].target=20;assert.ok(conflicts(p).has(1));
});
for (const [op,target,invalid,valid] of [['+',3,[1,3],[1,2]],['*',6,[1,2],[2,3]],['-',2,[1,2],[1,3]],['/',3,[2,3],[1,3]]])
 test(`KenKen ${op} cage arithmetic is checked without changing puzzle data`,()=>{
  const p=makePuzzle('kenken',4);p.cages=[{cells:[0,1],target,op}];
  [p.cells[0],p.cells[1]]=invalid;const before=JSON.stringify(p);assert.ok(conflicts(p).has(0));assert.equal(JSON.stringify(p),before);
  [p.cells[0],p.cells[1]]=valid;assert.equal(conflicts(p).size,0);
 });
test('KenKen products use exact integers and do not reject possible partial cages',()=>{
 const p=makePuzzle('kenken',4);p.cages=[{cells:[0,1],target:6,op:'*'}];p.cells[0]=2;assert.equal(conflicts(p).size,0);
 p.cells[0]=4;assert.ok(conflicts(p).has(0));
});
function modalHarness() {
 const handlers=new Map();const doc={activeElement:null,addEventListener(t,cb){if(!handlers.has(t))handlers.set(t,new Set());handlers.get(t).add(cb);},removeEventListener(t,cb){handlers.get(t)?.delete(cb);}};
 const node=()=>({inert:false,tabIndex:0,isConnected:true,focus(){doc.activeElement=this;},setAttribute(){},removeAttribute(){}});
 const outside=node(),earlier=node(),a=node(),b=node(),panel=node(); earlier.inert=true;
 panel.contains=n=>n===panel||n===a||n===b;panel.querySelectorAll=()=>[a,b];
 const section={children:[panel,outside]},body={children:[section,earlier]};panel.parentElement=section;section.parentElement=body;
 const modal=cameraModal(panel,outside,doc);doc.activeElement=outside;
 return {modal,panel,outside,earlier,a,b,doc,send(event){for(const cb of [...handlers.get(event.type)||[]])cb(event);}};
}
test('camera modal makes every background branch inert and restores pre-existing state',()=>{
 const h=modalHarness();h.modal.open();assert.equal(h.outside.inert,true);assert.equal(h.earlier.inert,true);
 h.modal.close();assert.equal(h.outside.inert,false);assert.equal(h.earlier.inert,true);assert.equal(h.doc.activeElement,h.outside);
 h.modal.close();assert.equal(h.outside.inert,false);
});
test('camera modal wraps Tab and Shift+Tab and redirects escaped focus',()=>{
 const h=modalHarness();h.modal.open();h.a.focus();let prevented=0;
 h.send({type:'keydown',key:'Tab',shiftKey:true,preventDefault(){prevented++;}});assert.equal(h.doc.activeElement,h.b);
 h.send({type:'keydown',key:'Tab',preventDefault(){prevented++;}});assert.equal(h.doc.activeElement,h.a);assert.equal(prevented,2);
 h.outside.focus();h.send({type:'focusin',target:h.outside});assert.equal(h.doc.activeElement,h.a);h.modal.close();
});

test('backup black-cell object key order does not affect valid metadata',()=>{
 const puzzle=makePuzzle('hidato',2);puzzle.cells[0]='#';
 const b=createBackup({...state(),puzzle,blackReadings:[{cell:0,value:7}],play:fitPlay(puzzle,[]),hints:new Set()});
 b.session.blackReadings=[{value:7,cell:0}];
 assert.deepEqual(parsePuzzleFile(b).blackReadings,[{cell:0,value:7}]);
});
