# Process-stable immutable rule hash cache — 2026-08-09

## Change

Registered rules are immutable, but `Rule.__hash__()` rebuilt a tuple containing
the concrete type, cells, dimensions, and value domain on every set lookup.
The base hash is now cached after the first freeze/hash operation.

The cached value is safe to pickle and reuse in another interpreter: the
concrete rule type is represented by a deterministic CRC32 tag of its fully
qualified class name, and the remaining hash inputs contain only integers and
tuples of integers. An injected cache value on an unfrozen rule is ignored and
overwritten, so extension code cannot bypass freezing or choose its hash.
Subclass-specific hashes continue to combine the cached base hash with their
own immutable target/relation fields.

## Profile evidence

Under `cProfile`, the base rule hash was called 7,968,999 times on complete
blank-4x4 enumeration and 2,101,835 times on the non-square 6x6 cap-20 case.
Its cumulative profile cost was 9.259 seconds and 2.270 seconds respectively.

## Correctness gate

The candidate passed Linux and Windows Python 3.14 suites covering:

Every benchmark run returned the same deterministic solution cardinality and
SHA-256 fingerprint as the baseline.

## Timings

GitHub-hosted Ubuntu 24.04 runner, CPython 3.14.6, one process, full technique
hierarchy, and `the complete technique hierarchy`. Baseline and candidate runs were interleaved.
Values below are medians.

| Case | Baseline | Candidate | Improvement |
|---|---:|---:|---:|
| Blank 4x4 Sudoku, all 288 solutions | 34.1320 s | 31.3024 s | **8.29%** |
| Non-square 6x6 Sudoku, first 20 solutions | 13.1015 s | 12.4384 s | **5.06%** |
| Killer Sudoku example A, first solution | 0.02802 s | 0.02669 s | **4.75%** |

The result is accepted as a default-solver optimization. It does not use or
alter depth gating.
