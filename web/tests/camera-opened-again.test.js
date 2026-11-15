import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { CAMERA_START_HELP } from '../photo-flow.js';

// live_camera's phase "a camera opened again": the camera's panel must start
// with its starting text when it is opened again, and not with the last line
// of the session before, which it showed until the camera's first line before
// the page set the text at every opening (November 2026). The phase reads the
// help line as the tap is heard on the document, and every line written from
// the tap on up to the camera's aiming line. Here: the phase played on a
// stand-in page that answers what it reads, as the new page does and as the
// old one did, so that each of its checks is seen to fail on its own; and
// what it leaves in the page to hear the tap and keep the lines
// (watchOpening), run on a stand-in for a page's document. Loading the suite
// needs no Playwright.
const require = createRequire(import.meta.url);
const camera = require('../../scripts/live_camera_regressions.cjs');
const source = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8');

const OLD = 'The grid looks sideways. Turn the page or the phone a quarter turn so the numbers stand upright; if they already do, move closer.';
const FROZEN = 'Solution preview — frozen. Check the clues and rules. Save picture keeps it; Clear returns to the live camera.';
const AIMING = 'Hold the grid steady. Recognition and solution appear here automatically.';
const OFFER = 'No camera frame arrived. Tap Start preview to retry.';
const BASE = 'http://127.0.0.1:1/';
const CHECK = 'a camera opened again starts with the panel\'s starting text: the tap sets it, it is the first line written from the tap on, and the line of the session before is not written again before the camera\'s own first line';

test('the suite and the page have the same starting text', () => {
  assert.equal(camera.CAMERA_START_HELP, CAMERA_START_HELP);
});

test('the suite runs the phase, after "a page lying sideways" has put the paper upright again', () => {
  assert.match(source('../../scripts/live_camera_regressions.cjs'),
    /await time\("a page lying sideways",\(\)=>pageLyingSideways\(page,report\)\);\r?\n\s+await time\("a camera opened again",\(\)=>openedAgain\(page,report,server\.base\)\);/);
});

// The camera's own first line is its aiming line: one of three, by its
// settings (live-camera.js aiming()). The lines tried here are the page's.
test('the phase knows the camera\'s aiming line, whichever of the three, from every other line', () => {
  const written = ['../live-camera.js', '../live-session.js', '../photo-flow.js'].map(source).join('\n');
  const aiming = [AIMING, 'Hold the grid steady. Recognition appears here automatically.',
    'Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor.'];
  for (const line of [...aiming, OLD, FROZEN, OFFER, CAMERA_START_HELP]) assert.ok(written.includes(line), line);
  const pattern = new RegExp(camera.AIMING_LINE);
  for (const line of aiming) assert.match(line, pattern);
  for (const line of [CAMERA_START_HELP, OLD, FROZEN, OFFER, 'Reading printed clues…', 'Camera connected. Tap Start preview to allow video playback.', ''])
    assert.doesNotMatch(line, pattern);
});

// A page that answers the phase's reads. `helps` are the help line's texts
// as the phase reads them one after the other (the last one stays), `seen`
// what its listener and observer kept. Its calls are noted in order.
function standIn({ helps = [OLD], seen }) {
  const calls = [], left = [...helps];
  return {
    calls,
    async evaluate(run, argument) {
      const text = String(run).replace(/\s+/g, '');
      calls.push({ kind: 'evaluate', run, source: text, argument });
      return text === '()=>window.openedAgain' ? structuredClone(seen) : undefined;
    },
    async waitForFunction(run, argument) { calls.push({ kind: 'waitForFunction', source: String(run).replace(/\s+/g, ''), argument }); },
    async click(selector) { calls.push({ kind: 'click', selector }); },
    async goto(url) { calls.push({ kind: 'goto', url }); },
    async waitForSelector(selector) { calls.push({ kind: 'waitForSelector', selector }); },
    async textContent(selector) {
      if (selector !== '#camera-help') return '';
      calls.push({ kind: 'textContent', selector });
      return left.length > 1 ? left.shift() : left[0];
    },
    locator: (selector) => ({ isVisible: async () => selector === '#camera-panel' }),
  };
}
const played = async (answers) => {
  const page = standIn(answers), report = { checks: [] };
  const error = await camera.openedAgain(page, report, BASE).then(() => undefined, (failure) => failure);
  return { page, report, error };
};
// What the phase did, in order, in a few words a call.
const steps = (page) => page.calls.map((call) => (call.kind === 'click' ? `click ${call.selector}`
  : call.kind === 'textContent' ? 'read the help line'
    : call.kind === 'evaluate' && call.run === camera.watchOpening ? 'watch'
      : call.kind === 'evaluate' && call.source === '()=>window.openedAgain' ? 'read what was kept'
        : call.kind === 'evaluate' && call.source.includes('navigator.mediaDevices') ? 'camera fixture'
          : call.kind === 'waitForFunction' && call.source === '()=>openedAgain.aimed===true' ? 'wait for the aiming line'
            : call.kind === 'waitForFunction' && call.source.includes('textContent!==start') ? 'wait for a line of the session'
              : call.kind === 'goto' ? `goto ${call.url}` : call.kind === 'waitForSelector' ? `wait for ${call.selector}` : null)).filter(Boolean);
const NEW = { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, AIMING], aimed: true };
const REOPENED = ['watch', 'click #camera', 'wait for the aiming line', 'read what was kept', 'click #close-camera',
  `goto ${BASE}`, 'wait for body[data-ready="true"]', 'camera fixture'];

test('the phase passes where the tap sets the starting text and the camera\'s aiming line follows it, on the line the phase before left', async () => {
  const { page, report, error } = await played({ seen: NEW });
  assert.equal(error, undefined);
  assert.deepEqual(report.checks, [CHECK]);
  assert.deepEqual(report.openedAgain, { old: OLD, ...NEW });
  // The panel holds another session's line already: that is the old line,
  // read twice (is there one? which?). Then the listener and the observer,
  // the tap, the wait for the aiming line, the read, the camera closed, and
  // the page loaded afresh with its camera fixture, since the new session may
  // have frozen and the preview canvas would carry its mark to the next phase.
  assert.deepEqual(steps(page), ['read the help line', 'read the help line', ...REOPENED]);
  const watch = page.calls.find((call) => call.run === camera.watchOpening);
  assert.equal(watch.argument, camera.AIMING_LINE, 'the observer is told the aiming line, at which it stops');
});

test('on a page whose camera has not been opened the phase opens and closes it once first, for a line to be the old one', async () => {
  const { page, report, error } = await played({ helps: [CAMERA_START_HELP, AIMING], seen: NEW });
  assert.equal(error, undefined);
  assert.deepEqual(report.openedAgain, { old: AIMING, ...NEW });
  assert.deepEqual(steps(page), ['read the help line', 'click #camera', 'wait for a line of the session', 'click #close-camera',
    'read the help line', ...REOPENED]);
});

for (const [what, answers, message] of [
  ['the panel still shows the old line at the tap, as it did until November 2026',
    { seen: { tap: OLD, lines: [AIMING], aimed: true } }, /^the tap that opens the camera again sets the panel's starting text/],
  ['the line at the tap is neither the old one nor the starting text',
    { seen: { tap: AIMING, lines: [AIMING], aimed: true } }, /^the tap that opens the camera again sets the panel's starting text/],
  ['the line at the tap is empty',
    { seen: { tap: '', lines: ['', AIMING], aimed: true } }, /^the tap that opens the camera again sets the panel's starting text/],
  ['the starting text is set, but only after another line was written',
    { seen: { tap: CAMERA_START_HELP, lines: [OFFER, CAMERA_START_HELP, AIMING], aimed: true } }, /^and it is the first line written from that tap on/],
  ['the old line is written again after the starting text',
    { seen: { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, OLD, AIMING], aimed: true } }, /^the old line is not written again before the camera's own first line/],
  ['the old line is a frozen solution\'s, written again after the starting text',
    { helps: [FROZEN], seen: { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, FROZEN, AIMING], aimed: true } },
    /^the old line is not written again before the camera's own first line/],
  ['the closed panel holds the starting text after a session too, so that the phase would check nothing',
    { helps: [CAMERA_START_HELP, CAMERA_START_HELP], seen: NEW }, /^the closed panel holds the last line of the session before/],
  ['the closed panel holds no line at all',
    { helps: [''], seen: NEW }, /^the closed panel holds the last line of the session before/],
]) test(`the phase fails where ${what}`, async () => {
  const { report, error } = await played(answers);
  assert.equal(error?.name, 'AssertionError');
  assert.match(error.message, message);
  assert.deepEqual(report.checks, []);
});

test('a page in WebKit, which offers Start preview before the camera\'s first line, passes with that line between the two', async () => {
  const seen = { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, OFFER, AIMING], aimed: true };
  const { report, error } = await played({ seen });
  assert.equal(error, undefined);
  assert.deepEqual(report.openedAgain.lines, seen.lines);
});

// watchOpening() runs in the page. Here it runs on a stand-in for a page's
// document: a help line whose text can be written, a document that hears
// taps, and observers that are told of each write to the node they watch.
// `write` is the page writing the help line, `tap` a tap on a button.
function standInDocument(text) {
  const help = { textContent: text }, listeners = [], observers = [], window = {};
  const document = { getElementById: (id) => (id === 'camera-help' ? help : null),
    addEventListener(type, heard, options) { listeners.push({ type, heard, capture: options === true || options?.capture === true }); },
    removeEventListener(type, heard) {
      const at = listeners.findIndex((listener) => listener.type === type && listener.heard === heard);
      if (at >= 0) listeners.splice(at, 1);
    } };
  class MutationObserver {
    constructor(told) { this.told = told; this.watched = null; observers.push(this); }
    observe(node, options) { this.watched = { node, options }; }
    disconnect() { this.watched = null; }
  }
  // The suite's own function, with the page's document, window and observers
  // in place of this process's: its text, compiled with those three as names.
  const run = new Function('document', 'window', 'MutationObserver', `return (${camera.watchOpening});`)(document, window, MutationObserver);
  return { window, listeners, observers, run,
    write(line) { help.textContent = line; for (const observer of [...observers]) if (observer.watched?.node === help) observer.told(); },
    tap(selector) {
      for (const { type, heard } of [...listeners])
        if (type === 'click') heard({ type, target: { closest: (asked) => (asked === selector ? {} : null) } });
    } };
}

test('in the page: the line at the first tap on the camera button, and every line from then to the aiming line', () => {
  const page = standInDocument(OLD);
  page.run(camera.AIMING_LINE);
  const seen = page.window.openedAgain;
  assert.deepEqual(seen, { tap: null, lines: [], aimed: false });
  assert.equal(page.listeners.length, 1);
  assert.equal(page.listeners[0].capture, false, 'heard as the tap comes up to the document, after the button\'s own handler');
  assert.deepEqual(page.observers.map((observer) => observer.watched?.options), [{ childList: true, characterData: true, subtree: true }]);
  page.tap('#close-camera');
  assert.equal(seen.tap, null, 'a tap on another button is not the opening');
  page.write(CAMERA_START_HELP); // The button's own handler, before the document hears the tap.
  page.tap('#camera');
  assert.equal(seen.tap, CAMERA_START_HELP);
  assert.equal(page.listeners.length, 0, 'it hears one tap');
  page.write(OFFER);
  assert.equal(seen.aimed, false, 'the page\'s own offer of Start preview is not the camera\'s first line');
  page.write(AIMING);
  assert.deepEqual(seen, { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, OFFER, AIMING], aimed: true });
  assert.deepEqual(page.observers.map((observer) => observer.watched), [null], 'the observer stops at the aiming line');
  page.write('Reading printed clues…'); page.write(FROZEN);
  page.tap('#camera');
  assert.deepEqual(seen, { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, OFFER, AIMING], aimed: true }, 'nothing is kept after it');
});

test('in the page: where the tap sets no line, the old one is what it keeps', () => {
  const page = standInDocument(FROZEN);
  page.run(camera.AIMING_LINE);
  page.tap('#camera'); // The page as it was until November 2026: its handler writes nothing.
  page.write('Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor.');
  assert.deepEqual(page.window.openedAgain, { tap: FROZEN,
    lines: ['Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor.'], aimed: true });
});

test('in the page: a tap whose target is no element is not the opening', () => {
  const page = standInDocument(OLD);
  page.run(camera.AIMING_LINE);
  for (const { heard } of [...page.listeners]) { heard({ type: 'click', target: null }); heard({ type: 'click', target: {} }); }
  assert.equal(page.window.openedAgain.tap, null);
  assert.equal(page.listeners.length, 1);
});
