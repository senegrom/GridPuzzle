from pathlib import Path

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import create_from_str_and_class, create_from_file, create_from_str
from gridsolver.grid_classes.killer_sudoku import KillerSudoku, SumCellPair
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce
from gridsolver.rules.unique import ElementsAtMostOnce, ElementsAtLeastOnce
from gridsolver.solver import solver

_TESTS_DIR = Path(__file__).resolve().parent


def test_sudo0():
    g = Sudoku(1, 1, 1, 1)
    sol = solver.solve(g, log_level=0)
    assert len(sol) == 1


def test_sudo1():
    g = Sudoku(2, 2, 2, 2)
    sol = solver.solve(g, log_level=0)
    assert len(sol) == 288


def test_sudo2():
    g = Sudoku(2, 2, 2, 2)
    g.load("12344321........")
    g2 = create_from_str_and_class("12344321........", Sudoku)
    g3 = create_from_str_and_class("12344321........", "Sudoku")
    g4 = create_from_str_and_class("1 2 3 4 4 3 2 1 . . .      . . . . .", "Sudoku", space_sep=True)
    g5 = create_from_str("Sudoku::12344321........")
    g6 = create_from_str("Sudoku::1 2 3 4 4 3 2 1 . . . . . . . .", space_sep=True)
    assert g == g2
    assert g == g3
    assert g == g4
    assert g == g5
    assert g == g6
    sol = solver.solve(g, log_level=0)
    sol2 = solver.solve(g2, log_level=0)
    sol3 = solver.solve(g3, log_level=0)
    sol4 = solver.solve(g4, log_level=0)
    sol5 = solver.solve(g5, log_level=0)
    sol6 = solver.solve(g6, log_level=0)
    assert len(sol) == 4
    assert sol == sol2
    assert sol == sol3
    assert sol == sol4
    assert sol == sol5
    assert sol == sol6


def test_sudo2_file():
    g = Sudoku(2, 2, 2, 2)
    g.load("12344321........")
    g2 = create_from_file(_TESTS_DIR / "test_data/sudoku2x2.pzl")
    g3 = create_from_file(_TESTS_DIR / "test_data/sudoku2x2b.pzl", space_sep=True)
    assert g == g2
    assert g == g3
    sol = solver.solve(g, log_level=0)
    sol2 = solver.solve(g2, log_level=0)
    sol3 = solver.solve(g3, log_level=0)
    assert len(sol) == 4
    assert sol == sol2
    assert sol == sol3


def test_sudo3():
    g = create_from_str_and_class("1234432131......", Sudoku)
    sol = solver.solve(g, log_level=0)
    assert len(sol) == 1


def test_sudo_none():
    g = create_from_str_and_class("123443212......3", Sudoku)
    sol = solver.solve(g, log_level=0)
    assert len(sol) == 0


def test_sudo_nonsq():
    g = Sudoku(3, 2, 2, 3)
    g.load("123456654321........................", row_wise=False)
    # The full solution count is 1408 (verified by independent brute force) but
    # enumerating them all is slow; the pre-fix broken box tiling admitted only
    # 16 solutions, so already reaching 20 proves the corrected tiling.
    sol = solver.solve(g, max_sols=20, log_level=0)
    assert len(sol) == 20


def test_sudo_nonsq_box_tiling():
    # boxes of 3 rows x 2 cols must partition the 6x6 grid
    g = Sudoku(3, 2, 2, 3)
    houses = [cells for cells in g.unique_rule_cells if len(cells) == 6]
    box_00 = frozenset(r + c * 6 for r in range(3) for c in range(2))
    assert box_00 in houses
    # every cell lies in exactly 3 size-6 houses: its row, column and box
    for cell in range(36):
        assert sum(1 for h in houses if cell in h) == 3


def test_rule45_innies_single_house():
    # two cages cover 3 cells of row 0 (4x4, house total 10) -> the leftover
    # cell's sum is forced in ONE pass (the old pairwise merging needed
    # several rounds to converge on this)
    from gridsolver.solver.rulehelpers import rulehelper_house_sums
    g = KillerSudoku(None, 2, 2, 2, 2)
    g.ext_sum_cells([(3, (0, 0, 0, 1)), (3, (0, 2,))])
    rulehelper_house_sums(g)
    idx = {(r, c): r + c * 4 for r in range(4) for c in range(4)}
    derived = {(frozenset(r.cells), r.sum) for r in g.get_rules_of_type(SumAndElementsAtMostOnce)}
    assert (frozenset({idx[0, 3]}), 4) in derived


def test_rule45_innies_row_band():
    # the vertical cage (0,0),(1,0) spans rows 0 and 1, so it is invisible to
    # single-house reasoning but participates in the two-row band: the leftover
    # (0,3),(1,3) must sum to 20 - 5 - 5 - 4 = 6 (it lies inside column 3, so
    # the at-most-once variant is emitted). Sums taken from the valid solution
    # 1234/3412/2143/4321.
    from gridsolver.solver.rulehelpers import rulehelper_house_sums
    g = KillerSudoku(None, 2, 2, 2, 2)
    g.ext_sum_cells([(5, (0, 1, 0, 2)), (5, (1, 1, 1, 2)), (4, (0, 0, 1, 0))])
    rulehelper_house_sums(g)
    idx = {(r, c): r + c * 4 for r in range(4) for c in range(4)}
    derived = {(frozenset(r.cells), r.sum) for r in g.get_rules_of_type(SumAndElementsAtMostOnce)}
    assert (frozenset({idx[0, 3], idx[1, 3]}), 6) in derived


def test_killer_cages_row_major():
    # the first line of the cage layout is the first ROW of the grid
    g = KillerSudoku(None, 2, 2, 2, 2)
    g.load_with_dic(
        """
        aabb
        ccdd
        eeff
        gghh
        """, {ch: 5 for ch in "abcdefgh"})
    cages = {frozenset(rule.cells) for rule in g.get_rules_of_type(SumAndElementsAtMostOnce)}
    idx = {(r, c): r + c * 4 for r in range(4) for c in range(4)}
    assert frozenset({idx[0, 0], idx[0, 1]}) in cages  # cage 'a' spans row 0
    assert frozenset({idx[1, 2], idx[1, 3]}) in cages  # cage 'd' spans row 1


def test_row_unique_col_min():
    g = Grid(rows=10, cols=5, max_elem=7)
    g.ext_rules(ElementsAtMostOnce, None, g.row_rule_applicators)
    g.ext_rules(ElementsAtLeastOnce, None, g.col_rule_applicators)
    g.load("""
    1324.
    2134.
    32145
    42315
    24153
    13462
    24371
    ...2.
    .5.31
    ...4.
    """, row_wise=True)
    sol = solver.solve(g, log_level=0)
    assert len(sol) == 24


def test_sudo_mith():
    g = create_from_str_and_class("...13.....1...45....2....6.1..3...7.2...5...8.4...6..9.5....7....67...9.....89...",
                                  Sudoku)
    sol = solver.solve(g, log_level=0)
    assert len(sol) == 1


def test_sudo_xy_wing():
    import helpers
    g = create_from_str_and_class("6...27......9..1.2.47.......3..1.4..9..4.6.2...8..3......5....3.65.79........1...",
                                  Sudoku)
    sol = solver.solve(g, max_sols=2, log_level=helpers.VERB)
    assert len(sol) == 1


def test_eq_killer_sudoku1():
    g = create_from_str(
        """
        KillerSudoku::
        a
        :
        a1
        """)

    g2 = KillerSudoku(None, 1, 1, 1, 1)
    g2.load_with_dic(
        """
        a
        """, {"a": 1})

    g3 = create_from_str(
        """KillerSudoku::a : a1""", space_sep=True)

    g4 = KillerSudoku(None, 1, 1, 1, 1)
    g4.ext_sum_cells([SumCellPair(1, [0, 0])])

    assert g == g2
    assert g == g3
    assert g == g4


def test_eq_killer_sudoku2():
    g = create_from_str(
        """
        KillerSudoku::
        aaabbbccc
        defffgghi
        dejkkklhi
        dejjkllhi
        mennnoohp
        mqrrsttup
        mqqrstuup
        vvvwwwxxx
        yyywwwzzz
        :
        a6b24c15d12e24f19g3h20i6j15k16l23m23n17o10p18q22r9s4t18u11v12w33x18y10z17
        """)

    g_x = create_from_str(
        """
        KillerSudoku::
        aaabbbccc
        defffgghi
        dejkkklhi
        dejjkllhi
        mennnoohp
        mqrrsttup
        mqqrstuup
        vvvwwwxxx
        yyywwwzzz
        :
        a7b24c15d12e24f19g3h20i6j15k16l23m23n17o10p18q22r9s4t18u11v12w33x18y10z17
        """)

    g2 = KillerSudoku()
    g2.load_with_dic(
        """
        aaabbbccc
        defffgghi
        dejkkklhi
        dejjkllhi
        mennnoohp
        mqrrsttup
        mqqrstuup
        vvvwwwxxx
        yyywwwzzz
        """, {"a": 6, "b": 24, "c": 15, "d": 12, "e": 24, "f": 19, "g": 3, "h": 20,
              "i": 6, "j": 15, "k": 16, "l": 23, "m": 23, "n": 17, "o": 10, "p": 18, "q": 22, "r": 9,
              "s": 4, "t": 18, "u": 11, "v": 12, "w": 33, "x": 18, "y": 10, "z": 17})

    g3 = create_from_str(
        """
        KillerSudoku::
        a a a b b b c c c
        d e f f f g g h i
        d e j k k k l h i
        d e j j k l l h    i
        m e n n n o o h p
        m q r r s t t u p
        m q q r s t u u p
        v v v w w w x x x
        y y y w w w z z z
        :
        a6b24c15d12e24f19g3h20i6j15k16l23m23n17o10p18q22r9s4t18u11v12w33x18y10z17
        """, space_sep=True)

    assert g != g_x
    assert g == g2
    assert g == g3


def test_eq_futoshiki():
    pass  # todo


def test_fish_value_memo_invalidation():
    # the per-value memo must re-run a value when its guarantees change:
    # first call fires the rows-0/3 x-wing (and records the state); adding a
    # row-1 guarantee afterwards must trigger re-evaluation and the new
    # eliminations in row 1
    from gridsolver.grid_classes.latins_square import LatinSquare
    from gridsolver.rules.rules import Guarantee
    from gridsolver.solver.solve_fish import fish
    idx = {(r, col): r + col * 5 for r in range(5) for col in range(5)}
    g = LatinSquare(5)
    g.add_gtee_checked(Guarantee(val=1, cells=frozenset({idx[0, 0], idx[0, 4]}), rows=5, cols=5))
    g.add_gtee_checked(Guarantee(val=1, cells=frozenset({idx[3, 0], idx[3, 4]}), rows=5, cols=5))
    fish(g, 2)
    assert 1 not in g.get_candidates((0, 2))
    assert 1 in g.get_candidates((1, 2))
    g.add_gtee_checked(Guarantee(val=1, cells=frozenset({idx[1, 0], idx[1, 4]}), rows=5, cols=5))
    fish(g, 2)
    assert 1 not in g.get_candidates((1, 2))


def test_empty_rectangle():
    # value 1 in box 0 confined to row 1 + column 1 (the ER cross); conjugate
    # pair (1,4)-(7,4) in column 4 has one end in row 1 -> 1 eliminated from
    # (7,1), which sees the other end; (5,1) does not and keeps its candidate
    from gridsolver.rules.rules import Guarantee
    from gridsolver.solver.solve_empty_rectangle import empty_rectangle
    g = Sudoku()
    for r, col in ((0, 0), (0, 2), (2, 0), (2, 2)):
        g.get_candidates((r, col)).discard(1)
    idx = {(r, col): r + col * 9 for r in range(9) for col in range(9)}
    cross = frozenset(idx[rc] for rc in ((1, 0), (1, 1), (1, 2), (0, 1), (2, 1)))
    g.add_gtee_checked(Guarantee(val=1, cells=cross, rows=9, cols=9))
    g.add_gtee_checked(Guarantee(val=1, cells=frozenset({idx[1, 4], idx[7, 4]}), rows=9, cols=9))
    empty_rectangle(g)
    assert 1 not in g.get_candidates((7, 1))
    assert 1 in g.get_candidates((5, 1))


def test_als_xy_wing_degenerate_xy_wing():
    # three single-cell ALSs reduce ALS-XY-Wing to the classic XY-Wing:
    # hinge (0,0){1,2}, A=(0,4){1,3} (RC X=1 via row 0), B=(4,0){2,3}
    # (RC Y=2 via col 0) -> Z=3 eliminated from (4,4), which sees both
    from gridsolver.solver.solve_als import als_xy_wing
    g = Sudoku()
    g.get_candidates((0, 0)).intersection_update({1, 2})
    g.get_candidates((0, 4)).intersection_update({1, 3})
    g.get_candidates((4, 0)).intersection_update({2, 3})
    als_xy_wing(g)
    assert 3 not in g.get_candidates((4, 4))
    assert 3 in g.get_candidates((8, 8))


def test_ineq_bounds_chain():
    # a < b < c < d forces d >= 4 and a <= 2 in a single pass
    from gridsolver.grid_classes.futoshiki import Futoshiki
    from gridsolver.solver.solve_ineq_bounds import ineq_bounds
    g = Futoshiki(5)
    g.ext_ineqs([((0, 0), (0, 1)), ((0, 1), (0, 2)), ((0, 2), (0, 3))])
    ineq_bounds(g)
    idx = {(r, c): r + c * 5 for r in range(5) for c in range(5)}
    assert g.get_candidates(idx[0, 3]) == {4, 5}
    assert g.get_candidates(idx[0, 0]) == {1, 2}


def test_ineq_bounds_distinct():
    # (0,1) is greater than BOTH (0,0) and (0,2); they share row 0 and are
    # therefore distinct, so (0,1) >= 3 — unreachable for iterated pairwise
    # bounds, which only ever see one edge at a time
    from gridsolver.grid_classes.futoshiki import Futoshiki
    from gridsolver.solver.solve_ineq_bounds import ineq_bounds
    g = Futoshiki(5)
    g.ext_ineqs([((0, 0), (0, 1)), ((0, 2), (0, 1))])
    ineq_bounds(g)
    idx = {(r, c): r + c * 5 for r in range(5) for c in range(5)}
    assert g.get_candidates(idx[0, 1]) == {3, 4, 5}
