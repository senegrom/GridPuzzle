"""Restore the explicit, default-off depth gate with pinned semantics."""

from pathlib import Path
from textwrap import dedent, indent


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


def replace_to_end(path: Path, start_marker: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.index(start_marker)
    path.write_text(text[:start] + replacement, encoding="utf-8")


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
replace_between(
    solver_path,
    "def _solve_top_parallel(\n",
    "def _solve_full(\n",
    dedent('''
        def _solve_top_parallel(
            grid: Grid,
            max_sols: int,
            processes: int,
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
            """Run one atomic pass, then distribute deterministic first-level branches."""
            from gridsolver.solver.solve_parallel import solve_parallel_trials

            status = AtomicSolver(
                grid,
                [0],
                set(),
                depth_gate=depth_gate,
            ).solve_atomic()
            if status is SolveStatus.SOLVED:
                return {
                    ImmutableGrid(
                        grid.known,
                        grid.rows,
                        grid.cols,
                        grid.max_elem,
                        type(grid).__name__,
                    )
                }
            if status is SolveStatus.INVALID:
                return set()

            test_cell, possible = grid.get_smallest_candidate_set_gt1()
            guarantee = grid.get_smallest_guarantee()
            values = sorted(possible)

            if guarantee is not None and len(guarantee.cells) < len(values):
                branches = [(cell, guarantee.val) for cell in sorted(guarantee.cells)]
            else:
                branches = [(test_cell, value) for value in values]

            _lg.logs(
                0,
                f"Parallel: {len(branches)} top-level branches on {processes} processes",
            )
            # Root propagation may populate large structural and fish caches. They
            # are cheap to rebuild independently and expensive to pickle once per
            # submitted branch, so workers receive one cache-free state clone.
            worker_seed = grid.deepcopy()
            return solve_parallel_trials(
                worker_seed,
                branches,
                max_sols,
                processes,
                depth_gate=depth_gate,
            )


    ''').lstrip(),
)
replace_to_end(
    solver_path,
    "def _solve_full(\n",
    dedent('''
        def _solve_full(
            grid: Grid,
            steps: list[int],
            max_sols: int,
            hidden_pair_checked_gts: set[Guarantee],
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
            steps.append(0)
            try:
                status = AtomicSolver(
                    grid,
                    steps,
                    hidden_pair_checked_gts,
                    depth_gate=depth_gate,
                ).solve_atomic()
                if status is SolveStatus.SOLVED:
                    return {
                        ImmutableGrid(
                            grid.known,
                            grid.rows,
                            grid.cols,
                            grid.max_elem,
                            type(grid).__name__,
                        )
                    }
                if status is SolveStatus.INVALID:
                    return set()

                test_cell, possible = grid.get_smallest_candidate_set_gt1()
                guarantee = grid.get_smallest_guarantee()
                values = sorted(possible)
                use_guarantee = (
                    guarantee is not None
                    and len(guarantee.cells) < len(values)
                )
                trials = sorted(guarantee.cells) if use_guarantee else values
                solutions: set[ImmutableGrid] = set()
                # AtomicSolver only reads the incoming snapshot and replaces its
                # own reference after a full hidden-tuple pass. All sibling branches
                # therefore share this one immutable-by-convention parent snapshot.
                checked_guarantees = set(grid.guarantees)

                for trial in trials:
                    depth = len(steps)
                    if _lg.is_enabled(depth):
                        if use_guarantee:
                            _lg.logstep(
                                depth,
                                steps,
                                f"Trial (guarantee) "
                                f"[{trial % grid.rows},{trial // grid.rows}] "
                                f"== {guarantee.val} with "
                                f"{len(solutions)} previous solutions",
                            )
                        else:
                            _lg.logstep(
                                depth,
                                steps,
                                f"Trial "
                                f"[{test_cell % grid.rows},"
                                f"{test_cell // grid.rows}] "
                                f"== {trial} with "
                                f"{len(solutions)} previous solutions",
                            )

                    # Reuse the current grid for every branch. The journal restores
                    # candidates, known values, rules, guarantees and branch-local memos.
                    mark = grid.trail_mark()
                    try:
                        if use_guarantee:
                            grid[trial] = guarantee.val
                        else:
                            grid[test_cell] = trial

                        remaining = (
                            -1
                            if max_sols == -1
                            else max_sols - len(solutions)
                        )
                        branch_solutions = _solve_full(
                            grid,
                            steps,
                            remaining,
                            checked_guarantees,
                            depth_gate,
                        )
                    finally:
                        grid.trail_undo(mark)

                    steps[depth - 1] += 1
                    solutions.update(branch_solutions)

                    if 0 < max_sols <= len(solutions):
                        _lg.logs(
                            0,
                            f"Step {steps} - Reached max_sols == {max_sols}",
                        )
                        return _cap_solutions(solutions, max_sols)

                return solutions
            finally:
                steps.pop()
    ''').lstrip(),
)


atomic_path = Path("gridsolver/solver/atomic_solver.py")
replace_between(
    atomic_path,
    "    def __init__(\n",
    "    def solve_atomic(\n",
    indent(
        dedent('''
            def __init__(
                self,
                grid: Grid,
                upsteps: list[int],
                hidden_pair_checked_gts: set[Guarantee],
                depth_gate: int | None = None,
            ) -> None:
                self.grid = grid
                self.upsteps = upsteps
                self.hidden_pair_checked_gts = hidden_pair_checked_gts
                self.depth_gate = depth_gate
                self.stats = current_power_stats()
                self.collect_timing = self.stats is not None or _lg.on
                self.verbose_logging = _lg.is_enabled(_MAX_LVL)

        ''').lstrip(),
        "    ",
    ),
)
replace_between(
    atomic_path,
    "    def _solve_power_actions(\n",
    "\n\n_MAX_HIDDEN_TUPLE = 7\n",
    indent(
        dedent('''
            def _solve_power_actions(self) -> Iterator[str]:
                grid = self.grid
                # Expensive zero-hit tiers are skipped inside forcing-chain branches but
                # retained at the outer level for full deductive power.
                in_forcing_chain = bool(_solve_fc._in_forcing_chain)

                yield self._act("locked_candidate", lambda: locked_candidate(grid))
                yield self._act("skyscraper", lambda: skyscraper(grid))
                yield self._act("empty_rectangle", lambda: empty_rectangle(grid))
                yield self._act("ineq_bounds", lambda: ineq_bounds(grid))
                yield self._act(
                    "rulehelper_atmostonce",
                    lambda: rulehelper_atmostonce(grid),
                )
                yield self._act(
                    "rulehelper_sum_atmostonce",
                    lambda: rulehelper_sum_atmostonce(grid),
                )
                yield self._act(
                    "rulehelper_house_sums",
                    lambda: rulehelper_house_sums(grid),
                )
                yield self._act(
                    "naked_tuples5",
                    lambda: remove_naked_tuples(grid, 5),
                )

                # Search depth is zero-based although the recursion bookkeeping list
                # contains one root entry. The gate never changes forcing-chain inner
                # propagation, which continues to use the full non-recursive hierarchy.
                search_depth = max(0, len(self.upsteps) - 1)
                if (
                    self.depth_gate is not None
                    and not in_forcing_chain
                    and search_depth > self.depth_gate
                ):
                    return

                yield self._act("xy_wing", lambda: xy_wing(grid))
                yield self._act("xyz_wing", lambda: xyz_wing(grid))
                yield self._act("w_wing", lambda: w_wing(grid))
                yield self._act("x_chain", lambda: x_chain(grid))
                yield self._act("xy_chain", lambda: xy_chain(grid))
                topology = CandidateTopology.build(grid)
                als_analysis = ALSAnalysis.build(grid, topology)
                yield self._act("als_xz", lambda: als_xz(grid, als_analysis))
                yield self._act(
                    "als_xy_wing",
                    lambda: als_xy_wing(grid, als_analysis),
                )
                yield self._act("sue_de_coq", lambda: sue_de_coq(grid))
                yield self._act("forcing_chain", lambda: forcing_chain(grid))
                yield self._act("hidden_tuples3", lambda: self._hidden_tuples(3))
                yield self._act("fish2", lambda: fish(grid, 2))
                yield self._act(
                    "naked_tuples10",
                    lambda: remove_naked_tuples(grid, 10),
                )
                yield self._act("hidden_tuples4", lambda: self._hidden_tuples(4))
                if not in_forcing_chain:
                    yield self._act("fish3", lambda: fish(grid, 3))
                if not in_forcing_chain:
                    yield self._act("finned-fish2", lambda: finned_fish(grid, 2))
                yield self._act("naked_tuples", lambda: remove_naked_tuples(grid))
                if not in_forcing_chain:
                    yield self._act("hidden_tuples", self._hidden_tuples_max)
                yield self._act(
                    "aic",
                    lambda: alternating_inference_chain(grid, topology),
                )
                yield self._act("nishio", lambda: nishio(grid))
                if not in_forcing_chain:
                    yield self._act("fish", lambda: fish(grid, _MAX_FISH))
                    yield self._act(
                        "finned-fish",
                        lambda: finned_fish(grid, _MAX_FISH - 1),
                    )
                yield self._act("forcing_net", lambda: forcing_net(grid))
        ''').lstrip(),
        "    ",
    ).rstrip(),
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
        def _init_worker(worker_payload: bytes) -> None:
            """Unpickle one immutable-by-convention root grid per worker."""
            global _WORKER_ROOT_GRID, _WORKER_DEPTH_GATE
            decoded = pickle.loads(worker_payload)
            if isinstance(decoded, Grid):
                # Backwards-compatible direct initialisation used by tests and
                # third-party embedding code written before depth_gate existed.
                root = decoded
                depth_gate = None
            elif (
                isinstance(decoded, tuple)
                and len(decoded) == 2
                and isinstance(decoded[0], Grid)
            ):
                root, depth_gate = decoded
            else:
                raise TypeError(
                    "Parallel worker payload did not contain a Grid"
                )

            if depth_gate is not None and (
                type(depth_gate) is not int or depth_gate < 0
            ):
                raise TypeError(
                    "Parallel worker depth_gate must be None or a non-negative int"
                )
            _WORKER_ROOT_GRID = root
            _WORKER_DEPTH_GATE = depth_gate


    ''').lstrip(),
)
replace_between(
    parallel_path,
    "def _solve_branch(\n",
    "def _solve_branch_with_stats(\n",
    dedent('''
        def _solve_branch(
            payload: tuple[int, int, int],
        ) -> set[ImmutableGrid]:
            cell, value, max_sols = payload
            grid = _fresh_worker_grid()
            from gridsolver.solver import solver as _solver
            from gridsolver.solver.solver_log import lg as _lg

            _lg.set_lvl(0)
            grid[cell] = value
            return _solver._solve_full(
                grid,
                [0],
                max_sols,
                set(),
                _WORKER_DEPTH_GATE,
            )


    ''').lstrip(),
)
replace_to_end(
    parallel_path,
    "def solve_parallel_trials(\n",
    dedent('''
        def solve_parallel_trials(
            grid: Grid,
            branches: list[tuple[int, int]],
            max_sols: int,
            processes: int,
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
            """Solve branches concurrently while consuming results in branch order."""
            # Derived caches are cheap to rebuild and can dominate pickled payloads.
            grid._struct_cache.clear()
            grid._guarantee_cache.clear()
            ordered_branches = sorted(branches)
            solutions: set[ImmutableGrid] = set()
            stats = current_power_stats()
            worker = _solve_branch_with_stats if stats is not None else _solve_branch

            # Serialize the root and the explicit per-solve gate once. Each worker
            # receives that immutable payload through its initializer; task payloads
            # remain the same compact three-scalar tuples as before.
            worker_payload = pickle.dumps(
                (grid, depth_gate),
                protocol=pickle.HIGHEST_PROTOCOL,
            )
            with concurrent.futures.ProcessPoolExecutor(
                max_workers=processes,
                initializer=_init_worker,
                initargs=(worker_payload,),
            ) as pool:
                # Keep no more than one outstanding branch per worker. Submitting every
                # branch up front queues work that a small positive solution cap may
                # never need.
                initial_count = min(processes, len(ordered_branches))
                futures = deque(
                    pool.submit(
                        worker,
                        (cell, value, max_sols),
                    )
                    for cell, value in ordered_branches[:initial_count]
                )
                next_branch_index = initial_count

                while futures:
                    future = futures.popleft()
                    result = future.result()
                    if stats is None:
                        branch_solutions = result
                    else:
                        branch_solutions, branch_stats = result
                        stats.merge(branch_stats)
                    solutions.update(branch_solutions)

                    if 0 < max_sols <= len(solutions):
                        for pending in futures:
                            pending.cancel()
                        # Python 3.14 can stop branches already running. Without this,
                        # context-manager exit waits for every worker after the
                        # deterministic capped subset is complete.
                        if futures:
                            pool.terminate_workers()
                        break

                    if next_branch_index < len(ordered_branches):
                        cell, value = ordered_branches[next_branch_index]
                        next_branch_index += 1
                        futures.append(
                            pool.submit(
                                worker,
                                (cell, value, max_sols),
                            )
                        )

            return _cap_solutions(solutions, max_sols)
    ''').lstrip(),
)


run_path = Path("run.py")
replace_between(
    run_path,
    "def build_parser(\n",
    "def _load_grid(\n",
    dedent('''
        def build_parser() -> argparse.ArgumentParser:
            parser = argparse.ArgumentParser(description="Solve a grid puzzle")
            source = parser.add_mutually_exclusive_group(required=True)
            source.add_argument(
                "-m",
                "--module",
                help="Python module containing puzzle object g",
            )
            source.add_argument(
                "-s",
                "--str",
                dest="puzzle_string",
                help="Puzzle string",
            )
            source.add_argument("-f", "--file", help="Puzzle file")
            source.add_argument(
                "-e",
                "--example",
                choices=("a", "b", "c", "d", "f", "m", "s", "t"),
                help="Built-in example puzzle",
            )

            parser.add_argument(
                "-c",
                "--class",
                "--class_",
                dest="puzzle_class",
                choices=_PUZZLE_CLASSES,
                help="Puzzle class; required with --str",
            )
            parser.add_argument(
                "-o",
                "--colour",
                choices=tuple(mode.name for mode in Colouring),
                default=Colouring.Colorama.name,
                help="Output colouring mode",
            )
            parser.add_argument(
                "-d",
                "--detail",
                type=int,
                default=0,
                help="Log detail level",
            )
            parser.add_argument(
                "-v",
                "--verbose",
                action="store_true",
                help="Print every solver step",
            )
            parser.add_argument(
                "-p",
                "--processes",
                type=_non_negative_int,
                default=0,
                help="Top-level process-pool workers (0 or 1 means sequential)",
            )
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
            parser.add_argument(
                "--space-separated",
                action="store_true",
                help="Treat whitespace as value separators for string/file input",
            )
            parser.add_argument(
                "--column-wise",
                action="store_true",
                help="Interpret string/file values column-wise",
            )
            return parser


    ''').lstrip(),
)
replace_between(
    run_path,
    "def main(\n",
    "\n\nif __name__ == \"__main__\":\n",
    dedent('''
        def main(argv: Sequence[str] | None = None) -> int:
            parser = build_parser()
            args = parser.parse_args(argv)

            set_colouring(Colouring[args.colour])
            detail = MAX_LVL if args.verbose else args.detail
            solver.set_loglevel(detail)

            grid = _load_grid(args, parser)
            start = time.perf_counter()
            solver.solve(
                grid,
                max_sols=args.max_solutions,
                processes=args.processes,
                depth_gate=args.depth_gate,
            )
            _LOG.logs(0, f"Took {time.perf_counter() - start:.4f}s to execute.")
            return 0
    ''').lstrip(),
)


Path("tests/test_depth_gate.py").write_text(
    dedent('''
        import pickle

        import pytest

        from gridsolver.abstract_grids.grid import Grid, SolveStatus
        from gridsolver.solver import atomic_solver
        from gridsolver.solver import solve_parallel as parallel_module
        from gridsolver.solver import solver
        from gridsolver.solver.atomic_solver import AtomicSolver
        from run import build_parser


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
            assert solver.solve(Grid(1)) == solver.solve(
                Grid(1),
                depth_gate=None,
            )


        def test_depth_gate_zero_keeps_full_root_and_gates_only_children(
            monkeypatch,
        ):
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


        def test_parallel_root_forwards_depth_gate(monkeypatch):
            captured = {}

            def fake_atomic(self):
                return SolveStatus.NONE

            def fake_parallel(
                seed,
                branches,
                max_sols,
                processes,
                depth_gate=None,
            ):
                captured.update(
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

            grid = Grid(1, 1, max_elem=2)
            assert solver._solve_top_parallel(
                grid,
                3,
                2,
                depth_gate=2,
            ) == set()
            assert captured == {
                "branches": [(0, 1), (0, 2)],
                "max_sols": 3,
                "processes": 2,
                "depth_gate": 2,
            }


        def test_worker_bundle_forwards_depth_gate_without_expanding_tasks(
            monkeypatch,
        ):
            monkeypatch.setattr(parallel_module, "_WORKER_ROOT_GRID", None)
            monkeypatch.setattr(parallel_module, "_WORKER_DEPTH_GATE", None)
            captured = {}

            def fake_solve_full(
                grid,
                steps,
                max_sols,
                hidden_pair_checked_gts,
                depth_gate=None,
            ):
                captured["depth_gate"] = depth_gate
                return set()

            monkeypatch.setattr(solver, "_solve_full", fake_solve_full)
            root = Grid(1, 1, max_elem=2)
            parallel_module._init_worker(
                pickle.dumps(
                    (root, 2),
                    protocol=pickle.HIGHEST_PROTOCOL,
                )
            )

            assert parallel_module._solve_branch((0, 1, 1)) == set()
            assert captured["depth_gate"] == 2
            assert parallel_module._WORKER_DEPTH_GATE == 2


        def test_depth_gate_cli_is_explicit_and_default_off():
            parser = build_parser()
            common = ["--str", "1", "--class", "sudoku"]

            default = parser.parse_args(common)
            explicit = parser.parse_args([*common, "--depth-gate", "0"])
            assert default.depth_gate is None
            assert explicit.depth_gate == 0

            with pytest.raises(SystemExit):
                parser.parse_args([*common, "--depth-gate", "-1"])
            with pytest.raises(SystemExit):
                parser.parse_args([*common, "--depth-gate", "not-an-int"])
    ''').lstrip(),
    encoding="utf-8",
)


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
