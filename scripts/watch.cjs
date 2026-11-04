/* What ends a browser suite's pages, and what they throw, without the suite
   asking: watch(), with which the harness's engines(), the suites that launch
   browsers of their own and the corpus benchmark runner watch their
   browsers; and what stops the close that ends an engine, and a suite's
   reads of its page after a failure, from holding a run up: the close() of
   what watch() returns, cleanUp(), readWithin(), markUnclosed() and
   exitIfUnclosed().
   It lives apart from scripts/harness.cjs, which exports what the suites use
   of it too, because loading the harness takes over the process's exit, to
   stop its servers, and SIGHUP, SIGINT, SIGTERM and SIGBREAK, which end the
   process there, and the corpus benchmarks stop on handlers of their own for
   those four signals, which save their reports first (interruptible() in
   corpus/benchmark-runner.cjs). */
const assert = require("node:assert/strict");

// Playwright's word that the target of a call is gone: a lost browser's
// calls and a crashed WebKit page's fail with the first, a crashed Chromium
// page's with the second, and calls on a page as it crashes with the third.
const GONE = /Target page, context or browser has been closed|Target crashed|Page crashed/;

// How long a suite waits for its browser to close, for each context it
// closes itself (photo_read's offline-install and stale-build checks',
// browser_smoke's startup-cancellation check's, ocr_latency's variants' and
// harness_regressions' "carried-on" case's) and for structural_capture's
// second tab, and the corpus benchmark runner for each close of a run nothing
// interrupted: on a loaded host Chromium's process took 0.03 to 11.64 s to
// end in 42 runs (web/TESTING.md), and a browser that is only slow is no
// failure. It is also how long Playwright gives a browser to close by itself
// before it kills it, so a browser that is merely stuck is being killed as
// the suite gives up on it.
const CLOSE_LIMIT = 30000;

/* Runs `action`, the clean-up of `name`, and waits for it for at most `limit`
   ms. Resolves to nothing when it settled in time, leaving no timer behind,
   and otherwise to why it did not, in the form of a report's cleanupErrors:
   `<name>: <its error>`, or `<name>: <name> cleanup timed out`. What the
   action does after that is not waited for, and its late failure is lost.
   Once `signal` has aborted, before the wait or during it, the wait goes on
   for at most `shortLimit` ms more. */
async function cleanUp(name, action, limit, { signal, shortLimit } = {}) {
  let timer, shortTimer, shorten;
  try {
    await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      const expire = () => reject(Error(`${name} cleanup timed out`));
      timer = setTimeout(expire, limit);
      shorten = () => { shortTimer = setTimeout(expire, shortLimit); };
      if (signal?.aborted) shorten(); else signal?.addEventListener("abort", shorten);
    })]);
  } catch (error) { return `${name}: ${error?.message || String(error)}`; }
  finally { clearTimeout(timer); clearTimeout(shortTimer); signal?.removeEventListener("abort", shorten); }
}

// How long a suite's reads of its page after a failure, for its report, may
// take, all of them together (readWithin()): a tenth of a second less than
// the page's default timeout, the 20 seconds that engines() in harness.cjs
// gives each call on the suite's page that waits for something, so that a
// page that answers such calls in time answers these too, but for that last
// tenth of a second, and the reads add less to a failed run than one such
// call can. The tenth of a second makes the limit end first when a read has
// that default timeout of its own, as page.textContent() has: Playwright
// starts that timeout when the read reaches it, after readWithin() has
// started the limit, and sets its timer slightly short of it, which Node's
// timers round down to a whole millisecond, so that with a limit of the same
// 20 seconds such a read could fail by its own timeout a millisecond before
// the limit and keep its fallback without being named as cut short
// (web/TESTING.md). Without a limit, a page that will never answer,
// as in the WebKit hang, holds the run for ever at the first such read that
// Playwright gives no timeout, a page.evaluate().
const READ_LIMIT = 19900;

/* Runs `reads`, an object whose entries are [read, fallback] by name, for a
   report after a failure: each `read` reads the page and resolves to what the
   report keeps. They all start at once, so that one that waits holds up no
   other, and the wait for them ends when every one has settled or after
   `limit` ms, whichever comes first. Resolves to { values, cutShort }:
   `values` has every name, in the order of `reads`, with what its read
   resolved to, or its fallback if the read rejected or had not settled by
   then, and `cutShort` the names of those that had not settled, each as
   `<name>: no answer within <limit in seconds> s`. While the reads wait, the
   limit's timer keeps the process alive, so that a process with nothing else
   alive does not exit before the wait ends, with no report written. Leaves
   no timer behind, and what a read does after the wait changes nothing: its
   late answer is dropped and its late failure lost. */
async function readWithin(reads, limit) {
  const names = Object.keys(reads), answered = new Map();
  let timer;
  try {
    // The timer starts before any read is asked, so that the wait counts from
    // before the first of them. A read's own timeout, which Playwright starts
    // only when the read reaches it, then ends after the wait if it is longer
    // than `limit` by more than the millisecond that Node's timers may round
    // it down, as the page's default is longer than READ_LIMIT: a read still
    // waiting then is cut short, and its own timeout changes nothing.
    await Promise.race([
      Promise.all(names.map((name) => Promise.resolve().then(reads[name][0]).catch(() => reads[name][1])
        .then((value) => { answered.set(name, value); }))),
      new Promise((resolve) => { timer = setTimeout(resolve, limit); }),
    ]);
  } finally { clearTimeout(timer); }
  const values = {}, cutShort = [];
  for (const name of names) {
    values[name] = answered.has(name) ? answered.get(name) : reads[name][1];
    if (!answered.has(name)) cutShort.push(`${name}: no answer within ${limit / 1000} s`);
  }
  return { values, cutShort };
}

// Whether a browser of this process would not close (see exitIfUnclosed).
let unclosed = false;

// Says so, for a close that does not go through watch(): the corpus benchmark
// runner's, which has a shorter limit after an interrupt and keeps the report's
// list itself.
function markUnclosed() { unclosed = true; }

/* The last step of a suite's process, or a corpus benchmark command's, once
   its reports are written, with `module_` the suite's module. A browser that
   would not close can keep the process alive for ever after its run has
   ended: Node waits for the stdio pipes it opened to the browser, and the
   browser's child processes inherit them, so that a child that outlives the
   main process holds them as the browser does. So after a close that failed,
   and only then, the process exits here, with its exit code or else 1, since
   such a close fails the run even if the suite made nothing of it.
   process.exit() runs what listens for the process's exit: the harness's
   clean-up and Playwright's, which kills every browser it launched and has
   not seen end. On Windows that does not reach a child whose main process has
   gone, which stays behind until it ends by itself or someone ends it. This
   does nothing when something else runs the suite (a runner that requires it
   or calls its run() or a command's main()), since the process is then that
   runner's to end. */
function exitIfUnclosed(module_) {
  if (unclosed && require.main === module_) process.exit(process.exitCode || 1);
}

/* Watches `browser`, the contexts it has and opens and their pages for what
   ends a suite's pages without the suite asking: a page that crashes, a
   page or context that closes without a close() call on it, its context or
   the browser, and the browser's disconnection without browser.close().
   Called as the browser is launched, it adds each to `ended` as
   { event, seconds, url }: "page crashed", "page closed", "context closed"
   or "browser disconnected", the seconds since launch, and a page's URL.
   Playwright gives a crash no reason, only the page, and the call a crash
   interrupts fails with "Target crashed" in Chromium but in WebKit with
   "Target page, context or browser has been closed", as a lost browser's
   calls do. It also adds to `errors` the uncaught errors of each of those
   pages (Playwright's "pageerror"): the first page's, which is the suite's
   own in every suite, by their message, and any other page's as
   `<message> (<url>)`, with the URL of that page, so that a suite can fail
   on what any page it opened throws, not only its own. close() on each
   watched object notes the call first, so that what the suite or its owner
   closes is no news; after browser.close() nothing is recorded. check(name)
   fails when anything ended, and lead(error) puts what ended at the head of
   a failure's message and stack, after waiting for a lost browser's news
   when the failure says that its target is gone (GONE). close(name) closes
   the browser, waiting for at most `closeLimit` ms, where a suite would
   otherwise call browser.close() and wait for ever on a browser that will
   not close. It resolves to null, or, when the close rejects or takes
   longer, adds what cleanUp() says to `cleanupErrors`, prints it with `name`
   on stderr and resolves to an Error saying the same, for a suite to fail
   an engine with that has not failed yet. */
function watch(browser, { grace = 1000, closeLimit = CLOSE_LIMIT } = {}) {
  const started = Date.now(), ended = [], errors = [], cleanupErrors = [], asked = new WeakSet();
  let first = null;
  const unasked = (...targets) => !targets.some((target) => asked.has(target));
  const note = (event, page) => ended.push({ event, seconds: Math.round((Date.now() - started) / 100) / 10,
    ...(page && { url: page.url() }) });
  const ask = (target) => {
    const close = target.close;
    target.close = (...args) => { asked.add(target); return close.apply(target, args); };
  };
  const watchPage = (page) => {
    ask(page);
    first ??= page;
    page.on("pageerror", (error) => {
      if (unasked(browser)) errors.push(page === first ? error.message : `${error.message} (${page.url()})`);
    });
    page.on("crash", () => { if (unasked(browser)) note("page crashed", page); });
    page.on("close", () => { if (unasked(page, page.context(), browser)) note("page closed", page); });
  };
  const watchContext = (context) => {
    ask(context);
    context.pages().forEach(watchPage);
    context.on("page", watchPage);
    context.on("close", () => { if (unasked(context, browser)) note("context closed"); });
  };
  ask(browser);
  browser.contexts().forEach(watchContext);
  browser.on("context", watchContext);
  browser.on("disconnected", () => { if (unasked(browser)) note("browser disconnected"); });
  // Playwright can fail the call a lost browser interrupted before it reports
  // the closes behind it (WebKit: the page's close 2 ms and the disconnection
  // 25 ms after the call failed), so a failure that says its target is gone
  // waits for them: until the browser has disconnected, for at most `grace`
  // ms. Any other failure is led at once, so that the screenshot and what a
  // suite captures after it show the page as the failure left it.
  const settled = () => new Promise((resolve) => {
    if (!browser.isConnected()) return resolve();
    const done = () => { clearTimeout(timer); browser.off("disconnected", done); resolve(); };
    const timer = setTimeout(done, grace);
    browser.on("disconnected", done);
  });
  return {
    ended,
    errors,
    cleanupErrors,
    check(name) { assert.deepEqual(ended, [], `${name}: a page crashed or closed, or the browser disconnected`); },
    async lead(error) {
      if (GONE.test(String(error?.message ?? error))) await settled();
      if (!ended.length) return error;
      if (!(error instanceof Error)) error = new Error(String(error));
      const line = ended.map(({ event, seconds, url }) => `${event} ${seconds} s after launch${url ? ` (${url})` : ""}`).join("; ");
      error.stack = `${line}\n${error.stack}`;
      error.message = `${line}\n${error.message}`;
      return error;
    },
    async close(name) {
      const failed = await cleanUp("browser", () => browser.close(), closeLimit);
      if (!failed) return null;
      markUnclosed();
      cleanupErrors.push(failed);
      console.error(`${name}: ${failed}`);
      return new Error(`${name}: ${failed}`);
    },
  };
}

module.exports = { CLOSE_LIMIT, GONE, READ_LIMIT, cleanUp, exitIfUnclosed, markUnclosed, readWithin, watch };
