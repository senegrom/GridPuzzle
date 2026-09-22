/* Actual app/modal/undo flow with controlled OCR completion. The separate
   external replay and live recovery suites exercise genuine recognition. */
const assert = require('node:assert/strict');
const {serve,engines,main}=require('./harness.cjs');
async function exercise(page,report,base) {
  await page.goto(base);await page.waitForSelector('body[data-ready="true"]');
  const image=await page.evaluate(async()=>{
    window.editorApp=await import('./app.js');const {Scanner}=await import('./scanner.js'),{makePuzzle}=await import('./model.js');
    const c=document.createElement('canvas');c.width=c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,400);ctx.fillStyle='black';ctx.font='70px Arial';ctx.fillText('2',65,120);
    const p=makePuzzle('latinsquare',2);p.cells[0]=1;
    Scanner.prototype.detect=async()=>({rows:2,cols:2,confidence:.99,corners:[{x:0,y:0},{x:399,y:0},{x:399,y:399},{x:0,y:399}]});
    Scanner.prototype.read=async()=>({puzzle:structuredClone(p),cellUncertain:[0],uncertain:[0],needsReview:true,notes:[],rectified:c});
    window.editorJobs=[];
    Scanner.prototype.readCells=(...args)=>new Promise((resolve,reject)=>editorJobs.push({cells:args[3],resolve,reject}));
    window.editorReply=()=>({puzzle:{...structuredClone(p),cells:[2,null,null,null]},targetCells:[0],entries:[{cell:0,kind:'value',text:'2',confidence:0}]});
    document.getElementById('auto-solve').checked=false;return c.toDataURL('image/png').split(',')[1];
  });
  await page.selectOption('#puzzle-type','latinsquare');
  await page.setInputFiles('#photo-file',{name:'clue.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.waitForFunction(()=>document.getElementById('status-text').textContent==='Grid found.');await page.click('#read-photo');
  await page.waitForFunction(()=>document.getElementById('status-text').textContent==='Puzzle read.');
  await page.click('#review-clues');assert.equal(await page.locator('#reread-clue-panel').isVisible(),true);
  const before=await page.evaluate(()=>editorApp.getState());await page.click('#reread-clue');
  await page.waitForFunction(()=>editorJobs.length===1);assert.deepEqual(await page.evaluate(()=>editorJobs[0].cells),[0]);
  await page.evaluate(()=>editorJobs[0].resolve(editorReply()));await page.waitForSelector('#use-reread:visible');
  assert.equal(await page.inputValue('#cell-value'),'1');assert.deepEqual((await page.evaluate(()=>editorApp.getState())).puzzle,before.puzzle);
  await page.click('#reread-clue');await page.waitForFunction(()=>document.getElementById('reread-status').textContent.includes('cached'));
  assert.equal(await page.evaluate(()=>editorJobs.length),1);
  await page.click('#use-reread');assert.equal(await page.inputValue('#cell-value'),'2');
  assert.deepEqual((await page.evaluate(()=>editorApp.getState())).cellUncertain,[0]);
  await page.click('#save-cell');let after=await page.evaluate(()=>editorApp.getState());assert.equal(after.puzzle.cells[0],2);assert.deepEqual(after.cellUncertain,[]);
  await page.locator('#board [data-cell="0"]').click();assert.equal(await page.locator('#reread-clue-panel').isVisible(),false);await page.click('#close-cell');
  await page.click('#undo');after=await page.evaluate(()=>editorApp.getState());assert.equal(after.puzzle.cells[0],1);assert.deepEqual(after.cellUncertain,[0]);
  // New source instance avoids the intentionally cached proposal; pending
  // replies must not replace a draft or re-open a dismissed editor.
  await page.click('#show-crop');await page.click('#read-photo');await page.waitForFunction(()=>document.getElementById('status-text').textContent==='Puzzle read.');
  await page.click('#review-clues');await page.fill('#cell-value','9');
  await page.click('#reread-clue'); // may be cached; neither path writes into the field
  assert.equal(await page.inputValue('#cell-value'),'9');await page.click('#close-cell');
  // Resolving the job settles the app's continuation in microtasks; one task later it has run.
  await page.evaluate(async()=>{editorJobs.at(-1).resolve(editorReply());await new Promise(r=>setTimeout(r,0));});
  assert.equal(await page.locator('#cell-dialog').isVisible(),false);assert.equal((await page.evaluate(()=>editorApp.getState())).puzzle.cells[0],1);
  // Compose the actual scan warning budget and exercise the native dialog's
  // queued close lifecycle through the production Save & next handler.
  await page.evaluate(async()=>{
    const {Scanner}=await import('./scanner.js'),{makePuzzle}=await import('./model.js');
    const c=document.createElement('canvas');c.width=c.height=400;
    const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,400);
    ctx.fillStyle='black';ctx.font='70px Arial';ctx.fillText('1',65,120);ctx.fillText('2',265,120);
    const p=makePuzzle('latinsquare',2);p.cells=[1,2,null,null];
    Scanner.prototype.read=async()=>({puzzle:structuredClone(p),cellUncertain:[0,1],uncertain:[0,1],needsReview:true,
      notes:Array.from({length:10},(_,i)=>`Review warning ${i+1}`),rectified:c});
    window.dialogCloses=0;document.getElementById('cell-dialog').addEventListener('close',()=>dialogCloses++);
  });
  await page.click('#show-crop');await page.click('#read-photo');
  await page.waitForFunction(()=>document.getElementById('status-text').textContent==='Puzzle read.');
  const backupHandle=await page.evaluate(async()=>{
    // The UI downloads through a Blob. Observe that exact exported envelope,
    // not a separately built backup of a partial getState() snapshot.
    const original=URL.createObjectURL;window.downloadedBackup=null;
    URL.createObjectURL=function(blob){
      if(blob.type.includes('json'))blob.text().then(t=>{window.downloadedBackup=JSON.parse(t);});
      return original.call(this,blob);
    };
    return true;
  });
  assert.equal(backupHandle,true);
  await page.click('#export-json');
  await page.waitForFunction(()=>!!window.downloadedBackup);
  report.backup=await page.evaluate(async()=>{
    const {parsePuzzleFile}=await import('./backup.js');const restored=parsePuzzleFile(downloadedBackup);
    return {notes:restored.notes,uncertain:[...restored.uncertain],needsReview:restored.needsReview};
  });
  assert.equal(report.backup.notes.length,10);assert.equal(report.backup.needsReview,true);
  assert.deepEqual(report.backup.uncertain,[0,1]);
  await page.click('#review-clues');
  const previousJobs=await page.evaluate(()=>editorJobs.length);
  await page.click('#reread-clue');
  await page.waitForFunction(n=>editorJobs.length===n+1,previousJobs);
  const pending=await page.evaluate(()=>editorJobs.length-1);
  await page.click('#save-next');
  // Cross native event-loop turns; a queued close from the previous clue
  // must not hide or cancel the newly opened clue's controls.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
  assert.match(await page.textContent('#cell-title'),/Column 2/);
  assert.equal(await page.locator('#cell-dialog').isVisible(),true);
  assert.equal(await page.locator('#reread-clue-panel').isVisible(),true);
  assert.equal(await page.evaluate(()=>dialogCloses),0,'Save & next keeps one native modal open');
  await page.evaluate(i=>editorJobs[i].resolve(editorReply()),pending);
  assert.equal(await page.inputValue('#cell-value'),'2','late previous-cell reply cannot modify next clue');
  assert.equal(await page.locator('#use-reread').isVisible(),false);
  await page.click('#reread-clue');
  const nextJob=await page.evaluate(()=>editorJobs.length-1);
  assert.deepEqual(await page.evaluate(i=>editorJobs[i].cells,nextJob),[1]);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>dialogCloses===1);
  await page.evaluate(i=>editorJobs[i].resolve(editorReply()),nextJob);
  assert.equal(await page.locator('#cell-dialog').isVisible(),false);
  assert.deepEqual((await page.evaluate(()=>editorApp.getState())).cellUncertain,[1]);
  report.sequentialReview={nextControlVisible:true,oldReplyRejected:true,escapeRetires:true,closeCount:1};
  report.checks=['one selected cell; no automatic field or puzzle mutation','identical pixels reuse cached proposal','explicit Use then Save; confirmed cells protected; Undo restores review','dismissed editor and edited draft survive late completion','ten-warning real export round trip preserves review','native Save & next retains re-read control; old replies and Escape remain fenced'];
  await page.screenshot({path:`browser-artifacts/${report.browser}-clue-reread.png`});
}
async function run(){const server=await serve();try{await engines('editor-reread.json',(p,r)=>exercise(p,r,server.base));}finally{await server.close();}}
module.exports={run};main(module,run);
