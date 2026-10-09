// Temporary probe for the Playwright 1.64 pull request, removed again once it
// has run. The live-recovery suite draws its 27 px Courier New digits with
// textBaseline "middle", which WebKit 27.2 places 1 px higher than WebKit
// 26.6 and Chromium; the suite only passes at the validated position. This
// records, per engine, where "middle" puts a digit at the fixture's three
// fractional row centres, and where the alphabetic baseline puts it at
// offsets d = 0 ... 12 px (0.05 px steps), so that one engine-independent
// placement can be chosen that reproduces the validated pixels everywhere.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

const FONT = "27px Courier New";
// The fixture's row centres are 180 + (r + .5) * 600 / 9: fractions 1/3, 0, 2/3.
const PHASES = [1 / 3, 0, 2 / 3];

async function main() {
  fs.mkdirSync("probe-out", { recursive: true });
  const result = { playwright: require("playwright/package.json").version, engines: {} };
  for (const name of ["chromium", "webkit"]) {
    const browser = await playwright[name].launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.setContent("<!doctype html><title>probe</title>");
    const data = await page.evaluate(({ FONT, PHASES }) => {
      const fnv = (d) => { let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
      const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 80;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      // As the fixture draws: #24282c on #edf1f5, centred, cell centre x 560 (integer).
      const draw = (baseline, y) => {
        ctx.fillStyle = "#edf1f5"; ctx.fillRect(0, 0, 80, 80);
        ctx.fillStyle = "#24282c"; ctx.font = FONT; ctx.textAlign = "center"; ctx.textBaseline = baseline;
        ctx.fillText("6", 40, y);
        const d = ctx.getImageData(0, 0, 80, 80).data;
        let top = -1, bottom = -1;
        for (let row = 0; row < 80; row++) {
          let dark = false;
          for (let x = 0; x < 80; x++) if (d[(row * 80 + x) * 4] < 200) { dark = true; break; }
          if (dark) { if (top < 0) top = row; bottom = row; }
        }
        return { hash: fnv(d), top, bottom };
      };
      const metrics = {};
      for (const baseline of ["alphabetic", "middle"]) {
        ctx.font = FONT; ctx.textBaseline = baseline; ctx.textAlign = "center";
        const m = ctx.measureText("6");
        metrics[baseline] = Object.fromEntries(["fontBoundingBoxAscent", "fontBoundingBoxDescent", "emHeightAscent", "emHeightDescent",
          "actualBoundingBoxAscent", "actualBoundingBoxDescent", "alphabeticBaseline", "hangingBaseline", "ideographicBaseline", "width"]
          .map((k) => [k, typeof m[k] === "number" ? m[k] : null]));
      }
      const phases = PHASES.map((phase) => {
        const y = 40 + phase;
        const sweep = [];
        for (let i = 0; i <= 240; i++) { const d = i * 0.05; sweep.push({ d: +d.toFixed(2), ...draw("alphabetic", y + d) }); }
        return { phase, middle: draw("middle", y), alphabeticAtCentre: draw("alphabetic", y), sweep };
      });
      return { metrics, phases };
    }, { FONT, PHASES });
    result.engines[name] = { version: browser.version(), ...data };
    const m = data.metrics;
    console.log(`${name} ${browser.version()}: middle -> alphabetic ${m.middle.alphabeticBaseline}, fontBoundingBox ${m.alphabetic.fontBoundingBoxAscent}/${m.alphabetic.fontBoundingBoxDescent}, em ${m.alphabetic.emHeightAscent}/${m.alphabetic.emHeightDescent}, actual ${m.alphabetic.actualBoundingBoxAscent}/${m.alphabetic.actualBoundingBoxDescent}`);
    for (const p of data.phases) {
      const same = p.sweep.filter((s) => s.hash === p.middle.hash).map((s) => s.d);
      console.log(`  phase ${p.phase.toFixed(3)}: middle ink rows ${p.middle.top}-${p.middle.bottom}; alphabetic offsets drawing the same pixels: ${same.length ? `${same[0]} .. ${same[same.length - 1]} (${same.length})` : "none"}`);
    }
    await browser.close();
  }
  fs.writeFileSync(path.join("probe-out", "baselines.json"), JSON.stringify(result));
}

main().catch((error) => { console.error(error); process.exit(1); });
