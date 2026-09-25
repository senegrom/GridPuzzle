// tracking-recovery.js: the three-failure circuit, its backoff, and the verified
// work that clears isolated failures.
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_VERIFIED_TRACK_AGE, createTrackingRecovery } from "../tracking-recovery.js";

for (const cadence of [250, 1000, 1800, MAX_VERIFIED_TRACK_AGE]) test(`sustained verified work clears isolated failures at ${cadence}ms`, () => {
  let time = 0; const gate = createTrackingRecovery({ now: () => time });
  for (let incident = 0; incident < 4; incident++) {
    gate.fail(); assert.equal(gate.blocked, false); assert.equal(gate.stats.failures, 1);
    time = gate.nextAttempt;
    for (let i = 0; i < 12; i++) { gate.succeeded(); time += cadence; }
    assert.equal(gate.stats.failures, 0);
  }
});

test('isolated, duplicate, expired and backoff replies cannot defeat the three-failure circuit', () => {
  let time = 0; const gate = createTrackingRecovery({ now: () => time }); gate.fail();
  for (time = 0; time < 2000; time += 200) gate.succeeded(); assert.equal(gate.stats.failures, 1);
  time = gate.nextAttempt; gate.succeeded();
  for (let i = 0; i < 20; i++) gate.succeeded(); assert.equal(gate.stats.failures, 1);
  time += MAX_VERIFIED_TRACK_AGE + 1; gate.succeeded(); assert.equal(gate.stats.failures, 1);
  gate.fail(); time = gate.nextAttempt; gate.succeeded(); gate.fail(); assert.equal(gate.blocked, true);
  for (let i = 0; i < 10; i++) { time += 1000; gate.succeeded(); }
  assert.equal(gate.blocked, true); assert.equal(gate.nextAttempt, Infinity);
  gate.reset(); assert.equal(gate.blocked, false); assert.equal(gate.stats.failures, 0);
});
