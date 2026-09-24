# GridPuzzle phone scanner

The `master` branch provides an installable, camera-first static web app at:

https://senegrom.github.io/GridPuzzle/

Recognition and the complete Python GridPuzzle solver run on-device. Photographs are not uploaded to a recognition service or remote solver. The scanner is integrated into `master`; only `master` publishes the tested Pages app.

## Build and deploy

Requirements: Python 3.14+, Node.js 22+, and network access while building the pinned browser packages.

```sh
python -m pip install -e '.[dev]'
python -m pytest -q tests -m 'not slow'
node --test web/tests/*.test.js
python scripts/build_web.py
python -m http.server 8000 --directory _site
```

Camera permissions require localhost or HTTPS. The existing `Build and deploy phone scanner` workflow is the single expensive deployment gate: it builds `_site`, runs Python and browser unit tests, executes the real Chromium/mobile-WebKit Python and OCR acceptance suites (including the real-newspaper fixtures), uploads that tested artifact, and deploys it through the repository's `github-pages` environment.

The app is a multi-file static site, not a Python server. Runtime Python, OCR, English training data and icons are self-hosted. The build verifies every npm tarball against a pinned SHA-512 integrity value before unpacking it and ships only the LSTM Tesseract cores the bundled model uses. `build-info.json` records the exact source commit and package integrity metadata; `assets.json` records SHA-256 digests.

## Features

- Rear-facing live camera with automatic stable-frame recognition and a solution preview on the same screen. Green values are recognised, yellow values are uncertain, red question marks are unknown, and blue values are solved entries. The shutter saves the exact annotated picture; it is never pressed automatically.
- Photo-library import and a native camera-file fallback for denied/unavailable live camera access.
- Four draggable crop corners, rotation, projective straightening, automatic continuous-grid size detection, explicit dimensions and puzzle-type selection.
- Local printed-clue OCR with confidence/review flags and guided **Review highlighted clues → Save & next**.
- **Re-read this clue** in the cell editor: a numeric OCR re-read of one unconfirmed clue against the retained photograph, shown as a proposal that only **Save** confirms.
- **Restart live scanning** when grid tracking has failed three times in a row; the shutter keeps working meanwhile.
- All twelve solver families: Sudoku, Killer Sudoku, Futoshiki, KenKen, Latin square, diagonal Latin square, pandiagonal Latin square, Hidato, Numbrix, Kakuro, Slitherlink and Str8ts.
- Str8ts support includes solid black street separators and numbered black cells. Numbered black cells constrain row/column uniqueness but do not join a street.
- Editors for values/blocked or black cells, cages, inequalities and Kakuro directional clues, plus undo and validated JSON import/export.
- **Play mode** (Editing → Play): enter your own answers in blank cells, see clashes with rows, columns, boxes and printed clues, check answers privately, and take one-cell hints. Check, Hint and automatic completion checking require confirmation of unreviewed scans; confirming resumes only the action that asked, Back and Escape leave warnings and answers untouched, and replacing the board cancels a pending confirmation. Per-cell verdicts and hints require a completed unique solution, which only a finished search supplies; ambiguous puzzles keep your answers unchanged instead of comparing them with an arbitrary completion, and Reveal stays available to inspect multiple solutions. Play hides photo overlays that show the full solution and disables photo view, photo export and alternative-solution controls until you leave it. Answers persist with the puzzle; the checking solution is never stored.
- The Python runtime loads in the background as soon as a puzzle is on the board, so Solve, Check and Hint respond without a first-load wait.
- A strict Python data boundary and the full Python 3.14 solver through Pyodide in a cancellable worker. Browser solving uses sequential search capped at two solutions to distinguish no/unique/multiple solutions without unsupported browser multiprocessing.
- Clean-board and captured-photo overlays, including Slitherlink edges, plus PNG overlay export.
- Local puzzle/settings persistence. Recognition uncertainty is persisted atomically. Only an explicit live-camera shutter press saves a photograph: one annotated PNG is retained locally, with download and delete controls. Imported photos, uncaptured frames and editor solver results are not stored.
- Installable PWA icons, hash-verified offline preparation and a request for persistent browser storage. A banner at the top of the page announces a ready update; nothing reloads until the user chooses to.

## Camera preferences and accessibility

**Solve clear, unambiguous scans automatically** applies to both still-photo
recognition and live previews. Switching it off preserves OCR but cancels any
pending live solve and hides blue answers. Switching it on can use the same
verified reading; a late response from an earlier solve cannot reappear.

The full-screen camera is modal: background controls are inert, Tab and
Shift+Tab remain inside it, and closing it restores the previous focus and
background state.

Kakuro Play feedback checks run duplicates and reachable sum bounds. Killer
cages enforce distinct values and sum bounds; KenKen checks sum/product bounds
and two-cell subtraction/division compatibility. These are necessary local
conditions, not proof of correctness. The native solver remains responsible
for full checking and unique solutions.

## Recognition trust model

Automatic recognition is a proposal, not proof. A faint or cropped clue can look like an intentionally blank cell, so an **automatically identified puzzle type always requires one rules confirmation**, including boxed Sudoku. Structural families such as Str8ts remain review-gated. An explicitly selected type represents a separate user decision, but uncertainty flags still block silent trust of suspect readings.

A unique solution verifies only the transcribed rules and clues. It does not prove the photograph was read correctly. The live camera may show a clearly labelled provisional solution without interrupting the view; unread printed marks, inconsistent clues and nonunique results block blue entries. Captured readings transferred to the editor retain their uncertainty and still require the normal rules confirmation.

Newsprint handling now uses solid-cell statistics to distinguish true black separators from gray Sudoku shading, connected-component cleanup to suppress paper/halftone specks, and local per-digit Otsu binarization before the bounded Tesseract atlas call. When a scan has at most 150 numeric crops, every single-glyph digit is then re-read on its own, once from its binary crop and once from its grayscale crop, and the three readings vote: unanimity clears the review flag even at low individual scores, any disagreement keeps it. The two user-provided newspaper crops are retained under `Examples/BrowserScanner/Newspaper/` and are not shipped in the PWA bundle.

The measured results on those crops and on the generated fixtures are in [TESTING.md](TESTING.md); current measurements are retained in the workflow reports.

Cage boundaries/targets, inequalities, Kakuro directions and path-puzzle identification remain experimental and require review. Handwriting, alphabetic large-grid clues, arbitrary publisher layouts and invisible variant rules are not promised.

No automated suite is a physical-device test. VoiceOver and physical usability, autofocus and exposure, installed-mode camera behaviour, storage eviction, airplane-mode use, decoder memory and phone speed still require hardware testing, and generated fixtures are regression baselines, not substitutes for it.

Digit cleanup retains neighbouring glyphs in multi-digit numbers and preserves ink in pure black-and-white scans. Invalid Str8ts values and Kakuro targets become highlighted blanks for correction. An incompatible cage reading leaves its cells uncovered; missing or ambiguous targets remain unset. These incomplete structures are editable, and Solve requires their correction rather than accepting an invented operator or target.

The documents beside this one:

- [LIVE_CAMERA.md](LIVE_CAMERA.md): the live camera: colours, saved pictures, identity through motion, tracking tiers and costs, changed-print checks, recovery and its tests.
- [GRID_DETECTION.md](GRID_DETECTION.md): how the grid is found in a frame, measured on the puzzle corpus.
- [OCR_QUALITY.md](OCR_QUALITY.md): how printed clues are read and recovered, with the measured improvements and acceptance suites.
- [SCAN_INPUT.md](SCAN_INPUT.md): original-detail crops of still photographs, the clue-focused frame quality score and local cell-boundary refinement.
- [TESTING.md](TESTING.md): the test method, every suite and the corpus benchmarks.

## Photo imports and retained readings

JPEG, PNG and WebP dimensions are checked before decoding. WebP lossy,
lossless and extended headers are supported. Unrecognized or incomplete
headers are rejected with an export-to-JPEG/PNG/WebP message rather than
using compressed byte count as a decoded-pixel budget. The app requests
resized bitmaps when available, refuses images over 120 megapixels, and
refuses full-image fallback over 24 megapixels. Decoder-internal memory
use is browser-dependent.

A numbered black-cell reading that cannot be represented by a proposed
Hidato/Kakuro type remains highlighted and is retained in editor/session
metadata, separately from puzzle JSON. Choosing Str8ts restores compatible
numbered clues. Saving that cell explicitly or confirming the transcription
clears the pending evidence; Undo restores it with the prior edit.
Find grid preserves puzzle edit history and does not discard the old crop
or mapping on failure or cancellation. Read puzzle also stages its candidate:
failed/cancelled reads of an unchanged crop preserve the accepted solution,
photo mapping, Play cache and undo history. A new Read click cancels earlier
work even when the new dimensions, boxes or crop fail validation. Actual crop
or photograph changes still invalidate incompatible mappings.

## Session backups and imported definitions

**Export session backup** writes a versioned `gridpuzzle-backup` envelope around
our strict puzzle definition and saved review/Play state. It includes separate
cell and cage warnings, pending black-cell evidence, notes, answers, hint marks
and the editing mode. Photographs, computed solutions and undo history are not
included. The importer validates the complete envelope before replacing the
current session; an unsupported version or invalid metadata changes nothing.

**Export puzzle definition only** is for interchange, not an unfinished-session
backup. It is unavailable while scan review is outstanding. Older puzzle-only
files remain importable, but explicitly require clue/rule confirmation because
they carry no record of review or Play progress. The underlying solver schema
is unchanged.

A selected JSON file or an applied JSON draft supersedes older pending reads,
also when the newer input then fails size, syntax or shape validation;
cancelling the file picker supersedes nothing.

## Data contract

```json
{
  "version": 1,
  "type": "str8ts",
  "rows": 4,
  "cols": 4,
  "cells": [1, null, "#", 4, 2, 3, 4, 1, 3, 4, 1, 2, 4, 1, 2, 3],
  "black": [2],
  "cages": [],
  "inequalities": [],
  "clues": []
}
```

Cells are zero-based row-major. `null` is blank; `"#"` is a blocked/blank-black cell where the family supports it; Slitherlink `0` is a real face clue. Str8ts uses `black` as a distinct list of black-cell indices; an index in `black` may contain either `"#"` or an integer printed on that black cell. Cages use `{ "cells": [0,1], "target": 3, "op": "+" }`; inequalities use `{ "less": 0, "greater": 1 }`; a Kakuro clue on a blocked cell can use `{ "cell": 0, "across": 16, "down": 23 }`.

Omitting a cage operator defaults to `+`; explicit `null` is invalid in both JavaScript and Python.

The browser rejects malformed dimensions, boxes, Str8ts black metadata (explicitly malformed metadata is rejected, not normalized to an empty list), overlapping/disconnected cages, invalid cage arity/operators, nonadjacent inequalities and empty Kakuro clue objects before they can become solve requests. Incomplete cage coverage, missing OCR targets, fully blocked Str8ts and Hidato drafts and duplicate Hidato and Numbrix clues remain editable states, but **Solve** performs a solve-ready check before Pyodide starts, consistently with the native loaders; numbered black cells do not count as Str8ts white cells. Browser editability and solve-readiness are separate contracts, checked against the native adapter on shared fixtures. The Python adapter remains the authoritative final boundary.

The 25×25 browser limit is a phone resource policy, not a native solver limit. Str8ts itself is limited to square 2×2 through 9×9 boards. A deadline/cancellation means unfinished, never unsatisfiable or unique.

## Offline behaviour

Offline requests are scoped to `/GridPuzzle/`. Root navigation maps to cached `index.html` even when a bookmark/share URL includes query parameters. Runtime assets live in one content-addressed cache keyed by SHA-256, and each build's asset list is stored separately, so an update reuses unchanged verified bytes instead of downloading the whole Pyodide/Tesseract bundle again. Every downloaded asset is digest-verified before it is stored.

Python and OCR dependencies use build-specific `vendor/<build>/` URLs; each
app starts a build-specific solver worker as well. Service-worker installation
now prepares the **complete Python runtime** before activation, even before an
explicit offline download. Identical bytes are reused from the shared digest
cache, so later application-only updates do not redownload Python. The offline
button still prepares and verifies the remaining assets, including OCR data.

Activation retains the complete manifests and cached dependency sets of live
outgoing tabs/workers, not just their Python solver archives. Unversioned
requests from pre-migration clients are routed through their retained manifest;
missing bytes can be fetched from a new URL only when the recorded digest is
identical. Before activation writes its owner index, or when a browser omits a worker's
client identity, legacy vendor paths use the already-cached manifests only if
all matches have the same digest. Conflicting historical versions are rejected
instead of guessed. Retention
owners survive service-worker restarts and later updates;
newer tabs do not prolong obsolete clients' retention. Unowned old builds are
pruned on a subsequent activation. Reused module responses resolve relative
imports against the requested versioned URL, not a previous download's URL.

The startup status is a cheap presence check. **Download for offline use** performs full sequential digest verification, evicts/refetches anything that fails, and asks the browser for persistent storage. Of the two Tesseract core loaders it stores only the one this device will load, chosen with the same WebAssembly SIMD test Tesseract.js uses (both where WebAssembly cannot be probed); both stay on the server. Ordinary requests trust bytes already verified before write, so large WASM files are not re-hashed on every fetch. If the browser evicts the asset list, in-scope requests fall back to the network and restore it online. Cache quota failure does not break a verified online response.

Offline preparation is one shared job per service-worker build, with a bounded
listener set. Retrying reconnects to a healthy job rather than duplicating or
cancelling another tab's download. Each manifest, asset verification and
storage phase has a worker-owned four-minute deadline, shorter than the page's
five-minute inactivity timeout; a stalled phase aborts its network request,
releases job ownership and reports an error, and a later retry can start a new
job. Late retired work cannot publish success for a newer job, and only
read-back, hash-verified stored assets authorize offline readiness.

## Testing

Every browser suite, what it proves and which workflow job runs it, and the
unit tests by area, are in [TESTING.md](TESTING.md). `tests/test_web_api.py`
verifies the Python/browser data contract and `tests/test_str8ts.py` Str8ts
street semantics and the uniquely solved newspaper puzzle. The newspaper images
and hand-checked ground truth live in `Examples/BrowserScanner/Newspaper/`,
outside `web/`, so they do not inflate the deployed or offline bundle.

## Input, build and lifecycle hardening

The page declares a same-origin Content Security Policy and a no-referrer policy, and every runtime asset is self-hosted. Builds are staged before publication, and a failed build keeps the previous good output: inside the repository only `_site` is accepted as output, custom external outputs must be new or builder-owned, and source directories, Git metadata, repository ancestors and symbolic output links are refused. Task and deadline ownership, edit snapshots, the camera and photo flow and the offline controls are separate modules, and stale task generations cannot replace a newer puzzle. Grayscale, threshold and region preparation runs off the UI thread, and each OCR scan owns a dedicated host that can terminate raw Tesseract workers even while language initialization is pending. Step-by-step deduction explanations are not included.


## Scan diagnostics

The expandable **Why isn’t this working?** panel appears in the editor and live
camera. It distinguishes finding/alignment, image quality, clue preparation,
reading, checking and solving, with specific reasons where the pipeline knows
them. It is a bounded in-memory trace, not telemetry.

**Preview diagnostic report** freezes a JSON report containing the build,
settings, timings, grid geometry, last recognized cells/review flags and bounded
tracking/cancellation counters. It excludes photographs, filenames, URLs,
stack traces, user notes, Play answers and solver solutions by default. Download
is a separate user action and no report is automatically uploaded or persisted.

The optional source-picture checkbox shows the exact image that will be
attached before downloading. That attachment is a re-encoded source preview,
limited to 1600 pixels, not the original file or its EXIF metadata. It can still
show surroundings: review it before sharing. Closing or clearing the preview
removes the attachment. A report identifies whether its readings were verified
for the shown image; stale/hidden live readings are not labelled current.
