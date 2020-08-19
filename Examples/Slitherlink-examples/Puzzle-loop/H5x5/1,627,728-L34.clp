
(solve
5 5
. 3 . 2 .
2 . . 1 .
. 2 2 . 2
. . 1 3 2
3 . 3 . 2

)

***********************************************************************************************
***  SlitherRules 2.1.s based on CSP-Rules 2.1.s, config = W+nW1eq+Col+Loop
***  Using CLIPS 6.32-r767
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
***********************************************************************************************

. 3 . 2 .
2 . . 1 .
. 2 2 . 2
. . 1 3 2
3 . 3 . 2

start init-grid-structure 0.00361895561218262
start create-csp-variables
start create-labels 0.000397920608520508
start init-physical-csp-links 0.00268387794494629
start init-physical-non-csp-links 1.25407195091248
     start init-physical-PH-and-PV-non-csp-links at local time 0
     start init-physical-BH-and-BV-non-csp-links at local time 0.314563035964966
     start init-physical-BN-non-csp-links at local time 1.12342000007629
     start init-physical-BP-non-csp-links at local time 1.9309868812561
     end init-physical-BP-non-csp-links at local time 12.3895199298859
end init-physical-non-csp-links 13.6436388492584
start init-corner-B-c-values 13.6474421024323
start init-outer-B-candidates 13.6474859714508
start init-outer-I-candidates 13.6477739810944
start init-H-candidates 13.6480419635773
start init-V-candidates 13.648796081543
start init-P-candidates 13.6495130062103
start init-inner-I-candidates 13.6507658958435
start init-inner-N-and-B-candidates 13.6511878967285
start solution 13.6537580490112
entering BRT
w[1]-3-in-sw-corner ==> Vr5c1 = 1, Hr6c1 = 1
H-single: Hr6c1 = 1
V-single: Vr5c1 = 1
w[1]-2-in-se-corner ==> Vr4c6 = 1, Hr6c4 = 1
H-single: Hr6c4 = 1
V-single: Vr4c6 = 1
w[1]-diagonal-3s-in-{r4c4...r5c3} ==> Vr4c5 = 1, Vr5c3 = 1, Hr6c3 = 1, Hr4c4 = 1, Vr3c5 = 0, Hr6c2 = 0, Hr4c5 = 0
H-single: Hr4c5 = 0
H-single: Hr6c2 = 0
V-single: Vr3c5 = 0
H-single: Hr4c4 = 1
H-single: Hr6c3 = 1
V-single: Vr5c3 = 1
V-single: Vr4c5 = 1
w[1]-2-in-r3c5-open-sw-corner ==> Hr3c5 = 1, Vr3c6 = 1, Vr2c6 = 0
V-single: Vr2c6 = 0
V-single: Vr3c6 = 1
H-single: Hr3c5 = 1
w[1]-3-in-r5c3-hit-by-horiz-line-at-se ==> Hr5c3 = 1
H-single: Hr5c3 = 1
V-single: Vr4c3 = 0
H-single: Hr5c2 = 0
w[1]-3-in-r4c4-hit-by-horiz-line-at-sw ==> Vr5c4 = 0
V-single: Vr5c4 = 0
w[1]-adjacent-1-3-on-pseudo-edge-in-r4{c3 c4} ==> Hr5c4 = 1, Hr4c3 = 0
H-single: Hr4c3 = 0
H-single: Hr5c4 = 1
V-single: Vr5c5 = 0
H-single: Hr5c5 = 0
w[1]-2-in-r5c5-open-nw-corner ==> Hr6c5 = 1, Vr5c6 = 1
V-single: Vr5c6 = 1
H-single: Hr6c5 = 1
w[1]-3-in-r5c3-hit-by-horiz-line-at-ne ==> Vr4c4 = 0
V-single: Vr4c4 = 0
w[1]-3-in-r5c3-closed-sw-corner ==> Pr5c4 ≠ sw, Pr5c4 ≠ ne, Pr5c4 ≠ o
w[1]-3-in-r5c3-closed-nw-corner ==> Pr6c4 ≠ nw, Pr6c4 ≠ o
w[1]-3-in-r5c1-closed-sw-corner ==> Pr5c2 ≠ sw, Pr5c2 ≠ ne, Pr5c2 ≠ o
w[1]-3-in-r4c4-closed-se-corner ==> Pr4c4 ≠ se, Pr4c4 ≠ o
diagonal-2-3-in-nw-corner ==> Vr1c3 = 0
V-single: Vr1c3 = 1
P-single: Pr6c6 = nw
P-single: Pr5c5 = nw
P-single: Pr5c6 = ns
P-single: Pr4c6 = ns
w[1]-1-in-r2c4-asymmetric-se-corner ==> Pr2c4 ≠ sw, Pr2c4 ≠ ew, Pr2c4 ≠ ns, Pr2c4 ≠ ne
entering level Loop with <Fact-27630>
entering level Col with <Fact-27748>
vertical-line-r5{c5 c6} ==> Ir5c5 = in
I-single: Ir5c5 = in
no-vertical-line-r5{c4 c5} ==> Ir5c4 = in
I-single: Ir5c4 = in
no-vertical-line-r5{c3 c4} ==> Ir5c3 = in
I-single: Ir5c3 = in
vertical-line-r5{c2 c3} ==> Ir5c2 = out
I-single: Ir5c2 = out
no-horizontal-line-{r4 r5}c2 ==> Ir4c2 = out
I-single: Ir4c2 = out
no-vertical-line-r4{c2 c3} ==> Ir4c3 = out
I-single: Ir4c3 = out
no-vertical-line-r4{c3 c4} ==> Ir4c4 = out
I-single: Ir4c4 = out
vertical-line-r4{c4 c5} ==> Ir4c5 = in
I-single: Ir4c5 = in
no-horizontal-line-{r3 r4}c5 ==> Ir3c5 = in
I-single: Ir3c5 = in
no-vertical-line-r3{c4 c5} ==> Ir3c4 = in
I-single: Ir3c4 = in
horizontal-line-{r2 r3}c5 ==> Ir2c5 = out
I-single: Ir2c5 = out
no-horizontal-line-{r3 r4}c3 ==> Ir3c3 = out
I-single: Ir3c3 = out
vertical-line-r5{c0 c1} ==> Ir5c1 = in
I-single: Ir5c1 = in
different-colours-in-r5{c1 c2} ==> Hr5c2 = 1
V-single: Vr5c2 = 1
w[1]-3-in-r5c1-closed-se-corner ==> Pr5c1 ≠ se, Pr5c1 ≠ o
different-colours-in-r3{c3 c4} ==> Hr3c4 = 1
V-single: Vr3c4 = 1

LOOP[14]: Vr3c4-Hr4c4-Vr4c5-Hr5c4-Hr5c3-Vr5c3-Hr6c3-Hr6c4-Hr6c5-Vr5c6-Vr4c6-Vr3c6-Hr3c5- ==> Hr3c4 = 0
H-single: Hr3c4 = 0
no-horizontal-line-{r2 r3}c4 ==> Ir2c4 = in
I-single: Ir2c4 = in
different-colours-in-r2{c4 c5} ==> Hr2c5 = 1
V-single: Vr2c5 = 1
Starting_init_links_with_<Fact-27858>
572 candidates, 1603 csp-links and 6196 links. Density = 3.79%
starting non trivial part of solution
Entering_level_W1_with_<Fact-43461>
whip[1]: Vr2c5{1 .} ==> Br2c5 ≠ nes, Br2c5 ≠ o, Pr2c5 ≠ o, Pr2c5 ≠ ne, Pr2c5 ≠ nw, Pr2c5 ≠ ew, Pr3c5 ≠ ew, Pr3c5 ≠ sw, Br2c4 ≠ n, Br2c4 ≠ s, Br2c4 ≠ w, Br2c5 ≠ n, Br2c5 ≠ e, Br2c5 ≠ s, Br2c5 ≠ ne, Br2c5 ≠ ns, Br2c5 ≠ se
B-single: Br2c4 = e
H-single: Hr2c4 = 0
V-single: Vr2c4 = 0
P-single: Pr3c4 = sw
H-single: Hr3c3 = 1
horizontal-line-{r2 r3}c3 ==> Ir2c3 = in
I-single: Ir2c3 = in
no-horizontal-line-{r1 r2}c4 ==> Ir1c4 = in
I-single: Ir1c4 = in
different-colours-in-{r0 r1}c4 ==> Hr1c4 = 1
H-single: Hr1c4 = 1
whip[1]: Hr2c4{0 .} ==> Br1c4 ≠ ns, Br1c4 ≠ se, Br1c4 ≠ sw
whip[1]: Vr2c4{0 .} ==> Br2c3 ≠ e, Br2c3 ≠ ne, Br2c3 ≠ se, Br2c3 ≠ ew, Br2c3 ≠ esw, Br2c3 ≠ wne, Br2c3 ≠ nes
whip[1]: Pr3c4{sw .} ==> Br3c4 ≠ ns, Br3c4 ≠ ne, Br3c4 ≠ s, Br3c4 ≠ e, Br3c4 ≠ n, Br3c4 ≠ o, Br3c3 ≠ ns, Br2c3 ≠ w, Br2c3 ≠ n, Br2c3 ≠ o, Br2c3 ≠ nw, Br3c3 ≠ nw, Br3c3 ≠ se, Br3c3 ≠ ew, Br3c3 ≠ sw, Br3c4 ≠ nw, Br3c4 ≠ se, Br3c4 ≠ swn, Br3c4 ≠ wne, Br3c4 ≠ nes
B-single: Br3c3 = ne
V-single: Vr3c3 = 0
no-vertical-line-r3{c2 c3} ==> Ir3c2 = out
I-single: Ir3c2 = out
same-colour-in-{r3 r4}c2 ==> Hr4c2 = 0
H-single: Hr4c2 = 0
w[1]-2-in-r3c2-open-se-corner ==> Hr3c2 = 1, Vr3c2 = 1, Hr3c1 = 0, Vr2c2 = 0
V-single: Vr2c2 = 0
H-single: Hr3c1 = 0
V-single: Vr3c2 = 1
H-single: Hr3c2 = 1
w[1]-2-in-r2c1-open-se-corner ==> Hr2c1 = 1, Vr2c1 = 1, Vr1c1 = 0
V-single: Vr1c1 = 0
V-single: Vr2c1 = 1
H-single: Hr2c1 = 1
w[1]-diagonal-3-2-in-{r1c2...r2c1}-non-closed-sw-corner ==> Hr1c2 = 1, Hr1c3 = 0
H-single: Hr1c3 = 0
H-single: Hr1c2 = 1
P-single: Pr3c3 = ew
V-single: Vr2c3 = 0
no-vertical-line-r2{c2 c3} ==> Ir2c2 = in
I-single: Ir2c2 = in
no-vertical-line-r2{c1 c2} ==> Ir2c1 = in
I-single: Ir2c1 = in
no-horizontal-line-{r2 r3}c1 ==> Ir3c1 = in
I-single: Ir3c1 = in
horizontal-line-{r1 r2}c1 ==> Ir1c1 = out
I-single: Ir1c1 = out
horizontal-line-{r0 r1}c2 ==> Ir1c2 = in
I-single: Ir1c2 = in
vertical-line-r1{c2 c3} ==> Ir1c3 = out
I-single: Ir1c3 = out
different-colours-in-r1{c3 c4} ==> Hr1c4 = 1
V-single: Vr1c4 = 1
different-colours-in-{r1 r2}c3 ==> Hr2c3 = 1
H-single: Hr2c3 = 1
H-single: Hr2c2 = 0
w[1]-3-in-r1c2-hit-by-horiz-line-at-se ==> Vr1c2 = 1
V-single: Vr1c2 = 1
H-single: Hr1c1 = 0
w[1]-3-in-r1c2-closed-nw-corner ==> Pr2c3 ≠ se, Pr2c3 ≠ nw, Pr2c3 ≠ o
different-colours-in-r3{c0 c1} ==> Hr3c1 = 1
V-single: Vr3c1 = 1
whip[1]: Vr3c3{0 .} ==> Br3c2 ≠ ne, Br3c2 ≠ se, Br3c2 ≠ ew
whip[1]: Hr4c2{0 .} ==> Pr4c2 ≠ se, Pr4c2 ≠ ew, Pr4c3 ≠ sw, Br3c2 ≠ ns, Br3c2 ≠ sw, Br4c2 ≠ n, Br4c2 ≠ ne, Br4c2 ≠ ns, Br4c2 ≠ nw, Br4c2 ≠ swn, Br4c2 ≠ wne, Br4c2 ≠ nes
P-single: Pr2c1 = se
P-single: Pr3c2 = se
P-single: Pr4c3 = o
B-single: Br3c2 = nw
w[1]-1-in-r4c3-symmetric-nw-corner ==> Pr5c4 ≠ se, Pr5c4 ≠ nw
whip[1]: Pr2c1{se .} ==> Br1c1 ≠ e, Br1c1 ≠ o, Br1c1 ≠ nw, Br1c1 ≠ swn, Br1c1 ≠ wne, Br2c1 ≠ ne, Br2c1 ≠ ns, Br2c1 ≠ se, Br2c1 ≠ ew, Br2c1 ≠ sw
B-single: Br2c1 = nw
P-single: Pr3c1 = ns
whip[1]: Pr3c1{ns .} ==> Br3c1 ≠ e, Br3c1 ≠ n, Br3c1 ≠ o, Br3c1 ≠ s, Br3c1 ≠ ne, Br3c1 ≠ ns, Br3c1 ≠ nw, Br3c1 ≠ se, Br3c1 ≠ swn, Br3c1 ≠ wne, Br3c1 ≠ nes
whip[1]: Br3c1{esw .} ==> Pr4c1 ≠ o, Pr4c1 ≠ se, Nr3c1 ≠ 0
whip[1]: Pr4c1{ns .} ==> Br4c1 ≠ s, Br4c1 ≠ nw, Br4c1 ≠ se, Br4c1 ≠ swn, Br4c1 ≠ wne, Br4c1 ≠ o, Br4c1 ≠ e
whip[1]: Br4c1{nes .} ==> Nr4c1 ≠ 0
whip[1]: Pr2c2{ew .} ==> Br1c2 ≠ esw, Br1c2 ≠ swn, Br2c2 ≠ nw, Br2c2 ≠ ew, Br2c2 ≠ sw, Br2c2 ≠ esw, Br2c2 ≠ swn, Br2c2 ≠ wne, Br2c2 ≠ w
whip[1]: Br1c2{nes .} ==> Pr1c2 ≠ o, Pr1c2 ≠ sw, Pr1c3 ≠ o, Pr1c3 ≠ se, Pr1c3 ≠ ew, Pr2c3 ≠ ew, Pr2c3 ≠ sw
P-single: Pr1c3 = sw
whip[1]: Pr1c3{sw .} ==> Br1c3 ≠ ns, Br1c3 ≠ ne, Br1c3 ≠ s, Br1c3 ≠ e, Br1c3 ≠ n, Br1c3 ≠ o, Br1c3 ≠ nw, Br1c3 ≠ se, Br1c3 ≠ swn, Br1c3 ≠ wne, Br1c3 ≠ nes
whip[1]: Br1c3{esw .} ==> Pr1c4 ≠ ew, Pr1c4 ≠ sw, Nr1c3 ≠ 0
P-single: Pr2c4 = nw
P-single: Pr2c5 = se
H-single: Hr2c5 = 1
V-single: Vr1c5 = 0
P-single: Pr1c4 = se
no-vertical-line-r1{c4 c5} ==> Ir1c5 = in
I-single: Ir1c5 = in
different-colours-in-r1{c5 c6} ==> Hr1c6 = 1
V-single: Vr1c6 = 1
different-colours-in-{r0 r1}c5 ==> Hr1c5 = 1
H-single: Hr1c5 = 1

LOOP[30]: Vr3c1-Vr2c1-Hr2c1-Vr1c2-Hr1c2-Vr1c3-Hr2c3-Vr1c4-Hr1c4-Hr1c5-Vr1c6-Hr2c5-Vr2c5-Hr3c5-Vr3c6-Vr4c6-Vr5c6-Hr6c5-Hr6c4-Hr6c3-Vr5c3-Hr5c3-Hr5c4-Vr4c5-Hr4c4-Vr3c4-Hr3c3-Hr3c2-Vr3c2- ==> Hr4c1 = 0
H-single: Hr4c1 = 0
no-horizontal-line-{r3 r4}c1 ==> Ir4c1 = in
I-single: Ir4c1 = in
same-colour-in-{r4 r5}c1 ==> Hr5c1 = 0
H-single: Hr5c1 = 0
different-colours-in-r4{c1 c2} ==> Hr4c2 = 1
V-single: Vr4c2 = 1

LOOP[34]: Vr3c1-Vr2c1-Hr2c1-Vr1c2-Hr1c2-Vr1c3-Hr2c3-Vr1c4-Hr1c4-Hr1c5-Vr1c6-Hr2c5-Vr2c5-Hr3c5-Vr3c6-Vr4c6-Vr5c6-Hr6c5-Hr6c4-Hr6c3-Vr5c3-Hr5c3-Hr5c4-Vr4c5-Hr4c4-Vr3c4-Hr3c3-Hr3c2-Vr3c2-Vr4c2-Vr5c2-Hr6c1-Vr5c1- ==> Vr4c1 = 1
V-single: Vr4c1 = 1
PUZZLE 0 SOLVED. rating-type = W+nW1eq+Col+Loop, MOST COMPLEX RULE TRIED = W[1]

OXOXX
XXXXO
XOOXX
XOOOX
XOXXX

.   .———.   .———.———.
    | 3 |   | 2     |
.———.   .———.   .———.
| 2           1 |
.   .———.———.   .———.
|   | 2   2 |     2 |
.   .   .   .———.   .
|   |     1   3 | 2 |
.   .   .———.———.   .
| 3 |   | 3       2 |
.———.   .———.———.———.

init-time = 13.65s, solve-time = 4.01s, total-time = 17.66s
nb-facts=<Fact-44895>
Quasi-Loop max length = 34
Colours effectively used
***********************************************************************************************
***  SlitherRules 2.1.s based on CSP-Rules 2.1.s, config = W+nW1eq+Col+Loop
***  Using CLIPS 6.32-r767
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
***********************************************************************************************
