from pathlib import Path
from textwrap import dedent


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# atomic_solver.py: move behaviour policy onto each solver instance.
replace_once(
    "gridsolver/solver/atomic_solver.py",
    dedent(
        '''
        # At backtracking depth greater than this value, run only the cheap tier.
        # Behaviour-affecting and therefore disabled by default.
        DEPTH_GATE_K: int | None = None


        '''
    ).lstrip(),
    "",
)
replace_once(
    "gridsolver/solver/atomic_solver.py",
    dedent(
        '''
            def __init__(
                self,
                grid: Grid,
                upsteps: list[int],
                hidden_pair_checked_gts: set[Guarantee],
            ) -> None:
                self.grid = grid
                self.upsteps = upsteps
                self.hidden_pair_checked_gts = hidden_pair_checked_gts
        '''
    ),
    dedent(
        '''
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
        '''
    ),
)
replace_once(
    "gridsolver/solver/atomic_solver.py",
    '        yield self._act("forcing_chain", lambda: forcing_chain(grid))\n',
    dedent(
        '''
                yield self._act(
                    "forcing_chain",
                    lambda: forcing_chain(grid, self.depth_gate),
                )
        '''
    ),
)
replace_once(
    "gridsolver/solver/atomic_solver.py",
    dedent(
        '''
                if DEPTH_GATE_K is not None and not in_forcing_chain and len(self.upsteps) > DEPTH_GATE_K:
                    return
        '''
    ),
    dedent(
        '''
                if (
                    self.depth_gate is not None
                    and not in_forcing_chain
                    and len(self.upsteps) > self.depth_gate
                ):
                    return
        '''
    ),
)

# Forcing-chain branches inherit the option explicitly.
replace_once(
    "gridsolver/solver/solve_forcing_chain.py",
    dedent(
        '''
        def _propagate_with_techniques(grid: Grid) -> SolveStatus:
            """Propagate with cheap techniques while recursive trials are disabled."""
            from gridsolver.solver.atomic_solver import AtomicSolver

            return AtomicSolver(grid, [], set()).solve_atomic()
        '''
    ),
    dedent(
        '''
        def _propagate_with_techniques(
            grid: Grid,
            depth_gate: int | None,
        ) -> SolveStatus:
            """Propagate while recursive trials are disabled."""
            from gridsolver.solver.atomic_solver import AtomicSolver

            return AtomicSolver(
                grid,
                [],
                set(),
                depth_gate=depth_gate,
            ).solve_atomic()
        '''
    ),
)
replace_once(
    "gridsolver/solver/solve_forcing_chain.py",
    "def forcing_chain(grid: Grid) -> None:\n",
    "def forcing_chain(grid: Grid, depth_gate: int | None = None) -> None:\n",
)
replace_once(
    "gridsolver/solver/solve_forcing_chain.py",
    "                    status = _propagate_with_techniques(grid)\n",
    "                    status = _propagate_with_techniques(grid, depth_gate)\n",
)

# solver.py: validate and thread the option through every branch path.
solver_path = Path("gridsolver/solver/solver.py")
solver_text = solver_path.read_text(encoding="utf-8")
validator_start = solver_text.index("def _validate_solve_options(")
validator_end = solver_text.index("\n\ndef solve(", validator_start)
validator = dedent(
    '''
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
                raise TypeError("depth_gate must be None or a non-negative integer")
            depth_gate = int(depth_gate)
            if depth_gate < 0:
                raise ValueError("depth_gate must be non-negative")

        return max_sols, processes, depth_gate
    '''
).strip()
solver_text = solver_text[:validator_start] + validator + solver_text[validator_end:]
solver_path.write_text(solver_text, encoding="utf-8")

replace_once(
    "gridsolver/solver/solver.py",
    dedent(
        '''
        def solve(
            grid: Grid,
            log_level: int | None = None,
            max_sols: int = -1,
            processes: int = 0,
        ) -> set[ImmutableGrid]:
            max_sols, processes = _validate_solve_options(max_sols, processes)
        '''
    ),
    dedent(
        '''
        def solve(
            grid: Grid,
            log_level: int | None = None,
            max_sols: int = -1,
            processes: int = 0,
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
            """Solve a grid without mutating it.

            ``depth_gate`` is an optional backtracking-depth threshold. At
            deeper nodes only the cheap deduction tier runs before search.
            ``None`` preserves the complete technique hierarchy everywhere.
            """
            max_sols, processes, depth_gate = _validate_solve_options(
                max_sols,
                processes,
                depth_gate,
            )
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    "        solutions = _solve_top_parallel(grid.deepcopy(), max_sols, processes)\n",
    dedent(
        '''
                solutions = _solve_top_parallel(
                    grid.deepcopy(),
                    max_sols,
                    processes,
                    depth_gate,
                )
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    "        solutions = _solve_full(grid.deepcopy(), [], max_sols, set())\n",
    dedent(
        '''
                solutions = _solve_full(
                    grid.deepcopy(),
                    [],
                    max_sols,
                    set(),
                    depth_gate,
                )
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    "def _solve_top_parallel(grid: Grid, max_sols: int, processes: int) -> set[ImmutableGrid]:\n",
    dedent(
        '''
        def _solve_top_parallel(
            grid: Grid,
            max_sols: int,
            processes: int,
            depth_gate: int | None,
        ) -> set[ImmutableGrid]:
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    "    status = AtomicSolver(grid, [0], set()).solve_atomic()\n",
    dedent(
        '''
            status = AtomicSolver(
                grid,
                [0],
                set(),
                depth_gate=depth_gate,
            ).solve_atomic()
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    "    return solve_parallel_trials(grid, branches, max_sols, processes)\n",
    dedent(
        '''
            return solve_parallel_trials(
                grid,
                branches,
                max_sols,
                processes,
                depth_gate,
            )
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    dedent(
        '''
        def _solve_full(
            grid: Grid,
            steps: list[int],
            max_sols: int,
            hidden_pair_checked_gts: set[Guarantee],
        ) -> set[ImmutableGrid]:
        '''
    ),
    dedent(
        '''
        def _solve_full(
            grid: Grid,
            steps: list[int],
            max_sols: int,
            hidden_pair_checked_gts: set[Guarantee],
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    "        status = AtomicSolver(grid, steps, hidden_pair_checked_gts).solve_atomic()\n",
    dedent(
        '''
                status = AtomicSolver(
                    grid,
                    steps,
                    hidden_pair_checked_gts,
                    depth_gate=depth_gate,
                ).solve_atomic()
        '''
    ),
)
replace_once(
    "gridsolver/solver/solver.py",
    dedent(
        '''
                    branch_solutions = _solve_full(
                        grid,
                        steps,
                        remaining,
                        checked_guarantees,
                    )
        '''
    ),
    dedent(
        '''
                    branch_solutions = _solve_full(
                        grid,
                        steps,
                        remaining,
                        checked_guarantees,
                        depth_gate,
                    )
        '''
    ),
)

# Process-pool workers receive the threshold in their pickled payload.
replace_once(
    "gridsolver/solver/solve_parallel.py",
    dedent(
        '''
        def _solve_branch(payload: tuple[Grid, int, int, int]) -> set[ImmutableGrid]:
            grid, cell, value, max_sols = payload
        '''
    ),
    dedent(
        '''
        def _solve_branch(
            payload: tuple[Grid, int, int, int, int | None],
        ) -> set[ImmutableGrid]:
            grid, cell, value, max_sols, depth_gate = payload
        '''
    ),
)
replace_once(
    "gridsolver/solver/solve_parallel.py",
    "    return _solver._solve_full(grid, [0], max_sols, set())\n",
    "    return _solver._solve_full(grid, [0], max_sols, set(), depth_gate)\n",
)
replace_once(
    "gridsolver/solver/solve_parallel.py",
    dedent(
        '''
        def solve_parallel_trials(
            grid: Grid,
            branches: list[tuple[int, int]],
            max_sols: int,
            processes: int,
        ) -> set[ImmutableGrid]:
        '''
    ),
    dedent(
        '''
        def solve_parallel_trials(
            grid: Grid,
            branches: list[tuple[int, int]],
            max_sols: int,
            processes: int,
            depth_gate: int | None = None,
        ) -> set[ImmutableGrid]:
        '''
    ),
)
replace_once(
    "gridsolver/solver/solve_parallel.py",
    "            pool.submit(_solve_branch, (grid, cell, value, max_sols))\n",
    dedent(
        '''
                    pool.submit(
                        _solve_branch,
                        (grid, cell, value, max_sols, depth_gate),
                    )
        '''
    ),
)

# CLI exposure.
replace_once(
    "run.py",
    dedent(
        '''
            parser.add_argument(
                "--max-solutions",
                type=_solution_limit,
                default=-1,
                help="Maximum returned solutions; -1 means unlimited",
            )
        '''
    ),
    dedent(
        '''
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
                    "At backtracking depths deeper than this value, run only "
                    "cheap deductions; disabled by default"
                ),
            )
        '''
    ),
)
replace_once(
    "run.py",
    dedent(
        '''
                max_sols=args.max_solutions,
                processes=args.processes,
            )
        '''
    ),
    dedent(
        '''
                max_sols=args.max_solutions,
                processes=args.processes,
                depth_gate=args.depth_gate,
            )
        '''
    ),
)

# CLI and public-option tests.
replace_once(
    "tests/test_cli_and_loading.py",
    dedent(
        '''
                    "--max-solutions",
                    "2",
                    "--colour",
        '''
    ),
    dedent(
        '''
                    "--max-solutions",
                    "2",
                    "--depth-gate",
                    "1",
                    "--colour",
        '''
    ),
)
replace_once(
    "tests/test_cli_and_loading.py",
    dedent(
        '''
            assert args.max_solutions == 2
            assert args.colour == "No"
        '''
    ),
    dedent(
        '''
            assert args.max_solutions == 2
            assert args.depth_gate == 1
            assert args.colour == "No"
        '''
    ),
)
replace_once(
    "tests/test_cli_and_loading.py",
    dedent(
        '''
            with pytest.raises(SystemExit):
                parser.parse_args([*common, "--processes", "not-an-int"])
        '''
    ),
    dedent(
        '''
            with pytest.raises(SystemExit):
                parser.parse_args([*common, "--processes", "not-an-int"])
            with pytest.raises(SystemExit):
                parser.parse_args([*common, "--depth-gate", "-1"])
            with pytest.raises(SystemExit):
                parser.parse_args([*common, "--depth-gate", "not-an-int"])
        '''
    ),
)
replace_once(
    "tests/test_hardening.py",
    dedent(
        '''
            with pytest.raises(TypeError, match="processes"):
                solver.solve(Grid(1), processes=1.5)

            assert solver.solve(Grid(1), max_sols=0) == set()
        '''
    ),
    dedent(
        '''
            with pytest.raises(TypeError, match="processes"):
                solver.solve(Grid(1), processes=1.5)
            with pytest.raises(ValueError, match="depth_gate"):
                solver.solve(Grid(1), depth_gate=-1)
            with pytest.raises(TypeError, match="depth_gate"):
                solver.solve(Grid(1), depth_gate=True)
            with pytest.raises(TypeError, match="depth_gate"):
                solver.solve(Grid(1), depth_gate=1.5)

            assert solver.solve(Grid(1), max_sols=0, depth_gate=0) == set()
        '''
    ),
)
replace_once(
    "tests/test_hardening.py",
    dedent(
        '''
            parallel = solver.solve(_small_sudoku(), log_level=0, max_sols=2, processes=2)

            assert len(first) == 2
            assert first == second == parallel
        '''
    ),
    dedent(
        '''
            parallel = solver.solve(
                _small_sudoku(),
                log_level=0,
                max_sols=2,
                processes=2,
            )
            gated = solver.solve(
                _small_sudoku(),
                log_level=0,
                max_sols=2,
                depth_gate=0,
            )
            parallel_gated = solver.solve(
                _small_sudoku(),
                log_level=0,
                max_sols=2,
                processes=2,
                depth_gate=0,
            )
            after_gated = solver.solve(_small_sudoku(), log_level=0, max_sols=2)

            assert len(first) == 2
            assert first == second == parallel
            assert first == gated == parallel_gated == after_gated
        '''
    ),
)

# The technique harness no longer mutates a process-wide policy variable.
replace_once(
    "tests/test_differential.py",
    "from gridsolver.solver import atomic_solver as atomic_solver_module\n",
    "",
)
replace_once(
    "tests/test_differential.py",
    dedent(
        '''
        def _exercise_each_power_action(
            distance: int,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            monkeypatch.setattr(atomic_solver_module, "DEPTH_GATE_K", None)
        '''
    ),
    "def _exercise_each_power_action(distance: int) -> None:\n",
)
replace_once(
    "tests/test_differential.py",
    "def test_each_power_action_preserves_two_oracle_completions(monkeypatch):\n",
    "def test_each_power_action_preserves_two_oracle_completions():\n",
)
replace_once(
    "tests/test_differential.py",
    "    _exercise_each_power_action(4, monkeypatch)\n",
    "    _exercise_each_power_action(4)\n",
)
replace_once(
    "tests/test_differential.py",
    dedent(
        '''
        def test_each_power_action_preserves_broader_oracle_states(
            distance,
            monkeypatch,
        ):
        '''
    ),
    "def test_each_power_action_preserves_broader_oracle_states(distance):\n",
)
replace_once(
    "tests/test_differential.py",
    "    _exercise_each_power_action(distance, monkeypatch)\n",
    "    _exercise_each_power_action(distance)\n",
)

# Remove the obsolete source-string metadata test; the AST guard is superior.
basic_path = Path("tests/test_basic.py")
basic = basic_path.read_text(encoding="utf-8")
old_test_start = basic.index(
    '@pytest.mark.slow  # ~1 min: full 288-solution enumeration twice + pool spawn\n'
    'def test_uses_guarantees_flag_matches_apply_bodies():'
)
next_test = basic.index("def test_parallel_trials_match_sequential():", old_test_start)
basic_path.write_text(basic[:old_test_start] + basic[next_test:], encoding="utf-8")

# Replace the stale hand-copied CLI synopsis with stable option documentation.
readme_path = Path("README.md")
readme = readme_path.read_text(encoding="utf-8")
args_start = readme.index("## Arguments\n")
args_end = readme.index("\n## Rule types\n", args_start)
args_section = dedent(
    '''
    ## Arguments

    The installed `gridpuzzle` command and `python run.py` expose the same
    options. Use `--processes N` for top-level process-pool search and
    `--max-solutions N` to cap the deterministic returned subset.

    `--depth-gate K` is an opt-in performance policy: at backtracking depths
    deeper than `K`, the solver runs only the cheap deduction tier before
    branching. The default is disabled, preserving the full technique hierarchy
    at every search node. The equivalent library call is:

    ```python
    solutions = solver.solve(
        grid,
        processes=0,
        max_sols=-1,
        depth_gate=None,
    )
    ```

    Run `gridpuzzle --help` for the complete parser-generated option list.
    '''
).lstrip()
readme_path.write_text(readme[:args_start] + args_section + readme[args_end:], encoding="utf-8")

# Align development notes and the TODO record.
development_path = Path("DEVELOPMENT.md")
development = development_path.read_text(encoding="utf-8")
anchor = "**Speculative work uses reversible trails.**\n"
insertion = dedent(
    '''
    **Depth gating is explicit per solve.**
    `solver.solve(..., depth_gate=K)` passes the threshold through recursive and
    process-pool branches. No module-global policy is read, so concurrent solves
    can use different thresholds safely. `None` is the default and retains all
    techniques at every depth.

    '''
)
if insertion not in development:
    development = development.replace(anchor, insertion + anchor, 1)
development_path.write_text(development, encoding="utf-8")

todo_path = Path("TODO.md")
todo = todo_path.read_text(encoding="utf-8")
todo = todo.replace(
    "## Depth-gated technique tiers — DONE as an opt-in flag",
    "## Depth-gated technique tiers — DONE as an explicit per-solve option",
    1,
)
todo = todo.replace(
    "`atomic_solver.DEPTH_GATE_K` runs only the cheap tier below a chosen\n"
    "search depth.",
    "`solve(..., depth_gate=K)` runs only the cheap tier below a chosen\n"
    "search depth. The option is passed explicitly through sequential and\n"
    "process-pool branches; concurrent solves no longer share policy state.",
    1,
)
todo_path.write_text(todo, encoding="utf-8")
