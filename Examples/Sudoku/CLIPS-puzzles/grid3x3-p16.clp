Sudoku::
#(CLIPS-solve "grid3x3-p16")
#
#The puzzle is:
#
#2 * *  * * *  * 3 *
#* 8 *  * 3 *  7 * *
#* 7 *  * 9 4  5 * *
#
#1 * *  * * 7  * 8 6
#* * 5  * * *  9 * *
#8 2 *  3 * *  * * 1
#
#* * 2  5 1 *  * 4 *
#* * 6  * 8 *  * 2 *
#* 1 *  * * *  * * 5
#
#The solution is:
#
#2 5 4  6 7 1  8 3 9
#9 8 1  2 3 5  7 6 4
#6 7 3  8 9 4  5 1 2
#
#1 3 9  4 5 7  2 8 6
#4 6 5  1 2 8  9 7 3
#8 2 7  3 6 9  4 5 1
#
#7 9 2  5 1 6  3 4 8
#5 4 6  9 8 3  1 2 7
#3 1 8  7 4 2  6 9 5
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
#
#(solve "grid3x3-p16")
#CLIPS time = 0.154361009597778
#
#
#(solve "2......3..8..3.7...7..945..1....7.86..5...9..82.3....1..251..4...6.8..2..1......5")
#
#***********************************************************************************************
#***  SudoRules 20.1.s based on CSP-Rules 2.1.s, config = W+SFin
#***  Using CLIPS 6.32-r768
#***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
#***********************************************************************************************
2......3..8..3.7...7..945..1....7.86..5...9..82.3....1..251..4...6.8..2..1......5
