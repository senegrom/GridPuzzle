import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../scripts/external_replay_regressions.cjs', import.meta.url), 'utf8');
const revision = '733559bafd65b5bdb953e07e5c7e06df0b03008d';
const identities = [
  ['images/6afxp9u0ke0d1.webp', '930df0cc75870e6fde8d8015e53c50e4f3ed790a78a75ec9d80737ccf8d0a9a9'],
  ['images/mqec6cb3dm0d1.webp', '8b67de88afded20e196722183257c57af0b47d04d4580ec26aaba4ffc27bbadd'],
  ['images/zhudyie50d0d1.webp', '1681f73cdaaf0557d47eedf572cf5539a5f8507f8d4a926310b081c8dacb198d'],
];
const corpus = () => ({ revision, fixtures: identities.map(([name, sha256]) => ({ name, sha256, data: name,
  cells: Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) =>
    Array.from({ length: 10 }, (_, flag) => +(row === 0 && col === 0 && flag <= 1)))),
})) });

// Exercise the real runner and its assertion placement without browsers/OCR.
// In particular, a "never acquire" mutation must still write diagnostics and
// close every camera/server, but must NOT leave the runner successful.
function load({ complete = () => true, code = source } = {}) {
  const files = new Map([['live-fixtures/fixtures.json', JSON.stringify(corpus())]]);
  let closed = 0, stopped = 0, context;
  const fakeFs = {
    readFileSync: file => { assert.ok(files.has(file), file); return files.get(file); },
    writeFileSync: (file, data) => files.set(file, data), existsSync: file => files.has(file), mkdirSync() {},
  };
  const harness = {
    main() {}, serve: async () => ({ base: 'fixture://site/', close: async () => { closed++; } }),
    async engines(file, suite) {
      const reports = [], failures = [];
      for (const browser of ['chromium', 'webkit']) {
        const report = { browser, errors: [] }; reports.push(report);
        const page = {
          async goto() {}, async waitForSelector() {}, async click() {},
          async waitForFunction(fn) {
            if (!fn()) throw Object.assign(new Error('controlled observation timeout'), { name: 'TimeoutError' });
          },
          async evaluate(fn, name) {
            if (fn.name !== 'begin') return fn();
            const reads = complete(browser, name) ? [{ cells: [1, ...Array(80).fill(null)], uncertain: [] }] : [];
            const replay = { started: true, error: null, reads,
              report: () => ({ reads }), pause() {}, capture: () => false,
              stop: () => { stopped++; return { active: false, retainedSources: 0, scratchPixels: 0 }; } };
            context.externalReplay = replay; context.window = { externalReplay: replay };
          },
        };
        try { await suite(page, report); report.status = 'passed'; }
        catch (error) { report.status = 'failed'; report.failure = error.message; failures.push(error); }
      }
      files.set(`browser-artifacts/${file}`, JSON.stringify(reports));
      if (failures.length) throw failures[0];
    },
  };
  context = vm.createContext({ module: { exports: {} }, require(name) {
    if (name === 'node:assert/strict') return assert;
    if (name === 'node:fs') return fakeFs;
    if (name === './harness.cjs') return harness;
    throw Error(`Unexpected dependency: ${name}`);
  } });
  vm.runInContext(code, context, { filename: 'external_replay_regressions.cjs' });
  return { api: context.module.exports, files,
    get closed() { return closed; }, get stopped() { return stopped; } };
}
function report(index = 1) {
  const [name, sha256] = identities[index];
  return { browser: 'webkit', source: { name, sha256, revision }, outcome: 'read',
    result: { reads: [{ cells: [1, ...Array(80).fill(null)] }] } };
}
test('required fixture selection is pinned, not silently weakened by removal or replacement', () => {
  const { api } = load(); assert.equal(api.replayFixtures(corpus()).length, 3);
  for (const mutation of ['missing', 'duplicate', 'hash', 'revision']) {
    const value = corpus();
    if (mutation === 'missing') value.fixtures[1].name = 'replacement.webp';
    if (mutation === 'duplicate') value.fixtures[2] = value.fixtures[1];
    if (mutation === 'hash') value.fixtures[1].sha256 = 'wrong';
    if (mutation === 'revision') value.revision = 'wrong';
    assert.throws(() => api.replayFixtures(value), /acquisition/);
  }
});
test('no-read, empty, incomplete and substituted required results all fail acquisition', () => {
  const { api } = load(); assert.doesNotThrow(() => api.requireAcquisition(report()));
  for (const mutation of ['no-read', 'no-results', 'empty', 'short', 'hash', 'revision']) {
    const value = report();
    if (mutation === 'no-read') value.outcome = 'no-completed-reading';
    if (mutation === 'no-results') value.result.reads = [];
    if (mutation === 'empty') value.result.reads[0].cells.fill(null);
    if (mutation === 'short') value.result.reads[0].cells = [1];
    if (mutation === 'hash') value.source.sha256 = 'wrong';
    if (mutation === 'revision') value.source.revision = 'wrong';
    assert.throws(() => api.requireAcquisition(value), /webkit/);
  }
});
test('the difficult fixture may still be declined without weakening the required pair', async () => {
  const h = load({ complete: (_browser, name) => name !== identities[0][0] });
  await h.api.run(); assert.equal(h.closed, 1); assert.equal(h.stopped, 6);
  const rows = JSON.parse(h.files.get('browser-artifacts/external-replay.json'));
  assert.equal(rows.filter(row => row.acquisitionRequired).length, 4);
  assert.ok(rows.every(row => row.status === 'passed'));
});
for (const browser of ['both', 'chromium', 'webkit']) {
  test(`runner fails when ${browser} stops acquiring, while preserving all reports and cleanup`, async () => {
    const h = load({ complete: name => browser !== 'both' && name !== browser });
    await assert.rejects(h.api.run(), /required photograph had no completed reading/);
    assert.equal(h.closed, 1); assert.equal(h.stopped, 6);
    const rows = JSON.parse(h.files.get('browser-artifacts/external-replay.json'));
    assert.equal(rows.length, 6);
    assert.equal(rows.filter(row => row.status === 'failed').length, browser === 'both' ? 4 : 2);
  });
}
test('mutation control: omitting the acquisition assertion reproduces the vacuous pass', async () => {
  const mutated = source.replace('     requireAcquisition(r);', '');
  assert.notEqual(mutated, source);
  const h = load({ code: mutated, complete: () => false });
  await assert.doesNotReject(h.api.run());
});
