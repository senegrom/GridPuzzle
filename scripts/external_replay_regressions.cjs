/* Fixed external corpus replay through automatic detection, tracking and real
   OCR. Reference corners/digits are never passed to the browser pipeline.
   This records coverage, including no-read/quality rejections and annotation
   ambiguities, rather than selecting easy successes, and holds every reading
   to the app's safety contract, as newspaper_regressions does: a wrong,
   missed or invented clue must be flagged for review. A picture the app
   declines to read is recorded, not failed. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {serve,engines,main}=require('./harness.cjs');
// Once playback stops, capture() must drop the overlay as soon as the newest
// presented frame is older than the frame scheduler's freshness limit
// (web/live-frame-scheduler.js: fresh while now() - lastSeen <= 500); it
// checks that itself, so no heartbeat has to run first. The margin covers
// the polling interval and a busy runner.
const PRESENTATION_FRESHNESS=500,MARGIN=500;
async function begin(imageData){
 const {Scanner}=await import('./scanner.js'),{createLiveCamera}=await import('./live-camera.js'),{createScanDiagnostics}=await import('./scan-diagnostics.js');
 const img=new Image();img.src=imageData;await img.decode();
 const scale=Math.min(1,1100/Math.max(img.width,img.height)),w=Math.round(img.width*scale),h=Math.round(img.height*scale);
 const source=document.createElement('canvas');source.width=w+32;source.height=h+32;const ctx=source.getContext('2d');
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.style.cssText='position:fixed;left:0;top:0;width:180px;height:220px;z-index:9998';document.body.append(video);
 const out=document.createElement('canvas');out.style.cssText='position:fixed;left:180px;top:0;width:180px;height:220px;z-index:9999';document.body.append(out);
 const state=window.externalReplay={ticks:0,reads:[],readStarts:0,started:false,error:null};
 const d=createScanDiagnostics();d.begin('live',{type:'sudoku',rows:9,cols:9,autoSolve:false});const scanner=new Scanner();
 const paint=()=>{state.ticks++;ctx.fillStyle='#6c7074';ctx.fillRect(0,0,source.width,source.height);ctx.drawImage(img,16+Math.sin(state.ticks*.35),16+Math.cos(state.ticks*.29),w,h);ctx.fillStyle=state.ticks%2?'white':'black';ctx.fillRect(0,0,10,10);};paint();
 const stream=source.captureStream(10),timer=setInterval(paint,100);video.srcObject=stream;
 const camera=createLiveCamera({$:id=>document.getElementById(id),video,canvas:out,diagnostics:d,
   getSettings:()=>({type:'sudoku',rows:9,cols:9,boxRows:3,boxCols:3,enabled:true,autoSolve:false}),
   reader:{prepare:()=>scanner.prepare(),cancel:o=>scanner.cancel(o),async read(...args){state.readStarts++;const f=await scanner.read(...args);state.reads.push({cells:f.puzzle.cells,uncertain:f.cellUncertain,marked:f.markedCells,stats:f.ocrStats});return f;}},
   solver:{prepare(){throw Error('disabled solver should not warm');},cancel(){},solve(){throw Error('recognition benchmark must not solve');}}});
 const button=document.createElement('button');button.id='external-start';button.textContent='Start replay';button.style.cssText='position:fixed;top:230px;left:0;z-index:10000';document.body.append(button);
 button.onclick=async()=>{button.disabled=true;let deadline;try{await Promise.race([video.play(),new Promise((_,no)=>deadline=setTimeout(()=>no(Error('playback-timeout')),20000))]);camera.start();state.started=true;}catch(e){state.error=e.message;}finally{clearTimeout(deadline);}};
 state.report=()=>({reads:state.reads,readStarts:state.readStarts,ticks:state.ticks,dimensions:[source.width,source.height],diagnostic:d.snapshot(),camera:camera.stats});
 state.pause=()=>video.pause();state.capture=()=>{try{const p=camera.capture();const yes=!!p.found;p.photo.width=p.photo.height=p.annotated.width=p.annotated.height=0;return yes;}catch{return false;}};
 state.stop=()=>{camera.stop();clearInterval(timer);stream.getTracks().forEach(t=>t.stop());video.srcObject=null;video.remove();out.remove();button.remove();source.width=source.height=0;return camera.stats;};
}
function labels(block){
 if(!Array.isArray(block)||block.length!==9)throw Error('Unrecognized external annotation');
 return block.flatMap(row=>row.map(flags=>{if(!Array.isArray(flags)||flags.length!==10)throw Error('Invalid cell annotation');
 const digits=flags.flatMap((flag,i)=>i&&flag?[i]:[]);return{value:flags[0]&&digits.length===1?digits[0]:null,ambiguous:!flags[0]&&digits.length>0};}));
}
async function run(){
 const corpus=JSON.parse(fs.readFileSync('live-fixtures/fixtures.json','utf8')),fixtures=corpus.fixtures.slice(0,3),reports=[],failures=[];
 assert.equal(fixtures.length,3);
 const server=await serve();
 try{
  for(const [i,f] of fixtures.entries()){
   const file=`external-replay-${i}.json`;try{await engines(file,async(page,r)=>{
    r.source={name:f.name,sha256:f.sha256,revision:corpus.revision,index:i,selection:'first 3 of the existing hash-selected test slice; no performance filtering'};
    await page.goto(server.base);await page.waitForSelector('body[data-ready="true"]');
    try{
     await page.evaluate(begin,f.data);await page.click('#external-start');await page.waitForFunction(()=>externalReplay.started||externalReplay.error,null,{timeout:25000});
     assert.equal(await page.evaluate(()=>externalReplay.error),null,'actual video must start');
     // The bounded observation window is fixed before measuring this corpus.
     await page.waitForFunction(()=>externalReplay.reads.length,null,{timeout:25000}).catch(e=>{if(e.name!=='TimeoutError')throw e;});
     r.result=await page.evaluate(()=>externalReplay.report());r.outcome=r.result.reads.length?'read':'no-completed-reading';
     const truth=labels(f.cells);r.annotation={ambiguousCells:truth.flatMap((v,i)=>v.ambiguous?[i]:[]),expected:truth.map(v=>v.value)};
     if(r.result.reads.length){const read=r.result.reads.at(-1);r.score={correct:0,wrong:[],unflagged:[]};
      truth.forEach((label,cell)=>{if(label.ambiguous)return;if(label.value===read.cells[cell]){if(Number.isInteger(label.value))r.score.correct++;}else{const e={cell,expected:label.value,actual:read.cells[cell]};r.score.wrong.push(e);if(!read.uncertain.includes(cell))r.score.unflagged.push(e);}});
     }
     const pausedAt=Date.now();await page.evaluate(()=>externalReplay.pause());
     await page.waitForFunction(()=>externalReplay.capture()===false,null,{polling:100,timeout:PRESENTATION_FRESHNESS+MARGIN});
     r.expiredAfter=Date.now()-pausedAt;
     assert.equal(await page.evaluate(()=>externalReplay.capture()),false,'stopped frames cannot attach stale clues');
     if(r.score)assert.deepEqual(r.score.unflagged,[],'every wrong, missed or invented clue must be flagged for review');
    }finally{
     r.closed=await page.evaluate(()=>window.externalReplay?.stop()).catch(()=>null);
     if(r.closed){assert.equal(r.closed.active,false);assert.equal(r.closed.retainedSources,0);assert.equal(r.closed.scratchPixels,0);}
    }
   },{timeout:60000});}catch(e){failures.push(e);}finally{if(fs.existsSync(`browser-artifacts/${file}`))reports.push(...JSON.parse(fs.readFileSync(`browser-artifacts/${file}`,'utf8')));}
  }
 }finally{fs.mkdirSync('browser-artifacts',{recursive:true});fs.writeFileSync('browser-artifacts/external-replay.json',JSON.stringify(reports,null,2));await server.close();}
 if(failures.length)throw failures[0];
}
module.exports={run,labels};main(module,run);
