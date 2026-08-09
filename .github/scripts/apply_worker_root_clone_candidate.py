"""Apply the temporary worker-local root plus Grid.deepcopy experiment."""

from pathlib import Path
from textwrap import dedent


def lines(*parts: str) -> str:
    return "".join(part + "\n" for part in parts)


path = Path("gridsolver/solver/solve_parallel.py")
text = path.read_text(encoding="utf-8")

if "import pickle\n" in text:
    raise SystemExit("worker-root clone candidate is already applied")
text = text.replace(
    "import concurrent.futures\n",
    "import concurrent.futures\nimport pickle\n",
    1,
)

start = text.index("def _solve_branch(\n")
end = text.index("def solve_parallel_trials(\n", start)
replacement = dedent('''
    _WORKER_ROOT_GRID: Grid | None = None


    def _init_worker(grid_payload: bytes) -> None:
        """Unpickle one immutable-by-convention root grid per worker."""
        global _WORKER_ROOT_GRID
        root = pickle.loads(grid_payload)
        if not isinstance(root, Grid):
            raise TypeError("Parallel worker root payload did not contain a Grid")
        _WORKER_ROOT_GRID = root


    def _fresh_worker_grid() -> Grid:
        root = _WORKER_ROOT_GRID
        if root is None:
            raise RuntimeError("Parallel worker root grid was not initialised")
        return root.deepcopy()


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

pool_marker = lines(
    "    with concurrent.futures.ProcessPoolExecutor(max_workers=processes) as pool:"
)
if text.count(pool_marker) != 1:
    raise SystemExit(f"process-pool marker count: {text.count(pool_marker)}")
text = text.replace(
    pool_marker,
    lines(
        "    grid_payload = pickle.dumps(",
        "        grid,",
        "        protocol=pickle.HIGHEST_PROTOCOL,",
        "    )",
        "    with concurrent.futures.ProcessPoolExecutor(",
        "        max_workers=processes,",
        "        initializer=_init_worker,",
        "        initargs=(grid_payload,),",
        "    ) as pool:",
    ),
    1,
)

old_payload = "(grid, cell, value, max_sols, depth_gate)"
if text.count(old_payload) != 2:
    raise SystemExit(f"branch payload marker count: {text.count(old_payload)}")
text = text.replace(old_payload, "(cell, value, max_sols, depth_gate)")
path.write_text(text, encoding="utf-8")

# Adapt the pre-initializer fake executors inside this temporary candidate.
test_path = Path("tests/test_solver_api.py")
test_text = test_path.read_text(encoding="utf-8")
old_factory = "lambda max_workers: pool,"
if test_text.count(old_factory) != 2:
    raise SystemExit(
        f"fake ProcessPoolExecutor marker count: {test_text.count(old_factory)}"
    )
test_path.write_text(
    test_text.replace(old_factory, "lambda max_workers, **kwargs: pool,"),
    encoding="utf-8",
)
