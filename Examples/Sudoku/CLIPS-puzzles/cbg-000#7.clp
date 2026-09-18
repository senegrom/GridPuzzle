Sudoku::
#SER = 7.2
#
#
#(CLIPS-solve-string  3 "..345..8.4.6.........1...65.1.5.8.7....3...919...........8.....6....7.3...1.3..57")
#
#
#The puzzle is:
#
#* * 3  4 5 *  * 8 *
#4 * 6  * * *  * * *
#* * *  1 * *  * 6 5
#
#* 1 *  5 * 8  * 7 *
#* * *  3 * *  * 9 1
#9 * *  * * *  * * *
#
#* * *  8 * *  * * *
#6 * *  * * 7  * 3 *
#* * 1  * 3 *  * 5 7
#
#The solution is:
#
#1 * 3  4 5 6  * 8 *
#4 5 6  * 8 *  * * *
#* * *  1 * 3  4 6 5
#
#* 1 *  5 9 8  * 7 *
#5 * *  3 * *  * 9 1
#9 * *  * * 1  5 * *
#
#* * *  8 * 5  * * *
#6 * 5  * * 7  * 3 *
#* * 1  * 3 *  * 5 7
#
#Rules used:
#
#Naked Single
#Hidden Single
#Locked Candidate Single Line
#Locked Candidate Multiple Lines
#Multi Color Type 2
#
#CLIPS time: init = 0.00142002105712891; solve = 0.126689910888672; total = 0.128109931945801
#
#Very fast, but the solution is not found.
#
#
#
#
#
#
#(solve "..345..8.4.6.........1...65.1.5.8.7....3...919...........8.....6....7.3...1.3..57")
#***********************************************************************************************
#***  SudoRules 20.1.s based on CSP-Rules 2.1.s, config = W+SFin
#***  Using CLIPS 6.32-r790
#***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.7
#***  Download from: https://github.com/denis-berthier/CSP-Rules-V2.1
#***********************************************************************************************
..345..8.4.6.........1...65.1.5.8.7....3...919...........8.....6....7.3...1.3..57
