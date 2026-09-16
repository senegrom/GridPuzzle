# Grid detection

Detection has two stages in `web/geometry.js`, both run in the geometry
worker on a copy of the frame no larger than 640 pixels (the live camera) or
1600 pixels (a loaded photograph).

1. **Outline.** The adaptive ink mask (window 25, bias 12, ceiling 215) is
   split into connected components; the largest one that is big enough and
   convex enough gives the four corners (its extreme points). This stage
   almost never fails on paper: measured on the corpus it produced a quad for
   every one of 202 newspaper photographs, with corners within 3% of the
   grid's diagonal in the great majority.
2. **Lines.** The quad is warped to 540 × 540 and the grid lines are read
   from the warp; the line count gives rows and columns and decides the
   confidence (0.94 with a lattice, 0.45 without, which the callers reject).

## The outline stage

A photograph of a page on a dark table makes the page's edge the largest
component of the ink mask: a thin ring around the grid, whose extreme points
are the page's corners, not the grid's. Measured on the rendered "photo"
variants of the corpus this was the whole loss in every family: in each case
the true grid was the second-largest candidate, inside the ring, with corners
within 0.2–0.8%. When a substantial candidate (at least a quarter of the
largest one's area) lies inside the largest one, it is taken as the grid if it
carries a lattice; otherwise the largest wins as before.

### Pieces cut off by white lines

A white line through a black region splits its ink component. A Kakuro clue
cell is cut by its diagonal, so a black corner cell leaves its corner triangle
as a piece of its own and the extreme point slides a whole cell along the
edge; and a diagonal that ends on a line intersection cuts the lines there,
so the border band, the corner triangles and the interior can all be
separate pieces. A candidate is therefore also read *widened*: its pixels are
dilated by about half a percent of the frame (a clue diagonal at any scale,
not a caption a few millimetres off), the ink that meets is added together
with whatever ink connects to it, and this is repeated up to three times.
The plain extreme points are settled first; the widened ones are settled too
when they differ by more than one percent, and win only when they carry the
clearly better lattice, or more cells of the same pitch about as well (a
quad short by one black band leaves a regular lattice one column short).
Widening alone was measured first and rejected: a toolbar or caption a few
pixels from a screenshot's grid pulled forty app screenshots off their
lattice.

## The line stage

Measured on September 14, 2026 against the corpus (`corpus/SOURCES.md`), the
line stage was where detection was lost: 84 of 202 newspaper photographs and
686 of 1398 book and app photographs returned a correct quad that the line
stage rejected, and 131 accepted grids reported the wrong size (a 9 × 9 read
as 3 × 3). In every inspected case the thin cell lines reached only 25–45% of
the warp's height in the ink mask against a fixed 47% cutoff, so one line
dropped out of the regularity test or only the thick box lines survived it.

The stage now works as follows.

- **A sensitive line mask.** Lines are read from a mask with bias 6 and no
  ceiling, in which the weakest true line of the rejected cases sits near
  50–75% while the darkest column of digits stays near 30–40%; the cutoff is
  42%. (The ink mask for the outline stage is unchanged.)
- **Cross-axis exclusion.** Every column crosses all the horizontal lines and
  vice versa, and that shared ink alone lifts a column of digits toward the
  cutoff. Each axis is measured again over the rows (columns) that are not
  lines of the other axis.
- **Clustering.** Lines closer than 3% of the length are one line: a cage wall
  drawn just inside a cell edge, a doubled border, a thick line split by the
  threshold. Without this the median gap of a KenKen collapses to the wall
  offset.
- **A tolerant lattice.** The median gap seeds the spacing, but pixel-rounded
  gaps must not be extrapolated unchanged across a large board. For each phase
  hypothesis, fit phase and spacing globally to the supported thin lines,
  iterating up to three times before rejecting strays. Wide black-cell bands
  still match by centre/edge but do not bias the fit. Refinement stays within
  ten percent of the initial pitch; the best hypothesis holds the most lines,
  with squared residual breaking ties. Strays remain limited to one in five;
  at least four in five positions and the outer-edge checks still apply.
- **Digit columns.** When every other lattice position is markedly weaker
  than its neighbours, those are cell centres of a fully written grid and the
  true lattice is half as fine.
- **One-axis fallback.** When only one axis yields a lattice, the other is
  tested at that cell count, since the warp maps the quad to a square.
- **Black cells.** The adaptive mask never marks the inside of a black cell,
  only its edges, so a grid line running past black cells is visible only
  along white cells and its column read at half strength. Each column and row
  is measured over the pixels that are ink or not absolutely dark, so the line
  counts where it can be seen; a column or row that is mostly hidden cannot
  carry a line.
- **An edge map as second chance.** With two fifths of the cells black, a
  line between two black cells is invisible to any relative ink mask and a
  black cell's marked rim is a band centred inside the cell. When the ink
  profile yields no lattice, the lines are read again from an edge map (a
  pixel whose neighbours two apart differ by thirty levels): every black
  and white boundary is an edge exactly on the lattice, a line on paper is a
  pair of edges, and the inside of a black cell is nothing. Dark pixels count
  as visible only where they are edges, so the invisible boundary between two
  black cells is not held against a line.
- **The lattice's phase and bands.** The phase is the one that holds the most
  lines, not the strongest line's: a black border column reads as a band as
  strong as any line, centred half a cell inside the border. A group at least
  half a cell wide is a run of black cells, so either of its edges may sit on
  the lattice, and the border is then the band's outer edge. Each lattice
  carries a quality, the share of positions held less the share of strays,
  so two readings of one grid can be compared.
- **Skew.** A quad a few percent off the grid slants every line in the warp
  and smears its column across several. Each axis is read in the frame that
  straightens it: a small search over shears (up to about 3% of the length,
  scored on a subsample by the energy of the profile) picks the sharpest one,
  and the lattice is read there.

## Settling the corners

The outline's extreme points can sit a few percent off the grid (a digit
touching the border, a black corner cell missing from the ink mask, a
shadow), and a warp cut exactly at the border leaves the border line without
a lighter neighbour on its outer side, so along black cells it is never
marked. The quad is therefore warped with a 4% outward margin; the lattice's
outer lines, read in the sheared frame, are the grid's border and are mapped
back through the homography; and the tighter quad is confirmed with a second
padded warp that must find the same lattice. Fitting lines to the component's
boundary was measured first and rejected: on tilted quads a slanted side
contaminates its neighbour's samples and pulls the fit by about 4%.

When a substantial candidate lies inside the largest one it is tried first,
since a page on a dark table makes the page's edge the largest component;
but when the largest also carries a lattice of the same pitch and the ring
between the two settled quads is at least a fifth ink, the inner one is a
sub-grid whose black clue band was cut off by its diagonals, and the whole
grid wins. Empty paper between a grid and a page's edge one cell out is not
that; the ring is measured inside the outer quad inset by three gaps, so the
band of dark table marked along the edge does not count.

## Measured

Good detections (grid found, right size, corners within 3% of the diagonal)
at the live scale, per corpus set, before and after the change:

| Set | Original | Line stage | + outline stage | + black cells, skew, settling | + widening, edge map, phase |
| --- | ---: | ---: | ---: | ---: | ---: |
| newspaper photographs (wichtounet) | 109 / 202 | 177 / 202 | 178 / 202 | 187 / 202 | 191 / 202 |
| book, app and screen photographs (Lexski) | 500 / 1398 | 912 / 1398 | 917 / 1398 | 957 / 1398 | 986 / 1398 |
| Kakuro renders (janko) | 0 / 111 | 0 / 111 | 0 / 111 | 0 / 111 | 106 / 111 |
| KenKen renders (janko) | 1 / 120 | 87 / 120 | 120 / 120 | 120 / 120 | 120 / 120 |
| Killer renders (janko sum puzzles, generated) | 0 / 240 | 177 / 240 | 238 / 240 | 238 / 240 | 238 / 240 |
| Str8ts renders (janko) | 65 / 120 | 74 / 120 | 107 / 120 | 120 / 120 | 120 / 120 |
| Sudoku, Latin, Numbrix, Hidato, Futoshiki renders | ~88 / 120 each | ~88 / 120 each | 116–119 / 120 each | 116–119 / 120 each | 116–119 / 120 each |

The line stage lost fourteen images the original accepted, all with one axis
found and the other not; the outline stage lost one more; the last step lost
ten book and app photographs against fifty gained. The first two changes cost
no time; the settling step raised the median from about 20 to 25–40 ms per
frame at 640 pixels, since a quad whose corners move by more than one percent
is confirmed on a second warp. The last step costs nothing on a grid whose
plain extreme points already carry a lattice; a grid that needs the second
reading (every Kakuro, a quad pulled off by a blob) takes about twice as
long, 80 ms per frame at 640 pixels for Kakuro against 26-41 ms for the other sets, one to nine milliseconds more than before for the widening walk and the second settle where it applies.

## Known gaps

- **Slitherlink** (dots, no lines) is not found. **Kakuro** (black cells
  everywhere) was not either until the widening, the edge map and the
  lattice's phase: the adaptive ink mask marks only pixels darker than their
  surroundings, so the inside of a black cell is never ink, and a white clue
  diagonal cuts a black corner cell off its own outline. Adding absolute
  black to the outline mask was tried first and rejected: it gained three
  Kakuro images and lost five elsewhere, because dark regions of real
  photographs pull the corners. Kakuro now reads 106 of 111 renders; the five
  left are photo variants where a shadow or the paper's edge wins the outline
  or a black column is read one cell short.
- A rendered photograph whose paper margin equals the cell pitch reads as a
  grid one cell larger all round when the page's edge is dark: the extra
  lattice positions are held by the edge, the ring between is empty paper,
  and nothing distinguishes it from an empty border row. One Numbrix render
  in 120 is lost to it.
- Photographs of screens can carry a light-on-dark theme; the sensitive mask
  reads the dark halo beside a bright line, which is enough for box lines but
  not always for cell lines.
- `corpus/detect_benchmark.cjs` reproduces the measurement over every corpus
  image with corner ground truth, at both scales, in a few minutes; it is a
  measurement, not a gate. `web/tests/grid-lines.test.js` pins each rule above
  on synthetic warps.

## Rounding and benchmark regressions (September 16, 2026)

The later outline/phase work already recovered the original 21x21 and 25x25
full-frame examples from the review, but direct 24/25-cell warps could still
lose two rows/columns and a thick 23x23 frame could still lose its lattice.
Global pitch refinement fixes those remaining cases without reverting the
black-cell, edge-map or widening work. `web/tests/grid-size-range.test.js`
checks both the 540px lattice stage and complete detection for every size
3 through 25 at three stroke widths, plus rectangular grids in both
orientations. Sizes 1 and 2 remain outside automatic lattice inference.
The photographic corpus was not rerun for this change; the historical table
above is not a new measurement of the refined implementation.

`corpus/detect_benchmark.cjs` now shares the OCR benchmark's checkpointing and
cleanup runner. The output is a **formatVersion 1 object**, not the previous
bare array: per-image measurements are in `results`; run `status`, `failure`,
`cleanupErrors`, `totalImages`, `completedImages`, and per-set/per-scale
`summary` fields describe completion. Consumers of the old JSON array must
read `report.results`. The numeric `error` inside each scale remains corner
error; a top-level row `error` is an input or execution failure, excluded from
success metrics and counted separately as `failed`.

The report is saved before startup, after each image, and after cleanup.
Malformed targets and image decoding failures are recorded individually and
later images continue. Browser loss, SIGINT or SIGTERM stop the run with a
partial failed/interrupted report; all allocated resources are closed.
Images with valid targets but no corner truth remain intentionally excluded;
invalid targets are included as diagnostic failures and count toward the
per-set `--limit`. `--engine webkit` is also available. The permanent
scanner-settings browser gate exercises an actual bad PNG between two valid
PNGs in both Chromium and WebKit, alongside the hidden-box-control regression.
