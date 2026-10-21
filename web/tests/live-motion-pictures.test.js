import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// The external-picture part of live_motion_regressions.cjs, with a page that
// hands back the tracking results the browser would. Loading the suite needs
// no Playwright: the harness loads it only when a suite runs.
const { externalPictures, externalTracking } = createRequire(import.meta.url)("../../scripts/live_motion_regressions.cjs");

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-live-motion-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "fixtures.json");
}
// Ten valid anchors and one rejected control; `lost` translated checks of the
// valid ones fail to match.
function tracked(lost = 0) {
  const results = Array.from({ length: 10 }, (_, n) => ({ name: `images/${n}.webp`, validQuad: true, anchorValid: true,
    occlusionMatched: false, checks: [0, 1, 2, 3].map((k) => ({ matched: !(k && n * 3 + k <= lost) })) }));
  results.push({ name: "images/outside.webp", validQuad: false, anchorValid: false, occlusionMatched: false,
    checks: [0, 1, 2, 3].map(() => ({ matched: false })) });
  return results;
}
const page = (results) => ({ calls: [], async evaluate(fn, fixtures) { this.calls.push({ fn, fixtures }); return results; } });

test("without live-fixtures/ the suite says it skips the external pictures and records the skip", async (t) => {
  const file = folder(t), lines = [], report = { checks: [] }, browser = page(null);
  await externalPictures(browser, report, (line) => lines.push(line), file);
  assert.deepEqual(report.corpus, { skipped: `no ${file}` });
  assert.deepEqual(report.checks, []);
  assert.equal(browser.calls.length, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^external pictures skipped: no .*fixtures\.json \(python scripts\/fetch_live_fixtures\.py fetches them\)$/);
});

test("with live-fixtures/ the suite tracks the pictures as before", async (t) => {
  const file = folder(t), lines = [], report = {},
    fixtures = Array.from({ length: 11 }, (_, n) => ({ name: `images/${n}.webp`, data: "data:image/webp;base64," }));
  fs.writeFileSync(file, JSON.stringify({ source: "https://example.org/dataset", revision: "733559b", selection: "first 12", fixtures }));
  const results = tracked(), browser = page(results);
  await externalPictures(browser, report, (line) => lines.push(line), file);
  assert.equal(browser.calls.length, 1);
  assert.equal(browser.calls[0].fn, externalTracking);
  assert.deepEqual(browser.calls[0].fixtures, fixtures);
  assert.deepEqual(report.corpus, { source: "https://example.org/dataset", revision: "733559b", selection: "first 12",
    results, validAnchors: 10, translatedMatches: 30, translatedChecks: 30 });
  assert.deepEqual(lines, ["tracking 11 external pictures", "30/30 small-motion controls kept their identity"]);
});

test("with live-fixtures/ the tracking floors still fail the suite", async (t) => {
  const file = folder(t);
  fs.writeFileSync(file, JSON.stringify({ fixtures: [] }));
  // 27 of 30 translated checks is the floor; 26 fails.
  await externalPictures(page(tracked(3)), {}, () => {}, file);
  await assert.rejects(externalPictures(page(tracked(4)), {}, () => {}, file), /at least 90% of valid small-motion controls/);
  const covered = tracked();
  covered[0].occlusionMatched = true;
  await assert.rejects(externalPictures(page(covered), {}, () => {}, file), /covered grid cannot authorize old metadata/);
  await assert.rejects(externalPictures(page(tracked().slice(1)), {}, () => {}, file), /broad usable coverage/);
});
