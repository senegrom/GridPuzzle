import test from 'node:test';
import assert from 'node:assert/strict';
import {checkShape,makePuzzle,boxShape,demo,TYPES,nextReviewCell} from '../model.js';
import {isGridStroke} from '../ocr-map.js';

test('Only solid crop-spanning grid strokes are excluded from cage-label OCR',()=>{
 const bar={kind:'label',width:70,height:7,ink:470,regionWidth:70,cellHeight:100};
 assert.equal(isGridStroke(bar),true);
 for(const change of [{kind:'value'},{kind:'hsign'},{height:20},{width:25},{ink:200}])assert.equal(isGridStroke({...bar,...change}),false);
});
test('Invalid dimensions are rejected before allocating a board or finding box factors',()=>{
 for(const bad of [0,-1,1.5,26,1e12,NaN,Infinity,'9',true]){
  assert.throws(()=>makePuzzle('sudoku',bad));assert.throws(()=>makePuzzle('sudoku',9,bad));assert.throws(()=>boxShape(bad));
 }
});
test('Every family demo still passes render-boundary validation',()=>{
 for(const type of Object.keys(TYPES))assert.equal(checkShape(demo(type)).type,type);
});
test('Imports cannot use fractional, zero or huge steps for box rendering',()=>{
 for(const key of ['boxRows','boxCols'])for(const value of [0,-1,1e-12,NaN,Infinity,26,true,'3'])assert.throws(()=>checkShape({...demo(),[key]:value}));
 assert.throws(()=>checkShape({...demo(),boxRows:2}));
 assert.doesNotThrow(()=>checkShape(makePuzzle('sudoku',4)));
});
test('Nested arrays and clue fields are validated before rendering',()=>{
 const p=makePuzzle('kenken',4);
 for(const cage of [{cells:Array(10000).fill(0),target:4},{cells:[0,0],target:4},{cells:[0],target:'4'},{cells:[0],target:4,op:'unknown'},{cells:[0],target:4,extra:true}])assert.throws(()=>checkShape({...p,cages:[cage]}));
 assert.doesNotThrow(()=>checkShape({...p,cages:[{cells:[0],target:null,op:'+'}]}));
 assert.throws(()=>checkShape({...demo(),cages:[{cells:[0],target:1}]}));
 assert.throws(()=>checkShape({...makePuzzle('futoshiki',4),inequalities:[{less:3,greater:4}]}));
 assert.throws(()=>checkShape({...demo('kakuro'),clues:[{cell:4,across:7}]}));
});
test('Review visits remaining cells in board order and wraps without confirming skipped cells',()=>{
 const pending=new Set([9,0,4]);assert.equal(nextReviewCell(pending),0);assert.equal(nextReviewCell(pending,0),4);assert.equal(nextReviewCell(pending,9),0);assert.equal(pending.size,3);assert.equal(nextReviewCell([]),null);
});

test('Faint grid corners are rejected without suppressing sparse real label text',()=>{
 const corner={kind:'label',width:42,height:20,ink:100,edgeInk:95,regionWidth:70,cellHeight:100};
 assert.equal(isGridStroke(corner),true);
 for(const change of [{edgeInk:60},{width:15},{height:35},{kind:'value'}])assert.equal(isGridStroke({...corner,...change}),false);
});
