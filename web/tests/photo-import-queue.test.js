// Actual import controller and shared original-detail queue, controlled codecs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhotoFlow } from '../photo-flow.js';
import { photoDetail, retainPhotoSource } from '../photo-detail.js';
import { makePuzzle, boxShape } from '../model.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
function imageFile(name, header) {
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(bytes.buffer); view.setUint32(16,4000); view.setUint32(20,3000);
  const file = new Blob([bytes], {type:'image/png'}); file.name = name;
  if (header) file.slice = () => ({arrayBuffer: () => header.promise});
  return {file, bytes:bytes.buffer};
}
function harness(t, fallback = false) {
  const nodes = new Map(), jobs = [], promises = [], errors = [], accepted = [], urls = new Map();
  let epoch=0, active=0, maximum=0;
  const noop = () => {}, canvas = () => {
    const ctx = new Proxy({drawImage(source) { this.source=source; }}, {get: (o,k) => o[k] ?? noop});
    return {width:600,height:600,getContext:()=>ctx};
  };
  const $ = id => { if(!nodes.has(id)) nodes.set(id,{...canvas(),value:'',hidden:true,checked:false,style:{},focus:noop,scrollIntoView:noop}); return nodes.get(id); };
  const old = ['document','createImageBitmap','Image'].map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]);
  t.mock.timers.enable({apis:['setTimeout']});
  globalThis.document = {createElement:canvas,addEventListener:noop,body:{classList:{add:noop,remove:noop}}};
  const decode = (name, options, bitmap) => {
    active++; maximum=Math.max(maximum,active);
    const pending=deferred(), job={name,options,bitmap,finished:false,finish(error) {
      if(this.finished)return; this.finished=true; active--;
      if(error)pending.reject(error); else pending.resolve(bitmap);
    }};
    jobs.push(job); return pending.promise;
  };
  globalThis.createImageBitmap = fallback ? undefined : (file,options) => {
    const bitmap={name:file.name,width:options.resizeWidth ?? 4000,height:options.resizeWidth ? 1200 : 3000,close() { this.closed=true; }};
    return decode(file.name,options,bitmap);
  };
  t.mock.method(URL,'createObjectURL',file => {const url=`blob:photo-${urls.size}`; urls.set(url,file.name); return url;});
  t.mock.method(URL,'revokeObjectURL',noop);
  globalThis.Image = class {
    naturalWidth=1600; naturalHeight=1200;
    decode() { this.name=urls.get(this.src); return decode(this.name,null,this); }
  };
  const state = {puzzle:makePuzzle('sudoku',9),photo:null,history:[]};
  const setLayout = layout => {for(const [k,id] of [['rows','rows'],['cols','cols'],['boxRows','box-rows'],['boxCols','box-cols']]) $(id).value=String(layout[k]);};
  setLayout(state.puzzle); $('puzzle-type').value='sudoku';
  const flow=setupPhotoFlow({$,state,scanner:{async detect(c) {
    accepted.push(c.getContext().source.name);
    return {rows:9,cols:9,confidence:.99,corners:[{x:0,y:0},{x:c.width-1,y:0},{x:c.width-1,y:c.height-1},{x:0,y:c.height-1}]};
  }},stopTask:()=>++epoch,invalidate:()=>++epoch,begin:()=>++epoch,getJobId:()=>epoch,
    finish:noop,fail:e=>errors.push(e.message),render:noop,status:noop,persist:noop,remember:noop,drawBoard:noop,clearPhotoMapping:noop,
    solveNow:noop,setLayout,boxDefault:boxShape,setDeadline:noop});
  t.after(async()=>{
    epoch++; for(const job of jobs) job.finish(); t.mock.timers.tick(15000);
    await Promise.allSettled(promises); flow.stopCamera();
    for(const [k,d] of old) d ? Object.defineProperty(globalThis,k,d) : delete globalThis[k];
  });
  return {jobs,errors,accepted,urls,state,track(p){promises.push(p);return p;},
    select(file) {const done=$('photo-file').onchange({target:{files:[file],value:file.name}});promises.push(done);return done;},
    get maximum(){return maximum;}, async advance(ms){t.mock.timers.tick(ms);await tick();}};
}
for(const fallback of [false,true]) test(`rapid imports use one codec and skip obsolete queued selections, fallback ${fallback}`,async t=>{
  const h=harness(t,fallback), a=h.select(imageFile('A').file); await tick();
  const b=h.select(imageFile('B').file); await tick(); const c=h.select(imageFile('C').file); await tick();
  assert.deepEqual(h.jobs.map(j=>j.name),['A']); h.jobs[0].finish(); await a; await b; await tick();
  assert.deepEqual(h.jobs.map(j=>j.name),['A','C']); h.jobs[1].finish(); await c;
  assert.equal(h.maximum,1); assert.deepEqual(h.accepted,['C']); assert.deepEqual(h.errors,[]);
  if(!fallback) assert.ok(h.jobs.every(j=>j.bitmap.closed));
  else assert.equal(URL.revokeObjectURL.mock.callCount(),2);
});
test('an import superseded while reading its header never starts a native decode',async t=>{
  const h=harness(t), header=deferred(), a=imageFile('A',header), first=h.select(a.file);
  const second=h.select(imageFile('B').file); await tick(); header.resolve(a.bytes); await first;
  assert.deepEqual(h.jobs.map(j=>j.name),['B']); h.jobs[0].finish(); await second; assert.deepEqual(h.accepted,['B']);
});
test('a failed obsolete bitmap does not start a fallback decode before the new import',async t=>{
  const h=harness(t), a=h.select(imageFile('A').file); await tick(); const b=h.select(imageFile('B').file); await tick();
  h.jobs[0].finish(Error('obsolete codec failure')); await a; await tick();
  assert.deepEqual(h.jobs.map(j=>j.name),['A','B']); assert.equal(h.urls.size,0);
  h.jobs[1].finish(); await b; assert.deepEqual(h.errors,[]); assert.equal(h.maximum,1);
});
test('a timed-out import waiter cannot release the unfinished codec or overwrite a retry',async t=>{
  const h=harness(t), a=h.select(imageFile('A').file); await tick(); const b=h.select(imageFile('B').file); await tick();
  await h.advance(15000); await b; assert.match(h.errors[0],/still decoding/);
  const c=h.select(imageFile('C').file); await tick(); assert.equal(h.jobs.length,1);
  h.jobs[0].finish(); await a; await tick(); assert.deepEqual(h.jobs.map(j=>j.name),['A','C']);
  h.jobs[1].finish(); await c; assert.equal(h.maximum,1); assert.deepEqual(h.accepted,['C']);
});
test('an original-detail decode and a new initial import share the same owner',async t=>{
  const h=harness(t), f=imageFile('detail').file, preview=retainPhotoSource({width:800,height:600},f,{width:4000,height:3000});
  const detail=h.track(photoDetail(preview,[{x:0,y:0},{x:799,y:0},{x:799,y:599},{x:0,y:599}]));
  await tick(); const imported=h.select(imageFile('import').file); await tick(); assert.equal(h.jobs.length,1);
  h.jobs[0].finish(); const crop=await detail; crop.release(); await tick();
  assert.deepEqual(h.jobs.map(j=>j.name),['detail','import']); h.jobs[1].finish(); await imported;
  assert.equal(h.maximum,1); assert.ok(h.jobs.every(j=>j.bitmap.closed));
});
