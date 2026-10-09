// Temporary probe for this pull request, removed again before it is ready.
// The same as shift_runs.cjs, for master's version of the suite (257d598):
// runs it with every digit drawn dx, dy px off its place, in the engine
// BROWSER_ENGINES names, `repeat` times per offset; never fails the job.
//   node .github/probe/before_runs.cjs <out-dir> <repeat> dx,dy [dx,dy ...]
"use strict";
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [out, repeat, ...specs] = process.argv.slice(2);
const COPY = "scripts/zz_live_recovery_before.cjs";
let source = execFileSync("git", ["show", "257d598:scripts/live_recovery_regressions.cjs"], { encoding: "utf8" });
for (const [from, to] of JSON.parse(fs.readFileSync(path.join(__dirname, "before-patches.json"), "utf8"))) {
  if (source.split(from).length !== 2) throw new Error(`not exactly once: ${from}`);
  source = source.replace(from, to);
}
fs.writeFileSync(COPY, source);
fs.mkdirSync(out, { recursive: true });
for (const spec of specs) {
  const [dx, dy] = spec.split(",");
  for (let n = 0; n < Number(repeat); n++) {
    fs.rmSync("browser-artifacts", { recursive: true, force: true });
    const started = Date.now();
    const result = spawnSync("node", [COPY], { env: { ...process.env, SHIFT_X: dx, SHIFT_Y: dy }, encoding: "utf8", timeout: 900000 });
    const dir = path.join(out, `${dx}_${dy}_${n}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "stdout.txt"), (result.stdout || "") + "\n--- stderr\n" + (result.stderr || ""));
    const outcomes = [];
    for (const file of ["live-recovery-clear.json", "live-recovery-race.json"]) {
      const from = path.join("browser-artifacts", file);
      if (!fs.existsSync(from)) { outcomes.push(`${file}: no report`); continue; }
      fs.copyFileSync(from, path.join(dir, file));
      for (const report of JSON.parse(fs.readFileSync(from, "utf8"))) {
        const record = report.cases?.[0] ?? {}, events = (record.after ?? record.final)?.events ?? [];
        const decision = events.some((e) => e.reason === "targeted-complete" || (e.stage === "reading" && e.reason === "targeted")) ? "targeted"
          : events.some((e) => e.reason === "content-changed") ? "content-changed" : "neither";
        const flagged = record.before?.full?.[0]?.uncertain?.includes(52);
        const first = (report.failure || "").split("\n")[0].slice(0, 200);
        outcomes.push(`${file.replace("live-recovery-", "").replace(".json", "")} ${report.browser} ${report.status} flagged=${flagged} ${decision}${first ? ` | ${first}` : ""}`);
      }
    }
    const line = `dx=${dx} dy=${dy} run=${n} exit=${result.status} ${Math.round((Date.now() - started) / 1000)}s | ${outcomes.join(" || ")}`;
    fs.appendFileSync(path.join(out, "summary.txt"), line + "\n");
    console.log(line);
  }
}
fs.rmSync(COPY, { force: true });
