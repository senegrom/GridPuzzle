/* Real MediaStream, detector, production camera/session and Tesseract.
   Only solving is stubbed: this suite measures scanning, not a 9x9 search. */
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const BASE='http://127.0.0.1:8781/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const expected = [
  [null,8,null,null,null,null,9,null,null],
  [null,null,null,7,null,null,1,null,null],
  [null,null,6,null,null,2,null,null,4],
  [7,5,null,null,null,9,null,null,null],
  [null,null,null,null,null,null,null,null,6],
  [null,null,9,null,4,8,null,null,3],
  [null,4,8,null,null,null,null,3,null],
  [null,null,null,null,1,null,null,null,null],
  [null,3,null,5,null,null,8,null,null],
].flat();
assert.equal(expected.length, 81);
assert.equal(expected.filter(Number.isInteger).length, 22);
async function beginMotion(cells) {
  const { Scanner }=await import('./scanner.js'),{createLiveCamera}=await import('./live-camera.js');
  const source=document.createElement('canvas');source.width=720;source.height=960;
  const video=document.createElement('video');video.muted=true;video.playsInline=true;
  video.style.cssText='position:fixed;left:0;top:0;width:215px;height:287px;z-index:9998';document.body.append(video);
  const out=document.createElement('canvas');out.style.cssText='position:fixed;left:215px;top:0;width:215px;height:287px;z-index:9999';document.body.append(out);window.motionOutput=out;
  const ctx=source.getContext('2d'),reader=new Scanner();
  const state=window.motionState={mode:'grid',ticks:0,reads:0,cancels:0,cells:[...cells],reading:false,source,video};
  function paint(){
    const i=++state.ticks;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#2e3439';ctx.fillRect(0,0,720,960);
    ctx.fillStyle=i%2?'#fff':'#ccc';ctx.font='24px Arial';ctx.fillText(`Timer ${i} / unrelated background`,70,55);
    const dx=Math.sin(i*.7)*2.3,dy=Math.cos(i*.51)*1.7,angle=Math.sin(i*.21)*.0025;
    ctx.translate(360+dx,500+dy);ctx.rotate(angle);ctx.translate(-360,-500);
    ctx.fillStyle='#edf1f5';ctx.fillRect(40,110,640,770);
    ctx.fillStyle='#30353a';ctx.font='32px Arial';ctx.fillText('Sudoku screen',65,160);
    ctx.fillStyle='#dce8f6';ctx.fillRect(60,200,600/9,600);
    for(let n=0;n<=9;n++){ctx.strokeStyle=n%3?'#a5aab3':'#343c43';ctx.lineWidth=n%3?1:3;
      ctx.beginPath();ctx.moveTo(60+n*600/9,200);ctx.lineTo(60+n*600/9,800);
      ctx.moveTo(60,200+n*600/9);ctx.lineTo(660,200+n*600/9);ctx.stroke();}
    ctx.fillStyle='#24282c';ctx.font='40px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    state.cells.forEach((v,k)=>{if(v!==null)ctx.fillText(String(v),60+(k%9+.5)*600/9,200+(Math.floor(k/9)+.5)*600/9);});
    ctx.textAlign='start';ctx.textBaseline='alphabetic';
    if(state.mode==='finger'){ctx.fillStyle='#ac8064';ctx.fillRect(285,430,140,160);}
    if(state.mode==='blank'){ctx.fillStyle='#fff';ctx.fillRect(40,110,640,770);}
    ctx.setTransform(1,0,0,1,0,0);
    // An out-of-grid pixel witness proves each commanded scene has reached
    // the displayed camera frame, not just the source canvas.
    ctx.fillStyle=`rgb(${state.mode==='finger'?172:36},${state.cells[1]*20},80)`;ctx.fillRect(0,0,25,25);
    state.stream?.getVideoTracks().forEach(t=>t.requestFrame?.());
  }
  paint();state.stream=source.captureStream(12);video.srcObject=state.stream;await video.play();
  state.timer=setInterval(paint,80);
  let readerEpoch=0,finishSolve=null;
  const cancelSolve=()=>{finishSolve?.({status:'cancelled'});finishSolve=null;};
  state.camera=createLiveCamera({$:id=>document.getElementById(id),video,canvas:out,
    getSettings:()=>({type:'sudoku',rows:9,cols:9,boxRows:3,boxCols:3,enabled:true}),
    reader:{prepare:()=>reader.prepare(),cancel(options){readerEpoch++;state.cancels++;reader.cancel(options);},
      async read(...args){const owner=readerEpoch;state.reads++;state.reading=true;
        // Hold the real OCR job across several moving frames; no reference
        // values are injected into Scanner. This catches cancellation loops.
        try{await new Promise(r=>setTimeout(r,900));
          if(owner!==readerEpoch)throw new DOMException('retired','AbortError');
          return await reader.read(...args);
        }finally{if(owner===readerEpoch)state.reading=false;}}
    },// Keep the solver pending to isolate OCR retention from the normal
    // multiple-solution retry backoff. No answers are injected.
    solver:{prepare(){},cancel:cancelSolve,invalidate:cancelSolve,solve:()=>new Promise(resolve=>{finishSolve=resolve;})}});
  state.camera.start();
}
async function externalTracking(fixtures) {
  const {gridAnchor,matchGrid}=await import('./live-registration.js');
  const output=[];
  for(const f of fixtures){
    const im=new Image();im.src=f.data;await im.decode();
    const scale=Math.min(1,1280/Math.max(im.naturalWidth,im.naturalHeight)),w=Math.round(im.naturalWidth*scale),h=Math.round(im.naturalHeight*scale);
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(im,0,0,w,h);
    const corners=f.corners.map(p=>({x:p[0]*(w-1)/(im.naturalWidth-1),y:p[1]*(h-1)/(im.naturalHeight-1)}));
    const anchor=gridAnchor(ctx.getImageData(0,0,w,h),corners,9,9),checks=[];
    for(const [dx,dy] of [[0,0],[1,0],[2,1],[-2,2]]){
      const t=document.createElement('canvas');t.width=w;t.height=h;t.getContext('2d').drawImage(c,dx,dy);
      const start=performance.now(),match=matchGrid(anchor,t.getContext('2d').getImageData(0,0,w,h));
      checks.push({dx,dy,matched:!!match,milliseconds:performance.now()-start});
    }
    output.push({name:f.name,sha256:f.sha256,checks});
  }
  return output;
}
async function run(){
 const server=spawn('python',['-m','http.server','8781','--bind','127.0.0.1','--directory','_site'],{stdio:'ignore'}),reports=[];
 fs.mkdirSync('browser-artifacts',{recursive:true});
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(BASE)).ok){ready=true;break;}}catch{}await sleep(100);}assert.ok(ready);
  for(const [name,engine]of Object.entries({chromium,webkit})){
   const browser=await engine.launch({headless:true}),report={browser:name,version:browser.version(),errors:[],checks:[]};reports.push(report);
   let page;
   try{
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:430,height:932},isMobile:true,hasTouch:true});page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(60000);
    await page.goto(BASE);await page.waitForSelector('body[data-ready="true"]');await page.evaluate(beginMotion,expected);
    await page.waitForFunction(()=>motionState.reads>0);
    const first=await page.evaluate(()=>({reads:motionState.reads,cancels:motionState.cancels,unknown:motionOutput.dataset.unknown}));
    assert.equal(Number(first.unknown),0,'initial grid outline must not cover blank cells in red');
    await page.waitForFunction(()=>!motionState.reading && Number(motionOutput.dataset.recognised)+Number(motionOutput.dataset.uncertain)===22);
    const captured=await page.evaluate(()=>{const c=motionState.camera.capture();return {cells:c.found?.puzzle.cells,review:c.found?.needsReview,reads:motionState.reads,cancels:motionState.cancels,ticks:motionState.ticks,unknown:motionOutput.dataset.unknown,refining:!!c.found?.refining};});
    report.reading=captured;
    assert.deepEqual(captured.cells,expected);assert.equal(captured.review,true);assert.equal(captured.refining,false);assert.equal(captured.reads,1);assert.equal(captured.cancels,first.cancels);
    assert.equal(Number(captured.unknown),0);report.reading=captured;report.checks.push('22/22 real OCR clues finish during continual jitter and changing background; one read, no motion cancellation');
    await page.evaluate(()=>{motionState.mode='finger';});
    await page.waitForFunction(()=>{const p=motionOutput.getContext('2d').getImageData(10,10,1,1).data;return Math.abs(p[0]-172)<3 && Number(motionOutput.dataset.recognised)+Number(motionOutput.dataset.uncertain)===0;});
    assert.equal(await page.evaluate(()=>motionState.camera.capture().found),null,'occluded current frame must not carry old readings');
    await page.evaluate(()=>{motionState.mode='grid';});
    await page.waitForFunction(()=>!motionState.reading && Number(motionOutput.dataset.recognised)+Number(motionOutput.dataset.uncertain)===22);
    assert.equal(await page.evaluate(()=>motionState.reads),1,'brief occlusion reuses verified work');report.checks.push('finger immediately hides metadata; same board returns without starting OCR again');
    await page.evaluate(()=>{motionState.cells[1]=3;});
    await page.waitForFunction(()=>{const p=motionOutput.getContext('2d').getImageData(10,10,1,1).data;return Math.abs(p[1]-60)<3;});
    assert.equal(await page.evaluate(()=>motionState.camera.capture().found?.puzzle.cells[1]===8),false,'first displayed changed frame cannot show the old clue');
    await page.waitForFunction(()=>motionState.reads>1);
    assert.equal(await page.evaluate(()=>motionState.camera.capture().found?.puzzle.cells[1]===8),false,'changed clue must never retain the old value');
    await page.waitForFunction(()=>!motionState.reading && motionState.camera.capture().found?.puzzle.cells[1]===3);
    report.changed=await page.evaluate(()=>({reads:motionState.reads,cancels:motionState.cancels,cells:motionState.camera.capture().found.puzzle.cells}));
    report.checks.push('a changed clue starts a new genuine OCR read, never reusing old clue metadata');
    await page.evaluate(()=>{motionState.camera.stop();clearInterval(motionState.timer);motionState.stream.getTracks().forEach(t=>t.stop());motionState.video.remove();});
    await page.screenshot({path:`browser-artifacts/${name}-motion.png`});
    if(fs.existsSync('live-fixtures/fixtures.json')){
      const corpus=JSON.parse(fs.readFileSync('live-fixtures/fixtures.json','utf8'));
      report.corpus={source:corpus.source,revision:corpus.revision,selection:corpus.selection,results:await page.evaluate(externalTracking,corpus.fixtures)};
      // This is coverage/retention measurement, not a claim that every external
      // image is readable. A static valid anchor must always match itself.
      for(const f of report.corpus.results)assert.equal(f.checks[0].matched,true,`${f.name}: static anchor`);
    }
    assert.deepEqual(report.errors,[]);report.ok=true;
   }catch(e){
    report.ok=false;report.failure=e.stack;
    report.state=await page?.evaluate(()=>({reads:window.motionState?.reads,cancels:window.motionState?.cancels,
      ticks:window.motionState?.ticks,reading:window.motionState?.reading,witness:window.motionOutput?Array.from(motionOutput.getContext('2d').getImageData(10,10,1,1).data):null,counts:{...window.motionOutput?.dataset},status:document.getElementById('camera-help')?.textContent})).catch(()=>null);
    await page?.screenshot({path:`browser-artifacts/${name}-failure.png`}).catch(()=>{});
    throw e;
   }finally{await browser.close();}
  }
 }finally{server.kill();fs.writeFileSync('browser-artifacts/live-motion.json',JSON.stringify(reports,null,2)+'\n');}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run,beginMotion,externalTracking};
