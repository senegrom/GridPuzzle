"""Path puzzles: dead ends refuted by propagation instead of search.

The values of a Hidato or Numbrix board are a bijection onto its cells, so
the path rule enforces all-different by matching (Regin) on top of its
layered walks. A pigeonhole the walks miss used to cost thousands of branch
nodes; an empty board asked for two solutions now barely backtracks.
"""
from gridsolver.abstract_grids.grid import SolveStatus
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.rules.rules import InvalidGrid
from gridsolver.rules.topology import ConsecutiveAdjacencyRule
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver


def _root_status(grid):
    """Status of the first propagation pass, before any branching."""
    return AtomicSolver(grid.deepcopy(), [], set()).solve_atomic()


def test_hidato_pigeonhole_is_refuted_without_search():
    # 1-6 and 16-21 cross the 6x6 board in exactly five steps, and 6-11,
    # 11-16 too, so 5, 7, 15 and 17 all need column 4 within rows 0-2:
    # four values for three cells. The layered walks allow each one alone.
    board = [[None] * 6 for _ in range(6)]
    board[0][0], board[0][5], board[1][0], board[1][5], board[2][0] = 1, 6, 11, 16, 21
    grid = Hidato.from_board(board)
    rule = next(rule for rule in grid.rules if isinstance(rule, ConsecutiveAdjacencyRule))
    try:
        rule.apply(grid._known, tuple(set(possible) for possible in grid._candidates))
    except InvalidGrid:
        pass
    else:
        raise AssertionError("the path rule accepted four values for three cells")
    assert _root_status(grid) is SolveStatus.INVALID
    assert solver.solve(grid) == set()


def _branch_nodes(grid, monkeypatch, max_sols):
    nodes = 0
    original = solver._atomic_pass_or_branches

    def counted(*args, **kwargs):
        nonlocal nodes
        result = original(*args, **kwargs)
        nodes += result[0] is None
        return result

    monkeypatch.setattr(solver, "_atomic_pass_or_branches", counted)
    solutions = solver.solve(grid, max_sols=max_sols)
    monkeypatch.undo()
    return nodes, solutions


def test_empty_path_boards_are_solved_almost_without_backtracking(monkeypatch):
    # The browser asks for two solutions. Master needed 1,846 branch nodes
    # (about 6 s) for an empty 6x6 Hidato and over 20,000 for 8x8.
    for cls, side in ((Hidato, 6), (Hidato, 8), (Numbrix, 8)):
        nodes, solutions = _branch_nodes(cls.from_board([[None] * side] * side), monkeypatch, 2)
        assert len(solutions) == 2
        assert nodes <= 3 * side * side // 2, (cls.__name__, side, nodes)
