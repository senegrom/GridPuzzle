import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { digitSamples, applyDigitVotes, puzzleFromReadings } from '../scanner.js';
import { normalizeScanContrast, prepareScan } from '../scan-analysis.js';

function canvasMock(t) {
  const original = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = {};
    canvas.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, fillRect() {}, drawImage() {},
    });
    canvas.toDataURL = () => `${canvas.width}x${canvas.height}`;
    return canvas;
  } };
  t.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
}

test('wide numeric crops receive independent readings without losing narrow clues', (t) => {
  canvasMock(t);
  const entries = [{cell:0,x:30,y:25,w:12,h:40},{cell:1,x:115,y:25,w:65,h:40}],
    crops = new Map([[0,{width:22,height:50}],[1,{width:75,height:50}]]),
    samples = digitSamples(entries,crops,new Uint8Array(20000).fill(255),200,100,100,100,2);
  assert.deepEqual(samples.map(({index,kind,psm})=>[index,kind,psm]), [
    [0,'binary','10'],[0,'gray','10'],[1,'binary','7'],[1,'gray','7'],
  ]);
  assert.ok(samples.every(s=>Number(s.png.split('x')[1])===96), 'keep the measured 64px crop height and 16px borders');
});

test('numeric rereads keep the grayscale budget on a large board', (t) => {
  canvasMock(t);
  const entries=Array.from({length:625},(_,cell)=>({cell,x:0,y:0,w:60,h:40})),
    crops=new Map(entries.map((_,i)=>[i,{width:70,height:50}])),
    samples=digitSamples(entries,crops,new Uint8Array(62500),250,250,10,10,25);
  assert.equal(samples.length,625);
  assert.ok(samples.every(s=>s.kind==='binary'));
});

test('full multi-digit agreement is confident, but disagreement stays highlighted', () => {
  const entries=[{text:'14',confidence:40},{text:'111',confidence:20}];
  applyDigitVotes(entries,[{index:0,text:'144',confidence:95},{index:0,text:'144',confidence:95},
    {index:1,text:'111',confidence:90},{index:1,text:'111',confidence:85}]);
  assert.deepEqual(entries,[{text:'144',confidence:0},{text:'111',confidence:90}]);
});

test('normally exposed and almost uniform images are not stretched', () => {
  for(const g of [new Uint8Array(0),new Uint8Array(1000).fill(255),
    Uint8Array.from({length:1000},(_,i)=>i%2?0:240),
    Uint8Array.from({length:1000},(_,i)=>180+i%15)]) {
    const before=g.slice(), result=normalizeScanContrast(g);
    assert.equal(result.adjusted,false); assert.equal(result.gray,g); assert.deepEqual(g,before);
  }
});

test('faded grayscale is stretched without mutation or amplifying isolated extreme pixels', () => {
  const g=Uint8Array.from({length:10000},(_,i)=>i%2?166:245);g[0]=0;g[1]=255;
  const before=g.slice(),result=normalizeScanContrast(g);
  assert.equal(result.adjusted,true); assert.deepEqual(g,before);
  assert.equal(result.gray[3],0);assert.ok(result.gray[2]>=225);
  assert.equal(result.gray[0],0);assert.equal(result.gray[1],255);
});

function photo(fade) {
  const width=300,height=300,data=new Uint8ClampedArray(width*height*4).fill(255);
  function fill(x,y,w,h,value) {for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)for(let k=0;k<3;k++)
    data[4*(yy*width+xx)+k]=Math.round(255-(255-value)*fade);}
  // Grid/ink anchors the black level, not the shaded cell.
  for(let i=0;i<=3;i++){fill(Math.min(298,i*100),0,2,300,0);fill(0,Math.min(298,i*100),300,2,0);}
  fill(100,100,100,100,20);fill(145,125,10,40,190);
  fill(200,200,98,98,130);fill(45,25,10,40,0);
  return {width,height,data};
}
for(const fade of [0.65,0.35]) test(`fading by ${fade} retains solid blocks, gray shading and printed regions`,()=>{
  const original=prepareScan(photo(1),'str8ts',3,3),recovered=prepareScan(photo(fade),'str8ts',3,3);
  assert.equal(recovered.contrastAdjusted,true);
  assert.deepEqual(recovered.black,original.black); assert.equal(recovered.black[4],true);assert.equal(recovered.black[8],false);
  for(const cell of [0,4]) assert.ok(recovered.entries.some(e=>e.cell===cell && e.kind.includes('value')));
});

test('contrast-adjusted recognition requires review even for explicit confident Sudoku',()=>{
  const r=puzzleFromReadings({entries:[{kind:'value',cell:0,text:'1',confidence:99}],black:Array(9).fill(false),
    meta:{rows:3,cols:3,boxes:true},mask:new Uint8Array(90000),width:300,height:300,contrastAdjusted:true},'sudoku',3,3);
  assert.equal(r.needsReview,true);assert.ok(r.notes.some(n=>/contrast/i.test(n)));assert.equal(r.puzzle.cells[0],1);
});

test('OCR host switches segmentation modes and retains the digit whitelist',async()=>{
  const parameters=[],reads=[],messages=[];
  const worker={async setParameters(p){parameters.push(p);},async recognize(png){reads.push(png);return{data:{text:'12',confidence:90}};},async terminate(){}};
  const self={Worker:class{},location:{href:'https://example.test/ocr-host-worker.js'},postMessage:m=>messages.push(m),close(){}};
  const context=vm.createContext({self,URL,Uint8Array,importScripts(){self.Tesseract={createWorker:async()=>worker};}});
  vm.runInContext(fs.readFileSync(new URL('../ocr-host-worker.js',import.meta.url),'utf8'),context);
  await self.onmessage({data:{png:new ArrayBuffer(0),singles:[
    {index:0,kind:'binary',psm:'7',png:'word'},{index:0,kind:'gray',psm:'7',png:'gray'},
    {index:1,kind:'binary',psm:'10',png:'digit'},{index:2,psm:'arbitrary',png:'invalid-mode'},
  ]}});
  assert.deepEqual(parameters.map(p=>p.tessedit_pageseg_mode),['11','10','7','10']);
  assert.equal(parameters[1].tessedit_char_whitelist,'0123456789');
  const result=messages.find(m=>m.result)?.result;
  assert.equal(result.singles.length,4);assert.equal(result.singles[0].text,'12');assert.equal(reads.length,5);
});
