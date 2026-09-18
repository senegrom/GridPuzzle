Sudoku::
#(CLIPS-solve "grid3x3-p17")
#
#The puzzle is:
#
#* * 1  2 * *  * 8 *
#* 8 *  * 6 *  * 9 *
#6 * *  * * *  1 * 4
#
#* * *  * 9 *  2 * 8
#* * *  6 * 5  * * *
#9 * 7  * 2 *  * * *
#
#2 * 4  * * *  * * 9
#* 7 *  * 5 *  * 6 *
#* 9 *  * * 1  3 * *
#
#The solution is:
#
#4 5 1  2 3 9  7 8 6
#7 8 3  1 6 4  5 9 2
#6 2 9  5 8 7  1 3 4
#
#1 6 5  7 9 3  2 4 8
#8 4 2  6 1 5  9 7 3
#9 3 7  4 2 8  6 1 5
#
#2 1 4  3 7 6  8 5 9
#3 7 8  9 5 2  4 6 1
#5 9 6  8 4 1  3 2 7
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
#Swordfish
#Forced Chain Convergence
#Forced Chain XY
#
#CLIPS time = 0.200716972351074
#
#
#
#(solve "..12...8..8..6..9.6.....1.4....9.2.8...6.5...9.7.2....2.4.....9.7..5..6..9...13..")
#***********************************************************************************************
#***  SudoRules 20.1.s based on CSP-Rules 2.1.s, config = W+SFin
#***  Using CLIPS 6.32-r768
#***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
#***********************************************************************************************
..12...8..8..6..9.6.....1.4....9.2.8...6.5...9.7.2....2.4.....9.7..5..6..9...13..
