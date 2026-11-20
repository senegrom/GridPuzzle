import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { CAMERA_START_HELP } from '../photo-flow.js';
import { PREVIEW_NAME } from '../live-camera.js';

// live_camera's phase "a camera opened again": the camera's panel must start
// with its starting text when it is opened again, and not with the last line
// of the session before, which it showed until the camera's first line before
// the page set the text at every opening (November 2026). The phase reads the
// help line as the tap is heard on the document, and keeps the line as it
// stands each time the page has written it, from the tap on up to the
// camera's aiming line. With the line it reads what the preview canvas says
// of itself, its accessible name and its marks, as the closed panel holds it
// and as the tap is heard: from the tap on the canvas must be the page's own
// again, where it kept the last session's name and marks until the camera
// started. Here: the phase played on a stand-in page that
// answers what it reads, as the new page does and as the old one did, so that
// each of its checks is seen to fail on its own; and what it leaves in the
// page to hear the tap and keep the lines (watchOpening), run on a stand-in
// for a page's document. Loading the suite needs no Playwright.
const require = createRequire(import.meta.url);
const camera = require('../../scripts/live_camera_regressions.cjs');
const source = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8');

const OLD = 'The grid looks sideways. Turn the page or the phone a quarter turn so the numbers stand upright; if they already do, move closer.';
const FROZEN = 'Solution preview — frozen. Check the clues and rules. Save picture keeps it; Clear returns to the live camera.';
const AIMING = 'Hold the grid steady. Recognition and solution appear here automatically.';
const OFFER = 'No camera frame arrived. Tap Start preview to retry.';
const BASE = 'http://127.0.0.1:1/';
const CHECK = 'a camera opened again starts with the panel\'s starting text: the tap sets it, it is the first line written from the tap on, and the line of the session before is not written again before the camera\'s own first line; and the tap sets the preview canvas back, to the page\'s own name and no mark of the session before';
// What the preview canvas says of itself (its accessible name and its marks,
// by name): as a session that was closed while it read leaves it, as one that
// froze leaves it, and as the page has it before any session.
const MARKS = ['data-delayed', 'data-overlay', 'data-recognised', 'data-solution', 'data-uncertain', 'data-unknown', 'data-view'];
const SESSION = { name: 'Live camera. Grid outline shown; reading: 0 recognised, 0 uncertain, 14 unread clues.', marks: MARKS };
const FROZEN_CANVAS = { name: 'Frozen picture of the solved puzzle: 14 recognised, 0 uncertain, 0 unread, 2 solution entries. Live results are not confirmed.', marks: MARKS };
const OWN = { name: PREVIEW_NAME, marks: [] };

test('the suite and the page have the same starting text', () => {
  assert.equal(camera.CAMERA_START_HELP, CAMERA_START_HELP);
});

test('the suite and the page have the same name for a preview canvas that shows nothing', () => {
  assert.equal(camera.CAMERA_PREVIEW_NAME, PREVIEW_NAME);
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
// as the phase reads them one after the other (the last one stays), `names`
// the preview canvas's name as it reads that, `seen` what its listener and
// observer kept. Its calls are noted in order.
function standIn({ helps = [OLD], names = [SESSION.name], seen }) {
  const calls = [], left = [...helps], named = [...names];
  return {
    calls,
    async getAttribute(selector, name) {
      calls.push({ kind: 'getAttribute', selector, name });
      return named.length > 1 ? named.shift() : named[0];
    },
    async evaluate(run, argument) {
      const text = String(run).replace(/\s+/g, '');
      calls.push({ kind: 'evaluate', run, source: text, argument });
      return text === '()=>window.openedAgain' ? structuredClone(seen) : undefined;
    },
    async waitForFunction(run, argument, options) { calls.push({ kind: 'waitForFunction', source: String(run).replace(/\s+/g, ''), argument, options }); },
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
// The phase's wait for the aiming line, as the page is asked, and its wait
// for the canvas of a session of its own to be named after what it shows.
const AIMED = '()=>openedAgain.aimed===true';
const NAMED = 'own=>document.getElementById("live-preview").getAttribute("aria-label")!==own';
// What the phase did, in order, in a few words a call.
const steps = (page) => page.calls.map((call) => (call.kind === 'click' ? `click ${call.selector}`
  : call.kind === 'textContent' ? 'read the help line'
    : call.kind === 'getAttribute' && call.selector === '#live-preview' && call.name === 'aria-label' ? 'read the canvas\'s name'
      : call.kind === 'getAttribute' ? `another attribute: ${call.selector} ${call.name}`
    : call.kind === 'evaluate' && call.run === camera.watchOpening ? 'watch'
      : call.kind === 'evaluate' && call.source === '()=>window.openedAgain' ? 'read what was kept'
        : call.kind === 'evaluate' && call.source.includes('navigator.mediaDevices') ? 'camera fixture'
          : call.kind === 'evaluate' && call.source === '()=>{window.liveMode="grid";}' ? 'the paper shows its grid'
            : call.kind === 'waitForFunction' && call.source === AIMED ? 'wait for the aiming line'
              : call.kind === 'waitForFunction' && call.source === NAMED ? 'wait for the canvas\'s own name to go'
              // startLive()'s own wait, for the video or the offer of Start preview, is part of the tap; any other wait is told.
              : call.kind === 'waitForFunction' && call.source.includes('!start.hidden||video.videoWidth>0') ? null
                : call.kind === 'waitForFunction' ? `another wait: ${call.source}`
                  : call.kind === 'goto' ? `goto ${call.url}` : call.kind === 'waitForSelector' ? `wait for ${call.selector}` : null)).filter(Boolean);
// What the phase's listener and observer keep on a page that is right: `kept`
// with the lines of an opening, NEW with those of an opening in Chromium.
const kept = (rest) => ({ tap: CAMERA_START_HELP, canvas: { closed: SESSION, tap: OWN }, aimed: true, ...rest });
const NEW = kept({ lines: [CAMERA_START_HELP, AIMING] });
const REOPENED = ['watch', 'click #camera', 'wait for the aiming line', 'read what was kept', 'click #close-camera',
  `goto ${BASE}`, 'wait for body[data-ready="true"]', 'camera fixture'];
// Each wait of the phase for the aiming line has the suite's long limit (a
// camera slow to start is no failure of the page) and no argument.
const waits = (page) => page.calls.filter((call) => call.kind === 'waitForFunction' && call.source === AIMED)
  .map(({ argument, options }) => ({ argument, options }));
const LONG = { argument: null, options: { timeout: 150000 } };
// Its wait for the canvas's own name to go has the same limit, and is told that name.
const nameWaits = (page) => page.calls.filter((call) => call.kind === 'waitForFunction' && call.source === NAMED)
  .map(({ argument, options }) => ({ argument, options }));
const LONG_NAMED = { argument: PREVIEW_NAME, options: { timeout: 150000 } };
// A session of the phase's own, before the reopening.
const OWN_SESSION = ['watch', 'click #camera', 'wait for the aiming line', 'wait for the canvas\'s own name to go', 'click #close-camera'];

test('the phase passes where the tap sets the starting text and the camera\'s aiming line follows it, on the line the phase before left', async () => {
  const { page, report, error } = await played({ seen: NEW });
  assert.equal(error, undefined);
  assert.deepEqual(report.checks, [CHECK]);
  assert.deepEqual(report.openedAgain, { old: OLD, ...NEW });
  // The paper shows its grid, whatever the phase before left it showing. The
  // panel holds another session's line already, and its canvas that
  // session's name: the line is the old line, read twice (is there one?
  // which?). Then the listener and the observer, the tap, the wait for the
  // aiming line, the read, the camera closed, and the page loaded afresh with
  // its camera fixture: the phases after this one start on a page that has
  // had no camera session.
  assert.deepEqual(steps(page), ['the paper shows its grid', 'read the help line', 'read the canvas\'s name', 'read the help line', ...REOPENED]);
  assert.deepEqual(waits(page), [LONG]);
  assert.deepEqual(nameWaits(page), [], 'no session of its own, and no wait for a name');
  const watch = page.calls.find((call) => call.run === camera.watchOpening);
  assert.equal(watch.argument, camera.AIMING_LINE, 'the observer is told the aiming line, at which it stops');
});

// That session of its own is watched as the reopening is, up to the camera's
// aiming line, and closed only after it. Closed at the first line that is not
// the starting text, as it was at first, it left WebKit's "No camera frame
// arrived. Tap Start preview to retry." as the old line, which the reopening
// writes again before its aiming line: the phase then failed on a page that
// was right (the review's run with a camera that gives no frame until Start
// preview). Closed at the aiming line, as it was next, it left the canvas the
// page's own name, a live view without an outline being named so, and a tap
// that never set the name passed the phase (the review's run with a tap that
// took the marks alone). So it is closed once the canvas's name is no longer
// the page's own: an outline is shown then, or more.
test('on a page whose camera has not been opened the phase opens it once first, up to the aiming line and until its canvas is named after what it shows, and closes it', async () => {
  const { page, report, error } = await played({ helps: [CAMERA_START_HELP, AIMING], seen: NEW });
  assert.equal(error, undefined);
  assert.deepEqual(report.openedAgain, { old: AIMING, ...NEW });
  assert.deepEqual(steps(page), ['the paper shows its grid', 'read the help line', ...OWN_SESSION, 'read the help line', ...REOPENED]);
  assert.deepEqual(waits(page), [LONG, LONG]);
  assert.deepEqual(nameWaits(page), [LONG_NAMED]);
  for (const watch of page.calls.filter((call) => call.run === camera.watchOpening)) assert.equal(watch.argument, camera.AIMING_LINE);
});

// The session before may have been closed with a canvas that the page's own
// name still stood on (a live view with no outline is named so). Its marks
// say that a session was there, but the name at the tap would then be right
// on a page that never set it: the phase opens a session of its own there
// too, for a name to be the old one.
test('where the last session left the canvas the page\'s own name, the phase opens one of its own all the same, for a name to be the old one', async () => {
  const { page, report, error } = await played({ helps: [OLD, AIMING], names: [PREVIEW_NAME], seen: NEW });
  assert.equal(error, undefined);
  assert.deepEqual(report.checks, [CHECK]);
  assert.deepEqual(report.openedAgain, { old: AIMING, ...NEW });
  assert.deepEqual(steps(page), ['the paper shows its grid', 'read the help line', 'read the canvas\'s name', ...OWN_SESSION,
    'read the help line', ...REOPENED]);
  assert.deepEqual(waits(page), [LONG, LONG]);
  assert.deepEqual(nameWaits(page), [LONG_NAMED]);
});

test('a canvas with no name at all is not the page\'s own: the phase opens no session for it', async () => {
  const { page, error } = await played({ names: [null], seen: { ...NEW, canvas: { closed: { name: null, marks: MARKS }, tap: OWN } } });
  assert.equal(error, undefined);
  assert.deepEqual(steps(page), ['the paper shows its grid', 'read the help line', 'read the canvas\'s name', 'read the help line', ...REOPENED]);
});

test('with WebKit\'s offer of Start preview before both aiming lines, the session of its own leaves a line the reopening does not write again', async () => {
  // The old line is whatever the closed panel holds after the aiming line: a
  // line of the camera's reading here. The offer is written in both openings.
  const READING = 'Reading printed clues…';
  const seen = kept({ lines: [CAMERA_START_HELP, OFFER, AIMING] });
  const { report, error } = await played({ helps: [CAMERA_START_HELP, READING], seen });
  assert.equal(error, undefined);
  assert.deepEqual(report.openedAgain, { old: READING, ...seen });
});

// The canvas's failures come last here, each on a page whose help line is
// right: the canvas as the page left it at the tap until this change (the
// last session's name and marks), with its own name and a mark left, with no
// mark and another picture's name; and with not enough of a session on it
// before the tap: no mark, where the phase would check nothing of the marks,
// or the page's own name, where it would check nothing of the name (the
// phase opens a session of its own where it reads that name on the closed
// canvas, so this is a canvas that lost its name between that read and the
// tap).
const LINE = /^the tap that opens the camera again sets the panel's starting text/, AGAIN = /^the old line is not written again before the camera's own first line/,
  PREMISE = /^the closed panel holds the last line of the session before/, CANVAS = /^the tap sets the preview canvas back/,
  CANVAS_PREMISE = /^the closed panel's canvas holds the marks of the session before, and a name that is not the page's own/;
for (const [what, answers, message] of [
  ['the panel still shows the old line at the tap, as it did until November 2026', { seen: kept({ tap: OLD, lines: [AIMING] }) }, LINE],
  ['the line at the tap is neither the old one nor the starting text', { seen: kept({ tap: AIMING, lines: [AIMING] }) }, LINE],
  ['the line at the tap is empty', { seen: kept({ tap: '', lines: ['', AIMING] }) }, LINE],
  ['the starting text is set, but only after another line was written',
    { seen: kept({ lines: [OFFER, CAMERA_START_HELP, AIMING] }) }, /^and it is the first line written from that tap on/],
  ['the old line is written again after the starting text', { seen: kept({ lines: [CAMERA_START_HELP, OLD, AIMING] }) }, AGAIN],
  ['the old line is a frozen solution\'s, written again after the starting text',
    { helps: [FROZEN], seen: kept({ lines: [CAMERA_START_HELP, FROZEN, AIMING] }) }, AGAIN],
  ['the closed panel holds the starting text after a session too, so that the phase would check nothing',
    { helps: [CAMERA_START_HELP, CAMERA_START_HELP], seen: NEW }, PREMISE],
  ['the closed panel holds no line at all', { helps: [''], seen: NEW }, PREMISE],
  ['the canvas still has the last session\'s name and marks at the tap, as it did until the tap set it back',
    { seen: { ...NEW, canvas: { closed: SESSION, tap: SESSION } } }, CANVAS],
  ['the canvas still has a frozen picture\'s name and marks at the tap',
    { helps: [FROZEN], seen: { ...NEW, canvas: { closed: FROZEN_CANVAS, tap: FROZEN_CANVAS } } }, CANVAS],
  ['the canvas has its own name at the tap, and one mark of the session before',
    { seen: { ...NEW, canvas: { closed: SESSION, tap: { name: PREVIEW_NAME, marks: ['data-view'] } } } }, CANVAS],
  ['the canvas has no mark at the tap, and still the last picture\'s name',
    { seen: { ...NEW, canvas: { closed: FROZEN_CANVAS, tap: { name: FROZEN_CANVAS.name, marks: [] } } } }, CANVAS],
  ['the canvas has no name at all at the tap', { seen: { ...NEW, canvas: { closed: SESSION, tap: { name: null, marks: [] } } } }, CANVAS],
  ['the closed panel\'s canvas holds nothing of a session, so that the phase would check nothing',
    { seen: { ...NEW, canvas: { closed: OWN, tap: OWN } } }, CANVAS_PREMISE],
  ['the closed panel\'s canvas holds a session\'s name and no mark, so that the phase would check nothing of the marks',
    { seen: { ...NEW, canvas: { closed: { name: SESSION.name, marks: [] }, tap: OWN } } }, CANVAS_PREMISE],
  ['the closed panel\'s canvas holds a session\'s marks under the page\'s own name, so that the phase would check nothing of the name',
    { seen: { ...NEW, canvas: { closed: { name: PREVIEW_NAME, marks: MARKS }, tap: OWN } } }, CANVAS_PREMISE],
]) test(`the phase fails where ${what}`, async () => {
  const { report, error } = await played(answers);
  assert.equal(error?.name, 'AssertionError');
  assert.match(error.message, message);
  assert.deepEqual(report.checks, []);
});

test('a page in WebKit, which offers Start preview before the camera\'s first line, passes with that line between the two', async () => {
  const seen = kept({ lines: [CAMERA_START_HELP, OFFER, AIMING] });
  const { report, error } = await played({ seen });
  assert.equal(error, undefined);
  assert.deepEqual(report.openedAgain.lines, seen.lines);
});

// watchOpening() runs in the page. Here it runs on a stand-in for a page's
// document: a help line whose text can be written, a document that hears
// taps, and observers that are told of each write to the node they watch.
// `write` is the page writing the help line, `tap` a tap on a button. A
// browser tells an observer once for a run of the page's script, which then
// reads the line as it stands: each write here is a run of its own, as each
// write of an opening is in the page. `canvas` is the preview canvas, with
// the attributes the test gives it (in the order given, as a page keeps them).
function standInDocument(text, attributes = { id: 'live-preview', role: 'img', 'aria-label': PREVIEW_NAME }) {
  const help = { textContent: text }, listeners = [], observers = [], window = {};
  const canvas = { attributes: { ...attributes }, getAttribute(name) { return this.attributes[name] ?? null; },
    getAttributeNames() { return Object.keys(this.attributes); } };
  const document = { getElementById: (id) => (id === 'camera-help' ? help : id === 'live-preview' ? canvas : null),
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
  return { window, listeners, observers, run, canvas,
    write(line) { help.textContent = line; for (const observer of [...observers]) if (observer.watched?.node === help) observer.told(); },
    tap(selector) {
      for (const { type, heard } of [...listeners])
        if (type === 'click') heard({ type, target: { closest: (asked) => (asked === selector ? {} : null) } });
    } };
}

// The canvas of a session that froze, as the page keeps its attributes: its
// own three, the last picture's name among them, and the session's marks in
// the order the camera wrote them.
const FROZEN_ATTRIBUTES = { id: 'live-preview', role: 'img', 'aria-label': FROZEN_CANVAS.name, 'data-view': 'frozen', 'data-recognised': '14',
  'data-uncertain': '0', 'data-unknown': '0', 'data-solution': '2', 'data-overlay': 'composition', 'data-delayed': '0' };
test('in the page: the line and the canvas at the first tap on the camera button, and every line from then to the aiming line', () => {
  const page = standInDocument(OLD, FROZEN_ATTRIBUTES);
  page.run(camera.AIMING_LINE);
  const seen = page.window.openedAgain;
  // The canvas as the closed panel holds it: its name, and its marks alone
  // (not its id or its role), by name.
  assert.deepEqual(seen, { tap: null, canvas: { closed: FROZEN_CANVAS, tap: null }, lines: [], aimed: false });
  assert.equal(page.listeners.length, 1);
  assert.equal(page.listeners[0].capture, false, 'heard as the tap comes up to the document, after the button\'s own handler');
  assert.deepEqual(page.observers.map((observer) => observer.watched?.options), [{ childList: true, characterData: true, subtree: true }]);
  page.tap('#close-camera');
  assert.equal(seen.tap, null, 'a tap on another button is not the opening');
  assert.equal(seen.canvas.tap, null);
  // The button's own handler, before the document hears the tap: the line,
  // and the canvas set back.
  page.write(CAMERA_START_HELP);
  page.canvas.attributes = { id: 'live-preview', role: 'img', 'aria-label': PREVIEW_NAME };
  page.tap('#camera');
  assert.equal(seen.tap, CAMERA_START_HELP);
  assert.deepEqual(seen.canvas, { closed: FROZEN_CANVAS, tap: OWN }, 'the canvas as the tap is heard, beside the one the closed panel held');
  assert.equal(page.listeners.length, 0, 'it hears one tap');
  page.write(OFFER);
  assert.equal(seen.aimed, false, 'the page\'s own offer of Start preview is not the camera\'s first line');
  // The camera starts: it marks the canvas, and writes its aiming line.
  page.canvas.attributes['data-view'] = 'live';
  page.write(AIMING);
  const all = { tap: CAMERA_START_HELP, canvas: { closed: FROZEN_CANVAS, tap: OWN }, lines: [CAMERA_START_HELP, OFFER, AIMING], aimed: true };
  assert.deepEqual(seen, all, 'what the canvas says later is not what it said at the tap');
  assert.deepEqual(page.observers.map((observer) => observer.watched), [null], 'the observer stops at the aiming line');
  page.write('Reading printed clues…'); page.write(FROZEN);
  page.tap('#camera');
  assert.deepEqual(seen, all, 'nothing is kept after it');
});

test('in the page: where the tap sets no line and leaves the canvas as it is, the old ones are what it keeps', () => {
  const page = standInDocument(FROZEN, FROZEN_ATTRIBUTES);
  page.run(camera.AIMING_LINE);
  page.tap('#camera'); // The page as it was until November 2026: its handler writes nothing.
  page.write('Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor.');
  assert.deepEqual(page.window.openedAgain, { tap: FROZEN, canvas: { closed: FROZEN_CANVAS, tap: FROZEN_CANVAS },
    lines: ['Automatic reading is switched off. Hold the grid steady and capture to crop and read in the editor.'], aimed: true });
});

test('in the page: a canvas with no name and no mark is read as that', () => {
  const page = standInDocument(OLD, { id: 'live-preview' });
  page.run(camera.AIMING_LINE);
  assert.deepEqual(page.window.openedAgain.canvas, { closed: { name: null, marks: [] }, tap: null });
});

test('in the page: a tap whose target is no element is not the opening', () => {
  const page = standInDocument(OLD);
  page.run(camera.AIMING_LINE);
  for (const { heard } of [...page.listeners]) { heard({ type: 'click', target: null }); heard({ type: 'click', target: {} }); }
  assert.equal(page.window.openedAgain.tap, null);
  assert.equal(page.listeners.length, 1);
});
