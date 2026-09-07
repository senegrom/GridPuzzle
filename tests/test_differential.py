import logging
import random
from contextlib import contextmanager
from functools import lru_cache
from itertools import permutations, product

import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.propagation import propagate_basic
from gridsolver.solver.validation import validate_solution


type Solution = tuple[int, ...]
type Puzzle = tuple[int, ...]


@lru_cache(maxsize=1)
def _sudoku4_solutions() -> tuple[Solution, ...]:
    """Enumerate 4x4 Sudoku independently of GridPuzzle rules."""
    row_options = tuple(permutations(range(1, 5)))
    solutions: list[Solution] = []

    for rows in product(row_options, repeat=4):
        if any(
            len({rows[row][col] for row in range(4)}) != 4
            for col in range(4)
        ):
            continue
        if any(
            len(
                {
                    rows[row][col]
                    for row in range(box_row, box_row + 2)
                    for col in range(box_col, box_col + 2)
                }
            )
            != 4
            for box_row in (0, 2)
            for box_col in (0, 2)
        ):
            continue

        # Grid stores cells column-major; the oracle generates rows.
        solutions.append(
            tuple(rows[row][col] for col in range(4) for row in range(4))
        )

    return tuple(sorted(solutions))


def _matching_solutions(puzzle: Puzzle) -> frozenset[Solution]:
    return frozenset(
        solution
        for solution in _sudoku4_solutions()
        if all(
            clue == 0 or solution[cell] == clue
            for cell, clue in enumerate(puzzle)
        )
    )


@lru_cache(maxsize=1)
def _differential_cases() -> tuple[tuple[Puzzle, frozenset[Solution]], ...]:
    rng = random.Random(0x20260808)
    solutions = _sudoku4_solutions()
    cases: list[tuple[Puzzle, frozenset[Solution]]] = []
    seen: set[Puzzle] = set()

    attempts = 0
    while len(cases) < 16 and attempts < 10_000:
        attempts += 1
        source = rng.choice(solutions)
        clue_count = rng.randint(6, 11)
        clue_cells = set(rng.sample(range(16), clue_count))
        puzzle = tuple(
            source[cell] if cell in clue_cells else 0
            for cell in range(16)
        )
        if puzzle in seen:
            continue
        expected = _matching_solutions(puzzle)
        if not 1 <= len(expected) <= 12:
            continue
        seen.add(puzzle)
        cases.append((puzzle, expected))

    if len(cases) != 16:
        raise AssertionError("Could not construct bounded differential cases")

    # Contradictions in a row, a column, and a box respectively.
    for first, second, value in ((0, 4, 1), (0, 1, 2), (0, 5, 3)):
        invalid = [0] * 16
        invalid[first] = value
        invalid[second] = value
        puzzle = tuple(invalid)
        expected = _matching_solutions(puzzle)
        if expected:
            raise AssertionError("Invalid oracle fixture unexpectedly has solutions")
        cases.append((puzzle, expected))

    return tuple(cases)


def _load(puzzle: Puzzle) -> Sudoku:
    grid = Sudoku(2, 2, 2, 2)
    grid.load(puzzle, row_wise=False)
    return grid


@contextmanager
def _quiet_solver_logs():
    previous = logging.root.manager.disable
    logging.disable(10_000)
    try:
        yield
    finally:
        logging.disable(previous)


def test_independent_sudoku4_oracle_has_known_cardinality():
    assert len(_sudoku4_solutions()) == 288


def test_random_sudoku4_solution_sets_match_independent_oracle():
    with _quiet_solver_logs():
        for puzzle, expected in _differential_cases():
            actual = {
                tuple(solution)
                for solution in solver.solve(_load(puzzle), log_level=0)
            }
            assert actual == expected, f"puzzle={puzzle}"


def test_atomic_deductions_preserve_every_oracle_completion():
    with _quiet_solver_logs():
        for puzzle, expected in _differential_cases():
            if not expected:
                continue

            grid = _load(puzzle)
            status = AtomicSolver(grid, [], set()).solve_atomic()
            assert status is not SolveStatus.INVALID, f"puzzle={puzzle}"

            for cell in range(grid.len):
                oracle_values = {
                    solution[cell]
                    for solution in expected
                }
                assert oracle_values <= grid._candidates[cell], (
                    f"cell={cell}, puzzle={puzzle}, "
                    f"lost={oracle_values - grid._candidates[cell]}"
                )
                known = grid._known[cell]
                if known > 0:
                    assert oracle_values == {known}, (
                        f"unsound known {known} at cell={cell}, puzzle={puzzle}"
                    )

            if status is SolveStatus.SOLVED:
                assert tuple(grid._known) in expected


_POWER_ACTION_LABELS = (
    "locked_candidate",
    "skyscraper",
    "empty_rectangle",
    "ineq_bounds",
    "rulehelper_atmostonce",
    "rulehelper_sum_atmostonce",
    "rulehelper_house_sums",
    "naked_tuples5",
    "xy_wing",
    "xyz_wing",
    "w_wing",
    "x_chain",
    "xy_chain",
    "als_xz",
    "als_xy_wing",
    "sue_de_coq",
    "forcing_chain",
    "hidden_tuples3",
    "fish2",
    "naked_tuples10",
    "hidden_tuples4",
    "fish3",
    "finned-fish2",
    "naked_tuples",
    "hidden_tuples",
    "aic",
    "nishio",
    "fish",
    "finned-fish",
    "forcing_net",
)


@lru_cache(maxsize=None)
def _solution_pair_at_distance(distance: int) -> tuple[Solution, Solution]:
    base = _sudoku4_solutions()[0]
    for candidate in _sudoku4_solutions()[1:]:
        if sum(left != right for left, right in zip(base, candidate)) == distance:
            return base, candidate
    raise AssertionError(f"No 4x4 Sudoku pair at Hamming distance {distance}")


def _assert_completions_survive(
    grid: Sudoku,
    completions: tuple[Solution, ...],
    *,
    stage: str,
) -> None:
    for cell in range(grid.len):
        oracle_values = {completion[cell] for completion in completions}
        assert oracle_values <= grid._candidates[cell], (
            f"{stage}: cell={cell}, "
            f"lost={oracle_values - grid._candidates[cell]}"
        )
        known = grid._known[cell]
        if known > 0:
            assert oracle_values == {known}, (
                f"{stage}: unsound known {known} at cell={cell}; "
                f"oracle values are {oracle_values}"
            )

    # Also catch a technique that adds an invalid rule or guarantee without
    # immediately removing a candidate.
    for completion in completions:
        validate_solution(
            grid,
            ImmutableGrid(completion, rows=4, cols=4, max_elem=4),
        )


def _grid_from_completions(completions: tuple[Solution, ...]) -> Sudoku:
    grid = Sudoku(2, 2, 2, 2)
    for cell, candidates in enumerate(grid._candidates):
        candidates.intersection_update(
            completion[cell] for completion in completions
        )

    status = propagate_basic(grid)
    assert status is not SolveStatus.INVALID
    _assert_completions_survive(grid, completions, stage="basic setup")
    return grid


def _exercise_each_power_action(distance: int) -> None:
    completions = _solution_pair_at_distance(distance)
    grid = _grid_from_completions(completions)
    atomic = AtomicSolver(grid, [], set())
    labels: list[str] = []

    with _quiet_solver_logs():
        for label in atomic._solve_power_actions():
            labels.append(label)
            _assert_completions_survive(
                grid,
                completions,
                stage=f"after {label}",
            )

            # The production solver restarts basic propagation after the first
            # power-action hit. Do the same before exercising the next action so
            # every technique receives its real precondition: a basic fixpoint.
            status = propagate_basic(grid)
            assert status is not SolveStatus.INVALID, label
            _assert_completions_survive(
                grid,
                completions,
                stage=f"after {label} + basic propagation",
            )

    assert tuple(labels) == _POWER_ACTION_LABELS


def test_each_power_action_preserves_two_oracle_completions():
    """Execute every deduction tier against a small independently valid state."""
    _exercise_each_power_action(4)


# Unmarked August 2026: the trio runs in under a second on the current tree —
# the dedicated extended-CI job it justified had become a runner spin-up for
# sub-second tests.
@pytest.mark.parametrize("distance", [8, 12, 16])
def test_each_power_action_preserves_broader_oracle_states(distance):
    """Exercise every tier on progressively less constrained oracle states."""
    _exercise_each_power_action(distance)


def test_power_actions_preserve_completions_with_non_house_weak_link():
    completions = tuple(
        solution
        for solution in _sudoku4_solutions()
        if solution[0] != solution[6]
    )[:2]
    assert len(completions) == 2

    grid = _grid_from_completions(completions)
    grid.add_rule_checked(UneqRule(grid, origin_cell=0, rel_cells=[6]))
    atomic = AtomicSolver(grid, [], set())

    with _quiet_solver_logs():
        for label in atomic._solve_power_actions():
            _assert_completions_survive(
                grid,
                completions,
                stage=f"non-house weak link after {label}",
            )
            status = propagate_basic(grid)
            assert status is not SolveStatus.INVALID, label
            _assert_completions_survive(
                grid,
                completions,
                stage=f"non-house weak link after {label} + basic",
            )


# --- capped and parallel modes against the same oracles ----------------------
#
# validate_solutions() proves every returned grid is a solution, so the only
# failure the uncapped tests cannot see is a *missing* solution. The capped and
# parallel paths select subsets, where an undercount hides completely (the
# 2026-08-14 bug returned 9 of 15 solutions and validated fine). These tests
# pin subset size, membership, and determinism against independent oracles.


def _solution_tuples(grid: Grid, **options) -> frozenset[Solution]:
    return frozenset(
        tuple(solution) for solution in solver.solve(grid, log_level=0, **options)
    )


def _oracle_caps(size: int) -> tuple[int, ...]:
    return tuple(sorted({1, size // 2, size - 1, size, size + 3} - {0}))


def _assert_capped_subset(
    actual: frozenset[Solution],
    expected: frozenset[Solution],
    cap: int,
    *,
    label: str,
) -> None:
    assert len(actual) == min(cap, len(expected)), (
        f"{label}: cap={cap} returned {len(actual)} of {len(expected)}"
    )
    assert actual <= expected, f"{label}: cap={cap} returned non-solutions"


def test_capped_sequential_sudoku4_solves_return_deterministic_oracle_subsets():
    with _quiet_solver_logs():
        for puzzle, expected in _differential_cases():
            if len(expected) < 2:
                continue
            for cap in (1, len(expected) - 1):
                first = _solution_tuples(_load(puzzle), max_sols=cap)
                _assert_capped_subset(first, expected, cap, label=f"puzzle={puzzle}")
                second = _solution_tuples(_load(puzzle), max_sols=cap)
                assert first == second, f"puzzle={puzzle}, cap={cap}: capped subset changed"


def _parallel_sudoku4_cases() -> tuple[tuple[Puzzle, frozenset[Solution]], ...]:
    solvable = sorted(
        (case for case in _differential_cases() if case[1]),
        key=lambda case: -len(case[1]),
    )
    contradiction = next(case for case in _differential_cases() if not case[1])
    return (*solvable[:3], contradiction)


def test_parallel_sudoku4_solution_sets_match_independent_oracle():
    with _quiet_solver_logs():
        for puzzle, expected in _parallel_sudoku4_cases():
            actual = _solution_tuples(_load(puzzle), processes=2)
            assert actual == expected, f"puzzle={puzzle}"


def test_capped_parallel_sudoku4_solves_return_deterministic_oracle_subsets():
    with _quiet_solver_logs():
        for puzzle, expected in _parallel_sudoku4_cases()[:2]:
            for cap in (1, len(expected) - 1):
                first = _solution_tuples(_load(puzzle), max_sols=cap, processes=2)
                _assert_capped_subset(
                    first, expected, cap, label=f"parallel puzzle={puzzle}"
                )
                second = _solution_tuples(_load(puzzle), max_sols=cap, processes=2)
                assert first == second, f"puzzle={puzzle}, cap={cap}: parallel subset changed"


type BareCase = tuple[
    int, int, tuple[tuple[int, frozenset[int]], ...], frozenset[int], frozenset[Solution]
]


def _bare_grid_oracle(
    width: int,
    max_elem: int,
    guarantees: tuple[tuple[int, frozenset[int]], ...],
    distinct_cells: frozenset[int],
) -> frozenset[Solution]:
    """Brute force: every at-least-once guarantee holds, distinct cells differ."""
    solutions = set()
    for values in product(range(1, max_elem + 1), repeat=width):
        if any(all(values[cell] != value for cell in cells) for value, cells in guarantees):
            continue
        if len({values[cell] for cell in distinct_cells}) != len(distinct_cells):
            continue
        solutions.add(values)
    return frozenset(solutions)


@lru_cache(maxsize=1)
def _bare_grid_cases() -> tuple[BareCase, ...]:
    """Tiny one-row grids whose small guarantees force overlapping guarantee
    branches at the search root -- the shape the 2026-08-14 undercount needed."""
    rng = random.Random(0x20260902)
    cases: list[BareCase] = []
    while len(cases) < 12:
        width = rng.choice((3, 4))
        max_elem = rng.randint(2, 4)
        guarantees = tuple(
            (
                rng.randint(1, max_elem),
                frozenset(rng.sample(range(width), rng.randint(1, min(3, width)))),
            )
            for _ in range(rng.randint(1, 3))
        )
        distinct = (
            frozenset(rng.sample(range(width), rng.randint(2, width)))
            if rng.random() < 0.5
            else frozenset()
        )
        expected = _bare_grid_oracle(width, max_elem, guarantees, distinct)
        if len(expected) < 2:
            continue
        cases.append((width, max_elem, guarantees, distinct, expected))
    return tuple(cases)


def _load_bare(case: BareCase) -> Grid:
    width, max_elem, guarantees, distinct, _ = case
    grid = Grid(1, width, max_elem=max_elem)
    if distinct:
        grid.add_rule_checked(ElementsAtMostOnce(grid, cells=sorted(distinct)))
    for value, cells in guarantees:
        grid.add_gtee_checked(Guarantee(value, cells, grid.rows, grid.cols))
    return grid


def test_bare_guarantee_grids_match_brute_force_oracle():
    with _quiet_solver_logs():
        for case in _bare_grid_cases():
            assert _solution_tuples(_load_bare(case)) == case[-1], case[:4]


def test_capped_bare_guarantee_grids_never_undercount():
    with _quiet_solver_logs():
        for case in _bare_grid_cases():
            expected = case[-1]
            for cap in _oracle_caps(len(expected)):
                actual = _solution_tuples(_load_bare(case), max_sols=cap)
                _assert_capped_subset(actual, expected, cap, label=f"bare case={case[:4]}")


def test_capped_parallel_bare_guarantee_grids_never_undercount():
    with _quiet_solver_logs():
        for case in _bare_grid_cases()[:2]:
            expected = case[-1]
            cap = max(1, len(expected) // 2)
            actual = _solution_tuples(_load_bare(case), max_sols=cap, processes=2)
            _assert_capped_subset(actual, expected, cap, label=f"parallel bare case={case[:4]}")
