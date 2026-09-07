# GridPuzzle phone scanner

The `browser-scanner` branch provides an installable, camera-first static web app at:

https://senegrom.github.io/GridPuzzle/

The phone app runs recognition and the complete Python GridPuzzle solver on-device. No photograph is uploaded to a recognition service or remote solver. The branch also currently contains native exactness/robustness fixes reviewed separately; they do not weaken the solver's deduction hierarchy, solution space or branch semantics.

## Build and deploy

Requirements: Python 3.14+, Node.js 22+, and network access while building the pinned browser packages.

```sh
python -m pip install -e '.[dev]'
python -m pytest -q tests -m 'not slow'
node --test web/tests/*.test.js
python scripts/build_web.py
python -m http.server 8000 --directory _site
```

Camera permissions require localhost or HTTPS. The `Build and deploy phone scanner` workflow is the single expensive deployment gate: it builds `_site`, runs the Python/browser unit suites, executes the real Chromium and mobile-WebKit Python/OCR acceptance tests, uploads the tested artifact, and deploys through the `gridpuzzle-browser-pages` environment. Nothing in that workflow merges the branch into `master`.

The app is a multi-file static site, not a Python server. Runtime Python, OCR, English training data and icons are self-hosted. The build verifies every npm tarball against a pinned SHA-512 integrity value before unpacking it and ships only the LSTM Tesseract cores the bundled English model uses. `build-info.json` records the exact source commit and package integrity metadata; `assets.json` records SHA-256 digests.

## Features

- Rear-facing live camera with manual shutter and optional stable-grid capture.
- Photo-library import and a native camera-file fallback for denied/unavailable live camera access.
- Four draggable crop corners, rotation, projective straightening, automatic continuous-grid size detection, explicit dimensions and puzzle type selection.
- Local printed-clue OCR with confidence/review flags and guided **Review highlighted clues → Save & next**.
- All eleven solver families: Sudoku, Killer Sudoku, Futoshiki, KenKen, Latin square, diagonal Latin square, pandiagonal Latin square, Hidato, Numbrix, Kakuro and Slitherlink.
- Editors for values/blocked cells, cages, inequalities and Kakuro directional clues, plus undo and validated JSON import/export.
- A strict Python data boundary and the full Python 3.14 solver through Pyodide in a cancellable worker. Browser solving uses sequential search capped at two solutions to distinguish no/unique/multiple solutions without relying on unsupported browser multiprocessing.
- Clean-board and captured-photo overlays, including Slitherlink edges, plus PNG overlay export.
- Local puzzle/settings persistence. Recognition uncertainty is persisted atomically; photographs and solver results are not.
- Installable PWA icons, hash-verified offline preparation and a request for persistent browser storage.

## Recognition trust model

Automatic recognition is a proposal, not proof. In particular, a faint/cropped clue may fail the initial ink detector and look like an intentionally blank cell. Therefore an **automatically identified puzzle type always requires one rules confirmation**, including ordinary boxed Sudoku. If the user explicitly selects Sudoku before scanning, a clear scan may still auto-solve immediately when no clue is uncertain.

A unique solution verifies only the transcribed rules and clues. It does not prove the photograph was read correctly.

Printed, high-contrast rectangular Sudoku is the primary automatic scanning target. Generated regressions currently read the baseline 30-given Sudoku 30/30 in Chromium and WebKit; harder generated WebKit variants can still miss one or two clues, and those discrepancies are flagged for review. These generated fixtures are not a representative real-world phone-photo benchmark.

Cage boundaries/targets, inequalities, Kakuro directions and path-puzzle identification remain experimental and require review. Handwriting, alphabetic large-grid clues, arbitrary publisher layouts and invisible variant rules are not promised. Physical iPhone autofocus/exposure, installed-mode camera behaviour, storage eviction and airplane-mode use still require hardware testing.

## Data contract

```json
{
  "version": 1,
  "type": "sudoku",
  "rows": 4,
  "cols": 4,
  "boxRows": 2,
  "boxCols": 2,
  "cells": [1, null, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
  "cages": [],
  "inequalities": [],
  "clues": []
}
```

Cells are zero-based row-major at the browser boundary. `null` is blank; `"#"` is blocked; Slitherlink `0` is a real face clue. Cages use `{ "cells": [0,1], "target": 3, "op": "+" }`; inequality objects use `{ "less": 0, "greater": 1 }`; a Kakuro clue on a blocked cell can use `{ "cell": 0, "across": 16, "down": 23 }`.

The browser rejects malformed dimensions, boxes, overlapping/disconnected cages, invalid cage arity/operators, nonadjacent inequalities and empty Kakuro clue objects before they can become a solve request. Incomplete cage coverage and missing OCR targets remain editable states, but **Solve** runs a solve-ready check before Pyodide starts: cage puzzles need targets and complete coverage, and every Kakuro white cell must belong to exactly one across run and one down run of 2 to 9 cells. The Python adapter remains the authoritative final boundary.

The 25×25 browser limit is a phone resource policy, not a native solver limit. A deadline/cancellation means unfinished, never unsatisfiable or unique.

## Offline behaviour

Offline requests are scoped to `/GridPuzzle/`. Root navigation maps to cached `index.html` even when a bookmark/share URL includes query parameters. Runtime assets live in one content-addressed cache keyed by SHA-256, and each build's asset list is stored separately, so an update reuses unchanged verified bytes instead of downloading the whole Pyodide and Tesseract bundle again. Every downloaded asset is digest-verified before it is stored; nothing is written on a mismatch.

The startup status is a cheap presence check. **Download for offline use** performs the full sequential digest verification, evicts and refetches anything that fails, and asks the browser for persistent storage. Ordinary requests trust bytes that were verified before being written, so large WASM files are not re-hashed on every fetch. If the browser evicts the asset list, in-scope requests fall back to the network and the list is restored online instead of leaving the page unloadable. Cache quota failure does not break a verified online response.

## Testing

- `tests/test_web_api.py` and the shared payload fixtures verify the Python/browser contract.
- `web/tests/` covers geometry, classification, OCR atlas mapping, cache recovery, worker lifecycle, malformed input, automatic-type confirmation, structural validation, keyboard boundaries, no-op edit guards and service-worker routing.
- `scripts/browser_smoke.cjs` and `scripts/browser_regressions.cjs` use the real Python and OCR WebAssembly runtimes in Chromium and WebKit, not mocks. They cover all eleven families, cancellation/restart, denied-camera fallback, generated photo recognition, guided review, overlays, cache recovery and origin-offline reload/solving/recognition.
- Normal Linux/Windows CI and forward compatibility remain separate. The lightweight PR browser workflow now runs only browser unit/parse checks; the deployment workflow is the sole duplicate-free full browser gate.

The full slow corpus is not run on every Pages deployment. Generated recognition tests are a regression baseline, not a substitute for real-device testing.

## Input, build and lifecycle hardening

The page declares a same-origin Content Security Policy and a no-referrer policy; every runtime asset is self-hosted. Builds are staged before publication. Inside the repository, only `_site` is accepted as output; custom external outputs must be new or builder-owned. Source directories, Git metadata, repository ancestors and symbolic output links are refused, and a failed build preserves the previous good output.

Task/deadline ownership, edit snapshots, camera/photo flow and offline controls are separate modules. Grayscale/threshold/region preparation runs off the UI thread. Each OCR scan owns a dedicated host that can terminate raw Tesseract workers even while language initialization is pending. Stale task generations cannot replace a newer puzzle.

Live moving-camera AR and step-by-step deduction explanations are not included in this branch.
