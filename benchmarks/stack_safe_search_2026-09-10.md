# Stack-safe search and guarantee normalization — 2026-09-10

Baseline: `5d10f328a4b18a5ab2ee0066c3e8454d0fca7784`.
Python 3.14.7, complete default technique profiles, no recursion-limit changes.

The solver now drives suspended DFS branches with an explicit stack. Branch
priority, per-branch solution caps, and trail rollback stay unchanged. Guarantee
normalization discards hook/iterator side effects before committing canonical
outputs, with a fast path for built-in batches containing exact immutable data.

The existing `scripts/benchmark_exact_cages.py --root CHECKOUT --case CASE`
child harness produced identical solution fingerprints, root deduction
fingerprints, and branch counts for both revisions:

| Case | Solutions | Branch nodes | Before (seconds) | After (seconds) |
|---|---:|---:|---:|---:|
| Blank 4x4 Sudoku | 288 | 269 | 21.487 | 20.040 |
| Killer hard290 | 1 | 0 | 0.052 | 0.063 |
| Killer Times deadly | 1 | 0 | 0.090 | 0.102 |
| Blank 2x2 Slitherlink | 13 | 13 | 0.0052 | 0.0054 |
| Blank 3x3 Slitherlink | 213 | 213 | 0.137 | 0.136 |

These are single fresh-interpreter observations, not a speedup claim. The two
short Killer cases were checked again with five alternating before/after runs.
Median times were 0.05850/0.05752 seconds for hard290 and 0.10364/0.09785 seconds
for Times deadly; the initial slowdown did not persist.

An independent mixed-constraint enumerator checked 450 generated puzzles across
all three technique profiles and solution caps unlimited/1/2: 4,050 solves, with
exact full solution sets and valid, correctly sized capped subsets. Caller state
was unchanged. The cases included 20 unsatisfiable, 40 unique, and 390 multiple
solution puzzles.

New regressions cover 1,024-decision searches, a valid blank 32x32 Slitherlink,
deep exception/cancellation cleanup, and guarantee normalization failure,
success, retry, iterator, metadata, cache/index, and hook-lookup boundaries.
