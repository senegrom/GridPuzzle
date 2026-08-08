from gridsolver.grid_classes.killer_sudoku import KillerSudoku

g = KillerSudoku()

g.load_with_dic(
    """
    aaabcccdd
    efbbgghii
    efjkkhhlm
    ejjnnhllm
    oopqnhlmm
    oppqnnrrs
    opqqttrus
    vvqwwxxus
    yyzzzx000
    """, {"a": 15, "b": 12, "c": 19, "d": 7, "e": 14, "f": 7, "g": 3, "h": 25,
          "i": 17, "j": 15, "k": 9, "l": 16, "m": 24, "n": 34, "o": 25, "p": 17, "q": 22, "r": 18,
          "s": 6, "t": 10, "u": 11, "v": 16, "w": 8, "x": 14, "y": 4, "z": 21, "0": 16})
