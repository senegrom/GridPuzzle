import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Browser } from './playwright-stand-ins.js';

// scripts/ocr_latency_regressions.cjs with stand-ins for Chromium and WebKit
// (playwright-stand-ins.js) whose pages answer the suite's five reads with a
// result made here: which engines run, what each report keeps and what the
// run throws, as the harness's engines() does for the other suites. Loading
// the suite needs no Playwright. It reads its newspaper fixtures from the
// working directory when it loads, as CI runs it from the repository root,
// so it is loaded from there whichever directory the tests run from.
const run = fromRoot(() => createRequire(import.meta.url)('../../scripts/ocr_latency_regressions.cjs'));

function fromRoot(load) {
  const cwd = process.cwd();
  process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
  try { return load(); } finally { process.chdir(cwd); }
}

// Five reads on one OCR host and geometry worker, every clue right, the
// repeated crops from the cache and a provisional reading before each result.
const clean = () => ({
  scans: Array.from({ length: 5 }, (_, read) => ({ name: read === 3 ? 'str8ts' : 'sudoku', milliseconds: 900,
    firstReading: 300, timings: {}, ocrStats: { cacheHits: read ? 4 : 0 }, wrong: [], unsafe: [], correct: 24,
    workers: { ocr: 1, geometry: 1 } })),
  counts: { ocr: 1, geometry: 1 },
});

// Playwright's chromium and webkit as stand-ins: each launch is a browser
// whose pages answer evaluate() with `answers[engine](page)` and, in the
// engines `closes` names, that closes with `closes[engine]()`.
function playwright(answers, closes = {}) {
  const launched = [];
  const engine = (name) => ({
    async launch() {
      launched.push(name);
      const browser = new Browser({ version: `${name} 1.0`, evaluate: (page) => answers[name](page) });
      if (closes[name]) browser.close = closes[name];
      return browser;
    },
  });
  return { launched, chromium: engine('chromium'), webkit: engine('webkit') };
}

// Where a test's report goes, removed after the test.
function report(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-ocr-latency-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'ocr-latency.json');
}

// The suite run with these environment variables, on a port the system
// picks, with what it prints through console.error kept and its log lines
// dropped. (An assertion's message may go on with a diff, in Node 24.)
async function suite(environment, options) {
  const saved = {}, printed = [], { log, error: print } = console;
  for (const [name, value] of Object.entries(environment)) { saved[name] = process.env[name]; process.env[name] = value; }
  console.error = (...args) => printed.push(util.format(...args));
  console.log = () => {};
  let thrown = null, returned = null;
  try { returned = await run({ port: 0, ...options }); } catch (error) { thrown = error; } finally {
    Object.assign(console, { log, error: print });
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  return { thrown, returned, printed, reports: JSON.parse(fs.readFileSync(options.out, 'utf8')) };
}

test('every engine runs after one fails, its report written after it, and the first failure is rethrown', async (t) => {
  const out = report(t);
  let onDisk = null;
  const browsers = playwright({
    async chromium() { const result = clean(); result.scans[2].unsafe = [{ cell: 4, expected: 7, actual: 1 }]; return result; },
    async webkit() { onDisk = JSON.parse(fs.readFileSync(out, 'utf8')); return clean(); },
  });
  const result = await suite({ BROWSER_ENGINES: '', OCR_BASELINE_SITE: '' }, { playwright: browsers, out });
  assert.deepEqual(browsers.launched, ['chromium', 'webkit'], 'WebKit runs after Chromium failed');
  assert.ok(result.thrown instanceof assert.AssertionError, String(result.thrown));
  assert.ok(result.thrown.message.startsWith('chromium/candidate: unflagged error'), result.thrown.message);
  const [chromium, webkit] = result.reports;
  assert.equal(chromium.ok, false);
  assert.ok(chromium.failure.startsWith('AssertionError [ERR_ASSERTION]: chromium/candidate: unflagged error'), chromium.failure);
  assert.deepEqual([chromium.errors, chromium.ended], [[], []]);
  // WebKit's report keeps its measurements as before.
  assert.equal(webkit.ok, true);
  assert.equal(webkit.version, 'webkit 1.0');
  assert.deepEqual(webkit.candidate, clean());
  assert.deepEqual([webkit.errors, webkit.ended, webkit.failure], [[], [], undefined]);
  // Chromium's report was saved before WebKit read anything, and the failure
  // was printed as it happened.
  assert.deepEqual(onDisk, [chromium]);
  assert.ok(result.printed.some((line) => line.startsWith('chromium AssertionError')), result.printed.join('\n'));
});

test('a page\'s uncaught error fails its engine, in its report: the first page\'s by its message, a later page\'s with its URL', async (t) => {
  const out = report(t), pages = {};
  // With a baseline site, each engine reads it first, then the candidate.
  const browsers = playwright({
    async chromium(page) {
      pages.chromium = [...(pages.chromium ?? []), page.url()];
      if (pages.chromium.length === 1) page.throw('thrown in the baseline');
      return clean();
    },
    async webkit(page) {
      pages.webkit = [...(pages.webkit ?? []), page.url()];
      if (pages.webkit.length === 2) page.throw('thrown in the candidate');
      return clean();
    },
  });
  const result = await suite({ BROWSER_ENGINES: '', OCR_BASELINE_SITE: '_site' }, { playwright: browsers, out });
  assert.deepEqual(browsers.launched, ['chromium', 'webkit']);
  assert.match(pages.webkit[0], /^http:\/\/127\.0\.0\.1:\d+\/baseline\/$/);
  assert.match(pages.webkit[1], /^http:\/\/127\.0\.0\.1:\d+\/candidate\/$/);
  assert.ok(result.thrown?.message.startsWith('chromium: uncaught page errors'), String(result.thrown));
  const [chromium, webkit] = result.reports;
  assert.deepEqual(chromium.errors, ['thrown in the baseline']);
  assert.deepEqual(webkit.errors, [`thrown in the candidate (${pages.webkit[1]})`]);
  for (const [engine, failed] of [['chromium', chromium], ['webkit', webkit]]) {
    assert.equal(failed.ok, false, engine);
    assert.ok(failed.failure.startsWith(`AssertionError [ERR_ASSERTION]: ${engine}: uncaught page errors`), failed.failure);
    // What it measured stays in the report.
    assert.deepEqual([failed.baseline, failed.candidate], [clean(), clean()], engine);
  }
});

test('a browser that will not close fails its engine, its report written with what it measured, and the next engine runs', async (t) => {
  const out = report(t);
  let onDisk = null;
  const browsers = playwright({
    async chromium() { return clean(); },
    async webkit() { onDisk = JSON.parse(fs.readFileSync(out, 'utf8')); return clean(); },
  }, { async chromium() { throw new Error('the pipe broke'); } });
  const result = await suite({ BROWSER_ENGINES: '', OCR_BASELINE_SITE: '' }, { playwright: browsers, out });
  assert.deepEqual(browsers.launched, ['chromium', 'webkit']);
  assert.equal(result.thrown?.message, 'chromium: browser: the pipe broke');
  const [chromium, webkit] = result.reports;
  assert.equal(chromium.ok, false);
  assert.deepEqual(chromium.cleanupErrors, ['browser: the pipe broke']);
  assert.ok(chromium.failure.startsWith('Error: chromium: browser: the pipe broke'), chromium.failure);
  assert.deepEqual(chromium.candidate, clean());
  assert.deepEqual(onDisk, [chromium], 'saved before WebKit read anything');
  assert.deepEqual([webkit.ok, webkit.cleanupErrors], [true, []]);
  assert.ok(result.printed.includes('chromium: browser: the pipe broke'), result.printed.join('\n'));
});

test('a failing engine keeps its own failure first when its browser will not close either', async (t) => {
  const out = report(t);
  const browsers = playwright({
    async chromium() { const result = clean(); result.scans[2].unsafe = [{ cell: 4, expected: 7, actual: 1 }]; return result; },
    async webkit() { return clean(); },
  }, { async chromium() { throw new Error('the pipe broke'); } });
  const result = await suite({ BROWSER_ENGINES: '', OCR_BASELINE_SITE: '' }, { playwright: browsers, out });
  assert.ok(result.thrown?.message.startsWith('chromium/candidate: unflagged error'), String(result.thrown));
  const [chromium] = result.reports;
  assert.ok(chromium.failure.startsWith('AssertionError [ERR_ASSERTION]: chromium/candidate: unflagged error'), chromium.failure);
  assert.deepEqual(chromium.cleanupErrors, ['browser: the pipe broke']);
});

test('BROWSER_ENGINES selects the engines, as for the harness\'s suites', async (t) => {
  const out = report(t), browsers = playwright({ chromium: async () => clean(), webkit: async () => clean() });
  const result = await suite({ BROWSER_ENGINES: 'webkit', OCR_BASELINE_SITE: '' }, { playwright: browsers, out });
  assert.equal(result.thrown, null);
  assert.deepEqual(browsers.launched, ['webkit']);
  assert.deepEqual(result.reports.map(({ browser, ok }) => [browser, ok]), [['webkit', true]]);
  assert.deepEqual(result.returned, result.reports);
});
