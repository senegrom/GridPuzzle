# Capped parallel early termination — 2026-08-09

Python 3.14 added `ProcessPoolExecutor.terminate_workers()`. GridPuzzle now uses
it only after a positive `max_sols` cap has been reached in deterministic branch
order. Pending futures are cancelled first; workers already running are then
terminated so leaving the executor context does not wait for branches whose
results cannot affect the requested capped subset.

Measurements used CPython 3.14.6 on GitHub's Ubuntu runner, four worker
processes, `PYTHONHASHSEED=0`, `depth_gate=None`, and two timed repetitions per
case. The returned solution was hashed in both implementations.

| Case | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Blank 4x4, `max_sols=1` | 6.771 s | 6.650 s | -1.80% |
| Non-square 6x6, `max_sols=1` | 20.479 s | 20.315 s | -0.80% |

Solution hashes were identical. Focused tests also covered deterministic capped
results across process modes, Python 3.14 start methods, worker statistics, the
termination path, and the unlimited path that must leave workers untouched.
