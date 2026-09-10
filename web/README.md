# GridPuzzle phone scanner

GridPuzzle includes an installable, camera-first static web app, built and deployed from `master`, at:

https://senegrom.github.io/GridPuzzle/

Recognition and the complete Python GridPuzzle solver run on-device. Photographs are not uploaded to a recognition service or remote solver.

## Build and deploy

Requirements: Python 3.14+, Node.js 22+, and network access while building the pinned browser packages.

```sh
python -m pip install -e '.[dev]'
python -m pytest -q tests -m 'not slow'
node --test web/tests/*.test.js
python scripts/build_web.py
python -m http.server 8000 --directory _site
```

Camera permissions require localhost or HTTPS. The existing `Build and deploy phone scanner` workflow is the single expensive deployment gate: it builds `_site`, runs Python and browser unit tests, executes the real Chromium/mobile-WebKit Python and OCR acceptance suites (including the real-newspaper fixtures), uploads that tested artifact, and deploys it through `gridpuzzle-browser-pages`.

The app is a multi-file static site, not a Python server. Runtime Python, OCR, English training data and icons are self-hosted. The build verifies every npm tarball against a pinned SHA-512 integrity value before unpacking it and ships only the LSTM Tesseract cores the bundled model uses. `build-info.json` records the exact source commit and package integrity metadata; `assets.json` records SHA-256 digests.

## Features

- Rear-facing live camera with manual shutter and optional stable-grid capture.
- Photo-library import and a native camera-file fallback for denied/unavailable live camera access.
- Four draggable crop corners, rotation, projective straightening, automatic continuous-grid size detection, explicit dimensions and puzzle-type selection.
- Local printed-clue OCR with confidence/review flags and guided **Review highlighted clues → Save & next**.
- All twelve solver families: Sudoku, Killer Sudoku, Futoshiki, KenKen, Latin square, diagonal Latin square, pandiagonal Latin square, Hidato, Numbrix, Kakuro, Slitherlink and Str8ts.
- Str8ts support includes solid black street separators and numbered black cells. Numbered black cells constrain row/column uniqueness but do not join a street.
- Editors for values/blocked or black cells, cages, inequalities and Kakuro directional clues, plus undo and validated JSON import/export.
- **Play mode** (Editing → Play): enter your own answers in blank cells, see clashes with rows, columns, boxes and printed clues as you go, check answers against the solver's solution without revealing it, take a hint for one cell, and be told when the puzzle is complete. Answers persist with the puzzle; the checking solution is never stored.
- The Python runtime loads in the background as soon as a puzzle is on the board, so Solve, Check and Hint respond without a first-load wait.
- A strict Python data boundary and the full Python 3.14 solver through Pyodide in a cancellable worker. Browser solving uses sequential search capped at two solutions to distinguish no/unique/multiple solutions without unsupported browser multiprocessing.
- Clean-board and captured-photo overlays, including Slitherlink edges, plus PNG overlay export.
- Local puzzle/settings persistence. Recognition uncertainty is persisted atomically; photographs and solver results are not.
- Installable PWA icons, hash-verified offline preparation and a request for persistent browser storage. A banner at the top of the page announces a ready update; nothing reloads until the user chooses to.

## Recognition trust model

Automatic recognition is a proposal, not proof. A faint or cropped clue can look like an intentionally blank cell, so an **automatically identified puzzle type always requires one rules confirmation**, including boxed Sudoku. Structural families such as Str8ts remain review-gated. An explicitly selected type represents a separate user decision, but uncertainty flags still block silent trust of suspect readings.

A unique solution verifies only the transcribed rules and clues. It does not prove the photograph was read correctly.

Newsprint handling now uses solid-cell statistics to distinguish true black separators from gray Sudoku shading, connected-component cleanup to suppress paper/halftone specks, and local per-digit Otsu binarization before the bounded Tesseract atlas call. Every single-glyph digit is then re-read on its own, once from its binary crop and once from its grayscale crop, and the three readings vote: unanimity clears the review flag even at low individual scores, any disagreement keeps it. The two user-provided newspaper crops are retained under `Examples/BrowserScanner/Newspaper/` and are not shipped in the PWA bundle.

On the 2026-09-07 real newspaper regressions, Chromium 153 and WebKit 26.6 both read the shaded Sudoku **24/24**. They both read the Str8ts **19/20** printed values, with the one missed clue explicitly flagged for review; both detect the Str8ts black-cell layout exactly and produce **zero unsafe unflagged discrepancies**. Generated regressions remain useful secondary baselines: Chromium reads all tested generated variants exactly, while the current WebKit perspective/shadow case reads 29/30 with the miss flagged.

Cage boundaries/targets, inequalities, Kakuro directions and path-puzzle identification remain experimental and require review. Handwriting, alphabetic large-grid clues, arbitrary publisher layouts and invisible variant rules are not promised. Physical-iPhone autofocus/exposure, installed-mode camera behaviour, storage eviction and airplane-mode use still require hardware testing.

Digit cleanup retains neighbouring glyphs in multi-digit numbers and preserves ink in pure black-and-white scans. Invalid Str8ts values and Kakuro targets become highlighted blanks for correction. An incompatible cage reading leaves its cells uncovered; missing or ambiguous targets remain unset. These incomplete structures are editable, and Solve requires their correction rather than accepting an invented operator or target.

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

The browser rejects malformed dimensions, boxes, Str8ts black metadata, overlapping/disconnected cages, invalid cage arity/operators, nonadjacent inequalities and empty Kakuro clue objects before they can become solve requests. Incomplete cage coverage and missing OCR targets remain editable states, but **Solve** performs a solve-ready check before Pyodide starts. The Python adapter remains the authoritative final boundary.

The 25×25 browser limit is a phone resource policy, not a native solver limit. Str8ts itself is limited to square 2×2 through 9×9 boards. A deadline/cancellation means unfinished, never unsatisfiable or unique.

## Offline behaviour

Offline requests are scoped to `/GridPuzzle/`. Root navigation maps to cached `index.html` even when a bookmark/share URL includes query parameters. Runtime assets live in one content-addressed cache keyed by SHA-256, and each build's asset list is stored separately, so an update reuses unchanged verified bytes instead of downloading the whole Pyodide/Tesseract bundle again. Every downloaded asset is digest-verified before it is stored.

The startup status is a cheap presence check. **Download for offline use** performs full sequential digest verification, evicts/refetches anything that fails, and asks the browser for persistent storage. Ordinary requests trust bytes already verified before write, so large WASM files are not re-hashed on every fetch. If the browser evicts the asset list, in-scope requests fall back to the network and restore it online. Cache quota failure does not break a verified online response.

## Testing

- `tests/test_web_api.py` verifies the Python/browser data contract; `tests/test_str8ts.py` verifies Str8ts street semantics and the uniquely solved newspaper puzzle.
- `web/tests/` covers geometry, classification, OCR mapping/preprocessing, cache recovery, worker lifecycle, malformed input, type confirmation, structural validation, keyboard boundaries, no-op edit guards and service-worker routing.
- `scripts/browser_smoke.cjs` exercises all twelve puzzle families through the real Python/Pyodide solver in Chromium and WebKit.
- `scripts/browser_regressions.cjs` exercises generated OCR/perspective/review regressions.
- `scripts/play_regressions.cjs` plays the example through the real solver: answers, clashes, checking, hints, completion, reload persistence, reveal, and the runtime warm-up.
- `scripts/newspaper_regressions.cjs` runs the production scanner/Tesseract pipeline against the two real user-provided newspaper crops in Chromium and WebKit. Any wrong, missed or invented clue that is not review-flagged fails the deployment.
- The newspaper images and hand-checked ground truth live in `Examples/BrowserScanner/Newspaper/`, outside `web/`, so they do not inflate the deployed/offline bundle.
- Normal Linux/Windows CI and forward compatibility remain independent from the single full Pages/browser gate.

Generated fixtures are regression baselines, not substitutes for real-device testing.

## Input, build and lifecycle hardening

The page declares a same-origin Content Security Policy and a no-referrer policy; every runtime asset is self-hosted. Builds are staged before publication. Inside the repository, only `_site` is accepted as output; custom external outputs must be new or builder-owned. Source directories, Git metadata, repository ancestors and symbolic output links are refused, and a failed build preserves the previous good output.

Task/deadline ownership, edit snapshots, camera/photo flow and offline controls are separate modules. Grayscale/threshold/region preparation runs off the UI thread. Each OCR scan owns a dedicated host that can terminate raw Tesseract workers even while language initialization is pending. Stale task generations cannot replace a newer puzzle.

Live moving-camera AR and step-by-step deduction explanations are not included.
