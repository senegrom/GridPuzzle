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
async function workerCheck() {
  const {createLiveTracker}=await import('./live-tracker.js');
  const {canvas,corners}=featureFixture;
  let ticks=0;const timer=setInterval(()=>ticks++,5),workerURLs=[];
  const tracker=createLiveTracker({makeWorker(){
    const actual=new Worker(new URL('./live-tracking-worker.js',location.href),{type:'module'});workerURLs.push('live-tracking-worker.js');
    const host={postMessage:(m,t)=>actual.postMessage(m,t),terminate:()=>actual.terminate()};
    actual.onmessage=e=>setTimeout(()=>host.onmessage?.(e),60);
    actual.onerror=e=>host.onerror?.(e);return host;
  }});
  const pixels=()=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
  try {
    const a=pixels(),result=await tracker.anchor({image:a,corners,rows:4,cols:4,anchors:[]});
    const replies=await Promise.all(Array.from({length:10},()=>tracker.verify({image:pixels(),anchors:[result.anchor.id]})
      .then(r=>({matched:!!r.proofs[result.anchor.id]}),e=>({cancelled:e.name==='AbortError'}))));
    return {replies,ticks,detached:a.data.byteLength===0,stats:tracker.stats,workerURLs};
  }finally{tracker.reset();clearInterval(timer);}
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
  await engines('live-features.json',async(page,report)=>{
    await page.goto(server.base);await page.waitForSelector('body[data-ready="true"]');await page.evaluate(fixture);
    report.worker=await page.evaluate(workerCheck);
    assert.equal(report.worker.detached,true);assert.ok(report.worker.ticks>0);
    assert.equal(report.worker.replies.filter(r=>r.matched).length,2);assert.equal(report.worker.replies.filter(r=>r.cancelled).length,8);
    assert.equal(report.worker.stats.queuedFrames,0);
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
