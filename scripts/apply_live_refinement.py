from pathlib import Path
root=Path('.');p=root/'web/live-session.js';s=p.read_text()
s=s.replace('      if (stored) { stored.result = null; stored.solveFinished = false; }\n      if (stored?.readComplete) status = "Clues read. Automatic solving is off; capture to review or play.";', '''      if (stored) {
        if (stored.result || stored.solveFinished)
          status = "Clues read. Automatic solving is off; capture to review or play.";
        stored.result = null; stored.solveFinished = false;
      }''')
s=s.replace("    const owns = () => active && id === generation && stored === base;\n    status =",'''    const owns = () => active && id === generation && stored === base;
    // A failed refinement must not retire a valid full reading. Retire only
    // this request; late replies cannot mutate the retained board or a retry.
    const failed = reason => {
      if (!owns()) return;
      generation++; pending = false; pendingRecovery = activeSample = null;
      clearDeadline(); cancelRead(); release(sample);
      base.result = autoSolve() ? oldResult : null;
      base.solveFinished = autoSolve() && oldSolveFinished;
      status = reason === 'retry-timeout'
        ? 'Clue retry timed out. Keeping the previous reading; capture to review.'
        : 'Could not re-read those clues. Keeping the previous reading; capture to review.';
      onEvent({ stage: 'checking', reason, cancelledRead: reason === 'retry-timeout' });
      validate();
    };
    status =''')
s=s.replace("deadline = setTimer(() => { if (owns()) reset('retry-timeout'); }, 90000);", "deadline = setTimer(() => failed('retry-timeout'), 90000);")
s=s.replace('''        if (!owns()) return;
        pendingRecovery = { base, result, cells, sample, oldResult, oldSolveFinished, finishedAt: now() };''','''        if (!owns()) return;
        // Reserve budget before starting, but refund work explicitly skipped
        // before OCR. Keep the inspected quality and cooldown to avoid a loop
        // on identical pixels; a later genuinely clearer frame is still eligible.
        if (result.identicalCrops === true || result.ocrStats?.calls === 0) {
          for (const cell of cells) recoveryAttempts.set(cell, Math.max(0, (recoveryAttempts.get(cell) ?? 1) - 1));
          activeSample = null;
          base.result = autoSolve() ? oldResult : null;
          base.solveFinished = autoSolve() && oldSolveFinished;
          status = 'No new clue evidence. Keeping the previous reading; waiting for a clearer frame.';
          onEvent({ stage: 'checking', reason: 'retry-skipped', targets: cells, calls: 0 });
          return;
        }
        pendingRecovery = { base, result, cells, sample, oldResult, oldSolveFinished, finishedAt: now() };''')
s=s.replace('''        if (owns()) {
          activeSample = null; base.result = autoSolve() ? oldResult : null; base.solveFinished = autoSolve() && oldSolveFinished;
          status = error.message || 'Could not re-read those clues. Capture to review.';
          onEvent({ stage: 'reading', reason: 'retry-failed' });
        }''', "        failed('retry-failed');")
s=s.replace('''    if (targets.length) {
      const cells =''','''    if (targets.length) {
      if (targets.every(cell => (recoveryAttempts.get(cell) ?? 0) >= 2)) {
        status = 'Automatic retries finished — capture to review the remaining clues.';
        say(status); onEvent({ stage: 'checking', reason: 'retry-exhausted', targets });
        return;
      }
      const cells =''')
s=s.replace('''        onEvent({ stage: 'checking', reason: 'clearer-frame-needed', targets }); return;''','''        status = 'Waiting for a clearer frame of the unclear clues. Capture to review them manually.';
        say(status); onEvent({ stage: 'checking', reason: 'clearer-frame-needed', targets }); return;''')
s=s.replace('''status = blocker ?? "Clues read — checking the current grid…";''','''status = blocker ?? (autoSolve() ? "Clues read — checking the current grid…"
          : "Clues read. Automatic solving is off; capture to review or play.");''')
s=s.replace('''    get busy() { return pending; },''','''    get busy() { return pending; },
    get settled() { return !!stored?.readComplete && !pending && !pendingRecovery; },''')
p.write_text(s)
p=root/'web/scan-diagnostics.js';s=p.read_text().replace("'clearer-frame-needed','targeted-complete'","'retry-skipped','retry-exhausted','video-stalled','clearer-frame-needed','targeted-complete'")
s=s.replace("  'retry-rejected':", "  'retry-skipped': 'No new crop evidence was read. The OCR retry allowance is unchanged; waiting for a clearer frame.',\n  'retry-exhausted': 'Automatic retries finished. Capture to review the remaining clues manually.',\n  'retry-timeout': 'The clue retry timed out. The previous reading is retained and only shown while verified.',\n  'retry-failed': 'The clue retry failed. The previous reading is retained; capture to review.',\n  'video-stalled': 'The camera has stopped presenting new frames. Old overlays are hidden; resume the camera or capture for review.',\n  'retry-rejected':")
p.write_text(s)

from pathlib import Path
root=Path('.');p=root/'web/live-camera.js';s=p.read_text()
s='import { createFrameScheduler } from "./live-frame-scheduler.js";\n'+s
s=s.replace('let active = false, timer = null, detection = null, epoch = 0, lastDetect = -Infinity;', 'let active = false, detection = null, epoch = 0, lastDetect = -Infinity;')
s=s.replace('if (!raw || !frame?.anchor || now() - sampledAt > MAX_TRACK_AGE)', 'if (!raw || !frame?.anchor || !scheduler.fresh || now() - sampledAt > MAX_TRACK_AGE)')
s=s.replace('      void track(videoFrame(video), key, owner);', '      // The next newly presented frame verifies this candidate. Do not sample\n      // the video here: a delayed detector must not refresh a stalled feed.')
s=s.replace('  function tick() {', '''  function syncSettings(width, height) {
    const next = getSettings(), identitySettings = { ...next };
    delete identitySettings.autoSolve;
    const key = JSON.stringify([identitySettings, width, height]);
    if (key !== settingsKey) {
      epoch++; diagnostics?.configure?.(next); settingsKey = key; setting = next; guide = guideFrame = null;
      tracker.reset(); discardCandidate(); proofs = {}; retryTrackingAt = 0;
      cancelDetection(); lastDetect = -Infinity; session.invalidate();
    }
  }
  function heartbeat() {
    if (!active) return;
    if (video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      syncSettings(Math.max(1, Math.round(video.videoWidth * scale)), Math.max(1, Math.round(video.videoHeight * scale)));
    }
    if (!scheduler.fresh || now() - sampledAt > MAX_TRACK_AGE) {
      proofs = {}; guide = null;
      session.suspend();
      if (!scheduler.fresh && raw) {
        diagnostics?.event({ stage: 'tracking', reason: 'video-stalled' });
      }
    }
    render();
    if (!scheduler.fresh && raw) say('Waiting for a new camera frame. Old readings are hidden; capture to review.');
    diagnostics?.scheduling?.(scheduler.stats);
  }
  const scheduler = createFrameScheduler({ video, now, setTimer, clearTimer,
    onFrame: tick, onHeartbeat: heartbeat, onError: error => say(error.message || 'Waiting for the camera…'),
    // Back off expensive snapshots when tracking is slow or a reading is
    // settled, but stay below the 500ms evidence deadline. Never queue history.
    interval: () => Math.max(session.settled ? 250 : 100,
      Math.min(300, (tracker.stats?.milliseconds ?? 0) * 1.5)),
  });
  function tick() {''')
start=s.index('      const next = getSettings(), identitySettings',s.index('  function tick()'))
end=s.index('      // On a stalled', start)
s=s[:start]+'      syncSettings(image.width, image.height);\n'+s[end:]
s=s.replace('    timer = setTimer(tick, 100);\n','')
s=s.replace('timer = setTimer(tick, 100); },', 'scheduler.start(); },')
s=s.replace('clearTimer(timer); timer = null; cancelDetection();', 'scheduler.stop(); cancelDetection();')
p.write_text(s)
# Test doubles provide frame clocks; absent metadata is not perpetual fresh video.
for name in ['live-camera-recovery.test.js','live-latency.test.js']:
 p=root/'web/tests'/name;s=p.read_text().replace('video: { videoWidth: 700, videoHeight: 700 }', 'video: { videoWidth: 700, videoHeight: 700, get currentTime() { return time / 1000; } }');p.write_text(s)
p=root/'web/scan-diagnostics.js';s=p.read_text().replace('counters = {}, tracking = {};','counters = {}, tracking = {}, scheduling = {};')
s=s.replace('counters = {}; tracking = {}; notify();', 'counters = {}; tracking = {}; scheduling = {}; notify();')
s=s.replace('    snapshot() {', '''    scheduling(stats) {
      scheduling = { mode: stats.mode === 'video-frame' ? 'video-frame' : 'fallback', fresh: !!stats.fresh };
      for (const key of ['observed','processed','skipped','duplicates','intervalMilliseconds']) scheduling[key] = number(stats[key]);
    },
    snapshot() {''')
s=s.replace('counters, tracking, geometry, lastReading:', 'counters, tracking, scheduling, geometry, lastReading:')
p.write_text(s)

for name in ['live-camera-recovery.test.js','live-latency.test.js']:
 p=root/'web/tests'/name;s=p.read_text().replace('  function result(job =', '  async function result(job =').replace('    return flush();', '    await flush();\n    await advance(100); // A detector reply cannot manufacture a new video frame.');p.write_text(s)
p=root/'web/tests/review-hardening.test.js';s=p.read_text().replace('video: { videoWidth: 700, videoHeight: 700 }','video: { videoWidth: 700, videoHeight: 700, get currentTime() { return time / 1000; } }');p.write_text(s)
p=root/'web/tests/live-camera-recovery.test.js';s=p.read_text().replace('  let time = 0, serial = 0, cancellations = 0;', '  let time = 0, serial = 0, cancellations = 0, frozenTime = null;')
s=s.replace('get currentTime() { return time / 1000; }','get currentTime() { return frozenTime ?? time / 1000; }')
s=s.replace('return { camera, timers, detections, readings, settings, advance, result, $, holdTracking', 'return { camera, timers, detections, readings, settings, advance, result, $, stall() { frozenTime = time / 1000; }, resume() { frozenTime = null; }, holdTracking')
s += '\n\ntest("stalled video loses overlays on the heartbeat without a new processing tick", async t => {\n const h=harness(t);await h.advance(100);await h.result();await h.advance(400);await h.result();\n assert.equal(h.readings.length,1);\n const {makePuzzle}=await import(\'../model.js\');const puzzle=makePuzzle(\'latinsquare\',2);puzzle.cells=[1,null,null,1];\n h.readings[0].resolve({puzzle,cellUncertain:[],uncertain:[],markedCells:[0,3],needsReview:true,notes:[]});await flush();\n assert.ok(h.camera.capture().found);\n h.stall();const detections=h.detections.length;await h.advance(600);\n assert.equal(h.camera.capture().found,null);assert.equal(h.camera.diagnosticSource().verified,false);\n assert.equal(h.detections.length,detections,\'heartbeat must not detect again from old video pixels\');\n assert.match(h.$(\'camera-help\').textContent,/new camera frame/);\n h.resume();await h.advance(100);assert.ok(h.camera.capture().found,\'unchanged source can be reverified\');\n assert.equal(h.readings.length,1,\'brief stalled delivery does not destroy OCR\');\n});\n\ntest("a detector finishing on a stalled feed cannot manufacture fresh evidence", async t => {\n const h=harness(t);await h.advance(100);h.stall();await h.advance(600);await h.result();\n assert.equal(h.readings.length,0);assert.equal(h.camera.diagnosticSource().verified,false);\n assert.equal(h.camera.capture().found,null);\n});\n'
p.write_text(s)

import subprocess
expected = {'web/live-camera.js': '17dc48db17fb8e27b1ec6147f8853ae37303defb', 'web/live-frame-scheduler.js': '2a16fe478d8aeb7e9e09c1c789ed96a87c3801e5', 'web/live-session.js': '6663fcea956f9c0fe3f7c89611250035cbe882f7', 'web/scan-diagnostics.js': 'ad3b6c85bf3157e89b6be75a9588ac49b640f1e2', 'web/tests/live-camera-recovery.test.js': '095f13a5b158fb79f0ad80432991fac732518a7a', 'web/tests/live-frame-scheduler.test.js': 'a23334a431d83f84ad05a4ec54828028f9db13b6', 'web/tests/live-latency.test.js': 'e8fc27e7b7ec109c6878ef823f80237284058656', 'web/tests/retry-lifecycle.test.js': '3cd5b588d1b8d45abc8c74ebd30cab38a6208d3b', 'web/tests/review-hardening.test.js': '2899ca9df4e3af829d712a55274b88683551a228'}
for path, sha in expected.items():
 assert subprocess.check_output(['git','hash-object',path],text=True).strip() == sha, path
