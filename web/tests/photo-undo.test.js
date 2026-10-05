import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setupPhotoFlow } from '../photo-flow.js';
import { makePuzzle, boxShape, fitPlay, conflicts } from '../model.js';
import { rememberEdit, restoreEdit, prepareEdit } from '../edit-history.js';
import { saveSession, restoreSession } from '../session.js';

// Real photo flow and the app's actual Undo handler with controlled DOM and
// recognition results. Tests state ownership, not OCR or physical devices.
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const undoHandler = app.match(/\$\("undo"\)\.onclick = \(\) => \{[\s\S]*?\n\};/)[0];
const tick=()=>new Promise(r=>setImmediate(r));
function canvas(width=600,height=600){
 const ctx=new Proxy({getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h})},{get:(o,k)=>o[k]??(()=>{})});
 return {width,height,getContext:()=>ctx,toDataURL:()=> 'data:image/jpeg;base64,aA=='};
}
function photoHarness(t,size,turns){
 const originals=['document','window','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 const nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{...canvas(),id,value:'',style:{},dataset:{},hidden:false,checked:false,
   addEventListener(){},removeEventListener(){},focus(){},scrollIntoView(){},setAttribute(){},removeAttribute(){}});return nodes.get(id);};
 for(const id of ['scan-diagnostics','live-diagnostics'])$(id).querySelector=s=>$(id+'/'+s.match(/"(.+)"/)[1]);
 globalThis.document={createElement:()=>canvas(),addEventListener(){},removeEventListener(){},body:{classList:{add(){},remove(){}}}};
 globalThis.window={addEventListener(){}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
 const puzzle=makePuzzle('sudoku',size),photo=canvas();
 const corners=[{x:0,y:0},{x:599,y:0},{x:599,y:599},{x:0,y:599}];
 const state={puzzle,photo,corners,uncertain:new Set(),cageUncertain:new Set(),blackReadings:[],notes:[],history:[],play:fitPlay(puzzle,[]),hints:new Set(),selected:[]};
 const expected=makePuzzle('sudoku',size);expected.boxRows=2;expected.boxCols=size/2;
 expected.cells=Array.from({length:size*size},(_,i)=>{const r=Math.floor(i/size),c=i%size;return (Math.floor(r/2)+(r%2)*(size/2)+c)%size+1;});
 const found={puzzle:structuredClone(expected),turns,notes:[],cellUncertain:[],uncertain:[],cageUncertain:[],needsReview:true,rectified:canvas()};
 const setLayout=l=>{state.layout={...l};for(const [key,id] of [['rows','rows'],['cols','cols'],['boxRows','box-rows'],['boxCols','box-cols']])$(id).value=String(l[key]);};
 setLayout({rows:size,cols:size,boxRows:size/2,boxCols:2});$('puzzle-type').value='sudoku';
 let epoch=0,saved=null; const storage={set:(_key,value)=>{saved=value;},get:()=>saved}; const errors=[];let readImpl=async()=>found, detection={rows:size,cols:size,corners,confidence:.99};
 const flow=setupPhotoFlow({$,state,scanner:{read:(...args)=>readImpl(...args),detect:async()=>detection},
   stopTask:()=>++epoch,invalidate:()=>++epoch,begin:()=>++epoch,finish(){},fail:e=>errors.push(e.message),render(){},status(){},remember(){rememberEdit(state);},persist(){saveSession(storage,state);},drawBoard(){},
   clearPhotoMapping(){state.rectified=state.photoSource=null;},solveNow(){},boxDefault:boxShape,setLayout,getJobId:()=>epoch,setDeadline(){}});
 t.after(()=>{flow.stopCamera();for(const [k,desc]of originals){if(desc)Object.defineProperty(globalThis,k,desc);else delete globalThis[k];}});
 const invalidate=()=>{epoch++;state.result=null;state.playSolution=null;state.playFeedback=null;};
 const render=()=>setLayout(state.layout||state.puzzle);
 runInNewContext(undoHandler,{$,state,invalidate,restoreEdit,persist:()=>saveSession(storage,state),render,status(){}});
 return {$,state,expected,errors,found,setLayout,corners,storage,undo:()=>$('undo').onclick(),
   setReader(fn){readImpl=fn;},setDetection(value){detection=value;}};
}
for(const turns of [1,3])test(`undo then repeat Read keeps crop and rectangular boxes aligned: ${turns}`,async t=>{
 const h=photoHarness(t,6,turns); h.$('read-photo').onclick(); await tick();
 assert.deepEqual(h.errors,[]); assert.deepEqual([h.state.puzzle.boxRows,h.state.puzzle.boxCols],[2,3]);
 const rotatedCorners=structuredClone(h.state.corners);
 assert.ok(h.state.history.length); h.undo();
 assert.deepEqual(h.state.corners,h.corners);
 assert.equal(h.state.rectified,null); assert.equal(h.state.photoSource,null);
 assert.deepEqual([h.state.layout.boxRows,h.state.layout.boxCols],[3,2]);
 // Simulate the recognizer's orientation relative to the requested crop: if
 // undo restored the original corners, auto-orient again; if not, it is upright.
 h.setReader(async (_image, quad)=>({...h.found,puzzle:structuredClone(h.expected),
   turns:JSON.stringify(quad)===JSON.stringify(rotatedCorners)?0:turns}));
 h.$('read-photo').onclick(); await tick();
 assert.deepEqual(h.errors,[]);
 assert.equal(conflicts(h.state.puzzle).size,0,'undo must not change the photographed box rules on the next Read');
});

for(const turns of [1,3])test(`undo cannot clear unconfirmed box-layout warnings after rotation: ${turns}`,async t=>{
 const h=photoHarness(t,4,turns);
 h.setDetection({rows:6,cols:6,corners:h.corners,confidence:.99});
 await h.$('detect-photo').onclick();
 assert.deepEqual([h.state.layout.boxRows,h.state.layout.boxCols],[2,3]);
 const puzzle=makePuzzle('sudoku',6); puzzle.boxRows=3;puzzle.boxCols=2;
 puzzle.cells=Array.from({length:36},(_,cell)=>{const row=Math.floor(cell/6);return (Math.floor(row/3)+(row%3)*2+cell%6)%6+1;});
 const found={puzzle,turns,notes:[],cellUncertain:[],uncertain:[],cageUncertain:[],needsReview:false,rectified:canvas()};
 h.setReader(async()=>structuredClone({...found,rectified:null}));
 h.$('read-photo').onclick();await tick();
 assert.deepEqual(h.errors,[]);assert.equal(h.state.needsReview,true);
 assert.match(h.state.notes.join(' '),/Box layout 3 rows × 2 columns was suggested/);
 const rotated=structuredClone(h.state.corners);
 h.undo();
 h.setReader(async(_image,quad)=>({...structuredClone({...found,rectified:null}),
  turns:JSON.stringify(quad)===JSON.stringify(rotated)?0:turns}));
 h.$('read-photo').onclick();await tick();assert.deepEqual(h.errors,[]);
 assert.equal(h.state.needsReview,true,'suggested boxes were never confirmed and must still be reviewed');
 assert.equal(restoreSession(h.storage).needsReview,true);
 assert.match(restoreSession(h.storage).notes.join(' '),/was suggested/);
});

const readPhoto=async h=>{h.$('read-photo').onclick();await tick();assert.deepEqual(h.errors,[]);};
const copyReading=(h,turns=0)=>({...h.found,puzzle:structuredClone(h.expected),turns});
const keyMove=h=>h.$('crop-canvas').onkeydown({key:'ArrowRight',preventDefault(){}});

test('ordinary edits and staging leave the photo undo record untouched',async t=>{
 const h=photoHarness(t,6,1);await readPhoto(h);
 const rotated=structuredClone(h.state.corners),snapshot=h.state.history.at(-1);
 const draft=prepareEdit(h.state,d=>{d.notes.push('staged');});
 assert.deepEqual(h.state.corners,rotated);assert.equal(draft.photo,undefined);assert.equal(draft.corners,undefined);
 assert.throws(()=>prepareEdit(h.state,()=>{throw Error('rejected');}),/rejected/);
 // Even restoring a history snapshot onto another object must not run its
 // owner's photo effect or consume it. This is not the app's Undo action.
 restoreEdit({},snapshot);assert.deepEqual(h.state.corners,rotated);
 rememberEdit(h.state);h.state.notes.push('ordinary edit');
 h.undo();assert.deepEqual(h.state.corners,rotated);assert.equal(h.state.notes.includes('ordinary edit'),false);
 h.undo();assert.deepEqual(h.state.corners,h.corners);
});

test('successive photo reads undo in order, including a read with no rotation',async t=>{
 const h=photoHarness(t,6,1);await readPhoto(h);
 const rotated=structuredClone(h.state.corners);
 h.setReader(async()=>copyReading(h));await readPhoto(h);
 assert.equal(h.state.history.length,2);
 h.undo();assert.deepEqual(h.state.corners,rotated);
 assert.deepEqual([h.state.layout.boxRows,h.state.layout.boxCols],[2,3]);
 h.undo();assert.deepEqual(h.state.corners,h.corners);
 assert.deepEqual([h.state.layout.boxRows,h.state.layout.boxCols],[3,2]);
});

for(const change of ['keyboard','pointer','detect'])test(`${change} crop changes after Read are not overwritten by an older undo`,async t=>{
 const h=photoHarness(t,6,1);await readPhoto(h);
 if(change==='keyboard')keyMove(h);
 if(change==='pointer'){
  const c=h.$('crop-canvas');c.getBoundingClientRect=()=>({left:0,top:0,width:600,height:600});c.setPointerCapture=()=>{};
  c.onpointerdown({clientX:599,clientY:0,pointerId:1,preventDefault(){}});
  c.onpointermove({clientX:590,clientY:10});c.onpointerup();
 }
 if(change==='detect'){
  h.setDetection({rows:6,cols:6,confidence:.99,corners:h.state.corners.map(p=>({x:p.x*.9+5,y:p.y*.9+5}))});
  await h.$('detect-photo').onclick();
 }
 const corners=structuredClone(h.state.corners),layout=structuredClone(h.state.layout);
 h.undo();assert.deepEqual(h.state.corners,corners);assert.deepEqual(h.state.layout,layout);
 assert.equal(h.state.rectified,null);assert.equal(h.state.photoSource,null);
 h.setReader(async()=>({...copyReading(h),needsReview:false,cellUncertain:[],uncertain:[]}));await readPhoto(h);
 // The newer crop was confirmed by a corner move or a confident detection.
 assert.equal(h.state.needsReview,false);assert.equal(h.state.uncertain.size,0);
 assert.doesNotMatch(h.state.notes.join(' '),/corners were not adjusted/);
});

test('a newer photograph keeps its crop and controls, never receives an old photo undo',async t=>{
 const h=photoHarness(t,6,1);await readPhoto(h);
 // Model a photo replacement while the old board history is retained, as
 // with a live capture. The owner check is independent of history clearing.
 const photo=canvas(700,700),corners=[{x:5,y:5},{x:690,y:5},{x:690,y:690},{x:5,y:690}];
 h.state.photo=photo;h.state.corners=corners;
 h.setLayout({rows:6,cols:6,boxRows:1,boxCols:6});
 h.undo();assert.equal(h.state.photo,photo);assert.equal(h.state.corners,corners);
 assert.deepEqual([h.state.layout.boxRows,h.state.layout.boxCols],[1,6]);
 h.setReader(async()=>({...copyReading(h),needsReview:false,cellUncertain:[],uncertain:[]}));await readPhoto(h);
 assert.equal(h.state.needsReview,true);assert.equal(h.state.uncertain.size,36);
});

test('Undo after the photograph is discarded does not bring back a photo or crop',async t=>{
 const h=photoHarness(t,6,3);await readPhoto(h);
 h.state.photo=null;h.state.corners=null;h.undo();
 assert.equal(h.state.photo,null);assert.equal(h.state.corners,null);
 assert.equal(h.state.rectified,null);assert.equal(h.state.photoSource,null);
});

test('manual Rotate replaces the photo and clears old read undo records',async t=>{
 const h=photoHarness(t,6,1);await readPhoto(h);
 h.$('rotate-photo').onclick();await tick();
 assert.equal(h.state.history.length,0);
 const photo=h.state.photo,corners=structuredClone(h.state.corners);h.undo();
 assert.equal(h.state.photo,photo);assert.deepEqual(h.state.corners,corners);
});

test('a failed re-detection leaves the accepted photo undo valid',async t=>{
 const h=photoHarness(t,6,3);await readPhoto(h);
 h.setDetection(null);await h.$('detect-photo').onclick();assert.equal(h.errors.length,1);
 h.undo();assert.deepEqual(h.state.corners,h.corners);
 assert.deepEqual([h.state.layout.boxRows,h.state.layout.boxCols],[3,2]);
});

test('Undo cancels an in-flight read, and its late result cannot rotate the crop again',async t=>{
 const h=photoHarness(t,6,1);await readPhoto(h);
 let resolve;h.setReader(()=>new Promise(yes=>{resolve=yes;}));
 h.$('read-photo').onclick();await tick();assert.equal(typeof resolve,'function');
 h.undo();const puzzle=h.state.puzzle;
 resolve(copyReading(h,3));await tick();
 assert.equal(h.state.puzzle,puzzle);assert.deepEqual(h.state.corners,h.corners);
 assert.equal(h.state.history.length,0);assert.deepEqual(h.errors,[]);
});

test('an unconfirmed crop remains unconfirmed after read and undo',async t=>{
 const h=photoHarness(t,6,1);
 h.setDetection({rows:6,cols:6,corners:structuredClone(h.corners),confidence:.4});
 await h.$('detect-photo').onclick();await readPhoto(h);
 assert.equal(h.state.uncertain.size,36);
 h.undo();h.setReader(async()=>({...copyReading(h,1),needsReview:false}));await readPhoto(h);
 assert.equal(h.state.needsReview,true);assert.equal(h.state.uncertain.size,36);
 assert.match(h.state.notes.join(' '),/corners were not adjusted/);
});

// A confident 6 x 7 lattice read at 6 x 6 through its own corners: the crop
// stays unconfirmed for that size after an Undo, by the crop's own record or
// by a later detection's.
const resized=/The grid was found with 6 × 7 cells and read as 6 × 6 through the same corners/;
const readAs6=async h=>{h.setLayout({rows:6,cols:6,boxRows:3,boxCols:2});await readPhoto(h);};
for(const turns of [0,1,3])test(`a Read at another size stays reviewed after its Undo: ${turns}`,async t=>{
 const h=photoHarness(t,6,turns);
 h.setDetection({rows:6,cols:7,corners:structuredClone(h.corners),confidence:.99});
 await h.$('detect-photo').onclick();await readAs6(h);
 assert.equal(h.state.uncertain.size,36);assert.match(h.state.notes.join(' '),resized);
 h.undo();assert.deepEqual(h.state.corners,h.corners);
 h.setReader(async()=>({...copyReading(h,turns),needsReview:false}));await readAs6(h);
 assert.equal(h.state.uncertain.size,36);assert.match(h.state.notes.join(' '),resized);
});
test('a Read at another size stays reviewed when its Undo meets a later detection of the crop',async t=>{
 const h=photoHarness(t,6,0);
 h.setDetection({rows:6,cols:7,corners:structuredClone(h.corners),confidence:.99});
 await h.$('detect-photo').onclick();await readAs6(h);
 h.setDetection({rows:6,cols:7,confidence:.99,corners:h.corners.map(p=>({x:p.x*.9+5,y:p.y*.9+5}))});
 await h.$('detect-photo').onclick();h.setLayout({rows:6,cols:6,boxRows:3,boxCols:2});
 h.undo();
 h.setReader(async()=>({...copyReading(h),needsReview:false}));await readAs6(h);
 assert.equal(h.state.uncertain.size,36);assert.match(h.state.notes.join(' '),resized);
});

test('undo snapshots remain data-only and do not retain a canvas',async t=>{
 const h=photoHarness(t,6,1);await readPhoto(h);
 const snapshot=h.state.history.at(-1),copy=structuredClone(snapshot);
 assert.deepEqual(copy,snapshot);
 assert.equal(Object.hasOwn(snapshot,'photo'),false);
 assert.equal(Object.hasOwn(snapshot,'corners'),false);
 assert.doesNotThrow(()=>JSON.stringify(snapshot));
 h.undo();assert.deepEqual(h.state.corners,h.corners);
});
