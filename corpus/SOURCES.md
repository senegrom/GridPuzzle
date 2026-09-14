# Puzzle image corpus

A local corpus of grid-puzzle images with machine-readable targets, used to
measure the browser scanner. It is **not published**: several sets are under
licences that allow private use only, and the images stay on this machine.

The corpus directory (default `E:\OneDrive\Coding\PuzzleCorpus`, override with
`PUZZLE_CORPUS`) holds **only images and targets**. Everything else — the
fetchers, the renderer, the generated index and this note — lives here in the
repository.

    <family>/<set>/<name>.<jpg|png|webp>
    <family>/<set>/<name>.json

Every image has a target. A target is:

```json
{"puzzle": {…},              // exactly what gridsolver.web_api.build_grid accepts
 "corners": [[x,y], …],      // grid outline in image pixels, clockwise from top-left
 "solution": [ … ]}          // complete grid, where the source gives one
```

Only `puzzle` is always present. Every payload is built through
`gridsolver.web_api.build_grid`, so a target can never disagree with the
solver's input contract. Rendered targets with a supplied solution are also
checked against every original rule by `corpus/validate_target.py` before any
image or target is written. Shape acceptance alone does not prove a solution;
no uniqueness claim is made for generated puzzles or witness-free targets.

## Contents

3858 images, 400 MiB, 10 families, 22 sets. 2345 are real photographs; 3013
carry grid-corner ground truth.

| Family | Set | Kind | Images | Corners | Solution |
| --- | --- | --- | ---: | ---: | ---: |
| futoshiki | janko-futoshiki | render | 120 | 120 | 120 |
| futoshiki | newspaper-photo | printed photo | 1 | – | 1 |
| hidato | janko-hidato | render | 120 | 120 | 120 |
| kakuro | janko-kakuro | render | 111 | 111 | 111 |
| kenken | janko-kenken | render | 120 | 120 | 120 |
| kenken | janko-killersudoku | render | 120 | 120 | 120 |
| killersudoku | generated-render | render | 120 | 120 | 120 |
| latinsquare | generated-render | render | 120 | 120 | 120 |
| numbrix | generated-render | render | 120 | 120 | 120 |
| slitherlink | janko-slitherlink | render | 111 | 111 | – |
| str8ts | janko-str8ts | render | 120 | 120 | 120 |
| sudoku | generated-render | render | 120 | 120 | 120 |
| sudoku | janko-sudoku | render | 111 | 111 | 111 |
| sudoku | kuleuven-assistant | printed photo | 83 | – | – |
| sudoku | lexski-mixed | printed photo | 1398 | 1398 | – |
| sudoku | rozet-handwritten | handwritten photo | 400 | – | – |
| sudoku | rozet-newspaper | printed photo | 9 | – | – |
| sudoku | rozet-render | render | 100 | – | – |
| sudoku | wichtounet-newspaper | printed photo | 203 | 202 | – |
| sudoku | wichtounet-originals | printed photo | 46 | – | – |
| sudoku | wichtounet-solved | solved photo | 200 | – | 200 |
| sudoku | wichtounet-solved-extra | solved photo | 5 | – | 4 |

`kind` says what the image is: `printed-photo` a photograph or screenshot of an
unsolved puzzle, `solved-photo` one with handwritten answers as well,
`handwritten-photo` a hand-drawn grid, `render` a clean drawing.

## Downloaded sets

**wichtounet/sudoku_dataset** — <https://github.com/wichtounet/sudoku_dataset>.
Newspaper Sudokus photographed with phone cameras. `images/` is 640×480 and
comes with `outlines_sorted.csv`, which is where the corner ground truth comes
from; `original/` holds the same photographs at up to 2448×3264 (only the 46
whose downscaled twin carries a grid are included); `mixed/` is the same
puzzles after being solved in pen. Licence, quoted from its README: *"The
dataset and the images are released under the CC-BY-4.0 License. The code (cpp
and bash) is released under the MIT License."*

**Lexski/sudoku-image-recognition** — Hugging Face,
<https://huggingface.co/datasets/Lexski/sudoku-image-recognition>. 1400 images:
photographs of newspaper and book grids, photographs of screens, app
screenshots and hand-drawn grids, many with pencil candidate marks. Per-cell
values *and* four corner keypoints per image. Pencil-mark cells are recorded as
empty and counted in the index. Licence: CC0 1.0. The single most useful set
here — it is the only downloaded source with corner ground truth on modern
photographs.

**KU Leuven, Sudoku Assistant photographs** — RDR
[10.48804/3SUHHR](https://rdr.kuleuven.be/citation?persistentId=doi:10.48804/3SUHHR),
file `data_assistant.tar.gz`. 103 photographs taken through the Sudoku
Assistant app, already perspective-corrected to the grid, 300×300, as numpy
arrays; 20 are byte-identical duplicates and are dropped. Targets hold every
visible digit and the index counts the handwritten ones. Licence: CC BY 4.0.
The archive is not fetched automatically; download it into the cache as
`kuleuven/data_assistant.tar.gz` (it is a plain tar despite the name).

**francois-rozet/sudoku** — <https://github.com/francois-rozet/sudoku>. Its
`blurry/` and most of `empty/` are byte-identical to wichtounet's photographs
and are skipped by the duplicate check; what remains is nine modern newspaper
photographs (several with neighbouring puzzles in frame, which makes grid
detection hard), 400 hand-drawn grids and 100 clean renders. No licence is
stated in the repository.

**sam-watts/futoshiki-solver** — a single webcam photograph of a newspaper
Futoshiki, `screens/input_puzzle.jpg`. The only photograph of a printed
non-Sudoku grid found anywhere public. Its clues and inequality signs were read
off the image by hand; the transcription is confirmed by the solver returning
exactly one solution. No licence is stated in the repository.

## Rendered sets

No public photograph corpus exists for Kakuro, Str8ts, KenKen, Futoshiki,
Hidato, Numbrix or Slitherlink — across Wikimedia Commons, GitHub, Hugging
Face, Zenodo, the Internet Archive and the puzzle publishers, the one exception
is the Futoshiki photograph above. Those families are therefore drawn here, and
the targets, including the corners, are exact by construction.

**janko.at** — <https://www.janko.at/Raetsel/>. Around 6000 published puzzles
across our families, each page carrying a plain-text block with the printed
clues and the solution; the site renders its grids in the browser and serves no
images. `corpus/fetch_janko.py` caches 40 pages per family, spaced across each
collection, one request every three seconds with an identifying user agent.
`corpus/parse_janko.py` converts them and drops any puzzle whose reading
disagrees with the published solution. Licence, quoted from every puzzle page:
*"Creative Commons 3.0 BY-NC-SA — Namensnennung, Keine kommerzielle Nutzung,
Weitergabe unter gleichen Bedingungen"*. Non-commercial: private measurement
only, and the corpus is not republished.

Janko's *Sumdoku* is a sum puzzle over a Latin square rather than a boxed
Killer Sudoku, so those 40 pages are filed as KenKen, which is what they are
under this app's rules. Killer Sudoku, Numbrix and plain Latin squares are
generated instead by `corpus/generate_puzzles.py`, which carves puzzles out of
a solved grid so the printed clues are consistent by construction.

`corpus/render_puzzles.py` draws each puzzle three ways: `clean` (the drawing,
PNG), `print` (newsprint tint, ink bleed, grain, JPEG) and `photo` (the print
variant seen at an angle on a surface, with a lighting gradient). Cell size,
margin and font vary per puzzle. Only the `photo` variant has non-trivial
corner ground truth, which is tracked through the perspective transform.

## Rebuilding

```bash
python corpus/build_corpus.py          # fetch and normalise the downloaded sets
python corpus/fetch_janko.py           # cache puzzle data, ~15 minutes, polite
python corpus/render_puzzles.py        # draw the rendered sets
node corpus/benchmark.cjs --family sudoku --set wichtounet-newspaper --limit 50
```

Downloads are cached under `E:\tmp-claude\corpus-cache` (`PUZZLE_CORPUS_CACHE`),
so a rebuild re-fetches nothing. `corpus/index.json` is generated and lists
every image with its source, size, clue count, whether it has corners, and its
md5; it is not committed. Duplicate images are detected by md5 across the whole
corpus, which is what removes the overlap between the Sudoku repositories.

## Sources checked and not used

Kaggle (needs credentials), Roboflow (needs an API key), Zenodo (its API timed
out on every query), `jingyibo123/sudoku_dataset` and
`jeffreywolberg/sudoku_dataset` (both re-publish wichtounet's photographs; the
first adds digit bounding boxes that could be worth taking later),
`pk5ls20/SudokuDetect` (a 245 MB 7-Zip whose contents could not be verified),
several small unlabelled photo folders, and about 12000 synthetic digit crops
from `dharm1k987/sudoku-solver-opencv`.

For the other families: Wikimedia Commons has roughly 200 clean renders across
Kakuro, Str8ts, KenKen, Futoshiki, Hidato and Slitherlink, but the puzzle is
only in the picture — the file descriptions carry no transcription, so they
have no targets. KrazyDad publishes large printable PDF books with answer pages
whose text is extractable, but the cage and compartment geometry is vector art
that would have to be recovered path by path; its Kakuro books have no answers
at all. Internet Archive scans of puzzle books are lending-library only.
mathinenglish.com has about 62 puzzles as four-per-sheet GIFs with answer PDFs
and no stated licence.

## Correctness and scoring version 2

The contents table above records the September 13, 2026 build, not a count of
revalidated images. Rebuild rendered sets after the generator correction:
Killer cages now grow only through cells with distinct solution digits. The
renderer rejects invalid stored solutions (including changed givens, sums,
inequalities and blocked cells) using the native solution validator, without
searching for a different solution that could conceal bad ground truth.

Benchmark JSON now carries `scoreVersion: 2`. Do not compare its percentages
or perfect counts directly with older reports. Every Futoshiki sign is keyed
by its boundary and checked for direction; duplicate observations are counted
as extra readings. Cage membership is unordered, operator aliases are normalized,
and single-cell `=` and `+` targets are equivalent. Multi-cell operators and
numeric targets must still agree.

`topologyWrong` counts black/white or blocked/active cell disagreements, including
numbered Str8ts cells; `topologyUnsafe` is its unflagged subset. These are separate
from the printed-clue denominator. Invented numbers on blocked cells also count
as invented clues. `unsafe` counts unflagged errors, not distinct affected cells,
so a cell can contribute a topology error and a clue error. A perfect reading
requires no topology, shape, missing, wrong or invented-item errors as well as
all printed clues correct. Review flags never turn an erroneous reading perfect.

The pure scorer runs in the normal Node gate through
`web/tests/corpus-score.test.js`. The bounded Python suite includes 150 seeded
Killer witnesses at sizes 4, 6 and 9, plus validation of dense and compact target
mappings, in `tests/test_corpus_targets.py`. The external image collection is not
needed for these regressions and is not vendored.
