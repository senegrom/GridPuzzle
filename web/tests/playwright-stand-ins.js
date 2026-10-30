import { EventEmitter } from 'node:events';

// Stand-ins for Playwright's Browser, BrowserContext and Page, for the tests
// of what the suites do with them without a browser (harness-watch.test.js,
// harness-close.test.js and ocr-latency.test.js). They emit what Playwright's
// objects emit: a browser's "context" and a context's "page" as one opens,
// before its newContext() or newPage() resolves; a page's "pageerror", "crash"
// and "close", a context's "close" and a browser's "disconnected". A close()
// closes what it holds without calling their close(), as Playwright does;
// lose() is a browser that goes away unasked, crash() a page that crashes
// and throw() an uncaught error in a page. A browser answers its pages'
// evaluate() calls with its `evaluate(page, fn, arg)`.
export class Page extends EventEmitter {
  constructor(context, url) { super(); this.holder = context; this.address = url; this.closed = false; }
  context() { return this.holder; }
  url() { return this.address; }
  isClosed() { return this.closed; }
  setDefaultTimeout() {}
  async goto(url) { this.address = url; }
  async waitForSelector() {}
  async evaluate(fn, arg) { return this.holder.holder.answer(this, fn, arg); }
  async close() { this.end(); }
  end() {
    if (this.closed) return;
    this.closed = true; this.holder.held.delete(this); this.emit('close', this);
  }
  crash() { this.emit('crash', this); }
  throw(message) { this.emit('pageerror', new Error(message)); }
}
export class Context extends EventEmitter {
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
export class Browser extends EventEmitter {
  constructor({ version = '1.0', evaluate = async () => undefined } = {}) {
    super(); this.held = new Set(); this.connected = true; this.number = version; this.answer = evaluate;
  }
  version() { return this.number; }
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
