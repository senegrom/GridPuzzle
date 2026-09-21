# Extension worker and metadata fixes — 2026-09-11

Baseline: `90985e0fa88ba8d994df6e886bdcb21189b3da66`.
Seven of the nine original regression specifications fail on the baseline and pass after the fixes.

## Supported-runtime verification

Runtime: 3.14.7.

- baseline: {'tests': 9, 'failures': 7, 'errors': 0, 'skipped': 0}
- focused: {'tests': 128, 'failures': 0, 'errors': 0, 'skipped': 0}
- bounded: {'tests': 806, 'failures': 0, 'errors': 0, 'skipped': 0}

The focused tests include real spawn/forkserver workers, repeated tasks, unlimited and capped solution sets, cyclic source-owner serialization, and exception/interruption rollback.
Cleanup is checked within a five-second deadline because CPython terminate_workers() signals workers after shutdown(wait=False); the probe does not kill or join processes on behalf of the solver.

Actions run: https://github.com/senegrom/GridPuzzle/actions/runs/34544302130

No wall-clock speedup claim is made. The temporary validation workflow and patch transport files are not included in master.
Normal Linux/Windows CI and extended corpus CI run again on the published master commit.
