import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

// What ends a suite's pages, as the harness records it; loading it needs no
// Playwright. These stand-ins emit what Playwright's objects emit: a close()
// closes what it holds without calling their close(), as Playwright does, and
// lose() is a browser that goes away unasked.
const { watch } = createRequire(import.meta.url)('../../scripts/harness.cjs');
const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

class Page extends EventEmitter {
  constructor(context, url) { super(); this.holder = context; this.address = url; this.closed = false; }
  context() { return this.holder; }
  url() { return this.address; }
  isClosed() { return this.closed; }
  async close() { this.end(); }
  end() {
    if (this.closed) return;
    this.closed = true; this.holder.held.delete(this); this.emit('close', this);
  }
  crash() { this.emit('crash', this); }
}
class Context extends EventEmitter {
  constructor(browser) { super(); this.holder = browser; this.held = new Set(); }
  pages() { return [...this.held]; }
  async newPage(url = 'about:blank') {
    const page = new Page(this, url);
    this.held.add(page); this.emit('page', page);
    return page;
  }
  async close() { this.end(); }
  end() {
    for (const page of this.pages()) page.end();
    this.holder.held.delete(this); this.emit('close', this);
  }
}
class Browser extends EventEmitter {
  constructor() { super(); this.held = new Set(); this.connected = true; }
  contexts() { return [...this.held]; }
  isConnected() { return this.connected; }
  async newContext() {
    const context = new Context(this);
    this.held.add(context); this.emit('context', context);
    return context;
  }
  async close() { this.lose(); }
  lose() {
    if (!this.connected) return;
    for (const context of this.contexts()) context.end();
    this.connected = false; this.emit('disconnected', this);
  }
}
const events = (watched) => watched.ended.map(({ event, url }) => (url ? [event, url] : [event]));
const said = (watched) => watched.ended
  .map(({ event, seconds, url }) => `${event} ${seconds} s after launch${url ? ` (${url})` : ''}`).join('; ');
const CLOSED = 'page.waitForFunction: Target page, context or browser has been closed';

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
});

test('a failure waits at most its grace for news, and one that is no Error is led too', async () => {
  const browser = new Browser(), watched = watch(browser, { grace: 50 });
  const page = await (await browser.newContext()).newPage('http://a/');
  const started = Date.now();
  const unchanged = new Error('timeout');
  assert.equal((await watched.lead(unchanged)).message, 'timeout');
  assert.ok(Date.now() - started >= 40, 'it waited');
  page.crash();
  const led = await watched.lead('a string was thrown');
  assert.ok(led instanceof Error);
  assert.equal(led.message, `${said(watched)}\na string was thrown`);
});

test('every script that launches a browser watches it, checks it and leads its failures', () => {
  const scripts = fs.readdirSync(new URL('../../scripts/', import.meta.url)).filter((file) => file.endsWith('.cjs'));
  const launching = scripts.filter((file) => /\.launch\(/.test(read(`scripts/${file}`)));
  assert.ok(launching.length >= 5, launching.join());
  for (const file of launching) {
    const source = read(`scripts/${file}`);
    const browsers = [...source.matchAll(/(\w+) = await [\w.[\]]+\.launch\(/g)].map(([, browser]) => browser);
    assert.equal(browsers.length, source.match(/\.launch\(/g).length, `${file}: every browser it launches is named`);
    for (const browser of browsers) assert.ok(source.includes(`watch(${browser})`), `${file} watches ${browser}`);
    assert.match(source, /\.check\((?:name|engineName)\)/, `${file} fails when a page ended`);
    assert.match(source, /await \w+\.lead\(/, `${file} leads its failures`);
  }
});
