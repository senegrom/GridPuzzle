import logging
import random
from contextlib import contextmanager
from functools import lru_cache
from itertools import permutations, product

import pytest

from gridsolver.abstract_grids.grid import SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import atomic_solver as atomic_solver_module
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


def _exercise_each_power_action(
    distance: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(atomic_solver_module, "DEPTH_GATE_K", None)
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


def test_each_power_action_preserves_two_oracle_completions(monkeypatch):
    """Execute every deduction tier against a small independently valid state."""
    _exercise_each_power_action(4, monkeypatch)


@pytest.mark.slow
@pytest.mark.parametrize("distance", [8, 12, 16])
def test_each_power_action_preserves_broader_oracle_states(
    distance,
    monkeypatch,
):
    """Exercise every tier on progressively less constrained oracle states."""
    _exercise_each_power_action(distance, monkeypatch)
