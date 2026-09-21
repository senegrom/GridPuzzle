Sudoku::
#(CLIPS-solve "grid3x3-p18")
#
#The puzzle is:
#
#* * 4  * 6 2  8 * *
#* 8 *  * 1 *  6 2 *
#* * *  4 * *  * * *
#
#3 * *  * * *  2 * *
#9 7 *  * * *  * 3 8
#* * 1  * * *  * * 7
#
#* * *  * * 7  * * *
#* 2 3  * 9 *  * 8 *
#* * 6  2 3 *  1 * *
#
#The solution is:
#
#1 3 4  7 6 2  8 5 9
#5 8 7  3 1 9  6 2 4
#2 6 9  4 5 8  7 1 3
#
#3 4 8  9 7 5  2 6 1
#9 7 2  1 4 6  5 3 8
#6 5 1  8 2 3  9 4 7
#
#4 1 5  6 8 7  3 9 2
#7 2 3  5 9 1  4 8 6
#8 9 6  2 3 4  1 7 5
#
#Rules used:
#
#Naked Single
#Hidden Single
#Locked Candidate Single Line
#Locked Candidate Multiple Lines
#Naked Pairs
#Hidden Pairs
#Naked Triples
#Hidden Triples
#Swordfish
#Color Conjugate Pairs
#Multi Color Type 2
#Forced Chain Convergence
#Forced Chain XY
#Unique Rectangle
#
#CLIPS time = 0.282570123672485
#
#
#
#
#
#Indeed, no rule of uniqueness is needed:
#
#(solve "..4.628...8..1.62....4.....3.....2..97.....38..1.....7.....7....23.9..8...623.1..")
#***********************************************************************************************
#***  SudoRules 20.1.s based on CSP-Rules 2.1.s, config = W+SFin
#***  Using CLIPS 6.32-r768
#***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
#***********************************************************************************************
..4.628...8..1.62....4.....3.....2..97.....38..1.....7.....7....23.9..8...623.1..
