# Tiny printed-digit CNN: experiment, not production OCR

This experiment trains a 26,731-parameter convolutional network on 28x28
polarity-corrected grayscale crops. Outputs are digits 0–9 and `reject`.
The 106,924-byte float32 weights (104.4 KiB) run with the dependency-free
`infer.mjs`; no browser ML library or GPU is needed by that implementation.
**Nothing imports this into the phone scanner. Do not enable automatic answers
or merge it as an OCR replacement on these measurements.**

## Architecture and training

Two 3x3 padded convolutions (8 and 16 channels), each followed by ReLU and 2x2
max-pooling, then 784→32→11 dense layers. Train once for ten epochs, seed 1729.
24,200 synthetic samples use Noto Sans, Noto Serif and Lato; blur, fading,
horizontal compression, small rotations, broken strokes and noise are varied.
The reject class includes blank/noisy crops, edge remnants, signs, letters and
multi-digit strings. It is not a universal out-of-distribution detector.

Validation uses 1,100 new samples of training font families. The final checkpoint
is saved BEFORE generating the 4,400-sample DejaVu/Liberation held-out test.
Those font families and the two repository photographs never enter training.
No MNIST or external image dataset is used, and no solver-derived labels enter
training. Fonts are loaded locally, not redistributed.

## Actual first-prototype results

- Held-out generated digits: **3,863/4,000 correct (96.575%)**.
- Held-out generated reject examples: **380/400 correctly rejected**.
- Combined: **4,243/4,400**. Among 3,233 samples with top softmax score >=0.99,
  **11 are still wrong**. A high model score is NOT a calibrated probability
  of correctness or permission to accept a clue automatically.
- Offline crops from the repository Sudoku and Str8ts photographs, each in
  original/small/faded/mild-fade/blur variants: **216/220 printed clue instances
  correct**, plus **one false digit on a non-clue**. These are two photographs
  reused across five variations, NOT 220 independent photographs.
- The difficult Str8ts `2` at cell 61 is still called `7` in three variants;
  another black-cell clue is rejected after downsampling. The false positive
  is cell 63 in the faded Str8ts variant (top score about 0.740).
- **16 Node tests passed**, including 11 PyTorch/JavaScript logit parity vectors,
  checksum/shape validation, rejection and malformed-input checks.
- Offline Node crop classification (including preprocessing) took roughly
  24–39 ms per 20–24-crop photo variant here. These are local CPU measurements,
  not physical iPhone or browser latency results.

The offline photo test uses the deployed scanner's actual `warp` and
`prepareScan`, from commit `0984e657af57ed03f4bff785bf6aab18e28b8c9f`, followed
by the same grayscale crop bounds. Test resizing/blur are done with Pillow,
not browser canvas; no direct accuracy comparison with historical browser
Tesseract percentages is claimed. It counts missed printed cells and false
positive extracted marks. Blank cells with no extracted entry are not sent to
the CNN. Multi-component entries are explicitly unsupported in this first test.

A full same-run browser shadow comparison was attempted but local HTTP
navigation was blocked by browser policy (`ERR_BLOCKED_BY_ADMINISTRATOR`).
Browser/physical-phone performance and improvement over current Tesseract have
**not** been established. The available evidence supports further experiments,
not replacing the current scanner.

## Reproduce

Use Python 3.13 and Node 22. Training dependencies are optional and isolated here.
Install the requirements and local fonts matching the manifest, then run:

```sh
# From this directory:
python -m pip install -r requirements.txt
python train.py --out artifacts
node --test infer.test.mjs
```

`--font-root` defaults to `/usr/share/fonts/truetype`; use a local font tree with
the relative paths listed in `train.py` on other systems. Different font files
or software may change results. `training-report.json` records font SHA-256s,
versions, counts, history and the full confusion matrix. No fonts are bundled.

For offline photo measurement, first build the normal scanner (`python
scripts/build_web.py` from the repository root), then from this directory:

```sh
python prepare_photos.py --source ../..
node photo_probe.mjs ../../_site
```

Weights and detailed outputs live under `artifacts/`, intentionally untracked.
The accompanying downloadable experiment bundle includes the already-trained
weights, manifest, parity vectors and measured reports. The trained float32
weight SHA-256 is:
`af894f2d71035020a1554d9791937592cd480db42d1c7935d75d21dacbaa7978`.

## Integration decision

A sensible next stage is shadow-only comparison on a larger, separately held-out
set of real scanned cells. Keep Tesseract for whole multi-digit clues, signs and
cage targets; never coerce a multi-digit image through a single-digit classifier.
Disagreements may justify a review highlight, not an automatic replacement.
Before a fast path, measure false positives on blank cells, accepted-error rate,
coverage, real whole-puzzle accuracy and physical-phone latency. Save corrected
training examples only through an explicit opt-in, not silently.

Reference: Tesseract itself already uses neural OCR; specialization and differing
errors are the motivation, rather than adding a neural network for the first time.
https://tesseract-ocr.github.io/tessdoc/
