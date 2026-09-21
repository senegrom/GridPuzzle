# Preview efficiency, recovery and clue-review hardening

This batch extends draft PR #66; it does not publish the branch, change OCR
models/identity thresholds or use solver answers as recognition evidence.

## Preview work and numeric diagnostics

Every heartbeat still validates freshness and current solver preferences. A
visual-state cache skips painting the same raw image, geometry, reading and
solution twice. A new frame, changed proposal, solution toggle or expired proof
invalidates that cache immediately. Captures still synchronously validate and
copy the exact displayed image, not a later video frame. The preview solver is
warmed only while auto-solve is enabled, once per live-camera lifetime.

Diagnostic reports add bounded numeric timing windows (128 recent samples),
render requests versus actual paints, and time to the first completed reading.
P50/P95 describe the window; means/maxima/counts describe the session. Repeated
updates to the same frame do not double-count its tracking measurement. These
are app timings, not physical sensor frame rates, memory or battery estimates.

## Callback and worker recovery

A silently stalled native video callback can fall back only after two independent
frame-counter advances, with a new advance at the transition itself. A timer or
advancing media clock alone does not bypass a stalled native callback. Dropped
frames are subtracted from the available presentation counter. Late callbacks
are fenced after switching. The 500ms freshness deadline and identity checks
still apply; a genuinely frozen camera stays unverified.

Tracking failures back off for two and four seconds, then stop automatically
after the third consecutive failure. A single successful message does not reset
the streak: two seconds of sustained verified work do. The Restart live scanning
button explicitly retires prior work and restarts callbacks/tracking. Manual
capture remains available. Stop releases scratch canvases and pending read
samples as well as shutting down timers/workers.

API semantics: https://wicg.github.io/video-rvfc/ and
https://w3c.github.io/media-playback-quality/ .

## Re-read this clue

The existing cell dialog offers a numeric-only re-read for uncertain cells with
a matching retained rectified photograph. It shows a proposal beside the current
field without changing either the field or puzzle. Use proposal copies it to the
field; the existing Save operation confirms that one clue and remains undoable.
Confident/confirmed cells, Play answers, missing/mismatched photos and structural
Kakuro/cage targets are excluded. Nothing is inferred from a solution.

Exact cell pixels cache up to eight proposals per weakly-held source. Repeated
clicks reuse the proposal instead of issuing more OCR. New source pixels cause a
new read. Closing/reopening the editor, changing the source/puzzle or editing the
draft fences late results. A 90-second deadline retains the unchanged draft.
The cache never promotes confidence. Imported photos are not persisted/exported
by this feature.

## Tests and measurement limits

- `editor_reread_regressions.cjs`: real application, modal, input controls, Save
  and Undo with controlled OCR completions; it is a UI/transaction test.
- `live_soak_regressions.cjs`: twenty repeated sessions, resolution changes and
  delayed actual tracking-worker replies. Controlled canvas-video clocks/OCR
  isolate resource ownership. Worker counts, owned timers and source/scratch
  buffers must return to zero. This is not a heap or physical-device benchmark.
- `external_replay_regressions.cjs`: the first three entries of the existing
  SHA256-selected Lexski test slice, fixed before running recognition. Actual
  MediaStreams go through the production automatic detector, worker and OCR.
  Reference corners/values never enter the recognition path. The report keeps
  no-read/quality rejections, errors, natural uncertainty, and cell-level scores;
  ambiguous pencil annotations are reported separately rather than treated as
  printed givens. This establishes broader measured coverage, not a promise
  that arbitrary external images pass OCR. No-read and mismatched-cell results
  are retained, not performance-filtered away.

Existing synthetic recovery/motion and strict newspaper quality gates remain.
The new UI/soak tests run against the exact built app before deployment. External
replay runs in Scanner quality and records its complete corpus results. Hardware
memory, battery use, autofocus and native VoiceOver still need device testing.
