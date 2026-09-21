import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { prepareScan } from "../scan-analysis.js";
import { applyDigitVotes, puzzleFromReadings } from "../scanner.js";
const code=fs.readFileSync(new URL("../ocr-host-worker.js",import.meta.url),"utf8");
async function run(singles,answers){
 const parameters=[],messages=[],calls=[];
 const worker={async setParameters(p){parameters.push(p);},async recognize(png){calls.push(png);return {data:{text:answers.shift()??"",confidence:95}};},async terminate(){}};
 const self={Worker:class{},location:{href:"https://example.test/ocr-host-worker.js"},postMessage:m=>messages.push(m),close(){}};
 vm.runInNewContext(code,{self,URL,Uint8Array,importScripts(){self.Tesseract={createWorker:async()=>worker};}});
 await self.onmessage({data:{png:new ArrayBuffer(0),singles}});return {parameters,calls,result:messages.find(m=>m.result)?.result};
}
const samples=i=>[{index:i,kind:"binary",psm:"10",png:`binary${i}`},{index:i,kind:"gray",psm:"10",png:`gray${i}`}];
test("raw-line retry targets a missed reading without re-reading clear consensus",async()=>{
 const r=await run([...samples(0),...samples(1)],["atlas","8","","1","1","8"]);
 assert.equal(r.result.retryCount,1);assert.equal(r.result.singles.at(-1).text,"8");assert.equal(r.result.singles.at(-1).kind,"retry");
 assert.equal(r.calls.at(-1),"gray0");assert.equal(r.parameters.at(-1).tessedit_pageseg_mode,"13");
});
test("disagreement triggers a bounded retry and retains review even if it breaks a tie",async()=>{
 const r=await run(samples(0),["atlas","2","9","2"]);assert.equal(r.result.retryCount,1);
 const entries=[{text:"",confidence:0}];applyDigitVotes(entries,r.result.singles);
 assert.equal(entries[0].text,"2");assert.equal(entries[0].confidence,0);
});
test("rescued values remain yellow even when the surviving numeric readers agree",()=>{
 const entries=[{text:"8",confidence:40}];applyDigitVotes(entries,[{index:0,text:"",confidence:0},{index:0,kind:"retry",text:"8",confidence:99}]);
 assert.equal(entries[0].text,"8");assert.equal(entries[0].confidence,0);
});
test("retry cost is capped and large-board single-reader budgets are not expanded",async()=>{
 const r=await run(Array.from({length:30},(_,i)=>samples(i)).flat(),Array(85).fill(""));assert.equal(r.result.retryCount,24);assert.equal(r.calls.length,85);
 const one=await run([samples(0)[0]],["",""]);assert.equal(one.result.retryCount,0);
});
test("blank and nonnumeric retry outputs do not invent a numeric clue",()=>{
 for(const text of ["","x","?","1/2"]){const entries=[{text:"",confidence:0}];applyDigitVotes(entries,[{index:0,kind:"retry",text,confidence:99}]);assert.equal(entries[0].text,"");}
});
test("scan results expose printed marks independently of recognised values",()=>{
 const r=puzzleFromReadings({entries:[{kind:"value",cell:0,text:"",confidence:0},{kind:"value",cell:1,text:"1",confidence:99}],
 black:[false,false,false,false],meta:{},mask:new Uint8Array(400),width:20,height:20},"latinsquare",2,2);
 assert.deepEqual(r.markedCells,[0,1]);assert.equal(r.puzzle.cells[0],null);assert.ok(r.cellUncertain.includes(0));
});

function dimBlackMark({digit=true,flat=false}={}) {
 const width=300,height=300,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++) for(let x=0;x<width;x++){
  let value=x<100&&y<100?12:240;
  if(x<100&&y<100&&flat)value=20+(x+y)%15;
  if(digit&&x>=38&&x<62&&y>=30&&y<67&&(x<43||y<35||y>60))value=105;
  const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
 }
 return {width,height,data};
}
test("dim white-on-black glyphs below the fixed cutoff remain visible to OCR",()=>{
 const found=prepareScan(dimBlackMark(),"str8ts",3,3),entry=found.entries.find(e=>e.kind==="blackvalue"&&e.cell===0);
 assert.ok(entry);assert.equal(entry.recoveredMark,true);assert.ok(entry.h>=30);
 entry.text="5";entry.confidence=95;
 applyDigitVotes([entry],[{index:0,text:"5",confidence:99},{index:0,text:"5",confidence:99}]);
 assert.equal(entry.text,"5");assert.equal(entry.confidence,0,"recovered geometry must retain review even with reader agreement");
});
test("black-cell fallback does not create marks from flat or shallow textured blocks",()=>{
 for(const flat of [false,true]){
  const found=prepareScan(dimBlackMark({digit:false,flat}),"str8ts",3,3);
  assert.ok(found.black[0]);assert.equal(found.entries.some(e=>e.kind==="blackvalue"&&e.cell===0),false);
 }
});
test("an agreeing extra read does not downgrade an existing two-reader consensus",()=>{
 const entries=[{text:"8",confidence:90}];
 applyDigitVotes(entries,[{index:0,kind:"binary",text:"8",confidence:95},{index:0,kind:"gray",text:"",confidence:0},{index:0,kind:"retry",text:"8",confidence:95}]);
 assert.equal(entries[0].text,"8");assert.ok(entries[0].confidence>=90);
});
