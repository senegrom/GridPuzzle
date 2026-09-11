import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkShape, checkSolveReady, conflicts, makePuzzle, boxShape } from "../model.js";
import { restoreSession } from "../session.js";
const fixtures = JSON.parse(
  fs.readFileSync(new URL("./fixtures/payloads.json", import.meta.url), "utf8"),
);
for (const fixture of fixtures)
  test(fixture.name, () => {
    if (fixture.solver) assert.doesNotThrow(() => checkSolveReady(fixture.payload));
    else assert.throws(() => checkSolveReady(fixture.payload));
    if (fixture.editor) assert.doesNotThrow(() => checkShape(fixture.payload));
    else {
      assert.throws(() => checkShape(fixture.payload));
      assert.throws(() => conflicts(fixture.payload));
      assert.equal(
        restoreSession({ get: () => ({ puzzle: fixture.payload }) }),
        null,
      );
    }
  });
test("dimensions are rejected before allocation and box calculation", () => {
  for (const n of [0, -1, 1e-12, 1e9, Infinity, NaN, "9", null]) {
    assert.throws(() => makePuzzle("sudoku", n));
    assert.throws(() => boxShape(n));
  }
});
