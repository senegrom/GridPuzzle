/* Same real video grid, independent bounded sensor noise in every frame.
   Detection, registration and OCR are production code. Expected digits only
   score the output; they are never passed to the detector/reader/worker. */
const assert = require('node:assert/strict');
const {serve,engines,main}=require('./harness.cjs');
async function begin() {
  const {Scanner}=await import('./scanner.js'),{createLiveCamera}=await import('./live-camera.js');
  const {createScanDiagnostics}=await import('./scan-diagnostics.js');
  const values=[
    null,8,null,null,null,null,9,null,null,
    null,null,null,7,null,null,1,null,null,
    null,null,6,null,null,2,null,null,4,
    7,5,null,null,null,9,null,null,null,
    null,null,null,null,null,null,null,null,6,
    null,null,9,null,4,8,null,null,3,
    null,4,8,null,null,null,null,3,null,
    null,null,null,null,1,null,null,null,null,
    null,3,null,5,null,null,8,null,null];
  const source=document.createElement('canvas');source.width=480;source.height=640;
  const ctx=source.getContext('2d'),template=document.createElement('canvas');template.width=480;template.height=640;
  const x=template.getContext('2d'),video=document.createElement('video'),out=document.createElement('canvas');
  video.muted=true;video.playsInline=true;
  video.style.cssText='position:fixed;left:0;top:0;width:210px;height:280px;z-index:9998';
  out.style.cssText='position:fixed;left:210px;top:0;width:210px;height:280px;z-index:9999';
  document.body.append(video,out);
  const diagnostics=createScanDiagnostics();diagnostics.begin('live',{});
  const state=window.noiseState={mode:'grid',ticks:0,reads:0,completed:0,started:false,error:null};
  let seed=81731,base;
  function draw() {
    x.fillStyle='#696b6e';x.fillRect(0,0,480,640);x.fillStyle='#c1bfb9';x.fillRect(30,80,420,500);
    x.fillStyle='#252a30';x.font='24px Arial';x.fillText('Sudoku',60,120);
    x.fillStyle='#b0c1d6';x.fillRect(60,160,40,360);
    for(let k=0;k<=9;k++){
      x.strokeStyle=k%3?'#8e8e8e':'#303338';x.lineWidth=k%3?1:2.2;
      x.beginPath();x.moveTo(60+k*40,160);x.lineTo(60+k*40,520);
      x.moveTo(60,160+k*40);x.lineTo(420,160+k*40);x.stroke();
    }
    x.fillStyle='#26282c';x.font='26px Arial';x.textAlign='center';x.textBaseline='middle';
    values.forEach((v,i)=>{if(v!==null)x.fillText(String(v),60+(i%9+.5)*40,160+(Math.floor(i/9)+.5)*40);});
    x.textAlign='start';x.textBaseline='alphabetic';
    if(state.mode==='covered'){x.fillStyle='#ac8064';x.fillRect(190,290,90,100);}
    // Out-of-grid marker witnesses which scene has reached the displayed frame.
    x.fillStyle=`rgb(${state.mode==='covered'?172:36},${values[1]*20},80)`;x.fillRect(0,0,25,25);
    base=x.getImageData(0,0,480,640);
  }
  function paint(){
    const frame=new ImageData(new Uint8ClampedArray(base.data),480,640);
    // Shared-channel additive noise preserves hue and glyph geometry. ±8 raw
    // brightness levels must not be amplified into fake changed blank cells.
    for(let i=0;i<frame.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const n=(seed>>>8)%17-8;for(let c=0;c<3;c++)frame.data[i+c]+=n;}
    ctx.putImageData(frame,0,0);state.ticks++;
    state.stream?.getVideoTracks().forEach(t=>t.requestFrame?.());
  }
  draw();paint();const stream=source.captureStream(12);state.stream=stream;video.srcObject=stream;
  const clock=setInterval(paint,80),reader=new Scanner();
  const camera=createLiveCamera({$:id=>document.getElementById(id),video,canvas:out,diagnostics,
    getSettings:()=>({type:'auto',rows:9,cols:9,boxRows:3,boxCols:3,enabled:true,autoSolve:false}),
    reader:{prepare:()=>reader.prepare(),cancel:o=>reader.cancel(o),async read(...args){state.reads++;
      const result=await reader.read(...args);state.completed++;return result;}},
    solver:{prepare(){},cancel(){},invalidate(){},solve(){throw Error('No solver should run with auto-solve off');}}});
  state.snapshot=()=>{
    let found=null;
    try{const shot=camera.capture();if(shot.found)found={cells:[...shot.found.puzzle.cells],type:shot.found.puzzle.type,
      review:shot.found.needsReview,refining:!!shot.found.refining,uncertain:[...(shot.found.uncertain??[])]};
      shot.photo.width=shot.photo.height=shot.annotated.width=shot.annotated.height=0;}catch{/* no accepted frame */}
    return{found,expected:[...values],reads:state.reads,completed:state.completed,ticks:state.ticks,
      diagnostic:diagnostics.snapshot(),status:document.getElementById('camera-help').textContent};
  };
  state.witness=()=>Array.from(out.getContext('2d').getImageData(10,10,1,1).data);
  state.cover=()=>{state.mode='covered';draw();paint();};
  state.uncover=()=>{state.mode='grid';draw();paint();};
  state.change=()=>{values[1]=3;draw();paint();};
  const start=document.createElement('button');start.id='noise-start';start.textContent='Start noisy video';
  start.style.cssText='position:fixed;left:0;top:290px;z-index:10000';document.body.append(start);
  start.onclick=async()=>{start.disabled=true;let deadline;
    try{await Promise.race([video.play(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Noisy video did not start')),20000);})]);
      camera.start();state.started=true;}catch(e){state.error=e.message;}finally{clearTimeout(deadline);}};
  state.stop=()=>{camera.stop();clearInterval(clock);stream.getTracks().forEach(t=>t.stop());reader.cancel();
    video.srcObject=null;video.remove();out.remove();start.remove();source.width=source.height=template.width=template.height=0;};
}
async function run(){const server=await serve();try{
  await engines('live-noise.json',async(page,report,name)=>{
    await page.goto(server.base);await page.waitForSelector('body[data-ready="true"]');
    try{
      await page.evaluate(begin);await page.click('#noise-start');
      await page.waitForFunction(()=>noiseState.started||noiseState.error,null,{timeout:25000});
      assert.equal(await page.evaluate(()=>noiseState.error),null);
      const first=await page.waitForFunction(()=>{if(!noiseState.completed)return false;
        const v=noiseState.snapshot();return v.found&&!v.found.refining?v:false;},null,{timeout:60000});
      report.initial=await first.jsonValue();await first.dispose();
      assert.deepEqual(report.initial.found.cells,report.initial.expected);
      assert.equal(report.initial.expected.filter(Number.isInteger).length,22);
      assert.equal(report.initial.reads,1,'sensor noise must not restart a readable unchanged board');
      assert.equal(report.initial.found.review,true);assert.equal(report.initial.found.type,'sudoku');
      await page.evaluate(()=>noiseState.cover());
      const covered=await page.waitForFunction(()=>{if(Math.abs(noiseState.witness()[0]-172)>10)return false;
        const v=noiseState.snapshot();return v.found===null?v:false;},null,{timeout:5000});
      report.covered=await covered.jsonValue();await covered.dispose();
      await page.evaluate(()=>noiseState.uncover());
      const restored=await page.waitForFunction(()=>{const v=noiseState.snapshot();return v.found?v:false;},null,{timeout:10000});
      report.restored=await restored.jsonValue();await restored.dispose();
      assert.equal(report.restored.reads,1,'brief obstruction should not discard finished OCR');
      await page.evaluate(()=>noiseState.change());
      const changed=await page.waitForFunction(()=>{const v=noiseState.snapshot();return noiseState.completed>=2&&v.found?.cells[1]===3?v:false;},null,{timeout:60000});
      report.changed=await changed.jsonValue();await changed.dispose();
      assert.equal(report.changed.reads,2);assert.deepEqual(report.changed.found.cells,report.changed.expected);
      assert.ok(report.changed.diagnostic.events.some(e=>e.reason==='content-changed'));
      report.checks=['auto type, automatic grid detection and real OCR complete on independently noisy video',
        '22 clues and all blank cells unchanged; one initial full read','covered pixels cannot carry old metadata',
        'changed 8 to 3 retires original reading and triggers fresh OCR'];
      await page.screenshot({path:`browser-artifacts/${name}-live-noise.png`});
    }finally{report.final=await page.evaluate(()=>window.noiseState?.snapshot()).catch(()=>null);
      await page.evaluate(()=>window.noiseState?.stop()).catch(()=>{});}
  },{timeout:60000});
}finally{await server.close();}}
module.exports={run};main(module,run);
