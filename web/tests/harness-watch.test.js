import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Browser } from './playwright-stand-ins.js';

// What ends a suite's pages and what they throw, as the harness records it;
// loading it needs no Playwright. The stand-ins emit what Playwright's
// objects emit (playwright-stand-ins.js).
const { watch } = createRequire(import.meta.url)('../../scripts/harness.cjs');
const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const events = (watched) => watched.ended.map(({ event, url }) => (url ? [event, url] : [event]));
const said = (watched) => watched.ended
  .map(({ event, seconds, url }) => `${event} ${seconds} s after launch${url ? ` (${url})` : ''}`).join('; ');
const CLOSED = 'page.waitForFunction: Target page, context or browser has been closed';
// Whether a lead() settles before any timer can fire: led without a wait.
const WAITED = Symbol('waited');
const atOnce = async (led) => (await Promise.race([led, new Promise((resolve) => setImmediate(resolve, WAITED))])) !== WAITED;

test('a crash is recorded with its page and time, fails the check and leads the failure', async () => {
  const browser = new Browser(), watched = watch(browser, { grace: 10 });
  const page = await (await browser.newContext()).newPage('http://127.0.0.1:8000/GridPuzzle/');
  page.crash();
  assert.deepEqual(events(watched), [['page crashed', 'http://127.0.0.1:8000/GridPuzzle/']]);
  const [{ seconds }] = watched.ended;
  assert.ok(seconds >= 0 && seconds < 5 && seconds === Math.round(seconds * 10) / 10, String(seconds));
  assert.throws(() => watched.check('webkit'), /^AssertionError \[ERR_ASSERTION\]: webkit: a page crashed or closed, or the browser disconnected/m);
  const error = new Error(CLOSED), stack = error.stack;
  assert.equal(await watched.lead(error), error, 'the failure itself, led');
  const line = `page crashed ${seconds} s after launch (http://127.0.0.1:8000/GridPuzzle/)`;
  assert.equal(said(watched), line);
  assert.equal(error.message, `${line}\n${CLOSED}`);
  assert.equal(error.stack, `${line}\n${stack}`, 'the frames of the call that failed stay');
});

test('what the suite or its owner closes is no news, and contexts and pages opened later are watched', async () => {
  const browser = new Browser(), watched = watch(browser, { grace: 10 });
  const context = await browser.newContext();
  const page = await context.newPage('http://a/'), other = await context.newPage('http://b/');
  await other.close();
  const second = await browser.newContext();
  await second.newPage('http://c/');
  await second.close();
  assert.deepEqual(watched.ended, []);
  watched.check('chromium');
  const failure = new Error('expected 3 clues');
  assert.equal((await watched.lead(failure)).message, 'expected 3 clues', 'nothing ended, nothing leads');
  // A page opened after the closes, and a context with it, are watched too.
  (await context.newPage('http://d/')).crash();
  await (await (await browser.newContext()).newPage('http://e/')).context().end();
  assert.deepEqual(events(watched), [['page crashed', 'http://d/'], ['page closed', 'http://e/'], ['context closed']]);
  // The owner's own close ends the record, late events included.
  await browser.close();
  page.crash();
  assert.equal(watched.ended.length, 3);
});

test('a lost browser: its pages\' and contexts\' closes and the disconnection, waited for and led in order', async () => {
  const browser = new Browser(), watched = watch(browser, { grace: 10000 });
  await (await browser.newContext()).newPage('http://a/');
  await (await browser.newContext()).newPage('http://b/');
  // WebKit fails the interrupted call before it reports the loss.
  const error = new Error(CLOSED);
  setTimeout(() => browser.lose(), 30);
  const started = Date.now();
  await watched.lead(error);
  assert.ok(Date.now() - started < 5000, 'the disconnection ends the wait');
  assert.deepEqual(events(watched), [['page closed', 'http://a/'], ['context closed'], ['page closed', 'http://b/'],
    ['context closed'], ['browser disconnected']]);
  assert.equal(error.message, `${said(watched)}\n${CLOSED}`);
  assert.match(error.message, /^page closed [\d.]+ s after launch \(http:\/\/a\/\); context closed [\d.]+ s after launch; /);
  assert.throws(() => watched.check('chromium'), /chromium: a page crashed or closed, or the browser disconnected/);
  // With the browser gone there is no news left to wait for.
  assert.ok(await atOnce(watched.lead(new Error(CLOSED))), 'led at once after the disconnection');
});

test('only a failure that says its target is gone waits for news, at most its grace; one that is no Error is led too', async () => {
  const browser = new Browser(), watched = watch(browser, { grace: 50 });
  const page = await (await browser.newContext()).newPage('http://a/');
  // Any other failure is led at once, so that the screenshot and what a
  // suite captures after it show the page as the failure left it.
  for (const failure of [new Error('page.waitForFunction: Timeout 20000ms exceeded.'), new Error('expected 3 clues'),
    'a string was thrown'])
    assert.ok(await atOnce(watched.lead(failure)), `${failure}: led at once`);
  // Playwright's word that the target is gone: a lost browser's (with its
  // logs or without), a crashed page's in either engine, a call's on a page
  // as it crashes. The browser stays connected, so each waits its grace.
  for (const message of [CLOSED, `${CLOSED}\nBrowser logs:\n\n<launching> playwright`, 'page.waitForFunction: Target crashed ',
    'page.goto: Page crashed']) {
    const started = Date.now(), led = watched.lead(new Error(message));
    assert.equal(await atOnce(led), false, `${message}: waits`);
    assert.equal((await led).message, message, 'nothing ended, nothing leads');
    const waited = Date.now() - started;
    assert.ok(waited >= 40 && waited < 5000, `${message}: waited ${waited} ms for a grace of 50`);
  }
  // A suite that carried on past a crash fails its check, at once too.
  page.crash();
  const carriedOn = (() => { try { watched.check('webkit'); } catch (error) { return error; } })();
  const led = watched.lead(carriedOn);
  assert.ok(await atOnce(led), 'the check\'s failure is led at once');
  assert.ok((await led).message.startsWith(`${said(watched)}\nwebkit: a page crashed or closed, or the browser disconnected`));
  const string = await watched.lead('a string was thrown');
  assert.ok(string instanceof Error);
  assert.equal(string.message, `${said(watched)}\na string was thrown`);
});

test('every page\'s uncaught errors are collected, the first page\'s by their message and any other page\'s with its URL', async () => {
  const browser = new Browser(), watched = watch(browser, { grace: 10 });
  const context = await browser.newContext();
  const page = await context.newPage('http://a/'), tab = await context.newPage('http://a/?tab');
  const other = await (await browser.newContext()).newPage('http://b/');
  page.throw('thrown in the page');
  tab.throw('thrown in the tab');
  other.throw('thrown in the other context');
  await tab.goto('http://a/next');
  tab.throw('thrown after a navigation');
  page.throw('thrown in the page again');
  assert.deepEqual(watched.errors, ['thrown in the page', 'thrown in the tab (http://a/?tab)',
    'thrown in the other context (http://b/)', 'thrown after a navigation (http://a/next)', 'thrown in the page again']);
  // A page that throws has not ended: the check passes, and nothing leads.
  assert.deepEqual(watched.ended, []);
  watched.check('webkit');
  // The owner's own close ends the record, late errors included.
  await browser.close();
  page.throw('thrown as the browser closes');
  assert.equal(watched.errors.length, 5);
});

test('the pages a browser has when it is watched are watched too, the first of them as the first page', async () => {
  const browser = new Browser(), context = await browser.newContext();
  const first = await context.newPage('http://a/'), second = await context.newPage('http://a/?second');
  const watched = watch(browser, { grace: 10 });
  second.throw('thrown in the second page');
  first.throw('thrown in the first page');
  assert.deepEqual(watched.errors, ['thrown in the second page (http://a/?second)', 'thrown in the first page']);
});

test('every script that launches a browser watches it, checks it, leads its failures, closes it with a limit and reports what ended, what its pages threw and a close that failed', () => {
  const scripts = fs.readdirSync(new URL('../../scripts/', import.meta.url)).filter((file) => file.endsWith('.cjs'));
  const launching = scripts.filter((file) => /\.launch\(/.test(read(`scripts/${file}`)));
  assert.ok(launching.length >= 5, launching.join());
  const reporting = [];
  for (const file of launching) {
    const source = read(`scripts/${file}`);
    const browsers = [...source.matchAll(/(\w+) = await [\w.[\]]+\.launch\(/g)].map(([, browser]) => browser);
    assert.equal(browsers.length, source.match(/\.launch\(/g).length, `${file}: every browser it launches is named`);
    for (const browser of browsers) {
      assert.ok(source.includes(`watch(${browser}`), `${file} watches ${browser}`);
      assert.doesNotMatch(source, new RegExp(`\\b${browser}\\??\\.close\\(`), `${file} leaves closing ${browser} to watch(), which cannot wait for ever`);
    }
    assert.match(source, /await \w+\.close\((?:name|engineName)\)/, `${file} closes its browser through watch()`);
    assert.match(source, /\.check\((?:name|engineName)\)/, `${file} fails when a page ended`);
    assert.match(source, /assert\.deepEqual\([\w?.]*errors\b/, `${file} fails on its pages' uncaught errors`);
    assert.match(source, /await \w+\.lead\(/, `${file} leads its failures`);
    // A context or page that will not open fails an engine like anything else:
    // opened before its try, it leaves the browser up to hold the run for ever.
    // Inside it, the call sits deeper than the line that launches the browser.
    for (const browser of browsers)
      assert.doesNotMatch(source, new RegExp(`^( *)(?:\\S.*)?\\b${browser} = await [\\w.[\\]]+\\.launch\\([^]*?^\\1\\S.*\\.newContext\\(`, 'm'), `${file} opens ${browser}'s contexts inside its try`);
    // A report that names a watched browser's version keeps what ended in it,
    // what its pages threw and a close that failed. Right after that close such
    // a script fails the engine, saying why; then writes the report in the
    // close's own block, so that a hang in the next engine cannot lose it or
    // leave it saying the engine passed; and only then ends its process through
    // exitIfUnclosed.
    for (const [, watched, browser] of source.matchAll(/(\w+) = watch\((\w+)[,)]/g))
      if (source.includes(`version: ${browser}.version()`)) {
        assert.ok(source.includes(`ended: ${watched}.ended`), `${file} keeps ${browser}'s ended in its report`);
        assert.match(source, new RegExp(`errors(?::| =) ${watched}\\.errors\\b`), `${file} keeps ${browser}'s page errors in its report`);
        assert.ok(source.includes(`cleanupErrors: ${watched}.cleanupErrors`), `${file} keeps ${browser}'s failed close in its report`);
        assert.match(source, /\bunclosed && report\.(?:ok|status === "passed")\) \{\s*report\.(?:ok = false|status = "failed");\s*report\.failure = unclosed\.stack;/, `${file} fails an engine that passed when its browser would not close, and says why`);
        assert.match(source, /^( *)const unclosed = await \w+\.close\(name\);\r?\n\1if \(unclosed && .*(?:\r?\n\1.*)*?\r?\n\1(?:fs\.writeFileSync\(|save\(\))[\s\S]*exitIfUnclosed\(module_?\)/m, `${file} fails the engine right after the close, then writes its report, and ends its process after that`);
        reporting.push(file);
      }
  }
  // The harness, browser_smoke, ocr_latency and solver_update at least.
  assert.ok(reporting.length >= 4, reporting.join());
});

test('no script listens for page errors itself: watch() collects every page\'s, each once', () => {
  const listening = [];
  for (const directory of ['scripts', 'corpus'])
    for (const file of fs.readdirSync(new URL(`../../${directory}/`, import.meta.url)).filter((name) => name.endsWith('.cjs')))
      if (/\.on\(\s*["'`]pageerror/.test(read(`${directory}/${file}`))) listening.push(`${directory}/${file}`);
  assert.deepEqual(listening, ['scripts/watch.cjs']);
});
