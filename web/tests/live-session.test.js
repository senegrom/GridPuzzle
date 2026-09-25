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
