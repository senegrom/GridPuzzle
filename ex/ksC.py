from grid_classes import killer_sudoku

g = killer_sudoku.KillerSudoku()

g.ext_sum_cells_from_str(
    """
    aaabcccdd
    efgbchhhd
    efgbijjjk
    efgiijllk
    mnooopplk
    mnnqrrstu
    mqqqrvstu
    wxxxyvstu
    wwyyyvzzz
    """, {"a": 8, "b": 11, "c": 20, "d": 18, "e": 18, "f": 21, "g": 11, "h": 10,
          "i": 16, "j": 29, "k": 6, "l": 22, "m": 15, "n": 22, "o": 17, "p": 9, "q": 14, "r": 13,
          "s": 7, "t": 15, "u": 18, "v": 16, "w": 16, "x": 14, "y": 20, "z": 19})
