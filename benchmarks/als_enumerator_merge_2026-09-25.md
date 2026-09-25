# One ALS enumerator for the ALS pass and Sue de Coq — 2026-09-25

Baseline master `80889e3`; candidate the same tree with the merge (branch
`perf/als-enumerator`). Python 3.14.5 (GIL build) on Windows, `PYTHONHASHSEED=0`,
idle priority on a host other jobs kept loaded, so CPU time is compared, not
wall time. Raw samples: `als_enumerator_merge_2026-09-25.json`.

Decision: **accept**. Identical results on every call and every solve, no
measured regression, and the ALS pass's own enumeration is 47% cheaper.

## What changed

`solve_als._build_als_list` (the ALS-XZ / ALS-XY-Wing analysis) and
`solve_sue_de_coq._find_als` each hand-rolled "N cells with N+1 candidates,
N in 1..3" with `itertools.combinations`. Both now use `solve_als.iter_als`,
which yields singles, then pairs, then triples in the order of the cells it is
given. Each caller keeps its own input scope: the ALS pass passes a house's
unsolved cells with two or more candidates, as frozen snapshots, and removes
duplicates across houses; Sue de Coq passes a box or line remainder with its
live candidate sets and the intersection's values as the overlap filter.

## Equivalence

- 4,000 random candidate states (known cells, unsolved single-candidate cells,
  extra irregular houses): master's `_build_als_list` and the new one return
  the same lists in the same order; 12,000 random Sue de Coq inputs give the
  same lists as master's `_find_als` (338,110 ALSs in total).
- Shadow solves: while the new code solved `t` (the hardest built-in example),
  Magictour #1 and #113, Mith, Killer examples c and d, a 9x9 Latin square
  and a 16x16 Sudoku, every call was also answered by master's code on the same
  live state and compared: 1,567 ALS-pass calls and 127,344 Sue de Coq calls,
  all identical (116,275 ALSs). Identical answers on every call mean the
  search is unchanged.
- Every benchmark sample below has the same solution fingerprint on both trees.

## Whole solves (CPU seconds, median of fresh interpreters)

| Puzzle | Samples | Master | Branch | Change |
|---|---:|---:|---:|---:|
| Mith (x20 per sample) | 7 / 7 | 2.625 (2.500-2.703) | 2.734 (2.531-2.797) | +4.2% |
| Magictour #1 (x5) | 7 / 7 | 2.984 (2.953-3.094) | 3.078 (2.891-3.172) | +3.1% |
| Magictour #113 (x2) | 7 / 7 | 4.453 (4.328-4.844) | 4.438 (3.844-4.563) | -0.4% |
| Example `t` | 5 / 5 | 70.75 (67.25-71.20) | 69.22 (66.38-69.94) | -2.2% |

Every pair of ranges overlaps. Mith calls Sue de Coq about 100 times and the
ALS pass once per solve, a small fraction of the solve, so its +4% cannot come
from the changed code; example `t`, where the enumerators run 124,598 times
per solve, is 2.2% faster.

## The changed code alone (CPU seconds, 7 interleaved samples)

| Workload | Master | Branch | Change |
|---|---:|---:|---:|
| ALS pass over 300 random states, 4 passes | 1.359 (1.312-1.469) | 0.719 (0.672-0.750) | -47.1% |
| Sue de Coq lists, 300 inputs, 200 passes | 1.422 (1.406-1.484) | 1.438 (1.422-1.484) | +1.1% |

The ALS pass is cheaper because master built each triple's union and cell set
through generator expressions; the shared generator unions the three sets
directly. Sue de Coq already did, and stays within noise.
