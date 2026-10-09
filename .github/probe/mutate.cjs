// Temporary probe for this pull request, removed again before it is ready.
// Applies one mutant of the live session's targeted re-read to a directory of
// the app's modules (web/ before a build, or a built _site/ for a local run).
//   node mutate.cjs <dir> <mutant>      (mutant "none" changes nothing)
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const MUTANTS = {
  // The reading never flags a clue: no review flag from a missing digit, low
  // confidence, a disagreeing vote, a recovered mark or a refined cell.
  "never-flag": [["scanner.js",
    "    if (values[e.cell] === null || e.confidence < 85 || e.recoveredMark || e.refinedCell) uncertain.add(e.cell);",
    "    if (false) uncertain.add(e.cell);"]],
  // A clearer frame of a flagged clue starts a whole-grid read instead of
  // the targeted one.
  "full-reread": [["live-session.js",
    "      if (best && proof(stored.sample) && matches(stored.sample, best)) startRecovery(best, cells);\n      return;\n    }",
    "      if (!(best && proof(stored.sample) && matches(stored.sample, best))) return;\n      lastRead = lastSharpness = -Infinity; attempts = Math.max(attempts, 1);\n    }"]],
  // The targeted read runs, but its digit is never merged.
  "never-merge": [["clue-recovery.js",
    "    replacements.set(cell, { ...entry, confidence: 0, targetedRead: true });",
    "    void entry;"]],
  // No frame ever counts as clearer.
  "never-clearer": [["clue-recovery.js",
    "  }).slice(0, MAX_RETRY_CELLS);",
    "  }).slice(0, 0);"]],
  // The content comparison allows no difference in a cell at all, so any
  // change of the clue reads as changed print.
  "strict-content": [["live-content.js",
    "  return sameRegions(a.pixels, b.pixels, true, [[.03, 2.5, false], [.01, .06, true]], diagnostic) &&",
    "  return sameRegions(a.pixels, b.pixels, true, [[0, 0, false], [0, 0, true]], diagnostic) &&"]],
  // While a targeted read is pending, a detection of other print is not
  // taken as changed content (the race).
  "pending-hides-change": [["live-session.js",
    "    if (reference && !matches(reference, frame)) {",
    "    if (reference && !pending && !matches(reference, frame)) {"]],
};
const [dir, mutant] = process.argv.slice(2);
if (mutant === "none") { console.log("no mutant"); process.exit(0); }
if (!MUTANTS[mutant]) throw new Error(`unknown mutant ${mutant}; one of ${Object.keys(MUTANTS).join(", ")}`);
for (const [file, from, to] of MUTANTS[mutant]) {
  const target = path.join(dir, file);
  const source = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  if (source.split(from).length !== 2) throw new Error(`${mutant}: not exactly once in ${file}: ${from.split("\n")[0]}`);
  fs.writeFileSync(target, source.replace(from, to));
  console.log(`${mutant}: patched ${target}`);
}
