Sudoku::
#SER = 7.1
#
#(CLIPS-solve-string  3 "1..4.6..945.....23..........1....8..3...........8.2.545....864..3...4.1.9...7...8")
#
#The puzzle is:
#
#1 * *  4 * 6  * * 9
#4 5 *  * * *  * 2 3
#* * *  * * *  * * *
#
#* 1 *  * * *  8 * *
#3 * *  * * *  * * *
#* * *  8 * 2  * 5 4
#
#5 * *  * * 8  6 4 *
#* 3 *  * * 4  * 1 *
#9 * *  * 7 *  * * 8
#
#The solution is:
#
#1 2 3  4 5 6  7 8 9
#4 5 6  7 8 9  1 2 3
#7 8 9  1 2 3  4 6 5
#
#2 1 5  3 4 7  8 9 6
#3 4 8  6 9 5  2 7 1
#6 9 7  8 1 2  3 5 4
#
#5 7 1  9 3 8  6 4 2
#8 3 2  5 6 4  9 1 7
#9 6 4  2 7 1  5 3 8
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
#Forced Chain Convergence
#
#CLIPS time: init = 0.00129604339599609; solve = 0.255929946899414; total = 0.25722599029541
#
#
#
#
#
#
#(solve "1..4.6..945.....23..........1....8..3...........8.2.545....864..3...4.1.9...7...8")
#***********************************************************************************************
#***  SudoRules 20.1.s based on CSP-Rules 2.1.s, config = W+SFin
#***  Using CLIPS 6.32-r790
#***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.7
#***  Download from: https://github.com/denis-berthier/CSP-Rules-V2.1
#***********************************************************************************************
1..4.6..945.....23..........1....8..3...........8.2.545....864..3...4.1.9...7...8
