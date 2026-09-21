/* Cross-feature browser regressions: real UI, JSON files and camera stream.
   OCR/solver replies are controlled ONLY in the preference race checks; real
   moving OCR and solver integration have their own mandatory suites. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PHONE, serve, engines, main } = require('./harness.cjs');
// The page has handled everything already dispatched to it once a frame has
// been painted and a following task has run.
const settled=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async()=>{window.reviewApp=await import('./app.js');});
}
async function backupChecks(page, report, base) {
  await page.goto(base); await ready(page);
  await page.evaluate(async()=>{
    const {makePuzzle}=await import('./model.js'); const puzzle=makePuzzle('latinsquare',2);puzzle.cells[0]=1;
    localStorage.setItem('gridpuzzle-session-v1',JSON.stringify({puzzle,cellUncertain:[0],cageUncertain:[],needsReview:true,
      notes:['Check printed 1'],play:[null,2,null,null],hints:[1]}));
    localStorage.setItem('gridpuzzle-settings-v2',JSON.stringify({editing:'play',type:'auto','auto-solve':false}));
  });
  await page.reload();await ready(page);
  const before=await page.evaluate(()=>reviewApp.getState());
  await page.locator('summary').filter({hasText:'Save, import & install'}).click();
  const downloadPromise=page.waitForEvent('download');await page.click('#export-json');
  const download=await downloadPromise, filename=await download.path();
  const bytes=fs.readFileSync(filename), backup=JSON.parse(bytes.toString('utf8'));
  assert.equal(backup.format,'gridpuzzle-backup');assert.equal(backup.version,1);
  assert.equal(backup.session.needsReview,true);assert.deepEqual(backup.session.cellUncertain,[0]);
  await page.evaluate(async()=>{const {demo}=await import('./model.js');reviewApp.loadPuzzle(demo('sudoku'));});
  await page.locator('#json-file').setInputFiles({name:'round-trip.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>reviewApp.getState().puzzle.type==='latinsquare');
  const after=await page.evaluate(()=>reviewApp.getState());
  for(const key of ['puzzle','cellUncertain','cageUncertain','needsReview','play','hints','playing'])assert.deepEqual(after[key],before[key],key);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gridpuzzle-session-v1')).notes[0]),'Check printed 1');
  await page.click('#check-play');assert.equal(await page.locator('#confirm-dialog').isVisible(),true);await page.click('#confirm-back');
  await page.click('#export-definition');assert.match(await page.textContent('#status-text'),/backup|review/i);
  const invalid=structuredClone(backup);invalid.version=999;
  await page.locator('#json-file').setInputFiles({name:'future.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
  await page.waitForFunction(()=>document.getElementById('status-text').textContent.includes('Unsupported backup'));
  assert.deepEqual((await page.evaluate(()=>reviewApp.getState())).puzzle,before.puzzle);
  await page.locator('#json-file').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup.session.puzzle))});
  await page.waitForFunction(()=>reviewApp.getState().play.every(v=>v===null));
  assert.equal((await page.evaluate(()=>reviewApp.getState())).needsReview,true);
  report.checks.push('actual downloaded backup/import preserves uncertainty, notes, Play answers and hints; confirmation is retained; malformed versions fail atomically; raw definitions require review');
}
async function arithmeticChecks(page, report) {
  await page.evaluate(async()=>{const {demo}=await import('./model.js');reviewApp.loadPuzzle(demo('kakuro'));});
  await page.selectOption('#edit-tool','play');
  for (const [value, conflict] of [[1,true],[2,false]]) {
    await page.click('[data-cell="5"]');await page.waitForSelector('#cell-dialog[open]');
    await page.fill('#cell-value',String(value));await page.click('#cell-form button[type=submit]');
    await page.waitForFunction(()=>!document.getElementById('cell-dialog').open);
    assert.equal((await page.locator('[data-cell="5"]').getAttribute('class')).includes('conflict'),conflict);
    assert.equal((await page.evaluate(()=>reviewApp.getState())).puzzle.cells[5],null,'Play feedback never alters a printed clue');
  }
  report.checks.push('Kakuro Play immediately highlights duplicate/impossible sum and clears it after a valid edit');
}
async function preferenceChecks(page, report) {
  await page.evaluate(async()=>{
    const {Scanner}=await import('./scanner.js'),{makePuzzle}=await import('./model.js');
    const cells=[1,2,3,4,3,null,1,2,2,1,null,3,4,3,2,1];
    window.reviewReads=0;window.reviewSolves=[];
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(data,...rest){
      if(data.puzzle){reviewSolves.push({id:data.id,handler:this.onmessage});return;}
      return post.call(this,data,...rest);
    };
    Scanner.prototype.read=async()=>{
      reviewReads++;await new Promise(r=>setTimeout(r,250));
      const puzzle=makePuzzle('sudoku',4);puzzle.cells=[...cells];
      return {puzzle,markedCells:cells.flatMap((v,i)=>v===null?[]:[i]),cellUncertain:[],cageUncertain:[],needsReview:true,notes:[]};
    };
    const paper=document.createElement('canvas');paper.width=paper.height=700;const ctx=paper.getContext('2d');
    function paint(){
      ctx.fillStyle='#fff';ctx.fillRect(0,0,700,700);ctx.strokeStyle='#000';
      for(let n=0;n<=4;n++){ctx.lineWidth=n%2?3:7;ctx.beginPath();ctx.moveTo(50+n*150,50);ctx.lineTo(50+n*150,650);ctx.moveTo(50,50+n*150);ctx.lineTo(650,50+n*150);ctx.stroke();}
      ctx.fillStyle='#000';ctx.font='58px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
      cells.forEach((v,i)=>{if(v!==null)ctx.fillText(String(v),50+(i%4+.5)*150,50+(Math.floor(i/4)+.5)*150);});
      window.reviewStream?.getVideoTracks().forEach(t=>t.requestFrame?.());
    }
    paint();window.reviewPaint=setInterval(paint,80);
    const devices=navigator.mediaDevices;
    Object.defineProperty(devices,'getUserMedia',{configurable:true,value:async()=>{window.reviewStream=paper.captureStream(12);return reviewStream;}});
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
    document.getElementById('auto-capture').checked=true;document.getElementById('auto-solve').checked=false;
    document.getElementById('puzzle-type').value='auto';
  });
  await page.click('#camera');
  await page.waitForFunction(()=>!document.getElementById('start-camera').hidden || document.getElementById('video').videoWidth>0);
  if(await page.locator('#start-camera').isVisible())await page.click('#start-camera');
  await page.waitForFunction(()=>/Automatic solving is off/.test(document.getElementById('camera-help').textContent));
  assert.equal(await page.evaluate(()=>reviewSolves.length),0);assert.equal(await page.evaluate(()=>reviewReads),1);
  assert.equal(Number(await page.locator('#live-preview').getAttribute('data-solution')),0);
  assert.equal(await page.locator('#camera-panel').getAttribute('aria-modal'),'true');
  assert.equal(await page.evaluate(()=>!!document.getElementById('solve').closest('[inert]')),true);
  await page.locator('#close-camera').focus();await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'take-photo');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'close-camera');
  await page.evaluate(()=>document.getElementById('solve').focus());
  assert.equal(await page.evaluate(()=>document.getElementById('camera-panel').contains(document.activeElement)),true);
  const toggle=async value=>page.evaluate(value=>{const el=document.getElementById('auto-solve');el.checked=value;el.dispatchEvent(new Event('change'));},value);
  await toggle(true);await page.waitForFunction(()=>reviewSolves.length===1);
  await toggle(false);await page.waitForFunction(()=>/Automatic solving is off/.test(document.getElementById('camera-help').textContent));
  await toggle(true);await page.waitForFunction(()=>reviewSolves.length===2);
  const reply=index=>page.evaluate(index=>{const p=reviewSolves[index];p.handler({data:{type:'result',id:p.id,
    result:{status:'unique',complete:true,solutions:[{cells:[1,2,3,4,3,4,1,2,2,1,4,3,4,3,2,1]}]}}});},index);
  await reply(0);await settled(page);assert.equal(Number(await page.locator('#live-preview').getAttribute('data-solution')),0,'a solve reply for a retired request is ignored');
  await reply(1);await page.waitForFunction(()=>Number(document.getElementById('live-preview').dataset.solution)===2);
  await toggle(false);await page.waitForFunction(()=>Number(document.getElementById('live-preview').dataset.solution)===0);
  assert.equal(await page.evaluate(()=>reviewReads),1);
  await page.screenshot({path:`browser-artifacts/${report.browser}-review-camera.png`});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#camera-panel').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'camera');
  assert.equal(await page.evaluate(()=>!!document.getElementById('solve').closest('[inert]')),false);
  assert.equal(await page.evaluate(()=>reviewStream.getTracks().every(t=>t.readyState==='ended')),true);
  await page.evaluate(()=>clearInterval(reviewPaint));
  report.checks.push('real camera UI honours auto-solve off, keeps one OCR reading when toggled, cancels/hides pending and complete solutions, rejects late replies; modal traps focus and restores background/opener on Escape');
}
async function run() {
  const server = await serve();
  try {
    await engines('app-review.json', async (page, report) => {
      report.checks = [];
      try {
        await backupChecks(page, report, server.base); await arithmeticChecks(page, report); await preferenceChecks(page, report);
      } catch (error) {
        report.statusText = await page.textContent('#status-text').catch(() => null);
        report.camera = await page.textContent('#camera-help').catch(() => null);
        throw error;
      }
    }, { context: { ...PHONE, acceptDownloads: true }, timeout: 30000 });
  } finally {
    await server.close();
  }
}
module.exports = { run };
main(module, run);
