import test from 'node:test';
import assert from 'node:assert/strict';
import {mapAtlas,atlasLayout} from '../ocr-map.js';
const data=words=>({blocks:[{paragraphs:[{lines:[{words}]}]}]});
const symbol=(text,x0,x1,confidence=98)=>({text,confidence,bbox:{x0,x1,y0:20,y1:90}});

test('A whole atlas row recognized as one word still maps each digit to its cell',()=>{
  const word={...symbol('538',25,310,72),symbols:[symbol('5',25,75),symbol('3',137,188),symbol('8',249,310)]};
  assert.deepEqual(mapAtlas(data([word]),3,3,112).map(x=>x.text),['5','3','8']);
  assert.deepEqual(mapAtlas(data([word]),3,3,112).map(x=>x.confidence),[98,98,98]);
});
test('Multidigit and operator clues stay together INSIDE their own atlas tile',()=>{
  const word={...symbol('12+7',10,180),symbols:[symbol('1',10,26),symbol('2',30,51),symbol('+',62,82),symbol('7',138,180)]};
  assert.deepEqual(mapAtlas(data([word]),2,2,112).map(x=>x.text),['12+','7']);
});
test('Unsegmented cross-tile words and crossing symbols require review',()=>{
  const result=mapAtlas(data([symbol('123456',20,210)]),2,2,112);
  assert.ok(result.every(r=>r.review&&r.confidence===0&&r.text===''));
});
test('Missing output remains unread, not guessed',()=>{
  assert.deepEqual(mapAtlas({},1,1,112),[{text:'',confidence:0,review:false}]);
});
test('A low-confidence one-digit word remains uncertain despite a confident symbol',()=>{
  const word={...symbol('4',20,80,40),symbols:[symbol('4',20,80,99)]};
  assert.equal(mapAtlas(data([word]),1,1,112)[0].confidence,40);
});
test('Compact atlas layout stays within the mobile raster budget',()=>{
  assert.deepEqual(atlasLayout(30),{columns:12,rows:3,tile:112});
  for(const n of [81,256,625,1200,1800]){const a=atlasLayout(n);assert.ok(a.columns*a.rows*a.tile*a.tile<=8_000_000);assert.ok(a.tile>=64);}
  for(const n of [0,-1,NaN,2.5,3001])assert.throws(()=>atlasLayout(n));
});
