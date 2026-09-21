import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricWindow } from '../scan-metrics.js';
import { createScanDiagnostics } from '../scan-diagnostics.js';
import { createTrackingRecovery } from '../tracking-recovery.js';

test('metric windows bound samples and distinguish recent percentiles from lifetime maximum', () => {
  const m = createMetricWindow(); for (let i = 0; i < 2000; i++) m.add(i);
  for (const invalid of [-1, NaN, Infinity, 180001, '20']) m.add(invalid);
  const s = m.snapshot(); assert.equal(s.count, 2000); assert.equal(s.recentSamples, 128);
  assert.equal(s.maximumMilliseconds, 1999); assert.equal(s.p50Milliseconds, 1935); assert.equal(s.meanMilliseconds, 999.5);
});
test('numeric diagnostics record render savings and first completed reading, not provisional previews', () => {
  let time = 0; const d = createScanDiagnostics({ now: () => time }); d.begin('live', {});
  d.rendering({ painted: true, milliseconds: 3 }); d.rendering({ painted: false });
  d.tracking({ milliseconds: 5 }, { frame: 1, age: 10 }); d.tracking({ milliseconds: 5 }, { frame: 1, age: 10, matched: true });
  const found = { puzzle: { cells: [1] }, refining: true };
  time = 100; d.event({stage:'checking',reason:'read-complete',found});
  assert.equal(d.snapshot().performance.firstCompletedReadingMilliseconds,null);
  time = 150; d.event({stage:'checking',reason:'read-complete',found:{...found,refining:false}});
  time = 200; d.event({stage:'checking',reason:'read-complete',found:{...found,refining:false}});
  const s = d.snapshot().performance; assert.equal(s.paintRequests, 2); assert.equal(s.rendering.count, 1);
  assert.equal(s.trackingWorker.count,1); assert.equal(s.firstCompletedReadingMilliseconds,150);
  d.begin('photo',{}); assert.equal(d.snapshot().performance.rendering.count,0);
});
test('worker recovery backs off, stops after three failures, and permits explicit restart', () => {
  let time = 0; const gate = createTrackingRecovery({ now: () => time });
  gate.fail(); assert.equal(gate.nextAttempt,2000); time=2000;gate.fail();assert.equal(gate.nextAttempt,6000);
  time=6000;gate.fail();assert.equal(gate.blocked,true);assert.equal(gate.nextAttempt,Infinity);
  gate.reset();assert.equal(gate.blocked,false);assert.equal(gate.nextAttempt,0);
});
test('a single successful worker message does not reset repeated-failure protection', () => {
  let time=0;const gate=createTrackingRecovery({now:()=>time});gate.fail();time=2000;gate.succeeded();gate.fail();
  assert.equal(gate.stats.failures,2);
  for(time=6000;time<=8200;time+=200)gate.succeeded();assert.equal(gate.stats.failures,0);
});
