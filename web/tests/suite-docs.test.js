import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A checkout may have CRLF line ends.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The phases live_camera_regressions.cjs times, in live-camera.json and its
// log: its own and those of the suites it runs inside itself, which hand
// their names to the same timer under a prefix. A template literal counts by
// its fixed part ("detector recovery: " for both recoveries); the nested
// suites' prefixes ("review safety / ") are not phases.
function timedPhases() {
  const names = [];
  for (const suite of ['live_camera', 'review_safety', 'structural_capture']) {
    for (const [, quote, name] of read(`scripts/${suite}_regressions.cjs`).matchAll(/\btime\((["`])(.+?)\1/g)) {
      const fixed = quote === '`' ? name.split('${')[0].trim() : name;
      if (!fixed.endsWith('/')) names.push(fixed);
    }
  }
  return names;
}

test('TESTING.md names every phase the live-camera suite times', () => {
  const phases = timedPhases();
  assert.ok(phases.includes('live solve') && phases.includes('faint structural variants'), phases.join(', '));
  const doc = read('web/TESTING.md'), start = doc.indexOf('### Live-camera suite timing');
  assert.ok(start >= 0, 'TESTING.md has its timing section');
  const section = doc.slice(start, doc.indexOf('\n## ', start)).replace(/\s+/g, ' ').toLowerCase();
  assert.deepEqual(phases.filter((name) => !section.includes(name.toLowerCase())), [],
    'phases the suite reports that "Live-camera suite timing" never names');
});
