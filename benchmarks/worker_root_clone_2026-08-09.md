# Worker-local root grid cloning — 2026-08-09

Top-level parallel branches previously transmitted the complete root `Grid` in
every executor task. The accepted implementation serializes that cache-free
root once in the parent, installs one immutable-by-convention root in each
worker through `ProcessPoolExecutor.initializer`, and creates each branch with
the project's purpose-built `Grid.deepcopy()` method. Task payloads now contain
only the cell, value, solution cap, and depth gate.

This keeps exact per-task isolation: known values, candidates, rules,
guarantees, caches, trails, and subclass-owned state are detached before the
branch runs. The worker root is never solved in place.

Measurements used CPython 3.14.6 on GitHub's Ubuntu runner, two worker
processes, `PYTHONHASHSEED=0`, and identical solution hashes/cardinalities.
Correctness tests passed on both Ubuntu and Windows, including repeated branch
isolation, trail rollback, Python 3.14 start methods, deterministic capped
results, and worker statistics.

| Case | Repeats | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: | ---: |
| 1,000 one-cell branches | 3 | 303.936 ms | 242.971 ms | -20.06% |
| Blank 4x4, `max_sols=1` | 3 | 6.138 s | 6.042 s | -1.55% |
| Blank 4x4, all 288 solutions | 2 | 24.441 s | 24.188 s | -1.04% |
| Non-square 6x6, `max_sols=20` | 1 | 23.168 s | 22.519 s | -2.80% |

## Rejected intermediate: unpickle on every task

An earlier variant also sent the serialized root only once, but each task ran
`pickle.loads()` to obtain its branch. It helped high-fanout or very large
payload cases (5.81% at 1,000 branches and 44.95% with a synthetic 1 MB root),
but regressed complete blank-4x4 enumeration by 1.58%. Keeping one worker root
and using `Grid.deepcopy()` removed that regression and was faster on every
measured real case.
