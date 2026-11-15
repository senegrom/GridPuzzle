import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CAMERA_START_HELP } from '../photo-flow.js';

// live_camera's phase "a camera opened again", played on a stand-in page: the
// camera's panel must start with its starting text when it is opened again
// after a session that froze, and not with that session's last line, which it
// showed until the camera's first line before the page set the text at every
// opening (November 2026). The phase reads the help line as the tap is heard
// on the document, and every line written from the tap on until the camera's
// first. Here the page answers what the phase reads, as the new page does and
// as the old one did, so that each of its checks is seen to fail on its own.
// Loading the suite needs no Playwright.
const require = createRequire(import.meta.url);
const camera = require('../../scripts/live_camera_regressions.cjs');

const FROZEN = 'Solution preview — frozen. Check the clues and rules. Save picture keeps it; Clear returns to the live camera.';
const AIMING = 'Hold the grid steady. Recognition and solution appear here automatically.';
const CHECK = 'a camera opened again after a session that froze starts with the panel\'s starting text: the tap sets it, before the camera\'s first line, and the frozen solution\'s line is not shown again';

// A page that answers the phase's reads: `help` is the closed and the frozen
// panel's help line, `seen` what the phase's listener and observer kept. Its
// calls are noted in order, an evaluate by its source without white space.
function standIn({ help = FROZEN, seen }) {
  const calls = [];
  const page = {
    calls,
    async evaluate(run, argument) {
      const source = String(run).replace(/\s+/g, '');
      calls.push({ kind: 'evaluate', source, argument });
      return source === '()=>window.openedAgain' ? structuredClone(seen) : undefined;
    },
    async waitForFunction(run, argument) { calls.push({ kind: 'waitForFunction', source: String(run).replace(/\s+/g, ''), argument }); },
    async click(selector) { calls.push({ kind: 'click', selector }); },
    async textContent(selector) { calls.push({ kind: 'textContent', selector }); return selector === '#camera-help' ? help : ''; },
    locator: (selector) => ({ isVisible: async () => selector === '#camera-panel' }),
  };
  return page;
}
const played = async (answers) => {
  const page = standIn(answers), report = { checks: [] };
  const error = await camera.openedAgain(page, report).then(() => undefined, (failure) => failure);
  return { page, report, error };
};

test('the suite and the page have the same starting text', () => {
  assert.equal(camera.CAMERA_START_HELP, CAMERA_START_HELP);
});

test('the suite runs the phase, after "a page lying sideways" has put the paper upright again', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../scripts/live_camera_regressions.cjs', import.meta.url), 'utf8');
  assert.match(source, /await time\("a page lying sideways",\(\)=>pageLyingSideways\(page,report\)\);\r?\n\s+await time\("a camera opened again",\(\)=>openedAgain\(page,report\)\);/);
});

test('the phase passes where the tap sets the starting text and the camera\'s first line follows it', async () => {
  const seen = { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, AIMING] };
  const { page, report, error } = await played({ seen });
  assert.equal(error, undefined);
  assert.deepEqual(report.checks, [CHECK]);
  assert.deepEqual(report.openedAgain, { frozen: FROZEN, ...seen });
  // In order: a session that freezes and is closed, the listener and the
  // observer set up with the starting text, then the tap, the wait for the
  // camera's first line, the read, and the camera closed again.
  const kinds = page.calls.map((call) => (call.kind === 'click' ? `click ${call.selector}`
    : call.kind === 'evaluate' && call.source.includes('newMutationObserver') ? 'watch'
      : call.kind === 'evaluate' && call.source === '()=>window.openedAgain' ? 'read'
        : call.kind === 'waitForFunction' && call.source.includes('openedAgain.lines.some') ? 'wait for the first line' : null)).filter(Boolean);
  assert.deepEqual(kinds, ['click #camera', 'click #close-camera', 'watch', 'click #camera', 'wait for the first line', 'read', 'click #close-camera']);
  const watch = page.calls.find((call) => call.source?.includes('newMutationObserver'));
  assert.equal(watch.argument, CAMERA_START_HELP, 'the observer is told the starting text, at which it goes on watching');
  assert.ok(watch.source.includes('document.removeEventListener("click",heard)') && watch.source.includes('watch.disconnect()'),
    'the listener hears one tap and the observer stops by itself: nothing is left to put back');
});

for (const [what, answers, message] of [
  ['the panel still shows the frozen solution\'s line at the tap, as it did until November 2026',
    { seen: { tap: FROZEN, lines: [AIMING] } }, /^the tap that opens the camera again sets the panel's starting text/],
  ['the starting text is set, but only after another line was written',
    { seen: { tap: CAMERA_START_HELP, lines: [AIMING, CAMERA_START_HELP] } }, /^and it is the first line written from that tap on/],
  ['the frozen solution\'s line is written again after the starting text',
    { seen: { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, FROZEN] } }, /^the frozen solution's line is not written again/],
  ['the session before did not freeze, so that the phase would check nothing',
    { help: 'Reading printed clues…', seen: { tap: CAMERA_START_HELP, lines: [CAMERA_START_HELP, AIMING] } },
    /^the session before froze, and its help line says so/],
]) test(`the phase fails where ${what}`, async () => {
  const { report, error } = await played(answers);
  assert.equal(error?.name, 'AssertionError');
  assert.match(error.message, message);
  assert.deepEqual(report.checks, []);
});

// The lines tried are the page's own.
test('the frozen and the aiming line are lines the camera writes', async () => {
  const fs = await import('node:fs');
  const written = fs.readFileSync(new URL('../live-camera.js', import.meta.url), 'utf8');
  for (const line of [FROZEN, AIMING]) assert.ok(written.includes(line), line);
});
