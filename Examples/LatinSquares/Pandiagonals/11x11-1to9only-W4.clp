
Puzzle generated by "1to9only":

. 8 . 3 . . . . . . 2
. . . . . . . . . . .
. . 9 . . . . . . . .
. 1 . . . . . . B . .
. . . . . . . . 3 . .
. . . . . . . . . . .
4 . . . . . . . . . .
. . . . . . . . . . .
. . . . . A . 7 . . .
. . . . . 5 . . . . .
. . . . . . 2 . . . .


.8.3......2.............9.........1......B..........3.............4..........................A.7........5...........2....  12 ED=8.1/2.9/2.9

(solve ".8.3......2.............9.........1......B..........3.............4..........................A.7........5...........2....  12 ED=8.1/2.9/2.9")
***********************************************************************************************
***  LatinRules 2.1.s based on CSP-Rules 2.1.s, config = W
***  Using CLIPS 6.32-r801
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.7
***  Download from: https://github.com/denis-berthier/CSP-Rules-V2.1
***********************************************************************************************
.8.3......2.............9.........1......B..........3.............4..........................A.7........5...........2....  12 ED=8.1/2.9/2.9
12 givens, 774 candidates
entering BRT
Starting_init_links_with_<Fact-8232>
Resolution state after Singles:
1567A      8          14567B     3          456AB      1679       15679AB    1469AB     145679     45679AB    2
1569AB     234567B    12467AB    24568AB    1456789AB  126789B    1356789A   12345689AB 146789A    13456789B  3456789A
235678B    46AB       9          14567AB    1235678AB  124678B    145678AB   123568A    145678A    134678A    14567B
26789      1          34568A     25678A     2345679A   2346789    456789A    45689A     B          245679A    346789
68AB       45679B     25678AB    145689AB   1245678AB  124679B    1456789AB  1245689A   3          1256789    146789AB
1356789AB  3679AB     12345678B  2456789AB  1345689AB  134678B    1345679A   124569AB   12456789   1246789AB  3568A
4          235679AB   13678AB    1256789B   356789AB   13689      1567AB     123569B    126789A    2568AB     156789AB
1256789AB  235679A    12345678AB 146789AB   123456789  24679B     1345689B   12468AB    2456A      13456789AB 156789AB
125689B    24569B     13568      1245689    1469B      A          4689B      7          14568      123569B    1345689B
1236789AB  4679AB     124678A    12679A     12346789B  5          3468B      34689AB    1689A      1234678AB  134679AB
135679AB   345679A    14567AB    1456789B   16789A     3468B      2          135689B    456789A    1345689AB  1345678AB

774 candidates, 12380 csp-links and 12380 links. Density = 4.14%
Starting non trivial part of solution.
Entering_level_W1_with_<Fact-57755>
whip[1]: c9n2{r7 .} ==> r7c10 ≠ 2, r7c8 ≠ 2
whip[1]: d5n2{r8c9 .} ==> r7c9 ≠ 2, r2c3 ≠ 2
whip[1]: d4n2{r8c8 .} ==> r8c1 ≠ 2
whip[1]: r7n2{c4 .} ==> r9c4 ≠ 2, r6c3 ≠ 2, r8c3 ≠ 2, r9c2 ≠ 2
whip[1]: c2n2{r8 .} ==> r2c8 ≠ 2
whip[1]: a7n2{r10c5 .} ==> r4c5 ≠ 2, r10c10 ≠ 2
whip[1]: r2n2{c6 .} ==> r4c4 ≠ 2
whip[1]: a1n2{r8c8 .} ==> r8c2 ≠ 2
whip[1]: c2n2{r7 .} ==> r10c5 ≠ 2
whip[1]: c3n2{r10 .} ==> r2c6 ≠ 2, r5c8 ≠ 2
whip[1]: a4n2{r9c1 .} ==> r3c1 ≠ 2
whip[1]: c1n2{r10 .} ==> r4c6 ≠ 2
whip[1]: r4n2{c10 .} ==> r6c10 ≠ 2
hidden-single-in-an-anti-diagonal ==> r10c3 = 2
whip[1]: a10n2{r8c6 .} ==> r6c8 ≠ 2
whip[1]: r6n2{c9 .} ==> r9c1 ≠ 2
hidden-single-in-a-column ==> r4c1 = 2
hidden-single-in-an-anti-diagonal ==> r7c2 = 2
hidden-single-in-an-anti-diagonal ==> r5c5 = 2
hidden-single-in-an-anti-diagonal ==> r2c4 = 2
hidden-single-in-an-anti-diagonal ==> r9c10 = 2
hidden-single-in-a-column ==> r6c9 = 2
hidden-single-in-a-row ==> r8c6 = 2
hidden-single-in-a-row ==> r3c8 = 2
whip[1]: r9n3{c11 .} ==> r6c11 ≠ 3, r2c7 ≠ 3, r6c3 ≠ 3
whip[1]: d8n3{r10c10 .} ==> r10c11 ≠ 3
whip[1]: c7n3{r10 .} ==> r8c5 ≠ 3
whip[1]: a6n3{r9c3 .} ==> r7c3 ≠ 3, r8c3 ≠ 3
whip[1]: r8n3{c10 .} ==> r11c10 ≠ 3
whip[1]: d5n3{r11c6 .} ==> r10c5 ≠ 3, r11c8 ≠ 3
whip[1]: d7n3{r6c2 .} ==> r3c10 ≠ 3, r11c2 ≠ 3, r6c5 ≠ 3
whip[1]: d10n3{r11c11 .} ==> r9c11 ≠ 3, r10c10 ≠ 3, r11c1 ≠ 3
hidden-single-in-a-diagonal ==> r4c5 = 3
hidden-single-in-a-diagonal ==> r6c2 = 3
hidden-single-in-an-anti-diagonal ==> r11c11 = 3
hidden-single-in-a-diagonal ==> r7c6 = 3
hidden-single-in-a-diagonal ==> r3c1 = 3
hidden-single-in-a-diagonal ==> r8c10 = 3
hidden-single-in-an-anti-diagonal ==> r10c7 = 3
hidden-single-in-a-diagonal ==> r9c3 = 3
hidden-single-in-a-row ==> r2c8 = 3

Resolution state after Singles and whips[1]:
1567A     8         14567B    3         456AB     1679      15679AB   1469AB    145679    45679AB   2
1569AB    4567B     1467AB    2         1456789AB 16789B    156789A   3         146789A   1456789B  456789A
3         46AB      9         14567AB   15678AB   14678B    145678AB  2         145678A   14678A    14567B
2         1         4568A     5678A     3         46789     456789A   45689A    B         45679A    46789
68AB      45679B    5678AB    145689AB  2         14679B    1456789AB 145689A   3         156789    146789AB
156789AB  3         145678B   456789AB  145689AB  14678B    145679A   14569AB   2         146789AB  568A
4         2         1678AB    156789B   56789AB   3         1567AB    1569B     16789A    568AB     156789AB
156789AB  5679A     145678AB  146789AB  1456789   2         145689B   1468AB    456A      3         156789AB
15689B    4569B     3         145689    1469B     A         4689B     7         14568     2         145689B
16789AB   4679AB    2         1679A     146789B   5         3         4689AB    1689A     14678AB   14679AB
15679AB   45679A    14567AB   1456789B  16789A    468B      2         15689B    456789A   145689AB  3

579 candidates.

Entering_relation_bivalue_with_<Fact-57820>
Entering_level_S2_with_<Fact-57821>
Entering_level_BC2_with_<Fact-57824>
Entering_level_Z2_with_<Fact-57825>
Entering_level_tW2_with_<Fact-57847>
Entering_level_W2_with_<Fact-57848>
Entering_level_S3_with_<Fact-57849>
Entering_level_BC3_with_<Fact-57852>
Entering_level_Z3_with_<Fact-57853>
Entering_level_tW3_with_<Fact-57864>
Entering_level_W3_with_<Fact-57883>
whip[3]: d5n8{r6c11 r7c10} - r10n8{c10 c9} - d10n8{r2c9 .} ==> r6c1 ≠ 8
whip[3]: c1n8{r10 r5} - a6n8{r6c11 r11c5} - d1n8{r8c5 .} ==> r9c11 ≠ 8
whip[3]: r9n8{c7 c9} - c3n8{r4 r8} - a11n8{r6c5 .} ==> r6c4 ≠ 8
whip[3]: d5n8{r5c1 r7c10} - r9n8{c1 c9} - a10n8{r11c9 .} ==> r5c11 ≠ 8
whip[3]: a6n5{r8c2 r6c11} - d8n5{r6c3 r11c9} - c3n5{r5 .} ==> r8c7 ≠ 5
whip[3]: c2n10{r11 r10} - r4n10{c8 c4} - r3n10{c4 .} ==> r11c10 ≠ 10
Entering_level_BC4_with_<Fact-57893>
Entering_level_Z4_with_<Fact-57894>
Entering_level_tW4_with_<Fact-57897>
Entering_level_W4_with_<Fact-57922>
whip[4]: d5n4{r11c6 r1c5} - a8n4{r1c8 r4c11} - r2n4{c9 c3} - d10n4{r8c3 .} ==> r3c9 ≠ 4
whip[4]: d5n4{r11c6 r8c9} - a1n4{r8c8 r6c6} - r2n4{c10 c11} - a3n4{r9c11 .} ==> r10c5 ≠ 4
whip[4]: d5n5{r7c10 r8c9} - r3n5{c4 c5} - c2n5{r11 r2} - a6n5{r8c2 .} ==> r7c11 ≠ 5
whip[4]: d5n5{r8c9 r1c5} - d10n5{r1c10 r7c4} - d9n5{r1c9 r11c10} - r4n5{c10 .} ==> r8c11 ≠ 5
whip[3]: c11n5{r9 r2} - a11n5{r2c1 r11c10} - a6n5{r5c10 .} ==> r6c3 ≠ 5
whip[4]: c11n5{r9 r2} - c5n5{r7 r1} - r7n5{c10 c4} - d7n5{r4c4 .} ==> r6c8 ≠ 5
whip[3]: c8n5{r11 r5} - c2n5{r11 r8} - d5n5{r6c11 .} ==> r11c4 ≠ 5
whip[4]: d5n4{r11c6 r8c9} - d9n4{r10c11 r4c6} - a1n4{r6c6 r10c10} - r1n4{c10 .} ==> r11c4 ≠ 4
whip[4]: d3n4{r8c7 r2c2} - r10n4{c2 c11} - d10n4{r5c6 r1c10} - a5n4{r6c10 .} ==> r4c3 ≠ 4
whip[4]: d5n4{r11c6 r1c5} - r9n4{c2 c4} - d6n4{r9c9 r5c2} - r3n4{c2 .} ==> r11c9 ≠ 4
whip[4]: r11n4{c10 c2} - d3n4{r2c2 r8c7} - c11n4{r4 r10} - a10n4{r2c11 .} ==> r4c10 ≠ 4
whip[2]: d2n4{r9c5 r11c3} - a7n4{r8c3 .} ==> r9c11 ≠ 4
z-chain[3]: a7n4{r11c6 r9c4} - c9n4{r9 r1} - d5n4{r1c5 .} ==> r5c6 ≠ 4
whip[3]: d2n4{r11c3 r9c5} - c4n4{r8 r3} - c9n4{r8 .} ==> r6c3 ≠ 4
whip[3]: d8n4{r10c10 r5c4} - c11n4{r5 r10} - a9n4{r3c11 .} ==> r3c10 ≠ 4
whip[3]: d5n4{r1c5 r11c6} - c3n4{r11 r2} - r3n4{c4 .} ==> r1c9 ≠ 4
whip[3]: d8n4{r5c4 r10c10} - a9n4{r2c10 r3c11} - d6n4{r5c2 .} ==> r5c8 ≠ 4
whip[3]: c9n4{r8 r9} - r5n4{c2 c11} - r2n4{c11 .} ==> r8c4 ≠ 4
whip[2]: a9n4{r8c5 r5c2} - c4n4{r5 .} ==> r2c11 ≠ 4
whip[2]: c9n4{r9 r8} - d1n4{r8c5 .} ==> r9c2 ≠ 4
whip[3]: a9n4{r8c5 r3c11} - a8n4{r9c5 r1c8} - r10n4{c8 .} ==> r2c5 ≠ 4
t-whip[3]: r5n4{c11 c7} - r4n4{c8 c11} - r2n4{c9 .} ==> r3c2 ≠ 4
z-chain[2]: c2n4{r11 r2} - r4n4{c11 .} ==> r5c7 ≠ 4
z-chain[2]: d11n4{r6c6 r10c2} - a10n4{r10c8 .} ==> r6c10 ≠ 4
z-chain[2]: d4n4{r8c8 r9c7} - c9n4{r9 .} ==> r8c3 ≠ 4
z-chain[2]: a7n4{r11c6 r5c11} - c3n4{r2 .} ==> r11c2 ≠ 4
whip[1]: c2n4{r10 .} ==> r2c10 ≠ 4
z-chain[2]: a3n4{r6c8 r1c3} - a11n4{r8c7 .} ==> r6c4 ≠ 4
z-chain[2]: a10n4{r10c8 r1c10} - c9n4{r2 .} ==> r8c8 ≠ 4
whip[1]: r8n4{c9 .} ==> r6c7 ≠ 4
whip[1]: d1n4{r9c4 .} ==> r9c5 ≠ 4
z-chain[2]: d4n4{r5c11 r9c7} - c10n4{r1 .} ==> r10c11 ≠ 4
z-chain[2]: d9n4{r4c6 r11c10} - r10n4{c10 .} ==> r4c8 ≠ 4
whip[1]: d11n4{r10c2 .} ==> r2c2 ≠ 4, r3c6 ≠ 4, r10c10 ≠ 4
whip[1]: c10n4{r11 .} ==> r6c5 ≠ 4
whip[1]: r6n4{c8 .} ==> r4c6 ≠ 4
whip[1]: r4n4{c11 .} ==> r2c9 ≠ 4, r8c7 ≠ 4
hidden-single-in-a-row ==> r2c3 = 4
hidden-single-in-an-anti-diagonal ==> r6c8 = 4
hidden-single-in-an-anti-diagonal ==> r4c11 = 4
hidden-single-in-an-anti-diagonal ==> r10c2 = 4
hidden-single-in-an-anti-diagonal ==> r8c5 = 4
hidden-single-in-an-anti-diagonal ==> r3c7 = 4
hidden-single-in-an-anti-diagonal ==> r5c4 = 4
hidden-single-in-a-column ==> r1c10 = 4
hidden-single-in-a-row ==> r11c6 = 4
hidden-single-in-a-row ==> r9c9 = 4
whip[1]: d5n8{r7c10 .} ==> r5c10 ≠ 8
whip[1]: c2n10{r11 .} ==> r11c5 ≠ 10
z-chain[2]: d4n7{r11c5 r7c9} - c2n7{r11 .} ==> r5c10 ≠ 7
z-chain[2]: c6n8{r6 r3} - d6n8{r2c5 .} ==> r4c8 ≠ 8
z-chain[2]: a1n8{r8c8 r10c10} - a7n8{r10c5 .} ==> r8c4 ≠ 8
z-chain[2]: a8n8{r7c3 r2c9} - c11n8{r2 .} ==> r7c10 ≠ 8
z-chain[2]: d5n8{r6c11 r5c1} - r9n8{c1 .} ==> r2c11 ≠ 8
z-chain[2]: c11n8{r7 r8} - a1n8{r4c4 .} ==> r6c10 ≠ 8
t-whip[2]: c6n8{r6 r3} - d1n8{r5c8 .} ==> r4c4 ≠ 8
z-chain[2]: a1n8{r10c10 r6c6} - d5n8{r6c11 .} ==> r8c1 ≠ 8
z-chain[2]: c1n8{r9 r10} - r4n8{c7 .} ==> r7c3 ≠ 8
z-chain[2]: a8n8{r3c10 r5c1} - d1n8{r5c8 .} ==> r3c9 ≠ 8
z-chain[2]: r3n8{c6 c10} - d5n8{r5c1 .} ==> r8c11 ≠ 8
z-chain[2]: c11n8{r6 r7} - d3n8{r11c4 .} ==> r6c5 ≠ 8
z-chain[2]: r6n8{c6 c11} - a8n8{r5c1 .} ==> r2c10 ≠ 8
z-chain[2]: a9n8{r7c4 r11c8} - d3n8{r11c4 .} ==> r8c3 ≠ 8
whip[1]: r8n8{c8 .} ==> r9c7 ≠ 8
whip[1]: r9n8{c4 .} ==> r5c8 ≠ 8
whip[1]: a7n8{r10c5 .} ==> r11c4 ≠ 8
whip[1]: d3n8{r10c5 .} ==> r10c9 ≠ 8
whip[1]: a5n8{r7c11 .} ==> r2c5 ≠ 8
whip[1]: a4n8{r9c1 .} ==> r4c6 ≠ 8
whip[1]: r4n8{c7 .} ==> r8c7 ≠ 8
hidden-single-in-a-diagonal ==> r10c5 = 8
hidden-single-in-a-diagonal ==> r3c10 = 8
hidden-single-in-a-diagonal ==> r6c11 = 8
hidden-single-in-a-diagonal ==> r11c9 = 8
hidden-single-in-a-diagonal ==> r2c6 = 8
hidden-single-in-a-column ==> r4c3 = 8
hidden-single-in-an-anti-diagonal ==> r9c1 = 8
hidden-single-in-a-diagonal ==> r7c4 = 8
hidden-single-in-a-column ==> r5c7 = 8
hidden-single-in-a-diagonal ==> r8c8 = 8
whip[1]: r9n5{c11 .} ==> r11c2 ≠ 5
whip[1]: a6n5{r8c2 .} ==> r2c2 ≠ 5
whip[1]: a1n5{r7c7 .} ==> r1c7 ≠ 5
whip[1]: a8n7{r8c4 .} ==> r8c3 ≠ 7
whip[1]: d3n7{r11c4 .} ==> r11c2 ≠ 7
z-chain[2]: c10n10{r10 r6} - r4n10{c8 .} ==> r7c7 ≠ 10
z-chain[2]: a1n10{r10c10 r1c1} - a3n10{r11c2 .} ==> r10c9 ≠ 10
z-chain[2]: a1n10{r10c10 r4c4} - a6n10{r10c4 .} ==> r8c1 ≠ 10
z-chain[2]: d8n10{r10c10 r1c8} - d9n10{r7c3 .} ==> r10c4 ≠ 10
z-chain[2]: a6n10{r2c7 r8c2} - a11n10{r3c2 .} ==> r2c9 ≠ 10
z-chain[2]: d10n10{r10c1 r4c7} - d2n10{r11c3 .} ==> r6c1 ≠ 10
z-chain[2]: d6n10{r10c8 r2c5} - a6n10{r2c7 .} ==> r10c11 ≠ 10
whip[1]: d9n10{r8c2 .} ==> r8c4 ≠ 10
z-chain[2]: d9n10{r7c3 r8c2} - c9n10{r8 .} ==> r7c5 ≠ 10
z-chain[2]: d11n10{r4c8 r11c1} - a1n10{r1c1 .} ==> r4c10 ≠ 10
whip[1]: d2n10{r11c3 .} ==> r2c5 ≠ 10, r11c1 ≠ 10
whip[1]: r11n10{c3 .} ==> r5c8 ≠ 10
biv-chain[2]: d2n10{r11c3 r2c1} - a6n10{r2c7 r8c2} ==> r11c2 ≠ 10, r7c3 ≠ 10, r8c3 ≠ 10, r8c11 ≠ 10
hidden-single-in-a-row ==> r11c3 = 10
whip[1]: r2n10{c11 .} ==> r6c7 ≠ 10
whip[1]: a2n10{r8c9 .} ==> r3c9 ≠ 10
hidden-single-in-a-diagonal ==> r4c8 = 10
hidden-single-in-an-anti-diagonal ==> r5c1 = 10
hidden-single-in-an-anti-diagonal ==> r10c10 = 10
hidden-single-in-an-anti-diagonal ==> r8c2 = 10
hidden-single-in-an-anti-diagonal ==> r6c5 = 10
hidden-single-in-an-anti-diagonal ==> r7c9 = 10
hidden-single-in-a-diagonal ==> r1c7 = 10
hidden-single-in-a-row ==> r3c4 = 10
hidden-single-in-an-anti-diagonal ==> r2c11 = 10
whip[1]: c11n5{r9 .} ==> r3c5 ≠ 5
whip[1]: r3n5{c11 .} ==> r1c9 ≠ 5, r2c10 ≠ 5, r4c10 ≠ 5
whip[1]: c9n5{r8 .} ==> r11c1 ≠ 5, r8c3 ≠ 5
whip[1]: r8n5{c9 .} ==> r1c5 ≠ 5
whip[1]: c5n5{r7 .} ==> r7c10 ≠ 5
hidden-single-in-a-diagonal ==> r8c9 = 5
hidden-single-in-a-diagonal ==> r7c5 = 5
hidden-single-in-a-column ==> r1c3 = 5
hidden-single-in-an-anti-diagonal ==> r4c4 = 5
hidden-single-in-an-anti-diagonal ==> r5c8 = 5
hidden-single-in-an-anti-diagonal ==> r3c11 = 5
hidden-single-in-an-anti-diagonal ==> r11c10 = 5
hidden-single-in-a-column ==> r6c1 = 5
hidden-single-in-a-row ==> r2c7 = 5
hidden-single-in-a-column ==> r9c2 = 5
whip[1]: c2n9{r11 .} ==> r11c8 ≠ 9
whip[1]: d7n9{r10c9 .} ==> r8c7 ≠ 9, r10c11 ≠ 9
whip[1]: a11n9{r10c9 .} ==> r2c9 ≠ 9, r10c1 ≠ 9, r10c4 ≠ 9
whip[1]: d10n9{r5c6 .} ==> r4c6 ≠ 9, r6c7 ≠ 9
whip[1]: r6n9{c10 .} ==> r11c4 ≠ 9, r9c7 ≠ 9
hidden-single-in-a-column ==> r4c7 = 9
hidden-single-in-a-column ==> r1c6 = 9
hidden-single-in-a-column ==> r7c8 = 9
hidden-single-in-a-row ==> r11c2 = 9
hidden-single-in-an-anti-diagonal ==> r5c11 = 9
hidden-single-in-an-anti-diagonal ==> r8c3 = 11
hidden-single-in-a-row ==> r5c2 = 11
naked-single ==> r3c2 = 6
naked-single ==> r2c2 = 7
naked-single ==> r8c7 = 1
naked-single ==> r5c10 = 6
naked-single ==> r4c10 = 7
naked-single ==> r3c9 = 1
naked-single ==> r2c9 = 6
naked-single ==> r1c9 = 7
naked-single ==> r7c3 = 1
naked-single ==> r1c8 = 11
naked-single ==> r1c5 = 6
naked-single ==> r1c1 = 1
naked-single ==> r10c1 = 7
naked-single ==> r3c5 = 11
naked-single ==> r5c6 = 1
naked-single ==> r8c1 = 9
naked-single ==> r2c1 = 11
naked-single ==> r7c7 = 6
naked-single ==> r6c6 = 11
naked-single ==> r6c10 = 1
naked-single ==> r11c5 = 7
naked-single ==> r6c7 = 7
naked-single ==> r11c1 = 6
naked-single ==> r10c11 = 11
naked-single ==> r11c8 = 1
naked-single ==> r8c4 = 7
naked-single ==> r8c11 = 6
naked-single ==> r9c11 = 1
naked-single ==> r7c11 = 7
naked-single ==> r3c6 = 7
naked-single ==> r9c5 = 9
naked-single ==> r6c3 = 6
naked-single ==> r6c4 = 9
naked-single ==> r2c5 = 1
naked-single ==> r2c10 = 9
naked-single ==> r9c4 = 6
naked-single ==> r4c6 = 6
naked-single ==> r10c4 = 1
naked-single ==> r5c3 = 7
naked-single ==> r7c10 = 11
naked-single ==> r11c4 = 11
naked-single ==> r10c9 = 9
naked-single ==> r9c7 = 11
naked-single ==> r10c8 = 6
PUZZLE 0 IS SOLVED. rating-type = W, MOST COMPLEX RULE TRIED = W[4]
   185369AB742
   B742185369A
   369AB742185
   2185369AB74
   AB742185369
   5369AB74218
   42185369AB7
   9AB74218536
   85369AB7421
   742185369AB
   69AB7421853

nb-facts = <Fact-59183>
Puzzle .8.3......2.............9.........1......B..........3.............4..........................A.7........5...........2....  12 ED=8.1/2.9/2.9 :
init-time = 1.1s, solve-time = 10.99s, total-time = 12.09s
nb-facts=<Fact-59183>
***********************************************************************************************
***  LatinRules 2.1.s based on CSP-Rules 2.1.s, config = W
***  Using CLIPS 6.32-r801
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.7
***  Download from: https://github.com/denis-berthier/CSP-Rules-V2.1
***********************************************************************************************



If Subsets are active:
init-time = 1.11s, solve-time = 21.82s, total-time = 22.93s

