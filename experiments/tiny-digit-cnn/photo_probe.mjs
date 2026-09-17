// Offline production warp/prepareScan, with an independent CNN. No solver use.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createModel,normalizeGray} from './infer.mjs';
const site=path.resolve(process.argv[2]||'../site');
const {warp}=await import(pathToFileURL(path.join(site,'geometry.js')));
const {prepareScan}=await import(pathToFileURL(path.join(site,'scan-analysis.js')));
const modelPath=new URL('./artifacts/',import.meta.url);
const meta=JSON.parse(fs.readFileSync(new URL('model.json',modelPath)));
const buf=fs.readFileSync(new URL('weights.f32',modelPath));
const model=createModel(meta,buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
function crop(entry,g,w,h) {
 // Same bounds as production grayCrop, but no DOM/canvas is needed for pixels.
 const cw=w/9,ch=h/9,pad=Math.max(2,Math.round(Math.min(cw,ch)*.05));
 const row=Math.floor(entry.cell/9),col=entry.cell%9;
 const minX=Math.max(0,Math.round((col+.08)*cw)),maxX=Math.min(w,Math.round((col+.92)*cw));
 const minY=Math.max(0,Math.round((row+.08)*ch)),maxY=Math.min(h,Math.round((row+.92)*ch));
 const x=Math.max(minX,entry.x-pad),y=Math.max(minY,entry.y-pad);
 const width=Math.max(1,Math.min(maxX,entry.x+entry.w+pad)-x),height=Math.max(1,Math.min(maxY,entry.y+entry.h+pad)-y);
 const pixels=new Uint8Array(width*height);
 for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
   const value=g[(y+yy)*w+x+xx];pixels[yy*width+xx]=entry.invert?255-value:value;
 }
 return normalizeGray(pixels,width,height);
}
const scans=[];
for(const spec of JSON.parse(fs.readFileSync(new URL('photos/cases.json',modelPath)))) {
 const data=new Uint8ClampedArray(fs.readFileSync(new URL(`photos/${spec.file}`,modelPath)));
 const w=spec.width,h=spec.height;
 const image=warp({width:w,height:h,data},[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}],900,900);
 const prepared=prepareScan(image,spec.type,9,9),predictions=[];
 const start=performance.now();
 for(const entry of prepared.entries.filter(e=>['value','blackvalue'].includes(e.kind))) {
   // This initial model is a SINGLE-digit classifier. Mark multi-glyph evidence
   // unsupported rather than secretly coercing a number into one digit.
   const input=crop(entry,prepared.g,900,900),read=model.predict(input);
   const supported=!(entry.glyphCount>1);
   predictions.push({cell:entry.cell,text:supported&&read.digit!==null?String(read.digit):'',supported,
     glyphCount:entry.glyphCount||1,recoveredMark:!!entry.recoveredMark,...read});
 }
 const predicted=new Map(predictions.map(p=>[p.cell,p]));
 const clues=spec.expected.flatMap((v,cell)=>Number.isInteger(v)?[{cell,value:v}]:[]);
 const wrong=clues.filter(({cell,value})=>predicted.get(cell)?.text!==String(value)).map(({cell,value})=>({cell,expected:value,prediction:predicted.get(cell)||null}));
 const hallucinations=predictions.filter(p=>!Number.isInteger(spec.expected[p.cell])&&p.text!=='');
 const result={name:spec.name,variation:spec.variation,source_sha256:spec.source_sha256,
   printed:clues.length,correct:clues.length-wrong.length,wrong,hallucinations,cnnMs:performance.now()-start,predictions};
 scans.push(result);console.log(spec.name,spec.variation,result.correct+'/'+result.printed,'invented',hallucinations.length);
}
const report={mode:'offline crop classification, NOT an end-to-end browser A/B',
 baseline_commit:JSON.parse(fs.readFileSync(path.join(site,'build-info.json'))).commit,
 model_sha256:meta.weights_sha256,scans};
fs.writeFileSync(new URL('photo-shadow.json',modelPath),JSON.stringify(report,null,2)+'\n');
