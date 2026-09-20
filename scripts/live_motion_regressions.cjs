/* Real MediaStream, detector, production camera/session and Tesseract.
   Only solving is stubbed: this suite measures scanning, not a 9x9 search. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { serve, engines, main } = require('./harness.cjs');
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
  paint();state.stream=source.captureStream(12);video.srcObject=state.stream;
  // Frames must flow while play() is pending: a captured canvas that is not
  // repainted delivers nothing, and play() then never settles.
  state.timer=setInterval(paint,80);
  let readerEpoch=0,finishSolve=null;
  const cancelSolve=()=>{finishSolve?.({status:'cancelled'});finishSolve=null;};
  const {createScanDiagnostics}=await import('./scan-diagnostics.js');state.diagnostics=createScanDiagnostics();state.diagnostics.begin('live',{});
  state.camera=createLiveCamera({$:id=>document.getElementById(id),video,canvas:out,diagnostics:state.diagnostics,
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
  // A verified view is transient. Capture and copy its result in one browser
  // task; a later Playwright call may legitimately find the next frame hidden.
  state.snapshot = () => {
    const shot = state.camera.capture();
    try { return { cells: shot.found?.puzzle.cells, review: shot.found?.needsReview,
      reads: state.reads, cancels: state.cancels, ticks: state.ticks,
      unknown: out.dataset.unknown, refining: !!shot.found?.refining }; }
    finally { shot.photo.width = shot.photo.height = shot.annotated.width = shot.annotated.height = 0; }
  };
  // Match the user-opened production camera instead of relying on cold
  // canvas-stream autoplay in WebKit. No frames or match results are faked.
  let playTimer;
  const startButton = document.createElement('button'); startButton.id = 'motion-start';
  startButton.textContent = 'Start test camera';
  startButton.style.cssText = 'position:fixed;left:0;top:300px;z-index:10000';
  document.body.append(startButton);
  state.playback = () => ({ started: !!state.started, error: state.startError ?? null,
    readyState: video.readyState, paused: video.paused, width: video.videoWidth,
    height: video.videoHeight, currentTime: video.currentTime });
  state.stop = () => {
    state.stopped = true; clearTimeout(playTimer); clearInterval(state.timer);
    state.camera.stop(); state.stream.getTracks().forEach(track => track.stop());
    video.srcObject = null; video.remove(); startButton.remove();
  };
  startButton.onclick = async () => {
    startButton.disabled = true;
    try {
      await Promise.race([video.play(), new Promise((_, reject) => {
        playTimer = setTimeout(() => reject(Error('Motion fixture video playback did not start')), 20000);
      })]);
      if (!state.stopped) { state.camera.start(); state.started = true; }
    } catch (error) { state.startError = error.message; }
    finally { clearTimeout(playTimer); }
  };
}
async function externalTracking(fixtures) {
  const {gridAnchor,matchGrid}=await import('./live-registration.js');
  const {validQuad,homography,project}=await import('./geometry.js');
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
    const valid=validQuad(corners,w,h),anchorValid=!!anchor;
    let occluded=false;
    if(anchor){
      const p=project(homography(corners),.5,.5),t=document.createElement('canvas');t.width=w;t.height=h;
      const q=t.getContext('2d');q.drawImage(c,0,0);q.fillStyle='#ad8061';
      const size=Math.min(Math.hypot(corners[1].x-corners[0].x,corners[1].y-corners[0].y),Math.hypot(corners[3].x-corners[0].x,corners[3].y-corners[0].y))*.22;
      q.fillRect(p.x-size/2,p.y-size/2,size,size);
      occluded=!!matchGrid(anchor,q.getImageData(0,0,w,h));
    }
    output.push({name:f.name,sha256:f.sha256,width:w,height:h,corners,validQuad:valid,anchorValid,occlusionMatched:occluded,checks});
  }
  return output;
}
async function run(){
 const server=await serve();
 try{
  await engines('live-motion.json',async(page,report,name)=>{
   report.checks=[];const log=(message)=>console.log(`${name}: ${message}`);
   try{
    await page.goto(server.base);await page.waitForSelector('body[data-ready="true"]');log('app ready');
    await page.evaluate(beginMotion,expected);
    await page.click('#motion-start');
    await page.waitForFunction(() => motionState.started || motionState.startError, null, { timeout: 25000 });
    report.playback = await page.evaluate(() => motionState.playback());
    assert.equal(report.playback.error, null, 'actual video playback must start before camera acceptance');
    assert.equal(report.playback.started, true);
    log('camera started on the moving canvas');
    await page.waitForFunction(()=>motionState.reads>0);log('first read started');
    const first=await page.evaluate(()=>({reads:motionState.reads,cancels:motionState.cancels,unknown:motionOutput.dataset.unknown}));
    assert.equal(Number(first.unknown),0,'initial grid outline must not cover blank cells in red');
    const readingHandle = await page.waitForFunction(() => {
      if (motionState.reading || Number(motionOutput.dataset.recognised) + Number(motionOutput.dataset.uncertain) !== 22) return false;
      const value = motionState.snapshot(); return value.cells ? value : false;
    });
    const captured = await readingHandle.jsonValue(); await readingHandle.dispose();
    report.reading=captured;
    assert.deepEqual(captured.cells,expected);assert.equal(captured.review,true);assert.equal(captured.refining,false);assert.equal(captured.reads,1);assert.equal(captured.cancels,first.cancels);
    assert.equal(Number(captured.unknown),0);report.reading=captured;report.checks.push('22/22 real OCR clues finish during continual jitter and changing background; one read, no motion cancellation');log('22/22 read under jitter');
    await page.evaluate(()=>{motionState.mode='finger';});
    await page.waitForFunction(()=>{const p=motionOutput.getContext('2d').getImageData(10,10,1,1).data;return Math.abs(p[0]-172)<3 && Number(motionOutput.dataset.recognised)+Number(motionOutput.dataset.uncertain)===0;});
    assert.equal(await page.evaluate(()=>motionState.camera.capture().found),null,'occluded current frame must not carry old readings');
    await page.evaluate(()=>{motionState.mode='grid';});
    await page.waitForFunction(()=>!motionState.reading && Number(motionOutput.dataset.recognised)+Number(motionOutput.dataset.uncertain)===22);
    assert.equal(await page.evaluate(()=>motionState.reads),1,'brief occlusion reuses verified work');report.checks.push('finger immediately hides metadata; same board returns without starting OCR again');log('occlusion handled');
    await page.evaluate(()=>{motionState.cells[1]=3;});
    await page.waitForFunction(()=>{const p=motionOutput.getContext('2d').getImageData(10,10,1,1).data;return Math.abs(p[1]-60)<3;});
    assert.equal(await page.evaluate(()=>motionState.camera.capture().found?.puzzle.cells[1]===8),false,'first displayed changed frame cannot show the old clue');
    await page.waitForFunction(()=>motionState.reads>1);
    assert.equal(await page.evaluate(()=>motionState.camera.capture().found?.puzzle.cells[1]===8),false,'changed clue must never retain the old value');
    const changedHandle = await page.waitForFunction(() => {
      if (motionState.reading) return false;
      const value = motionState.snapshot(); return value.cells?.[1] === 3 ? value : false;
    });
    report.changed = await changedHandle.jsonValue(); await changedHandle.dispose();
    report.checks.push('a changed clue starts a new genuine OCR read, never reusing old clue metadata');log('changed clue re-read');
    await page.evaluate(()=>motionState.stop());
    await page.screenshot({path:`browser-artifacts/${name}-motion.png`});
    if(fs.existsSync('live-fixtures/fixtures.json')){
      const corpus=JSON.parse(fs.readFileSync('live-fixtures/fixtures.json','utf8'));log(`tracking ${corpus.fixtures.length} external pictures`);
      report.corpus={source:corpus.source,revision:corpus.revision,selection:corpus.selection,results:await page.evaluate(externalTracking,corpus.fixtures)};
      // This is coverage/retention measurement, not a claim that every external
      // image is readable. A static valid anchor must always match itself.
      let valid=0,retained=0;
      for(const f of report.corpus.results){
        if(!f.validQuad){
          // Keep out-of-image or malformed source annotations in the report
          // as rejected controls, never silently crop or repair the labels.
          assert.equal(f.anchorValid,false);assert.ok(f.checks.every(c=>!c.matched));continue;
        }
        valid++;assert.equal(f.anchorValid,true);assert.equal(f.checks[0].matched,true,`${f.name}: valid static anchor`);
        assert.equal(f.occlusionMatched,false,`${f.name}: covered grid cannot authorize old metadata`);
        retained+=f.checks.slice(1).filter(c=>c.matched).length;
      }
      report.corpus.validAnchors=valid;report.corpus.translatedMatches=retained;report.corpus.translatedChecks=valid*3;
      assert.ok(valid>=10,'the fixed slice must retain broad usable coverage');
      assert.ok(retained>=Math.ceil(valid*3*.9),'at least 90% of valid small-motion controls must retain identity');
      log(`${retained}/${valid*3} small-motion controls kept their identity`);
    }
   }catch(e){
    report.state=await page.evaluate(()=>({reads:window.motionState?.reads,cancels:window.motionState?.cancels,
      ticks:window.motionState?.ticks,reading:window.motionState?.reading,playback:window.motionState?.playback?.(),witness:window.motionOutput?Array.from(motionOutput.getContext('2d').getImageData(10,10,1,1).data):null,counts:{...window.motionOutput?.dataset},diagnostic:window.motionState?.diagnostics?.snapshot(),status:document.getElementById('camera-help')?.textContent})).catch(()=>null);
    throw e;
   } finally {
    await page.evaluate(() => window.motionState?.stop?.()).catch(() => {});
   }
  },{timeout:60000});
 }finally{server.close();}
}
main(module,run);
module.exports={run,beginMotion,externalTracking};
