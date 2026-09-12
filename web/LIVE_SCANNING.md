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
cells are not answer slots. A missed printed digit is never painted over in blue.

Live solutions are explicitly **previews**, not confirmation that the photograph
or inferred rules are right. Conflicting readings, incomplete structural data,
unread printed digits and nonunique results do not produce blue answers. Numeric
readings flagged for review can participate in a labelled preview, but remain
yellow. Inferred family/box settings and all OCR warnings are preserved when
**Review captured clues** transfers a capture to the editor. The usual confirmation
requirement still applies to Solve, Check and Hint there.

The camera waits for stable detections and chooses the sharper sampled frame.
Local image changes invalidate the overlay and cancel obsolete recognition and
solving. Only one recognition job and one preview solve are active. Once a
complete unique preview is showing, a still scene is not read again until the
picture or the settings change; an unresolved scene retries with a doubling
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
picture remains on the same screen. It is not a fresh, differently positioned
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
