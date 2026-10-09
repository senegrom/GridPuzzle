/* Production camera -> detector -> tracking worker -> real Tesseract -> retry.
   The sole degradation is a blur of one printed clue. No OCR value,
   confidence, flag, quality score, corner or identity proof is injected. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { serve, engines, main } = require('./harness.cjs');
// Once playback stops, the overlay must expire as soon as the newest
// presented frame is older than the frame scheduler's freshness limit
// (web/live-frame-scheduler.js: fresh while now() - lastSeen <= 500), well
// before the two-second STALE_TRACK_AGE. capture() checks it itself; the
// margin covers the polling interval and a busy runner.
const PRESENTATION_FRESHNESS = 500, MARGIN = 500;
// page.waitForFunction for a decision of the live session: a timeout fails
// with the decision that was expected, not only with the time spent.
async function decided(page, predicate, timeout, expected, arg = null) {
  try { return await page.waitForFunction(predicate, arg, { timeout }); }
  catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    throw new assert.AssertionError({ message: `${expected} (nothing within ${timeout / 1000} s)` });
  }
}
async function begin({ font, race = false }) {
  const { Scanner } = await import('./scanner.js');
  const { createLiveCamera } = await import('./live-camera.js');
  const cells = Array(81).fill(null);
  for (let k = 0; k < 27; k++) {
    const i = (k * 37 + 13) % 81, r = Math.floor(i / 9), c = i % 9;
    cells[i] = (r * 3 + Math.floor(r / 3) + c) % 9 + 1;
  }
  const source = document.createElement('canvas'); source.width = 720; source.height = 900;
  const ctx = source.getContext('2d'), scratch = document.createElement('canvas');
  const video = document.createElement('video'); video.muted = true; video.playsInline = true;
  video.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:250px;z-index:9998'; document.body.append(video);
  const out = document.createElement('canvas'); out.style.cssText = 'position:fixed;left:200px;top:0;width:200px;height:250px;z-index:9999'; document.body.append(out);
  const state = window.recoveryState = { font, race, clearer: false, changed: false, ticks: 0, full: [], retries: [], events: [], seq: 0, scheduling: null, worker: null, corners: [] };
  const pack = f => ({ cells: [...f.puzzle.cells], uncertain: [...(f.uncertain ?? [])], marked: [...(f.markedCells ?? [])], stats: f.ocrStats, recovery: f.recovery, needsReview: f.needsReview });
  // The retried clue is cell 52's 6, blurred; clear() makes it clearer. The
  // session re-reads that clue alone only if the reading flagged the blurred
  // clue and the content comparison (web/live-content.js) finds the clearer
  // frame to be the same print. Both turn on a few samples, so the scene
  // keeps each far from its limit, wherever an engine's digits land:
  // - The comparison's structural strips accept almost no change (they guard
  //   cage labels and signs): label strips sample the top .36 of a cell, and
  //   the strips along each shared boundary the quarter of a cell on either
  //   side of it. So each digit's ink is centred in the band between them, at
  //   .5425 of its cell's height, and only the window [.29, .71] x [.385, .70]
  //   of cell 52 is blurred, 1-2 px clear of every strip where the detector
  //   puts the grid. (Resampling a 50 px square there, as this scene once did,
  //   blurred the top label strip too, and a digit 1 px higher made the
  //   clearer frame changed print.)
  // - The blur is a Gaussian computed here, so both engines blur the raster
  //   they drew the same way; a 2.5 px decimation by drawImage kept or dropped
  //   whole strokes with the digit's phase, and at most offsets the OCR then
  //   read the blurred 6 without a flag. At sigma 2.5 px neither single-
  //   character read finds a digit, so the clue is flagged at every offset.
  //   The clearer frame is not sharp but sigma 1 px: both single-character
  //   reads find the 6, its focus score is at least twice the blurred one's,
  //   and its cell signature stays within 70% of the comparison's limits
  //   (a sharp one exceeded them at some offsets).
  // Measured at 17 digit offsets of up to 3 px, in both engines, with the
  // production stages (see the pull request that introduced this scene).
  const CELL = 600 / 9, BLURRED = 2.5, CLEARER = 1;
  const area = { x: Math.round(60 + 7.29 * CELL), y: Math.round(180 + 5.385 * CELL) };
  area.w = Math.round(60 + 7.71 * CELL) - area.x; area.h = Math.round(180 + 5.7 * CELL) - area.y;
  function blur(sigma) {
    const r = Math.ceil(3 * sigma), w = area.w + 2 * r, h = area.h + 2 * r, kernel = [];
    for (let i = -r; i <= r; i++) kernel.push(Math.exp(-i * i / (2 * sigma * sigma)));
    const sum = kernel.reduce((a, b) => a + b);
    scratch.width = w; scratch.height = h;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(source, area.x - r, area.y - r, w, h, 0, 0, w, h);
    const input = sctx.getImageData(0, 0, w, h).data, columns = new Float64Array(area.h * w * 3), blurred = sctx.createImageData(area.w, area.h);
    for (let y = 0; y < area.h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let v = 0; for (let k = 0; k <= 2 * r; k++) v += kernel[k] * input[((y + k) * w + x) * 4 + c];
      columns[(y * w + x) * 3 + c] = v / sum;
    }
    for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
      for (let c = 0; c < 3; c++) {
        let v = 0; for (let k = 0; k <= 2 * r; k++) v += kernel[k] * columns[(y * w + x + k) * 3 + c];
        blurred.data[(y * area.w + x) * 4 + c] = Math.round(v / sum);
      }
      blurred.data[(y * area.w + x) * 4 + 3] = 255;
    }
    ctx.putImageData(blurred, area.x, area.y);
  }
  function paint() {
    ctx.fillStyle = '#edf1f5'; ctx.fillRect(0, 0, 720, 900);
    // New MediaStream frames, with an out-of-grid changing witness.
    ctx.fillStyle = ++state.ticks % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 20, 20);
    for (let k = 0; k <= 9; k++) {
      ctx.strokeStyle = k % 3 ? '#a5aab3' : '#343c43'; ctx.lineWidth = k % 3 ? 1 : 3;
      ctx.beginPath(); ctx.moveTo(60 + k * 600 / 9, 180); ctx.lineTo(60 + k * 600 / 9, 780);
      ctx.moveTo(60, 180 + k * 600 / 9); ctx.lineTo(660, 180 + k * 600 / 9); ctx.stroke();
    }
    // The ink of a 0 sets the baseline, the same for every digit of this font.
    ctx.fillStyle = '#24282c'; ctx.font = `24px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const ink = ctx.measureText('0'), lift = (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2;
    // The changed puzzle of the race: clue 13 turns from 8 to 7, and a 9 is
    // added in cell 14, a change the comparison catches at twice its limit.
    const shown = state.changed ? Object.assign([...cells], { 13: 7, 14: 9 }) : cells;
    shown.forEach((v, i) => { if (v !== null) ctx.fillText(String(v), 60 + (i % 9 + .5) * CELL, 180 + (Math.floor(i / 9) + .5425) * CELL + lift); });
    blur(state.clearer ? CLEARER : BLURRED);
    ctx.fillStyle = state.changed ? '#00ff00' : '#ff00ff'; ctx.fillRect(25, 0, 20, 20);
    state.stream?.getVideoTracks().forEach(track => track.requestFrame?.());
  }
  paint(); const stream = source.captureStream(12); video.srcObject = stream; state.stream = stream;
  const clock = setInterval(paint, 80);
  const reader = new Scanner(), detector = new Scanner();
  const diagnostics = {
    configure() {}, geometry(v) { state.corners = v.corners; },
    tracking(v) { state.worker = { ...v }; }, scheduling(v) { state.scheduling = { ...v }; },
    event(v) { state.events.push({ seq: ++state.seq, stage: v.stage, reason: v.reason, targets: v.targets, cancelledRead: v.cancelledRead }); if (state.events.length > 160) state.events.shift(); },
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
      worker: state.worker, corners: state.corners, capture, expected: cells,
      playback: { started: !!state.started, error: state.startError ?? null, readyState: video.readyState, paused: video.paused,
        width: video.videoWidth, height: video.videoHeight, ticks: state.ticks, currentTime: video.currentTime }, status: document.getElementById('camera-help').textContent };
  };
  // The witness of the frame the camera adopted last, the frame its proofs
  // verified (the display canvas holds only an outline over the video).
  state.changedPresented = () => { const frame = camera.adoptedFrame(); return !!frame && frame.getContext('2d').getImageData(30, 5, 1, 1).data[1] > 200; };
  state.clear = () => { state.clearer = true; paint(); };
  state.change = () => { state.changed = true; paint(); };
  // The reading's resets (live-session.js reset()) after event `since`, by
  // reason; a failed tracking worker resets it as 'settings-or-detection'.
  const RESETS = ['reset', 'started', 'stopped', 'content-changed', 'grid-lost', 'settings-or-detection', 'frozen', 'cleared'];
  state.resetsSince = since => state.events.filter(e => e.seq > since && e.stage === 'tracking' && RESETS.includes(e.reason)).map(e => e.reason);
  // Whether, after event `since`, the session gave the reading up or read the
  // whole grid again instead of re-reading the clue alone.
  state.abandoned = since => state.full.length > 1 || state.resetsSince(since).length > 0;
  state.pause = () => video.pause(); state.resume = () => play();
  state.stop = () => { state.releaseRetry?.(); camera.stop(); startButton.remove(); clearInterval(clock); stream.getTracks().forEach(t => t.stop()); video.srcObject = null; video.remove(); out.remove(); source.width = source.height = scratch.width = scratch.height = 0; };
  async function play() {
    let deadline;
    try { await Promise.race([video.play(), new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Recovery fixture playback did not start')), 20000); })]); }
    finally { clearTimeout(deadline); }
  }
  state.visible = () => Number(out.dataset.recognised || 0) + Number(out.dataset.uncertain || 0) + Number(out.dataset.unknown || 0) > 0;
  // The production camera is opened by a user's click. Do not make this
  // regression depend on a cold WebKit canvas stream accepting autoplay.
  // This starts actual playback; it never supplies frames/identity to the app.
  const startButton = document.createElement('button'); startButton.id = 'recovery-start';
  startButton.textContent = 'Start test video';
  startButton.style.cssText = 'position:fixed;left:0;top:265px;z-index:10000';
  document.body.append(startButton);
  startButton.onclick = async () => {
    startButton.disabled = true;
    try { await play(); camera.start(); state.started = true; }
    catch (error) { state.startError = error.message; }
  };
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
            await page.click('#recovery-start');
            await page.waitForFunction(() => recoveryState.started || recoveryState.startError, null, { timeout: 25000 });
            assert.equal(await page.evaluate(() => recoveryState.startError ?? null), null, 'test video must actually start before camera acceptance');
            const beforeHandle = await decided(page, () => {
              if (!recoveryState.full.length || !recoveryState.visible()) return false;
              const value = recoveryState.snapshot(); return value.capture ? value : false;
            }, 60000, 'the camera must complete a first reading of the grid');
            record.before = await beforeHandle.jsonValue(); await beforeHandle.dispose();
            assert.ok(record.before.full[0].uncertain.includes(52), 'real initial OCR must flag the degraded clue, without injected uncertainty');
            assert.equal(record.before.full.length, 1);
            assert.ok(record.before.full[0].marked.includes(52));
            // The session reports each declined retry; wait for the decision itself rather than a guess at when it happens.
            await decided(page, () => recoveryState.events.some(e => e.reason === 'clearer-frame-needed'), 15000, 'the session must decline a retry while the clue is unchanged');
            assert.equal(await page.evaluate(() => recoveryState.retries.length), 0, 'unchanged evidence must not start an automatic retry');
            // Until the clue clears, the first reading must stand: a reset or
            // a second read before then (a tracking worker timing out on a
            // loaded host, say) is not what the rest of this test judges.
            const readSeq = await page.evaluate(() => recoveryState.events.find(e => e.reason === 'read-complete')?.seq ?? 0);
            const standing = await page.evaluate(since => ({ resets: recoveryState.resetsSince(since), reads: recoveryState.full.length }), readSeq);
            assert.ok(!standing.resets.length && standing.reads === 1, `the first reading must stand until the clue clears (resets: ${standing.resets.join(', ') || 'none'}; full reads: ${standing.reads})`);
            const clearSeq = await page.evaluate(() => { recoveryState.clear(); return recoveryState.seq; });
            // The clearer frame shows the same print, so the session must
            // re-read the clue alone. The waits also end when it resets the
            // reading (as changed print, say) or reads the whole grid again,
            // which then fails with that reason instead of a timeout.
            const sameJudgement = resets => `the clearer frame shows the same print, so nothing may reset the reading, but it was reset (${resets.join(', ')})`;
            const judged = () => page.evaluate(since => ({ resets: recoveryState.resetsSince(since), reads: recoveryState.full.length }), clearSeq);
            if (config.race) {
              await decided(page, since => !!recoveryState.releaseRetry || recoveryState.abandoned(since), 30000, 'a clearer frame of the flagged clue must start its targeted re-read', clearSeq);
              const started = await judged();
              assert.deepEqual(started.resets, [], sameJudgement(started.resets));
              assert.equal(started.reads, 1, 'a clearer cell must not cause another whole-grid read');
              await page.evaluate(() => recoveryState.change());
              await decided(page, () => recoveryState.changedPresented() && !recoveryState.visible() && recoveryState.events.some(e => e.reason === 'content-changed'), 10000, 'the changed puzzle must count as changed print');
              await page.evaluate(() => recoveryState.releaseRetry());
              const changedHandle = await decided(page, () => {
                if (recoveryState.full.length < 2) return false;
                const value = recoveryState.snapshot(); return value.capture?.cells[13] === 7 && value.capture.cells[14] === 9 ? value : false;
              }, 60000, 'the changed puzzle must be read again');
              record.after = await changedHandle.jsonValue(); await changedHandle.dispose();
              assert.equal(record.after.full.length, 2, 'exactly one new full reading for the changed puzzle');
              assert.equal(record.after.capture.cells[13], 7, 'late old-grid retry cannot restore the prior printed clue');
              assert.ok(record.after.events.some(e => e.reason === 'content-changed'));
              assert.ok(!record.after.events.some(e => e.reason === 'targeted-complete'), 'the retired targeted reply must never commit');
            } else {
              const afterHandle = await decided(page, since => {
                if (recoveryState.abandoned(since)) return recoveryState.snapshot();
                if (!recoveryState.events.some(e => e.reason === 'targeted-complete') || !recoveryState.visible()) return false;
                const value = recoveryState.snapshot(); return value.capture ? value : false;
              }, 30000, 'a clearer frame of the flagged clue must be re-read', clearSeq);
              record.after = await afterHandle.jsonValue(); await afterHandle.dispose();
              const reread = await judged();
              assert.deepEqual(reread.resets, [], sameJudgement(reread.resets));
              assert.equal(record.after.full.length, 1, 'a clearer cell must not cause another whole-grid read');
              assert.equal(record.after.retries.length, 1);
              assert.ok(record.after.capture.recovery?.proposals > 0, 'the targeted re-read must propose a digit for the clearer clue');
              assert.deepEqual(record.after.retries[0].cells, [52]);
              assert.deepEqual(record.after.capture.cells, record.after.expected);
              assert.ok(record.after.capture.uncertain.includes(52)); assert.equal(record.after.capture.needsReview, true);
              record.before.full[0].cells.forEach((v, i) => { if (i !== 52) assert.equal(record.after.capture.cells[i], v, `protected cell ${i}`); });
              assert.ok(record.after.retries[0].result.stats.calls < record.before.full[0].stats.calls);
              const pausedAt = Date.now(); await page.evaluate(() => recoveryState.pause());
              await page.waitForFunction(() => recoveryState.snapshot().capture === null, null, { polling: 100, timeout: PRESENTATION_FRESHNESS + MARGIN });
              record.expiredAfter = Date.now() - pausedAt;
              record.stalled = await page.evaluate(() => recoveryState.snapshot());
              assert.equal(record.stalled.capture, null, 'video stall must expire overlays without another callback');
              await page.evaluate(() => recoveryState.resume());
              const resumedHandle = await decided(page, () => {
                if (!recoveryState.visible()) return false;
                const value = recoveryState.snapshot(); return value.capture ? value : false;
              }, 10000, 'the reading must return once playback resumes');
              record.resumed = await resumedHandle.jsonValue(); await resumedHandle.dispose();
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
