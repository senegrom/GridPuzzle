# Opt-in free-threaded search

GridPuzzle keeps process-based top-level parallelism as the default. A thread executor is available only when explicitly requested on a free-threaded CPython runtime with the GIL disabled.

## Command line

```bash
gridpuzzle \
  --file puzzle.pzl \
  --processes 4 \
  --parallel-backend thread
```

`--parallel-backend thread` requires `--processes` greater than 1. On a conventional GIL-enabled interpreter, GridPuzzle rejects the request rather than silently running serialized threads.

## Library API

```python
from gridsolver.solver import solver

solutions = solver.solve(
    grid,
    processes=4,
    parallel_backend="thread",
    max_sols=-1,
)
```

The default remains equivalent to `parallel_backend="process"`.

## Object and extension contract

Each executor thread receives a private root object graph through pickle and creates a fresh detached task grid for each submitted branch. Custom grid classes, rules, guarantees, and their referenced state must therefore be picklable when thread mode is selected.

Registered rule semantics remain immutable as documented in `DEVELOPMENT.md`. Per-thread roots avoid sharing rule and guarantee graphs across concurrently executing workers, and each task starts from a fresh context and runs inside the same source-protection and sandbox scopes as a process worker, so a free-threaded build's inherited thread contexts cannot carry the caller's scopes into the pool, and an extension's hooks are rolled back before the next task on that thread.

Pickling isolates each worker's instance graph and nothing else. Module globals, class-level mutable state, external resources, callbacks and C-extension state are shared by every thread, so a custom rule or grid used in thread mode must be free of side effects at that level, or explicitly thread-safe: being picklable is necessary, not sufficient. The process backend has no such constraint, which is one reason it remains the default.

## Search behaviour

- Top-level branches are submitted and consumed in deterministic order.
- Submission is bounded to one outstanding branch per worker.
- A positive `max_sols` cap cancels queued work and signals running siblings between search frames, in the thread-only driver.
- Branch logging is context-local, and technique statistics are merged in the parent thread.
- The caller's grid is never mutated.

The thread-only driver runs the same suspended branch frames as the default driver, so it is as stack-safe as the sequential search; it differs only in checking the cancellation event once per frame push or pop. The ordinary sequential and process driver contains no cancellation polling at all, which keeps the default hot path unchanged when the feature is not selected.

## Validation evidence

The current measurement is `benchmarks/thread_executor_314t_2026-09-24.md`, taken with `scripts/benchmark_thread_executor.py` through the manual "Thread executor benchmark" workflow on free-threaded CPython 3.14.7 with two workers. On the same runner in the same window, the thread/process geometric mean was `0.967x` for current master and `0.966x` for the tree before the explicit-stack rewrite, so the rewrite cost nothing. The thread executor takes 16% less time on the short loaded 4x4 case and 0 to 2% more on the three long ones; single runs on shared runners drift by about three points.

The executor was accepted on 2026-08-12 at a `0.823x` geometric mean (`benchmarks/free_threaded_executor_2026-08-12.md`). That lead is gone, and the same-window comparison shows it went before the rewrite; the August record does not name its machine, so solver changes since then and a different runner are both possible causes. The executor remains opt-in, at rough parity with the process pool, and the process pool remains the default.

The default path is unaffected when the thread backend is not selected: the rewrite left `_solve_full` and `_solve_branch` byte-identical (`benchmarks/thread_driver_default_path_2026-09-21.md`), and the original default-path overhead check is `benchmarks/default_executor_overhead_2026-08-12.md`.
