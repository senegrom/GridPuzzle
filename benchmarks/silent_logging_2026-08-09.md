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
