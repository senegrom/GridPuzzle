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

### Light-on-dark screens

The ink mask marks only what is darker than its surroundings, so a grid on a
screen with a dark theme has no ink of its own: its light lines survive only
as the dark halos beside them, enough for the box lines and not always for
the cell lines. A frame or warp that is mostly dark, and whose pixels far
from the median are bright rather than dark, is a light-on-dark screen (a
dimly lit page is mostly dark too, but what stands out on it is ink) and is
read inverted: in the line stage always, in the outline stage as a second
attempt when the plain one finds no grid.

### More candidates, and the grid within a quad

The largest component may be an app's frame, a browser panel or a shadow
beside the grid. When it carries no lattice the next two largest are tried,
and a full reading from any of them beats a partial one. When a quad took in
a toolbar or a page beside the grid, no axis spans the warp: as a last
resort, after the continuous-run profile, one axis that does span it is
matched by a regular run of exactly its number of lines
anywhere along the other, and when neither spans it both are searched for
runs of at least five lines whose pitches agree with the quad's aspect. A
run must hold seven tenths of the axis's lines (a window of a fragmented
grid must not pass as a smaller grid), a contained candidate never wins with
a partial reading, and settling must confirm the tightened quad or the
reading is dropped.

### Dot lattices

Slitherlink draws no lines, only dots at the lattice points, so no component
is grid-sized. When nothing else finds a grid, small round blobs (nearly
square, mostly filled) whose nearest neighbours sit at one common distance
are taken as the dots; their extreme points are the quad, the dots re-found
in the padded warp give the lattice on each axis, and the outer dots are the
corners, mapped back through the homography. Digits sit at cell centres, off
the common distance, and are not round.

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
- **The continuous-run profile as second chance.** Cells full of pencil marks
  or handwriting lift columns of small digits over the cutoff and bury the
  lattice in strays. When neither the ink nor the edge profile yields a
  lattice, each column and row is measured by its longest continuous run of
  ink (in the sheared frame, tolerating one pixel sideways): a grid line on a
  screen runs the height of the warp, while marks break at every cell.
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
since a page on a dark table makes the page's edge the largest component.

## A live frame and a photograph

The readings above are tried in order and each costs only when the ones
before it find nothing, but the frames that reach the end are exactly the
ones the live camera sees most: a page in view, not yet framed, with a quad
and no grid. `findGrid(image, { thorough })` divides them. A live frame gets
the outline, the widening, the inverted line stage and the
partial lattice; a still photograph also gets the extra outline candidates,
the continuous-run profile, the inverted outline pass and the dot lattice.
Measured on the app photographs at the live scale, a frame with a quad and
no grid takes 68 ms in the middle and 218 at its worst the quick way,
against 53 and 192 before this change and 120 and 794 with everything on;
the live path still finds more grids than before (1008 of 1398 against 986),
and the photograph finds 1056.

## Measured

Good detections (grid found, right size, corners within 3% of the diagonal)
at the live scale, per corpus set, before and after the change:

| Set | Original | Line stage | + outline stage | + black cells, skew, settling | + widening, edge map, phase | + polarity, candidates, runs, dots | + pitch refinement, three mechanisms removed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| newspaper photographs (wichtounet) | 109 / 202 | 177 / 202 | 178 / 202 | 187 / 202 | 191 / 202 | 191 / 202 | 191 / 202 |
| book, app and screen photographs (Lexski) | 500 / 1398 | 912 / 1398 | 917 / 1398 | 957 / 1398 | 986 / 1398 | 1054 / 1398 | 1061 / 1398 |
| Kakuro renders (janko) | 0 / 111 | 0 / 111 | 0 / 111 | 0 / 111 | 106 / 111 | 107 / 111 | 105 / 111 |
| Slitherlink renders (janko) | 0 / 111 | 0 / 111 | 0 / 111 | 0 / 111 | 0 / 111 | 85 / 111 | 85 / 111 |
| KenKen renders (janko) | 1 / 120 | 87 / 120 | 120 / 120 | 120 / 120 | 120 / 120 | 120 / 120 | 120 / 120 |
| Killer renders (janko sum puzzles, generated) | 0 / 240 | 177 / 240 | 238 / 240 | 238 / 240 | 238 / 240 | 239 / 240 | 239 / 240 |
| Str8ts renders (janko) | 65 / 120 | 74 / 120 | 107 / 120 | 120 / 120 | 120 / 120 | 120 / 120 | 120 / 120 |
| Sudoku, Latin, Numbrix, Hidato, Futoshiki renders | ~88 / 120 each | ~88 / 120 each | 116–119 / 120 each | 116–119 / 120 each | 116–119 / 120 each | 119–120 / 120 each | 119–120 / 120 each |

The line stage lost fourteen images the original accepted, all with one axis
found and the other not; the outline stage lost one more; the last step lost
ten book and app photographs against fifty gained. The first two changes cost
no time; the settling step raised the median from about 20 to 25–40 ms per
frame at 640 pixels, since a quad whose corners move by more than one percent
is confirmed on a second warp. The last step costs nothing on a grid whose
plain extreme points already carry a lattice; a grid that needs the second
reading (every Kakuro, a quad pulled off by a blob) takes about twice as
long, 80 ms per frame at 640 pixels for Kakuro against 26-41 ms for the other sets, one to nine milliseconds more than before for the widening walk and the second settle where it applies.
The polarity pass, the extra candidates, the continuous-run profile and the
dot lattice all run only when the readings before them find nothing, so a
frame that carries a grid costs the same as before; a grid that reaches the last of them costs about twice what it did, and one that never resolves about three times, all of it inside the one-shot photograph path.

### Measured and removed

Three mechanisms were taken out after a tagged run of the corpus showed
which of them decided each result, and a run with each disabled showed what
it was worth. The whole totals are 3013 images; "wrong" counts grids
reported with confidence but at the wrong size or place.

| Detector | Good | Wrong |
| --- | ---: | ---: |
| with all three | 2627 | 61 |
| without the whole-grid-over-inner ring rule | 2627 | 61 |
| without the fragment fallback | 2629 | 57 |
| without the edge map | 2628 | 47 |
| without all three | 2630 | 43 |

The edge map (a lattice read from black/white boundaries when the ink
profile found none) decided 42 results and was wrong in 19 of them; once
bands met the lattice with their edges and the pitch was refined, the ink
profile read Kakuro on its own, and the edge map was left inventing sizes on
app photographs. Two Kakuro renders are lost with it. The fragment fallback
(widening the largest pieces when no component is a grid-sized quad) fired
six times and was wrong four. The ring rule (the whole grid winning over a
contained sub-grid when the ring between them is inky) decided one image,
which reads the same without it. A frame with a quad and no grid, the case
the live camera sees most, costs about half of what it did, since the edge
map was a second full line stage on every failed estimate.

## Known gaps

- **Kakuro** (black cells everywhere) was not found until the widening and
  the lattice's phase and bands, and **Slitherlink** (dots, no lines) not
  until the dot lattice (85 of 111 renders): the adaptive ink mask marks only pixels darker than their
  surroundings, so the inside of a black cell is never ink, and a white clue
  diagonal cuts a black corner cell off its own outline. Adding absolute
  black to the outline mask was tried first and rejected: it gained three
  Kakuro images and lost five elsewhere, because dark regions of real
  photographs pull the corners. Kakuro now reads 105 of 111 renders; the six
  left are photo variants where a shadow or the paper's edge wins the outline
  or a black column is read one cell short.
- A rendered photograph whose paper margin equals the cell pitch reads as a
  grid one cell larger all round when the page's edge is dark: the extra
  lattice positions are held by the edge, the ring between is empty paper,
  and nothing distinguishes it from an empty border row. One Numbrix render
  in 120 is lost to it.
- Screens with a light-on-dark theme are read inverted now; the app
  photographs still lost are boards whose grid touches a UI row at exactly
  one cell's distance (read one row too tall), photographs at a steep angle
  or with glare, and grids drawn on lined or squared paper whose ruling
  merges with the grid.
- `corpus/detect_benchmark.cjs` reproduces the measurement over every corpus
  image with corner ground truth, at both scales, in a few minutes; it is a
  measurement, not a gate. `web/tests/grid-lines.test.js` pins each rule above
  on synthetic warps, and `web/tests/grid-size-range.test.js` checks the
  lattice stage and complete detection for every size from 3 to 25 at three
  stroke widths, plus rectangular grids both ways, because pixel-rounded gaps
  once lost rows from 24- and 25-cell warps. Sizes 1 and 2 stay outside
  automatic lattice inference.
