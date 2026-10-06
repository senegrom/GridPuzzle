/* Actual app/modal/undo flow with controlled OCR completion. The separate
   external replay and live recovery suites exercise genuine recognition. */
const assert = require('node:assert/strict');
const {serve,engines,main}=require('./harness.cjs');
async function exercise(page,report,base) {
  await page.goto(base);await page.waitForSelector('body[data-ready="true"]');
  const image=await page.evaluate(async()=>{
    window.editorApp=await import('./app.js');const {Scanner}=await import('./scanner.js'),{makePuzzle}=await import('./model.js');
    window.editorOriginalRead = Scanner.prototype.read; window.editorOriginalReadCells = Scanner.prototype.readCells;
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
  report.checks=['one selected cell; no automatic field or puzzle mutation','identical pixels reuse cached proposal','explicit Use then Save; confirmed cells protected; Undo restores review','dismissed editor and edited draft survive late completion'];
  // Save & next closes and immediately reopens the native dialog. Await its
  // queued close event explicitly: a synchronous mock cannot catch this race.
  await page.evaluate(async () => {
    const { Scanner } = await import('./scanner.js'), { makePuzzle } = await import('./model.js');
    const c = document.createElement('canvas'); c.width = c.height = 400;
    const p = makePuzzle('latinsquare', 2); p.cells = [1, 2, null, null];
    Scanner.prototype.read = async () => ({ puzzle: structuredClone(p), cellUncertain: [0, 1],
      uncertain: [0, 1], needsReview: true, notes: [], rectified: c });
    window.sequenceReply = cell => ({ puzzle: structuredClone(p), targetCells: [cell],
      entries: [{ cell, kind: 'value', text: String(p.cells[cell]), confidence: 0 }] });
    window.editorJobs = [];
  });
  await page.click('#show-crop'); await page.click('#read-photo');
  await page.waitForFunction(() => document.getElementById('status-text').textContent === 'Puzzle read.');
  await page.click('#review-clues'); await page.click('#reread-clue');
  await page.waitForFunction(() => editorJobs.length === 1);
  await page.evaluate(() => { window.queuedClueClose = new Promise(resolve =>
    document.getElementById('cell-dialog').addEventListener('close', () => resolve(true), { once: true })); });
  await page.click('#save-next'); await page.evaluate(() => queuedClueClose);
  assert.equal(await page.locator('#cell-dialog').isVisible(), true);
  assert.equal(await page.textContent('#cell-title'), 'Row 1 · Column 2');
  assert.equal(await page.locator('#reread-clue-panel').isVisible(), true);
  assert.deepEqual((await page.evaluate(() => editorApp.getState())).cellUncertain, [1]);
  await page.click('#reread-clue'); await page.waitForFunction(() => editorJobs.length === 2);
  await page.evaluate(async () => { editorJobs[0].resolve(sequenceReply(0)); await new Promise(r => setTimeout(r, 0)); });
  assert.equal(await page.locator('#use-reread').isVisible(), false);
  assert.equal(await page.locator('#reread-clue').isDisabled(), true);
  await page.evaluate(() => editorJobs[1].resolve(sequenceReply(1)));
  await page.waitForSelector('#use-reread:visible'); await page.click('#use-reread');
  assert.deepEqual((await page.evaluate(() => editorApp.getState())).cellUncertain, [1]);
  await page.click('#save-next'); assert.equal(await page.locator('#cell-dialog').isVisible(), false);
  assert.deepEqual((await page.evaluate(() => editorApp.getState())).cellUncertain, []);
  await page.click('#undo'); await page.click('#review-clues');
  assert.equal(await page.locator('#reread-clue-panel').isVisible(), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#cell-dialog').isVisible(), false);
  report.checks.push('native queued close cannot hide or cancel the next clue; obsolete OCR cannot steal its request; final Save closes; Undo and Escape still work');
  // Actual OCR and Worker lifetimes across native Save & next. The photo's
  // initial transcription is controlled; the two individual re-reads are not.
  await page.evaluate(async () => {
    const { Scanner } = await import('./scanner.js'), { makePuzzle } = await import('./model.js');
    const c = document.createElement('canvas'); c.width = c.height = 400;
    const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = 'black'; ctx.font = '100px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('1', 100, 100); ctx.fillText('2', 300, 100);
    const p = makePuzzle('latinsquare', 2); p.cells = [1, 2, null, null];
    Scanner.prototype.read = async () => ({ puzzle: structuredClone(p), cellUncertain: [0, 1],
      uncertain: [0, 1], needsReview: true, notes: [], rectified: c });
    const NativeWorker = window.Worker; window.reviewHosts = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('ocr-host-worker')) {
          const record = { stopped: false }; reviewHosts.push(record);
          const terminate = this.terminate.bind(this);
          this.terminate = () => { record.stopped = true; terminate(); };
        }
      }
    };
  });
  await page.click('#show-crop'); await page.click('#read-photo');
  await page.waitForFunction(() => document.getElementById('status-text').textContent === 'Puzzle read.');
  await page.evaluate(async () => {
    const { Scanner } = await import('./scanner.js');
    Scanner.prototype.read = editorOriginalRead; Scanner.prototype.readCells = editorOriginalReadCells;
  });
  await page.click('#review-clues'); await page.click('#reread-clue');
  await page.waitForSelector('#use-reread:visible', { timeout: 90000 });
  assert.equal(await page.inputValue('#cell-value'), '1');
  assert.equal(await page.evaluate(() => reviewHosts.length), 1);
  await page.click('#use-reread'); assert.equal(await page.inputValue('#cell-value'), '1');
  await page.click('#save-next'); await page.click('#reread-clue');
  await page.waitForSelector('#use-reread:visible', { timeout: 90000 });
  assert.equal(await page.evaluate(() => reviewHosts.length), 1, 'adjacent real OCR calls share one host');
  assert.equal(await page.evaluate(() => reviewHosts[0].stopped), false);
  assert.deepEqual((await page.evaluate(() => editorApp.getState())).cellUncertain, [1]);
  await page.click('#close-cell'); await page.waitForFunction(() => reviewHosts[0].stopped);
  report.checks.push('two actual OCR clue re-reads share one live host across Save & next; genuine close terminates it');

  const maximum = await page.evaluate(async () => {
    const { makePuzzle } = await import('./model.js'), p = makePuzzle('kenken', 25);
    p.cells = Array.from({ length: 625 }, (_, i) => (16 * (i % 25 - Math.floor(i / 25)) + 2509) % 25 + 1);
    const cells = [];
    for (let r = 0; r < 12; r++) { cells.push(r * 25 + r); if (r < 11) cells.push(r * 25 + r + 1); }
    p.cages = [{ cells, target: 1e12, op: '*' }, ...p.cells.flatMap((target, cell) =>
      cells.includes(cell) ? [] : [{ cells: [cell], target, op: '=' }])];
    return p;
  });
  await page.setInputFiles('#json-file', { name: 'maximum-kenken.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(maximum)) });
  await page.waitForFunction(() => editorApp.getState().puzzle.rows === 25);
  await page.selectOption('#edit-tool', 'cage');
  // Cage selection is multi-cell; DOM clicks avoid scrolling a 25-row board
  // obscuring the target control, while exercising the actual board handler.
  await page.evaluate(cells => cells.forEach(cell => document.querySelector(`#board [data-cell="${cell}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))), maximum.cages[0].cells);
  await page.fill('#cage-target', '1000000000000'); await page.selectOption('#cage-op', '*');
  await page.click('#save-cage');
  let saved = (await page.evaluate(() => editorApp.getState())).puzzle;
  assert.deepEqual(saved.cells, maximum.cells);
  assert.deepEqual(saved.cages.find(c => c.target === 1e12), maximum.cages[0]);
  assert.match(await page.textContent('#status-text'), /Cage saved/);
  await page.click('#undo'); saved = (await page.evaluate(() => editorApp.getState())).puzzle;
  assert.deepEqual(saved.cages, maximum.cages);
  report.checks.push('import and edit a valid 13-digit KenKen target in the real DOM; Save and Undo preserve the board');
  await page.screenshot({path:`browser-artifacts/${report.browser}-clue-reread.png`});
}
async function run(){const server=await serve();try{await engines('editor-reread.json',(p,r)=>exercise(p,r,server.base));}finally{await server.close();}}
module.exports={run};main(module,run);
