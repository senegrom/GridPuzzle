// Temporary probe for this pull request, removed again before it is ready.
// Runs scripts/live_recovery_regressions.cjs against the site built with
// mutant <name> applied (see mutate.cjs), with every digit drawn dx, dy px
// off its place (a patched copy, as in the shift probes; 0,0 draws them where
// the suite does), <repeat> times per offset, in the engine BROWSER_ENGINES
// names, and checks that each run shows what it must:
//   none                      both scenes pass;
//   no-proposal, never-merge  the clear scene fails on the missing proposal;
//   drop-write                the clear scene fails on the cells exactly when
//                             the first full read did not already have the
//                             blurred clue's 6, and passes when it did;
// and in every mutant the race scene passes (its reply never commits).
//   node .github/probe/expect.cjs <name> <out-dir> <repeat> dx,dy [dx,dy ...]
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [name, out, repeat, ...specs] = process.argv.slice(2);
const SUITE = "scripts/live_recovery_regressions.cjs", COPY = "scripts/zz_live_recovery_shift.cjs";
const PROPOSAL = "the targeted re-read must propose a digit for the clearer clue";
const CELLS = "Expected values to be strictly deep-equal";
let source = fs.readFileSync(SUITE, "utf8");
for (const [from, to] of JSON.parse(fs.readFileSync(path.join(__dirname, "patches.json"), "utf8"))) {
  if (source.split(from).length !== 2) throw new Error(`not exactly once: ${from}`);
  source = source.replace(from, to);
}
fs.writeFileSync(COPY, source);
fs.mkdirSync(out, { recursive: true });
let unexpected = 0;
for (const spec of specs) {
  const [dx, dy] = spec.split(",");
  for (let n = 0; n < Number(repeat); n++) {
    fs.rmSync("browser-artifacts", { recursive: true, force: true });
    const started = Date.now();
    const result = spawnSync("node", [COPY], { env: { ...process.env, SHIFT_X: dx, SHIFT_Y: dy }, encoding: "utf8", timeout: 900000 });
    const dir = path.join(out, `${dx}_${dy}_${n}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "stdout.txt"), (result.stdout || "") + "\n--- stderr\n" + (result.stderr || ""));
    const scenes = {};
    for (const scene of ["clear", "race"]) {
      const from = path.join("browser-artifacts", `live-recovery-${scene}.json`);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, path.join(dir, `live-recovery-${scene}.json`));
      const report = JSON.parse(fs.readFileSync(from, "utf8"))[0];
      if (!report) continue;
      const record = report.cases?.[0] ?? {}, capture = record.after?.capture;
      scenes[scene] = { status: report.status, failure: (report.failure || "").split("\n")[0].slice(0, 200),
        first52: record.before?.full?.[0]?.cells?.[52], flagged: record.before?.full?.[0]?.uncertain?.includes(52),
        final52: capture?.cells?.[52], proposals: capture?.recovery?.proposals, changed: capture?.recovery?.changed };
    }
    const { clear, race } = scenes;
    let verdict;
    if (!clear || !race) verdict = "UNEXPECTED: a scene has no report";
    else if (race.status !== "passed") verdict = `UNEXPECTED: the race scene failed: ${race.failure}`;
    else if (name === "none") verdict = clear.status === "passed" ? "expected: passed" : `UNEXPECTED: the control failed: ${clear.failure}`;
    else if (name === "drop-write" && clear.first52 === 6)
      verdict = clear.status === "passed" ? "expected: survived, the full read already had the 6" : `UNEXPECTED: failed although the full read had the 6: ${clear.failure}`;
    else {
      const message = name === "drop-write" ? CELLS : PROPOSAL;
      verdict = clear.status !== "passed" && clear.failure.includes(message) ? `expected: caught (${message})`
        : clear.status === "passed" ? "UNEXPECTED: survived" : `UNEXPECTED: failed otherwise: ${clear.failure}`;
    }
    if (verdict.startsWith("UNEXPECTED")) unexpected++;
    const line = `${name} dx=${dx} dy=${dy} run=${n} exit=${result.status} ${Math.round((Date.now() - started) / 1000)}s ` +
      `first52=${JSON.stringify(clear?.first52)} flagged=${clear?.flagged} final52=${JSON.stringify(clear?.final52)} ` +
      `proposals=${clear?.proposals} changed=${JSON.stringify(clear?.changed)} clear=${clear?.status} race=${race?.status} | ${verdict}`;
    fs.appendFileSync(path.join(out, "summary.txt"), line + "\n");
    console.log(line);
  }
}
fs.rmSync(COPY, { force: true });
process.exitCode = unexpected ? 1 : 0;
