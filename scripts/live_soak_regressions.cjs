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
  const set=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clear=id=>{clearTimeout(id);timers.delete(id);};
  const tracker=createLiveTracker({setTimer:set,clearTimer:clear,makeWorker(){
    const w=new Worker(new URL('./live-tracking-worker.js',location.href),{type:'module'});workers.add(w);made++;peak=Math.max(peak,workers.size);
    const host={postMessage:(m,t)=>w.postMessage(m,t),terminate(){w.terminate();workers.delete(w);}};
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
      history.push({cycle:i,...camera.stats,workers:workers.size,timers:timers.size});
    }
    ended=true;return{history,made,peak,warm,performance:diagnostics.snapshot().performance};
  }finally{camera.stop();for(const id of timers)clear(id);for(const w of workers)w.terminate();source.width=source.height=out.width=out.height=0;}
}
async function run(){const server=await serve();try{await engines('live-soak.json',async(p,r)=>{
 await p.goto(server.base);await p.waitForSelector('body[data-ready="true"]');r.soak=await p.evaluate(soak);
 assert.equal(r.soak.warm,0);assert.ok(r.soak.made>=20);assert.equal(r.soak.peak,1);
 for(const s of r.soak.history){assert.equal(s.workers,0);assert.equal(s.timers,0);assert.equal(s.active,false);assert.equal(s.scratchPixels,0);assert.equal(s.retainedSources,0);assert.equal(s.tracking.active+s.tracking.queuedFrames+s.tracking.queuedAnchors,0);}
 assert.ok(r.soak.performance.paintRequests>r.soak.performance.rendering.count,'redundant paint requests must be skipped');
 },{timeout:60000});}finally{await server.close();}}
module.exports={run};main(module,run);
