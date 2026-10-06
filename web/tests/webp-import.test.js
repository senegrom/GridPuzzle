import test from 'node:test';
import assert from 'node:assert/strict';
import { importPhoto } from '../photo-import.js';
import { photoDetail, rotatePhotoSource, detailPlan, turnPoint } from '../photo-detail.js';
import { validQuad } from '../geometry.js';

// Synthetic container/decoder boundaries here; real WebP pixels are exercised
// in the permanent Chromium/WebKit photo transaction gate as well.
function fixture(value, little=false, prefix=false) {
  const meta=Buffer.alloc(26), u16=(v,p)=>little?meta.writeUInt16LE(v,p):meta.writeUInt16BE(v,p),
    u32=(v,p)=>little?meta.writeUInt32LE(v,p):meta.writeUInt32BE(v,p);
  meta.write(little?'II':'MM');u16(42,2);u32(8,4);u16(1,8);u16(0x112,10);u16(3,12);u32(1,14);u16(value,18);
  const chunk=(kind,data)=>{const h=Buffer.alloc(8);h.write(kind);h.writeUInt32LE(data.length,4);return Buffer.concat([h,data,Buffer.alloc(data.length%2)]);};
  const x=Buffer.alloc(10);x[0]=8;x.writeUIntLE(3199,4,3);x.writeUIntLE(799,7,3);
  const leading=Buffer.concat([chunk('VP8X',x),chunk('VP8L',Buffer.alloc(10))]);
  const metadata=Buffer.concat([prefix?Buffer.from('Exif\0\0'):Buffer.alloc(0),meta]);
  const parts=Buffer.concat([leading,chunk('EXIF',metadata)]),head=Buffer.from('RIFF\0\0\0\0WEBP');head.writeUInt32LE(parts.length+4,4);
  const bytes=Buffer.concat([head,parts]);
  return {file:new Blob([bytes],{type:'image/webp'}),bytes,little,tag:12+leading.length+8+(prefix?6:0)+18};
}
const quad=(w,h)=>[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function expected(x,y,w,h,orientation) {
  return [[x,y],[w-x,y],[w-x,h-y],[x,h-y],[y,x],[h-y,x],[h-y,w-x],[y,w-x]][orientation-1];
}
function harness(t,{fallback=false,failBitmap=false}={}) {
  const calls=[],canvases=[],urls=new Map(),bitmaps=[];
  for(const key of ['document','Image','createImageBitmap']) {
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);
  }
  const decode=async(file,options={})=>{const bytes=Buffer.from(await file.arrayBuffer());calls.push({file,options,bytes});};
  globalThis.createImageBitmap=fallback?undefined:async(file,options)=>{
    await decode(file,options);if(failBitmap)throw Error('no bitmap backend');
    const bitmap={width:options.resizeWidth??3200,height:options.resizeHeight??800,close(){this.closed=true;}};
    bitmaps.push(bitmap);return bitmap;
  };
  globalThis.Image=class{naturalWidth=3200;naturalHeight=800;async decode(){await decode(urls.get(this.src));}};
  t.mock.method(URL,'createObjectURL',file=>{const key=`blob:${urls.size}`;urls.set(key,file);return key;});
  t.mock.method(URL,'revokeObjectURL',key=>urls.delete(key));
  globalThis.document={createElement(){
    const c={width:0,height:0,draws:[]};canvases.push(c);let m=[1,0,0,1,0,0];
    const multiply=(a,b,d,e,x,y)=>{const[A,B,C,D,E,F]=m;m=[A*a+C*b,B*a+D*b,A*d+C*e,B*d+D*e,A*x+C*y+E,B*x+D*y+F];};
    const context={fillRect(){},translate(x,y){multiply(1,0,0,1,x,y);},scale(x,y){multiply(x,0,0,y,0,0);},
      rotate(a){multiply(Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0);},
      drawImage(source,...args){c.draws.push({source,args,m:[...m]});}};
    c.getContext=()=>context;return c;
  }};
  return {calls,canvases,bitmaps,urls};
}
function assertTransform(canvas,w,h,value,userTurns=0) {
  const {m}=canvas.draws.at(-1),x=w*.23,y=h*.37;
  let [ex,ey]=expected(x,y,w,h,value),ow=value>=5?h:w,oh=value>=5?w:h;
  for(let i=0;i<userTurns;i++){[ex,ey]=[oh-ey,ex];[ow,oh]=[oh,ow];}
  assert.deepEqual([canvas.width,canvas.height],[ow,oh]);
  close(m[0]*x+m[2]*y+m[4],ex);close(m[1]*x+m[3]*y+m[5],ey);
}
for(let value=1;value<=8;value++)test(`WebP EXIF ${value}: raw bounded decode, one transform, retained detail and user rotations`,async t=>{
  const h=harness(t);
  for(const little of [false,true])for(const prefix of [false,true]) {
    const f=fixture(value,little,prefix),{image}=await importPhoto(f.file),first=h.calls.at(-1);
    assert.deepEqual([first.options.resizeWidth,first.options.resizeHeight],[1600,400]);
    const normalized=Buffer.from(f.bytes);little?normalized.writeUInt16LE(1,f.tag):normalized.writeUInt16BE(1,f.tag);
    assert.deepEqual(first.bytes,normalized,'only orientation changes; pixels, chunk lengths and other metadata are retained');
    assert.deepEqual(Buffer.from(await f.file.arrayBuffer()),f.bytes,'original input is never modified');
    assertTransform(image,1600,400,value);assert.equal(h.bitmaps.at(-1).closed,true);
    let preview=image;
    for(let userTurns=0;userTurns<4;userTurns++) {
      const result=await photoDetail(preview,quad(preview.width,preview.height));
      assert.equal(result.enhanced,true);assertTransform(result.image,1800,450,value,userTurns);
      assert.ok(validQuad(result.corners,result.image.width,result.image.height));
      assert.equal(h.calls.at(-1).file,first.file,'detail decodes the same normalized encoded source');
      assert.deepEqual(h.calls.at(-1).bytes,normalized);assert.equal(h.bitmaps.at(-1).closed,true);
      result.release();assert.equal(result.image.width,0);assert.equal(result.image.height,0);
      const next={width:preview.height,height:preview.width};rotatePhotoSource(preview,next);preview=next;
    }
  }
});
for(const failBitmap of [false,true])test(`WebP fallback applies orientation once and releases URL; bitmap rejection ${failBitmap}`,async t=>{
  const h=harness(t,{fallback:!failBitmap,failBitmap});
  for(let value=1;value<=8;value++) {
    const f=fixture(value),{image}=await importPhoto(f.file);
    assertTransform(image,1600,400,value);assert.equal(h.urls.size,0);
    assert.equal(h.calls.at(-1).bytes.readUInt16BE(f.tag),1);
  }
});
for(const atDetail of [false,true])test(`late normalized decode is cancelled and closed; detail ${atDetail}`,async t=>{
  const h=harness(t);let current=true;const decoder=globalThis.createImageBitmap;
  const {image}=await importPhoto(fixture(7).file);
  globalThis.createImageBitmap=async(...args)=>{const bitmap=await decoder(...args);current=false;return bitmap;};
  const work=atDetail?photoDetail(image,quad(image.width,image.height),{current:()=>current}):importPhoto(fixture(7).file,{current:()=>current});
  const count=h.canvases.length;await assert.rejects(work,e=>e.name==='AbortError');
  assert.equal(h.bitmaps.at(-1).closed,true);assert.equal(h.canvases.length,count,'cancelled result creates no late preview');
});
for(const mirrored of [false,true])test(`asymmetric original-detail crop inverts its source transform; mirrored ${mirrored}`,()=>{
  const w=1600,h=400,raw=[{x:80,y:45},{x:1200,y:60},{x:1100,y:320},{x:100,y:300}];
  for(let turns=0;turns<4;turns++) {
    const points=raw.map(p=>turnPoint({x:mirrored?w-1-p.x:p.x,y:p.y},w,h,turns));
    const corners=mirrored?[points[0],points[3],points[2],points[1]]:points;
    const preview={width:turns%2?h:w,height:turns%2?w:h};
    const plan=detailPlan(preview,corners,3200,800,turns,mirrored);
    assert.ok(plan);assert.ok(validQuad(plan.corners,plan.width,plan.height));
    assert.equal(plan.x,Math.floor(80*3199/1599)-2);assert.equal(plan.y,Math.floor(45*799/399)-2);
    assert.equal(plan.w,Math.ceil(1200*3199/1599)+3-plan.x);
    assert.equal(plan.h,Math.ceil(320*799/399)+3-plan.y);
  }
});
// Where the detail corners land, checked against the recorded canvas transforms
// rather than the production corner math: each corner must show the same raw
// photo point in the detail as in the preview, for every orientation (the
// mirrored 2, 4, 5 and 7 included) and user turn. Pixel centres sit at +0.5.
const RAW=[{x:400,y:100},{x:2800,y:150},{x:2600,y:700},{x:500,y:650}];
const apply=(m,{x,y})=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const pixel=(m,x,y)=>{const p=apply(m,{x:x+.5,y:y+.5});return {x:p.x-.5,y:p.y-.5};};
const area=q=>q.reduce((s,a,i)=>{const b=q[(i+1)%4];return s+a.x*b.y-b.x*a.y;},0);
for(let value=1;value<=8;value++)test(`WebP EXIF ${value}: detail corners show the preview corners' raw points after 0-3 user turns`,async t=>{
  harness(t);
  const {image}=await importPhoto(fixture(value).file),imported=image.draws.at(-1),[,,bw,bh]=imported.args;
  const shown=RAW.map(r=>pixel(imported.m,(r.x+.5)*bw/3200-.5,(r.y+.5)*bh/800-.5));
  let preview=image;
  for(let turns=0;turns<4;turns++) {
    const points=shown.map(p=>turnPoint(p,image.width,image.height,turns));
    // Keep the quad clockwise, remembering which raw point each corner shows.
    const order=area(points)<0?[0,3,2,1]:[0,1,2,3],result=await photoDetail(preview,order.map(i=>points[i]));
    assert.equal(result.enhanced,true);
    const {args:[sx,sy,sw,sh,,,dw,dh],m}=result.image.draws.at(-1);
    order.forEach((i,k)=>{
      const want=pixel(m,(RAW[i].x+.5-sx)*dw/sw-.5,(RAW[i].y+.5-sy)*dh/sh-.5),got=result.corners[k];
      assert.ok(Math.hypot(got.x-want.x,got.y-want.y)<1,`turns ${turns}, corner ${k}: detail (${got.x.toFixed(1)}, ${got.y.toFixed(1)}) but its raw point is at (${want.x.toFixed(1)}, ${want.y.toFixed(1)})`);
    });
    result.release();
    const next={width:preview.height,height:preview.width};rotatePhotoSource(preview,next);preview=next;
  }
});
