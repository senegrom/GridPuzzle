// Offline probe of the live-recovery scene: draws the suite's frame (blurred
// and sharp) with the digits shifted by (dx, dy), and runs the production
// stages on it directly in the page: detection + quality, the tracking core's
// anchor match and verification (the session's "same scene" decision), an
// instrumented copy of the content comparison (per-region statistics), a full
// OCR read of the blurred frame, clearerCells and a targeted read of the sharp
// frame.
//
//   node probe_offline.cjs <configs.json> <out.json>
//
// ENGINE=chromium|webkit, WT=<worktree> (default E:/tmp-claude/wt-recovery).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const WT = process.env.WT || process.cwd();
const configsFile = path.resolve(process.argv[2]), outFile = path.resolve(process.argv[3]);
process.chdir(WT);
const playwright = require(path.join(WT, "node_modules/playwright"));
const { serve } = require(path.join(WT, "scripts/harness.cjs"));
const scene = fs.readFileSync(path.join(__dirname, "probe_scene.js"), "utf8");

async function main() {
  const configs = JSON.parse(fs.readFileSync(configsFile, "utf8"));
  const server = await serve();
  const engine = process.env.ENGINE || "chromium";
  const browser = await playwright[engine].launch({ headless: true });
  const results = [];
  try {
    const context = await browser.newContext({ bypassCSP: true, serviceWorkers: "block", viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("pageerror", e.message));
    await page.goto(server.base);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 180000 });
    await page.addScriptTag({ content: scene });
    console.log(engine, browser.version());
    for (const config of configs) {
      const started = Date.now();
      let r;
      try { r = await page.evaluate((c) => window.probeScene(c), config); }
      catch (error) { r = { config, error: String(error.stack || error) }; }
      r.engine = engine; r.version = browser.version(); r.seconds = (Date.now() - started) / 1000;
      results.push(r);
      console.log(line(r));
      fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
    }
  } finally {
    await browser.close();
    await server.close();
  }
}
function line(r) {
  if (r.error) return `${JSON.stringify(r.config)} ERROR ${r.error.split("\n")[0]}`;
  const c = r.config, o = r.ocr, t = r.track;
  const fails = (r.stats?.failing ?? []).map((f) => `${f.where}:${f.test}=${f.best.toFixed(2)}`).join(",");
  return [`${c.label ?? ""} dx=${c.dx ?? 0} dy=${c.dy ?? 0}`,
    o ? `ocr52=${o.cell52.text}/${o.cell52.confidence} unc=${o.cell52.uncertain} mark=${o.cell52.marked} wrong=[${o.wrong}] uncOther=[${o.uncertainOthers}]` : "ocr=skip",
    `anchorMatch=${t.anchorMatch} verify=${t.verifyProof}${t.rejection ? `(${t.rejection.reason}:${t.rejection.region})` : ""}`,
    `q52 D=${r.D.q52 ? r.D.q52.score.toFixed(1) + "/" + r.D.q52.contrast : "none"} S=${r.S.q52 ? r.S.q52.score.toFixed(1) + "/" + r.S.q52.contrast : "none"} clearer=[${r.clearer ?? ""}]`,
    r.targeted ? `targeted52=${r.targeted.value52} prop=${r.targeted.proposals}` : "",
    `fails=[${fails}]`, `${r.seconds.toFixed(1)}s`].join(" | ");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
