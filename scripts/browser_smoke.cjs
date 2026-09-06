/* Real-browser tests against a /GridPuzzle/ subpath, including actual WASM/OCR. */
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const BASE='http://127.0.0.1:8765/GridPuzzle/';
const reports=[];
fs.mkdirSync('browser-artifacts',{recursive:true});fs.mkdirSync('_preview',{recursive:true});
if(!fs.existsSync('_preview/GridPuzzle'))fs.symlinkSync(path.resolve('_site'),'_preview/GridPuzzle','dir');
const server=spawn('python',['-m','http.server','8765','--bind','127.0.0.1','--directory','_preview'],{stdio:'ignore'});
async function ready(page){
  await page.waitForSelector('body[data-ready="true"]');
  // Install a test-only synchronous state reader. waitForFunction's polling
  // predicate must return a boolean, not an always-truthy pending Promise.
  await page.evaluate(async()=>{window.__gridpuzzleTestState=(await import('./app.js')).getState;});
}
async function result(page){
  await page.waitForFunction(()=>{const s=window.__gridpuzzleTestState();return !s.busy&&s.result!==null;},null,{timeout:150000});
  return page.evaluate(()=>window.__gridpuzzleTestState().result);
}
async function load(page,kind){await page.evaluate(async type=>{const app=await import('./app.js'),model=await import('./model.js');app.loadPuzzle(model.demo(type));},kind);}
(async()=>{
  for(let i=0;i<60;i++){try{if((await fetch(BASE)).ok)break;}catch{}await sleep(200);}
  for(const [name,engine] of Object.entries({chromium,webkit})){
    const browser=await engine.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const page=await context.newPage();page.setDefaultTimeout(150000);
    const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8765/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
    const report={browser:name,checks:[],errors,external};reports.push(report);
    try{
      await page.goto(BASE);await ready(page);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Phone layout overflows horizontally');report.checks.push('390px phone layout');
      await page.click('#example');await page.click('#solve');let solved=await result(page);
      assert.equal(solved.status,'unique',JSON.stringify(solved));
      assert.equal(solved.solutions[0].cells.join(''),'534678912672195348198342567859761423426853791713924856961537284287419635345286179');report.checks.push('actual Python 3.14 WASM Sudoku solution');
      await page.screenshot({path:`browser-artifacts/${name}-phone.png`,fullPage:true});
      for(const kind of ['killersudoku','futoshiki','kenken','latinsquare','diagonallatinsquare','pandiagonallatinsquare','hidato','numbrix','kakuro','slitherlink']){
        await load(page,kind);await page.click('#solve');const r=await result(page);assert.ok(['unique','multiple'].includes(r.status),`${kind}: ${JSON.stringify(r)}`);report.checks.push(`browser solver: ${kind}`);
      }
      console.log(name,'all eleven solver families passed');
      await load(page,'sudoku');await page.click('[data-cell="0"]');await page.fill('#cell-value','9');await page.click('#cell-form button[type=submit]');
      const edited=await page.evaluate(()=>window.__gridpuzzleTestState());assert.equal(edited.puzzle.cells[0],9);assert.equal(edited.result,null);await page.click('#undo');assert.equal((await page.evaluate(()=>window.__gridpuzzleTestState())).puzzle.cells[0],5);report.checks.push('cell editing and undo');
      await page.evaluate(async()=>{const app=await import('./app.js'),model=await import('./model.js');app.loadPuzzle(model.makePuzzle('sudoku',25));});await page.click('#solve');await page.click('#stop');await sleep(250);
      assert.equal((await page.evaluate(()=>window.__gridpuzzleTestState())).busy,false);assert.equal((await page.evaluate(()=>window.__gridpuzzleTestState())).result,null);await load(page,'sudoku');await page.click('#solve');assert.equal((await result(page)).status,'unique');report.checks.push('worker cancellation and clean restart');
      await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('Denied in acceptance test','NotAllowedError');}}));await page.click('#camera');await page.waitForSelector('#native-camera:not([hidden])');report.checks.push('camera permission fallback');
      const image=await page.evaluate(async()=>{
        const p=(await import('./model.js')).demo(),c=document.createElement('canvas');c.width=c.height=660;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,660,660);ctx.strokeStyle='black';
        for(let i=0;i<=9;i++){ctx.lineWidth=i%3===0?5:2;ctx.beginPath();ctx.moveTo(42+i*64,42);ctx.lineTo(42+i*64,618);ctx.stroke();ctx.beginPath();ctx.moveTo(42,42+i*64);ctx.lineTo(618,42+i*64);ctx.stroke();}
        ctx.font='38px Arial';ctx.fillStyle='black';ctx.textAlign='center';ctx.textBaseline='middle';p.cells.forEach((v,i)=>{if(v!==null)ctx.fillText(String(v),42+(i%9+.5)*64,42+(Math.floor(i/9)+.5)*64+1);});return c.toDataURL('image/png').split(',')[1];
      });
      await page.evaluate(async()=>{const app=await import('./app.js'),model=await import('./model.js');app.loadPuzzle(model.makePuzzle());});await page.selectOption('#puzzle-type','auto');
      await page.setInputFiles('#photo-file',{name:'printed-sudoku.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
      await page.waitForFunction(()=>document.querySelector('#status-text').textContent==='Grid found.');
      assert.equal(await page.inputValue('#rows'),'9');assert.equal(await page.inputValue('#cols'),'9');await page.click('#read-photo');
      await page.waitForFunction(()=>{const s=window.__gridpuzzleTestState();return !s.busy&&s.puzzle.cells.some(Number.isInteger);},null,{timeout:150000});
      const scan=await page.evaluate(async()=>{const model=await import('./model.js'),s=window.__gridpuzzleTestState(),reference=model.demo().cells;return {type:s.puzzle.type,recognized:s.puzzle.cells.filter(Number.isInteger).length,correct:s.puzzle.cells.filter((v,i)=>v!==null&&v===reference[i]).length,unsafe:s.puzzle.cells.flatMap((v,i)=>v!==null&&v!==reference[i]&&!s.uncertain.includes(i)?[i]:[]),uncertain:s.uncertain};});
      report.scan=scan;console.log(name,'scan',JSON.stringify(scan));assert.equal(scan.type,'sudoku');assert.ok(scan.correct>=24,`Only ${scan.correct}/30 printed clues recognized`);assert.deepEqual(scan.unsafe,[],'Wrong clues were not flagged for review');report.checks.push('real printed-photo OCR, auto grid size, confidence handling');
      if((await page.evaluate(()=>window.__gridpuzzleTestState())).result===null){await page.click('#solve');if(await page.locator('#confirm-dialog').isVisible())await page.click('#confirm-solve');await result(page);}
      if(await page.locator('#photo-view').isEnabled()){await page.click('#photo-view');assert.ok(await page.locator('#solution-photo').isVisible());await page.screenshot({path:`browser-artifacts/${name}-overlay.png`,fullPage:true});report.checks.push('photo overlay');}
      await page.locator('#prepare-offline').evaluate(el=>{el.closest('details').open=true;});await page.click('#prepare-offline');await page.waitForFunction(()=>document.querySelector('#offline-state').textContent.startsWith('Offline assets are ready'),null,{timeout:300000});
      await context.setOffline(true);await page.reload();await ready(page);await load(page,'sudoku');await page.click('#solve');assert.equal((await result(page)).status,'unique');report.checks.push('offline reload and Python solve');
      await context.setOffline(false);assert.deepEqual(external,[],'App made an external runtime request');assert.deepEqual(errors,[],'Browser raised uncaught errors');report.ok=true;console.log(name,JSON.stringify(report));
    }catch(error){report.ok=false;report.failure=error.stack;console.error(name,error);try{await page.screenshot({path:`browser-artifacts/${name}-failure.png`,fullPage:true});report.status=await page.locator('#status').innerText();}catch{}}
    finally{await browser.close();fs.writeFileSync('browser-artifacts/results.json',JSON.stringify(reports,null,2));}
  }
  if(reports.some(r=>!r.ok))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.kill());
