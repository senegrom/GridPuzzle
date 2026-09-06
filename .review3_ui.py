"""Isolate task/photo/offline ownership and make OCR startup cancellable."""
from pathlib import Path

p=Path('web/app.js');s=p.read_text()
s=s.replace('conflicts,isCage}', 'conflicts,isCage,boxShape}')
s=s.replace("import {homography,project,validQuad}", "import {homography,project}")
s="import {createTaskController} from './task-controller.js';\nimport {captureEdit,restoreEdit,rememberEdit} from './edit-history.js';\nimport {setupPhotoFlow} from './photo-flow.js';\nimport {setupOffline} from './offline.js';\n"+s
old='let worker=null,jobId=0,busy=false,timer=null,deadline=null,started=0,stream=null,cameraEpoch=0,editing=0,drag=-1,focused=0;'
assert old in s;s=s.replace(old,'let worker=null,editing=0,focused=0;')
a=s.index('function remember(){');b=s.index('\nfunction persist()',a)
s=s[:a]+'function remember(){rememberEdit(state);}\n'+s[b:]
a=s.index('function stopTask(');b=s.index('function invalidate()',a)
s=s[:a]+'''const tasks=createTaskController({$,scanner,status,onStop:wasBusy=>{
  if(wasBusy&&worker){worker.terminate();worker=null;}
}});
const stopTask=message=>tasks.stop(message);
const begin=()=>tasks.begin();
const finish=()=>tasks.finish();
''' + s[b:]
a=s.index('function begin(){');b=s.index('function mutate(',a);s=s[:a]+s[b:]
a=s.index('function mutate(');b=s.index('\nfunction normalized',a)
s=s[:a]+'''function mutate(fn){
  const previous=captureEdit(state),history=[...state.history];
  remember();invalidate();
  try{fn();checkShape(state.puzzle);}catch(error){restoreEdit(state,previous);state.history=history;render();throw error;}
  persist();render();
}''' + s[b:]
s=s.replace("return {...clone(p),cages:","return {...clone(p),boxRows:p.boxRows===undefined?3:p.boxRows,boxCols:p.boxCols===undefined?3:p.boxCols,cages:")
s=s.replace("function boxDefault(n){let a=Math.floor(Math.sqrt(n));while(n%a)a--;return [a,n/a];}", 'const boxDefault=boxShape;')
s=s.replace("$('progress').hidden=!busy;", "$('progress').hidden=!tasks.busy;")
s=s.replace('needsReview:state.needsReview,busy}', 'needsReview:state.needsReview,busy:tasks.busy}')
s=s.replace("stopTask(busy?'Stopped for editing.':null)","stopTask(tasks.busy?'Stopped for editing.':null)")
s=s.replace('jobId','tasks.id')
s=s.replace('deadline=setTimeout(', 'tasks.setDeadline(')
s=s.replace('clearTimeout(deadline);','tasks.clearDeadline();')
a=s.index('function stopCamera(){');b=s.index('\nfunction offlineMessage',a)
photo=s[a:b]
pagehide="window.addEventListener('pagehide',()=>{stopCamera();stopTask();if(worker){worker.terminate();worker=null;}});"
assert pagehide in photo
photo=photo.replace(pagehide,'').replace('tasks.id','getJobId()')
Path('web/photo-flow.js').write_text("import {validQuad} from './geometry.js';\n\nexport function setupPhotoFlow({$,state,scanner,stopTask,invalidate,begin,finish,fail,render,status,remember,persist,drawBoard,clearPhotoMapping,solveNow,boxDefault,getJobId}) {\nlet stream=null,cameraEpoch=0,drag=-1;\n"+photo+'\nreturn {stopCamera};\n}\n')
s=s[:a]+'''const {stopCamera}=setupPhotoFlow({$,state,scanner,stopTask,invalidate,begin,finish,fail,render,status,remember,persist,drawBoard,clearPhotoMapping,solveNow,boxDefault,getJobId:()=>tasks.id});
''' + pagehide+'\n'+s[b:]
a=s.index('function offlineMessage(');b=s.index('try{const saved=restoreSession',a)
offline=s[a:b]
offline=offline.replace("registration.waiting.postMessage({type:'ACTIVATE'});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});", "navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration.waiting.postMessage({type:'ACTIVATE'});")
offline=offline.replace("}).catch(e=>{$('offline-state').textContent=", "}).catch(e=>{$('prepare-offline').disabled=true;$('offline-state').textContent=")
Path('web/offline.js').write_text('export function setupOffline($) {\n'+offline+'\n}\n')
s=s[:a]+'setupOffline($);\n'+s[b:]
p.write_text(s)
Path('web/edit-history.js').write_text('''import {clone} from './model.js';
export function captureEdit(state){
  return {puzzle:clone(state.puzzle),uncertain:[...state.uncertain],needsReview:state.needsReview,notes:[...state.notes],source:state.puzzleSource};
}
export function restoreEdit(state,snapshot){
  state.puzzle=snapshot.puzzle;state.uncertain=new Set(snapshot.uncertain);
  state.needsReview=snapshot.needsReview;state.notes=snapshot.notes;state.puzzleSource=snapshot.source;state.selected=[];
}
export function rememberEdit(state){
  state.history.push(captureEdit(state));if(state.history.length>30)state.history.shift();
}
''')
Path('web/task-controller.js').write_text('''// One owner for task generations, deadlines, progress and cancellation UI.
export function createTaskController({$,scanner,status,onStop}){
  let id=0,busy=false,timer=null,deadline=null,started=0;
  const clearDeadline=()=>{clearTimeout(deadline);deadline=null;};
  const finish=()=>{busy=false;clearInterval(timer);timer=null;clearDeadline();$('stop').hidden=true;$('solve').disabled=false;$('progress').hidden=true;$('status').setAttribute('aria-busy','false');};
  const stop=(message=null)=>{
    id++;scanner.cancel();onStop(busy);finish();
    if(message)status(message,'Search unfinished. No claim about uniqueness or impossibility has been made.','warning');
  };
  return {
    get id(){return id;},get busy(){return busy;},stop,finish,clearDeadline,
    setDeadline(callback,ms){clearDeadline();deadline=setTimeout(callback,ms);},
    begin(){stop();busy=true;started=performance.now();$('stop').hidden=false;$('solve').disabled=true;$('status').setAttribute('aria-busy','true');timer=setInterval(()=>{$('status-detail').textContent=`${((performance.now()-started)/1000).toFixed(1)} seconds elapsed · Stop cancels this task.`;},500);return id;}
  };
}
''')

# The grayscale buffer is reused by thresholding and region extraction.
p=Path('web/geometry.js');g=p.read_text()
old='export function threshold(image,window=25,bias=12) {\n  const w=image.width,h=image.height,g=gray(image),sum=new Float64Array((w+1)*(h+1));'
assert old in g
g=g.replace(old,'''export function threshold(image,window=25,bias=12) {
  return thresholdGray(gray(image),image.width,image.height,window,bias);
}
export function thresholdGray(g,w,h,window=25,bias=12) {
  const sum=new Float64Array((w+1)*(h+1));''')
g=g.replace('export function gridLines(image){\n  const w=image.width,h=image.height,b=threshold(image),', 'export function gridLines(image,mask){\n  const w=image.width,h=image.height,b=mask??threshold(image),')
g=g.replace('export function estimateGrid(image){\n  const lines=gridLines(image),','export function estimateGrid(image,mask){\n  const lines=gridLines(image,mask),')
p.write_text(g)
p=Path('web/scanner.js');s=p.read_text()
a=s.index('let library;');b=s.index('const aborted=',a);s=s[:a]+s[b:]
s=s.replace("import {threshold,gray} from './geometry.js';\n",'')
a=s.index('    const w=image.width,h=image.height,cw=w/cols,ch=h/rows,mask=threshold(image),g=gray(image),rectified=canvasOf(image);')
b=s.index("    if(!entries.length)",a)
analysis=s[a:b].replace('mask=threshold(image),g=gray(image),rectified=canvasOf(image)', 'g=gray(image),mask=thresholdGray(g,w,h)')
fraction=s[s.index('function fraction('):s.index('function componentsForCages(')]
Path('web/scan-analysis.js').write_text("import {gray,thresholdGray,estimateGrid} from './geometry.js';\n"+fraction+'\nexport function prepareScan(image,type,rows,cols){\n'+analysis+'\nreturn {image,meta:estimateGrid(image,mask),mask,g,black,entries};\n}\n')
s=s[:a]+'    const w=image.width,h=image.height,cw=w/cols,ch=h/rows,rectified=canvasOf(image);\n'+s[b:]
s=s.replace("const {image,meta}=await this.geometry('warp',{image:imageOf(canvas),corners,width:Math.min(1500,cols*100),height:Math.min(1500,rows*100)});check();", "const {image,meta,mask,g,black,entries}=await this.geometry('prepare',{image:imageOf(canvas),corners,width:Math.min(1500,cols*100),height:Math.min(1500,rows*100),type,rows,cols});check();")
a=s.index('  constructor(){');b=s.index('  detect(canvas)',a)
s=s[:a]+'''  constructor(){this.epoch=0;this.jobs=new Set();}
  cancel(){this.epoch++;for(const job of this.jobs)job.cancel();this.jobs.clear();}
  _request(path,payload,onProgress=()=>{},type='module'){
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL(path,import.meta.url),{type});
      let settled=false;
      const end=(error,result,cancel=false)=>{
        if(settled)return;settled=true;clearTimeout(timeout);this.jobs.delete(job);
        worker.onmessage=worker.onerror=null;
        if(cancel&&type==='classic'){
          // The host can terminate its raw child even while createWorker is
          // still awaiting engine/language initialization. Bound host cleanup
          // too, including a stalled importScripts before any child exists.
          const kill=setTimeout(()=>worker.terminate(),100);
          worker.onmessage=()=>{clearTimeout(kill);worker.terminate();};
          worker.postMessage({cancel:true});
        }else worker.terminate();
        error?reject(error):resolve(result);
      };
      const job={cancel:()=>end(aborted(),null,true)};
      const timeout=setTimeout(()=>end(Error('Image processing timed out. Go online and retry.'),null,true),180000);
      this.jobs.add(job);
      worker.onmessage=({data})=>{
        if(data.type==='progress'){onProgress(data.message,data.progress);return;}
        end(data.error?Error(data.error):null,data.result);
      };
      worker.onerror=e=>end(Error(e.message||'Image processing failed'),null,true);
      worker.postMessage(payload);
    });
  }
  geometry(op,options){return this._request('geometry-worker.js',{op,...options});}
''' + s[b:]
a=s.index('    const T=await tesseract();');b=s.index('    const valueEntries=',a)
s=s[:a]+'''    const blob=await new Promise((resolve,reject)=>atlas.toBlob(value=>value?resolve(value):reject(Error('Could not encode the OCR atlas.')),'image/png'));check();
    const png=await blob.arrayBuffer();check();
    const data=await this._request('ocr-host-worker.js',{png},onProgress,'classic');check();
    const readings=mapAtlas(data,entries.length,columns,tile);
    entries.forEach((e,i)=>{e.text=readings[i].text;e.confidence=readings[i].confidence;});
''' + s[b:]
p.write_text(s)
Path('web/geometry-worker.js').write_text('''import {findGrid,warp,estimateGrid,sharpness} from './geometry.js';
import {prepareScan} from './scan-analysis.js';
self.onmessage=({data})=>{
  try{
    let result;
    if(data.op==='detect') result={...findGrid(data.image),sharpness:sharpness(data.image)};
    else if(data.op==='warp'||data.op==='prepare'){
      const image=warp(data.image,data.corners,data.width,data.height);
      result=data.op==='prepare'?prepareScan(image,data.type,data.rows,data.cols):{image,meta:estimateGrid(image)};
    }else throw Error('Unknown image task');
    const transfer=result.image?[result.image.data.buffer,...(result.mask?[result.mask.buffer,result.g.buffer]:[])]:[];
    self.postMessage({result},transfer);
  }catch(error){self.postMessage({error:error.message});}
};
''')
Path('web/ocr-host-worker.js').write_text('''/* Classic, per-scan host: owns raw OCR workers from construction onward. */
const children=new Set(),NativeWorker=self.Worker;
self.Worker=class extends NativeWorker{
  constructor(...args){super(...args);children.add(this);}
  terminate(){children.delete(this);super.terminate();}
};
function stopChildren(){for(const child of children)child.terminate();}
const local=path=>new URL(path,self.location.href).href;
self.onmessage=async({data})=>{
  if(data.cancel){stopChildren();self.postMessage({cancelled:true});self.close();return;}
  try{
    importScripts(local('./vendor/tesseract/tesseract.min.js'));
    const worker=await self.Tesseract.createWorker('eng',1,{
      workerPath:local('./vendor/tesseract/worker.min.js'),
      corePath:local('./vendor/tesseract-core/'),
      langPath:local('./vendor/tessdata/').replace(/\\/$/,''),
      workerBlobURL:false,
      errorHandler:error=>{stopChildren();self.postMessage({error:String(error)});},
      logger:m=>{if(m.status==='recognizing text')self.postMessage({type:'progress',message:'Reading printed clues…',progress:m.progress});}
    });
    await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:'0123456789<>^vV+-xX*/=×÷',user_defined_dpi:'300'});
    const {data:result}=await worker.recognize(new Uint8Array(data.png),{}, {text:true,blocks:true});
    await worker.terminate();
    self.postMessage({result});
  }catch(error){self.postMessage({error:error.message||String(error)});}
  finally{stopChildren();}
};
''')
Path('web/tests/worker-lifecycle.test.js').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Scanner} from '../scanner.js';
import {gray,threshold,thresholdGray} from '../geometry.js';

test('OCR cancellation terminates a child before initialization resolves',async()=>{
  let child,terminated=0;const messages=[];
  class Worker{constructor(){child=this;}terminate(){terminated++;}}
  const self={Worker,location:{href:'https://example.test/GridPuzzle/ocr-host-worker.js'},postMessage:m=>messages.push(m),close(){}};
  const context=vm.createContext({self,URL,Uint8Array,importScripts(){self.Tesseract={createWorker:()=>{new self.Worker();return new Promise(()=>{});}};}});
  vm.runInContext(fs.readFileSync(new URL('../ocr-host-worker.js',import.meta.url),'utf8'),context);
  void self.onmessage({data:{png:new ArrayBuffer(0)}});
  assert.ok(child);
  await self.onmessage({data:{cancel:true}});
  assert.equal(terminated,1);assert.equal(messages.at(-1).cancelled,true);
});
test('scan cancellation rejects a pending worker request immediately',async()=>{
  const old=globalThis.Worker;let instance;
  globalThis.Worker=class{constructor(){instance=this;}postMessage(m){this.last=m;}terminate(){this.stopped=true;}};
  try{
    const scanner=new Scanner(),promise=scanner._request('ocr-host-worker.js',{},()=>{},'classic');
    scanner.cancel();await assert.rejects(promise,{name:'AbortError'});
    assert.equal(scanner.jobs.size,0);assert.equal(instance.last.cancel,true);
    instance.onmessage({data:{cancelled:true}});assert.ok(instance.stopped);
  }finally{globalThis.Worker=old;}
});
test('shared grayscale threshold is byte-for-byte identical',()=>{
  const image={width:41,height:37,data:Uint8ClampedArray.from({length:41*37*4},(_,i)=>(i*71)%256)};
  assert.deepEqual(threshold(image),thresholdGray(gray(image),image.width,image.height));
});
''')

# Browser-level input regression: errors must not commit poison to state/storage.
p=Path('scripts/browser_smoke.cjs');s=p.read_text()
anchor="      await page.goto(BASE);await ready(page);"
assert anchor in s
s=s.replace(anchor,anchor+'''
      await page.evaluate(async()=>{
        const app=await import('./app.js'),model=await import('./model.js');
        const before=JSON.stringify(app.getState().puzzle),saved=localStorage.getItem('gridpuzzle-session-v1');
        for(const value of [1e-12,1.5,0,-1,'2',null]){
          const p=model.makePuzzle('sudoku',4);p.boxRows=value;
          let threw=false;try{app.loadPuzzle(p);}catch{threw=true;}
          if(!threw||JSON.stringify(app.getState().puzzle)!==before||localStorage.getItem('gridpuzzle-session-v1')!==saved)throw Error('Unsafe import committed state');
        }
        const p=model.makePuzzle('sudoku',4);p.boxRows=1e-12;localStorage.setItem('gridpuzzle-session-v1',JSON.stringify({puzzle:p}));
      });
      await reloadPage(page);
      assert.equal((await page.evaluate(()=>window.__gridpuzzleTestState())).puzzle.rows,9);
      report.checks.push('invalid imports rejected atomically; poisoned saved session recovers');
''')
anchor="      await uploadFixture(page,image);const scan="
assert anchor in s
s=s.replace(anchor,'''      await checkStartupCancellation(browser,image,report);
      await uploadFixture(page,image);const scan=''',1)
a=s.index('(async()=>{\n  await startServer();')
s=s[:a]+'''async function checkStartupCancellation(browser,image,report){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  let release,seen;
  const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>seen=resolve);
  await context.route('**/vendor/tessdata/**',async route=>{seen();await gate;try{await route.abort();}catch{}});
  try{
    await page.goto(BASE);await ready(page);
    await page.selectOption('#puzzle-type','sudoku');
    await page.setInputFiles('#photo-file',{name:'startup.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
    await page.waitForFunction(()=>document.querySelector('#status-text').textContent==='Grid found.');
    await page.click('#read-photo');
    let timeout;
    try{await Promise.race([requested,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('OCR language initialization was not observed')),30000);})]);}finally{clearTimeout(timeout);}
    await page.click('#stop');
    assert.equal((await page.evaluate(()=>window.__gridpuzzleTestState())).busy,false);
    await sleep(250);
    assert.equal(page.workers().filter(w=>/ocr-host-worker|tesseract.*worker/.test(w.url())).length,0,'OCR initialization worker leaked after Stop');
    await context.unroute('**/vendor/tessdata/**');release();
    await uploadFixture(page,image);
    assert.ok((await checkTranscription(page)).correct>=24,'Fresh scan after startup cancellation failed');
    report.checks.push('cancel during actual OCR language initialization; workers stop; fresh scan succeeds');
  }finally{release();await context.close();}
}
''' + s[a:]
# Exercise readiness and repair via the real service-worker message protocol.
anchor="      assert.ok(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),'The service worker must control the document.');"
assert anchor in s
s=s.replace(anchor,anchor+'''
      const repaired=await page.evaluate(async()=>{
        const registration=await navigator.serviceWorker.ready;
        const key=(await caches.keys()).find(k=>k.startsWith(`gridpuzzle:${registration.scope}:`)),cache=await caches.open(key),asset=new URL('model.js',registration.scope).href;
        const original=await (await cache.match(asset)).text();await cache.put(asset,new Response('wrong-version bytes'));
        const message=type=>new Promise((resolve,reject)=>{const channel=new MessageChannel();channel.port1.onmessage=({data})=>{if(data.done||data.error){channel.port1.close();data.error?reject(Error(data.error)):resolve(data);}};registration.active.postMessage({type},[channel.port2]);});
        const before=await message('OFFLINE_STATUS');await message('PREPARE_OFFLINE');const after=await message('OFFLINE_STATUS');
        return !before.ready&&after.ready&&(await (await cache.match(asset)).text())===original;
      });
      assert.ok(repaired,'Bad cached asset did not recover through the real service worker');report.checks.push('verified offline readiness and poisoned-cache recovery');
''')
p.write_text(s)
print('Separated browser lifecycle modules, moved scan preparation off-thread, and added cancellable OCR ownership.')
