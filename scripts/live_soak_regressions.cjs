/* A bounded lifecycle soak with real canvas pixels and real tracking workers.
   Video clocks, detector and OCR replies are controlled; this is a resource/
   ownership test, not an optical accuracy or physical memory benchmark. */
const assert=require('node:assert/strict');
const {serve,engines,main}=require('./harness.cjs');
async function soak(){
  const {createLiveCamera}=await import('./live-camera.js'),{createLiveTracker}=await import('./live-tracker.js'),{createScanDiagnostics}=await import('./scan-diagnostics.js'),{makePuzzle}=await import('./model.js');
  const source=document.createElement('canvas'),out=document.createElement('canvas');source.width=source.height=400;
  Object.defineProperties(source,{videoWidth:{get:()=>source.width},videoHeight:{get:()=>source.height},currentTime:{get:()=>performance.now()/1000}});
  const paint=()=>{const c=source.getContext('2d');c.fillStyle='white';c.fillRect(0,0,source.width,source.height);c.fillStyle='black';c.fillRect(50,50,15,50);c.fillRect(120,120,20,40);};paint();
  const timers=new Set(),workers=new Set(),history=[];let made=0,peak=0,warm=0,readSerial=0;
  // Every ImageBitmap made on this thread (the bitmap transport's frames and
  // probes), every close() of one that still had pixels, and every one in the
  // transfer list of a message a tracking worker accepted: after each stop,
  // each must have been transferred or closed here, and none is left with
  // pixels (a transferred one is detached: 0 x 0).
  const bitmaps=[],closed=new Set(),transferred=new Set(),makeBitmap=window.createImageBitmap,closeBitmap=globalThis.ImageBitmap?.prototype.close;
  if(makeBitmap)window.createImageBitmap=async(...args)=>{const b=await makeBitmap.apply(window,args);bitmaps.push(b);return b;};
  if(closeBitmap)ImageBitmap.prototype.close=function(){if(this.width||this.height)closed.add(this);return closeBitmap.call(this);};
  const balance=()=>({created:bitmaps.length,closed:closed.size,transferred:transferred.size,open:bitmaps.filter(b=>b.width||b.height).length});
  const set=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clear=id=>{clearTimeout(id);timers.delete(id);};
  const tracker=createLiveTracker({setTimer:set,clearTimer:clear,makeWorker(){
    const w=new Worker(new URL('./live-tracking-worker.js',location.href),{type:'module'});workers.add(w);made++;peak=Math.max(peak,workers.size);
    const host={postMessage(m,t){w.postMessage(m,t);for(const item of t??[])if(bitmaps.includes(item))transferred.add(item);},terminate(){w.terminate();workers.delete(w);}};
    w.onmessage=e=>set(()=>host.onmessage?.(e),20);w.onerror=e=>host.onerror?.(e);return host;
  }});
  const diagnostics=createScanDiagnostics();diagnostics.begin('live',{});let ended=false;
  const camera=createLiveCamera({$:id=>document.getElementById(id),video:source,canvas:out,tracker,diagnostics,setTimer:set,clearTimer:clear,
    getSettings:()=>({type:'latinsquare',rows:2,cols:2,enabled:true,autoSolve:false}),
    detector:{cancel(){},async detect(){const n=++readSerial;await new Promise(r=>setTimeout(r,20));return{confidence:.99,rows:2,cols:2,sharpness:200,corners:[{x:0,y:0},{x:399,y:0},{x:399,y:399},{x:0,y:399}],testSerial:n};}},
    reader:{prepare(){},cancel(){},async read(){await new Promise(r=>setTimeout(r,90));const puzzle=makePuzzle('latinsquare',2);puzzle.cells[0]=1;return{puzzle,cellUncertain:[],uncertain:[],markedCells:[0],needsReview:true,notes:[]};}},
    solver:{prepare(){warm++;},cancel(){},solve(){throw Error('disabled solver must not be invoked');}}});
  try{
    for(let i=0;i<20;i++){
      source.width=source.height=i%2?440:400;paint();camera.start();
      await new Promise(r=>setTimeout(r,620));
      if(i%4===0){source.width=source.height=480;paint();await new Promise(r=>setTimeout(r,160));}
      // 620 ms and 160 ms above shape the session; the wait after stop is for the state the assertions read.
      camera.stop();for(let waited=0;(workers.size||timers.size)&&waited<2000;waited+=10)await new Promise(r=>setTimeout(r,10));
      history.push({cycle:i,...camera.stats,workers:workers.size,timers:timers.size,bitmaps:balance()});
    }
    ended=true;return{history,made,peak,warm,performance:diagnostics.snapshot().performance,bitmaps:balance()};
  }finally{camera.stop();for(const id of timers)clear(id);for(const w of workers)w.terminate();source.width=source.height=out.width=out.height=0;
    if(makeBitmap)window.createImageBitmap=makeBitmap;if(closeBitmap)ImageBitmap.prototype.close=closeBitmap;}
}
async function run(){const server=await serve();try{await engines('live-soak.json',async(p,r,engine)=>{
 await p.goto(server.base);await p.waitForSelector('body[data-ready="true"]');r.soak=await p.evaluate(soak);
 assert.equal(r.soak.warm,0);assert.ok(r.soak.made>=20);assert.equal(r.soak.peak,1);
 for(const s of r.soak.history){assert.equal(s.workers,0);assert.equal(s.timers,0);assert.equal(s.active,false);assert.equal(s.scratchPixels,0);assert.equal(s.retainedSources,0);assert.equal(s.tracking.active+s.tracking.queuedFrames+s.tracking.queuedAnchors,0);
  // The bitmap transport: created = transferred + closed, none open, after every stop.
  assert.equal(s.bitmaps.open,0,`cycle ${s.cycle}: ${JSON.stringify(s.bitmaps)}`);
  assert.equal(s.bitmaps.created,s.bitmaps.transferred+s.bitmaps.closed,`cycle ${s.cycle}: ${JSON.stringify(s.bitmaps)}`);}
 const b=r.soak.bitmaps;assert.equal(b.created,b.transferred+b.closed);assert.equal(b.open,0);
 // Chromium draws bitmaps in its workers, so the soak exercises the transport there.
 if(engine==='chromium')assert.ok(b.transferred>=40,`bitmaps transferred: ${JSON.stringify(b)}`);
 assert.ok(r.soak.performance.paintRequests>r.soak.performance.rendering.count,'redundant paint requests must be skipped');
 },{timeout:60000});}finally{await server.close();}}
module.exports={run};main(module,run);
