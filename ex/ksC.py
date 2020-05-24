from grid_classes import killer_sudoku

g = killer_sudoku.KillerSudoku()

g.ext_sum_cells_from_str(
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
