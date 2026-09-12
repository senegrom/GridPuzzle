import test from "node:test";
import assert from "node:assert/strict";
import { prepareScan } from "../scan-analysis.js";
import { puzzleFromReadings } from "../scanner.js";
import { overlayCells, previewAllowed } from "../live-overlay.js";
import { gridContent, sameGridContent } from "../live-content.js";
import { createLiveSession } from "../live-session.js";
import { saveCapture, deleteCapture, loadCapture, setupCaptureGallery } from "../capture-store.js";
import { makePuzzle } from "../model.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function paper(level = 220, control = "digit") {
  const width = 300, height = 300, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = 255;
    if (control === "gradient") v = Math.round(180 + 70 * x / width);
    if (control === "noise") v = 250 + (x * 17 + y * 23) % 6;
    if (control === "shade" && x < 100 && y < 100) v = 205;
    if (control === "edge" && x < 51 && y < 100) v = 230;
    if (x % 100 < 2 || y % 100 < 2) v = 0;
    if (control === "digit" && x >= 38 && x < 62 && y >= 30 && y < 68 &&
      (x < 44 || y < 36 || y > 60 || (y > 46 && x > 55))) v = level;
    if (control === "fragments" && x >= 47 && x < 54 && ((y >= 32 && y < 40) || (y >= 53 && y < 61))) v = level;
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { width, height, data };
}
function transcription(prep) { return puzzleFromReadings({ ...prep, width: 300, height: 300 }, "latinsquare", 3, 3); }
for (const level of [215, 220, 230, 235]) test(`a faint white-cell clue at gray ${level} remains printed evidence`, () => {
  const prep = prepareScan(paper(level), "latinsquare", 3, 3), e = prep.entries.find((entry) => entry.cell === 0);
  assert.ok(e, "the clue must reach OCR"); assert.equal(e.recoveredMark, true);
  let found = transcription(prep);
  assert.ok(found.markedCells.includes(0)); assert.ok(found.cellUncertain.includes(0));
  assert.equal(previewAllowed(found), false);
  const solution = { status: "unique", complete: true, solutions: [{ cells: [1,2,3,2,3,1,3,1,2] }] };
  assert.equal(overlayCells(found, solution).find((cell) => cell.cell === 0).kind, "unknown");
  e.text = "1"; e.confidence = 99; found = transcription(prep);
  assert.ok(found.cellUncertain.includes(0), "recovered geometry keeps review independently of OCR confidence");
  assert.equal(overlayCells(found, solution).find((cell) => cell.cell === 0).kind, "uncertain");
});
for (const control of ["blank", "gradient", "noise", "shade", "edge"]) test(`${control} paper is not a faint printed mark`, () => {
  const prep = prepareScan(paper(220, control), "latinsquare", 3, 3);
  assert.equal(prep.entries.length, 0); assert.deepEqual(prep.unreadCells ?? [], []);
});
test("plausible faint fragments remain unknown even without an OCR-sized glyph", () => {
  const prep = prepareScan(paper(220, "fragments"), "latinsquare", 3, 3);
  assert.deepEqual(prep.unreadCells, [0]); assert.equal(prep.entries.length, 0);
  const found = transcription(prep);
  assert.deepEqual(found.markedCells, [0]); assert.deepEqual(found.cellUncertain, [0]);
  assert.equal(previewAllowed(found), false);
});

const corners = [{x:0,y:0},{x:299,y:0},{x:299,y:299},{x:0,y:299}];
test("cell content rejects changed and erased clues but tolerates small uniform illumination changes", () => {
  const a = paper(0), b = paper(0), base = gridContent(a, corners, 3, 3);
  // Change just one clue into a narrow vertical glyph; all other cells match.
  for (let y = 30; y < 68; y++) for (let x = 38; x < 62; x++) for (let c = 0; c < 3; c++)
    b.data[(y*300+x)*4+c] = x >= 48 && x < 54 ? 0 : 255;
  assert.equal(sameGridContent(base, gridContent(b, corners, 3, 3)), false);
  assert.equal(sameGridContent(base, gridContent(paper(0,"blank"), corners, 3, 3)), false);
  for (let i = 0; i < a.data.length; i += 4) for (let c=0;c<3;c++) a.data[i+c] = Math.round(a.data[i+c]*.92);
  assert.equal(sameGridContent(base, gridContent(a, corners, 3, 3)), true);
});
test("missing or incompatible cell signatures cannot certify content", () => {
  const a = gridContent(paper(), corners, 3, 3);
  for (const other of [null, {}, {...a, rows:4}, {...a, pixels:new Uint8Array(1)}]) assert.equal(sameGridContent(a, other), false);
});
for (const phase of ["reading", "solving", "solved"]) test(`new pixels retire ${phase} results even when coarse motion misses the change`, async (t) => {
  const read = deferred(), solve = deferred(); let valid = true, solveCalls = 0;
  const s = createLiveSession({ read:()=>read.promise, solve:()=>{solveCalls++;return solve.promise;}, cancelRead(){}, cancelSolve(){},
    onChange(){},onStatus(){},isCurrent:()=>valid });
  t.after(()=>s.stop()); s.start();
  const frame = { key:"2x2",width:300,corners,signature:new Uint8Array(4096).fill(180),sharpness:200 };
  const puzzle = makePuzzle("latinsquare",2);puzzle.cells[0]=1;
  s.observe(frame);s.observe(frame);
  if (phase !== "reading") { read.resolve({puzzle,markedCells:[0]});await tick(); }
  if (phase === "solved") { solve.resolve({status:"unique",complete:true,solutions:[{cells:[1,2,2,1]}]});await tick();assert.ok(s.preview.result); }
  valid=false;
  // Pending callbacks also validate, even before the next motion tick.
  if (phase === "reading") read.resolve({puzzle,markedCells:[0]});
  else if (phase === "solving") solve.resolve({status:"unique",complete:true,solutions:[{cells:[1,2,2,1]}]});
  else s.motion(frame.signature);
  await tick();assert.equal(s.preview,null);assert.equal(s.busy,false);
  if (phase === "reading") assert.equal(solveCalls,0);
});

function memoryStore() {
  let record = null, held = false; const openings=[];
  const db = { objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tx={abort(){tx.onabort?.();},objectStore(){return {
      put(value){record=structuredClone(value);return done();},delete(){record=null;return done();},get(){return done(record);},
    };}};
    function done(result){const request={result};queueMicrotask(()=>{request.onsuccess?.();tx.oncomplete?.();});return request;}
    return tx;
  }};
  return {indexedDB:{open(){const request={result:db};if(held){held=false;openings.push(request);}else queueMicrotask(()=>request.onsuccess?.());return request;}},
    hold(){held=true;},release(){openings.shift().onsuccess();}};
}
function slowPng() { const bytes=deferred(), blob=new Blob(["png"],{type:"image/png"});blob.arrayBuffer=()=>bytes.promise;return {blob,release:()=>bytes.resolve(new TextEncoder().encode("png").buffer)}; }
for (const phase of ["conversion", "opening"]) test(`Delete wins over an older save delayed during ${phase}`, async () => {
  const options=memoryStore(), pic=slowPng();
  if(phase==="opening") {options.hold();pic.release();}
  const save=saveCapture(pic.blob,42,options);const observed=assert.rejects(save,/superseded/);await tick();
  await deleteCapture(options); assert.equal(await loadCapture(options),null);
  if(phase==="opening") options.release();else pic.release();
  await observed; assert.equal(await loadCapture(options),null);
});
test("a later capture cannot be overwritten by an older slow conversion", async () => {
  const options=memoryStore(), pic=slowPng(), old=saveCapture(pic.blob,1,options), observed=assert.rejects(old,/superseded/);
  await saveCapture(new Blob(["new"],{type:"image/png"}),2,options);pic.release();await observed;
  assert.equal((await loadCapture(options)).createdAt,2);
});
test("a delayed delete cannot remove a newer requested capture", async () => {
  const options=memoryStore();options.hold();const old=deleteCapture(options), observed=assert.rejects(old,/superseded/);
  await saveCapture(new Blob(["new"],{type:"image/png"}),2,options);options.release();await observed;
  assert.equal((await loadCapture(options)).createdAt,2);
});
test("the gallery's deleted message agrees with durable state after a stale conversion",async()=>{
  const options=memoryStore(), nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,removeAttribute(){}});return nodes.get(id);};
  const capture=setupCaptureGallery($,{load:()=>loadCapture(options),save:(b,t)=>saveCapture(b,t,options),remove:()=>deleteCapture(options)});
  const pic=slowPng(), saving=capture({toBlob(cb){cb(pic.blob);}},42);await tick();await $("delete-capture").onclick();
  pic.release();assert.equal(await saving,false);assert.equal(await loadCapture(options),null);
  assert.equal($("saved-capture").hidden,true);assert.match($("capture-storage-status").textContent,/deleted/);
});

for (const fade of [1, .35]) test(`changed and erased white-on-black clues remain visible at contrast ${fade}`, () => {
  const invert = (img) => {
    for (let i = 0; i < img.data.length; i += 4)
      for (let c = 0; c < 3; c++) img.data[i+c] = Math.round(255 - fade * img.data[i+c]);
    return img;
  };
  const a = invert(paper(0)), b = paper(0);
  for (let y = 30; y < 68; y++) for (let x = 38; x < 62; x++) for (let c = 0; c < 3; c++)
    b.data[(y*300+x)*4+c] = x >= 48 && x < 54 ? 0 : 255;
  const reference = gridContent(a, corners, 3, 3);
  assert.equal(sameGridContent(reference, gridContent(invert(b), corners, 3, 3)), false);
  assert.equal(sameGridContent(reference, gridContent(invert(paper(0,"blank")), corners, 3, 3)), false);
  assert.equal(sameGridContent(reference, gridContent(a, corners, 3, 3)), true);
});
