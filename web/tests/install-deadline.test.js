import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { source, scope, memoryCaches } from './service-worker-fixture.js';

const build = '123456abcdef', prefix = `gridpuzzle:${scope}:`;
const metaName = prefix + `meta:${build}`, contentName = prefix + 'content-v1';
const body = 'verified new application';
const hash = createHash('sha256').update(body).digest('hex');
const manifest = { build, assets: [{ path: 'index.html', sha256: hash }] };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function harness(t, stage = null, fault = 'stall', storage = memoryCaches()) {
  const timers = new Map(), listeners = {}, signals = [], operations = [];
  const held = deferred(); let reached = false, serial = 0, claims = 0, late = Promise.resolve();
  const enter = async (name, work) => {
    operations.push(name);
    if (stage === name) {
      reached = true;
      if (fault === 'reject') throw Error(`failed ${name}`);
      await held.promise;
      // The released stage's own work, so a test can wait for it to settle
      // instead of guessing how many turns its continuation needs.
      const result = Promise.resolve().then(work);
      late = result.then(() => {}, () => {});
      return result;
    }
    return work();
  };
  const caches = { ...storage.caches, async open(name) {
    return enter(name === contentName ? 'content-open' : 'meta-open', async () => {
      const cache = await storage.caches.open(name);
      return { ...cache,
        match: request => enter('cache-match', () => cache.match(request)),
        put: (request, response) => enter(name === contentName ? 'asset-put' : 'manifest-put', () => cache.put(request, response)),
      };
    });
  } };
  const fetch = async request => {
    signals.push(request.signal);
    if (request.url.endsWith('assets.json')) return enter('manifest-fetch', () => {
      const response = new Response(JSON.stringify(manifest));
      const clone = response.clone.bind(response);
      response.clone = () => {
        const copy = clone(), json = copy.json.bind(copy);
        copy.json = () => enter('manifest-body', json);
        return copy;
      };
      return response;
    });
    return enter('asset-fetch', () => {
      const response = new Response(fault === 'integrity' ? 'wrong bytes' : body);
      const clone = response.clone.bind(response);
      response.clone = () => {
        const copy = clone(), arrayBuffer = copy.arrayBuffer.bind(copy);
        copy.arrayBuffer = () => enter('asset-body', arrayBuffer);
        return copy;
      };
      return response;
    });
  };
  vm.runInNewContext(source.replace('__BUILD_ID__', build), {
    URL, Request, Response, Uint8Array, AbortController, caches, fetch,
    crypto: { subtle: { digest: (...args) => enter('digest', () => webcrypto.subtle.digest(...args)) } },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    self: { registration: { scope }, location: { origin: new URL(scope).origin },
      clients: { claim() { claims++; }, matchAll: async () => [] },
      skipWaiting() { claims++; }, addEventListener: (type, fn) => { listeners[type] = fn; } },
  });
  let pending, outcome;
  listeners.install({ waitUntil(promise) { pending = promise; } });
  const settled = pending.then(() => { outcome = 'success'; }, error => { outcome = error; });
  t.after(async () => { held.resolve(); await settled; });
  const until = async predicate => {
    const end = Date.now() + 5000;
    while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 2));
    assert.ok(predicate(), `did not reach ${stage}; operations: ${operations}`);
  };
  return { storage, timers, signals, operations, held, settled, until, get late() { return late; },
    get reached() { return reached; }, get outcome() { return outcome; }, get claims() { return claims; } };
}

for (const stage of ['manifest-fetch', 'manifest-body', 'content-open', 'cache-match',
  'asset-fetch', 'asset-body', 'digest', 'asset-put', 'meta-open', 'manifest-put']) {
  test(`update installation bounds ${stage}, fences late completion and permits a fresh retry`, async t => {
    const storage = memoryCaches();
    const old = await storage.caches.open(prefix + 'meta:old');
    await old.put(scope + 'assets.json', new Response('old active manifest'));
    const unrelated = await storage.caches.open('another-app');
    await unrelated.put(scope + 'other', new Response('unrelated data'));
    const h = await harness(t, stage, 'stall', storage);
    await h.until(() => h.reached);
    assert.equal(h.timers.size, 1, 'installation owns a bounded phase');
    const [id, timer] = [...h.timers][0];
    assert.equal(timer.ms, 240000);
    h.timers.delete(id); timer.fn(); await h.settled;
    assert.match(h.outcome.message, /App update stalled/);
    assert.ok(h.signals.length && h.signals.every(signal => signal.aborted));
    assert.equal(h.timers.size, 0);
    const atFailure = [...h.operations];
    // One turn lets the released stage start its work (h.late is replaced
    // then); awaiting that work leaves its continuation no room to escape.
    h.held.resolve(); await tick(); await h.late;
    for (let i = 0; i < 20; i++) await tick();
    assert.match(h.outcome.message, /App update stalled/, 'a late native completion cannot certify installation');
    assert.deepEqual(h.operations, atFailure, 'no subsequent phase or cache write after failure');
    assert.equal(h.claims, 0);
    assert.equal(await (await old.match(scope + 'assets.json')).text(), 'old active manifest');
    assert.equal(await (await unrelated.match(scope + 'other')).text(), 'unrelated data');
    // A put already handed to CacheStorage cannot be aborted. Its late result
    // is harmless verified data, never an activation or successful install.
    if (stage !== 'manifest-put') assert.equal(await storage.stores.get(metaName)?.match(scope + 'assets.json'), undefined);
    const retry = await harness(t, null, 'stall', storage); await retry.settled;
    assert.equal(retry.outcome, 'success'); assert.equal(retry.timers.size, 0);
    assert.equal(await (await storage.stores.get(contentName).match(scope + '.gridpuzzle-cache/' + hash)).text(), body);
  });
}
for (const [stage, fault] of [['asset-put', 'reject'], ['manifest-put', 'reject'], [null, 'integrity']]) {
  test(`failed update ${fault} at ${stage ?? 'hash verification'} cannot activate`, async t => {
    const h = await harness(t, stage, fault); await h.settled;
    assert.notEqual(h.outcome, 'success'); assert.equal(h.claims, 0); assert.equal(h.timers.size, 0);
    assert.ok(h.signals.every(signal => signal.aborted));
    assert.equal(await h.storage.stores.get(metaName)?.match(scope + 'assets.json'), undefined);
  });
}
test('healthy installation verifies and stores the shell before publishing its manifest', async t => {
  const h = await harness(t); await h.settled;
  assert.equal(h.outcome, 'success'); assert.equal(h.timers.size, 0); assert.equal(h.claims, 0);
  assert.ok(h.operations.indexOf('digest') < h.operations.indexOf('asset-put'));
  assert.ok(h.operations.indexOf('asset-put') < h.operations.indexOf('manifest-put'));
});
