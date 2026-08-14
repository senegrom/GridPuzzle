# Rejected: worker-root trail reuse — 2026-08-09

The accepted parallel implementation installs one immutable-by-convention root
`Grid` in each process and creates every task with the purpose-built
`Grid.deepcopy()` method. This experiment attempted to remove that remaining
per-task copy by solving directly on the worker root inside an outer
`trail_mark()` / `trail_undo()` scope.

The candidate was deliberately guarded. It used trail reuse only when the grid
class retained the base implementations of known assignment, trail handling,
rule and guarantee mutation, and the subclass-state copy hook. Extension
classes fell back to clone-per-task isolation. Branch-created optional memo
attributes were removed after rollback.

Correctness passed on Ubuntu and Windows. Tests covered successful branches,
contradictions, deliberate exceptions after candidate/rule/guarantee/fish-memo
mutations, lazy attribute cleanup, extension-class fallback, independent
4x4 differential validation, Python 3.14 process start methods, deterministic
capped results, and worker statistics.

Measurements used CPython 3.14.6 on GitHub's Ubuntu runner, two worker
processes, `PYTHONHASHSEED=0`, and identical solution hashes/cardinalities.
The baseline was the accepted worker-root clone implementation.

| Case | Repeats | Clone baseline | Trail reuse | Change |
| --- | ---: | ---: | ---: | ---: |
| 1,000 one-cell branches | 5 | 315.996 ms | 325.829 ms | +3.11% |
| Blank 4x4, `max_sols=1` | 5 | 6.828 s | 6.780 s | -0.72% |
| Blank 4x4, all 288 solutions | 3 | 27.752 s | 28.302 s | +1.98% |
| Non-square 6x6, `max_sols=20` | 2 | 24.675 s | 24.862 s | +0.76% |

The small capped-case gain did not justify regressions on high fan-out, full
enumeration, and the non-square case. The clone-per-task worker design remains
selected. Do not retry direct worker-root mutation without a materially cheaper
rollback mechanism or a workload-specific opt-in backed by broader corpus
measurements.
