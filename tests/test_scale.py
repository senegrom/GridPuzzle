"""Scale tests: big sudokus from generated puzzles (no example files needed).

The solved grid for box size k (n = k*k) is the standard algebraic pattern
    value(r, c) = ((r % k) * k + r // k + c) % n + 1
which satisfies rows, columns and k*k boxes. The puzzle blanks both diagonals;
every blank sits in an almost-complete row/column, so propagation alone must
restore the original solution — these test loading, rule construction and
propagation at scale, not search difficulty. Solutions are compared by
CONTENT, not just count.

Determinism: generation is pure arithmetic with a fixed blanking pattern, and
the assertions depend only on the (unique) solution's content — internal
solve order may vary with PYTHONHASHSEED, the asserted outcome cannot.

Size ceiling (June 2026 probe, tracemalloc-inflated): 36x36 8s/35MB,
64x64 2min/175MB, 100x100 19min/812MB — ~3.5x per step, so 144x144 (~1h) and
256x256 (hours, multi-GB) are deliberately excluded.
"""
import pytest

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver


def _solution(k: int) -> list:
    n = k * k
    return [((r % k) * k + r // k + c) % n + 1 for r in range(n) for c in range(n)]


def _puzzle_with_blank_diagonals(k: int) -> list:
    n = k * k
    values = _solution(k)
    for i in range(n):
        values[i * n + i] = 0
        values[i * n + (n - 1 - i)] = 0
    return values


def _solve_and_check(k: int) -> None:
    n = k * k
    g = Sudoku(k, k, k, k)
    g.load(_puzzle_with_blank_diagonals(k))
    sols = solver.solve(g, log_level=0)
    assert len(sols) == 1
    solution = next(iter(sols))
    # row-major comparison: solution[(r, c)] against the generating pattern
    expected = _solution(k)
    actual = [solution[(r, c)] for r in range(n) for c in range(n)]
    assert actual == expected


@pytest.mark.parametrize("k", [4, 5, 6])
def test_sudoku_scale(k):
    _solve_and_check(k)


@pytest.mark.slow
@pytest.mark.parametrize("k", [7, 8, 9, 10])
def test_sudoku_scale_large(k):
    _solve_and_check(k)
