"""Restore the explicit, default-off depth gate with pinned semantics."""

from pathlib import Path
from textwrap import dedent


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(
            f"{path}: expected one marker, found {text.count(old)}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(
    path: Path,
    start_marker: str,
    end_marker: str,
    replacement: str,
) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


solver_path = Path("gridsolver/solver/solver.py")
replace_between(
    solver_path,
    "def _validate_solve_options(\n",
    "def solve(\n",
    dedent('''
        def _validate_solve_options(
            max_sols: int,
            processes: int,
            depth_gate: int | None,
        ) -> tuple[int, int, int | None]:
            for name, value in (("max_sols", max_sols), ("processes", processes)):
                if isinstance(value, bool) or not isinstance(value, Integral):
                    raise TypeError(f"{name} must be an integer")

            max_sols = int(max_sols)
            processes = int(processes)
            if max_sols < -1:
                raise ValueError("max_sols must be -1 (unlimited) or non-negative")
            if processes < 0:
                raise ValueError("processes must be non-negative")

            if depth_gate is not None:
                if isinstance(depth_gate, bool) or not isinstance(depth_gate, Integral):
                    raise TypeError(
                        "depth_gate must be None or a non-negative integer"
                    )
                depth_gate = int(depth_gate)
                if depth_gate < 0:
                    raise ValueError("depth_gate must be non-negative")

            return max_sols, processes, depth_gate


    ''').lstrip(),
)
replace_between(
    solver_path,
    "def solve(\n",
    "def _solve_validated(\n",
    dedent('''
        def solve(
            grid: Grid,
            log_level: int | None = None,
            max_sols: int = -1,
            processes: int = 0,
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
            """Solve a grid without mutating it.

            ``depth_gate`` is retained as an explicit experiment switch. Search
            depth starts at zero for the root: full techniques run through depth
            ``K`` and only the cheap tier runs below it. ``None`` (the default)
            runs the complete technique hierarchy at every search node.
            """
            if not isinstance(grid, Grid):
                raise TypeError("grid must be a Grid instance")
            max_sols, processes, depth_gate = _validate_solve_options(
                max_sols,
                processes,
                depth_gate,
            )
            with _lg.solve_context(log_level):
                return _solve_validated(
                    grid,
                    max_sols,
                    processes,
                    depth_gate,
                )


    ''').lstrip(),
)
replace_between(
    solver_path,
    "def _solve_validated(\n",
    "def _solve_top_parallel(\n",
    dedent('''
        def _solve_validated(
            grid: Grid,
            max_sols: int,
            processes: int,
            depth_gate: int | None,
        ) -> set[ImmutableGrid]:
            if max_sols == 0:
                return set()

            # Solving operates exclusively on clones. The caller may therefore reuse,
            # extend, or load the original grid after this function returns.
            if processes > 1:
                solutions = _solve_top_parallel(
                    grid.deepcopy(),
                    max_sols,
                    processes,
                    depth_gate,
                )
            else:
                solutions = _solve_full(
                    grid.deepcopy(),
                    [],
                    max_sols,
                    set(),
                    depth_gate,
                )

            # Check every generated solution before capping the returned subset. This
            # turns any future unsound deduction into an immediate, local failure rather
            # than allowing a plausible-looking invalid grid to escape the solver.
            validate_solutions(grid, solutions)
            solutions = _cap_solutions(solutions, max_sols)

            if _lg.is_enabled(0):
                for index, solution in enumerate(
                    sorted(solutions, key=_solution_key)
                ):
                    _lg.logs(0, f"Solution {index}", header=True)
                    _lg.logg(
                        0,
                        solution,
                        format_args=grid.format_args,
                        rules=grid.rules,
                    )

                if not solutions:
                    _lg.logs(0, "No solution found.", header=True)

            return solutions


    ''').lstrip(),
)
replace_once(
    solver_path,
    dedent('''
        def _solve_top_parallel(
            grid: Grid,
            max_sols: int,
            processes: int,
        ) -> set[ImmutableGrid]:
    ''').lstrip(),
    dedent('''
        def _solve_top_parallel(
            grid: Grid,
            max_sols: int,
            processes: int,
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
    ''').lstrip(),
)
replace_once(
    solver_path,
    "    status = AtomicSolver(grid, [0], set()).solve_atomic()\n",
    dedent('''
            status = AtomicSolver(
                grid,
                [0],
                set(),
                depth_gate=depth_gate,
            ).solve_atomic()
    ''').lstrip(),
)
replace_once(
    solver_path,
    dedent('''
            return solve_parallel_trials(
                worker_seed,
                branches,
                max_sols,
                processes,
            )
    ''').lstrip(),
    dedent('''
            return solve_parallel_trials(
                worker_seed,
                branches,
                max_sols,
                processes,
                depth_gate=depth_gate,
            )
    ''').lstrip(),
)
replace_once(
    solver_path,
    dedent('''
        def _solve_full(
            grid: Grid,
            steps: list[int],
            max_sols: int,
            hidden_pair_checked_gts: set[Guarantee],
        ) -> set[ImmutableGrid]:
    ''').lstrip(),
    dedent('''
        def _solve_full(
            grid: Grid,
            steps: list[int],
            max_sols: int,
            hidden_pair_checked_gts: set[Guarantee],
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
    ''').lstrip(),
)
replace_once(
    solver_path,
    "        status = AtomicSolver(grid, steps, hidden_pair_checked_gts).solve_atomic()\n",
    dedent('''
                status = AtomicSolver(
                    grid,
                    steps,
                    hidden_pair_checked_gts,
                    depth_gate=depth_gate,
                ).solve_atomic()
    ''').lstrip(),
)
replace_once(
    solver_path,
    dedent('''
                        branch_solutions = _solve_full(
                            grid,
                            steps,
                            remaining,
                            checked_guarantees,
                        )
    ''').lstrip(),
    dedent('''
                        branch_solutions = _solve_full(
                            grid,
                            steps,
                            remaining,
                            checked_guarantees,
                            depth_gate,
                        )
    ''').lstrip(),
)


atomic_path = Path("gridsolver/solver/atomic_solver.py")
replace_once(
    atomic_path,
    dedent('''
            hidden_pair_checked_gts: set[Guarantee],
        ) -> None:
            self.grid = grid
            self.upsteps = upsteps
            self.hidden_pair_checked_gts = hidden_pair_checked_gts
            self.stats = current_power_stats()
    ''').lstrip(),
    dedent('''
            hidden_pair_checked_gts: set[Guarantee],
            depth_gate: int | None = None,
        ) -> None:
            self.grid = grid
            self.upsteps = upsteps
            self.hidden_pair_checked_gts = hidden_pair_checked_gts
            self.depth_gate = depth_gate
            self.stats = current_power_stats()
    ''').lstrip(),
)
replace_once(
    atomic_path,
    '        yield self._act("naked_tuples5", lambda: remove_naked_tuples(grid, 5))\n\n        yield self._act("xy_wing", lambda: xy_wing(grid))\n',
    '        yield self._act("naked_tuples5", lambda: remove_naked_tuples(grid, 5))\n\n        search_depth = max(0, len(self.upsteps) - 1)\n        if (\n            self.depth_gate is not None\n            and not in_forcing_chain\n            and search_depth > self.depth_gate\n        ):\n            return\n\n        yield self._act("xy_wing", lambda: xy_wing(grid))\n',
)


parallel_path = Path("gridsolver/solver/solve_parallel.py")
replace_once(
    parallel_path,
    "_WORKER_ROOT_GRID: Grid | None = None\n",
    "_WORKER_ROOT_GRID: Grid | None = None\n_WORKER_DEPTH_GATE: int | None = None\n",
)
replace_between(
    parallel_path,
    "def _init_worker(\n",
    "def _fresh_worker_grid(\n",
    dedent('''
        def _init_worker(
            grid_payload: bytes,
            depth_gate: int | None = None,
        ) -> None:
            """Unpickle one immutable-by-convention root grid per worker."""
            global _WORKER_ROOT_GRID, _WORKER_DEPTH_GATE
            root = pickle.loads(grid_payload)
            if not isinstance(root, Grid):
                raise TypeError("Parallel worker root payload did not contain a Grid")
            _WORKER_ROOT_GRID = root
            _WORKER_DEPTH_GATE = depth_gate


    ''').lstrip(),
)
replace_once(
    parallel_path,
    "    return _solver._solve_full(grid, [0], max_sols, set())\n",
    "    return _solver._solve_full(\n        grid,\n        [0],\n        max_sols,\n        set(),\n        _WORKER_DEPTH_GATE,\n    )\n",
)
replace_once(
    parallel_path,
    dedent('''
        def solve_parallel_trials(
            grid: Grid,
            branches: list[tuple[int, int]],
            max_sols: int,
            processes: int,
        ) -> set[ImmutableGrid]:
    ''').lstrip(),
    dedent('''
        def solve_parallel_trials(
            grid: Grid,
            branches: list[tuple[int, int]],
            max_sols: int,
            processes: int,
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
    ''').lstrip(),
)
replace_once(
    parallel_path,
    "        initargs=(grid_payload,),\n",
    "        initargs=(grid_payload, depth_gate),\n",
)


run_path = Path("run.py")
replace_once(
    run_path,
    dedent('''
            parser.add_argument(
                "--max-solutions",
                type=_solution_limit,
                default=-1,
                help="Maximum returned solutions; -1 means unlimited",
            )
    ''').lstrip(),
    dedent('''
            parser.add_argument(
                "--max-solutions",
                type=_solution_limit,
                default=-1,
                help="Maximum returned solutions; -1 means unlimited",
            )
            parser.add_argument(
                "--depth-gate",
                type=_non_negative_int,
                default=None,
                help=(
                    "Run only cheap deductions below this backtracking depth; "
                    "disabled by default"
                ),
            )
    ''').lstrip(),
)
replace_once(
    run_path,
    "        processes=args.processes,\n",
    "        processes=args.processes,\n        depth_gate=args.depth_gate,\n",
)


test_solver_path = Path("tests/test_solver_api.py")
test_solver = test_solver_path.read_text(encoding="utf-8")
test_solver = test_solver.replace(
    "from gridsolver.solver import solve_parallel as parallel_module\n",
    "from gridsolver.solver import atomic_solver\nfrom gridsolver.solver import solve_parallel as parallel_module\n",
    1,
)
test_solver = test_solver.replace(
    "from gridsolver.solver import solver\n",
    "from gridsolver.solver import solver\nfrom gridsolver.solver.atomic_solver import AtomicSolver\n",
    1,
)
old_fake = dedent('''
        def fake_parallel(seed, branches, max_sols, processes):
            captured.update(
                seed=seed,
                branches=branches,
                max_sols=max_sols,
                processes=processes,
            )
            return set()
''').lstrip()
new_fake = dedent('''
        def fake_parallel(
            seed,
            branches,
            max_sols,
            processes,
            depth_gate=None,
        ):
            captured.update(
                seed=seed,
                branches=branches,
                max_sols=max_sols,
                processes=processes,
                depth_gate=depth_gate,
            )
            return set()
''').lstrip()
if test_solver.count(old_fake) != 1:
    raise SystemExit("parallel fake marker changed")
test_solver = test_solver.replace(old_fake, new_fake, 1)
test_solver = test_solver.replace(
    "    assert solver._solve_top_parallel(grid, 3, 2) == set()\n",
    "    assert solver._solve_top_parallel(grid, 3, 2, depth_gate=2) == set()\n",
    1,
)
test_solver = test_solver.replace(
    '    assert captured["processes"] == 2\n',
    '    assert captured["processes"] == 2\n    assert captured["depth_gate"] == 2\n',
    1,
)
test_solver = test_solver.replace(
    dedent('''
        def _assert_compact_worker_payloads(pool):
            assert pool.max_workers == 2
            assert pool.initializer is parallel_module._init_worker
            assert len(pool.initargs) == 1
            assert isinstance(pool.initargs[0], bytes)
            assert all(len(payload) == 3 for payload in pool.payloads)
''').lstrip(),
    dedent('''
        def _assert_compact_worker_payloads(pool, depth_gate=None):
            assert pool.max_workers == 2
            assert pool.initializer is parallel_module._init_worker
            assert len(pool.initargs) == 2
            assert isinstance(pool.initargs[0], bytes)
            assert pool.initargs[1] == depth_gate
            assert all(len(payload) == 3 for payload in pool.payloads)
''').lstrip(),
    1,
)
test_solver = test_solver.replace(
    dedent('''
            result = parallel_module.solve_parallel_trials(
                Grid(1, 1, max_elem=5),
                [(0, value) for value in range(1, 6)],
                max_sols=-1,
                processes=2,
            )
''').lstrip(),
    dedent('''
            result = parallel_module.solve_parallel_trials(
                Grid(1, 1, max_elem=5),
                [(0, value) for value in range(1, 6)],
                max_sols=-1,
                processes=2,
                depth_gate=2,
            )
''').lstrip(),
    1,
)
# The second helper assertion belongs to the unlimited case just changed.
old_tail = dedent('''
        assert not any(future.cancelled for future in pool.futures)
        _assert_compact_worker_payloads(pool)


        @pytest.mark.parametrize("max_sols", (-1, 0))
''').lstrip()
new_tail = dedent('''
        assert not any(future.cancelled for future in pool.futures)
        _assert_compact_worker_payloads(pool, depth_gate=2)


        @pytest.mark.parametrize("max_sols", (-1, 0))
''').lstrip()
if test_solver.count(old_tail) != 1:
    raise SystemExit("unlimited helper assertion marker changed")
test_solver = test_solver.replace(old_tail, new_tail, 1)
appendix = '''


@pytest.mark.parametrize(
    ("depth_gate", "error"),
    (
        (True, TypeError),
        (1.5, TypeError),
        ("1", TypeError),
        (-1, ValueError),
    ),
)
def test_depth_gate_rejects_coercive_or_negative_values(depth_gate, error):
    with pytest.raises(error, match="depth_gate"):
        solver.solve(Grid(1), depth_gate=depth_gate)


def test_depth_gate_is_default_off_and_none_is_equivalent():
    assert solver.solve(Grid(1)) == solver.solve(Grid(1), depth_gate=None)


def test_depth_gate_zero_keeps_full_root_and_gates_only_children(monkeypatch):
    monkeypatch.setattr(
        AtomicSolver,
        "_act",
        lambda self, label, action, *args: label,
    )

    class _Topology:
        @staticmethod
        def build(grid):
            return object()

    class _Analysis:
        @staticmethod
        def build(grid, topology):
            return object()

    monkeypatch.setattr(atomic_solver, "CandidateTopology", _Topology)
    monkeypatch.setattr(atomic_solver, "ALSAnalysis", _Analysis)

    root = AtomicSolver(Grid(1), [0], set(), depth_gate=0)
    child = AtomicSolver(Grid(1), [0, 0], set(), depth_gate=0)
    root_labels = list(root._solve_power_actions())
    child_labels = list(child._solve_power_actions())

    cheap = [
        "locked_candidate",
        "skyscraper",
        "empty_rectangle",
        "ineq_bounds",
        "rulehelper_atmostonce",
        "rulehelper_sum_atmostonce",
        "rulehelper_house_sums",
        "naked_tuples5",
    ]
    assert root_labels[: len(cheap)] == cheap
    assert "xy_wing" in root_labels
    assert root_labels[-1] == "forcing_net"
    assert child_labels == cheap
'''
if "test_depth_gate_zero_keeps_full_root" in test_solver:
    raise SystemExit("depth gate tests already exist")
test_solver_path.write_text(test_solver.rstrip() + appendix, encoding="utf-8")


test_cli_path = Path("tests/test_cli_and_loading.py")
test_cli = test_cli_path.read_text(encoding="utf-8")
test_cli = test_cli.replace(
    '            "--max-solutions",\n            "2",\n            "--colour",\n',
    '            "--max-solutions",\n            "2",\n            "--depth-gate",\n            "1",\n            "--colour",\n',
    1,
)
test_cli = test_cli.replace(
    "    assert args.max_solutions == 2\n",
    "    assert args.max_solutions == 2\n    assert args.depth_gate == 1\n",
    1,
)
test_cli = test_cli.replace(
    '    with pytest.raises(SystemExit):\n        parser.parse_args([*common, "--processes", "not-an-int"])\n',
    '    with pytest.raises(SystemExit):\n        parser.parse_args([*common, "--processes", "not-an-int"])\n    with pytest.raises(SystemExit):\n        parser.parse_args([*common, "--depth-gate", "-1"])\n    with pytest.raises(SystemExit):\n        parser.parse_args([*common, "--depth-gate", "not-an-int"])\n',
    1,
)
test_cli_path.write_text(test_cli, encoding="utf-8")


dev_path = Path("DEVELOPMENT.md")
dev = dev_path.read_text(encoding="utf-8")
marker = "**Forcing chain uses the full AtomicSolver for trial branches.**\n"
addition = '''**Depth gating is explicit, parked, and disabled by default.**
`solve(..., depth_gate=K)` retains the experimental cheap-tier cutoff without
changing ordinary solves. The root has search depth zero: full techniques run
through depth `K`, and deeper backtracking nodes stop after the cheap tier.
`None` runs the complete hierarchy everywhere. Do not enable a gate in normal
call sites or CI examples; it remains available only for explicit experiments.

'''
if dev.count(marker) != 1:
    raise SystemExit("DEVELOPMENT forcing-chain marker changed")
dev_path.write_text(dev.replace(marker, addition + marker, 1), encoding="utf-8")


todo_path = Path("TODO.md")
todo = todo_path.read_text(encoding="utf-8")
marker = "## Trail-based propagation instead of deepcopy-per-trial — DONE August 2026\n"
addition = '''## Depth-gated technique tiers — retained, parked, default off

`solve(..., depth_gate=K)` remains available as an explicit experiment switch.
Search depth is zero-based: `K=0` runs the full hierarchy at the root and only
the cheap tier in descendants. `None` is the default and preserves the complete
technique hierarchy everywhere. No default adoption or routine CI use is
planned; revisit only with broad corpus evidence and an explicit policy change.

'''
if todo.count(marker) != 1:
    raise SystemExit("TODO trail marker changed")
todo_path.write_text(todo.replace(marker, addition + marker, 1), encoding="utf-8")
