from pathlib import Path
from textwrap import dedent, indent


def block(source: str, spaces: int = 0) -> str:
    return indent(dedent(source).strip("\n") + "\n", " " * spaces)


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "gridsolver/abstract_grids/grid.py",
    block(
        '''
        def __deepcopy__(self, memo: MutableMapping[int, Any] | None = None) -> "Grid":
            return self.deepcopy()
        ''',
        4,
    ),
    block(
        '''
        def _copy_extra_state_to(self, result: "Grid") -> None:
            """Copy subclass-owned instance state into ``result``.

            The base implementation owns all state required by the built-in
            grid classes. Extension classes that add mutable instance fields
            should override this hook and detach those fields explicitly.
            Solver caches and trail journals must never be copied here.
            """

        def __deepcopy__(self, memo: MutableMapping[int, Any] | None = None) -> "Grid":
            return self.deepcopy()
        ''',
        4,
    ),
)
replace_once(
    "gridsolver/abstract_grids/grid.py",
    block(
        '''
        result._struct_cache = {}
        result._guarantee_cache = {}
        return result
        ''',
        8,
    ),
    block(
        '''
        result._struct_cache = {}
        result._guarantee_cache = {}
        self._copy_extra_state_to(result)
        return result
        ''',
        8,
    ),
)
replace_once(
    "gridsolver/abstract_grids/grid.py",
    "        return result\n\n\n\n    def trail_mark(self) -> int:\n",
    "        return result\n\n    def trail_mark(self) -> int:\n",
)

replace_once(
    "gridsolver/solver/solver.py",
    "    return max_sols, processes, depth_gate\ndef solve(\n",
    "    return max_sols, processes, depth_gate\n\n\ndef solve(\n",
)
replace_once(
    "gridsolver/solver/solver.py",
    block(
        '''
        _lg.logs(0, f"Parallel: {len(branches)} top-level branches on {processes} processes")
        return solve_parallel_trials(
            grid,
            branches,
            max_sols,
            processes,
            depth_gate,
        )
        ''',
        4,
    ),
    block(
        '''
        _lg.logs(0, f"Parallel: {len(branches)} top-level branches on {processes} processes")
        # Root propagation may populate large structural and fish caches. They
        # are cheap to rebuild independently and expensive to pickle once per
        # submitted branch, so workers receive one cache-free state clone.
        worker_seed = grid.deepcopy()
        return solve_parallel_trials(
            worker_seed,
            branches,
            max_sols,
            processes,
            depth_gate,
        )
        ''',
        4,
    ),
)

Path("tests/test_solver_api.py").write_text(
    dedent(
        '''
        from gridsolver.abstract_grids.grid import Grid, SolveStatus
        from gridsolver.solver import solve_parallel as parallel_module
        from gridsolver.solver import solver


        class _StatefulGrid(Grid):
            def __init__(self):
                super().__init__(2)
                self.metadata = {"labels": ["original"]}

            def _copy_extra_state_to(self, result):
                result.metadata = {
                    "labels": list(self.metadata["labels"]),
                }


        def test_solve_does_not_mark_or_mutate_the_caller_grid():
            grid = Grid(1)
            original_candidates = tuple(possible.copy() for possible in grid._candidates)

            solutions = solver.solve(grid, log_level=0)

            assert len(solutions) == 1
            assert not grid.has_been_filled
            assert grid.known == (0,)
            assert grid._candidates == original_candidates

            grid.load("1")
            assert grid.known == (1,)


        def test_deepcopy_hook_detaches_subclass_owned_state():
            grid = _StatefulGrid()
            clone = grid.deepcopy()

            assert type(clone) is _StatefulGrid
            assert clone.metadata == grid.metadata
            assert clone.metadata is not grid.metadata
            assert clone.metadata["labels"] is not grid.metadata["labels"]

            clone.metadata["labels"].append("clone")
            assert grid.metadata == {"labels": ["original"]}


        def test_parallel_workers_receive_a_cache_free_root_seed(monkeypatch):
            grid = Grid(1, 1, max_elem=2)
            captured = {}

            def fake_atomic(self):
                self.grid._struct_cache["large"] = object()
                self.grid._guarantee_cache["large"] = object()
                self.grid._fish_value_memo = {"large": object()}
                return SolveStatus.NONE

            def fake_parallel(seed, branches, max_sols, processes, depth_gate=None):
                captured.update(
                    seed=seed,
                    branches=branches,
                    max_sols=max_sols,
                    processes=processes,
                    depth_gate=depth_gate,
                )
                return set()

            monkeypatch.setattr(solver.AtomicSolver, "solve_atomic", fake_atomic)
            monkeypatch.setattr(
                parallel_module,
                "solve_parallel_trials",
                fake_parallel,
            )

            assert solver._solve_top_parallel(grid, 3, 2, 1) == set()

            seed = captured["seed"]
            assert seed is not grid
            assert seed.known == grid.known
            assert tuple(map(set, seed._candidates)) == tuple(map(set, grid._candidates))
            assert seed.rules == grid.rules
            assert seed.guarantees == grid.guarantees
            assert seed._struct_cache == {}
            assert seed._guarantee_cache == {}
            assert not hasattr(seed, "_fish_value_memo")
            assert captured["branches"] == [(0, 1), (0, 2)]
            assert captured["max_sols"] == 3
            assert captured["processes"] == 2
            assert captured["depth_gate"] == 1
            assert grid._struct_cache
            assert grid._guarantee_cache
            assert hasattr(grid, "_fish_value_memo")
        '''
    ).lstrip(),
    encoding="utf-8",
)

replace_once(
    "DEVELOPMENT.md",
    "Candidate sets and trail state are\nnew per clone, and structural caches deliberately start empty.\n",
    "Candidate sets and trail state are\nnew per clone, and structural caches deliberately start empty. Subclasses that\nadd instance state must override `Grid._copy_extra_state_to()` and detach that\nstate explicitly.\n",
)
replace_once(
    "DEVELOPMENT.md",
    "- **Manual `Grid.deepcopy()`** replaces `copy.deepcopy`; it remains relevant\n  for API isolation and process-pool payloads even though per-node search no\n  longer clones.\n",
    "- **Manual `Grid.deepcopy()`** replaces `copy.deepcopy`; it remains relevant\n  for API isolation and process-pool payloads even though per-node search no\n  longer clones. After root propagation, process workers receive a fresh\n  cache-free clone so large structural and fish memo state is not serialized\n  once per submitted branch.\n",
)
