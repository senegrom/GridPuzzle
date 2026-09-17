/* Same-run production scanner and actual browser image decoding, never answer injection. */
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { measure, qualityCases } = require('./ocr_quality_regressions.cjs');
const BASELINE = 'cecdd9c34b2cc049fe969efede6d177aba700d4e';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function detailChecks() {
  const { retainPhotoSource, photoDetail, rotatePhotoSource } = await import('./photo-detail.js');
  const source = document.createElement('canvas'); source.width = 2400; source.height = 1600;
  const ctx = source.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 2400, 1600);
  for (let y = 0; y < 1600; y += 100) for (let x = 0; x < 2400; x += 100) {
    ctx.fillStyle = `rgb(${(x / 10) % 240},${(y / 7) % 240},${(x + y) % 255})`;
    ctx.fillRect(x, y, 100, 100);
  }
  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/jpeg', .95)), bytes = new Uint8Array(await blob.arrayBuffer());
  const cases = [];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
    const file = new Blob([bytes.slice(0, 2), exif, bytes.slice(2)], { type: 'image/jpeg' });
    const original = await createImageBitmap(file);
    let preview = document.createElement('canvas'); const scale = 1600 / Math.max(original.width, original.height);
    preview.width = Math.round(original.width * scale); preview.height = Math.round(original.height * scale);
    preview.getContext('2d').drawImage(original, 0, 0, preview.width, preview.height);
    retainPhotoSource(preview, file, { width: 2400, height: 1600 }); original.close();
    for (let rotation = 0; rotation < (orientation === 1 ? 4 : 1); rotation++) {
      const w = preview.width, h = preview.height,
        corners = [{ x: w * .2, y: h * .2 }, { x: w * .8, y: h * .2 }, { x: w * .8, y: h * .8 }, { x: w * .2, y: h * .8 }];
      const detail = await photoDetail(preview, corners);
      const sample = (canvas, x, y) => [...canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
      const expected = sample(preview, w * .43, h * .47),
        // Interior point relative to the four mapped corners; away from block edges.
        p = detail.corners, u = (.43 - .2) / .6, v = (.47 - .2) / .6,
        actual = sample(detail.image, p[0].x + u * (p[1].x - p[0].x), p[0].y + v * (p[3].y - p[0].y));
      cases.push({ orientation, rotation, enhanced: detail.enhanced, expected, actual,
        error: Math.max(...actual.map((value, i) => Math.abs(value - expected[i]))), width: detail.image.width, height: detail.image.height });
      detail.release();
      const rotated = document.createElement('canvas'); rotated.width = h; rotated.height = w;
      const context = rotated.getContext('2d'); context.translate(h, 0); context.rotate(Math.PI / 2); context.drawImage(preview, 0, 0);
      rotatePhotoSource(preview, rotated); preview.width = preview.height = 0; preview = rotated;
    }
    preview.width = preview.height = 0;
  }
  source.width = source.height = 0; return cases;
}

async function widePage({ font, candidate }) {
  const { Scanner } = await import('./scanner.js');
  const { retainPhotoSource, photoDetail } = await import('./photo-detail.js');
  const page = document.createElement('canvas'); page.width = 3200; page.height = 2400;
  const ctx = page.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, page.width, page.height);
  ctx.fillStyle = '#333'; ctx.font = '24px serif'; ctx.fillText('Daily puzzle — printed number recognition', 900, 650);
  const x = 1200, y = 850, cell = 60, size = cell * 9;
  ctx.strokeStyle = '#111';
  for (let k = 0; k <= 9; k++) {
    ctx.lineWidth = k % 3 === 0 ? 3 : 1;
    ctx.beginPath(); ctx.moveTo(x + k * cell, y); ctx.lineTo(x + k * cell, y + size);
    ctx.moveTo(x, y + k * cell); ctx.lineTo(x + size, y + k * cell); ctx.stroke();
  }
  const expected = Array(81).fill(null); ctx.fillStyle = '#111'; ctx.font = `25px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let k = 0; k < 27; k++) {
    const i = (k * 37 + 13) % 81, r = Math.floor(i / 9), c = i % 9, value = (r * 3 + Math.floor(r / 3) + c) % 9 + 1;
    expected[i] = value; ctx.fillText(String(value), x + (c + .5) * cell, y + (r + .5) * cell);
  }
  const blob = await new Promise((resolve) => page.toBlob(resolve, 'image/jpeg', .94));
  const bitmap = await createImageBitmap(blob, { resizeWidth: 1600, imageOrientation: 'from-image', resizeQuality: 'high' });
  const preview = document.createElement('canvas'); preview.width = bitmap.width; preview.height = bitmap.height; preview.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
  retainPhotoSource(preview, blob, { width: page.width, height: page.height }); page.width = page.height = 0;
  const scanner = new Scanner();
  try {
    const detected = await scanner.detect(preview);
    // Real detector output feeds both versions. Failed detection is reported,
    // never silently replaced with reference corners to improve the score.
    if (!detected.rows || !detected.cols) return { font, detection: false, detected };
    const detail = candidate ? await photoDetail(preview, detected.corners) : { image: preview, corners: detected.corners, enhanced: false, release() {} };
    const width = detail.image.width, height = detail.image.height;
    let found; try { found = await scanner.read(detail.image, detail.corners, 'sudoku', detected.rows, detected.cols); } finally { detail.release(); }
    const wrong = expected.flatMap((value, i) => found.puzzle.cells[i] === value ? [] : [{ cell: i, expected: value, actual: found.puzzle.cells[i] }]);
    return { font, detection: true, rows: detected.rows, cols: detected.cols, enhanced: detail.enhanced, width, height,
      expected, actual: found.puzzle.cells, wrong, flagged: found.uncertain,
      unsafe: wrong.filter((item) => !found.uncertain.includes(item.cell)), quality: detected.quality,
      correct: expected.filter((value, i) => Number.isInteger(value) && found.puzzle.cells[i] === value).length };
  } finally { scanner.cancel(); preview.width = preview.height = 0; }
}

async function alignmentChecks() {
  const { prepareScan } = await import('./scan-analysis.js');
  const source = document.createElement('canvas'); source.width = source.height = 400;
  const ctx = source.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 400); ctx.fillStyle = '#111';
  for (const x of [0,110,200,300,399]) ctx.fillRect(x,0,2,400);
  for (const y of [0,100,190,300,399]) ctx.fillRect(0,y,400,2);
  // A numeral near the old uniform crop's right limit, inside the actual cell.
  ctx.font = '38px Arial'; ctx.fillText('8', 72, 72);
  const prepared = prepareScan(ctx.getImageData(0,0,400,400),'latinsquare',4,4);
  return prepared.entries.filter((e) => e.kind === 'value');
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-input-')), reports = [],
    build = JSON.parse(fs.readFileSync('_site/build-info.json')).build;
  fs.cpSync('_site', path.join(temp,'baseline'), { recursive: true });
  fs.symlinkSync(path.resolve('_site'), path.join(temp,'candidate'), 'dir');
  for (const file of ['scanner.js','scan-analysis.js','geometry-worker.js','live-camera.js','photo-flow.js'])
    fs.writeFileSync(path.join(temp,'baseline',file), execFileSync('git',['show',`${BASELINE}:web/${file}`],{encoding:'utf8'})
      .replaceAll('__BUILD_ID__',build).replaceAll('./vendor/',`./vendor/${build}/`));
  const server = spawn('python',['-m','http.server','8781','--bind','127.0.0.1','--directory',temp],{stdio:'ignore'});
  try {
    let ready = false;
    for (let i=0;i<80;i++) { try { if ((await fetch('http://127.0.0.1:8781/')).ok) { ready=true; break; } } catch {} await pause(100); }
    assert.ok(ready);
    for (const [name,engine] of Object.entries({chromium,webkit})) {
      const browser = await engine.launch({headless:true}); const report = {browser:name,version:browser.version(), baseline:BASELINE,quality:[],wide:[],errors:[]};reports.push(report);
      try {
        const pages={};
        for (const version of ['baseline','candidate']) {
          const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
          const page=pages[version]=await context.newPage();page.on('pageerror',(e)=>report.errors.push(e.message));
          await page.goto(`http://127.0.0.1:8781/${version}/`);await page.waitForSelector('body[data-ready="true"]');
        }
        report.detail=await pages.candidate.evaluate(detailChecks);
        for (const item of report.detail) {assert.ok(item.enhanced);assert.ok(item.error<=8,JSON.stringify(item));assert.ok(Math.max(item.width,item.height)<=1800);}
        report.alignment={before:await pages.baseline.evaluate(alignmentChecks),after:await pages.candidate.evaluate(alignmentChecks)};
        assert.ok(report.alignment.after.some((e)=>e.cell===0&&e.refinedCell));
        const b=report.alignment.before.find((e)=>e.cell===0),a=report.alignment.after.find((e)=>e.cell===0);
        assert.ok(a.w>(b?.w||0),'retain more of the previously clipped glyph');
        for (const font of ['Arial','Times New Roman','Courier New']) {
          const pair={font,before:await pages.baseline.evaluate(widePage,{font,candidate:false}),after:await pages.candidate.evaluate(widePage,{font,candidate:true})};report.wide.push(pair);
          assert.ok(pair.before.detection&&pair.after.detection,`${name}/${font}: real grid detection`);
          assert.equal(pair.after.rows,9);assert.equal(pair.after.cols,9);assert.ok(pair.after.enhanced);
          const beforeWrong=new Set(pair.before.wrong.map((x)=>x.cell));
          assert.deepEqual(pair.after.wrong.filter((x)=>!beforeWrong.has(x.cell)),[],`${name}/${font}: no previously correct cell lost`);
          assert.deepEqual(pair.after.unsafe,[]);
          console.log(`${name}/wide/${font}: ${pair.before.correct} -> ${pair.after.correct}/27`);
        }
        const candidates=JSON.parse(fs.readFileSync('browser-artifacts/ocr-quality.json')).find((r)=>r.browser===name);
        assert.ok(candidates?.ok);assert.equal(candidates.version,report.version);
        for (const spec of qualityCases()) {
          const before=await pages.baseline.evaluate(measure,spec),after=candidates.scans.find((r)=>r.name===before.name&&r.variation===before.variation),prior=new Set(before.wrong.map((x)=>x.cell));
          report.quality.push({before,after});assert.ok(after);
          assert.deepEqual(after.wrong.filter((x)=>!prior.has(x.cell)),[],`${name}/${before.name}/${before.variation}: no previous correct cell lost`);
          assert.deepEqual(after.unsafe,[]);
        }
        assert.deepEqual(report.errors,[]);report.ok=true;
      } catch(e) {report.failure=e.stack;report.ok=false;throw e;} finally {await browser.close();}
    }
  } finally {
    server.kill();fs.mkdirSync('scan-input-artifacts',{recursive:true});fs.writeFileSync('scan-input-artifacts/scan-input.json',JSON.stringify(reports,null,2)+'\n');
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
module.exports={run};if(require.main===module)run().catch((e)=>{console.error(e);process.exitCode=1;});
