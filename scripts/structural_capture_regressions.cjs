/* Permanent live-camera gate: real pixels and real two-tab IndexedDB/Web Locks.
   Recognition completions are controlled so late-result races are repeatable. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");

async function structuralProbe({ ink = 0, vertical = false, erase = false, hold = 12000 } = {}) {
  const { demo } = await import("./model.js");
  const { gridContent, sameGridContent } = await import("./live-content.js");
  const { createLiveCamera, fingerprint } = await import("./live-camera.js");
  const { createLiveTracker } = await import("./live-tracker.js");
  const { sameFrame } = await import("./live-overlay.js");
  const puzzle = demo("futoshiki"), size = 900, cell = size / 4;
  puzzle.inequalities = [{ less: 0, greater: vertical ? 4 : 1 }];
  const scenario = vertical ? "vertical" : "horizontal";
  const cameraKind = scenario + (erase ? "-erase" : "");
  const corners = [{x:0,y:0},{x:899,y:0},{x:899,y:899},{x:0,y:899}];
  const solved = {status:"unique",complete:true,solutions:[{cells:[1,2,3,4,3,4,1,2,2,1,4,3,4,3,2,1]}]};
  function board(kind = "horizontal", changed = false, shift = 0, light = 1) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    const x = c.getContext("2d"); x.fillStyle = "white"; x.fillRect(0,0,size,size);
    x.translate(shift, shift); x.strokeStyle = "black"; x.lineWidth = 2;
    for (let i=0;i<=4;i++) { x.beginPath();x.moveTo(i*cell,0);x.lineTo(i*cell,size);x.moveTo(0,i*cell);x.lineTo(size,i*cell);x.stroke(); }
    x.font = "130px Arial"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "black";
    puzzle.cells.forEach((v,i) => { if(v!==null)x.fillText(String(v),(i%4+.5)*cell,(Math.floor(i/4)+.5)*cell); });
    if (kind === "label") {
      x.font="28px Arial";x.textAlign="left";x.textBaseline="top";
      x.fillText(changed ? "9+" : "3+", cell*.04, cell*.015);
    } else if (kind === "wall") {
      if (!changed) { x.setLineDash([9,6]);x.lineWidth=3;x.beginPath();x.moveTo(cell*.96,cell*.08);x.lineTo(cell*.96,cell*.92);x.stroke(); }
    } else {
      const vertical=kind.startsWith("vertical"), erased=kind.endsWith("erase") && changed;
      x.save();x.translate(vertical?cell/2:cell,vertical?cell:cell/2);if(vertical)x.rotate(Math.PI/2);
      x.fillStyle="white";x.fillRect(-15,-27,30,54);
      if(!erased) { x.strokeStyle=`rgb(${ink},${ink},${ink})`;const a=changed?-1:1;x.lineWidth=4;x.beginPath();x.moveTo(a*10,-20);x.lineTo(-a*10,0);x.lineTo(a*10,20);x.stroke(); }
      x.restore();
    }
    if(light!==1) { const image=x.getImageData(0,0,size,size);for(let i=0;i<image.data.length;i+=4)for(let k=0;k<3;k++)image.data[i+k]=Math.round(image.data[i+k]*light);x.putImageData(image,0,0); }
    return c;
  }
  function content(c) {
    const small=document.createElement("canvas");small.width=small.height=640;
    const x=small.getContext("2d");x.drawImage(c,0,0,640,640);
    return gridContent(x.getImageData(0,0,640,640),corners.map(p=>({x:p.x*639/899,y:p.y*639/899})),4,4);
  }
  const pixels=[];
  for(const kind of ["horizontal","vertical","horizontal-erase","vertical-erase","label","wall"]) {
    const a=board(kind),b=board(kind,true),reference=content(a);
    pixels.push({kind,coarseSame:sameFrame(fingerprint(a),fingerprint(b)),changed:sameGridContent(reference,content(b)),
      identical:sameGridContent(reference,content(a)),light:sameGridContent(reference,content(board(kind,false,0,.94))),
      jitter:sameGridContent(reference,content(board(kind,false,1)))});
  }
  const outcomes=[];
  for(const phase of ["reading","solving","solved"]) {
    let clock=0,serial=0,reads=0,solves=0,changed=false,release=null;
    const timers=new Map(),nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.createElement("div"));return nodes.get(id);};
    const video=board(cameraKind);video.videoWidth=video.videoHeight=size;const overlay=document.createElement("canvas");
    const tracker=createLiveTracker();
    const camera=createLiveCamera({tracker,$,video,canvas:overlay,getSettings:()=>({type:"futoshiki",rows:4,cols:4,enabled:true}),
      detector:{async detect(){return {confidence:.99,sharpness:200,rows:4,cols:4,corners:corners.map(p=>({x:p.x*639/899,y:p.y*639/899}))};},cancel(){}},
      reader:{async read(){reads++;const p=structuredClone(puzzle);if(changed)p.inequalities=erase ? [] : [{less:vertical ? 4 : 1,greater:0}];
        const found={puzzle:p,markedCells:p.cells.flatMap((v,i)=>v===null?[]:[i]),cellUncertain:[],notes:[]};
        return phase==="reading"&&reads===1?new Promise(resolve=>{release=()=>resolve(found);}):found;},cancel(){}},
      solver:{async solve(p){solves++;const result=p.inequalities[0]?.less===0?solved:{status:erase?"multiple":"no-solution",complete:true,solutions:[]};
        return phase==="solving"&&solves===1?new Promise(resolve=>{release=()=>resolve(result);}):result;},cancel(){}},
      now:()=>clock,setTimer(fn,ms){timers.set(++serial,{fn,at:clock+ms});return serial;},clearTimer(id){timers.delete(id);}});
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
      if(phase==="solved"){await advance(hold);if(reads!==1)throw Error("unchanged structural board was reread");}
      changed=true;video.getContext("2d").drawImage(board(cameraKind,true),0,0);await advance(100);
      if(release){release();await new Promise(resolve=>setTimeout(resolve,0));await advance(100);}
      const capture=camera.capture();
      const row={phase,before,after:Number(overlay.dataset.solution),metadata:capture.found,rawMatches:capture.photo.toDataURL()===video.toDataURL(),solvesBeforeReread:solves};
      await advance(1600);row.reads=reads;row.finalAnswers=Number(overlay.dataset.solution);outcomes.push(row);
    } finally { camera.stop(); }
  }
  return {ink,vertical,erase,pixels,outcomes};
}

// Real newsprint photographs (the OCR quality fixtures) as camera frames: a
// sub-pixel shift, sensor-like noise and a small brightness change must not
// read as printed content changing, while an erased clue, a changed small grey
// sign or an added cage wall must. Synthetic boards cannot stand in for
// halftone paper here; before the anchored normalisation, a quarter-pixel
// shift of a newspaper photograph reset the live view on every frame.
async function realPhotoProbe({ photos }) {
  const { gridContent, sameGridContent } = await import("./live-content.js");
  const results = [];
  for (const photo of photos) {
    const img = new Image(); img.src = `data:image/webp;base64,${photo.data}`; await img.decode();
    const scale = Math.min(1, 720 / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale), cell = { w: w / 9, h: h / 9 };
    const corners = [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];
    function frame({ shift = 0, noise = 0, light = 1, seed = 1, paint = null } = {}) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      // The unshifted image underneath keeps a sub-pixel shift from exposing a blank sliver at the frame edge.
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h); x.drawImage(img, shift, shift * .6, w, h);
      if (paint) paint(x);
      if (noise || light !== 1) {
        const image = x.getImageData(0, 0, w, h), d = image.data; let s = seed;
        for (let i = 0; i < d.length; i += 4) {
          s = (s * 1664525 + 1013904223) >>> 0; const n = noise ? ((s >>> 8) % (2 * noise + 1)) - noise : 0;
          for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, Math.round(d[i + k] * light + n)));
        }
        x.putImageData(image, 0, 0);
      }
      return gridContent(x.getImageData(0, 0, w, h), corners, 9, 9);
    }
    const reference = frame(), clue = photo.cells.findIndex((v) => Number.isInteger(v));
    const paper = (x) => { const r = Math.floor(clue / 9), c = clue % 9; x.fillStyle = "#e8e4dc";
      x.fillRect((c + .12) * cell.w, (r + .12) * cell.h, cell.w * .76, cell.h * .76); };
    const chevron = (flip) => (x) => { x.save(); x.translate(3 * cell.w, 4.5 * cell.h); x.strokeStyle = "rgb(150,150,150)";
      x.lineWidth = Math.max(2, cell.w / 16); const a = flip ? -1 : 1, s = cell.h * .18;
      x.beginPath(); x.moveTo(a * s / 2, -s); x.lineTo(-a * s / 2, 0); x.lineTo(a * s / 2, s); x.stroke(); x.restore(); };
    // The wall goes between two empty white cells of column 4 and 5, so it is
    // never drawn onto a black Str8ts cell where it would be invisible.
    const wallRow = Math.max(0, photo.cells.findIndex((v, i) => i % 9 === 4 && v === null && photo.cells[i + 1] === null)) / 9 | 0;
    const wall = (x) => { x.setLineDash([6, 4]); x.strokeStyle = "#333"; x.lineWidth = 2; x.beginPath();
      x.moveTo(5 * cell.w, (wallRow + .1) * cell.h); x.lineTo(5 * cell.w, (wallRow + .9) * cell.h); x.stroke(); };
    results.push({ name: photo.name, size: `${w}x${h}`,
      controls: { identical: sameGridContent(reference, frame()), shift025: sameGridContent(reference, frame({ shift: .25 })),
        shift05: sameGridContent(reference, frame({ shift: .5 })),
        noise: sameGridContent(reference, frame({ noise: 4, seed: 3 })), shiftNoise: sameGridContent(reference, frame({ shift: .5, noise: 4, seed: 7 })),
        light: sameGridContent(reference, frame({ light: .94 })) },
      changes: { erasedClue: sameGridContent(reference, frame({ paint: paper })),
        greySign: sameGridContent(frame({ paint: chevron(false) }), frame({ paint: chevron(true) })),
        greySignJitter: sameGridContent(frame({ paint: chevron(false) }), frame({ shift: .5, noise: 4, seed: 9, paint: chevron(true) })),
        wall: sameGridContent(reference, frame({ paint: wall })) } });
  }
  return results;
}

async function installStorageProbe() {
  const api=await import("./capture-store.js");
  const canvas=document.createElement("canvas");canvas.width=canvas.height=10;canvas.getContext("2d").fillRect(0,0,10,10);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png")),bytes=await blob.arrayBuffer();
  window.captureProbe={api,bytes};
}
async function startDelayedSave(phase) {
  const s=window.captureProbe;s.releaseOpen=s.releaseBytes=s.releaseCanvas=null;s.result=null;
  const blob=new Blob([s.bytes],{type:"image/png"});
  if(phase==="conversion"||phase==="reservation-opening")blob.arrayBuffer=()=>new Promise(resolve=>{s.releaseBytes=()=>resolve(s.bytes);});
  let options;
  if(phase.endsWith("opening")) {
    let calls=0;const target=phase==="write-opening"?2:1;
    options={indexedDB:{open(...args){const native=indexedDB.open(...args);if(++calls!==target)return native;
      const proxy={get result(){return native.result;},get error(){return native.error;}};
      for(const event of ["error","blocked","upgradeneeded"])native[`on${event}`]=e=>proxy[`on${event}`]?.(e);
      native.onsuccess=e=>{s.releaseOpen=()=>proxy.onsuccess?.(e);};return proxy;}}};
  }
  if(phase==="deletion-opening") {
    s.pending=s.api.deleteCapture(options).then(()=>s.result="deleted",e=>s.result=e.name);
  } else if(phase==="canvas") {
    const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.createElement("div"));return nodes.get(id);};
    const capture=s.api.setupCaptureGallery($);
    s.pending=capture({toBlob(done){s.releaseCanvas=()=>done(blob);}},42).then(ok=>s.result=ok?"saved":"superseded",e=>s.result=e.name);
  } else s.pending=s.api.saveCapture(blob,42,options).then(()=>s.result="saved",e=>s.result=e.name);
}
async function storageProbe(page) {
  const other=await page.context().newPage();
  try {
    await other.goto(page.url());await other.waitForSelector('body[data-ready="true"]');
    await page.evaluate(installStorageProbe);await other.evaluate(installStorageProbe);
    const migration=await page.evaluate(async()=>{
      const {api,bytes}=window.captureProbe;
      await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase("gridpuzzle-captures-v1");r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const r=indexedDB.open("gridpuzzle-captures-v1",1);
        r.onupgradeneeded=()=>r.result.createObjectStore("pictures");r.onerror=()=>reject(r.error);
        r.onsuccess=()=>{const db=r.result,tx=db.transaction("pictures","readwrite");tx.objectStore("pictures").put({bytes,type:"image/png",createdAt:7},"latest");
          tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
      const old=await api.loadCapture();
      const oldWriter=await new Promise(resolve=>{const r=indexedDB.open("gridpuzzle-captures-v1",1);r.onerror=()=>resolve(r.error.name);r.onsuccess=()=>{r.result.close();resolve("opened");};});
      return {retained:old?.createdAt===7,oldWriter};
    });
    assert.equal(migration.retained,true);assert.equal(migration.oldWriter,"VersionError");
    const outcomes=[];
    // Two independent module instances, not two clients of one in-memory map.
    for(const phase of ["conversion","write-opening","reservation-opening","canvas"]) {
      await other.evaluate(()=>window.captureProbe.api.deleteCapture());
      await page.evaluate(startDelayedSave,phase);
      await page.waitForFunction(phase=>Boolean(window.captureProbe[phase==="canvas"?"releaseCanvas":phase.endsWith("opening")?"releaseOpen":"releaseBytes"]),phase);
      if(phase==="reservation-opening") {
        await other.evaluate(()=>{const s=window.captureProbe;s.done=false;s.deleting=s.api.deleteCapture().then(()=>{s.done=true;});});
        await other.waitForFunction(async()=>Boolean((await navigator.locks.query()).pending.length));
        assert.equal(await other.evaluate(()=>window.captureProbe.done),false,"deletion must not overtake an earlier reservation's delayed open");
        await page.evaluate(()=>window.captureProbe.releaseOpen());
        await page.waitForFunction(()=>Boolean(window.captureProbe.releaseBytes));
        await other.evaluate(()=>window.captureProbe.deleting);
      } else await other.evaluate(()=>window.captureProbe.api.deleteCapture());
      assert.equal(await other.evaluate(async()=>await window.captureProbe.api.loadCapture()===null),true);
      await page.evaluate(phase=>{const s=window.captureProbe;return (phase==="canvas"?s.releaseCanvas:phase==="write-opening"?s.releaseOpen:s.releaseBytes)();},phase);
      const outcome=await page.evaluate(async()=>{const s=window.captureProbe;await s.pending;return s.result;});
      assert.equal(outcome,phase==="canvas"?"superseded":"AbortError",phase);
      await other.reload();await other.waitForSelector('body[data-ready="true"]');await other.evaluate(installStorageProbe);
      assert.equal(await other.evaluate(async()=>await window.captureProbe.api.loadCapture()===null),true,"a reload must not resurrect the deleted PNG");
      outcomes.push({phase,outcome,deletedAfterReload:true});
    }
    await page.evaluate(startDelayedSave,"conversion");await page.waitForFunction(()=>Boolean(window.captureProbe.releaseBytes));
    // Same timestamp deliberately: ownership must not depend on wall clocks.
    await other.evaluate(()=>window.captureProbe.api.saveCapture(new Blob(["newer"],{type:"image/png"}),42));
    await page.evaluate(()=>window.captureProbe.releaseBytes());
    assert.equal(await page.evaluate(async()=>{const s=window.captureProbe;await s.pending;return s.result;}),"AbortError");
    assert.equal(await other.evaluate(async()=>await (await window.captureProbe.api.loadCapture()).blob.text()),"newer");
    await page.evaluate(startDelayedSave,"deletion-opening");await page.waitForFunction(()=>Boolean(window.captureProbe.releaseOpen));
    await other.evaluate(()=>{const s=window.captureProbe;s.writing=s.api.saveCapture(new Blob(["newer"],{type:"image/png"}),42);});
    await other.waitForFunction(async()=>Boolean((await navigator.locks.query()).pending.length));
    await page.evaluate(()=>window.captureProbe.releaseOpen());
    await other.evaluate(()=>window.captureProbe.writing);await page.evaluate(()=>window.captureProbe.pending);
    assert.equal(await other.evaluate(async()=>await (await window.captureProbe.api.loadCapture()).blob.text()),"newer");
    // A real queued lock timeout must leave neither a writer nor a held lock.
    await page.evaluate(()=>{const s=window.captureProbe;s.releaseLock=null;s.holding=navigator.locks.request("gridpuzzle-captures-v1:mutations",()=>new Promise(resolve=>{s.releaseLock=resolve;}));});
    await page.waitForFunction(()=>Boolean(window.captureProbe.releaseLock));
    assert.match(await other.evaluate(async()=>{try{await window.captureProbe.api.deleteCapture({lockTimeout:30});return "deleted";}catch(e){return e.message;}}),/timed out/);
    await page.evaluate(async()=>{const s=window.captureProbe;s.releaseLock();await s.holding;});
    assert.equal(await other.evaluate(async()=>await (await window.captureProbe.api.loadCapture()).blob.text()),"newer");
    // A missing coordination API must not silently downgrade to page-local safety.
    assert.match(await page.evaluate(async()=>{try{await window.captureProbe.api.deleteCapture({locks:null});return "deleted";}catch(e){return e.message;}}),/Download/);
    assert.equal(await other.evaluate(async()=>await (await window.captureProbe.api.loadCapture()).blob.text()),"newer");
    await other.evaluate(()=>window.captureProbe.api.deleteCapture());
    return {migration,outcomes,newerCapturePreserved:true,delayedDeleteOrdered:true,lockTimeoutSafe:true,uncoordinatedDeleteRejected:true};
  } finally { await other.close(); }
}

function assertStructural(structural) {
  for(const p of structural.pixels){assert.equal(p.changed,false,`${structural.ink}: ${p.kind} change`);assert.equal(p.identical,true);assert.equal(p.light,true,`${p.kind} lighting`);assert.equal(p.jitter,true,`${p.kind} jitter`);}
  assert.equal(structural.pixels[0].coarseSame,true,"fixture must exercise a change the coarse motion check misses");
  for(const row of structural.outcomes){assert.equal(row.after,0,row.phase);assert.equal(row.metadata,null);assert.equal(row.rawMatches,true);assert.ok(row.reads>=2);assert.equal(row.finalAnswers,0);
    if(row.phase==="solved")assert.equal(row.before,4);if(row.phase==="reading")assert.equal(row.solvesBeforeReread,0);}
}
module.exports=async function structuralCapture(page) {
  const structural=await page.evaluate(structuralProbe);
  assertStructural(structural);
  const faint=[];
  for (const ink of [150,205,210]) for (const vertical of [false,true]) for (const erase of [false,true]) {
    const result=await page.evaluate(structuralProbe,{ink,vertical,erase,hold:1200});
    assertStructural(result);faint.push(result);
  }
  const fixtures="Examples/BrowserScanner/Newspaper", photos=JSON.parse(fs.readFileSync(path.join(fixtures,"ground-truth.json"))).fixtures
    .map((f)=>({name:f.name,cells:f.cells,data:fs.readFileSync(path.join(fixtures,f.image)).toString("base64")}));
  const real=await page.evaluate(realPhotoProbe,{photos});
  for(const r of real){
    for(const [k,v] of Object.entries(r.controls))assert.equal(v,true,`${r.name}: ${k} must not read as changed printed content`);
    for(const [k,v] of Object.entries(r.changes))assert.equal(v,false,`${r.name}: ${k} must read as changed printed content`);
  }
  const storage=await storageProbe(page);
  return {structural,faint,real,storage};
};
module.exports.assertStructural=assertStructural;
module.exports.realPhotoProbe=realPhotoProbe;
module.exports.structuralProbe=structuralProbe;
module.exports.storageProbe=storageProbe;
