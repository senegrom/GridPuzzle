import test from 'node:test';
import assert from 'node:assert/strict';
import { Scanner, cageLabelCrop } from '../scanner.js';
function canvases(t) {
 const made=[];
 class Canvas {
  constructor(){this.width=0;this.height=0;this.puts=[];this.draws=[];this.allocations=[];made.push(this);}
  getContext(){const c=this;return {
   fillRect(){},translate(){},rotate(){},
   putImageData(image){c.puts.push(image.data);},
   createImageData(w,h){c.allocations.push(w*h*4);return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
   getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){data.set([i%7?240:30,i%7?240:30,i%7?240:30,255],4*i);}return {width:w,height:h,data};},
   drawImage(source,...args){c.draws.push({source,args});}
  };}
  toDataURL(){return 'data:image/png;base64,AQID';}
  toBlob(callback){callback(new Blob(['png']));}
 }
 for(const key of ['document','ImageData']){const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);}
 globalThis.document={createElement:()=>new Canvas()};
 globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
 return {made,Canvas};
}
for(const [type,n,targeted,kind]of [['sudoku',9,false,'value'],['sudoku',9,true,'value'],['sudoku',25,false,'value'],
 ['str8ts',9,false,'blackvalue'],['killersudoku',9,false,'cage'],['kenken',9,false,'cage'],['kakuro',9,false,'inverted']])
 test(`${type}/${n}/targeted ${targeted}: independent crops allocate no whole-grid scratch mask`,async t=>{
  await run(t,{type,n,targeted,kind,structural:false});
 });
for(const mixed of [false,true])test(`structural crops share one exact opaque mask with one allocation/write, mixed ${mixed}`,async t=>{
 await run(t,{type:'futoshiki',n:9,kind:'sign',structural:true,mixed});
});
async function run(t,{type,n,targeted,kind,structural,mixed}){
 const {made,Canvas}=canvases(t),w=Math.min(1500,n*100),h=w;
 const image={width:w,height:h,data:new Uint8ClampedArray(w*h*4)},mask=new Uint8Array(w*h),g=new Uint8Array(w*h).fill(240);
 for(let i=0;i<mask.length;i++)mask[i]=i%7===0?1:0;
 const region=(cell)=>({cell,kind:kind==='cage'||kind==='inverted'?'label':kind,x:35+cell*100,y:25,w:25,h:50,
   ...(kind==='blackvalue'||kind==='inverted'?{invert:true}:{}),...(kind==='cage'?{cageLabel:true}:{})});
 const regions=[region(0),region(1)];if(mixed)regions.unshift({...region(2),kind:'value'});
 const scanner=new Scanner();scanner.geometry=async()=>({image,meta:{},mask,g,black:Array(n*n).fill(false),entries:regions,unreadCells:[],cageAreas:[]});
 const boundary=Error('OCR boundary');scanner.ocr={recognize:async()=>{throw boundary;}};
 // The actual production caller must opt out for Killer, not merely expose an
 // unused helper option. Count the per-clue Uint8Array ink/core allocations.
 const NativeBytes=globalThis.Uint8Array, inkSizes=[];
 if(kind==='cage') {
  globalThis.Uint8Array=class extends NativeBytes { constructor(...args){super(...args);inkSizes.push(this.length);} };
  t.after(()=>{globalThis.Uint8Array=NativeBytes;});
 }
 await assert.rejects(scanner.readOnce(new Canvas(),[],type,n,n,()=>{},{},targeted?[0]:null,()=>{}),e=>e===boundary);
 if(kind==='cage') {
  if(type==='kenken') assert.ok(inkSizes.length>=4,'KenKen still analyzes its operator ink');
  else assert.equal(inkSizes.length,0,'Killer allocates no operator analysis arrays');
 }
 const full=made.filter(c=>c.width===w&&c.height===h);
 assert.equal(full.length,structural?2:1,'only the required review photograph plus an optional binary scratch');
 const review=full.find(c=>c.puts[0]===image.data);assert.ok(review,'the original review pixels are retained');
 if(structural){
  const scratch=full.find(c=>c!==review);assert.deepEqual(scratch.allocations,[w*h*4]);assert.equal(scratch.puts.length,1);
  const bytes=scratch.puts[0];for(let i=0;i<mask.length;i++){const v=mask[i]?0:255;
   assert.equal(bytes[i*4],v);assert.equal(bytes[i*4+1],v);assert.equal(bytes[i*4+2],v);assert.equal(bytes[i*4+3],255);
  }
  const reads=made.flatMap(c=>c.draws).filter(d=>d.source===scratch);
  assert.equal(reads.length,2);assert.deepEqual(reads.map(d=>d.args.slice(0,4)),regions.filter(r=>r.kind==='sign').map(r=>[r.x,r.y,r.w,r.h]));
 }else assert.equal(made.flatMap(c=>c.allocations).filter(size=>size===w*h*4).length,0);
}
test('Killer clue crop is byte-identical without allocating operator ink or core arrays',t=>{
 const {Canvas}=canvases(t),rectified=new Canvas(),entry={x:10,y:20,w:45,h:20};
 const full=cageLabelCrop(entry,rectified),sum=cageLabelCrop(entry,rectified,false);
 assert.ok(full.ink instanceof Uint8Array);assert.ok(full.core instanceof Uint8Array);
 assert.equal(sum.ink,null);assert.equal(sum.core,null);
 assert.deepEqual(sum.canvas.puts,full.canvas.puts);
 assert.ok(full.canvas.puts[0].some((v,i)=>i%4!==3&&v===0));
 assert.ok(full.canvas.puts[0].some((v,i)=>i%4!==3&&v===255));
});
