from numbers import Integral

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.solver_log import lg as _lg
from gridsolver.solver.validation import validate_solutions


def set_loglevel(level: int) -> None:
    _lg.set_lvl(level)


def _solution_key(solution: ImmutableGrid) -> tuple[int, int, int, tuple[int, ...]]:
    return solution.rows, solution.cols, solution.max_elem, tuple(solution)


def _cap_solutions(
    solutions: set[ImmutableGrid],
    max_sols: int,
) -> set[ImmutableGrid]:
    if max_sols > 0 and len(solutions) > max_sols:
        return set(sorted(solutions, key=_solution_key)[:max_sols])
    return solutions


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
    with _lg.solve_context(log_level):
        return _solve_validated(grid, max_sols, processes, depth_gate)


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

    for index, solution in enumerate(sorted(solutions, key=_solution_key)):
        _lg.logs(0, f"Solution {index}", header=True)
        _lg.logg(0, solution, format_args=grid.format_args, rules=grid.rules)

    if not solutions:
        _lg.logs(0, "No solution found.", header=True)

    return solutions


def _solve_top_parallel(
    grid: Grid,
    max_sols: int,
    processes: int,
    depth_gate: int | None,
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
        use_guarantee = guarantee is not None and len(guarantee.cells) < len(values)
        trials = sorted(guarantee.cells) if use_guarantee else values
        solutions: set[ImmutableGrid] = set()
        # AtomicSolver only reads the incoming snapshot and replaces its
        # own reference after a full hidden-tuple pass. All sibling branches
        # therefore share this one immutable-by-convention parent snapshot.
        checked_guarantees = set(grid.guarantees)

        for trial in trials:
            depth = len(steps)
            if use_guarantee:
                _lg.logstep(
                    depth,
                    steps,
                    f"Trial (guarantee) [{trial % grid.rows},{trial // grid.rows}] "
                    f"== {guarantee.val} with {len(solutions)} previous solutions",
                )
            else:
                _lg.logstep(
                    depth,
                    steps,
                    f"Trial [{test_cell % grid.rows},{test_cell // grid.rows}] "
                    f"== {trial} with {len(solutions)} previous solutions",
                )

            # Reuse the current grid for every branch. The journal restores
            # candidates, known values, rules, guarantees and branch-local memos.
            mark = grid.trail_mark()
            try:
                if use_guarantee:
                    grid[trial] = guarantee.val
                else:
                    grid[test_cell] = trial

                remaining = -1 if max_sols == -1 else max_sols - len(solutions)
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
                _lg.logs(0, f"Step {steps} - Reached max_sols == {max_sols}")
                return _cap_solutions(solutions, max_sols)

        return solutions
    finally:
        steps.pop()
