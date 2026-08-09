# Silent logging and hot-call experiments — 2026-08-09

All measurements used CPython 3.14.6 on GitHub's Ubuntu runner,
`PYTHONHASHSEED=0`, the complete default technique hierarchy,
two timed repetitions per case, and SHA-256
comparison of the complete returned solution sets.

## Accepted: handler-aware lazy logging

Ordinary API use without an explicitly configured output handler no
longer treats the library's `NullHandler` as visible output. Expensive
display-only work is guarded before formatting or sorting, and atomic
solver step rendering is skipped before constructing messages.

| Case | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Blank 4x4, all 288 solutions | 49.542 s | 48.603 s | -1.89% |
| Non-square 6x6, first 20 solutions | 23.299 s | 23.241 s | -0.25% |

Solution hashes were identical in both cases. The targeted candidate
suite passed 61 tests with three deliberately deselected cases; the
promoted source then passed 159 bounded tests, the metadata guard,
and all representative end-to-end examples.

## Rejected: mutation epoch for fixpoint snapshots

Replacing the complete propagation snapshot with a trailed mutation
counter was correct in the targeted suite but did not repay the added
mutation bookkeeping and rollback complexity.

| Case | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Blank 4x4, all 288 solutions | 49.270 s | 49.045 s | -0.46% |
| Non-square 6x6, first 20 solutions | 23.364 s | 23.327 s | -0.16% |

## Rejected: removing power-action lambdas

Passing callables and positional arguments directly to `_act` removed
closure allocation but weakened typing and made the action table less
readable for a result within runner noise.

| Case | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Blank 4x4, all 288 solutions | 41.555 s | 41.285 s | -0.65% |
| Non-square 6x6, first 20 solutions | 19.853 s | 19.831 s | -0.11% |

These two rejected designs should not be retried without a materially
different representation or a workload demonstrating a larger gain.
