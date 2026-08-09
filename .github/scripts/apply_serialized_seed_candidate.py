"""Apply the temporary process-initializer seed experiment."""

from pathlib import Path
from textwrap import dedent


path = Path("gridsolver/solver/solve_parallel.py")
text = path.read_text(encoding="utf-8")

if "import pickle\n" in text:
    raise SystemExit("serialized worker seed candidate is already applied")
text = text.replace(
    "import concurrent.futures\n",
    "import concurrent.futures\nimport pickle\n",
    1,
)

start = text.index("def _solve_branch(\n")
end = text.index("def solve_parallel_trials(\n", start)
replacement = dedent('''
    _WORKER_GRID_PAYLOAD: bytes | None = None


    def _init_worker(grid_payload: bytes) -> None:
        """Install one immutable serialized root payload in each worker."""
        global _WORKER_GRID_PAYLOAD
        _WORKER_GRID_PAYLOAD = grid_payload


    def _fresh_worker_grid() -> Grid:
        payload = _WORKER_GRID_PAYLOAD
        if payload is None:
            raise RuntimeError("Parallel worker grid payload was not initialised")
        return pickle.loads(payload)


    def _solve_branch(
        payload: tuple[int, int, int, int | None],
    ) -> set[ImmutableGrid]:
        cell, value, max_sols, depth_gate = payload
        grid = _fresh_worker_grid()
        from gridsolver.solver import solver as _solver
        from gridsolver.solver.solver_log import lg as _lg

        _lg.set_lvl(0)
        grid[cell] = value
        return _solver._solve_full(grid, [0], max_sols, set(), depth_gate)


    def _solve_branch_with_stats(
        payload: tuple[int, int, int, int | None],
    ) -> tuple[set[ImmutableGrid], PowerStats]:
        with collect_power_stats() as stats:
            solutions = _solve_branch(payload)
        return solutions, stats


''').lstrip()
text = text[:start] + replacement + text[end:]

pool_marker = (
    "    with concurrent.futures.ProcessPoolExecutor(max_workers=processes) as pool:\n"
)
if text.count(pool_marker) != 1:
    raise SystemExit(f"process-pool marker count: {text.count(pool_marker)}")
text = text.replace(
    pool_marker,
    dedent('''
        grid_payload = pickle.dumps(grid, protocol=pickle.HIGHEST_PROTOCOL)
        with concurrent.futures.ProcessPoolExecutor(
            max_workers=processes,
            initializer=_init_worker,
            initargs=(grid_payload,),
        ) as pool:
    ''').lstrip(),
    1,
)

old_payload = "(grid, cell, value, max_sols, depth_gate)"
if text.count(old_payload) != 2:
    raise SystemExit(f"branch payload marker count: {text.count(old_payload)}")
text = text.replace(old_payload, "(cell, value, max_sols, depth_gate)")

path.write_text(text, encoding="utf-8")
