import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parsePuzzleFile } from '../backup.js';
import { saveSession, restoreSession } from '../session.js';
import { makePuzzle, fitPlay } from '../model.js';
import { reviewNotes, MAX_REVIEW_NOTES, MAX_REVIEW_NOTE_LENGTH } from '../review-notes.js';
import { createTrackingRecovery } from '../tracking-recovery.js';
import { createScanDiagnostics } from '../scan-diagnostics.js';

function state(notes) {
  const puzzle = makePuzzle('hidato', 3); puzzle.cells[0] = 1; puzzle.cells[4] = '#';
  const play = fitPlay(puzzle, []); play[1] = 2;
  return { puzzle, notes, uncertain: new Set([0,4]), cageUncertain: new Set([2]),
    blackReadings: [{cell:4,value:3}], needsReview:true, play, hints:new Set([1]) };
}
for (const count of [8, 9, 10, MAX_REVIEW_NOTES]) test(`${count} composed warning notes survive autosave and a strict backup round trip`, () => {
  const s = state(Array.from({length:count}, (_,i) => `Warning ${i+1}: check the printed clue or rule.`));
  let saved; saveSession({set(_key,v){saved=v;}}, s);
  const restored = restoreSession({get:()=>saved});
  const r = parsePuzzleFile(createBackup(s, 'play'));
  for (const value of [restored,r]) {
    assert.deepEqual(value.notes,s.notes); assert.equal(value.needsReview,true);
    assert.deepEqual(value.uncertain,[0,4]); assert.deepEqual(value.cageUncertain,[2]);
    assert.deepEqual(value.blackReadings,s.blackReadings); assert.deepEqual(value.play,s.play); assert.deepEqual(value.hints,[1]);
  }
  assert.equal(r.editing,'play');
});
test('overflow warnings are bounded and explicitly require review without losing cell evidence', () => {
  const s=state(Array.from({length:MAX_REVIEW_NOTES+10},(_,i)=>`Warning ${i}`));
  s.needsReview=false;
  const r=parsePuzzleFile(createBackup(s));
  assert.equal(r.notes.length,MAX_REVIEW_NOTES);assert.match(r.notes.at(-1),/condensed/);
  assert.deepEqual(r.notes.slice(0,-1),s.notes.slice(0,MAX_REVIEW_NOTES-1));
  assert.equal(r.needsReview,true);assert.deepEqual(r.blackReadings,s.blackReadings);
  assert.deepEqual(r.uncertain,[0,4]);assert.deepEqual(r.cageUncertain,[2]);
  assert.equal(s.notes.length,MAX_REVIEW_NOTES+10,'export must not mutate the editor');
});
test('long explanatory text is bounded but its condensation cannot silently confirm a scan', () => {
  const s=state(['x'.repeat(MAX_REVIEW_NOTE_LENGTH+1)]);s.uncertain.clear();s.cageUncertain.clear();s.blackReadings=[];s.needsReview=false;
  const r=parsePuzzleFile(createBackup(s));assert.equal(r.notes[0].length,MAX_REVIEW_NOTE_LENGTH);
  assert.match(r.notes[1],/condensed/);assert.equal(r.needsReview,true);
  assert.deepEqual(reviewNotes(reviewNotes(s.notes).notes).notes,reviewNotes(s.notes).notes,'normalization is idempotent');
});
test('malformed or over-budget imported notes are rejected atomically, not silently trimmed', () => {
  for(const notes of [Array(MAX_REVIEW_NOTES+1).fill('a'),['x'.repeat(MAX_REVIEW_NOTE_LENGTH+1)],[{}]]){
    const b=createBackup(state([]));b.session.notes=notes;const prior=JSON.stringify(b);
    assert.throws(()=>parsePuzzleFile(b),/review metadata/);assert.equal(JSON.stringify(b),prior);
  }
});
for(const cadence of [250,1000,1950])test(`successful ${cadence}ms tracking clears earlier isolated failures`,()=>{
  let time=0;const gate=createTrackingRecovery({now:()=>time});
  for(let incident=0;incident<3;incident++){
    gate.fail();assert.equal(gate.blocked,false);time=gate.nextAttempt;
    for(let n=0;n<Math.ceil(10000/cadence);n++){time+=cadence;gate.succeeded();}
    assert.equal(gate.stats.failures,0);
  }
});
test('sparse successes and repeated timestamps cannot defeat the worker circuit breaker',()=>{
  let time=0;const gate=createTrackingRecovery({now:()=>time});gate.fail();
  for(let i=0;i<10;i++){time+=2100;gate.succeeded();for(let j=0;j<5;j++)gate.succeeded();}
  assert.equal(gate.stats.failures,1);gate.fail();gate.fail();assert.equal(gate.blocked,true);
  for(let i=0;i<10;i++){time+=1000;gate.succeeded();}assert.equal(gate.blocked,true,'an explicitly paused worker requires restart');
  gate.reset();assert.equal(gate.blocked,false);
});
test('a single delayed success does not clear a failed worker, but three sustained verifications do',()=>{
  let time=0;const gate=createTrackingRecovery({now:()=>time});gate.fail();
  time=2000;gate.succeeded();time=4000;gate.succeeded();assert.equal(gate.stats.failures,1);
  time=6000;gate.succeeded();assert.equal(gate.stats.failures,0);
});
test('diagnostic handoff preserves timings and readings but changes image-consent ownership',()=>{
  let time=0;const d=createScanDiagnostics({now:()=>time,build:'test'});d.begin('live',{type:'auto',rows:9,cols:9});
  d.event({stage:'reading',reason:'full-read'});time=1000;
  d.event({stage:'checking',reason:'read-complete',found:{puzzle:makePuzzle(),cellUncertain:[0],needsReview:true}});
  const before=d.snapshot();d.handoff('capture');const capture=d.snapshot();d.handoff('photo');const photo=d.snapshot();
  assert.ok(capture.sourceRevision>before.sourceRevision);assert.ok(photo.sourceRevision>capture.sourceRevision);
  assert.equal(capture.source,'capture');assert.equal(photo.source,'photo');assert.deepEqual(photo.lastReading,before.lastReading);
  assert.equal(photo.counters.fullReads,1);assert.equal(photo.performance.firstCompletedReadingMilliseconds,1000);
  assert.equal(photo.privacy.includesImage,false);assert.throws(()=>d.handoff('https://private.example'),/source/);
});
test('alignment rejection diagnostics include only allowlisted reasons and bounded numeric regions',()=>{
  const d=createScanDiagnostics();d.begin('live',{});
  d.event({stage:'tracking',reason:'alignment-rejected',mismatch:'cell-content',region:0,image:'PRIVATE'});
  d.tracking({}, {frame:1,age:25,matched:false,rejection:{reason:'cell-content',region:0,data:'PRIVATE'}});
  const s=d.snapshot();assert.equal(s.counters.unmatchedCandidates,1);assert.equal(s.tracking.mismatch,'cell-content');
  assert.equal(s.events[0].region,0);assert.doesNotMatch(JSON.stringify(s),/PRIVATE/);
  d.tracking({}, {frame:2,age:30,rejection:{reason:'SECRET URL',region:9000000}});
  assert.equal(d.snapshot().tracking.mismatch,undefined);
});
