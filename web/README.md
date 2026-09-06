# GridPuzzle phone scanner

The `browser-scanner` branch adds an installable static app without changing
any existing solver technique, profile, deduction ordering, or search code.

## Build and deploy

Requirements: Python 3.14+, Node.js 22+, network access for the pinned build
packages. From the repository root:

```sh
python -m pip install -e '.[dev]'
python -m pytest -q tests -m 'not slow'
node --test web/tests/*.test.js
python scripts/build_web.py
python -m http.server 8000 --directory _site
```

Open localhost:8000. Camera permissions require localhost or HTTPS.
The Pages workflow builds `_site`, tests Chromium and mobile WebKit on the
`/GridPuzzle/` subpath, and uploads the tested artifact. It attempts to enable
Pages using `actions/configure-pages`. A repository owner may need to enable
Settings > Pages > Source: GitHub Actions if the workflow token is not allowed
to create the Pages site. The `github-pages` environment must allow deployment
from `browser-scanner`. Nothing merges this branch into master.

The app is a multi-file static site, not a Python server. At runtime there are
no calls to external APIs/CDNs: Python, OCR, English training data and all
icons are served from this site's own `vendor/` and `icons/` directories.
`build-info.json` records the exact source commit and npm integrity values.
`assets.json` records SHA-256 digests; offline preparation verifies every file.

## Features

- Rear-facing live camera with manual shutter and optional stable-grid capture.
- Photo-library import and a native camera-file fallback for denied/unavailable
  live camera access. No photograph leaves the browser.
- Four draggable crop corners, keyboard corner controls (1–4, then arrows),
  rotation, projective straightening, automatic continuous-grid size detection,
  explicit dimensions and puzzle type selection.
- A single OCR atlas per scan with per-cell review flags. Type recognition is
  explicitly heuristic; ambiguous rules require confirmation.
- Eleven native solver families: Sudoku, Killer Sudoku, Futoshiki, KenKen,
  Latin square, diagonal Latin square, pandiagonal Latin square, Hidato,
  Numbrix, Kakuro and Slitherlink.
- Digit/block editor with enlarged source crop, cage partition editor, directed
  inequality editor, Kakuro across/down clues, undo and validated JSON import.
- Full original Python solver via Pyodide 314.0.6 in a dedicated module worker,
  sequential search capped at two solutions. Zero/multiple/unique/error/invalid
  states are distinct. Worker termination implements real cancellation and
  search deadlines; stale messages cannot replace a newer puzzle.
- Clean board and captured-photo solution overlay, both number and loop-edge
  puzzles; PNG overlay export and puzzle JSON export.
- Local puzzle/settings persistence, offline download with honest readiness,
  scoped/versioned caches, update controls, manifest and opaque Apple/Android
  icons. The app does not persist photographs.

## Recognition limits (important)

Printed, high-contrast rectangular Sudoku is the primary scanning target.
Photo quality, shadows, handwriting, nonrectangular geometry and publisher
styles are not universally handled. Borderless/dotted grids and Futoshiki often
need manual crop and dimensions. Type identification cannot determine rules
that are not visible in the image. Titles/rules are not read in this version.

Cage boundaries/targets and Kakuro clue directions use experimental image
heuristics and ALWAYS require review. A missed cage wall can merge cages:
check the whole partition, not only highlighted digits. Missing/overlapping
cages are rejected by the data adapter, not treated as a weaker puzzle.
Automatic cell recognition can miss an ink region: a unique solve is never
proof of correct transcription. Keep the original photograph available for
comparison. Use the family editors or JSON to correct unsupported print styles.

Live augmented-reality tracking and step-by-step deduction explanations are
not implemented. The overlay is anchored to a captured photograph; glyph
centres/edge endpoints are mapped by the crop homography for readability.
Native-camera autofocus/exposure and installation should also be checked on
physical iPhones; a mobile WebKit test is not a physical-device test.

## Data contract

```json
{
  "version": 1,
  "type": "sudoku",
  "rows": 4, "cols": 4, "boxRows": 2, "boxCols": 2,
  "cells": [1, null, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
  "cages": [], "inequalities": [], "clues": []
}
```

Cells are row-major. Null is blank; `"#"` is blocked. Slitherlink 0 is a real
face clue; the engine's private OFF=1/ON=2 edge encoding is not exposed as clues.
Cages: `{ "cells": [0,1], "target": 3, "op": "+" }`. Every cage must be connected
and every cell must belong to exactly one cage. KenKen supports +, -, *, /;
`=` is accepted for a single cell. Inequalities: `{ "less": 0, "greater": 1 }`.
Kakuro clue on a black cell: `{ "cell": 0, "across": 16, "down": 23 }`.
Across/down runs extend right/down until the next blocked cell or the boundary.
All coordinate indexes are zero-based. The Python adapter performs complete
structural validation before building the original grid classes.

The bounded 25×25 UI limit is a phone resource policy, not a reduction of the
native solver's supported sizes. Large blank/path puzzles may take substantial
search time. A deadline means unfinished, never unsatisfiable or unique.

## Testing

`tests/test_web_api.py` checks native adapter semantics and all model families.
`web/tests/model.test.js` checks row-major data, inference ambiguity, homography,
white-image rejection and generated-grid detection. `scripts/browser_smoke.cjs`
uses the real Python and OCR WASM runtimes, not mocks, in Chromium and WebKit.
It checks all eleven families, phone overflow, clue editing/undo, genuine
cancellation/restart, denied camera fallback, a generated printed Sudoku scan,
photograph overlay and offline reload/solve. Reports and screenshots are CI
artifacts. This is a baseline, not a measured real-world recognition benchmark.
