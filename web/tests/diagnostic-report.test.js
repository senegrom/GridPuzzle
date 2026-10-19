import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanDiagnostics, REASON_LABELS } from '../scan-diagnostics.js';
import { TRANSPORT_REASONS } from '../live-tracker.js';
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
test('a reading the scanner turned itself reports its turns, and nothing else does',()=>{
 const d=createScanDiagnostics();d.begin('photo',{type:'sudoku',rows:4,cols:4});
 const reported=turns=>{d.event({stage:'checking',reason:'read-complete',found:{puzzle:makePuzzle('sudoku',4),turns}});return d.snapshot().lastReading.turns;};
 for(const turns of [1,2,3])assert.equal(reported(turns),turns);
 for(const turns of [undefined,0,4,-1,1.5,'2','PRIVATE',null])assert.equal(reported(turns),0,String(turns));
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
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

// The live camera's settings: automatic solving and the freeze's wait for
// clearer clues are recorded as booleans, and only as booleans.
test('the settings record automatic solving and the freeze wait, as booleans only',()=>{
 const d=createScanDiagnostics();d.begin('live',{type:'sudoku',rows:9,cols:9,autoSolve:true,freezeWait:true});
 assert.equal(d.snapshot().settings.autoSolve,true);assert.equal(d.snapshot().settings.freezeWait,true);
 d.configure({type:'sudoku',rows:9,cols:9,autoSolve:true,freezeWait:false});assert.equal(d.snapshot().settings.freezeWait,false);
 d.begin('live',{freezeWait:'PRIVATE'});assert.equal(Object.hasOwn(d.snapshot().settings,'freezeWait'),false);
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
});

test('diagnostic geometry declares its pixel coordinate space and bounds metadata',()=>{
 const d=createScanDiagnostics();d.begin('photo',{});
 d.geometry({rows:9,cols:9,width:600,height:800,coordinateSpace:'source-preview',corners:[{x:1,y:2},{x:599,y:2},{x:599,y:799},{x:1,y:799}],filename:'PRIVATE'});
 const g=d.snapshot().geometry;assert.equal(g.width,600);assert.equal(g.height,800);assert.equal(g.coordinateSpace,'source-preview');
 assert.deepEqual(g.corners[2],{x:599,y:799});assert.doesNotMatch(JSON.stringify(g),/PRIVATE/);
 d.geometry({width:NaN,height:Infinity,coordinateSpace:'PRIVATE'});
 assert.equal(d.snapshot().geometry.coordinateSpace,null);assert.equal(d.snapshot().geometry.width,null);
});

test('the frozen view, Clear and a released camera are reported, and tick times are a bounded window',()=>{
 let time=0;const d=createScanDiagnostics({now:()=>time});d.begin('live',{});
 for(const [stage,reason] of [['tracking','frozen'],['complete','frozen'],['tracking','cleared'],['detecting','cleared'],['tracking','camera-released']])
  d.event({stage,reason});
 assert.deepEqual(d.snapshot().events.map(e=>`${e.stage}:${e.reason}`),
  ['tracking:frozen','complete:frozen','tracking:cleared','detecting:cleared','tracking:camera-released']);
 for(const reason of ['frozen','cleared','camera-released'])assert.equal(typeof REASON_LABELS[reason],'string',reason);
 for(const ms of [4,8,200000,-1,NaN])d.ticking(ms);
 const tick=d.snapshot().performance.tick;
 assert.equal(tick.count,2);assert.equal(tick.maximumMilliseconds,8);assert.equal(tick.p50Milliseconds,4);
 d.begin('photo',{});assert.equal(d.snapshot().performance.tick.count,0,'a new scan starts a new window');
});

// performance.overlay: of the live time while a grid is tracked, the share in
// each data-overlay mode. Time with no mode (aiming at nothing, frozen,
// closed) and unknown modes are not counted; the current mode counts up to
// the snapshot.
test('the overlay window shares the tracked live time between its modes, numbers only',()=>{
 let time=0;const d=createScanDiagnostics({now:()=>time});d.begin('live',{});
 assert.deepEqual(d.snapshot().performance.overlay,{milliseconds:0,percent:{none:null,outline:null}});
 d.overlay(null);time=1000;
 d.overlay('outline');time=1300;
 d.overlay('none');time=1400;
 d.overlay('PRIVATE');time=2400;
 d.overlay('outline');time=2500;
 assert.deepEqual(d.snapshot().performance.overlay,{milliseconds:500,percent:{none:20,outline:80}},'the open interval counts too');
 time=2600;assert.equal(d.snapshot().performance.overlay.milliseconds,600);
 d.overlay(null);time=9000;
 assert.deepEqual(d.snapshot().performance.overlay,{milliseconds:600,percent:{none:16.67,outline:83.33}});
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
 d.overlay('outline');d.begin('live',{});time=9500;
 assert.deepEqual(d.snapshot().performance.overlay,{milliseconds:0,percent:{none:null,outline:null}},'a new scan starts afresh');
});

// The tracking transport (live-tracker.js): which one, from an allowlist, and
// the worker's draw and readback time apart from the tracking core's.
test('the tracking transport and its time are reported apart from the tracking core, from an allowlist',()=>{
 const d=createScanDiagnostics();d.begin('live',{});
 d.tracking({milliseconds:20,transportMilliseconds:9,transport:'bitmap'},{frame:1,age:30,matched:true});
 d.tracking({milliseconds:22,transportMilliseconds:11,transport:'bitmap'},{frame:2,age:30,matched:true});
 // The camera reports an adopted frame twice (at the reply and after its
 // render): each window counts the frame once.
 d.tracking({milliseconds:22,transportMilliseconds:11,transport:'bitmap'},{frame:2,age:31,matched:true});
 let r=d.snapshot();assert.equal(r.tracking.transport,'bitmap');assert.equal(r.tracking.transportMilliseconds,11);
 assert.equal(r.performance.trackingWorker.count,2);
 assert.equal(r.performance.trackingWorker.p50Milliseconds,20);assert.equal(r.performance.trackingTransport.count,2);
 assert.equal(r.performance.trackingTransport.maximumMilliseconds,11);
 // A reset (the freeze, Clear, a close) leaves the tracker without a transport
 // until its next worker decides: the one used last stays reported.
 d.tracking({milliseconds:20,transport:null},{frame:3,age:30,matched:true});assert.equal(d.snapshot().tracking.transport,'bitmap');
 d.tracking({milliseconds:20,transportMilliseconds:0,transport:'imagedata'},{frame:4,age:30,matched:true});assert.equal(d.snapshot().tracking.transport,'imagedata');
 d.tracking({transport:'PRIVATE'},{frame:5,age:30,matched:true});assert.equal(d.snapshot().tracking.transport,'imagedata','not an allowlisted one');
 d.begin('live',{});d.tracking({},{frame:1,age:30,matched:true});assert.equal(d.snapshot().tracking.transport,null,'a new scan has none yet');
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
 d.event({stage:'tracking',reason:'tracking-transport'});assert.equal(d.snapshot().events.at(-1).reason,'tracking-transport');
 assert.equal(typeof REASON_LABELS['tracking-transport'],'string');
 // Verification replies that keep coming too late to adopt (live-camera.js).
 d.event({stage:'tracking',reason:'tracking-late'});assert.equal(d.snapshot().events.at(-1).reason,'tracking-late');
 assert.equal(typeof REASON_LABELS['tracking-late'],'string');
 d.begin('live',{});assert.equal(d.snapshot().performance.trackingTransport.count,0,'a new scan starts a new window');
});

// Why the worker used its transport and how long its handshake took from the
// worker's start (live-tracker.js), so an "imagedata" from a phone tells an old
// iOS from a slow handshake, a mismatch or bitmaps given up during the scan.
test('the export says why tracking used its transport and how long the handshake took, from an allowlist, kept across a reset',()=>{
 const d=createScanDiagnostics();d.begin('live',{});
 d.tracking({transport:'bitmap',transportReason:'probe',handshakeMilliseconds:22.456},{frame:1,age:30,matched:true});
 let t=d.snapshot().tracking;assert.equal(t.transportReason,'probe');assert.equal(t.handshakeMilliseconds,22.46);
 // A reset (the freeze, Clear, a close) leaves the tracker none: the scan's stay.
 d.tracking({transport:null,transportReason:null,handshakeMilliseconds:null},{frame:2,age:30,matched:true});
 t=d.snapshot().tracking;assert.equal(t.transport,'bitmap');assert.equal(t.transportReason,'probe');assert.equal(t.handshakeMilliseconds,22.46);
 // A later worker's decision replaces them, also without a handshake time.
 d.tracking({transport:'imagedata',transportReason:'unmade',handshakeMilliseconds:null},{frame:3,age:30,matched:true});
 t=d.snapshot().tracking;assert.equal(t.transportReason,'unmade');assert.equal(t.handshakeMilliseconds,null);
 // Every reason the tracker gives is allowlisted; anything else is dropped.
 for(const reason of TRANSPORT_REASONS){d.tracking({transport:'imagedata',transportReason:reason},{frame:4,age:30,matched:true});assert.equal(d.snapshot().tracking.transportReason,reason);}
 d.tracking({transport:'imagedata',transportReason:'PRIVATE',handshakeMilliseconds:'x'},{frame:5,age:30,matched:true});
 t=d.snapshot().tracking;assert.equal(t.transportReason,null);assert.equal(t.handshakeMilliseconds,null);
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
 d.begin('live',{});d.tracking({},{frame:1,age:30,matched:true});
 t=d.snapshot().tracking;assert.equal(t.transportReason,null,'a new scan has none yet');assert.equal(t.handshakeMilliseconds,null);
});

// Frames lost to their bitmaps (live-tracker.js, REFUSAL_LIMIT), or to a
// readback of the camera's own with no picture: one costs only
// itself, so the transport and its reason stay; the export counts them per
// cause, as numbers the tracker keeps across its resets, and a new scan
// starts with none.
test('the export counts the frames lost to a bitmap the worker refused or the camera could not make, or to a blank readback, beside the transport',()=>{
 const d=createScanDiagnostics();d.begin('live',{});
 d.tracking({transport:'bitmap',transportReason:'probe',refusedFrames:0,unmadeFrames:0},{frame:1,age:30,matched:true});
 let t=d.snapshot().tracking;assert.equal(t.refusedFrames,0);assert.equal(t.unmadeFrames,0);
 d.tracking({transport:'bitmap',transportReason:'probe',refusedFrames:1,unmadeFrames:2},{frame:2,age:30,matched:true});
 t=d.snapshot().tracking;assert.deepEqual([t.transport,t.transportReason,t.refusedFrames,t.unmadeFrames],['bitmap','probe',1,2]);
 // A reset (the freeze, Clear) leaves the tracker no transport but its counts.
 d.tracking({transport:null,refusedFrames:1,unmadeFrames:2},{frame:3,age:30,matched:true});
 t=d.snapshot().tracking;assert.deepEqual([t.transport,t.transportReason,t.refusedFrames,t.unmadeFrames],['bitmap','probe',1,2]);
 d.tracking({transport:'imagedata',transportReason:'refused',refusedFrames:3,unmadeFrames:2},{frame:4,age:30,matched:true});
 t=d.snapshot().tracking;assert.deepEqual([t.transport,t.transportReason,t.refusedFrames,t.unmadeFrames],['imagedata','refused',3,2]);
 // The refused ones by the worker's reason; on the camera's own readback, the
 // frames lost to a readback with no picture.
 d.tracking({transport:'imagedata',transportReason:'refused',refusedFrames:3,refusedIncomplete:1,refusedBlank:2,refusedFailed:0,unmadeFrames:2,blankReadbacks:4},{frame:5,age:30,matched:true});
 t=d.snapshot().tracking;assert.deepEqual([t.refusedFrames,t.refusedIncomplete,t.refusedBlank,t.refusedFailed,t.unmadeFrames,t.blankReadbacks],[3,1,2,0,2,4]);
 const counts=['refusedFrames','refusedIncomplete','refusedBlank','refusedFailed','unmadeFrames','blankReadbacks'];
 d.tracking({transport:'imagedata',refusedFrames:'PRIVATE',refusedIncomplete:'PRIVATE',refusedBlank:{},refusedFailed:[1],unmadeFrames:{},blankReadbacks:[1]},{frame:6,age:30,matched:true});
 t=d.snapshot().tracking;assert.deepEqual(counts.map(key=>t[key]),counts.map(()=>null));
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
 d.begin('live',{});d.tracking({},{frame:1,age:30,matched:true});
 t=d.snapshot().tracking;assert.deepEqual(counts.map(key=>t[key]),counts.map(()=>null),'a new scan has none yet');
});

// A frame lost, or bitmaps given up, between two verifications: the camera
// passes the tracker's stats at once (trackingStats), so a scan that freezes,
// aims or closes after them still reports them. The counts and the transport
// are the tracker's then; the latest verification's frame fields stay, and no
// metric is added.
test('between verifications the export takes the tracker\'s counts and keeps the latest verification\'s frame',()=>{
 let time=0;const d=createScanDiagnostics({now:()=>time});d.begin('live',{});
 d.trackingStats({transport:null,unmadeFrames:1,refusedFrames:0});
 let t=d.snapshot().tracking;assert.equal(t.unmadeFrames,1,'also before any verification');assert.equal(t.transport,null);
 assert.equal(Object.hasOwn(t,'frame'),false,'and no frame of its own');
 d.tracking({transport:'bitmap',transportReason:'probe',handshakeMilliseconds:4,milliseconds:20,transportMilliseconds:9,unmadeFrames:1,refusedFrames:0},
  {frame:7,age:30,matched:true,stale:true,rejection:{reason:'cell-content',region:3}});
 const before=d.snapshot();time=100;
 d.trackingStats({transport:'bitmap',transportReason:'probe',handshakeMilliseconds:4,milliseconds:20,transportMilliseconds:9,unmadeFrames:1,refusedFrames:1,refusedBlank:1});
 t=d.snapshot().tracking;
 assert.deepEqual([t.refusedFrames,t.refusedBlank,t.unmadeFrames],[1,1,1]);
 assert.deepEqual([t.frame,t.ageMilliseconds,t.verified,t.tier,t.mismatch,t.region],[7,30,true,'delayed','cell-content',3],'the latest verification\'s frame');
 for(const key of ['trackingWorker','trackingTransport','trackingFrameAge'])assert.deepEqual(d.snapshot().performance[key],before.performance[key],`no ${key} sample`);
 // After a reset (bitmaps given up, the freeze) the tracker has no transport: the scan's stays.
 d.trackingStats({transport:null,refusedFrames:3,refusedBlank:3,unmadeFrames:1});
 t=d.snapshot().tracking;assert.deepEqual([t.transport,t.transportReason,t.handshakeMilliseconds,t.refusedFrames],['bitmap','probe',4,3]);
 d.trackingStats({transport:'bitmap',refusedFrames:'PRIVATE'});
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);assert.equal(d.snapshot().tracking.refusedFrames,null);
});

// On a mismatch the export keeps the values the probe read back: channel
// values of the tracker's synthetic 2 x 2 probe, at most 64 integers 0-255.
test('the export keeps the probe values of a mismatch, from an allowlist, kept across a reset',()=>{
 const d=createScanDiagnostics();d.begin('live',{});
 const values=[201,40,90,255,30,163,220,255,250,250,250,255,10,10,10,255];
 d.tracking({transport:'imagedata',transportReason:'mismatch',probePixels:values},{frame:1,age:30,matched:true});
 let t=d.snapshot().tracking;assert.deepEqual(t.probePixels,values);
 values[0]=0;assert.equal(d.snapshot().tracking.probePixels[0],201,'no caller-owned array is kept');
 d.tracking({transport:null,probePixels:null},{frame:2,age:30,matched:true});
 assert.deepEqual(d.snapshot().tracking.probePixels,[201,...values.slice(1)],'kept across a reset');
 d.tracking({transport:'bitmap',transportReason:'probe',probePixels:null},{frame:3,age:30,matched:true});
 assert.equal(d.snapshot().tracking.probePixels,null,'a later decision replaces them');
 const limit=Array.from({length:64},(_,i)=>i*4);
 d.tracking({transport:'imagedata',transportReason:'mismatch',probePixels:limit},{frame:4,age:30,matched:true});
 assert.deepEqual(d.snapshot().tracking.probePixels,limit,'a 4 x 4 readback');
 for(const bad of [[...limit,0],[1,2,256],[1,-1],[1.5],['PRIVATE'],'PRIVATE',{length:1,0:1}]){
  d.tracking({transport:'imagedata',transportReason:'mismatch',probePixels:bad},{frame:5,age:30,matched:true});
  assert.equal(d.snapshot().tracking.probePixels,null,JSON.stringify(bad));
 }
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
 d.begin('live',{});d.tracking({},{frame:1,age:30,matched:true});assert.equal(d.snapshot().tracking.probePixels,null,'a new scan has none yet');
});
