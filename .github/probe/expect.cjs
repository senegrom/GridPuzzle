// Temporary probe for this pull request, removed again before it is ready.
// Runs scripts/live_recovery_regressions.cjs once against the site built
// with mutant <name> applied (see mutate.cjs) and reports whether the suite
// caught it: the job passes when the control passes and every mutant fails.
//   node .github/probe/expect.cjs <name> <out-dir>
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const [name, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const started = Date.now();
const result = spawnSync("node", ["scripts/live_recovery_regressions.cjs"], { encoding: "utf8", timeout: 1200000 });
fs.writeFileSync(path.join(out, "stdout.txt"), (result.stdout || "") + "\n--- stderr\n" + (result.stderr || ""));
const outcomes = [];
for (const file of ["live-recovery-clear.json", "live-recovery-race.json"]) {
  const from = path.join("browser-artifacts", file);
  if (!fs.existsSync(from)) { outcomes.push(`${file}: no report`); continue; }
  fs.copyFileSync(from, path.join(out, file));
  for (const report of JSON.parse(fs.readFileSync(from, "utf8")))
    outcomes.push(`${file.replace("live-recovery-", "").replace(".json", "")} ${report.browser} ${report.status}${report.failure ? ` | ${report.failure.split("\n")[0].slice(0, 200)}` : ""}`);
}
const caught = result.status !== 0;
const line = `${name} exit=${result.status} ${Math.round((Date.now() - started) / 1000)}s ${name === "none" ? (caught ? "CONTROL FAILED" : "control passed") : caught ? "caught" : "SURVIVED"} | ${outcomes.join(" || ")}`;
fs.writeFileSync(path.join(out, "summary.txt"), line + "\n");
console.log(line);
process.exitCode = (name === "none") === caught ? 1 : 0;
