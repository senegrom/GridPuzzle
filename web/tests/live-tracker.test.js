import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createLiveTracker } from '../live-tracker.js';
import { createTrackingCore } from '../live-tracking-core.js';
import { gridAnchor, matchGrid } from '../live-registration.js';
const flush = () => new Promise(r => setImmediate(r));
const image = (width=64,height=64) => ({width,height,data:new Uint8ClampedArray(width*height*4).fill(180)});
function harness() {
  const workers=[],timers=new Map();let serial=0;
  const tracker=createLiveTracker({makeWorker(){const worker={sent:[],postMessage(data,transfer){
    this.sent.push(structuredClone(data,{transfer}));},terminate(){this.terminated=true;}};workers.push(worker);return worker;},
    setTimer(fn){timers.set(++serial,fn);return serial;},clearTimer(id){timers.delete(id);}});
  const reply=(worker,result={proofs:{}})=>worker.onmessage({data:{id:worker.sent.at(-1).id,result,milliseconds:3}});
  return {tracker,workers,timers,reply};
}
test('only the latest unsent video frame survives; pixels are transferred, not reused',async()=>{
  const h=harness(),a=image();const first=h.tracker.verify({image:a,anchors:[]});assert.equal(a.data.byteLength,0);
  const second=h.tracker.verify({image:image(),anchors:[]});const cancelled=assert.rejects(second,{name:'AbortError'});
  const third=h.tracker.verify({image:image(),anchors:[]});await cancelled;
  assert.equal(h.tracker.stats.queuedFrames,1);assert.equal(h.workers[0].sent.length,1);
  h.reply(h.workers[0]);await first;assert.equal(h.workers[0].sent.length,2);h.reply(h.workers[0]);await third;
  assert.equal(h.tracker.stats.dropped,1);assert.equal(h.timers.size,0);h.tracker.reset();
});
test('anchor creation is bounded and runs before a queued video verification',async()=>{
  const h=harness(),one=h.tracker.verify({image:image(),anchors:[]}),next=h.tracker.verify({image:image(),anchors:[]});
  const anchor=h.tracker.anchor({image:image(),anchors:[]});h.reply(h.workers[0]);await one;
  assert.equal(h.workers[0].sent.at(-1).op,'anchor');h.reply(h.workers[0],{anchor:{id:1}});await anchor;
  assert.equal(h.workers[0].sent.at(-1).op,'verify');h.reply(h.workers[0]);await next;h.tracker.reset();
});
test('stop rejects active and queued work and late old-worker replies cannot settle a restart',async()=>{
  const h=harness(),a=h.tracker.verify({image:image(),anchors:[]}),b=h.tracker.verify({image:image(),anchors:[]});
  const old=h.workers[0],late=old.onmessage;const ar=assert.rejects(a,{name:'AbortError'}),br=assert.rejects(b,{name:'AbortError'});
  h.tracker.reset();await Promise.all([ar,br]);assert.ok(old.terminated);assert.equal(h.timers.size,0);
  let settled=false;const current=h.tracker.verify({image:image(),anchors:[]}).then(()=>{settled=true;});
  late({data:{id:h.workers[1].sent[0].id,result:{proofs:{1:{corners:[]}}}}});await flush();assert.equal(settled,false);
  h.reply(h.workers[1]);await current;h.tracker.reset();
});
for(const failure of ['error','message','timeout','post'])test(`tracking ${failure} fails closed and can restart`,async()=>{
 const h=harness();if(failure==='post'){
  const warm=h.tracker.verify({image:image(),anchors:[]});h.reply(h.workers[0]);await warm;
  h.workers[0].postMessage=()=>{throw Error('post failed');};
 }
 const p=h.tracker.verify({image:image(),anchors:[]}),rejected=assert.rejects(p);
 const old=h.workers[0];
 if(failure==='error')old.onerror({message:'failed'});
 if(failure==='message')old.onmessageerror();
 if(failure==='timeout')[...h.timers.values()][0]();
 await rejected;assert.ok(old.terminated);assert.equal(h.tracker.stats.failures,1);
 const next=h.tracker.verify({image:image(),anchors:[]});h.reply(h.workers[1]);await next;h.tracker.reset();
});
test('worker anchor cache is bounded, protects retained anchors and returns no source rasters',()=>{
 const core=createTrackingCore(),corners=[{x:1,y:1},{x:62,y:1},{x:62,y:62},{x:1,y:62}];
 let original;
 for(let i=0;i<20;i++){
  const result=core.run({op:'anchor',image:image(),corners,rows:2,cols:2,anchors:original?[original]:[]});
  original??=result.anchor.id;assert.ok(core.size<=8);assert.equal(result.anchor.image,undefined);assert.equal(result.anchor.gray,undefined);
 }
 const result=core.run({op:'verify',image:image(),anchors:[original,999]});assert.ok(result.proofs[original]);assert.equal(result.proofs[999],null);
});
test('worker matcher preserves existing identity decisions for motion and changed ink',()=>{
 const w=400,h=400,base=image(w,h);base.data.fill(255);
 const paint=(img,x,y,ww,hh,v)=>{for(let yy=y;yy<y+hh;yy++)for(let xx=x;xx<x+ww;xx++)for(let k=0;k<3;k++)img.data[4*(yy*w+xx)+k]=v;};
 for(let i=0;i<=4;i++){paint(base,40+i*80,40,2,322,20);paint(base,40,40+i*80,322,2,20);}
 for(let r=0;r<4;r++)for(let c=0;c<4;c++){paint(base,65+c*80, sixty(r),5,35,20);paint(base,65+c*80,sixty(r),19,5,20);}
 function sixty(r){return 62+r*80;}
 const corners=[{x:40,y:40},{x:360,y:40},{x:360,y:360},{x:40,y:360}],core=createTrackingCore();
 const id=core.run({op:'anchor',image:base,corners,rows:4,cols:4,anchors:[]}).anchor.id,anchor=gridAnchor(base,corners,4,4);
 for(const changed of [false,true]){
  const next=image(w,h);next.data.fill(255);
  for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++)for(let k=0;k<4;k++)next.data[4*((y+1)*w+x+1)+k]=base.data[4*(y*w+x)+k];
  if(changed)paint(next,150,145,40,60,100);
  const direct=matchGrid(anchor,next),reply=core.run({op:'verify',image:next,anchors:[id]});
  assert.equal(!!reply.proofs[id],!!direct);assert.equal(!!direct,!changed);
 }
});
test('the actual tracking worker runs in a separate thread with transferred frames',async t=>{
 let thread;
 const url=new URL('../live-tracking-worker.js',import.meta.url).href;
 const tracker=createLiveTracker({makeWorker(){
  const script=`const {parentPort}=require('node:worker_threads');global.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`;
  thread=new NodeWorker(script,{eval:true});
  const host={postMessage:(data,transfer)=>thread.postMessage(data,transfer),terminate:()=>thread.terminate()};
  thread.on('message',data=>host.onmessage?.({data}));thread.on('error',error=>host.onerror?.(error));return host;
 }});t.after(()=>tracker.reset());
 const pixels=image(),corners=[{x:1,y:1},{x:62,y:1},{x:62,y:62},{x:1,y:62}];
 const created=await tracker.anchor({image:pixels,corners,rows:2,cols:2,anchors:[]});
 assert.equal(pixels.data.byteLength,0);assert.ok(thread.threadId>0);
 const verified=await tracker.verify({image:image(),anchors:[created.anchor.id]});assert.ok(verified.proofs[created.anchor.id]);
});
