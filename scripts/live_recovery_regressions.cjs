/* Production camera -> detector -> tracking worker -> real Tesseract -> retry.
   The sole degradation is raster resampling of one printed cell. No OCR value,
   confidence, flag, quality score, corner or identity proof is injected. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { serve, engines, main } = require('./harness.cjs');
async function begin({ font, race = false }) {
  const { Scanner } = await import('./scanner.js');
  const { createLiveCamera } = await import('./live-camera.js');
  const cells = Array(81).fill(null);
  for (let k = 0; k < 27; k++) {
    const i = (k * 37 + 13) % 81, r = Math.floor(i / 9), c = i % 9;
    cells[i] = (r * 3 + Math.floor(r / 3) + c) % 9 + 1;
  }
  const source = document.createElement('canvas'); source.width = 720; source.height = 900;
  const ctx = source.getContext('2d'), tiny = document.createElement('canvas'); tiny.width = tiny.height = 20;
  const video = document.createElement('video'); video.muted = true; video.playsInline = true;
  video.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:250px;z-index:9998'; document.body.append(video);
  const out = document.createElement('canvas'); out.style.cssText = 'position:fixed;left:200px;top:0;width:200px;height:250px;z-index:9999'; document.body.append(out);
  const state = window.recoveryState = { font, race, sharp: false, changed: false, ticks: 0, full: [], retries: [], events: [], scheduling: null, worker: null, corners: [] };
  const pack = f => ({ cells: [...f.puzzle.cells], uncertain: [...(f.uncertain ?? [])], marked: [...(f.markedCells ?? [])], stats: f.ocrStats, recovery: f.recovery, needsReview: f.needsReview });
  function paint() {
    ctx.fillStyle = '#edf1f5'; ctx.fillRect(0, 0, 720, 900);
    // New MediaStream frames, with an out-of-grid changing witness.
    ctx.fillStyle = ++state.ticks % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 20, 20);
    for (let k = 0; k <= 9; k++) {
      ctx.strokeStyle = k % 3 ? '#a5aab3' : '#343c43'; ctx.lineWidth = k % 3 ? 1 : 3;
      ctx.beginPath(); ctx.moveTo(60 + k * 600 / 9, 180); ctx.lineTo(60 + k * 600 / 9, 780);
      ctx.moveTo(60, 180 + k * 600 / 9); ctx.lineTo(660, 180 + k * 600 / 9); ctx.stroke();
    }
    ctx.fillStyle = '#24282c'; ctx.font = `27px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    cells.forEach((v, i) => { if (v !== null) ctx.fillText(String(state.changed && i === 13 ? 9 : v), 60 + (i % 9 + .5) * 600 / 9, 180 + (Math.floor(i / 9) + .5) * 600 / 9); });
    if (!state.sharp) {
      const cell = 52, x = Math.round(60 + cell % 9 * 600 / 9) + 8, y = Math.round(180 + Math.floor(cell / 9) * 600 / 9) + 8;
      tiny.getContext('2d').drawImage(source, x, y, 50, 50, 0, 0, 20, 20);
      ctx.drawImage(tiny, 0, 0, 20, 20, x, y, 50, 50);
    }
    ctx.fillStyle = state.changed ? '#00ff00' : '#ff00ff'; ctx.fillRect(25, 0, 20, 20);
    state.stream?.getVideoTracks().forEach(track => track.requestFrame?.());
  }
  paint(); const stream = source.captureStream(12); video.srcObject = stream; state.stream = stream;
  const clock = setInterval(paint, 80);
  const reader = new Scanner(), detector = new Scanner();
  const diagnostics = {
    configure() {}, geometry(v) { state.corners = v.corners; },
    tracking(v) { state.worker = { ...v }; }, scheduling(v) { state.scheduling = { ...v }; },
    event(v) { state.events.push({ stage: v.stage, reason: v.reason, targets: v.targets, cancelledRead: v.cancelledRead }); if (state.events.length > 160) state.events.shift(); },
  };
  const camera = createLiveCamera({ $: id => document.getElementById(id), video, canvas: out, detector, diagnostics,
    getSettings: () => ({ type: 'sudoku', rows: 9, cols: 9, boxRows: 3, boxCols: 3, enabled: true, autoSolve: false }),
    reader: { prepare: () => reader.prepare(), cancel: o => reader.cancel(o),
      async read(...args) { const result = await reader.read(...args); state.full.push(pack(result)); return result; },
      async readCells(...args) {
        const job = { cells: [...args[3]], completed: false }; state.retries.push(job);
        const result = await reader.readCells(...args); job.result = pack(result);
        if (race) await new Promise(resolve => { state.releaseRetry = resolve; });
        else await new Promise(resolve => setTimeout(resolve, 350));
        job.completed = true; return result;
      } },
    solver: { prepare() {}, cancel() {}, invalidate() {}, solve() { throw Error('auto-solve is off in this recognition test'); } },
  });
  state.snapshot = () => {
    let capture = null;
    try { const c = camera.capture(); capture = c.found ? pack(c.found) : null; c.photo.width = c.photo.height = c.annotated.width = c.annotated.height = 0; } catch { /* no frame yet */ }
    return { font, race, full: state.full, retries: state.retries, events: state.events, scheduling: state.scheduling,
      worker: state.worker, corners: state.corners, capture, expected: cells, status: document.getElementById('camera-help').textContent };
  };
  state.changedPresented = () => out.getContext('2d').getImageData(30, 5, 1, 1).data[1] > 200;
  state.clear = () => { state.sharp = true; paint(); };
  state.change = () => { state.changed = true; paint(); };
  state.pause = () => video.pause(); state.resume = () => play();
  state.stop = () => { state.releaseRetry?.(); camera.stop(); clearInterval(clock); stream.getTracks().forEach(t => t.stop()); video.srcObject = null; video.remove(); out.remove(); source.width = source.height = tiny.width = tiny.height = 0; };
  async function play() {
    let deadline;
    try { await Promise.race([video.play(), new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Recovery fixture playback did not start')), 20000); })]); }
    finally { clearTimeout(deadline); }
  }
  state.visible = () => Number(out.dataset.recognised || 0) + Number(out.dataset.uncertain || 0) + Number(out.dataset.unknown || 0) > 0;
  await play(); camera.start();
}
async function run() {
  const server = await serve(), reports = [], failures = [];
  try {
    // A fresh browser process for each scene: WebKit's canvas-stream backend
    // may not restart playback after a stopped stream in the same process.
    for (const config of [{ font: 'Courier New', race: false }, { font: 'Courier New', race: true }]) {
      const file = `live-recovery-${config.race ? 'race' : 'clear'}.json`;
      try {
        await engines(file, async (page, report) => {
          report.cases = [];
          await page.goto(server.base); await page.waitForSelector('body[data-ready="true"]');
          const record = { ...config }; report.cases.push(record);
          try {
            await page.evaluate(begin, config);
            await page.waitForFunction(() => window.recoveryState.full.length && window.recoveryState.visible(), null, { timeout: 60000 });
            record.before = await page.evaluate(() => recoveryState.snapshot());
            assert.ok(record.before.full[0].uncertain.includes(52), 'real initial OCR must flag the degraded clue, without injected uncertainty');
            assert.equal(record.before.full.length, 1);
            assert.ok(record.before.full[0].marked.includes(52));
            await page.waitForTimeout(1200);
            assert.equal(await page.evaluate(() => recoveryState.retries.length), 0, 'unchanged evidence must not start an automatic retry');
            await page.evaluate(() => recoveryState.clear());
            if (config.race) {
              await page.waitForFunction(() => !!recoveryState.releaseRetry, null, { timeout: 30000 });
              await page.evaluate(() => recoveryState.change());
              await page.waitForFunction(() => recoveryState.changedPresented() && !recoveryState.visible() && recoveryState.events.some(e => e.reason === 'content-changed'), null, { timeout: 10000 });
              await page.evaluate(() => recoveryState.releaseRetry());
              await page.waitForFunction(() => recoveryState.full.length >= 2 && recoveryState.snapshot().capture?.cells[13] === 9, null, { timeout: 60000 });
              record.after = await page.evaluate(() => recoveryState.snapshot());
              assert.equal(record.after.full.length, 2, 'exactly one new full reading for the changed puzzle');
              assert.equal(record.after.capture.cells[13], 9, 'late old-grid retry cannot restore the prior printed clue');
              assert.ok(record.after.events.some(e => e.reason === 'content-changed'));
              assert.ok(!record.after.events.some(e => e.reason === 'targeted-complete'), 'the retired targeted reply must never commit');
            } else {
              await page.waitForFunction(() => recoveryState.events.some(e => e.reason === 'targeted-complete') && recoveryState.visible(), null, { timeout: 30000 });
              record.after = await page.evaluate(() => recoveryState.snapshot());
              assert.equal(record.after.full.length, 1, 'a clearer cell must not cause another whole-grid read');
              assert.equal(record.after.retries.length, 1);
              assert.ok(record.after.capture.recovery.proposals > 0);
              assert.deepEqual(record.after.retries[0].cells, [52]);
              assert.deepEqual(record.after.capture.cells, record.after.expected);
              assert.ok(record.after.capture.uncertain.includes(52)); assert.equal(record.after.capture.needsReview, true);
              record.before.full[0].cells.forEach((v, i) => { if (i !== 52) assert.equal(record.after.capture.cells[i], v, `protected cell ${i}`); });
              assert.ok(record.after.retries[0].result.stats.calls < record.before.full[0].stats.calls);
              await page.evaluate(() => recoveryState.pause()); await page.waitForTimeout(850);
              record.stalled = await page.evaluate(() => recoveryState.snapshot());
              assert.equal(record.stalled.capture, null, 'video stall must expire overlays without another callback');
              await page.evaluate(() => recoveryState.resume());
              await page.waitForFunction(() => !!recoveryState.visible(), null, { timeout: 10000 });
              record.resumed = await page.evaluate(() => recoveryState.snapshot());
              assert.equal(record.resumed.full.length, 1, 'brief stalled playback must retain the completed reading');
            }
            record.ok = true;
          } catch (error) {
            record.failure = error.stack; throw error;
          } finally {
            record.final = await page.evaluate(() => window.recoveryState?.snapshot()).catch(() => null);
            await page.evaluate(() => window.recoveryState?.stop()).catch(() => {});
          }
        }, { timeout: 60000 });
      } catch (error) { failures.push(error); }
      finally {
        const filePath = `browser-artifacts/${file}`;
        if (fs.existsSync(filePath)) reports.push(...JSON.parse(fs.readFileSync(filePath, 'utf8')));
      }
    }
    if (failures.length) throw failures[0];
  } finally {
    fs.mkdirSync('browser-artifacts', { recursive: true });
    fs.writeFileSync('browser-artifacts/live-recovery.json', JSON.stringify(reports, null, 2) + '\n');
    await server.close();
  }
}
module.exports = { run }; main(module, run);
