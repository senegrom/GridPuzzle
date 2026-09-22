import test from 'node:test';
import assert from 'node:assert/strict';
import {makePuzzle,boxShape,fitPlay} from '../model.js';
import {createBackup,parsePuzzleFile} from '../backup.js';
import {puzzleFromReadings} from '../scanner.js';
import {setupPhotoFlow} from '../photo-flow.js';
import {retainPhotoSource} from '../photo-detail.js';
// Production controllers; browser/camera/storage boundaries are controlled.
// Native Save & next and image-preview behaviour also run in hosted browsers.
function canvas(width=600,height=600){
 const ctx=new Proxy({getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h})},{get:(o,k)=>o[k]??(()=>{})});
 return {width,height,getContext:()=>ctx,toDataURL:()=> 'data:image/jpeg;base64,aA=='};
}
function node(id){
 const callbacks=new Map();
 return {...canvas(),id,value:'',textContent:'',checked:false,hidden:false,disabled:false,open:false,style:{},dataset:{},
  focus(){},scrollIntoView(){},setAttribute(){},removeAttribute(k){delete this[k];},
  addEventListener(type,fn){if(!callbacks.has(type))callbacks.set(type,[]);callbacks.get(type).push(fn);},
  removeEventListener(){},emit(type){for(const fn of callbacks.get(type)||[])fn({type,target:this});},
  pause(){},load(){},async play(){},
 };
}
function harness(){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
 for(const p of ['scan-diagnostics','live-diagnostics'])$(p).querySelector=selector=>$(p+'/'+selector.match(/"(.+)"/)[1]);
 const globals=['document','window','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 globalThis.document={createElement:()=>canvas(),addEventListener(){},removeEventListener(){},body:{classList:{add(){},remove(){}}}};
 globalThis.window={addEventListener(){}};
 const tracks=[{stop(){},addEventListener(){}}];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>tracks})}}});
 const p=makePuzzle('latinsquare',2);p.cells[0]=1;
 const state={puzzle:p,photo:canvas(),rectified:canvas(200,200),corners:[{x:0,y:0},{x:599,y:0},{x:599,y:599},{x:0,y:599}],
  puzzleSource:7,photoSource:7,photoRows:2,photoCols:2,uncertain:new Set([0]),cageUncertain:new Set(),blackReadings:[],needsReview:true,
  notes:[],play:fitPlay(p,[]),hints:new Set(),selected:[],history:[]};
 let epoch=0,liveCapture,ocrResult;const errors=[];const stopTask=()=>++epoch;
 const setLayout=l=>{state.layout={...l};for(const [k,id]of [['rows','rows'],['cols','cols'],['boxRows','box-rows'],['boxCols','box-cols']])$(id).value=String(l[k]);};
 setLayout(p);$('puzzle-type').value='latinsquare';$('auto-capture').checked=true;
 const flow=setupPhotoFlow({$,state,scanner:{read:async()=>ocrResult},stopTask,invalidate:stopTask,begin:stopTask,finish(){},
  fail:e=>errors.push(e.message),render(){},status(){},remember(){},persist(){},drawBoard(){},clearPhotoMapping(){state.rectified=state.photoSource=null;},
  solveNow(){},boxDefault:boxShape,setLayout,getJobId:()=>epoch,setDeadline(){},savePicture:async()=>true,
  liveFactory({diagnostics}){return {start(){diagnostics.event({stage:'checking',reason:'read-complete',found:liveCapture.found});},
    stop(){diagnostics.event({stage:'tracking',reason:'stopped'});},capture:()=>liveCapture,diagnosticSource:()=>({image:liveCapture.photo,verified:true})};}});
 const diag=(p='scan-diagnostics')=>Object.fromEntries(['prepare','image-toggle','preview','error','image','download'].map(k=>[k,$(p+'/'+k)]));
 return {$,state,errors,diag,setLayout,setCapture:v=>liveCapture=v,setOCR:v=>ocrResult=v,stop:()=>{flow.stopCamera();for(const[k,d]of globals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
}
function manyCageWarnings(){
 const n=9,cw=40,w=n*cw,h=w,mask=new Uint8Array(w*h),group=[];let serial=0;
 for(let r=0;r<n;r++)for(let c=0;c<n;){const length=Math.min(r+1,n-c);for(let k=0;k<length;k++)group[r*n+c+k]=serial;serial++;c+=length;}
 const paint=(x,y,rw,rh)=>{for(let yy=Math.floor(y);yy<y+rh;yy++)for(let xx=Math.floor(x);xx<x+rw;xx++)if(xx>=0&&yy>=0&&xx<w&&yy<h)mask[yy*w+xx]=1;};
 for(let r=0;r<n;r++)for(let c=0;c<n;c++){
  if(c<n-1&&group[r*n+c]!==group[r*n+c+1])for(const offset of[-3,3])paint((c+1)*cw+offset-1,r*cw,2,cw);
  if(r<n-1&&group[r*n+c]!==group[(r+1)*n+c])for(const offset of[-3,3])paint(c*cw,(r+1)*cw+offset-1,cw,2);
 }
 return puzzleFromReadings({entries:[],black:Array(n*n).fill(false),meta:{boxes:true,rows:n,cols:n},mask,width:w,height:h},'killersudoku',n,n);
}
test('eight real cage warnings plus an original-photo fallback warning remain exportable',async()=>{
 const h=harness();try{
  const found=manyCageWarnings();found.rectified=canvas(900,900);assert.equal(found.notes.length,8);
  h.setLayout(found.puzzle);h.$('puzzle-type').value='killersudoku';h.setOCR(found);
  retainPhotoSource(h.state.photo,new Blob(['placeholder compressed photo']),{width:5000,height:4000});
  h.$('read-photo').onclick();await new Promise(r=>setImmediate(r));
  assert.deepEqual(h.errors,[]);assert.equal(h.state.notes.length,9);
  const r=parsePuzzleFile(createBackup(h.state));assert.deepEqual(r.notes,h.state.notes);assert.equal(r.needsReview,true);
  assert.deepEqual(r.cageUncertain,[...h.state.cageUncertain]);assert.deepEqual(r.uncertain,[...h.state.uncertain]);
 }finally{h.stop();}
});
test('capture-to-editor diagnostics retain the exact source and require renewed image opt-in',async()=>{
 const h=harness();try{
  const found={puzzle:h.state.puzzle,notes:[],rectified:canvas(200,200),cellUncertain:[0],cageUncertain:[],needsReview:true};
  const photo=canvas();h.setCapture({photo,annotated:canvas(),found,corners:h.state.corners,createdAt:1});
  await h.$('camera').onclick();const live=h.diag('live-diagnostics');live.prepare.onclick();live['image-toggle'].checked=true;live['image-toggle'].onchange();
  assert.equal(live.error.textContent,'');assert.equal(live.download.disabled,false);
  h.$('take-photo').onclick();await new Promise(r=>setImmediate(r));
  assert.equal(live['image-toggle'].checked,false,'capture clears prior image consent');
  live.prepare.onclick();assert.equal(JSON.parse(live.preview.textContent).source,'capture');
  live['image-toggle'].checked=true;live['image-toggle'].onchange();assert.equal(live.error.textContent,'');
  h.$('use-live-capture').onclick();assert.equal(live['image-toggle'].checked,false,'editor handoff requires fresh consent again');
  assert.equal(h.state.photo,photo);assert.ok(h.state.rectified);assert.equal(h.state.photoSource,h.state.puzzleSource);assert.deepEqual(h.errors,[]);
  const diag=h.diag();diag.prepare.onclick();let report=JSON.parse(diag.preview.textContent);
  assert.equal(report.source,'photo');assert.equal(report.readingVerifiedForImage,true);assert.equal(report.privacy.includesImage,false);
  diag['image-toggle'].checked=true;diag['image-toggle'].onchange();report=JSON.parse(diag.preview.textContent);
  assert.equal(diag.error.textContent,'');assert.equal(diag.download.disabled,false);assert.equal(report.privacy.includesImage,true);
  assert.equal(report.image.width,photo.width);assert.equal(report.lastReading.needsReview,true);
 }finally{h.stop();}
});
test('stopping a captured-view diagnostic clears consent and cannot fall back to an unrelated editor photo',async()=>{
 const h=harness();try{
  h.setCapture({photo:canvas(),annotated:canvas(),found:null,corners:null,createdAt:1});
  await h.$('camera').onclick();h.$('take-photo').onclick();await new Promise(r=>setImmediate(r));
  const d=h.diag('live-diagnostics');d.prepare.onclick();d['image-toggle'].checked=true;d['image-toggle'].onchange();assert.equal(d.error.textContent,'');
  h.$('close-camera').onclick();assert.equal(d['image-toggle'].checked,false);
  d.prepare.onclick();d['image-toggle'].checked=true;d['image-toggle'].onchange();
  assert.match(d.error.textContent,/No current source/);assert.equal(d.download.disabled,true);
 }finally{h.stop();}
});
