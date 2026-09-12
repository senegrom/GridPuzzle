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

Registered rule semantics remain immutable as documented in `DEVELOPMENT.md`. Per-thread roots avoid sharing rule and guarantee graphs across concurrently executing workers.

## Search behaviour

- Top-level branches are submitted and consumed in deterministic order.
- Submission is bounded to one outstanding branch per worker.
- A positive `max_sols` cap cancels queued work and signals running siblings at thread-only recursive search boundaries.
- Branch logging is context-local, and technique statistics are merged in the parent thread.
- The caller's grid is never mutated.

The ordinary sequential and process search recursion does not contain thread-cancellation polling. This keeps the default hot path unchanged when the opt-in backend is unused.

## Validation evidence

The committed benchmark records are:

- `benchmarks/default_executor_overhead_2026-08-12.md`
- `benchmarks/free_threaded_executor_2026-08-12.md`

The accepted Python 3.14 validation measured a default-path geometric-mean ratio of `0.999608x` with a worst ratio of `1.026823x`. On free-threaded Python 3.14, the real-workload thread/process geometric mean was `0.823100x`, the worst real-workload ratio was `1.013592x`, and the positive-cap ratio was `0.970613x`.
