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


def _log_solution(grid: Grid, solution: ImmutableGrid) -> None:
    """Render a solution using puzzle geometry when the grid provides it."""
    formatter = getattr(grid, "format_solution", None)
    if callable(formatter):
        _lg.logs(0, formatter(solution))
        return
    _lg.logg(
        0,
        solution,
        format_args=grid.format_args,
        rules=grid.rules,
    )


def _validate_solve_options(
    max_sols: int,
    processes: int,
) -> tuple[int, int]:
    for name, value in (("max_sols", max_sols), ("processes", processes)):
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(f"{name} must be an integer")

    max_sols = int(max_sols)
    processes = int(processes)
    if max_sols < -1:
        raise ValueError("max_sols must be -1 (unlimited) or non-negative")
    if processes < 0:
        raise ValueError("processes must be non-negative")
    return max_sols, processes


def solve(
    grid: Grid,
    log_level: int | None = None,
    max_sols: int = -1,
    processes: int = 0,
) -> set[ImmutableGrid]:
    """Solve a grid without mutating it.

    With ``0 < max_sols < |solutions|`` the returned subset is deterministic
    within each mode but mode-dependent. Sequential search keeps the first
    solutions in branch-priority (DFS) order. Parallel search consumes
    top-level branches in deterministic priority order, stops after the first
    consumed branch prefix reaches the cap, and uses content-key order only
    to trim that collected prefix. It does not exhaust later branches to
    compute a global content-key minimum. Repeated runs in one mode always
    agree; runs with different ``processes`` settings may select different
    subsets of the same solution space.
    """
    if not isinstance(grid, Grid):
        raise TypeError("grid must be a Grid instance")
    max_sols, processes = _validate_solve_options(max_sols, processes)
    with _lg.solve_context(log_level):
        return _solve_validated(grid, max_sols, processes)


def _solve_validated(
    grid: Grid,
    max_sols: int,
    processes: int,
) -> set[ImmutableGrid]:
    if max_sols == 0:
        return set()

    # Solving operates exclusively on clones. The caller may therefore reuse,
    # extend, or load the original grid after this function returns.
    working_grid = grid.deepcopy()
    if processes > 1:
        solutions = _solve_top_parallel(
            working_grid,
            max_sols,
            processes,
        )
    else:
        solutions = _solve_full(
            working_grid,
            [],
            max_sols,
            set(),
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
            _log_solution(grid, solution)

        if not solutions:
            _lg.logs(0, "No solution found.", header=True)

    return solutions


def _atomic_pass_or_branches(
    grid: Grid,
    steps: list[int],
    hidden_pair_checked_gts: set[Guarantee],
    *,
    allow_overlapping_guarantee_branches: bool = True,
) -> tuple[set[ImmutableGrid] | None, list[tuple[int, int]], bool]:
    """Run one atomic pass; return (final_solutions, branches, from_guarantee).

    ``final_solutions`` is non-None when the pass settled the grid (solved or
    invalid). Otherwise ``branches`` is the deterministic first-level
    (cell, value) trial list — the single branch-choice heuristic that both
    the sequential and the parallel searches must share, since capped
    ``max_sols`` subset determinism depends on identical branch ordering.
    """
    status = AtomicSolver(
        grid,
        steps,
        hidden_pair_checked_gts,
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
        }, [], False
    if status is SolveStatus.INVALID:
        return set(), [], False

    test_cell, possible = grid.get_smallest_candidate_set_gt1()
    guarantee = grid.get_smallest_guarantee()
    values = sorted(possible)

    # At-least-once guarantee branches overlap when the value can occur in
    # several cells at once: one solution then satisfies multiple branches.
    # A positive cap threads per-branch remainders, which duplicate solutions
    # silently consume, so capped searches must use disjoint cell-value
    # branches (same cell, different values) instead.
    if (
        allow_overlapping_guarantee_branches
        and guarantee is not None
        and len(guarantee.cells) < len(values)
    ):
        return None, [
            (cell, guarantee.val) for cell in sorted(guarantee.cells)
        ], True
    return None, [(test_cell, value) for value in values], False


def _solve_top_parallel(
    grid: Grid,
    max_sols: int,
    processes: int,
) -> set[ImmutableGrid]:
    """Run one atomic pass, then distribute deterministic first-level branches."""
    from gridsolver.solver.solve_parallel import solve_parallel_trials

    settled, branches, _ = _atomic_pass_or_branches(
        grid,
        [0],
        set(),
        allow_overlapping_guarantee_branches=max_sols == -1,
    )
    if settled is not None:
        return settled

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
    )


def _solve_full(
    grid: Grid,
    steps: list[int],
    max_sols: int,
    hidden_pair_checked_gts: set[Guarantee],
) -> set[ImmutableGrid]:
    steps.append(0)
    try:
        settled, branches, from_guarantee = _atomic_pass_or_branches(
            grid,
            steps,
            hidden_pair_checked_gts,
            allow_overlapping_guarantee_branches=max_sols == -1,
        )
        if settled is not None:
            return settled

        solutions: set[ImmutableGrid] = set()
        # AtomicSolver only reads the incoming snapshot and replaces its
        # own reference after a full hidden-tuple pass. All sibling branches
        # therefore share this one immutable-by-convention parent snapshot.
        checked_guarantees = set(grid.guarantees)

        for cell, value in branches:
            depth = len(steps)
            if _lg.is_enabled(depth):
                _lg.logstep(
                    depth,
                    steps,
                    f"Trial{' (guarantee)' if from_guarantee else ''} "
                    f"[{cell % grid.rows},{cell // grid.rows}] "
                    f"== {value} with "
                    f"{len(solutions)} previous solutions",
                )

            # Reuse the current grid for every branch. The journal restores
            # candidates, known values, rules, guarantees and branch-local memos.
            mark = grid.trail_mark()
            try:
                grid[cell] = value

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
