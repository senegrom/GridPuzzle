import test from 'node:test';
import assert from 'node:assert/strict';
import { setupClueReread } from '../clue-reread.js';
import { makePuzzle } from '../model.js';
function harness() {
  const nodes=new Map(),jobs=[],timers=new Map();let pixel=180,cancels=0;
  const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,open:true,value:'',checked:false,events:{},textContent:'',focus(){},addEventListener(event,fn){this.events[event]=fn;}});return nodes.get(id);};
  const p=makePuzzle('latinsquare',2);p.cells[0]=1;
  const s={puzzle:p,cell:0,uncertain:new Set([0]),image:{width:200,height:200,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(4).fill(pixel)})})},source:1,photoSource:1,rows:2,cols:2};
  $('cell-value').value='1';
  const api=setupClueReread({$,getSelection:()=>s,makeReader:()=>({cancel(){cancels++;},readCells(...args){return new Promise((resolve,reject)=>jobs.push({args,resolve,reject}));}}),
    setTimer(fn){timers.set(1,fn);return 1;},clearTimer:id=>timers.delete(id)});
  const result=(value=2)=>{const puzzle=makePuzzle('latinsquare',2);puzzle.cells[0]=value;return {puzzle,targetCells:[0],entries:[{cell:0,kind:'value',text:String(value),confidence:20}]};};
  api.open();return {$,s,api,jobs,timers,result,changePixels(){pixel++;},get cancels(){return cancels;}};
}
test('a selected numeric re-read only offers a proposal; even Use does not confirm the puzzle',async()=>{
 const h=harness(),before=structuredClone(h.s.puzzle);const pending=h.$('reread-clue').onclick();
 assert.deepEqual(h.jobs[0].args[3],[0]);h.jobs[0].resolve(h.result());await pending;
 assert.deepEqual(h.s.puzzle,before);assert.equal(h.$('cell-value').value,'1');assert.equal(h.$('use-reread').hidden,false);
 h.$('use-reread').onclick();assert.equal(h.$('cell-value').value,'2');assert.deepEqual(h.s.puzzle,before);assert.ok(h.s.uncertain.has(0));
});
for(const change of ['close','cell','photo','puzzle','draft','confirmed'])test(`late proposal cannot survive ${change}`,async()=>{
 const h=harness(),pending=h.$('reread-clue').onclick();
 if(change==='close'){h.$('cell-dialog').open=false;h.$('cell-dialog').events.close();}
 if(change==='cell')h.s.cell=1;
 if(change==='photo')h.s.photoSource=2;
 if(change==='puzzle')h.s.puzzle.cells[1]=2;
 if(change==='draft'){h.$('cell-value').value='9';h.$('cell-value').events.input();}
 if(change==='confirmed')h.s.uncertain.clear();
 h.jobs[0].resolve(h.result());await pending;assert.equal(h.$('use-reread').hidden,true);assert.equal(h.s.puzzle.cells[0],1);
});
test('identical source pixels use the cached proposal, changed pixels re-read',async()=>{
 const h=harness();let done=h.$('reread-clue').onclick();h.jobs[0].resolve(h.result());await done;
 await h.$('reread-clue').onclick();assert.equal(h.jobs.length,1);assert.match(h.$('reread-status').textContent,/cached/);
 h.changePixels();done=h.$('reread-clue').onclick();assert.equal(h.jobs.length,2);h.jobs[1].resolve(h.result());await done;
});
test('unread or wrong-grid result offers no numeric replacement',async()=>{
 for(const wrong of [false,true]){
  const h=harness(),done=h.$('reread-clue').onclick(),result=h.result();
  if(wrong)result.puzzle=makePuzzle('latinsquare',3);else result.entries=[];
  h.jobs[0].resolve(result);await done;assert.equal(h.$('use-reread').hidden,true);assert.equal(h.$('cell-value').value,'1');
 }
});
test('timeout preserves the draft and prevents a late result from replacing it',async()=>{
 const h=harness(),done=h.$('reread-clue').onclick();h.timers.get(1)();h.jobs[0].resolve(h.result());await done;
 assert.equal(h.$('use-reread').hidden,true);assert.equal(h.$('cell-value').value,'1');assert.equal(h.timers.size,0);
});
for(const state of ['play','confirmed','noPhoto','structural','badMapping'])test(`re-reading is unavailable for ${state}`,async()=>{
 const h=harness();if(state==='play')h.s.play=true;if(state==='confirmed')h.s.uncertain.clear();if(state==='noPhoto')h.s.image=null;
 if(state==='structural')h.s.puzzle.type='kakuro';if(state==='badMapping')h.s.cols=3;
 h.api.open();assert.equal(h.$('reread-clue-panel').hidden,true);await h.$('reread-clue').onclick();assert.equal(h.jobs.length,0);
});

function canvas(width = 600, height = 600) {
  const ctx = new Proxy({
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    drawImage(source) { this.source = source; },
  }, { get: (o, k) => o[k] ?? (() => {}) });
  return { width, height, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,aA==' };
}

function node(id) {
  const callbacks = new Map();
  return { ...canvas(), id, value: '', textContent: '', checked: false, hidden: false, disabled: false,
    open: false, style: {}, dataset: {}, focus() {}, scrollIntoView() {}, setAttribute() {},
    removeAttribute(key) { delete this[key]; },
    addEventListener(type, fn) { if (!callbacks.has(type)) callbacks.set(type, []); callbacks.get(type).push(fn); },
    emit(type) { for (const fn of callbacks.get(type) ?? []) fn({ type, target: this }); },
    pause() {}, load() {}, async play() {},
  };
}

test('queued close from the previous clue cannot cancel a reopened clue, but genuine close cancels it', async () => {
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  const p = makePuzzle('latinsquare', 2); p.cells = [1, 2, null, null];
  const selection = { puzzle: p, cell: 0, uncertain: new Set([0, 1]), image: canvas(200, 200),
    source: 7, photoSource: 7, rows: 2, cols: 2 };
  const jobs = []; let cancellations = 0;
  const reread = setupClueReread({ $, getSelection: () => selection,
    makeReader: () => ({ cancel() { cancellations++; }, readCells: (...args) => new Promise(resolve => jobs.push({ resolve, cell: args[3][0] })) }) });
  $('cell-dialog').open = true; reread.open(); const old = $('reread-clue').onclick();
  selection.cell = 1; selection.uncertain.delete(0); reread.open();
  const current = $('reread-clue').onclick(), before = cancellations;
  $('cell-dialog').emit('close'); assert.equal(cancellations, before);
  assert.equal($('reread-clue-panel').hidden, false); assert.equal($('reread-clue').disabled, true);
  jobs[0].resolve({}); await old; assert.equal($('reread-clue').disabled, true);
  $('cell-dialog').open = false; $('cell-dialog').emit('close');
  assert.equal(cancellations, before + 1); assert.equal($('reread-clue-panel').hidden, true);
  jobs[1].resolve({}); await current; assert.equal($('use-reread').hidden, true);
});
