/* Called by the permanent live-camera gate. Real pixels and IndexedDB; camera
   recognition completions are controlled to make otherwise rare races repeat. */
const assert = require("node:assert/strict");

async function cameraContentProbe() {
  const { demo } = await import("./model.js");
  const { gridContent, sameGridContent } = await import("./live-content.js");
  const { createLiveCamera } = await import("./live-camera.js");
  const { createLiveTracker } = await import("./live-tracker.js");
  const puzzle = demo(), marks = puzzle.cells.flatMap((v,i)=>v === null ? [] : [i]);
  const solution = { status:"unique", complete:true, solutions:[{cells:[
    5,3,4,6,7,8,9,1,2,6,7,2,1,9,5,3,4,8,1,9,8,3,4,2,5,6,7,
    8,5,9,7,6,1,4,2,3,4,2,6,8,5,3,7,9,1,7,1,3,9,2,4,8,5,6,
    9,6,1,5,3,7,2,8,4,2,8,7,4,1,9,6,3,5,3,4,5,2,8,6,1,7,9,
  ]}] };
  const corners = [{x:0,y:0},{x:899,y:0},{x:899,y:899},{x:0,y:899}];
  function board(first=5, illumination=1, offset=0) {
    const c=document.createElement("canvas");c.width=c.height=900;const ctx=c.getContext("2d");
    const white=Math.round(255*illumination);ctx.fillStyle=`rgb(${white},${white},${white})`;ctx.fillRect(0,0,900,900);ctx.strokeStyle="black";
    for(let i=0;i<=9;i++){ctx.lineWidth=i%3 ? 2:5;ctx.beginPath();ctx.moveTo(i*100,0);ctx.lineTo(i*100,900);ctx.moveTo(0,i*100);ctx.lineTo(900,i*100);ctx.stroke();}
    ctx.font="64px Arial";ctx.fillStyle="black";ctx.textAlign="center";ctx.textBaseline="middle";
    puzzle.cells.forEach((v,i)=>{const value=i===0 ? first:v;if(value!==null)ctx.fillText(String(value),i%9*100+50+offset,Math.floor(i/9)*100+50);});return c;
  }
  const image=c=>c.getContext("2d").getImageData(0,0,c.width,c.height);
  const original=board(), signature=gridContent(image(original),corners,9,9), comparisons=[];
  for(const value of [1,2,3,4,6,7,8,9,null]) {
    const next=board(value);
    comparisons.push({value,
      contentSame:sameGridContent(signature,gridContent(image(next),corners,9,9))});
  }
  const controls = [sameGridContent(signature,gridContent(image(board(5,.94)),corners,9,9)),
    sameGridContent(signature,gridContent(image(board(5,1,1)),corners,9,9))];
  const polarity=[];
  for(const fade of [1,.35]) {
    const invert=c=>{const ctx=c.getContext("2d"), data=image(c);for(let i=0;i<data.data.length;i+=4)
      for(let k=0;k<3;k++)data.data[i+k]=Math.round(255-fade*data.data[i+k]);ctx.putImageData(data,0,0);return c;};
    const base=gridContent(image(invert(board())),corners,9,9);
    for(const value of [6,null])polarity.push({fade,value,same:sameGridContent(base,gridContent(image(invert(board(value))),corners,9,9))});
  }
  const timingStart=performance.now();
  for(let i=0;i<20;i++)sameGridContent(signature,gridContent(image(original),corners,9,9));
  const comparisonMs=(performance.now()-timingStart)/20;
  const outcomes=[];
  for(const phase of ["solved", "reading", "solving", "erased"]) {
    let clock=0,serial=0,reads=0,first=5,release=null;
    const timers=new Map(), nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.createElement("div"));return nodes.get(id);};
    const video=board();video.videoWidth=video.videoHeight=900;const overlay=document.createElement("canvas");
    // This race probe uses a canvas as its controlled video source. Supply
    // its advancing presentation clock; absent metadata must stay untrusted.
    Object.defineProperty(video, 'currentTime', { get: () => clock / 1000 });
    const tracker=createLiveTracker();
    const camera=createLiveCamera({tracker,$,video,canvas:overlay,
      getSettings:()=>({type:"sudoku",rows:9,cols:9,boxRows:3,boxCols:3,enabled:true}),
      detector:{async detect(){return {confidence:.99,sharpness:200,rows:9,cols:9,corners:[{x:0,y:0},{x:639,y:0},{x:639,y:639},{x:0,y:639}]};},cancel(){}},
      reader:{async read(){reads++;const p=structuredClone(puzzle);p.cells[0]=first;const found={puzzle:p,markedCells:marks,cellUncertain:[],notes:[]};
        return phase==="reading"&&reads===1 ? new Promise(resolve=>{release=()=>resolve(found);}):found;},cancel(){}},
      solver:{async solve(p){const r=p.cells[0]===5 ? solution:{status:"no-solution",complete:true,solutions:[]};
        return phase==="solving"&&reads===1 ? new Promise(resolve=>{release=()=>resolve(r);}):r;},cancel(){}},now:()=>clock,
      setTimer(fn,ms){timers.set(++serial,{fn,at:clock+ms});return serial;},clearTimer(id){timers.delete(id);}});
    async function advance(ms){const end=clock+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
      const [id,v]=next;clock=v.at;timers.delete(id);v.fn();
      // This probe accelerates the camera clock, not the real worker clock.
      // Drain actual off-thread work before the next synthetic 100ms tick;
      // otherwise a few milliseconds of computation falsely become 5s loss.
      const until=performance.now()+10000;let idle=0;
      while(idle<2){await new Promise(resolve=>setTimeout(resolve,0));
        const state=tracker.stats;idle=state.active+state.queuedFrames+state.queuedAnchors?0:idle+1;
        if(performance.now()>until)throw Error('Background tracking failed to settle in the controlled clock probe');
      }
    }clock=end;}
    try {
      camera.start();await advance(1000);const before=Number(overlay.dataset.solution);
      if(phase==="solved") {await advance(12000); if(reads!==1)throw Error(`Expected one retained read for an unchanged solved board, got ${reads}`);}
      first=phase==="erased"?null:6;video.getContext("2d").drawImage(board(first),0,0);await advance(300);
      if(release){release();await new Promise(resolve=>setTimeout(resolve,0));await advance(100);}
      const shot=camera.capture();outcomes.push({phase,before,after:Number(overlay.dataset.solution),
        capturedClue:shot.found?.puzzle.cells[0]??null,rawMatches:shot.photo.toDataURL()===video.toDataURL()});
      // advance() drains the tracking worker but not detection, so the fake time
      // a fresh read takes depends on real scheduling: wait for it, up to 3 s,
      // and look at the overlay no earlier than the fixed 1.4 s used to.
      let waited=0;for(;reads<2&&waited<3000;waited+=100)await advance(100);
      if(reads<2)throw Error("changed content never triggered a fresh read");
      if(waited<1400)await advance(1400-waited);
      if(Number(overlay.dataset.solution)!==0)throw Error("obsolete solution returned after rereading");
    } finally{camera.stop();}
  }
  return {comparisons,controls,polarity,outcomes,comparisonMs};
}

async function captureOrderingProbe() {
  const { saveCapture, deleteCapture, loadCapture, setupCaptureGallery } = await import("./capture-store.js");
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.createElement("div"));return nodes.get(id);};
  const c=document.createElement("canvas");c.width=c.height=10;c.getContext("2d").fillRect(0,0,10,10);
  const blob=await new Promise(resolve=>c.toBlob(resolve,"image/png")), bytes=await blob.arrayBuffer();
  let release;
  Object.defineProperty(blob,"arrayBuffer",{value:()=>new Promise(resolve=>{release=()=>resolve(bytes);})});
  const capture=setupCaptureGallery($);
  const saving=capture({toBlob(done){done(blob);}},42);
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  await $("delete-capture").onclick();const before=await loadCapture();
  release();const reported=await saving,after=await loadCapture();
  const message=$("capture-storage-status").textContent,hidden=$("saved-capture").hidden;
  // A later capture wins even if an earlier save finishes converting last.
  const old=saveCapture(blob,43).then(()=>"saved",e=>e.name);
  await saveCapture(new Blob([bytes],{type:"image/png"}),44);release();
  const oldOutcome=await old,newest=await loadCapture();await deleteCapture();
  return {before:before===null,after:after===null,reported,message,hidden,oldOutcome,newest:newest.createdAt};
}

async function faintClueProbe() {
  const { Scanner } = await import("./scanner.js");
  const { overlayCells, previewBlocker } = await import("./live-overlay.js");
  const { demo } = await import("./model.js");
  const results=[];
  for(const level of [215,230,235]) {
    const p=demo(), c=document.createElement("canvas");c.width=c.height=900;const ctx=c.getContext("2d");
    ctx.fillStyle="white";ctx.fillRect(0,0,900,900);ctx.strokeStyle="black";
    for(let i=0;i<=9;i++){ctx.lineWidth=i%3?2:5;ctx.beginPath();ctx.moveTo(i*100,0);ctx.lineTo(i*100,900);ctx.moveTo(0,i*100);ctx.lineTo(900,i*100);ctx.stroke();}
    ctx.font="64px Arial";ctx.textAlign="center";ctx.textBaseline="middle";
    p.cells.forEach((v,i)=>{if(v!==null){ctx.fillStyle=i===0?`rgb(${level},${level},${level})`:"black";ctx.fillText(String(i===0?6:v),i%9*100+50,Math.floor(i/9)*100+50);}});
    const scanner=new Scanner();let found;
    try{found=await scanner.read(c,[{x:0,y:0},{x:899,y:0},{x:899,y:899},{x:0,y:899}],"sudoku",9,9);}finally{scanner.cancel();}
    const missed={...found,puzzle:structuredClone(found.puzzle)};missed.puzzle.cells[0]=null;
    const r={status:"unique",complete:true,solutions:[{cells:Array(81).fill(5)}]};
    results.push({level,value:found.puzzle.cells[0],marked:found.markedCells.includes(0),uncertain:found.cellUncertain.includes(0),
      allowed:previewBlocker(found)===null,unreadAllowed:previewBlocker(missed)===null,unreadColour:overlayCells(missed,r).find(x=>x.cell===0).kind});
  }
  return results;
}

module.exports = async function reviewSafety(page) {
  const camera=await page.evaluate(cameraContentProbe);
  for(const comparison of camera.comparisons)assert.equal(comparison.contentSame,false,`changed ${comparison.value} must invalidate content`);
  assert.deepEqual(camera.controls,[true,true],"small brightness and sub-cell jitter controls");
  for(const p of camera.polarity)assert.equal(p.same,false,"white-on-black changes must invalidate");
  for(const result of camera.outcomes){assert.equal(result.after,0);assert.equal(result.capturedClue,null);assert.equal(result.rawMatches,true);
    if(["solved","erased"].includes(result.phase))assert.equal(result.before,51);}
  const storage=await page.evaluate(captureOrderingProbe);
  assert.equal(storage.before,true);assert.equal(storage.after,true);assert.equal(storage.reported,false);
  assert.equal(storage.hidden,true);assert.match(storage.message,/deleted/);assert.equal(storage.oldOutcome,"AbortError");assert.equal(storage.newest,44);
  // Reopen the app and database, not just the gallery's in-memory revision.
  await page.reload();await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.evaluate(async()=>(await (await import("./capture-store.js")).loadCapture())===null),true);
  const faint=await page.evaluate(faintClueProbe);
  for(const result of faint){assert.equal(result.marked,true);assert.equal(result.uncertain,true);assert.equal(result.value,6);
    assert.equal(result.allowed,false);assert.equal(result.unreadAllowed,false);assert.equal(result.unreadColour,"unknown");}
  const structuralCapture = await require("./structural_capture_regressions.cjs")(page);
  return {camera,storage,faint,structuralCapture};
};
