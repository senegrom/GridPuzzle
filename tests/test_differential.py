import logging
import random
from contextlib import contextmanager
from functools import lru_cache
from itertools import permutations, product

from gridsolver.abstract_grids.grid import SolveStatus
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver


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
