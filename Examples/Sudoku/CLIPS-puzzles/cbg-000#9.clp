Sudoku::
#SER = 8.3
#
#
#(CLIPS-solve-string  3 ".2.4..7......891.........65..48.....3..9....1.95..1.7..7.3...1263.........2.1...8")
#
#The puzzle is:
#
#* 2 *  4 * *  7 * *
#* * *  * 8 9  1 * *
#* * *  * * *  * 6 5
#
#* * 4  8 * *  * * *
#3 * *  9 * *  * * 1
#* 9 5  * * 1  * 7 *
#
#* 7 *  3 * *  * 1 2
#6 3 *  * * *  * * *
#* * 2  * 1 *  * * 8
#
#The solution is:
#
#1 2 *  4 * *  7 8 *
#* * *  * 8 9  1 * *
#* * *  1 * *  * 6 5
#
#* 1 4  8 * *  * * *
#3 * *  9 * *  * * 1
#* 9 5  * * 1  * 7 *
#
#* 7 *  3 * *  * 1 2
#6 3 1  * * 8  * * 7
#* * 2  * 1 *  * * 8
#
#Rules used:
#
#Naked Single
#Hidden Single
#Locked Candidate Single Line
#Locked Candidate Multiple Lines
#Multi Color Type 1
#
#CLIPS time: init = 0.00115704536437988; solve = 0.111250162124634; total = 0.112407207489014
#
#Very fast, but the solution is not found.
#
#
#
#
#
#
#(solve ".2.4..7......891.........65..48.....3..9....1.95..1.7..7.3...1263.........2.1...8")
#***********************************************************************************************
#***  SudoRules 20.1.s based on CSP-Rules 2.1.s, config = W+SFin
#***  Using CLIPS 6.32-r790
#***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.7
#***  Download from: https://github.com/denis-berthier/CSP-Rules-V2.1
#***********************************************************************************************
.2.4..7......891.........65..48.....3..9....1.95..1.7..7.3...1263.........2.1...8
