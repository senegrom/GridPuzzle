// Temporary probe for the Playwright 1.64 pull request, removed again once it
// has run. WebKit 27.2 draws canvas text set with textBaseline "middle" about
// 1 px higher than WebKit 26.6 (and Chromium) at the live-recovery suite's
// 27 px Courier New, and the suite then fails in WebKit only: the sharpened
// clue counts as changed content. This runs the suite with its digits drawn
// `dy` px lower, per engine, to see whether the outcome follows the digits'
// position rather than the engine:
//
//   node .github/probe/shift_recovery.cjs webkit:0 webkit:-1 chromium:-1 ...
//
// Each run's reports land in probe-out/<engine>_<dy>_<n>/.
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SUITE = "scripts/live_recovery_regressions.cjs", COPY = "scripts/zz_live_recovery_shift.cjs";
let source = fs.readFileSync(SUITE, "utf8");
for (const [from, to] of [
  ["async function begin({ font, race = false }) {", "async function begin({ font, race = false, dy = 0 }) {"],
  ["180 + (Math.floor(i / 9) + .5) * 600 / 9); });", "180 + (Math.floor(i / 9) + .5) * 600 / 9 + dy); });"],
  ["for (const config of [{ font: 'Courier New', race: false }, { font: 'Courier New', race: true }]) {",
    "for (const config of [{ font: 'Courier New', race: false, dy: Number(process.env.SHIFT) }, { font: 'Courier New', race: true, dy: Number(process.env.SHIFT) }]) {"],
]) {
  if (source.split(from).length !== 2) throw new Error(`not exactly once: ${from}`);
  source = source.replace(from, to);
}
fs.writeFileSync(COPY, source);

const summary = [];
process.argv.slice(2).forEach((spec, n) => {
  const [engine, dy] = spec.split(":");
  fs.rmSync("browser-artifacts", { recursive: true, force: true });
  const started = Date.now();
  const result = spawnSync("node", [COPY], { env: { ...process.env, BROWSER_ENGINES: engine, SHIFT: dy }, encoding: "utf8", timeout: 600000 });
  const out = path.join("probe-out", `${engine}_${dy}_${n}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "stdout.txt"), (result.stdout || "") + "\n--- stderr\n" + (result.stderr || ""));
  const outcomes = [];
  for (const file of ["live-recovery-clear.json", "live-recovery-race.json"]) {
    const from = path.join("browser-artifacts", file);
    if (!fs.existsSync(from)) { outcomes.push(`${file}: no report`); continue; }
    fs.copyFileSync(from, path.join(out, file));
    for (const report of JSON.parse(fs.readFileSync(from, "utf8"))) {
      const record = report.cases?.[0] ?? {}, events = (record.after ?? record.final)?.events ?? [];
      const decision = events.some((e) => e.reason === "targeted-complete" || e.stage === "reading" && e.reason === "targeted") ? "targeted re-read"
        : events.some((e) => e.reason === "content-changed") ? "content-changed" : "neither";
      outcomes.push(`${file.replace("live-recovery-", "").replace(".json", "")} ${report.browser} ${report.version} dy=${record.dy} ${report.status}: ${decision}`);
    }
  }
  const line = `${spec} exit=${result.status} ${Math.round((Date.now() - started) / 1000)} s | ${outcomes.join(" | ")}`;
  summary.push(line);
  console.log(line);
});
fs.writeFileSync(path.join("probe-out", "summary.txt"), summary.join("\n") + "\n");
