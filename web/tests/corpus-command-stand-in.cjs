/* Playwright and the HTTP server for a corpus command run in a process of its
   own, for the tests of how such a process ends: corpus-command.test.js and,
   for corpus/benchmark.cjs, which stays out of the deployment's inputs,
   tests/test_corpus_benchmark_cli.py. A tree of the test's own holds this file
   as node_modules/playwright/index.js, and the command starts with --require
   on it, so that it is in place before the runner takes spawn. No browser, no
   Python and no fixed port: `python` starts nothing, and every request answers.

   COMMAND_PLAN, a JSON object, says what happens:
     unanswered  a signal raised as the HTTP server is first asked, which
                 never answers, with each attempt noted in events.txt
     interrupt   a signal raised during the second image's read, which never
                 answers then
     crash       the page crashes during the second image's read, as
                 Chromium's does, and the read fails with "Target crashed":
                 the run fails by itself
     second      a signal raised as the context closes, which never settles
     close       the browser's close "never" settles, it "reject"s, or it takes
                 that many milliseconds
     closing     a signal raised as the browser is asked to close
     fullDisk    every save fails once the browser is asked to close
     left        a line printed a moment after the browser closed, which a
                 process that exits at once does not get to print
     limits      what a timer of the run takes instead, by what it asks for:
                 a test cannot wait for CLOSE_LIMIT, which is half of the 60 s
                 a test file has in all on CI's Node

   A browser keeps the process alive until it has closed, as its pipes do.
   events.txt, in the working directory, lists what was launched and closed,
   and the last thing printed says that what listens for the exit ran. */
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");

const plan = JSON.parse(process.env.COMMAND_PLAN || "{}");
if (plan.limits) {
  const { setTimeout: later } = globalThis;
  globalThis.setTimeout = (run, ms, ...args) => later(run, plan.limits[ms] ?? ms, ...args);
}
const note = (line) => fs.appendFileSync("events.txt", `${line}\n`);
// A real signal where there are real signals. On Windows process.kill() just
// ends the process, so what listens for the signal is called directly, and a
// moment later: Node hears a real signal only once the code that is running
// has run on, promises included, so a close that resolves at once can finish
// the clean-up before the signal is heard. No test relies on that moment now,
// since where a signal could come after the clean-up the close never settles;
// without it a test can pass here and fail on Linux, as one did.
const raise = (name) => (process.platform === "win32" ? setImmediate(() => process.emit(name, name)) : process.kill(process.pid, name));
process.on("exit", (code) => console.log("exit handlers ran with", code));

const { spawn } = childProcess;
childProcess.spawn = (command, ...rest) => (command !== "python" ? spawn(command, ...rest)
  : Object.assign(new EventEmitter(), { kill() { note("server killed"); return true; } }));
let asked = 0;
globalThis.fetch = async () => {
  if (!plan.unanswered) return { ok: true };
  note("server asked");
  if (++asked === 1) setImmediate(raise, plan.unanswered);
  throw new Error("connection refused");
};

// What the page answers for the two reads of a two-by-two square: detect_benchmark's,
// and the photo flow's three calls.
const found = { ms: 12, confidence: 0.94, rows: 2, cols: 2, error: 1, sizeOk: true };
const answers = {
  detectOne: { 640: found, 1600: found },
  loadPhoto: { width: 10, height: 10, natural: { width: 10, height: 10 } },
  detectGrid: { detected: 1, detection: { confidence: 0.94, rows: 2, cols: 2, corners: [[0, 0], [9, 0], [9, 9], [0, 9]].map(([x, y]) => ({ x, y })) } },
  readGrid: { ms: 1, detail: false, detailNote: null, ocr: 1, cellUncertain: [], cageUncertain: [], blackReadings: [],
    read: { cells: [1, 2, 2, 1], cages: [], clues: [], inequalities: [], black: [] } },
};

function launched() {
  const pipes = setInterval(() => {}, 1000);
  let connected = true, reads = 0;
  const page = Object.assign(new EventEmitter(), {
    setDefaultTimeout() {}, async goto() {}, async waitForSelector() {}, async close() {},
    isClosed: () => false, url: () => "http://127.0.0.1/", context: () => context,
    async evaluate(fn) {
      if (fn.name === "detectOne" || fn.name === "loadPhoto") reads++;
      if (reads === 2 && plan.interrupt) { setImmediate(raise, plan.interrupt); return new Promise(() => {}); }
      if (reads === 2 && plan.crash) { page.emit("crash", page); throw new Error("page.evaluate: Target crashed"); }
      return answers[fn.name];
    },
  });
  const context = Object.assign(new EventEmitter(), {
    pages: () => [], async newPage() { this.emit("page", page); return page; },
    async close() {
      note("context closed");
      if (plan.second) { raise(plan.second); return new Promise(() => {}); }
    },
  });
  return Object.assign(new EventEmitter(), {
    contexts: () => [], async newContext() { this.emit("context", context); return context; }, isConnected: () => connected,
    async close() {
      note("browser asked to close");
      if (plan.closing) raise(plan.closing);
      if (plan.fullDisk) fs.renameSync = () => { throw Object.assign(new Error("no space left on the disk"), { code: "ENOSPC" }); };
      if (plan.close === "never") return new Promise(() => {});
      if (plan.close === "reject") throw new Error("the pipe broke");
      if (plan.close) await new Promise((resolve) => setTimeout(resolve, plan.close));
      connected = false;
      clearInterval(pipes);
      if (plan.left) setTimeout(() => console.log("what was left to do"), 100);
    },
  });
}

module.exports = { chromium: { async launch(options) { note(`launched ${JSON.stringify(options)}`); return launched(); } } };
