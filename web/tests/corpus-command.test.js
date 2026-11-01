import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { INTERRUPTED_CLOSE_LIMIT, LATE_SIGNAL_CLOSE_LIMIT } = require("../../corpus/benchmark-runner.cjs"), { CLOSE_LIMIT } = require("../../scripts/watch.cjs");

// How the process of a corpus command ends: interrupted or not, with a browser
// that closes or one that will not. corpus/detect_benchmark.cjs runs in a tree
// of its own, on a stand-in for Playwright and the HTTP server
// (corpus-command-stand-in.cjs); detect_benchmark_regressions.cjs does the same
// on real browsers, and tests/test_corpus_benchmark_cli.py for corpus/benchmark.cjs.
const COMMAND = "corpus/detect_benchmark.cjs";
const FILES = [COMMAND, "corpus/benchmark-runner.cjs", "corpus/score.cjs", "scripts/watch.cjs"];
const NOT_RUN = [{ family: "latinsquare", set: "fixture", name: "2.png" }];
// A run that has not ended after this long hangs. It takes under a second, a
// second more when a read says that its target is gone (lead() in watch.cjs),
// or the five of INTERRUPTED_CLOSE_LIMIT when a browser will not close. Nothing
// here waits for CLOSE_LIMIT, since a test file has 60 s in all on CI's Node:
// a test of it gives the stand-in shorter `limits`.
const ENDS_WITHIN = 30000;

/* How the process of `entry` ends in a tree of its own, under a `plan` for the
   stand-in: its exit code or the signal that ended it, whether the bound had
   to end it, what it printed, what happened to the stand-in's browser and
   server (`events`), the options of its launch and the report on disk.
   `scripts` are files of the test's own for that tree. */
function command(t, plan = {}, { entry = COMMAND, scripts = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-command-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inTree = name => path.join(directory, name);
  for (const file of FILES) fs.cpSync(new URL(`../../${file}`, import.meta.url), inTree(file));
  fs.cpSync(new URL("./corpus-command-stand-in.cjs", import.meta.url), inTree("node_modules/playwright/index.js"));
  for (const [name, source] of Object.entries(scripts)) fs.writeFileSync(inTree(name), source);
  fs.mkdirSync(inTree("images/latinsquare/fixture"), { recursive: true });
  const target = { puzzle: { type: "latinsquare", rows: 2, cols: 2, cells: [1, 2, 2, 1] }, corners: [[0, 0], [9, 0], [9, 9], [0, 9]] };
  for (let n = 0; n < 3; n++) {
    fs.writeFileSync(inTree(`images/latinsquare/fixture/${n}.png`), "image bytes");
    fs.writeFileSync(inTree(`images/latinsquare/fixture/${n}.json`), JSON.stringify(target));
  }
  return new Promise(resolve => execFile(process.execPath,
    ["--require", inTree("node_modules/playwright/index.js"), entry, "--corpus", "images", "--out", "report.json"],
    { cwd: directory, timeout: ENDS_WITHIN, env: { ...process.env, COMMAND_PLAN: JSON.stringify(plan) } },
    (error, stdout, stderr) => {
      const lines = fs.readFileSync(inTree("events.txt"), "utf8").trim().split(/\r?\n/), launched = line => line.startsWith("launched ");
      resolve({ code: error ? error.code ?? error.signal : 0, killed: error?.killed ?? false, stdout, stderr,
        launch: JSON.parse(lines.find(launched)?.slice("launched ".length) ?? "null"), events: lines.filter(line => !launched(line)),
        saved: JSON.parse(fs.readFileSync(inTree("report.json"))) });
    }));
}

const printed = (stream, line) => assert.ok(stream.split(/\r?\n/).includes(line), `${line} is not in\n${stream}`);
const CLOSED = ["context closed", "browser asked to close", "server killed"];

test("the default launch leaves the signals to the command: Playwright's three handlers are off", async t => {
  const { code, killed, launch, stderr, saved, events } = await command(t);
  assert.equal(killed, false, stderr); assert.equal(code, 0, stderr);
  assert.deepEqual(launch, { headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  assert.equal(saved.status, "complete"); assert.deepEqual(events, CLOSED);
});

// The read in flight keeps the interrupt as its error, as an interrupted row
// has since the first runner, and the command ends as any incomplete run does.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  test(`${signal} stops the command: the report says so, what it opened is closed, and it exits with 1`, async t => {
    const { code, killed, stderr, saved, events } = await command(t, { interrupt: signal });
    const failure = `Detection benchmark interrupted by ${signal}`;
    assert.equal(killed, false, stderr); assert.equal(code, 1, stderr);
    assert.equal(saved.status, "interrupted"); assert.equal(saved.failure, failure);
    assert.deepEqual([saved.cleanupErrors, saved.ended, saved.notRun], [[], [], NOT_RUN]);
    assert.deepEqual(saved.results.map(row => row.error ?? null), [null, failure]);
    assert.deepEqual(events, CLOSED);
    printed(stderr, failure);
  });

test("an interrupt while the server starts ends the command, with nothing left asking the server", async t => {
  const { code, killed, stderr, saved, events } = await command(t, { unanswered: "SIGINT" });
  assert.equal(killed, false, stderr); assert.equal(code, 1, stderr);
  assert.equal(saved.status, "interrupted"); assert.equal(saved.completedImages, 0); assert.equal(saved.notRun.length, 3);
  // The poll would go on for 80 attempts, past the report and for eight seconds.
  assert.ok(events.filter(line => line === "server asked").length <= 2, events.join());
  assert.deepEqual(events.filter(line => line !== "server asked"), ["server killed"]);
});

for (const [first, second, code] of [["SIGINT", "SIGINT", 130], ["SIGTERM", "SIGINT", 130], ["SIGINT", "SIGTERM", 143], ["SIGHUP", "SIGTERM", 143], ["SIGTERM", "SIGHUP", 129]])
  test(`${second} after ${first} ends the process at once, with ${code} and what listens for the exit, leaving the report saved before the clean-up`, async t => {
    const ended = await command(t, { interrupt: first, second }), failure = `Detection benchmark interrupted by ${first}`;
    assert.equal(ended.killed, false, ended.stderr); assert.equal(ended.code, code, ended.stderr);
    assert.match(ended.stdout, new RegExp(`exit handlers ran with ${code}`));
    // On Linux and macOS a server left to itself would outlive the process and keep its port.
    assert.deepEqual(ended.events, ["context closed", "server killed"], "it did not wait for the clean-up, and the server went with it");
    assert.deepEqual([ended.saved.status, ended.saved.failure, ended.saved.notRun], ["interrupted", failure, NOT_RUN]);
    assert.equal(ended.saved.completedImages, 2);
  });

for (const [how, close, failed] of [["never settles", "never", "browser cleanup timed out"], ["rejects", "reject", "the pipe broke"]])
  test(`an interrupt on a browser whose close ${how} ends the command by itself, with 1 and after the save`, async t => {
    const { code, killed, stdout, stderr, saved, events } = await command(t, { interrupt: "SIGINT", close });
    assert.equal(killed, false, `nothing else ends it, since the browser holds it: ${stderr}`);
    assert.equal(code, 1, stderr); assert.match(stdout, /exit handlers ran with 1/);
    assert.equal(saved.status, "interrupted"); assert.equal(saved.failure, "Detection benchmark interrupted by SIGINT");
    assert.deepEqual(saved.cleanupErrors, [`browser: ${failed}`]); assert.deepEqual(saved.notRun, NOT_RUN);
    assert.deepEqual(events, CLOSED, "the server is stopped all the same");
    printed(stderr, `browser: ${failed}`);
  });

for (const [how, close, failed] of [["rejects", "reject", "the pipe broke"], ["never settles", "never", "browser cleanup timed out"]])
  test(`a run that nothing interrupted ends by itself too when its browser's close ${how}: the failed close fails it`, async t => {
    const { code, killed, stdout, stderr, saved } = await command(t, { close, limits: { [CLOSE_LIMIT]: 200 } });
    assert.equal(killed, false, stderr); assert.equal(code, 1, stderr); assert.match(stdout, /exit handlers ran with 1/);
    assert.equal(saved.status, "failed"); assert.deepEqual(saved.cleanupErrors, [`browser: ${failed}`]);
    assert.equal(saved.completedImages, 3);
  });

// Longer than an interrupted run may take, and the run is complete all the same.
test("a browser that is only slow to close costs a run nothing interrupted nothing: it is complete, exit code 0, and nothing cuts it short", async t => {
  const { code, killed, stdout, stderr, saved, events } = await command(t, { close: 300, left: true, limits: { [INTERRUPTED_CLOSE_LIMIT]: 100 } });
  assert.equal(killed, false, stderr); assert.equal(code, 0, stderr);
  assert.deepEqual([saved.status, saved.cleanupErrors], ["complete", []]);
  assert.match(stdout, /what was left to do\s+exit handlers ran with 0/); assert.deepEqual(events, CLOSED);
});

test("a signal during the stuck close of a run nothing interrupted cuts the wait short, and the close fails the run", async t => {
  const limits = { [CLOSE_LIMIT]: 10 * ENDS_WITHIN, [LATE_SIGNAL_CLOSE_LIMIT]: 100 };
  const { code, killed, stdout, stderr, saved, events } = await command(t, { closing: "SIGINT", close: "never", limits });
  assert.equal(killed, false, `the signal should have ended the wait: ${stderr}`); assert.equal(code, 1, stderr);
  assert.match(stdout, /exit handlers ran with 1/); assert.deepEqual(events, CLOSED);
  assert.deepEqual([saved.status, saved.failure, saved.completedImages], ["failed", null, 3]);
  assert.deepEqual(saved.cleanupErrors, ["browser: browser cleanup timed out"]);
});

// A run that read every image has nothing to save before its clean-up, which
// decides whether it is complete, so the last checkpoint stays. The browser's
// close is stuck, as a hung browser's is: one that closes at once can end the
// clean-up before the process hears the second signal.
test("two signals during the clean-up of a run nothing interrupted end the process with its last checkpoint, which has every image", async t => {
  const plan = { second: "SIGINT", closing: "SIGTERM", close: "never", limits: { [LATE_SIGNAL_CLOSE_LIMIT]: 100 } };
  const { code, killed, stdout, stderr, saved, events } = await command(t, plan);
  assert.equal(killed, false, stderr); assert.equal(code, 143, stderr); assert.match(stdout, /exit handlers ran with 143/);
  assert.deepEqual([saved.status, saved.completedImages, saved.notRun], ["running", 3, []]); assert.deepEqual(events, CLOSED);
});

// A run that failed by itself has said so before its clean-up, as an
// interrupted run has.
test("two signals during the clean-up of a run that failed by itself end the process with what ended it, and the images it did not read", async t => {
  const plan = { crash: true, second: "SIGINT", closing: "SIGTERM", close: "never", limits: { [LATE_SIGNAL_CLOSE_LIMIT]: 100 } };
  const { code, killed, stdout, stderr, saved, events } = await command(t, plan);
  assert.equal(killed, false, stderr); assert.equal(code, 143, stderr); assert.match(stdout, /exit handlers ran with 143/);
  assert.deepEqual([saved.status, saved.completedImages, saved.notRun], ["failed", 2, NOT_RUN]);
  assert.match(saved.failure, /^page crashed [\d.]+ s after launch \(http:\/\/127\.0\.0\.1\/\)\npage\.evaluate: Target crashed$/);
  assert.deepEqual(saved.results.map(row => row.error ?? null), [null, "page.evaluate: Target crashed"]);
  assert.deepEqual(events, CLOSED);
});

for (const [run, plan, expected] of [["a complete run", {}, 0], ["an interrupted run", { interrupt: "SIGINT" }, 1]])
  test(`${run} whose browser closed is not cut short: the process ends by itself, when it has nothing left to do`, async t => {
    const { code, killed, stdout, stderr } = await command(t, { ...plan, left: true });
    assert.equal(killed, false, stderr); assert.equal(code, expected, stderr);
    assert.match(stdout, /what was left to do\s+exit handlers ran with/);
  });

// The ending the command's last lines give a save that failed: said, and then
// the process ended for its browser.
test("a final save that fails is printed, also when the process then has to be ended for its browser", async t => {
  const { code, killed, stderr, saved } = await command(t, { close: "reject", fullDisk: true });
  assert.equal(killed, false, stderr); assert.equal(code, 1, stderr);
  assert.match(stderr, /Could not save benchmark report: no space left on the disk/);
  assert.equal(saved.status, "running", "the last checkpoint is what stays");
});

test("after an interrupt that same save leaves the report saved before the clean-up", async t => {
  const { code, killed, stderr, saved } = await command(t, { interrupt: "SIGINT", close: "reject", fullDisk: true });
  assert.equal(killed, false, stderr); assert.equal(code, 1, stderr);
  assert.match(stderr, /Could not save benchmark report after: Detection benchmark interrupted by SIGINT: no space left on the disk/);
  assert.deepEqual([saved.status, saved.notRun], ["interrupted", NOT_RUN]);
});

const RUNNER = `const { main } = require(__dirname + "/${COMMAND}");
  const own = () => console.log("the runner heard it"), counts = () => ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => process.listenerCount(name)).join();
  process.on("SIGINT", own);
  main(process.argv.slice(2)).then((code) => {
    console.log("main() returned", code, "listeners", counts());
    setTimeout(() => { console.log("the runner goes on"); process.exit(7); }, 100);
  });`;

// The command's process is the runner's then: it goes on after a browser that
// would not close, and its own signal listeners are as they were.
test("a runner that calls main() keeps its process after a browser that would not close, and what it listens for", async t => {
  const { code, killed, stdout, stderr, saved } = await command(t, { interrupt: "SIGINT", close: "reject" }, { entry: "runner.cjs", scripts: { "runner.cjs": RUNNER } });
  assert.equal(killed, false, stderr); assert.equal(code, 7, stderr);
  assert.match(stdout, /the runner heard it\n[\s\S]*main\(\) returned 1 listeners 1,0,0\s+the runner goes on/);
  assert.equal(saved.status, "interrupted"); assert.deepEqual(saved.cleanupErrors, ["browser: the pipe broke"]);
});

// A second signal is main()'s own way out, whoever called it.
test("a second signal during main() ends a runner's process too", async t => {
  const { code, killed, stdout, stderr } = await command(t, { interrupt: "SIGINT", second: "SIGINT" }, { entry: "runner.cjs", scripts: { "runner.cjs": RUNNER } });
  assert.equal(killed, false, stderr); assert.equal(code, 130, stderr);
  assert.doesNotMatch(stdout, /main\(\) returned/);
});
