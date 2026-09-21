# Fresh frames and safe live refinement

This follow-up keeps the tracking worker, numeric-only targeted reads and private
diagnostics of PR #66. It does not change the detector, OCR model, content
identity thresholds, puzzle classification or native solver.

## Retry lifecycle

A failed or timed-out targeted read retires only its own request. The preceding
full reading and source remain available, but only current identity verification
can authorize their display. Late responses cannot restore a retired scene or
replace a newer retry. Long scene loss, changed content/settings and Stop still
invalidate ownership through the existing rules.

Each cell has two automatic read attempts. Requests reserve an attempt before
starting; an explicit identical-crop skip or zero-OCR result refunds it. The
inspected quality and 1.5-second cooldown remain, so unchanged evidence cannot
cause a busy loop. An error or timeout conservatively consumes its reservation.
When all remaining cells are exhausted, status and diagnostics ask for manual
review rather than continuing to promise an automatic retry.

## Frame scheduling

`live-frame-scheduler.js` uses one-shot video-frame callbacks where supported.
Presentation counts distinguish genuinely new frames, including live streams
whose media timestamp is zero. The fallback prefers decoded-frame counts, then
an advancing media clock. Missing or repeated metadata cannot manufacture fresh
video. Repeated starts and shutdown fence all old callbacks.

Expensive snapshots run at most every 100ms, back off to 250ms once a reading is
settled, and up to 300ms when recent worker timing calls for it. The existing
latest-frame queue stays bounded. A separate 100ms heartbeat expires overlays
when presentation or accepted tracking evidence is over 500ms old, even when no
new video callback arrives. Detector completion itself never samples a stalled
video to fabricate fresh evidence. These are processing intervals, not sensor
frame rates or a measured phone performance improvement.

## End-to-end regression

`scripts/live_recovery_regressions.cjs` supplies a real canvas MediaStream to the
production camera, detector, tracking worker and Tesseract. One printed cell is
resampled to simulate lost optical detail; the next phase restores the original
raster. No OCR values, confidence, uncertainty, quality scores, corners or
identity proofs are inserted into the pipeline. Reference values score output
only. A real targeted reply can be delayed to test a changed puzzle, and paused
playback tests the independent freshness heartbeat. Existing artificial-flag
API tests remain separate and are not claimed as automatic recovery tests.

The fixed synthetic cases are regression controls, not a representative image
corpus or proof of increased transcription accuracy. A naturally uncertain
reading may already contain the correct number; re-reading better pixels must
still leave it reviewable. Raw before/after values, flags, calls and scheduling
statistics are retained in `live-recovery.json`. Physical-iPhone latency,
battery, memory and general OCR accuracy require separate measurements.
