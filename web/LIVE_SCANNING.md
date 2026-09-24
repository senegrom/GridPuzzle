# Live camera scanning and saved pictures

Open **Scan with camera** and hold the whole grid steady. The camera remains open
while recognition and the local Python solver work in the background of the
interface. No second board or confirmation dialog is needed for the live preview.
The existing **Read stable camera frames automatically** setting can pause this
recognition; it no longer presses the shutter automatically.

## Colours and evidence

Green numbers are recognised printed values. Yellow numbers with a question mark
are uncertain readings. A red `?` means an unresolved cell, including a printed
mark OCR could not read. Blue numbers are entries from a completed, unique solution
to the current transcription. Slitherlink solution edges are blue too. Blank black
cells are not answer slots. A retained unread printed mark is never painted over
in blue. Recognition can still fail when the photograph contains insufficient
visible evidence; preview colours are not a guarantee of correct transcription.

Live solutions are explicitly **previews**, not confirmation that the photograph
or inferred rules are right. Conflicting readings, incomplete structural data,
unread printed digits and nonunique results do not produce blue answers. Numeric
readings flagged for review can participate in a labelled preview, but remain
yellow. Inferred family/box settings and all OCR warnings are preserved when
**Review captured clues** transfers a capture to the editor. The usual confirmation
requirement still applies to Solve, Check and Hint there.

If the detected grid contradicts the selected rules (a 9 × 6 board while Sudoku
is selected, a 12 × 12 Str8ts), the outline is shown with the reason and no
cell overlay is attempted until the type or the grid settings change.

The camera waits for stable detections and chooses the sharper sampled frame.
Local image changes invalidate the overlay and cancel obsolete recognition and
solving. Only one recognition job and one preview solve are active. Once a
complete unique preview is showing, a still scene is not read again until the
picture or the settings change, or autofocus yields a substantially sharper
frame. An unresolved scene retries with a doubling
interval (3, 6, 12, then 24 seconds), so an unreadable page does not keep OCR
busy. A sampled frame is released as soon as recognition has used it, and the
preview runtime is loaded when the camera opens and reloaded in the background
after a search budget had to terminate it. Recognition has a 90-second deadline, after which the camera can retry. The preview
solver has a 90-second runtime-loading deadline and an 8-second search budget;
the full editor still supports its longer configurable budgets. Detection,
recognition and solving use workers. Closing the camera, backgrounding the page,
changing settings or losing the stream cancels the appropriate work. Frames that
are never explicitly captured are never stored.

## Shutter and storage

**Save picture** freezes and stores the exact annotated camera frame that was on
screen, including the colour legend and PREVIEW label. The camera stops and the
picture remains on the same screen, also when the page is hidden meanwhile (an
app switch, the lock screen, a download prompt): only a live camera is released
on hide, a captured still holds no camera. Escape closes the camera panel like a
dialog and returns focus to the Scan button. It is not a fresh, differently positioned
camera frame, and the coloured overlay is never fed back into OCR.

The latest captured PNG is saved as exact binary bytes in this browser's IndexedDB,
including on WebKit backends that cannot store Blob objects. A new capture
replaces the previous one only after its transaction succeeds. It appears under
**Last saved picture** after reload. **Download PNG** exports a separate copy;
**Delete saved picture** removes the browser copy. Web apps do not silently add
pictures to the system Photos library. Private-mode restrictions, storage quotas,
or browser eviction may prevent persistence; failures are displayed and the
in-memory picture remains downloadable. Download important pictures separately.

This changes the previous photo policy only for an explicit shutter press.
Ordinary imported photographs and other live frames are still not persisted or
uploaded. Only one captured PNG is retained; there is no hidden camera history.

## Dim printed marks and additional OCR pass

A low-resolution white digit on a black cell can become too dim for the fixed
white-pixel threshold. When that first mark detector finds no glyph, a bounded
local-contrast fallback now looks for a substantial connected central mark.
Flat black cells and shallow texture are excluded; recovered glyphs remain
flagged even when the readers agree. This only supplies observed image regions
to OCR; it does not invent the numeric value.

The existing atlas, binary and grayscale readers are unchanged. When the two
individual readers disagree or miss a numeric crop, up to 24 crops per scan get
one raw-line (Tesseract PSM 13) retry. Agreement already obtained on clean crops is
not disturbed by unnecessary retries. Large boards retain the existing grayscale
budget. Retry evidence votes only on the complete observed number; rescued or
changed proposals remain flagged. No solved values, fixture answers or guessed
substitutions enter recognition. This is a bounded fallback, not a guarantee of
correct reading for arbitrary photos or handwriting.

## Tests

`web/tests/live-scanning.test.js`, `capture-store.test.js` and `ocr-retry.test.js`
cover the colours, unread evidence, generation ownership, deadlines, transaction
completion, unavailable storage and retry budgets. `scripts/live_camera_regressions.cjs`
uses a real canvas-backed MediaStream, production OCR and Pyodide, and real
IndexedDB in Chromium and WebKit. It checks automatic solving without closing the
camera, exact shutter pixels, review gating, reload/delete, motion and uncertain
readings. It is a simulated camera test, not a physical-phone camera certification.
The existing OCR quality suite records retries and retains its accuracy and
zero-unflagged-discrepancy requirements.

## Camera retry latency

The live session selects fresh pixels after each recognition attempt. A released
frame is never eligible for a later retry merely because it was sharper, and
frames observed while OCR was pending do not outrank the next fresh capture.
The existing 3/6/12/24-second backoff still bounds repeated work on an unchanged
unreadable scene. A sharpness gain of both 30 percent and 40 points may retry
after one second instead, including a provisional solved scene: improved focus
is new recognition evidence. Small focus fluctuations do not restart OCR.

Camera realignment now cancels an active search but preserves an idle or warming
Python worker. The first camera frame and settings changes no longer discard
the interpreter started by the camera's warm-up. Closing the camera still
terminates it. Warm-up failures and timeouts are handled and retired, so later
requests can retry without inheriting a broken worker.

If grid tracking fails three times in a row (the camera waits two seconds,
then four, between attempts), automatic tracking stops and the panel shows
**Restart live scanning**. Pressing it discards the previous tracking work and
starts again; until then the shutter still captures the current frame by hand,
and readings the camera can no longer verify stay hidden rather than being
shown on the wrong frame.

`web/tests/live-latency.test.js` covers these ownership and scheduling cases.
The repairs do not change OCR confidence thresholds, voting, reference answers,
or solver constraints. They remove failed retries and unnecessary cold starts;
they do not establish a new universal OCR accuracy or physical-phone speed figure.

## Content checks, faint clues and deletion ordering

No whole-frame thumbnail or motion fingerprint certifies clues; the camera
keeps none. The live preview keeps an area-sampled 24-by-24 signature for each cell,
including white-on-black marks. Cell-local illumination normalization and small
registration offsets tolerate modest brightness changes and sub-cell jitter.
A changed signature retires the old recognition and solution, including delayed
callbacks and captured metadata, before accepting a new reading. The comparison
uses a bounded-resolution copy of the frame and never includes solver values.
Unchanged solved scenes keep the existing battery-saving behaviour. These are
pixel heuristics, not a guarantee of detecting every arbitrarily faint or tiny
change; physical-camera motion, autofocus and lighting still require testing.

When the normal foreground threshold misses a white-cell digit, a bounded local
contrast pass can retain it despite dark grid lines elsewhere in the image.
Recovered crops remain uncertain even when OCR agrees. Plausible central ink
without a usable numeric component is carried as unread evidence, not converted
into a blank answer slot. Empty cells, shallow noise, gradients and shading have
negative regression controls. No numeric answers are inferred by preprocessing.

PNG saves and deletes take ownership when requested, before byte conversion or
database opening finishes. A superseded operation cannot start a later write;
already queued read/write transactions on the same store complete in IndexedDB
order. Delete therefore cannot be undone by an earlier delayed save from this
app instance. A new capture deliberately requested afterwards can still replace
it. UI messages remain tied to their request, and failed writes retain the
existing saved image.

`web/tests/review-safety.test.js` covers these boundaries. The permanent camera
acceptance gate additionally runs `scripts/review_safety_regressions.cjs` using
real Chromium/WebKit canvas processing, Tesseract and IndexedDB. It changes and
erases clues after solving and during delayed reads/searches, exercises both
ink polarities, preserves jitter/brightness controls, checks faint mixed-contrast
clues and verifies deletion again after reloading the app. Camera completion
callbacks are controlled to make race conditions reproducible; this is not
physical-phone certification or an OCR-speed benchmark.

## Re-reading one clue in the editor

After **Review captured clues**, or a photo import, the editor's cell dialog
offers **Re-read this clue** for a clue that is still flagged uncertain, is
numeric, and whose cell matches the retained straightened photograph. It is not
offered in Play mode, for confirmed or confident clues, or for Kakuro, KenKen
and Killer puzzles, whose cage and sum targets keep the full-read path. The
re-read shows OCR's proposal beside the field and changes nothing by itself:
**Use proposal** copies the number into the field, and the ordinary **Save**
confirms that one clue and stays undoable. Pressing the button again on the
same pixels reuses the earlier proposal instead of running OCR again; a
changed photograph, a changed puzzle, an edited field or a closed dialog
discards a result that arrives late, and a read that takes longer than ninety
seconds leaves the field as it was. Nothing in the proposal comes from a
solution.

## Latency: one warm OCR engine

Starting a Tesseract worker and loading its language data costs more than a
whole read on a phone, and the live camera reads a scene several times. Each
Scanner therefore keeps one OCR host and one geometry worker alive across reads.
The camera warms the OCR engine together with the private Python solver when it
opens; realignment cancels the pending read cooperatively, between recognition
calls, and keeps the engine (a stuck atomic call is replaced after two seconds);
closing the camera releases everything. Fresh pixel buffers are transferred
between workers rather than copied.

The atlas pass finishes long before the independent per-digit checks, so its
readings are offered as a provisional, fully review-flagged (yellow) preview.
They never start a solve; only the checked transcription does. A small
in-memory cache reuses isolated readings only for byte-identical crop images
with the identical segmentation mode, never for approximate matches, cell
indices or solver answers; it is bounded to 256 entries or two megabytes of
keys and cleared with the engine. Grid detection runs every 300 ms until a
reading is being tracked, then at least a second after the previous
candidate's verdict and longer when anchors are slow (`LIVE_TRACKING.md`).

`scripts/ocr_latency_regressions.cjs` reads the two retained newspaper crops
five times on one Scanner in both engines and records cold and warm read times,
time to the first provisional reading, worker counts and cache hits; it asserts
engine reuse and zero unflagged discrepancies, while wall-clock times are
reported rather than enforced. `OCR_BASELINE_SITE=<other _site>` times a second
build in the same browser session for an A/B comparison.
