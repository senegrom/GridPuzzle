import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,makePuzzle,checkShape} from '../model.js';

test('automatically identified boxed Sudoku still requires one rules confirmation',()=>{
  const result=classify({rows:9,cols:9,boxes:true,values:[5,3,7]});
  assert.equal(result.type,'sudoku');assert.equal(result.review,true);
});
test('browser validation rejects disconnected/overlapping/bad-arity cages early',()=>{
  const p=makePuzzle('kenken',4);p.cages=[{cells:[0,2],target:3,op:'+'}];assert.throws(()=>checkShape(p),/connected/);
  p.cages=[{cells:[0,1],target:3,op:'+'},{cells:[1,2],target:4,op:'+'}];assert.throws(()=>checkShape(p),/overlap/);
  p.cages=[{cells:[0,1,2],target:1,op:'-'}];assert.throws(()=>checkShape(p),/exactly two/);
  p.cages=[{cells:[0,1],target:1,op:'='}];assert.throws(()=>checkShape(p),/exactly one/);
});
test('Kakuro clue objects need at least one direction',()=>{
  const p=makePuzzle('kakuro',3);p.cells[0]='#';p.clues=[{cell:0}];assert.throws(()=>checkShape(p),/across or down/);
});
