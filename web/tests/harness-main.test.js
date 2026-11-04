import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Whether a suite runs, through the harness's main(), and whether
// exitIfUnclosed() ends its process after a browser that would not close:
// when the suite's file is the program's entry point, also when it is
// started through a link to its folder or a preload loads the harness or
// watch.cjs before it, and never when another module requires or imports the
// suite; and that no script decides by its own require.main whether another
// module is the entry point. Stand-in suites run in processes of their own;
// loading the harness needs neither Playwright nor Python.
const inScripts = (name) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url));
const harness = inScripts('harness.cjs'), watchModule = inScripts('watch.cjs');
const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-main-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/* How a process starts its entry point: as the suites are started, the
   same through `linked`, a link to the process's directory, and in six ways
   with `loaded`, the harness or watch.cjs, loaded before it. Each gives what
   Node takes before the script, the environment, and the folder the script
   is named in; preload.cjs, in the process's directory, requires `loaded`,
   and preload.mjs loads it through createRequire. Through the link,
   process.argv names the script by the link, while Node loads the module
   from the folder the link leads to: a check of that path, rather than of
   the module, would not find the suite to be the entry point. */
const STARTS = [
  ['as it is', () => ({})],
  ['through a link to its folder', (loaded, directory, linked) => ({ folder: linked })],
  ['with it loaded first by -r', (loaded) => ({ args: ['-r', loaded] })],
  ['with a preload that requires it, by -r', (loaded, directory) => ({ args: ['-r', path.join(directory, 'preload.cjs')] })],
  ['with it loaded first through NODE_OPTIONS', (loaded) => ({ env: { NODE_OPTIONS: `--require ${JSON.stringify(loaded)}` } })],
  ['with it imported first by --import', (loaded) => ({ args: ['--import', pathToFileURL(loaded).href] })],
  ['with an --import preload that loads it through createRequire', (loaded, directory) =>
    ({ args: ['--import', pathToFileURL(path.join(directory, 'preload.mjs')).href] })],
  ['with that preload through NODE_OPTIONS', (loaded, directory) =>
    ({ env: { NODE_OPTIONS: `--import ${pathToFileURL(path.join(directory, 'preload.mjs')).href}` } })],
];

/* How the processes end that run `scripts` (name to source, the first the
   entry point) in a directory of their own, one started in each way above:
   each one's exit code, whether the bound had to end it, and what it
   printed, in lines. The bound, 45 s for each process, is far above what a
   start takes and only stops one that would not end. The link, in a folder
   of its own, is a junction on Windows, which needs no privilege; removing
   that folder removes the link, not what it links to. */
async function started(t, loaded, scripts, env = {}) {
  const directory = temporary(t), linked = path.join(temporary(t), 'linked');
  fs.symlinkSync(directory, linked, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(directory, 'preload.cjs'), `require(${JSON.stringify(loaded)});\n`);
  fs.writeFileSync(path.join(directory, 'preload.mjs'),
    `import { createRequire } from "node:module";\ncreateRequire(import.meta.url)(${JSON.stringify(loaded)});\n`);
  for (const [name, source] of Object.entries(scripts)) fs.writeFileSync(path.join(directory, name), source);
  const entry = Object.keys(scripts)[0];
  return Promise.all(STARTS.map(([how, start]) => {
    const { args = [], env: own = {}, folder = directory } = start(loaded, directory, linked);
    return new Promise((resolve) => execFile(process.execPath, [...args, path.join(folder, entry)],
      { cwd: directory, timeout: 45000, env: { ...process.env, ...env, ...own } },
      (error, stdout, stderr) => resolve({ how, code: error ? error.code ?? error.signal : 0, killed: error?.killed ?? false,
        lines: stdout.split(/\r?\n/).filter(Boolean), stderr })));
  }));
}

// A suite of main()'s kind, which says that it ran and ends as END says:
// passing, failing on its own with an exit code of its own, or throwing.
const SUITE = `const { main } = require(${JSON.stringify(harness)});
main(module, async () => {
  console.log("the suite ran");
  if (process.env.END === "code") process.exitCode = 5;
  if (process.env.END === "throws") throw new Error("expected 3 clues");
});
`;

// What listens for the process's exit says that it ran, and with which code.
const AT_EXIT = 'process.on("exit", (code) => console.log("exit handlers ran with", code));\n';

test('a suite runs, and keeps its exit code, whenever it is the entry point, however the harness was loaded', async (t) => {
  for (const [end, expected] of [['passes', 0], ['code', 5], ['throws', 1]])
    for (const { how, code, killed, lines, stderr } of await started(t, harness, { 'suite.cjs': SUITE }, { END: end }))
      await t.test(`it ${end === 'code' ? 'sets its own exit code' : end}, started ${how}`, () => {
        assert.equal(killed, false, 'it ended by itself');
        assert.deepEqual([lines, code], [['the suite ran'], expected], stderr);
        if (end === 'throws') assert.match(stderr, /^Error: expected 3 clues$/m);
      });
});

// A suite whose browser would not close, with what keeps its process alive
// as a browser's pipes do. It lets go only when exitIfUnclosed() has not
// ended the process, and says so.
const UNCLOSED = `const { main } = require(${JSON.stringify(harness)}), { markUnclosed } = require(${JSON.stringify(watchModule)});
${AT_EXIT}main(module, async () => {
  console.log("the suite ran");
  const pipes = setInterval(() => {}, 1000);
  setImmediate(() => { console.log("not ended"); clearInterval(pipes); });
  markUnclosed();
  if (process.env.CODE) process.exitCode = Number(process.env.CODE);
});
`;

test('main() ends the process of a suite whose browser would not close, with its exit code or else 1, however the harness was loaded', async (t) => {
  for (const [own, expected] of [['', 1], ['7', 7]])
    for (const { how, code, killed, lines, stderr } of await started(t, harness, { 'suite.cjs': UNCLOSED }, { CODE: own }))
      await t.test(`${own ? 'a failed suite' : 'a suite that made nothing of it'}, started ${how}`, () => {
        assert.equal(killed, false, 'it ended by itself');
        assert.deepEqual([lines, code], [['the suite ran', `exit handlers ran with ${expected}`], expected], stderr);
      });
});

// A suite that ends through exitIfUnclosed() itself, as browser_smoke,
// solver_update, ocr_latency and the corpus benchmark commands do; the
// commands load watch.cjs alone.
const OWN_END = `const { exitIfUnclosed, markUnclosed } = require(${JSON.stringify(watchModule)});
${AT_EXIT}const pipes = setInterval(() => {}, 1000);
(async () => { console.log("the suite ran"); markUnclosed(); if (process.env.CODE) process.exitCode = Number(process.env.CODE); })()
  .finally(() => { exitIfUnclosed(module); console.log("not ended"); clearInterval(pipes); });
`;

test('exitIfUnclosed() ends the process of a suite that calls it itself after a browser that would not close, however watch.cjs was loaded', async (t) => {
  for (const [own, expected] of [['', 1], ['7', 7]])
    for (const { how, code, killed, lines, stderr } of await started(t, watchModule, { 'suite.cjs': OWN_END }, { CODE: own }))
      await t.test(`${own ? 'a failed suite' : 'a suite that made nothing of it'}, started ${how}`, () => {
        assert.equal(killed, false, 'it ended by itself');
        assert.deepEqual([lines, code], [['the suite ran', `exit handlers ran with ${expected}`], expected], stderr);
      });
});

// A runner, itself a suite of main()'s kind, that requires a suite of that
// kind and one that ends through exitIfUnclosed() itself, whose browser would
// not close. Neither is the entry point: the first does not run, and the
// second does not end the process, which goes on and ends as the runner's.
const RUNNER = `const { main } = require(${JSON.stringify(harness)});
${AT_EXIT}main(module, async () => {
  console.log("the runner ran");
  require(__dirname + "/suite.cjs");
  await require(__dirname + "/own.cjs").ended;
  console.log("the runner goes on");
});
`;
const REQUIRED = `const { exitIfUnclosed, markUnclosed } = require(${JSON.stringify(watchModule)});
module.exports = { ended: (async () => { console.log("own.cjs ran"); markUnclosed(); })().finally(() => exitIfUnclosed(module)) };
`;

test('a suite another module requires does not run, and its own exitIfUnclosed() does not end the process, however the harness was loaded', async (t) => {
  for (const { how, code, killed, lines, stderr } of await started(t, harness, { 'runner.cjs': RUNNER, 'suite.cjs': SUITE, 'own.cjs': REQUIRED }))
    await t.test(`the runner started ${how}`, () => {
      assert.equal(killed, false, 'it ended by itself');
      // The runner's own end: a browser of its process would not close.
      assert.deepEqual([lines, code], [['the runner ran', 'own.cjs ran', 'the runner goes on', 'exit handlers ran with 1'], 1], stderr);
    });
});

// The same two imported by an ES module, which is the entry point then: no
// CommonJS module is, and neither runs nor ends the process, as before.
const IMPORTER = `import "./suite.cjs";
const { default: own } = await import("./own.cjs");
await own.ended;
console.log("the importer goes on");
`;

test('a suite an ES module imports does not run either, and its own exitIfUnclosed() does not end the process', async (t) => {
  for (const { how, code, killed, lines, stderr } of await started(t, harness, { 'importer.mjs': IMPORTER, 'suite.cjs': SUITE, 'own.cjs': REQUIRED }))
    await t.test(`the importer started ${how}`, () => {
      assert.equal(killed, false, 'it ended by itself');
      assert.deepEqual([lines, code], [['own.cjs ran', 'the importer goes on'], 0], stderr);
    });
});

// Each comparison of require.main with something in `source`, either way
// round, with one space on each side of its operator.
const comparisons = (source) => [...source.matchAll(/require\.main\s*[!=]==?\s*[\w$.]+|[\w$.]+\s*[!=]==?\s*require\.main/g)]
  .map(([check]) => check.replace(/\s*([!=]==?)\s*/, ' $1 '));
// A module that compares its own require.main with its own module asks
// whether it is the entry point itself, which a preload does not change.
const ofItself = (check) => /^(?:require\.main [!=]==? module|module [!=]==? require\.main)$/.test(check);

test('no script decides by its own require.main whether another module is the entry point', () => {
  // What the scan finds, and lets pass, written either way round.
  assert.deepEqual(comparisons('if (require.main === module_) run();\nif (module!==require.main) return;\n')
    .map((check) => [check, ofItself(check)]), [['require.main === module_', false], ['module !== require.main', true]]);
  const scanned = [], others = [];
  for (const directory of ['scripts', 'corpus', 'web/tests'])
    for (const file of fs.readdirSync(new URL(`../../${directory}/`, import.meta.url)).filter((name) => /\.c?js$/.test(name))) {
      // Not this file, which names what the scan looks for just above.
      if (`${directory}/${file}` === 'web/tests/harness-main.test.js') continue;
      scanned.push(`${directory}/${file}`);
      for (const check of comparisons(read(`${directory}/${file}`))) if (!ofItself(check)) others.push(`${directory}/${file}: ${check}`);
    }
  assert.ok(['scripts/harness.cjs', 'scripts/watch.cjs'].every((file) => scanned.includes(file)), scanned.join('\n'));
  assert.deepEqual(others, []);
});
