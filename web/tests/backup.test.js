import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parsePuzzleFile, puzzleDefinition } from '../backup.js';
import { makePuzzle, fitPlay } from '../model.js';
function state() {
  const puzzle = makePuzzle('latinsquare', 2); puzzle.cells[0] = 1;
  return { puzzle, uncertain: new Set([0]), cageUncertain: new Set(), needsReview: true,
    notes: ['Check the photograph'], blackReadings: [], play: [null, 2, null, null], hints: new Set([1]) };
}
test('backup round trip preserves warnings, notes, progress and hint ownership, not solutions or photos', () => {
  const s=state(); s.photo='PRIVATE PHOTO'; s.result={solutions:['PRIVATE SOLUTION']};
  const file=JSON.stringify(createBackup(s,'play')), r=parsePuzzleFile(JSON.parse(file));
  assert.deepEqual(r.puzzle,s.puzzle); assert.deepEqual(r.uncertain,[0]); assert.equal(r.needsReview,true);
  assert.deepEqual(r.play,s.play); assert.deepEqual(r.hints,[1]); assert.deepEqual(r.notes,s.notes);
  assert.equal(r.editing,'play'); assert.doesNotMatch(file,/PRIVATE/);
});
test('confirmed backups stay confirmed, while legacy definitions explicitly require review', () => {
  const s=state(); s.uncertain.clear();s.needsReview=false;
  assert.equal(parsePuzzleFile(createBackup(s)).needsReview,false);
  const legacy=parsePuzzleFile(puzzleDefinition(s)); assert.equal(legacy.needsReview,true);
  assert.ok(legacy.notes[0].includes('no saved review state')); assert.deepEqual(legacy.play,[null,null,null,null]);
});
test('puzzle-only export cannot discard any outstanding review evidence', () => {
  for (const flags of [{needsReview:true},{uncertain:new Set([0])},{cageUncertain:new Set([0])},{blackReadings:[{cell:0,value:1}]}]) {
    assert.throws(()=>puzzleDefinition({...state(),needsReview:false,uncertain:new Set(),cageUncertain:new Set(),...flags}),/backup|review/i);
  }
});
test('separate cell/cage warnings survive backup and inconsistent unions are rejected',()=>{
  const s=state();s.cageUncertain.add(1);
  const b=createBackup(s),r=parsePuzzleFile(b);assert.deepEqual(r.uncertain,[0]);assert.deepEqual(r.cageUncertain,[1]);
  b.session.uncertain=[];assert.throws(()=>parsePuzzleFile(b),/Inconsistent/);
});
for (const [name,modify] of [
  ['new version',b=>b.version=2],['unknown field',b=>b.solution=[]],['missing flags',b=>delete b.session.cellUncertain],
  ['invalid index',b=>b.session.cellUncertain=[99]],['string review',b=>b.session.needsReview='false'],
  ['progress on given',b=>b.session.play[0]=2],['invalid progress',b=>b.session.play[1]=99],
  ['unowned hint',b=>b.session.hints=[2]],['extra puzzle key',b=>b.session.puzzle.execute='bad'],
  ['invalid notes',b=>b.session.notes=[{}]],['black evidence on white',b=>b.session.blackReadings=[{cell:0,value:7}]],
]) test(`backup rejects ${name} without changing its source`,()=>{
  const b=createBackup(state());modify(b);const prior=JSON.stringify(b);assert.throws(()=>parsePuzzleFile(b));assert.equal(JSON.stringify(b),prior);
});
test('black-cell OCR evidence survives a backup and keeps its cell flagged',()=>{
 const puzzle=makePuzzle('hidato',2);puzzle.cells[0]='#';
 const s={...state(),puzzle,blackReadings:[{cell:0,value:7}],play:fitPlay(puzzle,[]),hints:new Set()};
 const r=parsePuzzleFile(createBackup(s));assert.deepEqual(r.blackReadings,s.blackReadings);assert.ok(r.uncertain.includes(0));
});

test('backup black-cell object key order does not affect valid metadata',()=>{
 const puzzle=makePuzzle('hidato',2);puzzle.cells[0]='#';
 const b=createBackup({...state(),puzzle,blackReadings:[{cell:0,value:7}],play:fitPlay(puzzle,[]),hints:new Set()});
 b.session.blackReadings=[{value:7,cell:0}];
 assert.deepEqual(parsePuzzleFile(b).blackReadings,[{cell:0,value:7}]);
});
