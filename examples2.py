from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import create_from_str_and_class
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.uneq import UneqRule, DiffGe2Rule


def get_example(args) -> Grid:
    if args.example == "s":
        g = create_from_str_and_class("..29.6......1.83...96.7....9...5....2....9.31.1..8.5....8...........57.....7...2.", Sudoku)
        print(g)

    elif args.example == "t":
        g = Sudoku()
        g.load(
            [[8, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 3, 6, 0, 0, 0, 0, 0], [0, 7, 0, 0, 9, 0, 2, 0, 0],
             [0, 5, 0, 0, 0, 7, 0, 0, 0],
             [0, 0, 0, 0, 4, 5, 7, 0, 0], [0, 0, 0, 1, 0, 0, 0, 3, 0], [0, 0, 1, 0, 0, 0, 0, 6, 8],
             [0, 0, 8, 5, 0, 0, 0, 1, 0],
             [0, 9, 0, 0, 0, 0, 4, 0, 0]], row_wise=True)
        print(g)

    elif args.example == "f":
        n = 5
        g = Futoshiki(n)
        g.ext_ineqs([((1, 0), (1, 1)), ((2, 3), (3, 3)), ((4, 4), (3, 4)), ((3, 4), (3, 3)), ((2, 2), (3, 2)),
                     ((4, 3), (4, 4))])

        g[0, 0] = 1
        g[0, 1] = 2
        g[0, 2] = 3
        g[0, 3] = 4
        #
        g[1, 0] = 3
        g[4, 0] = 4

        print(g)

    elif args.example == "b":
        g = KillerSudoku()
        g.ext_sum_cells([
            (22, (0, 0, 0, 1, 1, 1, 1, 2)),
            (10, (1, 0, 2, 0, 3, 0)),
            (5, (4, 0, 4, 1)),
            (17, (5, 0, 6, 0, 7, 0)),
            (29, (2, 1, 3, 1, 3, 2, 3, 3)),
            (14, (5, 1, 5, 2)),
            (24, (6, 1, 6, 2, 6, 3, 6, 4)),
            (14, (7, 1, 8, 1, 8, 0)),
            (23, (0, 2, 0, 3, 0, 4, 1, 4)),
            (28, (4, 2, 4, 3, 4, 4, 4, 5, 4, 6)),
            (5, (7, 2, 8, 2)),
            (13, (1, 3, 2, 3, 2, 2)),
            (10, (5, 3, 5, 4)),
            (5, (7, 3, 8, 3)),
            (26, (2, 4, 2, 5, 2, 6, 2, 7)),
            (7, (3, 4, 3, 5)),
            (20, (7, 4, 8, 4, 8, 5, 8, 6)),
            (11, (0, 5, 1, 5)),
            (19, (5, 5, 5, 6, 5, 7, 6, 7)),
            (11, (6, 5, 7, 5, 6, 6)),
            (10, (0, 6, 1, 6)),
            (6, (3, 6, 3, 7)),
            (29, (7, 6, 7, 7, 8, 7, 8, 8)),
            (14, (0, 7, 0, 8, 1, 7)),
            (12, (4, 7, 4, 8)),
            (9, (1, 8, 2, 8, 3, 8)),
            (12, (5, 8, 6, 8, 7, 8))
        ])

    elif args.example == "a":
        g = KillerSudoku()

        g.ext_sum_cells([
            (29, (0, 0, 1, 0, 0, 1, 1, 1)),
            (16, (0, 2, 1, 2, 2, 2, 2, 1, 2, 0)),
            (15, (0, 3, 0, 4, 0, 5)),
            (10, (0, 6, 0, 7, 0, 8)),
            (17, (1, 3, 1, 4)),
            (9, (1, 5, 1, 6, 1, 7)),
            (11, (1, 8, 2, 8)),
            (8, (2, 3, 2, 4)),
            (4, (2, 5, 3, 5)),
            (23, (2, 6, 2, 7, 3, 7)),
            (7, (3, 0, 4, 0, 5, 0)),
            (11, (3, 1, 4, 1)),
            (14, (3, 2, 4, 2)),
            (21, (3, 3, 3, 4, 4, 3, 4, 4)),
            (8, (3, 6, 4, 6, 4, 7)),
            (16, (3, 8, 4, 8)),
            (26, (4, 5, 5, 5, 5, 4, 5, 6, 6, 5)),
            (17, (5, 1, 6, 1, 7, 1)),
            (16, (5, 2, 5, 3)),
            (12, (5, 7, 5, 8)),
            (17, (6, 0, 7, 0, 8, 0)),
            (13, (6, 2, 7, 2, 7, 3)),
            (7, (6, 3, 6, 4, 7, 4)),
            (16, (6, 6, 7, 6, 8, 6)),
            (13, (6, 7, 6, 8)),
            (14, (7, 5, 8, 5)),
            (11, (7, 7, 8, 7)),
            (5, (7, 8, 8, 8)),
            (9, (8, 1, 8, 2)),
            (10, (8, 3, 8, 4)),
        ])

    elif args.example == "c":
        g = KillerSudoku()

        g.load(
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
            :
            a6b24c15d12e24f19g3h20i6j15k16l23m23n17o10p18q22r9s4t18u11v12w33x18y10z17
            """)

    elif args.example == "d":
        g = KillerSudoku()

        g.load_with_dic(
            """
            aabbccdde
            afbgchhde
            ifjgkkhle
            ifjjkmmln
            oppqqmrln
            oosqturvn
            wwsttuxvv
            wwyyyyxvv
            zzzzy0011
            """, {"a": 15, "b": 19, "c": 16, "d": 8, "e": 19, "f": 15, "g": 4, "h": 18,
                  "i": 7, "j": 16, "k": 16, "l": 12, "m": 17, "n": 17, "o": 17, "p": 10, "q": 20, "r": 7,
                  "s": 6, "t": 9, "u": 7, "v": 26, "w": 23, "x": 12, "y": 26, "z": 21, "0": 12, "1": 10})

    elif args.example == "m":
        n = 9
        g = Sudoku()
        g[4, 2] = 1
        g[5, 6] = 2
        g.ext_rules(UneqRule, [{"origin_cell": (r, c),
                                "rel_cells": [(r - 1, c - 1), (r, c - 1), (r + 1, c - 1), (r - 1, c),
                                              (r + 1, c), (r - 1, c + 1), (r, c + 1), (r + 1, c + 1),
                                              (r - 2, c - 1), (r - 2, c + 1), (r + 2, c - 1), (r + 2, c + 1),
                                              (r - 1, c - 2), (r - 1, c + 2), (r + 1, c - 2), (r + 1, c + 2)]} for r in
                               range(n) for c in range(n)], None)
        g.ext_rules(DiffGe2Rule, [{"origin_cell": (r, c),
                                   "rel_cells": [(r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)]} for r in
                                  range(n) for c in range(n)], None)

    else:
        raise ValueError("Example choice not supported: " + str(args.example))

    return g
