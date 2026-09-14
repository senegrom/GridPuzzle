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
- **A tolerant lattice.** The spacing is the median gap, which survives one
  dropped line; the anchor is the strongest line; lines off the lattice are
  strays, tolerated up to one in five; at least four in five lattice positions
  must hold a line and the outermost ones must sit near the warp's edges.
- **Digit columns.** When every other lattice position is markedly weaker
  than its neighbours, those are cell centres of a fully written grid and the
  true lattice is half as fine.
- **One-axis fallback.** When only one axis yields a lattice, the other is
  tested at that cell count, since the warp maps the quad to a square.

## Measured

Good detections (grid found, right size, corners within 3% of the diagonal)
at the live scale, per corpus set, before and after the change:

| Set | Before | After |
| --- | ---: | ---: |
| newspaper photographs (wichtounet) | 109 / 202 | 177 / 202 |
| book, app and screen photographs (Lexski) | 500 / 1398 | 912 / 1398 |
| KenKen renders (janko) | 1 / 120 | 87 / 120 |
| Killer renders (janko sum puzzles, generated) | 0 / 240 | 177 / 240 |
| Str8ts renders (janko) | 65 / 120 | 74 / 120 |
| Sudoku, Latin, Numbrix, Hidato, Futoshiki renders | unchanged (about 88 of 120 each) |

Fourteen images that the old stage accepted are now rejected, all with one
axis found and the other not. The change costs no time: the median is about
20 ms per frame at 640 pixels either way.

## Known gaps

- **Kakuro** (black cells everywhere) and **Slitherlink** (dots, no lines) are
  not found by either stage; they need their own outline and lattice logic.
- The rendered "photo" variants fail mostly in the outline stage, where the
  paper's edge on a dark surface can become the largest component.
- Photographs of screens can carry a light-on-dark theme; the sensitive mask
  reads the dark halo beside a bright line, which is enough for box lines but
  not always for cell lines.
- `corpus/detect_benchmark.cjs` reproduces the measurement over every corpus
  image with corner ground truth, at both scales, in a few minutes; it is a
  measurement, not a gate. `web/tests/grid-lines.test.js` pins each rule above
  on synthetic warps.
