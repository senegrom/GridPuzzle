Sudoku::
#
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#;;;
#;;;                              CSP-RULES / SUDORULES
#;;;                              RESOLUTION PATHS FOR THE MAGICTOUR TOP 1465 COLLECTION
#;;;
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#
#
#
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#;;;                                                    ;;;
#;;;              copyright Denis Berthier              ;;;
#;;;     https://denis-berthier.pagesperso-orange.fr    ;;;
#;;;            January 2006 - August 2020              ;;;
#;;;                                                    ;;;
#;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
#
#
#
#; -*- clips -*-
#
#
#
#
#
#
#
##2 SER= 9.5
#
#This is one of the hardest Sudoku puzzles solvable by the chain rules of CSP-Rules.
#Check the extra long resolution time at the end (partly because it has to run on virtual memory).
#
#This is an example with many partial-whips, with only very few of them giving eliminations
#
##2 is one of the 3 puzzles (# 2, SER 9.5 - #3, SER 9.6 - #77, SER 9.8) in the top1465 collection that cannot be solved by whips.
#Indeed, it is not in T&E = T&E(BRT), i.e. it is not even solvable by braids.
#But it is in gT&E = T&E(W1), i.e. it is solvable by g-braids.
#Indeed, it is solvable by g-whips:
#
#(solve "7.8...3.....2.1...5.........4.....263...8.......1...9..9.6....4....7.5...........")
#
#***********************************************************************************************
#***  SudoRules 20.1.s based on CSP-Rules 2.1.s, config = gW+SFin
#***  Using CLIPS 6.32-r768
#***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
#***********************************************************************************************

7.8...3.....6.1...5.........4.....263...8.......1...9..9.2....4....7.5...........
