# Solver memory and dead-end pruning — 2026-09-23

Branch `fix/solver-memory-and-pruning` against master `fa48f70` (a detached,
read-only worktree), Python 3.14.5 (GIL build) on Windows. Runs longer than a
minute used idle process priority on a host that other jobs kept close to full
load, so wall times swing widely; CPU times are quoted wherever the comparison
depends on them. Raw default-path samples: `solver_memory_pruning_2026-09-23.json` (its
`baseline` field is the script's pinned historical constant, not the tree
measured).

Decision: **accept**. Identical fingerprints on every default-path case, no
measured regression, and large memory and dead-end improvements.

## What changed

1. Sum cages keep their distinct-value partitions as bitmask arrays in a
   byte-bounded process cache (8 MiB, nothing over 2 MiB retained), released
   after every browser solve. The cage matching skips partitions that cannot
   support a new (cell, value) pair and stops once every candidate pair is
   supported. 100,000 random states give master's exact candidates, sub-rules
   and guarantees, in master's order.
2. The executors no longer strip caches or clone the root: `Grid.__getstate__`
   under `worker_serialization()` already does it. Capped and uncapped process
   solves of 29 instances fingerprint exactly as on master; the clone cost
   0.16-0.23 ms per parallel solve.
3. Kakuro groups of runs whose across and down totals differ get an
   `UnsatisfiableRule` at load time. The Hidato/Numbrix path rule works on
   per-value cell bitsets and adds distinct-neighbour support and Regin's
   all-different matching to its layered walks.
4. Seeded oracle tests for path puzzles, Kakuro and Killer.

## Default path (`scripts/benchmark_exact_cages.py`, five pairs)

`benchmark_exact_cages.py` now clears whichever partition caches the measured
tree has (`release_partition_caches()` where it exists, the legacy tuple cache
otherwise), so each timed solve starts cold on both trees, and allows a child
900 s instead of 180 s, which a loaded idle-priority sudoku4 run exceeded.

| Case | Master median | Branch median | Change | Solutions | Branches |
|---|---:|---:|---:|---:|---:|
| sudoku4 | 171.408 s | 149.197 s | -12.96% | 288 | 269 |
| killer-hard | 0.350 s | 0.432 s | +23.32% | 1 | 0 |
| killer-deadly | 0.518 s | 0.582 s | +12.31% | 1 | 0 |
| slitherlink2 | 0.035 s | 0.019 s | -46.96% | 13 | 13 |
| slitherlink3 | 1.115 s | 1.038 s | -6.90% | 213 | 213 |

Every sample of both trees had the same solution fingerprint, root deduction
fingerprint, solution count and branch count. sudoku4 normally takes about
33 s; here its samples ranged from 111 s to 219 s, and the Killer samples from
0.16 s to 0.69 s, in both trees. The two Killer medians were therefore
re-measured by CPU time: seven interleaved pairs of fresh interpreters, each
timing ten cold solves with `time.process_time()`.

| Case | Master CPU median | Branch CPU median | Change |
|---|---:|---:|---:|
| killer-hard | 0.1219 s | 0.1187 s | -2.56% |
| killer-deadly | 0.1969 s | 0.1875 s | -4.76% |

The bundled Kakuro (8) and Killer (2) examples, capped at two solutions,
four CPU samples per file on each tree in two alternating rounds: the sum of
medians fell from 5.83 s to 5.17 s (-11.3%), with identical solutions.

## Memory (the review's Killer probes, 25x25)

| Probe | Master | Branch |
|---|---:|---:|
| 12-cell cage, sum 156 (110,780 partitions): retained | 93.8 MiB | 0.43 MiB |
| same cage: first `apply()` on an empty cage, CPU | 13.6 s | 0.02 s |
| 12/13-cell row cages, no givens, 300 s CPU budget: peak RSS | 1579 MiB | 68 MiB |
| 12-cell cages, half the givens: RSS left after a browser solve | 208 MiB | 4.2 MiB |
| same: CPU per solve | 6.8-8.1 s | 1.3-1.4 s |
| 13-cell cages, half the givens: RSS left after a browser solve | 370 MiB | 5-6 MiB |
| same: CPU per solve | 7.2-10.2 s | 2.5-2.6 s |

Neither tree finished the no-givens board within the CPU budget.

## Dead ends (CPU seconds, two solutions requested as in the browser)

| Case | Master | Branch |
|---|---:|---:|
| Kakuro 4x4, rows 95 vs columns 96: RULES_ONLY / GENERIC / FULL | 5.67 / 76.2 / 96.1 | 0.00 / 0.00 / 0.00 |
| empty Hidato 6x6 | 5.42 (1,846 nodes) | 0.02 (20 nodes) |
| empty Hidato 8x8 / 10x10 / 12x12 | >20 / >20 / >20 | 0.11 / 0.28 / 0.78 |
| empty Hidato 16x16 / 25x25 | >60 / >60 | 3.8 / 43 |
| Hidato 8x8 with only 1 and 64 | >300 | 16.6 |
| Hidato 10x10 with only 1 and 100 | >300 | >300 |
| Hidato 8x8, three boards each at 15/25/35% clues (worst) | >20 | 0.39 |
| empty Numbrix 6x6 / 8x8 / 10x10 / 12x12 | 0.06 / 0.14 / 0.72 / 2.59 | 0.05 / 0.12 / 0.22 / 0.53 |
| empty Numbrix 16x16 / 25x25 | 25.3 / >60 | 2.4 / 26 |

The retained example corpora (`scripts/run_new_family_corpus.py`, one run
each, wall time) keep every status: Hidato 7 files 103.1 s to 3.4 s
(Mebane-III.10-W3 97.0 s to 3.2 s), Numbrix 6 files 5.4 s to 0.5 s, Kakuro 8
files 6.9 s to 5.7 s.

## Differential fuzzing (fresh seeds, idle priority)

The review's fuzzers, each instance checked uncapped, at caps 1-3, under the
alternative profiles, with determinism repeats and, on every tenth
multi-solution instance, the process and thread executors:

| Fuzzer | Instances | Mismatches |
|---|---:|---:|
| `fuzz_path.py --seed 923` (GENERIC, FULL) | 3,000 | 0 |
| `fuzz_killer.py --seed 924 --max-sols 40` (GENERIC, RULES_ONLY) | 218 | 0 |
| `fuzz_kakuro.py --seed 924 --max-sols 40` (RULES_ONLY, FULL) | 224 | 0 |

The path run also recorded 372 construction errors: random blocked cells that
disconnect the board, which the constructor rejects by design, as in the
review's runs.
