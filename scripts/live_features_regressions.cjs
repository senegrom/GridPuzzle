/* Exact branch build, real worker + OCR and real diagnostic download controls.
   Target flags are deliberately selected after OCR: this measures bounded
   targeted work/merge safety, not a claimed improvement in recognition accuracy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { serve, engines, main } = require('./harness.cjs');
async function fixture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=500;
  const cells=[1,2,3,4,3,null,1,2,2,1,null,3,4,3,2,1];
  const paint=(shade=20)=>{
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,500,500);
    ctx.strokeStyle='#000';for(let i=0;i<=4;i++){ctx.lineWidth=i%2?2:5;ctx.beginPath();ctx.moveTo(30+110*i,30);ctx.lineTo(30+110*i,470);ctx.moveTo(30,30+110*i);ctx.lineTo(470,30+110*i);ctx.stroke();}
    ctx.fillStyle=`rgb(${shade},${shade},${shade})`;ctx.font='48px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    cells.forEach((v,i)=>{if(v!==null)ctx.fillText(String(v),30+(i%4+.5)*110,30+(Math.floor(i/4)+.5)*110);});
  };
  paint();window.featureFixture={canvas,cells,paint,corners:[{x:30,y:30},{x:470,y:30},{x:470,y:470},{x:30,y:470}]};
}
/* The real tracking worker in each transport (live-tracker.js): "default" is
   what the handshake decides in this engine (a bitmap of the frame, drawn and
   read back in the worker, where it can), "imagedata" the page's own readback
   (no bitmaps offered). The frame is the 500 x 500 fixture, or a `size` x
   `size` copy of it, tracked as the camera tracks a snapshot: at most 1280
   pixels on the long side, drawn into a cleared canvas with the default
   smoothing (contentPixels in live-camera.js) or by the worker from the
   frame's bitmap. A 1600 x 1600 copy is scaled to 1280 x 1280, in the worker
   or on the page, which a frame within 1280 pixels never is. */
async function workerCheck([kind,size=500]) {
  const {createLiveTracker}=await import('./live-tracker.js');
  const fixture=featureFixture;let canvas=fixture.canvas;
  if(size!==fixture.canvas.width){canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d').drawImage(fixture.canvas,0,0,size,size);}
  const track=Math.min(size,1280),scratch=document.createElement('canvas');scratch.width=scratch.height=track;
  // The fixture's corners in the frame, then in the tracking pixels, as the camera maps a detection's.
  const corners=fixture.corners.map(p=>({x:p.x*size/fixture.canvas.width*(track-1)/(size-1),y:p.y*size/fixture.canvas.height*(track-1)/(size-1)}));
  let ticks=0;const timer=setInterval(()=>ticks++,5),workerURLs=[];
  const tracker=createLiveTracker({makeWorker(){
    const actual=new Worker(new URL('./live-tracking-worker.js',location.href),{type:'module'});workerURLs.push('live-tracking-worker.js');
    const host={postMessage:(m,t)=>actual.postMessage(m,t),terminate:()=>actual.terminate()};
    actual.onmessage=e=>setTimeout(()=>host.onmessage?.(e),60);
    actual.onerror=e=>host.onerror?.(e);return host;
  },...(kind==='imagedata'?{probe:()=>null}:{})});
  const pixels=()=>{const ctx=scratch.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,track,track);ctx.drawImage(canvas,0,0,track,track);return ctx.getImageData(0,0,track,track);},bitmaps=[];
  try {
    const transport=await tracker.ready();
    const frame=async()=>{if(transport!=='bitmap')return{image:pixels(),width:track,height:track};const bitmap=await createImageBitmap(canvas);bitmaps.push(bitmap);return{bitmap,width:track,height:track};};
    const a=await frame(),result=await tracker.anchor({...a,corners,rows:4,cols:4,anchors:[]});
    // Ten frames made first, then sent at once: the first goes to the worker,
    // each later one replaces the queued one, the last is verified.
    const frames=await Promise.all(Array.from({length:10},frame));
    const replies=await Promise.all(frames.map(f=>tracker.verify({...f,anchors:[result.anchor.id]})
      .then(r=>({matched:!!r.proofs[result.anchor.id],corners:r.proofs[result.anchor.id]?.corners??null}),e=>({cancelled:e.name==='AbortError'}))));
    return {size,track,transport,replies,ticks,anchor:result.anchor.corners,stats:tracker.stats,workerURLs,
      detached:a.bitmap?a.bitmap.width===0&&a.bitmap.height===0:a.image.data.byteLength===0,
      // Transferred or closed, every one: both leave no pixels.
      bitmaps:bitmaps.length,bitmapsOpen:bitmaps.filter(b=>b.width||b.height).length};
  }finally{tracker.reset();clearInterval(timer);if(canvas!==fixture.canvas)canvas.width=canvas.height=0;scratch.width=scratch.height=0;}
}
/* Where the handshake picks bitmaps, the two transports must give the same
   pixels, which the verdicts and corners of workerCheck cannot show: its
   verified frames are copies of the anchor's frame, and a frame identical to
   its anchor's verifies at the anchor's corners (matchGrid), whatever both
   were drawn as. So, on workerCheck's frame: (1) the worker's reader
   (live-tracking-pixels.js), run on this page on the frame's bitmap, against
   the page's own readback (contentPixels in live-camera.js), within 2 per
   channel; (2) in one real tracking worker, an anchor built from the frame's
   bitmap verified on the page's readback of the same frame, and one built
   from that readback verified on the bitmap: each must verify at its anchor's
   corners, which a frame drawn otherwise in the worker moves or fails. */
async function equivalenceCheck(size) {
  const {createPixelReader}=await import('./live-tracking-pixels.js');
  const fixture=featureFixture;let canvas=fixture.canvas;
  if(size!==fixture.canvas.width){canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d').drawImage(fixture.canvas,0,0,size,size);}
  const track=Math.min(size,1280),scratch=document.createElement('canvas');scratch.width=scratch.height=track;
  const corners=fixture.corners.map(p=>({x:p.x*size/fixture.canvas.width*(track-1)/(size-1),y:p.y*size/fixture.canvas.height*(track-1)/(size-1)}));
  const pixels=()=>{const ctx=scratch.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,track,track);ctx.drawImage(canvas,0,0,track,track);return ctx.getImageData(0,0,track,track);};
  const worker=new Worker(new URL('./live-tracking-worker.js',location.href),{type:'module'}),replies=new Map();
  const within=(promise,what)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`no ${what} within 20 s`)),20000);})]).finally(()=>clearTimeout(timer));};
  try{
    const page=pixels().data,read=createPixelReader()({bitmap:await createImageBitmap(canvas),width:track,height:track}).data;
    let max=0,differing=0;
    for(let i=0;i<page.length;i++){const d=Math.abs(page[i]-read[i]);if(d){differing++;if(d>max)max=d;}}
    await within(new Promise((resolve,reject)=>{worker.onerror=e=>reject(Error(e.message||'the tracking worker failed'));
      worker.onmessage=({data})=>{if(data?.started)resolve();else replies.get(data?.id)?.(data);};}),'start of the tracking worker');
    let serial=0;
    const ask=async(op,kind,extra)=>{
      const job=kind==='bitmap'?{bitmap:await createImageBitmap(canvas)}:{image:pixels()},id=++serial;
      return within(new Promise(resolve=>{replies.set(id,resolve);
        worker.postMessage({op,id,...job,width:track,height:track,...extra},[job.bitmap??job.image.data.buffer]);}),`reply to ${op}`);
    };
    const cross={};
    for(const [anchorKind,verifyKind] of [['bitmap','imagedata'],['imagedata','bitmap']]){
      const built=await ask('anchor',anchorKind,{corners,rows:4,cols:4,anchors:[]}),id=built.result?.anchor?.id;
      const verified=await ask('verify',verifyKind,{anchors:[id]});
      cross[`${anchorKind} anchor, ${verifyKind} frame`]={anchor:built.result?.anchor?.corners??null,
        proof:verified.result?.proofs?.[id]?.corners??null,error:built.error??verified.error??null};
    }
    return {size,track,pixels:{maxChannelDifference:max,differingValues:differing,values:page.length},cross};
  }finally{worker.terminate();if(canvas!==fixture.canvas)canvas.width=canvas.height=0;scratch.width=scratch.height=0;}
}
const near=(p,q)=>!!p&&!!q&&p.length===q.length&&p.every((v,i)=>Math.abs(v.x-q[i].x)<=.05&&Math.abs(v.y-q[i].y)<=.05);
// Both transports on the same frames: the same verdicts, corners within 0.05 px.
function sameProofs(a,b){
  assert.ok(near(a.anchor,b.anchor),`anchor corners ${JSON.stringify([a.anchor,b.anchor])}`);
  assert.deepEqual(a.replies.map(r=>r.cancelled?'cancelled':r.matched),b.replies.map(r=>r.cancelled?'cancelled':r.matched));
  a.replies.forEach((r,i)=>{if(r.corners)assert.ok(near(r.corners,b.replies[i].corners),`proof ${i}`);});
}
async function targetedCheck() {
  const {Scanner}=await import('./scanner.js'),{mergeRecoveredClues}=await import('./clue-recovery.js');
  const {canvas,corners,cells,paint}=featureFixture,scanner=new Scanner();
  try {
    const full=await scanner.read(canvas,corners,'sudoku',4,4);
    // Select one already-read numeric cell to measure the production partial
    // path and protect the rest. No values are supplied to the OCR engine.
    full.cellUncertain=[1];full.uncertain=[1];
    const identical=await scanner.readCells(canvas,corners,full,[1]);
    paint(30);const retry=await scanner.readCells(canvas,corners,full,[1]);
    const merged=mergeRecoveredClues(full,retry,[1]);
    return {expected:cells,full:full.puzzle.cells,fullStats:full.ocrStats,
      identical:{skipped:identical.identicalCrops,calls:identical.ocrStats.calls},
      retry:{cells:retry.targetCells,entries:retry.entries.map(e=>({cell:e.cell,text:e.text})),stats:retry.ocrStats},
      merged:merged.puzzle.cells,uncertain:merged.cellUncertain};
  }finally{scanner.cancel();}
}
async function diagnosticCheck(page, report) {
  const data=await page.evaluate(()=>featureFixture.canvas.toDataURL('image/png').split(',')[1]);
  await page.evaluate(()=>{document.getElementById('auto-solve').checked=false;});
  await page.locator('#photo-file').setInputFiles({name:'PRIVATE-FILENAME.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await page.waitForFunction(()=>/Grid found|Set the four crop/.test(document.getElementById('status-text').textContent));
  await page.click('#read-photo');await page.waitForFunction(()=>document.getElementById('status-text').textContent==='Puzzle read.');
  const panel=page.locator('#scan-diagnostics');await panel.locator('summary').click();
  await panel.locator('[data-diagnostic="prepare"]').click();
  assert.equal(await panel.locator('[data-diagnostic="image-toggle"]').isChecked(),false);
  async function download() {
    const pending=page.waitForEvent('download');await panel.locator('[data-diagnostic="download"]').click();
    const file=await pending;return JSON.parse(fs.readFileSync(await file.path(),'utf8'));
  }
  const clean=await download();assert.equal(clean.format,'gridpuzzle-diagnostic');assert.equal(clean.source,'photo');
  assert.equal(clean.geometry.coordinateSpace,'source-preview');assert.equal(clean.geometry.width,500);assert.equal(clean.geometry.height,500);
  assert.equal(clean.privacy.includesImage,false);assert.equal(clean.image,undefined);assert.ok(clean.lastReading.cells.some(Number.isInteger));
  assert.doesNotMatch(JSON.stringify(clean),/PRIVATE-FILENAME|data:image|solutions|file:\/\//);
  await panel.locator('[data-diagnostic="image-toggle"]').check();assert.equal(await panel.locator('[data-diagnostic="image"]').isVisible(),true);
  const withImage=await download();assert.equal(withImage.privacy.includesImage,true);assert.ok(withImage.image.dataUrl.startsWith('data:image/jpeg;base64,'));
  assert.ok(withImage.image.width<=1600 && withImage.image.height<=1600);
  await panel.locator('[data-diagnostic="image-toggle"]').uncheck();const without=await download();assert.equal(without.image,undefined);
  assert.equal(await panel.locator('[data-diagnostic="image"]').getAttribute('src'),null);
  await page.screenshot({path:`browser-artifacts/${report.browser}-scan-diagnostics.png`});
  await panel.locator('[data-diagnostic="clear"]').click();assert.equal(await panel.locator('[data-diagnostic="download"]').isDisabled(),true);
  report.diagnostics={source:clean.source,build:clean.build,events:clean.events.length,defaultImage:false,optInImage:true,removedImage:true};
}
async function run() {
 const server=await serve();
 try {
  await engines('live-features.json',async(page,report,engine)=>{
    await page.goto(server.base);await page.waitForSelector('body[data-ready="true"]');await page.evaluate(fixture);
    report.worker=await page.evaluate(workerCheck,['imagedata']);report.transport=await page.evaluate(workerCheck,['default']);
    // A phone-sized frame: scaled to the tracking size in the worker (from a
    // bitmap) or on the page, which must give the same proofs too.
    report.scaledWorker=await page.evaluate(workerCheck,['imagedata',1600]);report.scaled=await page.evaluate(workerCheck,['default',1600]);
    // Chromium can draw a bitmap in a worker; WebKit decides in its handshake
    // (no OffscreenCanvas before iOS 16.4, nor in this WebKit on Windows).
    assert.equal(report.worker.transport,'imagedata');assert.equal(report.scaledWorker.transport,'imagedata');
    if(engine==='chromium'){assert.equal(report.transport.transport,'bitmap');assert.equal(report.scaled.transport,'bitmap');}
    assert.equal(report.scaled.track,1280);
    for(const check of [report.worker,report.transport,report.scaledWorker,report.scaled]){
      assert.equal(check.detached,true);assert.ok(check.ticks>0);
      assert.equal(check.replies.filter(r=>r.matched).length,2);assert.equal(check.replies.filter(r=>r.cancelled).length,8);
      assert.equal(check.stats.queuedFrames,0);assert.equal(check.stats.failures,0);assert.equal(check.stats.transport,check.transport);
      if(check.transport==='bitmap'){assert.equal(check.bitmaps,11);assert.equal(check.bitmapsOpen,0);}
    }
    sameProofs(report.transport,report.worker);sameProofs(report.scaled,report.scaledWorker);
    // Where the handshake picks bitmaps (both sizes in Chromium): the same
    // pixels, and each transport's anchor verified at its corners on the other's.
    report.equivalence={};
    for(const [check,size] of [[report.transport,500],[report.scaled,1600]]){
      if(check.transport!=='bitmap')continue;
      const result=report.equivalence[size]=await page.evaluate(equivalenceCheck,size);
      assert.ok(result.pixels.maxChannelDifference<=2,`${size}: the worker's reader against the page's readback ${JSON.stringify(result.pixels)}`);
      for(const [name,r] of Object.entries(result.cross)){
        assert.equal(r.error,null,`${size}, ${name}`);
        assert.ok(near(r.proof,r.anchor),`${size}, ${name}: verified at the anchor's corners ${JSON.stringify(r)}`);
      }
    }
    if(engine==='chromium')assert.deepEqual(Object.keys(report.equivalence),['500','1600']);
    report.targeted=await page.evaluate(targetedCheck);
    assert.deepEqual(report.targeted.full,report.targeted.expected);
    assert.equal(report.targeted.identical.skipped,true);assert.equal(report.targeted.identical.calls,0);
    assert.deepEqual(report.targeted.retry.cells,[1]);assert.equal(report.targeted.retry.entries.length,1);
    assert.equal(report.targeted.retry.stats.samples,2);assert.ok(report.targeted.retry.stats.calls<report.targeted.fullStats.calls);
    assert.deepEqual(report.targeted.merged,report.targeted.full);assert.ok(report.targeted.uncertain.includes(1));
    await diagnosticCheck(page,report);
  },{context:{serviceWorkers:'block',viewport:{width:430,height:932},isMobile:true,hasTouch:true,acceptDownloads:true},timeout:30000});
 } finally { await server.close(); }
}
module.exports={run};main(module,run);
