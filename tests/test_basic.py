from gridsolver.abstract_grids.grid_loading import create_from_str_and_class, create_from_file, create_from_str
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver


def test_sudo0():
    g = Sudoku(1, 1, 1, 1)
    sol = solver.solve(g, log_level=-1)
    assert len(sol) == 1


def test_sudo1():
    g = Sudoku(2, 2, 2, 2)
    sol = solver.solve(g, log_level=-1)
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
    sol = solver.solve(g, log_level=-1)
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
    g2 = create_from_file("./test_data/sudoku2x2.pzl")
    g3 = create_from_file("./test_data/sudoku2x2b.pzl", space_sep=True)
    assert g == g2
    assert g == g3
    sol = solver.solve(g, log_level=-1)
    sol2 = solver.solve(g2, log_level=0)
    sol3 = solver.solve(g3, log_level=0)
    assert len(sol) == 4
    assert sol == sol2
    assert sol == sol3


def test_sudo3():
    g = create_from_str_and_class("1234432131......", Sudoku)
    sol = solver.solve(g, log_level=-1)
    assert len(sol) == 1


def test_sudo_none():
    g = create_from_str_and_class("123443212......3", Sudoku)
    sol = solver.solve(g, log_level=-1)
    assert len(sol) == 0


def test_sudo_nonsq():
    g = Sudoku(2, 3, 3, 2)
    g.load("123456654321........................", row_wise=False)
    sol = solver.solve(g, log_level=-1)
    assert len(sol) == 16


def test_sudo_mith():
    g = create_from_str_and_class(
        "...13.....1...45....2....6.1..3...7.2...5...8.4...6..9.5....7....67...9.....89...",
        Sudoku
    )
    sol = solver.solve(g, log_level=-1)
    assert len(sol) == 1


def test_sudo_m10():
    g = Sudoku()
    sol = solver.solve(g, max_sols=10, log_level=-1)
    assert len(sol) == 10


def test_sudo_big_m10():
    g = Sudoku(4, 4, 4, 4)
    # sol = solver.solve(g, max_sols=2, print_info=2)
    # assert len(sol) == 2


def test_sudo_big2_m10():
    g = Sudoku(5, 5, 5, 5)
    ##sol = solver.solve(g, max_sols=1, print_info=-1)
    # assert len(sol) == 10


def test_eq_killer_sudoku():
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
    pass
