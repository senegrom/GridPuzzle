import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanDiagnostics } from '../scan-diagnostics.js';
import { diagnosticImage } from '../diagnostics-ui.js';
import { makePuzzle } from '../model.js';
test('diagnostics export an allowlist, not arbitrary input, photos, notes, answers or stacks',()=>{
 let time=0;const d=createScanDiagnostics({now:()=>time,build:'test-build'});d.begin('photo',{type:'sudoku',rows:9,cols:9,file:'PRIVATE'});
 const puzzle=makePuzzle('sudoku',4);puzzle.cells[0]=1;
 d.event({stage:'reading',reason:'full-read',filename:'PRIVATE',image:'PRIVATE',stack:'PRIVATE',message:'PRIVATE'});
 time=50;d.event({stage:'checking',reason:'read-complete',found:{puzzle,cellUncertain:[0],markedCells:[0],notes:['PRIVATE'],rectified:'PRIVATE',play:['PRIVATE'],result:'PRIVATE'}});
 const report=d.snapshot(),text=JSON.stringify(report);assert.doesNotMatch(text,/PRIVATE/);assert.equal(report.privacy.includesImage,false);
 assert.equal(report.lastReading.cells[0],1);assert.equal(report.stageMilliseconds.reading,50);assert.equal(report.counters.fullReads,1);
 puzzle.cells[0]=4;assert.equal(d.snapshot().lastReading.cells[0],1,'no caller-owned mutable reference is retained');
});
test('diagnostic event history is bounded and snapshots are independent',()=>{
 const d=createScanDiagnostics();d.begin('live',{});
 for(let i=0;i<300;i++)d.event({stage:i%2?'reading':'checking',reason:'started',targets:[1,2]});
 const r=d.snapshot();assert.equal(r.events.length,64);r.events[0].targets[0]=99;assert.equal(d.snapshot().events[0].targets[0],1);
 d.begin('photo',{});assert.equal(d.snapshot().events.length,0);assert.equal(d.snapshot().lastReading,null);
});
test('unknown diagnostic stages, reasons and extra tracking data cannot leak into reports',()=>{
 const d=createScanDiagnostics();d.event({stage:'PRIVATE',reason:'PRIVATE'});d.tracking({submitted:2,image:'PRIVATE'},{frame:3,age:10,matched:false});
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);assert.equal(d.snapshot().tracking.verified,false);
});
test('an explicitly requested image is resized and encoded without source metadata',()=>{
 let encoded=0,canvas;
 const doc={createElement(){return canvas={getContext:()=>({drawImage(){}}),toDataURL(type){encoded++;assert.equal(type,'image/jpeg');return 'data:image/jpeg;base64,AAAA';}};}};
 assert.equal(encoded,0);const value=diagnosticImage({width:4000,height:3000,filename:'PRIVATE',exif:'PRIVATE'},doc);
 assert.equal(encoded,1);assert.equal(value.width,1600);assert.equal(value.height,1200);assert.doesNotMatch(JSON.stringify(value),/PRIVATE/);
 assert.equal(canvas.width,0);assert.equal(canvas.height,0);
});
test('unavailable or failed image export releases its canvas and never supplies bogus pixels',()=>{
 assert.equal(diagnosticImage(null,{}),null);
 let canvas;const doc={createElement(){return canvas={getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:,'};}};
 assert.throws(()=>diagnosticImage({width:10,height:10},doc));assert.equal(canvas.width,0);
});
test('background detections cannot replace the foreground OCR stage or stale settings',()=>{
 const d=createScanDiagnostics();d.begin('live',{type:'auto',rows:9});d.event({stage:'reading',reason:'full-read'});
 d.event({stage:'detecting',reason:'found',background:true});assert.equal(d.snapshot().stage,'reading');
 assert.equal(d.snapshot().events.at(-1).stage,'detecting');assert.equal(d.snapshot().events.at(-1).background,true);
 d.configure({type:'sudoku',rows:4,cols:4});assert.equal(d.snapshot().settings.rows,4);assert.equal(d.snapshot().lastReading,null);
});

test('diagnostic geometry declares its pixel coordinate space and bounds metadata',()=>{
 const d=createScanDiagnostics();d.begin('photo',{});
 d.geometry({rows:9,cols:9,width:600,height:800,coordinateSpace:'source-preview',corners:[{x:1,y:2},{x:599,y:2},{x:599,y:799},{x:1,y:799}],filename:'PRIVATE'});
 const g=d.snapshot().geometry;assert.equal(g.width,600);assert.equal(g.height,800);assert.equal(g.coordinateSpace,'source-preview');
 assert.deepEqual(g.corners[2],{x:599,y:799});assert.doesNotMatch(JSON.stringify(g),/PRIVATE/);
 d.geometry({width:NaN,height:Infinity,coordinateSpace:'PRIVATE'});
 assert.equal(d.snapshot().geometry.coordinateSpace,null);assert.equal(d.snapshot().geometry.width,null);
});
