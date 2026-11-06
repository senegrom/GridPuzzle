import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// The harness's engines() on a stand-in suite whose steps pass and which
// leaves on the engine's report the reads of its page that its finally cut
// short or saw fail (readsCutShort and readsFailed, as watch.cjs's
// readWithin() spells them, which the suites put there): such an engine
// fails, in engines()' finally, beside the browser's close, with the reads
// named and no failure screenshot; its report is written, its browser
// closed, the next engine run and the first failure thrown again at the end.
// A browser lost after the reads failed leads their failure once its news
// has come, if that is within a second. A suite's own failure, an uncaught
// page error, a page lost, and the browser lost when its news comes before
// the reads fail, still fail the engine first, asking for their screenshot,
// as before; a close that fails too stays in cleanupErrors, after the
// reads' failure.
// The suite runs as the suites do, through main(), in a process of its own,
// on a stand-in for Playwright; loading the harness needs neither
// Playwright nor Python.
const require = createRequire(import.meta.url);
const { CLOSE_LIMIT, READ_LIMIT } = require('../../scripts/watch.cjs');

// How a process ends that runs `args`: its exit code, whether the bound had
// to end it, and what it printed. These runs take a second or so; the bound
// allows for a host short of memory.
const finish = (args, options) => new Promise((resolve) => execFile(process.execPath, args, { timeout: 45000, ...options },
  (error, stdout, stderr) => resolve({ code: error ? error.code ?? error.signal : 0, killed: error?.killed ?? false, stdout, stderr })));

// What the run loads first: timers of CLOSE_LIMIT's length, which the
// browser's close sets, last a tenth of a second and are counted, the count
// printed as the process exits, so that a close given any other limit, or a
// read given one, fails on the count.
const PRELOAD = `const { setTimeout: later } = globalThis, limits = { ${READ_LIMIT}: 0, ${CLOSE_LIMIT}: 0 };
globalThis.setTimeout = (run, ms, ...args) => { if (Object.hasOwn(limits, ms)) { limits[ms]++; ms = 100; } return later(run, ms, ...args); };
process.on("exit", () => console.log("limits", JSON.stringify(limits)));
`;

// A suite on engines(), run through main() as the suites are, which loads
// the harness at `harness`, a path the test makes: in each engine, as PLAN
// says for it, its page throws an uncaught error, crashes or loses its
// browser (`event`), and its steps pass or throw (`throws`); then its finally
// puts on the engine's report the reads it cut short or saw fail, as
// live_noise's does, when PLAN names any.
const SUITE = (harness) => `const { engines, main } = require(${JSON.stringify(harness)});
const plans = JSON.parse(process.env.PLAN);
main(module, () => engines("stand-in.json", async (page, report, name) => {
  const plan = plans[name] ?? {};
  report.checks = ["the steps"];
  try {
    if (plan.event) await page.evaluate(plan.event);
    if (plan.throws) throw new Error(plan.throws);
  } finally {
    if (plan.readsCutShort) report.readsCutShort = plan.readsCutShort;
    if (plan.readsFailed) report.readsFailed = plan.readsFailed;
  }
}));
`;

// Playwright for that suite, with the events Playwright's objects have,
// which watch() listens to: the page's evaluate("pageerror") makes it throw
// an uncaught error, evaluate("crash") crashes it, evaluate("lose") makes the
// browser disconnect 30 ms later, as a browser that goes away can be
// reported after the calls it interrupted fail, evaluate("lose late") 1.5 s
// later, after the second that the harness waits for that news, and
// evaluate("disconnect") makes it disconnect at once, as one can be reported
// before them. The page
// says on stdout when it takes a screenshot, which it writes, and the
// browser when it is asked to close; with `close` "hangs" in PLAN its close
// never settles, as while a WebKit child holds the browser's pipes, and with
// "rejects" it rejects. Each launch keeps the process alive until its
// browser closes, as a live browser's pipes do.
const PLAYWRIGHT = `const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const plans = JSON.parse(process.env.PLAN);
const engine = (name) => ({ async launch() {
  const plan = plans[name] ?? {}, say = (line) => console.log(name + " " + line);
  const pipes = setInterval(() => {}, 1000);
  let connected = true;
  const browser = new EventEmitter(), context = new EventEmitter(), page = new EventEmitter();
  Object.assign(page, { url: () => "http://stand-in/", context: () => context, setDefaultTimeout() {}, close: async () => {},
    evaluate: async (what) => {
      if (what === "pageerror") page.emit("pageerror", new Error("stand-in: an uncaught page error"));
      if (what === "crash") page.emit("crash", page);
      const disconnect = () => { connected = false; browser.emit("disconnected", browser); };
      if (what === "lose") setTimeout(disconnect, 30);
      if (what === "lose late") setTimeout(disconnect, 1500);
      if (what === "disconnect") disconnect();
    },
    screenshot: async ({ path }) => { say("takes a screenshot"); fs.writeFileSync(path, ""); } });
  Object.assign(context, { pages: () => [], close: async () => {},
    newPage: async () => { context.emit("page", page); return page; } });
  Object.assign(browser, { contexts: () => [], isConnected: () => connected, version: () => "1.0",
    newContext: async () => { browser.emit("context", context); return context; },
    close: async () => {
      say("closes its browser");
      if (plan.close === "hangs") return new Promise(() => {});
      if (plan.close === "rejects") throw new Error("stand-in: the close failed");
      clearInterval(pipes);
    } });
  return browser;
} });
module.exports = { chromium: engine("chromium"), webkit: engine("webkit") };
`;

// How the suite ends, run with PLAN in a tree of its own with the harness
// and watch.cjs as they are, which is its working and temporary directory:
// what it printed, by line too, the count of its close limits' timers, both
// engines' reports, and whether an engine's failure screenshot was written.
async function ran(t, plan) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-engines-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inTree = (name) => path.join(directory, name);
  for (const name of ['scripts/harness.cjs', 'scripts/watch.cjs'])
    fs.cpSync(new URL(`../../${name}`, import.meta.url), inTree(name));
  fs.writeFileSync(inTree('scripts/stand_in_regressions.cjs'), SUITE(inTree('scripts/harness.cjs')));
  fs.mkdirSync(inTree('node_modules/playwright'), { recursive: true });
  fs.writeFileSync(inTree('node_modules/playwright/index.js'), PLAYWRIGHT);
  fs.writeFileSync(inTree('preload.cjs'), PRELOAD);
  const ended = await finish(['-r', inTree('preload.cjs'), inTree('scripts/stand_in_regressions.cjs')], { cwd: directory,
    env: { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory, BROWSER_ENGINES: '', PLAN: JSON.stringify(plan) } });
  const lines = ended.stdout.trim().split(/\r?\n/), limits = /^limits (.+)$/.exec(lines.at(-1));
  const file = inTree('browser-artifacts/stand-in.json');
  const reports = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return { ...ended, lines, limits: limits && JSON.parse(limits[1]), reports,
    shot: (engine) => fs.existsSync(inTree(`browser-artifacts/${engine}-stand-in-failure.png`)) };
}

// What the stand-in says that `engine`'s page and browser did, in order (not
// the version engines() prints as it launches the browser).
const said = (lines, engine) => lines.filter((line) => line.startsWith(`${engine} `) && !/^\w+ \d/.test(line))
  .map((line) => line.slice(engine.length + 1));
// An engine's report as the rows look at it: its status, the first line of
// its failure after any that says what ended (its seconds since launch as
// N), its cleanupErrors, what the suite measured and the reads it named,
// each only when the report has it.
const head = (failure) => {
  if (failure === undefined) return undefined;
  const lines = failure.split('\n'), first = lines.findIndex((line) => !/ s after launch( \(.+\))?$/.test(line));
  return lines.slice(0, first + 1).join('\n').replace(/ \d+(\.\d+)? s after launch/g, ' N s after launch');
};
const seen = ({ status, failure, cleanupErrors, checks, readsCutShort, readsFailed }) => Object.fromEntries(Object.entries(
  { status, failure: head(failure), cleanupErrors, checks, readsCutShort, readsFailed }).filter(([, value]) => value !== undefined));
// What the run ends with: main() prints it last, with no engine's name
// before it.
const endedWith = (stderr) => [...stderr.matchAll(/^(?:Error|AssertionError).*$/gm)].at(-1)?.[0];
const CUT = 'closed: no answer within 19.9 s', FAILED = 'stop: page.evaluate: Error: stand-in: the stop threw';
const PASSED = { status: 'passed', cleanupErrors: [], checks: ['the steps'] };
const UNCLOSED = 'browser: browser cleanup timed out';

// Side by side: each has a tree and a process of its own, and in Node 22
// --test-timeout limits a whole file.
describe('engines() fails an engine that passed when its suite\'s finally cut reads short or saw them fail', { concurrency: true }, () => {
  for (const [what, reads, failure] of [
    ['cut a read short', { readsCutShort: [CUT] }, `Error: chromium: ${CUT}`],
    ['saw a read fail', { readsFailed: [FAILED] }, `Error: chromium: ${FAILED}`],
    // Those cut short first, then those that failed, each list in its order.
    ['cut reads short and saw others fail', { readsCutShort: [CUT, 'other: no answer within 19.9 s'], readsFailed: [FAILED, 'final: closed'] },
      `Error: chromium: ${CUT}; other: no answer within 19.9 s; ${FAILED}; final: closed`],
  ])
    test(`a suite whose steps passed and whose finally ${what}: that engine fails with them, with no screenshot, its report written and its browser closed, and the next engine runs and passes`, async (t) => {
      const { code, killed, stdout, stderr, lines, limits, reports, shot } = await ran(t, { chromium: reads, webkit: { readsCutShort: [], readsFailed: [] } });
      assert.deepEqual({ killed, code }, { killed: false, code: 1 }, `it ended by itself, failing: ${stdout}${stderr}`);
      // Each browser closed, with one limit for each close, and no screenshot
      // taken or written; lists that name nothing keep the pass.
      assert.deepEqual({ reports: reports.map(seen), said: [said(lines, 'chromium'), said(lines, 'webkit')],
        shots: [shot('chromium'), shot('webkit')], limits },
      { reports: [{ ...PASSED, status: 'failed', failure, ...reads }, { ...PASSED, readsCutShort: [], readsFailed: [] }],
        said: [['closes its browser'], ['closes its browser']], shots: [false, false], limits: { [READ_LIMIT]: 0, [CLOSE_LIMIT]: 2 } });
      assert.ok(stderr.includes(`chromium ${failure}\n`), `the failure printed after the engine's name: ${stderr}`);
      assert.equal(endedWith(stderr), failure, `the run ends with that failure: ${stderr}`);
    });

  test('when both engines fail so, each is printed, and the run ends with the first engine\'s failure', async (t) => {
    const { code, killed, stdout, stderr, reports, shot } = await ran(t, { chromium: { readsFailed: [FAILED] }, webkit: { readsCutShort: [CUT] } });
    assert.deepEqual({ killed, code }, { killed: false, code: 1 }, `it ended by itself, failing: ${stdout}${stderr}`);
    assert.deepEqual({ reports: reports.map(({ status, failure }) => [status, head(failure)]), shots: [shot('chromium'), shot('webkit')] },
      { reports: [['failed', `Error: chromium: ${FAILED}`], ['failed', `Error: webkit: ${CUT}`]], shots: [false, false] });
    assert.ok(stderr.includes(`chromium Error: chromium: ${FAILED}\n`) && stderr.includes(`webkit Error: webkit: ${CUT}\n`), stderr);
    assert.equal(endedWith(stderr), `Error: chromium: ${FAILED}`, stderr);
  });

  // The reads' failure comes first in time, and the report keeps it; the
  // close's failure is printed after it and kept in cleanupErrors, and the
  // run still ends, once its reports are written, through exitIfUnclosed().
  for (const [how, cleanupError] of [['hangs', UNCLOSED], ['rejects', 'browser: stand-in: the close failed']])
    test(`with a close that ${how === 'hangs' ? 'never settles' : 'rejects'} too, the report keeps the reads' failure, the close's stays in cleanupErrors and is printed after it`, async (t) => {
      const { code, killed, stdout, stderr, lines, reports, shot } = await ran(t, { chromium: { readsCutShort: [CUT], close: how }, webkit: {} });
      const failure = `Error: chromium: ${CUT}`;
      assert.deepEqual({ killed, code, reports: reports.map(seen), said: [said(lines, 'chromium'), said(lines, 'webkit')], shot: shot('chromium') },
        { killed: false, code: 1, reports: [{ ...PASSED, status: 'failed', failure, cleanupErrors: [cleanupError], readsCutShort: [CUT] }, PASSED],
          said: [['closes its browser'], ['closes its browser']], shot: false }, `${stdout}${stderr}`);
      const printed = stderr.indexOf(`chromium ${failure}\n`), closed = stderr.indexOf(`chromium: ${cleanupError}`);
      assert.ok(printed >= 0 && closed > printed, `the reads' failure printed, then the close's: ${stderr}`);
      assert.equal(endedWith(stderr), failure, stderr);
    });

  // A read on a browser that has gone can fail before Playwright reports
  // what ended, so that the try's check has found nothing: the failure waits
  // for that news, as the catch's does for a failure that says its target is
  // gone, and what ended leads it. (When the news comes first, the try fails
  // the engine: see below.)
  test('a read that failed as its browser went away fails the engine once the news has come, led by what ended', async (t) => {
    const gone = 'closed: page.evaluate: Target page, context or browser has been closed';
    const { code, killed, stdout, stderr, lines, reports, shot } = await ran(t, { chromium: { event: 'lose', readsFailed: [gone] }, webkit: {} });
    const [chromium, webkit] = reports;
    assert.deepEqual({ killed, code, ended: chromium.ended.map(({ event }) => event), chromium: seen(chromium), webkit: seen(webkit),
      said: said(lines, 'chromium'), shot: shot('chromium') },
    { killed: false, code: 1, ended: ['browser disconnected'],
      chromium: { ...PASSED, status: 'failed', failure: `browser disconnected N s after launch\nError: chromium: ${gone}`, readsFailed: [gone] },
      webkit: PASSED, said: ['closes its browser'], shot: false }, `${stdout}${stderr}`);
    assert.match(stderr, /^chromium browser disconnected [\d.]+ s after launch\nError: chromium: closed: page\.evaluate: Target page/m, stderr);
  });

  // That wait lasts a second at most, as the catch's does: news that comes
  // later leads nothing, and the browser's close, asked for once the wait
  // has run out, keeps it out of the report's ended. The stand-in's 1.5 s
  // start as the steps run and the harness's second just after them, with
  // no turn of the event loop between, and Node runs the timers that are due
  // in the order they fall due: so the second ends first however late the
  // timers wake.
  test('a read that failed as its browser went away fails the engine with its own error alone when the news comes more than a second later', async (t) => {
    const gone = 'closed: page.evaluate: Target page, context or browser has been closed';
    const { code, killed, stdout, stderr, lines, reports, shot } = await ran(t, { chromium: { event: 'lose late', readsFailed: [gone] }, webkit: {} });
    const [chromium, webkit] = reports;
    assert.deepEqual({ killed, code, ended: chromium.ended.map(({ event }) => event), chromium: seen(chromium), webkit: seen(webkit),
      said: said(lines, 'chromium'), shot: shot('chromium') },
    { killed: false, code: 1, ended: [],
      chromium: { ...PASSED, status: 'failed', failure: `Error: chromium: ${gone}`, readsFailed: [gone] },
      webkit: PASSED, said: ['closes its browser'], shot: false }, `${stdout}${stderr}`);
    assert.match(stderr, /^chromium Error: chromium: closed: page\.evaluate: Target page/m, stderr);
    assert.ok(!stderr.includes('browser disconnected'), `nothing led the failure: ${stderr}`);
  });
});

// What fails an engine first stays first, as before the reads' failure came
// to engines(): the suite's own failure, an uncaught page error, a page lost
// and a browser lost whose news came before the reads failed, each found in
// the try, which asks for the failure screenshot (the stand-in's page takes
// it; a real page that has gone gives none), while the report still names
// the reads. The engine has failed then, and the reads change nothing more.
// These rows check what has not changed, so that they pass on the harness as
// it was too.
describe('engines() keeps first a suite\'s own failure, a page error, a page lost and a browser lost whose news comes before the reads fail, as before', { concurrency: true }, () => {
  const reads = { readsCutShort: [CUT], readsFailed: [FAILED] };
  const lost = 'AssertionError [ERR_ASSERTION]: chromium: a page crashed or closed, or the browser disconnected';
  for (const [what, plan, failure] of [
    ['steps failed', { throws: 'expected 3 clues' }, 'Error: expected 3 clues'],
    ['page threw an uncaught error', { event: 'pageerror' }, 'AssertionError [ERR_ASSERTION]: chromium: uncaught page errors'],
    ['page crashed', { event: 'crash' }, `page crashed N s after launch (http://stand-in/)\n${lost}`],
    ['browser disconnected', { event: 'disconnect' }, `browser disconnected N s after launch\n${lost}`],
  ])
    test(`an engine whose ${what} fails with that, with its screenshot, whatever its finally cut short or saw fail`, async (t) => {
      const { code, killed, stdout, stderr, lines, reports, shot } = await ran(t, { chromium: { ...plan, ...reads }, webkit: {} });
      assert.deepEqual({ killed, code, reports: reports.map(seen), said: [said(lines, 'chromium'), said(lines, 'webkit')], shot: shot('chromium') },
        { killed: false, code: 1, reports: [{ ...PASSED, status: 'failed', failure, ...reads }, PASSED],
          said: [['takes a screenshot', 'closes its browser'], ['closes its browser']], shot: true }, `${stdout}${stderr}`);
      assert.ok(!stderr.includes(CUT) && !stderr.includes(FAILED), `the reads are the report's, not stderr's: ${stderr}`);
      assert.equal(endedWith(stderr), failure.split('\n').at(-1), stderr);
    });
});
