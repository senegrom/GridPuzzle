# Bounded parallel branch submission — 2026-08-09

The process-pool solver previously submitted every top-level branch before it
consumed the first result. Every task carried the same grid payload, so a small
positive `max_sols` could still allocate hundreds of futures and queue repeated
grid serialisations that would never contribute to the deterministic returned
subset.

The accepted implementation keeps at most one outstanding future per worker,
consumes them in the same branch order as before, and submits the next branch
only after the oldest outstanding result has been incorporated. Capped runs
still cancel the remaining window and use Python 3.14 worker termination.

Measurements used CPython 3.14.6 on GitHub's Ubuntu runner, two worker
processes, `PYTHONHASHSEED=0`, and identical returned-solution hashes. The
fan-out cases use a solved-in-one-assignment grid to isolate queue and payload
overhead; the blank 4x4 case exercises the real top-level Sudoku path.

| Case | Repeats | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: | ---: |
| 100 branches, `max_sols=1` | 5 | 10.917 ms | 9.663 ms | -11.48% |
| 1,000 branches, `max_sols=1` | 3 | 21.812 ms | 9.322 ms | -57.26% |
| Blank 4x4, `max_sols=1` | 2 | 4.104 s | 4.069 s | -0.85% |

Focused tests covered the bounded capped window, unlimited replenishment,
deterministic process-mode results, Python 3.14 start methods, and worker
statistics collection.
