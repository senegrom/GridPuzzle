// Exercise the shared app/benchmark loader. Containers are synthetic here;
// native JPEG decoding and orientation are also checked by the browser gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importPhoto } from '../photo-import.js';
import { hasPhotoSource } from '../photo-detail.js';
import fs from 'node:fs';
const concat = (...parts) => Buffer.concat(parts.map(p => Buffer.from(p)));
function tiff(value, little = false) {
  const b=Buffer.alloc(26);b.writeUInt16BE(little?0x4949:0x4d4d);
  const u16=(v,at)=>little?b.writeUInt16LE(v,at):b.writeUInt16BE(v,at);
  const u32=(v,at)=>little?b.writeUInt32LE(v,at):b.writeUInt32BE(v,at);
  u16(42,2);u32(8,4);u16(1,8);u16(0x112,10);u16(3,12);u32(1,14);u16(value,18);return b;
}
function jpeg(w,h,exif=null) {
 const frame=Buffer.from([255,192,0,11,8,0,0,0,0,1,1,17,0]);frame.writeUInt16BE(h,5);frame.writeUInt16BE(w,7);
 const metadata=exif===null?Buffer.alloc(0):concat([255,225,(exif.length+8)>>8,(exif.length+8)&255],'Exif\0\0',exif);
 return concat([255,216],frame,metadata,[255,217]);
}
function chunk(kind,data,png=false){const b=Buffer.alloc(8);b.write(kind,png?4:0);png?b.writeUInt32BE(data.length):b.writeUInt32LE(data.length,4);return concat(b,data,Buffer.alloc(png?4:data.length%2));}
function png(w,h,exif=null){const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;
 return concat([137,80,78,71,13,10,26,10],chunk('IHDR',head,true),...(exif?[chunk('eXIf',exif,true)]:[]),chunk('IEND',[],true));}
function webp(w,h,exif){const extended=Buffer.alloc(10);extended[0]=8;extended.writeUIntLE(w-1,4,3);extended.writeUIntLE(h-1,7,3);
 const chunks=concat(chunk('VP8X',extended),chunk('VP8 ',Buffer.alloc(700001)),chunk('EXIF',exif));
 const head=Buffer.from('RIFF\0\0\0\0WEBP');head.writeUInt32LE(chunks.length+4,4);return concat(head,chunks);}
// `natural` is the photo as the decoder turns it; a missing resize dimension
// follows its aspect ratio, as the HTML spec says.
function harness(t,{fallback=false,failBitmap=false,natural=[640,480]}={}){
 const calls=[],canvases=[],bitmaps=[],urls=[];
 for(const key of ['document','Image','createImageBitmap']){const d=Object.getOwnPropertyDescriptor(globalThis,key);t.after(()=>d?Object.defineProperty(globalThis,key,d):delete globalThis[key]);}
 const context={fillRect(){this.white=this.fillStyle;},drawImage(){},translate(){},rotate(){},scale(){}};
 globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({...context})};canvases.push(c);return c;}};
 globalThis.createImageBitmap=fallback?undefined:async(file,options)=>{calls.push(options);if(failBitmap)throw Error('decoder failed');
  const [w,h]=natural,{resizeWidth:rw,resizeHeight:rh}=options;
  const bitmap={width:rw??(rh?Math.ceil(w*rh/h):w),height:rh??(rw?Math.ceil(h*rw/w):h),close(){this.closed=true;}};bitmaps.push(bitmap);return bitmap;};
 globalThis.Image=class{naturalWidth=640;naturalHeight=480;width=10;height=10;async decode(){calls.push('full decode');}};
 t.mock.method(URL,'createObjectURL',()=>{urls.push('created');return 'blob:test';});t.mock.method(URL,'revokeObjectURL',()=>urls.push('revoked'));
 return {calls,canvases,bitmaps,urls};
}
for(const little of [false,true])for(const value of [1,2,3,4,5,6,7,8])
 test(`EXIF ${value}, little-endian ${little}: both oriented dimensions bounded before decoding`,async t=>{
  const h=harness(t);
  for(const [w,ht]of [[1600,400],[400,1600],[3200,800],[80,20]]){
   const {image,dimensions}=await importPhoto(new Blob([jpeg(w,ht,tiff(value,little))]));
   const scale=Math.min(1,1600/Math.max(w,ht)),sw=Math.round(w*scale),sh=Math.round(ht*scale),expected=value>=5?[sh,sw]:[sw,sh];
   assert.deepEqual([h.calls.at(-1).resizeWidth,h.calls.at(-1).resizeHeight],expected);
   assert.equal(h.calls.at(-1).imageOrientation,'from-image');assert.deepEqual([image.width,image.height],expected);
   assert.deepEqual(dimensions,{width:w,height:ht});assert.ok(hasPhotoSource(image));assert.ok(h.bitmaps.at(-1).closed);
  }
 });
for(const make of [png,(w,h,meta)=>webp(w,h,meta),(w,h,meta)=>webp(w,h,concat('Exif\0\0',meta))])
 test(`EXIF in ${make===png?'PNG':'WebP'} uses bounded metadata reads, including after a large bitstream`,async t=>{
  // A decoder that applies the PNG eXIf; the WebP is neutralized and turned by the app.
  const h=harness(t,{natural:[400,1600]}),file=new Blob([make(1600,400,tiff(6,true))]),slice=file.slice.bind(file),ranges=[];
  file.slice=(a,b)=>{const part=slice(a,b),read=part.arrayBuffer.bind(part);
    // Blob slices used for the normalized encoded source are not metadata reads.
    part.arrayBuffer=()=>{ranges.push([a,b??file.size]);return read();};return part;};
  const {image}=await importPhoto(file);assert.deepEqual([image.width,image.height],[400,1600]);
  assert.ok(ranges.reduce((n,[a,b])=>n+b-a,0)<530000,'skip rather than read the full bitstream');
  assert.equal(h.calls.length,1);
 });
test('an orientation value the engines ignore imports as stored',async t=>{
 const h=harness(t),meta=tiff(6);meta.writeUInt16BE(9,18);
 const {image}=await importPhoto(new Blob([jpeg(1600,400,meta)]));
 assert.equal(h.calls.length,1);assert.deepEqual([h.calls[0].resizeWidth,h.calls[0].resizeHeight],[1600,400]);
 assert.deepEqual([image.width,image.height],[1600,400]);
});
// Safari's ImageIO reading of an entry that is not a SHORT with count 1 is
// unverified: one width that fits 1600 either way round.
for(const kind of ['type','count'])test(`an orientation entry of another ${kind} imports through one width that fits either way round`,async t=>{
 const h=harness(t,{natural:[3200,800]}),meta=tiff(6);
 if(kind==='type')meta.writeUInt16BE(4,12);if(kind==='count')meta.writeUInt32BE(2,14);
 const {image}=await importPhoto(new Blob([jpeg(3200,800,meta)]));
 assert.deepEqual(h.calls.map(c=>[c.resizeWidth,c.resizeHeight]),[[400,undefined]]);
 assert.deepEqual([image.width,image.height],[400,100]);
});
// The decoders show damaged EXIF as stored or as they read it: one width that
// fits 1600 either way round, never a squeezed pair of dimensions.
for(const kind of ['offset','truncated'])test(`malformed EXIF ${kind} imports as stored through one width that fits either way round`,async t=>{
 const h=harness(t,{natural:[4000,3000]}),meta=tiff(6);
 if(kind==='offset')meta.writeUInt32BE(0xfffffff0,4);
 const {image}=await importPhoto(new Blob([jpeg(4000,3000,kind==='truncated'?meta.subarray(0,17):meta)]));
 assert.deepEqual(h.calls.map(c=>[c.resizeWidth,c.resizeHeight]),[[1200,undefined]]);
 assert.deepEqual([image.width,image.height],[1200,900]);assert.ok(h.bitmaps.at(-1).closed);
});
for(const failBitmap of [false,true])test(`shared fallback keeps the 24MP limit, bitmap rejection ${failBitmap}`,async t=>{
 const h=harness(t,{fallback:!failBitmap,failBitmap});
 await assert.rejects(importPhoto(new Blob([png(5000,5000)])),/cannot downscale/);assert.ok(!h.calls.includes('full decode'));
 const {image}=await importPhoto(new Blob([png(640,480)]));assert.deepEqual([image.width,image.height],[640,480]);
 assert.equal(h.calls.filter(v=>v==='full decode').length,1);assert.deepEqual(h.urls,['created','revoked']);
});
test('oversize, unknown and cancelled files cannot start a decoder',async t=>{
 const h=harness(t);
 for(const [file,pattern]of [[new Blob([Buffer.alloc(30*1024*1024+1)]),/30 MB/],[new Blob([png(12001,10000)]),/too large/],[new Blob(['unknown']),/dimensions/]])
  await assert.rejects(importPhoto(file),pattern);
 let current=true;const file=new Blob([png(640,480)]),slice=file.slice.bind(file);
 file.slice=(...args)=>{current=false;return slice(...args);};
 await assert.rejects(importPhoto(file,{current:()=>current}),e=>e.name==='AbortError');assert.deepEqual(h.calls,[]);
});
test('app and benchmark have one decoder and one set of import limits',()=>{
 const app=fs.readFileSync(new URL('../photo-flow.js',import.meta.url),'utf8'),bench=fs.readFileSync(new URL('../../corpus/benchmark-runner.cjs',import.meta.url),'utf8');
 assert.match(app,/await importPhoto\(file, \{ current:/);assert.match(bench,/await importPhoto\(file, \{ maxSide \}\)/);
 // Detail is separate, but initial import logic must not drift back into either consumer.
 for(const code of [app,bench])assert.doesNotMatch(code,/new Image\(|createImageBitmap\(|sniffDimensions\(/);
});
