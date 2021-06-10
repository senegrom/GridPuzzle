
(solve
15 15
. . . 2 3 3 . 2 . . . 0 0 2 . 
2 . 3 . 2 2 . 1 . . . . . . . 
2 . 3 1 . 3 2 1 1 . . . 3 0 . 
3 1 . 1 1 . . 3 . 2 1 . . 2 . 
. . . . 1 . . 2 . . . . . . .
3 1 . . . 2 . . 2 1 2 2 1 2 . 
. . . . 3 . 2 2 3 . . 3 3 . . 
. . 2 2 1 1 . 2 2 . . . . . . 
. . . . . . . . . . 2 . . 2 3
. 2 . . . 1 3 . . 3 3 . . . 3
. 3 . . 2 . . 1 2 . 1 . . . . 
2 . 1 . 0 2 1 3 . . 2 . 2 2 . 
2 2 1 2 2 . . . . . 0 2 . 1 . 
2 1 . 2 2 2 . 2 . 1 . 2 3 . 3
. . . . 2 . 3 . 3 1 . . . . . 
)


***********************************************************************************************
***  SlitherRules 2.1.s based on CSP-Rules 2.1.s, config = W+nW1eq+Col+Loop
***  Using CLIPS 6.32-r770
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
***********************************************************************************************

. . . 2 3 3 . 2 . . . 0 0 2 .
2 . 3 . 2 2 . 1 . . . . . . .
2 . 3 1 . 3 2 1 1 . . . 3 0 .
3 1 . 1 1 . . 3 . 2 1 . . 2 .
. . . . 1 . . 2 . . . . . . .
3 1 . . . 2 . . 2 1 2 2 1 2 .
. . . . 3 . 2 2 3 . . 3 3 . .
. . 2 2 1 1 . 2 2 . . . . . .
. . . . . . . . . . 2 . . 2 3
. 2 . . . 1 3 . . 3 3 . . . 3
. 3 . . 2 . . 1 2 . 1 . . . .
2 . 1 . 0 2 1 3 . . 2 . 2 2 .
2 2 1 2 2 . . . . . 0 2 . 1 .
2 1 . 2 2 2 . 2 . 1 . 2 3 . 3
. . . . 2 . 3 . 3 1 . . . . .

Loading pre-computed background
start init-inner-N-and-B-candidates 1.34319305419922
start solution 1.37499094009399
entering BRT
w[0]-0-in-r13c11 ==> Hr14c11 = 0, Hr13c11 = 0, Vr13c12 = 0, Vr13c11 = 0
w[0]-0-in-r12c5 ==> Hr13c5 = 0, Hr12c5 = 0, Vr12c6 = 0, Vr12c5 = 0
w[0]-0-in-r3c14 ==> Hr4c14 = 0, Hr3c14 = 0, Vr3c15 = 0, Vr3c14 = 0
w[0]-0-in-r1c13 ==> Hr2c13 = 0, Hr1c13 = 0, Vr1c14 = 0, Vr1c13 = 0
w[0]-0-in-r1c12 ==> Hr2c12 = 0, Hr1c12 = 0, Vr1c12 = 0
w0-adjacent-3-0-in-r3{c13 c14} ==> Vr4c14 = 1, Vr2c14 = 1, Vr3c13 = 1, Hr4c13 = 1, Hr3c13 = 1, Vr4c13 = 0, Vr2c13 = 0, Hr4c12 = 0, Hr3c12 = 0
w[1]-diagonal-3-2-3-in-{r10c10...r12c8} ==> Vr10c11 = 1, Vr12c8 = 1, Hr13c8 = 1, Hr10c10 = 1, Vr9c11 = 0, Vr13c8 = 0, Hr13c7 = 0, Hr10c11 = 0
w[1]-2-in-r9c11-open-sw-corner ==> Hr9c11 = 1, Vr9c12 = 1, Hr9c12 = 0, Vr8c12 = 0
w[1]-diagonal-3-2s-3-in-{r1c5...r4c8} ==> Vr4c9 = 1, Vr1c5 = 1, Hr5c8 = 1, Hr1c5 = 1, Vr5c9 = 0, Hr5c9 = 0, Hr1c4 = 0
w[1]-diagonal-3-2+0-in-{r14c13...r13c12+r13c11} ==> Vr14c14 = 1, Vr12c12 = 1, Hr15c13 = 1, Hr13c12 = 1, Vr15c14 = 0, Hr15c14 = 0
w[1]-diagonal-3-2-2+0-in-{r15c7...r13c5+r12c5} ==> Vr15c8 = 1, Vr13c5 = 1, Hr16c7 = 1, Hr13c4 = 1, Hr16c8 = 0
w[1]-diagonal-3-2s-in-{r3c6...r1c4}-non-closed-nw-end ==> Vr3c7 = 1, Vr1c4 = 1, Hr4c6 = 1, Vr4c7 = 0, Hr4c7 = 0
w[1]-diagonal-3-2s-in-{r1c5...r3c7}-non-closed-se-end ==> Vr3c8 = 1
w[1]-diagonal-3-2-in-{r2c3...r1c4}-non-closed-ne-corner ==> Vr2c3 = 1, Hr3c3 = 1, Vr3c3 = 0, Hr3c2 = 0
w[1]-3+diagonal-2-0-in-{r14c13+r14c12...r13c11} ==> Hr14c13 = 1, Vr13c14 = 0, Vr13c13 = 0, Hr14c14 = 0
w[1]-3+diagonal-2-isolated-end-in-{r10c11+r9c11...ne} ==> Vr10c12 = 1, Hr11c11 = 1, Vr11c12 = 0, Hr11c12 = 0, Hr10c12 = 0
w[1]-3-in-r10c10-hit-by-horiz-line-at-se ==> Vr10c10 = 1
w[1]-3-in-r3c3-hit-by-verti-line-at-nw ==> Vr3c4 = 1, Hr4c3 = 1
w[1]-3-in-r2c3-hit-by-verti-line-at-se ==> Hr2c3 = 1
w[0]-adjacent-3-in-r2c3-nolines-east ==> Vr1c3 = 0, Hr2c2 = 0
w[1]-3-in-r1c6-hit-by-horiz-line-at-nw ==> Vr1c7 = 1, Hr2c6 = 1
w[1]-diagonal-3-2-in-{r1c5...r2c6}-non-closed-se-corner ==> Hr3c6 = 1
w[1]-3-in-r1c5-hit-by-horiz-line-at-se ==> Vr2c6 = 0
w[1]-diagonal-1-1-in-{r4c4...r5c5}-with-no-nw-outer-sides ==> Hr6c5 = 0, Vr5c6 = 0
w[1]-1+3+1-in-r11c8+r12c8+r12c7 ==> Hr11c8 = 0, Vr11c9 = 0, Vr12c7 = 0
w[1]-diagonal-3-2-in-{r10c10...r11c9}-non-closed-sw-corner ==> Hr12c9 = 1
w[1]-adjacent-1-1-on-pseudo-edge-in-c8{r2 r3} ==> Hr3c8 = 0
w[1]-adjacent-1-3-on-edge-in-r15{c10 c9} ==> Vr15c11 = 0, Hr16c9 = 1, Hr15c10 = 0
w[1]-adjacent-1-3-on-pseudo-edge-in-r12{c7 c8} ==> Hr12c7 = 0
w[1]-adjacent-1-3-on-pseudo-edge-in-{r11 r10}c11 ==> Hr12c11 = 0
w[1]-diagonal-3-2s-in-{r14c13...r12c11}-non-closed-nw-end ==> Vr12c11 = 1
w[1]-adjacent-1-3-on-pseudo-edge-in-{r3 r4}c8 ==> Vr3c9 = 0, Vr4c8 = 1
w[1]-adjacent-1-3-on-pseudo-edge-in-r3{c4 c3} ==> Vr3c5 = 0
w[1]-diagonal-1-1-in-{r3c4...r4c5}-with-no-se-inner-sides ==> Hr4c5 = 0, Vr4c5 = 0
w[1]-3-in-r15c7-closed-se-corner ==> Pr15c7 ≠ se, Pr15c7 ≠ nw, Pr15c7 ≠ o
w[1]-3-in-r14c13-closed-ne-corner ==> Pr15c13 ≠ sw, Pr15c13 ≠ ne, Pr15c13 ≠ o
w[1]-3-in-r12c8-closed-sw-corner ==> Pr12c9 ≠ sw, Pr12c9 ≠ o
w[1]-3-in-r10c11-closed-sw-corner ==> Pr10c12 ≠ sw, Pr10c12 ≠ ne
w[1]-3-in-r10c11-closed-se-corner ==> Pr10c11 ≠ se, Pr10c11 ≠ nw, Pr10c11 ≠ o
w[1]-3-in-r10c10-closed-nw-corner ==> Pr11c11 ≠ se, Pr11c11 ≠ nw, Pr11c11 ≠ o
w[1]-3-in-r4c8-closed-sw-corner ==> Pr4c9 ≠ sw, Pr4c9 ≠ ne, Pr4c9 ≠ o
w[1]-3-in-r3c13-closed-sw-corner ==> Pr3c14 ≠ sw, Pr3c14 ≠ ne, Pr3c14 ≠ o
w[1]-3-in-r3c13-closed-nw-corner ==> Pr4c14 ≠ nw, Pr4c14 ≠ o
w[1]-3-in-r3c6-closed-ne-corner ==> Pr4c6 ≠ sw, Pr4c6 ≠ ne, Pr4c6 ≠ o
w[1]-3-in-r3c3-closed-se-corner ==> Pr3c3 ≠ se, Pr3c3 ≠ nw, Pr3c3 ≠ o
w[1]-3-in-r3c3-closed-ne-corner ==> Pr4c3 ≠ sw, Pr4c3 ≠ ne, Pr4c3 ≠ o
w[1]-3-in-r2c3-closed-nw-corner ==> Pr3c4 ≠ se, Pr3c4 ≠ nw, Pr3c4 ≠ o
w[1]-3-in-r1c6-closed-se-corner ==> Pr1c6 ≠ se, Pr1c6 ≠ o
adjacent-3s-in-c15{r9 r10} ==> Hr11c15 = 1, Hr10c15 = 1, Hr9c15 = 1, Hr10c14 = 0
adjacent-3s-in-r7{c12 c13} ==> Vr7c14 = 1, Vr7c13 = 1, Vr7c12 = 1, Vr8c13 = 0, Vr6c13 = 0
adjacent-3s-in-r1{c5 c6} ==> Vr1c6 = 1
w[1]-2-in-r2c5-open-ne-corner ==> Hr3c5 = 1, Vr2c5 = 1
w[1]-3-in-r1c5-closed-ne-corner ==> Pr2c5 ≠ sw, Pr2c5 ≠ ne
w[1]-3-in-r1c6-closed-sw-corner ==> Pr1c7 ≠ sw, Pr1c7 ≠ o
w[1]-diagonal-closed-3-1-in-{r4c8...r3c9} ==> Vr3c10 = 0, Hr3c9 = 0
w[1]-diagonal-1-1-in-{r3c9...r2c8}-with-no-nw-inner-sides ==> Vr2c9 = 0
w[1]-diagonal-closed-3-1-in-{r3c6...r4c5} ==> Hr5c5 = 0
w[1]-diagonal-closed-3-1-in-{r3c3...r4c2} ==> Vr4c2 = 0, Hr5c2 = 0
w[1]-1-in-r11c11-asymmetric-nw-corner ==> Pr12c12 ≠ ew, Pr12c12 ≠ ns
w[1]-1-in-r4c5-asymmetric-ne-corner ==> Pr5c5 ≠ ew, Pr5c5 ≠ se, Pr5c5 ≠ nw, Pr5c5 ≠ ns
w[1]-1-in-r4c2-asymmetric-ne-corner ==> Pr5c2 ≠ ew, Pr5c2 ≠ se, Pr5c2 ≠ nw, Pr5c2 ≠ ns
w[1]-1-in-r3c9-asymmetric-sw-corner ==> Pr3c10 ≠ ew, Pr3c10 ≠ se, Pr3c10 ≠ nw, Pr3c10 ≠ ns
w[1]-1-in-r3c4-asymmetric-nw-corner ==> Pr4c5 ≠ sw, Pr4c5 ≠ ew, Pr4c5 ≠ ns, Pr4c5 ≠ ne
w[1]-1-in-r4c5-symmetric-nw-corner ==> Pr5c6 ≠ se, Pr5c6 ≠ nw, Pr5c6 ≠ o
w[1]-1-in-r2c8-asymmetric-sw-corner ==> Pr2c9 ≠ ew, Pr2c9 ≠ se, Pr2c9 ≠ nw, Pr2c9 ≠ ns
entering level Loop with <Fact-198315>
entering level Col with <Fact-198431>
horizontal-line-{r15 r16}c9 ==> Ir15c9 = in
no-horizontal-line-{r15 r16}c8 ==> Ir15c8 = out
vertical-line-r15{c7 c8} ==> Ir15c7 = in
no-horizontal-line-{r0 r1}c13 ==> Ir1c13 = out
no-vertical-line-r1{c12 c13} ==> Ir1c12 = out
no-vertical-line-r1{c11 c12} ==> Ir1c11 = out
no-horizontal-line-{r1 r2}c12 ==> Ir2c12 = out
no-vertical-line-r2{c12 c13} ==> Ir2c13 = out
vertical-line-r2{c13 c14} ==> Ir2c14 = in
no-horizontal-line-{r2 r3}c14 ==> Ir3c14 = in
no-vertical-line-r3{c13 c14} ==> Ir3c13 = in
vertical-line-r3{c12 c13} ==> Ir3c12 = out
no-horizontal-line-{r3 r4}c12 ==> Ir4c12 = out
no-vertical-line-r4{c12 c13} ==> Ir4c13 = out
vertical-line-r4{c13 c14} ==> Ir4c14 = in
no-vertical-line-r3{c14 c15} ==> Ir3c15 = in
no-vertical-line-r1{c13 c14} ==> Ir1c14 = out
no-horizontal-line-{r0 r1}c6 ==> Ir1c6 = out
vertical-line-r1{c5 c6} ==> Ir1c5 = in
no-horizontal-line-{r1 r2}c5 ==> Ir2c5 = in
no-vertical-line-r2{c5 c6} ==> Ir2c6 = in
no-vertical-line-r2{c6 c7} ==> Ir2c7 = in
no-horizontal-line-{r1 r2}c7 ==> Ir1c7 = in
no-horizontal-line-{r2 r3}c7 ==> Ir3c7 = in
no-horizontal-line-{r3 r4}c7 ==> Ir4c7 = in
no-vertical-line-r4{c6 c7} ==> Ir4c6 = in
horizontal-line-{r3 r4}c6 ==> Ir3c6 = out
no-horizontal-line-{r4 r5}c7 ==> Ir5c7 = in
no-vertical-line-r5{c7 c8} ==> Ir5c8 = in
no-vertical-line-r5{c8 c9} ==> Ir5c9 = in
no-horizontal-line-{r4 r5}c9 ==> Ir4c9 = in
vertical-line-r4{c8 c9} ==> Ir4c8 = out
vertical-line-r3{c7 c8} ==> Ir3c8 = out
no-vertical-line-r3{c8 c9} ==> Ir3c9 = out
no-vertical-line-r3{c9 c10} ==> Ir3c10 = out
no-horizontal-line-{r2 r3}c9 ==> Ir2c9 = out
no-vertical-line-r2{c8 c9} ==> Ir2c8 = out
vertical-line-r2{c4 c5} ==> Ir2c4 = out
no-vertical-line-r2{c3 c4} ==> Ir2c3 = out
vertical-line-r2{c2 c3} ==> Ir2c2 = in
no-horizontal-line-{r1 r2}c2 ==> Ir1c2 = in
no-vertical-line-r1{c2 c3} ==> Ir1c3 = in
vertical-line-r1{c3 c4} ==> Ir1c4 = out
no-horizontal-line-{r2 r3}c2 ==> Ir3c2 = in
no-vertical-line-r3{c2 c3} ==> Ir3c3 = in
vertical-line-r3{c3 c4} ==> Ir3c4 = out
no-vertical-line-r3{c4 c5} ==> Ir3c5 = out
no-horizontal-line-{r3 r4}c5 ==> Ir4c5 = out
no-vertical-line-r4{c4 c5} ==> Ir4c4 = out
no-vertical-line-r4{c3 c4} ==> Ir4c3 = out
no-horizontal-line-{r4 r5}c5 ==> Ir5c5 = out
no-vertical-line-r5{c5 c6} ==> Ir5c6 = out
no-horizontal-line-{r5 r6}c5 ==> Ir6c5 = out
different-colours-in-r5{c6 c7} ==> Hr5c7 = 1
different-colours-in-{r4 r5}c6 ==> Hr5c6 = 1
different-colours-in-r4{c5 c6} ==> Hr4c6 = 1
different-colours-in-{r0 r1}c3 ==> Hr1c3 = 1
different-colours-in-{r0 r1}c2 ==> Hr1c2 = 1
different-colours-in-r2{c7 c8} ==> Hr2c8 = 1
different-colours-in-{r3 r4}c9 ==> Hr4c9 = 1
different-colours-in-{r0 r1}c7 ==> Hr1c7 = 1
different-colours-in-{r1 r2}c14 ==> Hr2c14 = 1
same-colour-in-{r0 r1}c14 ==> Hr1c14 = 0
w[1]-2-in-r1c14-open-nw-corner ==> Vr1c15 = 1, Hr2c15 = 0, Vr2c15 = 0
no-vertical-line-r2{c14 c15} ==> Ir2c15 = in
no-horizontal-line-{r1 r2}c15 ==> Ir1c15 = in
different-colours-in-r1{c15 c16} ==> Hr1c16 = 1
different-colours-in-{r0 r1}c15 ==> Hr1c15 = 1
same-colour-in-{r2 r3}c15 ==> Hr3c15 = 0
different-colours-in-r2{c15 c16} ==> Hr2c16 = 1
different-colours-in-r3{c15 c16} ==> Hr3c16 = 1
same-colour-in-{r0 r1}c11 ==> Hr1c11 = 0
different-colours-in-r15{c8 c9} ==> Hr15c9 = 1
w[1]-3-in-r15c9-closed-sw-corner ==> Pr15c10 ≠ sw, Pr15c10 ≠ ne, Pr15c10 ≠ o
w[1]-diagonal-closed-3-1-in-{r15c9...r14c10} ==> Vr14c11 = 0, Hr14c10 = 0
w[1]-1-in-r14c10-asymmetric-sw-corner ==> Pr14c11 ≠ ew, Pr14c11 ≠ se, Pr14c11 ≠ nw, Pr14c11 ≠ ns
Starting_init_links_with_<Fact-198883>
2435 candidates, 18759 csp-links and 77449 links. Density = 2.61%
starting non trivial part of solution
Entering_level_W1_with_<Fact-391304>
whip[1]: Hr14c10{0 .} ==> Br14c10 ≠ n, Pr14c10 ≠ ne, Pr14c10 ≠ se, Pr14c10 ≠ ew, Pr14c11 ≠ sw, Br13c10 ≠ s, Br13c10 ≠ ns, Br13c10 ≠ se, Br13c10 ≠ sw, Br13c10 ≠ esw, Br13c10 ≠ swn, Br13c10 ≠ nes
whip[1]: Pr14c11{ne .} ==> Br14c10 ≠ e, Br14c11 ≠ w, Br14c11 ≠ nw, Br14c11 ≠ ew, Br14c11 ≠ sw, Br14c11 ≠ esw, Br14c11 ≠ swn, Br14c11 ≠ wne
whip[1]: Br14c11{nes .} ==> Pr15c11 ≠ ne, Pr15c11 ≠ ns, Pr15c11 ≠ nw
whip[1]: Vr15c9{1 .} ==> Br15c9 ≠ nes, Br15c8 ≠ o, Pr16c9 ≠ o, Pr16c9 ≠ ew, Pr15c9 ≠ o, Pr15c9 ≠ ne, Pr15c9 ≠ nw, Pr15c9 ≠ ew, Br15c8 ≠ n, Br15c8 ≠ s, Br15c8 ≠ w, Br15c8 ≠ ns, Br15c8 ≠ nw, Br15c8 ≠ sw, Br15c8 ≠ swn
whip[1]: Br15c8{nes .} ==> Nr15c8 ≠ 0
whip[1]: Pr15c9{sw .} ==> Br14c8 ≠ se, Br14c9 ≠ sw, Br14c9 ≠ esw, Br14c9 ≠ swn
whip[1]: Br14c8{sw .} ==> Pr14c8 ≠ o, Pr14c8 ≠ nw
whip[1]: Pr14c8{sw .} ==> Br13c7 ≠ se, Br13c7 ≠ esw, Br13c7 ≠ nes
whip[1]: Br15c9{wne .} ==> Pr16c10 ≠ o
whip[1]: Pr16c10{ew .} ==> Br15c10 ≠ n, Br15c10 ≠ e
whip[1]: Br15c10{w .} ==> Pr16c10 ≠ ne, Pr16c11 ≠ ne, Pr16c11 ≠ nw, Pr15c10 ≠ se, Pr15c10 ≠ ew, Pr15c11 ≠ se, Pr15c11 ≠ ew, Pr15c11 ≠ sw
P-single: Pr15c11 = o
w[1]-1-in-r14c10-symmetric-se-corner ==> Pr14c10 ≠ nw, Pr14c10 ≠ o
whip[1]: Pr15c11{o .} ==> Hr15c11 ≠ 1, Br14c10 ≠ s, Br14c11 ≠ s, Br14c11 ≠ ns, Br14c11 ≠ se, Br14c11 ≠ nes, Br15c11 ≠ n, Br15c11 ≠ w, Br15c11 ≠ ne, Br15c11 ≠ ns, Br15c11 ≠ nw, Br15c11 ≠ ew, Br15c11 ≠ sw, Br15c11 ≠ esw, Br15c11 ≠ swn, Br15c11 ≠ wne, Br15c11 ≠ nes
H-single: Hr15c11 = 0
B-single: Br14c10 = w
whip[1]: Hr15c11{0 .} ==> Pr15c12 ≠ nw, Pr15c12 ≠ ew, Pr15c12 ≠ sw
whip[1]: Br14c10{w .} ==> Vr14c10 ≠ 0
V-single: Vr14c10 = 1
whip[1]: Vr14c10{1 .} ==> Br14c9 ≠ o, Br14c9 ≠ n, Br14c9 ≠ s, Br14c9 ≠ w, Br14c9 ≠ ns, Br14c9 ≠ nw
whip[1]: Br14c9{nes .} ==> Nr14c9 ≠ 0
whip[1]: Br15c11{se .} ==> Nr15c11 ≠ 3
whip[1]: Br14c11{ne .} ==> Nr14c11 ≠ 3
whip[1]: Pr14c10{sw .} ==> Br13c9 ≠ nw, Br13c9 ≠ se, Br13c9 ≠ esw, Br13c9 ≠ nes, Br13c9 ≠ o, Br13c9 ≠ n, Br13c9 ≠ w
whip[1]: Br13c9{wne .} ==> Nr13c9 ≠ 0
whip[1]: Pr15c10{nw .} ==> Br15c9 ≠ wne
whip[1]: Br15c9{swn .} ==> Pr16c9 ≠ nw
P-single: Pr16c9 = ne
whip[1]: Pr16c9{ne .} ==> Br16c9 ≠ o, Br16c8 ≠ n, Br15c8 ≠ se, Br15c8 ≠ esw, Br15c8 ≠ nes
B-single: Br16c8 = o
B-single: Br16c9 = n
whip[1]: Br16c8{o .} ==> Pr16c8 ≠ ne, Pr16c8 ≠ ew
whip[1]: Pr16c8{nw .} ==> Br15c7 ≠ swn, Br15c7 ≠ wne
whip[1]: Br15c7{nes .} ==> Pr16c7 ≠ o, Pr16c7 ≠ nw, Pr16c8 ≠ o, Pr15c8 ≠ o, Pr15c8 ≠ ne, Pr15c8 ≠ nw, Pr15c8 ≠ ew
P-single: Pr16c8 = nw
whip[1]: Pr16c8{nw .} ==> Br15c8 ≠ e, Br16c7 ≠ o, Br15c8 ≠ ne
B-single: Br16c7 = n
whip[1]: Br15c8{wne .} ==> Nr15c8 ≠ 1
whip[1]: Pr15c8{sw .} ==> Br14c7 ≠ se, Br14c7 ≠ esw, Br14c7 ≠ nes, Br14c8 ≠ sw
whip[1]: Br14c8{ew .} ==> Pr14c9 ≠ o, Pr14c9 ≠ ne
whip[1]: Pr14c9{sw .} ==> Br13c9 ≠ sw, Br13c9 ≠ swn
whip[1]: Pr16c7{ew .} ==> Br15c6 ≠ nw, Br15c6 ≠ se, Br15c6 ≠ esw, Br15c6 ≠ nes, Br15c6 ≠ o, Br15c6 ≠ n, Br15c6 ≠ w
whip[1]: Br15c6{wne .} ==> Nr15c6 ≠ 0
whip[1]: Hr1c11{0 .} ==> Br1c11 ≠ nes, Br0c11 ≠ s, Pr1c11 ≠ se, Pr1c11 ≠ ew, Pr1c12 ≠ ew, Pr1c12 ≠ sw, Br1c11 ≠ n, Br1c11 ≠ ne, Br1c11 ≠ ns, Br1c11 ≠ nw, Br1c11 ≠ swn, Br1c11 ≠ wne
B-single: Br0c11 = o
whip[1]: Pr1c11{sw .} ==> Br1c10 ≠ nw, Br1c10 ≠ se, Br1c10 ≠ ew, Br1c10 ≠ esw, Br1c10 ≠ swn, Br1c10 ≠ n, Br1c10 ≠ e, Br1c10 ≠ ns
whip[1]: Vr3c16{1 .} ==> Br3c15 ≠ swn, Br3c16 ≠ o, Br3c15 ≠ o, Pr3c16 ≠ o, Pr3c16 ≠ nw, Pr4c16 ≠ o, Pr4c16 ≠ sw, Br3c15 ≠ n, Br3c15 ≠ s, Br3c15 ≠ w, Br3c15 ≠ ns, Br3c15 ≠ nw, Br3c15 ≠ sw
B-single: Br3c16 = w
whip[1]: Br3c15{nes .} ==> Nr3c15 ≠ 0
whip[1]: Pr4c16{nw .} ==> Br4c15 ≠ w, Br4c15 ≠ ne, Br4c15 ≠ sw, Br4c15 ≠ wne, Br4c15 ≠ nes, Br4c15 ≠ o, Br4c15 ≠ s
whip[1]: Br4c15{swn .} ==> Nr4c15 ≠ 0
whip[1]: Pr3c16{sw .} ==> Br2c15 ≠ nw, Br2c15 ≠ se, Br2c15 ≠ esw, Br2c15 ≠ nes, Br2c15 ≠ o, Br2c15 ≠ n, Br2c15 ≠ w
whip[1]: Br2c15{wne .} ==> Nr2c15 ≠ 0
whip[1]: Vr2c16{1 .} ==> Br2c15 ≠ swn, Br2c16 ≠ o, Pr2c16 ≠ o, Pr2c16 ≠ nw, Pr3c16 ≠ sw, Br2c15 ≠ s, Br2c15 ≠ ns, Br2c15 ≠ sw
P-single: Pr3c16 = ns
B-single: Br2c16 = w
whip[1]: Pr3c16{ns .} ==> Br3c15 ≠ ne, Br3c15 ≠ wne, Br3c15 ≠ nes
whip[1]: Br3c15{esw .} ==> Pr3c15 ≠ ne, Pr3c15 ≠ se, Pr3c15 ≠ ew
whip[1]: Pr2c16{sw .} ==> Br1c15 ≠ nes, Br1c15 ≠ o, Br1c15 ≠ w
whip[1]: Br1c15{wne .} ==> Nr1c15 ≠ 0
whip[1]: Hr1c15{1 .} ==> Br1c15 ≠ sw, Br0c15 ≠ o, Pr1c16 ≠ o, Br1c15 ≠ s
P-single: Pr1c16 = sw
B-single: Br0c15 = s
whip[1]: Br1c15{wne .} ==> Pr2c16 ≠ sw, Pr2c15 ≠ ne, Pr2c15 ≠ ew, Nr1c15 ≠ 1
P-single: Pr2c16 = ns
whip[1]: Pr2c16{ns .} ==> Br2c15 ≠ ne, Br2c15 ≠ wne
whip[1]: Br2c15{ew .} ==> Nr2c15 ≠ 3
whip[1]: Pr2c15{sw .} ==> Br1c14 ≠ nw, Br2c14 ≠ sw, Br2c14 ≠ o, Br2c14 ≠ s, Br2c14 ≠ w
whip[1]: Br2c14{nes .} ==> Nr2c14 ≠ 0
whip[1]: Vr2c15{0 .} ==> Br2c15 ≠ ew, Pr2c15 ≠ ns, Pr2c15 ≠ sw, Pr3c15 ≠ ns, Pr3c15 ≠ nw, Br2c14 ≠ e, Br2c14 ≠ ne, Br2c14 ≠ se, Br2c14 ≠ ew, Br2c14 ≠ esw, Br2c14 ≠ wne, Br2c14 ≠ nes
P-single: Pr1c14 = o
P-single: Pr2c15 = nw
B-single: Br2c15 = e
whip[1]: Pr1c14{o .} ==> Vr1c14 ≠ 1, Hr1c13 ≠ 1, Br1c14 ≠ ne, Br1c14 ≠ ns, Br1c14 ≠ ew, Br1c14 ≠ sw
B-single: Br1c14 = se
whip[1]: Br1c14{se .} ==> Pr2c14 ≠ nw, Pr2c14 ≠ ns, Pr1c15 ≠ ew
P-single: Pr1c15 = se
whip[1]: Pr1c15{se .} ==> Br1c15 ≠ ne
B-single: Br1c15 = wne
whip[1]: Br1c15{wne .} ==> Nr1c15 ≠ 2
N-single: Nr1c15 = 3
whip[1]: Pr2c14{ew .} ==> Br2c13 ≠ sw, Br2c13 ≠ wne, Br2c13 ≠ nes, Br2c13 ≠ o, Br2c13 ≠ s, Br2c13 ≠ w, Br2c13 ≠ ne
whip[1]: Br2c13{swn .} ==> Nr2c13 ≠ 0
whip[1]: Br2c15{e .} ==> Nr2c15 ≠ 2
N-single: Nr2c15 = 1
whip[1]: Hr1c14{0 .} ==> Br0c14 ≠ s
B-single: Br0c14 = o
whip[1]: Hr1c7{1 .} ==> Br1c7 ≠ esw, Br0c7 ≠ o, Br1c7 ≠ o, Pr1c8 ≠ o, Pr1c8 ≠ se, Br1c7 ≠ e, Br1c7 ≠ s, Br1c7 ≠ w, Br1c7 ≠ se, Br1c7 ≠ ew, Br1c7 ≠ sw
B-single: Br0c7 = s
whip[1]: Pr2c9{sw .} ==> Br1c8 ≠ nw, Br1c8 ≠ se, Br1c9 ≠ nw, Br1c9 ≠ se, Br1c9 ≠ ew, Br1c9 ≠ wne, Br1c9 ≠ nes, Br2c9 ≠ nw, Br2c9 ≠ se, Br2c9 ≠ swn, Br2c9 ≠ wne, Br1c9 ≠ s, Br1c9 ≠ w, Br1c9 ≠ ns, Br2c8 ≠ n, Br2c8 ≠ e, Br2c9 ≠ o, Br2c9 ≠ e, Br2c9 ≠ s
whip[1]: Br2c9{nes .} ==> Nr2c9 ≠ 0
whip[1]: Br2c8{w .} ==> Hr2c8 ≠ 1, Pr2c8 ≠ ne, Pr3c9 ≠ ne, Pr3c9 ≠ ns, Pr3c9 ≠ nw, Pr2c8 ≠ se, Pr2c8 ≠ ew, Pr2c9 ≠ sw
H-single: Hr2c8 = 0
P-single: Pr2c9 = ne
no-horizontal-line-{r1 r2}c8 ==> Ir1c8 = out
same-colour-in-{r0 r1}c8 ==> Hr1c8 = 0
different-colours-in-r1{c7 c8} ==> Hr1c8 = 1
whip[1]: Hr2c8{0 .} ==> Br1c8 ≠ ns, Br1c8 ≠ sw
whip[1]: Br1c8{ew .} ==> Vr1c9 ≠ 0, Pr1c9 ≠ ew
V-single: Vr1c9 = 1
P-single: Pr1c9 = se
vertical-line-r1{c8 c9} ==> Ir1c9 = in
different-colours-in-{r1 r2}c9 ==> Hr2c9 = 1
different-colours-in-{r0 r1}c9 ==> Hr1c9 = 1
whip[1]: Vr1c9{1 .} ==> Br1c9 ≠ o, Br1c9 ≠ n, Br1c9 ≠ e, Br1c9 ≠ ne
whip[1]: Br1c9{swn .} ==> Pr1c10 ≠ sw, Pr2c10 ≠ o, Pr2c10 ≠ ne, Pr2c10 ≠ ns, Pr2c10 ≠ se, Nr1c9 ≠ 0, Nr1c9 ≠ 1
whip[1]: Pr2c10{sw .} ==> Br1c10 ≠ sw, Br2c9 ≠ ew, Br2c9 ≠ sw, Br2c9 ≠ esw, Br2c10 ≠ nw, Br2c10 ≠ swn, Br2c10 ≠ wne, Br2c9 ≠ w
whip[1]: Pr1c10{ew .} ==> Br1c10 ≠ w
whip[1]: Pr1c9{se .} ==> Br1c8 ≠ ne, Br1c9 ≠ sw, Br1c9 ≠ esw
B-single: Br1c9 = swn
B-single: Br1c8 = ew
whip[1]: Br1c9{swn .} ==> Nr1c9 ≠ 2, Pr2c10 ≠ nw, Pr1c10 ≠ se, Pr1c10 ≠ o, Vr1c10 ≠ 1
V-single: Vr1c10 = 0
N-single: Nr1c9 = 3
P-single: Pr1c10 = ew
no-vertical-line-r1{c9 c10} ==> Ir1c10 = in
different-colours-in-r1{c10 c11} ==> Hr1c11 = 1
different-colours-in-{r0 r1}c10 ==> Hr1c10 = 1

LOOP[6]: Vr1c11-Hr1c10-Hr1c9-Vr1c9-Hr2c9- ==> Hr2c10 = 0
no-horizontal-line-{r1 r2}c10 ==> Ir2c10 = in
different-colours-in-{r2 r3}c10 ==> Hr3c10 = 1
different-colours-in-r2{c9 c10} ==> Hr2c10 = 1

LOOP[8]: Hr3c10-Vr2c10-Hr2c9-Vr1c9-Hr1c9-Hr1c10-Vr1c11- ==> Vr2c11 = 0
no-vertical-line-r2{c10 c11} ==> Ir2c11 = in
different-colours-in-r2{c11 c12} ==> Hr2c12 = 1
different-colours-in-{r1 r2}c11 ==> Hr2c11 = 1

LOOP[10]: Vr2c12-Hr2c11-Vr1c11-Hr1c10-Hr1c9-Vr1c9-Hr2c9-Vr2c10-Hr3c10- ==> Hr3c11 = 0
no-horizontal-line-{r2 r3}c11 ==> Ir3c11 = in
different-colours-in-r3{c11 c12} ==> Hr3c12 = 1
different-colours-in-r3{c10 c11} ==> Hr3c11 = 1

LOOP[12]: Vr3c11-Hr3c10-Vr2c10-Hr2c9-Vr1c9-Hr1c9-Hr1c10-Vr1c11-Hr2c11-Vr2c12-Vr3c12- ==> Hr4c11 = 0
no-horizontal-line-{r3 r4}c11 ==> Ir4c11 = in
different-colours-in-r4{c11 c12} ==> Hr4c12 = 1
whip[1]: Vr1c10{0 .} ==> Br1c10 ≠ wne
whip[1]: Pr1c10{ew .} ==> Br1c10 ≠ s, Br1c10 ≠ o
whip[1]: Br1c10{nes .} ==> Pr1c11 ≠ o, Pr2c11 ≠ o, Pr2c11 ≠ se, Pr2c11 ≠ ew, Pr2c11 ≠ sw, Nr1c10 ≠ 0, Nr1c10 ≠ 1
P-single: Pr1c11 = sw
whip[1]: Pr1c11{sw .} ==> Br1c11 ≠ s, Br1c11 ≠ e, Br1c11 ≠ o, Br1c11 ≠ se
whip[1]: Br1c11{esw .} ==> Nr1c11 ≠ 0
whip[1]: Pr2c11{nw .} ==> Br2c10 ≠ ne, Br2c10 ≠ nes, Br2c11 ≠ nw, Br2c11 ≠ swn, Br2c11 ≠ wne
whip[1]: Hr1c10{1 .} ==> Br0c10 ≠ o
B-single: Br0c10 = s
whip[1]: Hr2c10{0 .} ==> Pr2c10 ≠ ew, Pr2c11 ≠ nw, Br1c10 ≠ nes, Br2c10 ≠ n, Br2c10 ≠ ns
P-single: Pr2c10 = sw
B-single: Br1c10 = ne
whip[1]: Pr2c10{sw .} ==> Br2c10 ≠ s, Br2c10 ≠ e, Br2c10 ≠ o, Br2c9 ≠ ns, Br2c9 ≠ n, Br2c10 ≠ se
whip[1]: Br2c10{esw .} ==> Pr3c10 ≠ o, Pr3c10 ≠ sw, Nr2c10 ≠ 0
P-single: Pr3c10 = ne
whip[1]: Pr3c10{ne .} ==> Br3c10 ≠ o, Br3c9 ≠ n, Br2c9 ≠ nes, Br2c10 ≠ w, Br2c10 ≠ ew, Br3c9 ≠ e, Br3c10 ≠ e, Br3c10 ≠ s, Br3c10 ≠ w, Br3c10 ≠ nw, Br3c10 ≠ se, Br3c10 ≠ ew, Br3c10 ≠ sw, Br3c10 ≠ esw, Br3c10 ≠ swn, Br3c10 ≠ wne
B-single: Br2c9 = ne
whip[1]: Br2c9{ne .} ==> Nr2c9 ≠ 3, Nr2c9 ≠ 1, Pr3c9 ≠ se, Pr3c9 ≠ ew
N-single: Nr2c9 = 2
w[1]-1-in-r3c8-symmetric-ne-corner ==> Pr4c8 ≠ sw, Pr4c8 ≠ ne
whip[1]: Pr4c8{ew .} ==> Br3c7 ≠ nw, Br3c7 ≠ se, Br4c7 ≠ sw, Br4c7 ≠ wne, Br4c7 ≠ nes, Br4c8 ≠ swn, Br4c8 ≠ wne, Br3c8 ≠ n, Br3c8 ≠ e, Br4c7 ≠ o, Br4c7 ≠ s, Br4c7 ≠ w, Br4c7 ≠ ne
whip[1]: Br4c7{swn .} ==> Nr4c7 ≠ 0
whip[1]: Br3c8{w .} ==> Pr4c9 ≠ ns, Pr4c9 ≠ nw, Pr3c8 ≠ se, Pr3c8 ≠ ew, Pr3c9 ≠ sw
P-single: Pr3c9 = o
w[1]-1-in-r2c8-symmetric-se-corner ==> Pr2c8 ≠ nw
P-single: Pr2c8 = ns
w[1]-1-in-r3c9-symmetric-nw-corner ==> Pr4c10 ≠ se, Pr4c10 ≠ nw, Pr4c10 ≠ o
whip[1]: Pr3c9{o .} ==> Br2c8 ≠ s, Br3c9 ≠ w
B-single: Br3c9 = s
B-single: Br2c8 = w
whip[1]: Br3c9{s .} ==> Pr4c10 ≠ ns, Pr4c10 ≠ ne
whip[1]: Pr4c10{sw .} ==> Br4c9 ≠ se, Br4c9 ≠ ew, Br4c9 ≠ sw, Br4c9 ≠ esw, Br4c10 ≠ nw, Br4c10 ≠ se, Br4c9 ≠ o, Br4c9 ≠ e, Br4c9 ≠ s, Br4c9 ≠ w
whip[1]: Br4c9{nes .} ==> Nr4c9 ≠ 0
whip[1]: Pr2c8{ns .} ==> Br2c7 ≠ n, Br2c7 ≠ o, Br1c7 ≠ n, Br1c7 ≠ ns, Br1c7 ≠ nw, Br1c7 ≠ swn, Br1c7 ≠ nes, Br2c7 ≠ s, Br2c7 ≠ w, Br2c7 ≠ ne, Br2c7 ≠ ns, Br2c7 ≠ nw, Br2c7 ≠ sw, Br2c7 ≠ swn, Br2c7 ≠ wne, Br2c7 ≠ nes
whip[1]: Br2c7{esw .} ==> Pr2c7 ≠ se, Pr2c7 ≠ ew, Nr2c7 ≠ 0
whip[1]: Pr2c7{nw .} ==> Br1c6 ≠ swn, Br1c7 ≠ ne, Br2c6 ≠ ne, Br2c6 ≠ sw
B-single: Br1c7 = wne
whip[1]: Br1c7{wne .} ==> Nr1c7 ≠ 2, Nr1c7 ≠ 1, Nr1c7 ≠ 0, Pr1c8 ≠ ew, Pr1c7 ≠ ew
N-single: Nr1c7 = 3
P-single: Pr1c7 = se
P-single: Pr1c8 = sw
whip[1]: Pr1c7{se .} ==> Br1c6 ≠ wne, Br1c6 ≠ nes
B-single: Br1c6 = esw
whip[1]: Br1c6{esw .} ==> Pr2c7 ≠ ns, Pr2c6 ≠ ew, Pr2c6 ≠ ns, Pr1c6 ≠ ew
P-single: Pr3c5 = ne
P-single: Pr1c6 = sw
P-single: Pr2c6 = ne
P-single: Pr2c7 = nw
w[1]-1-in-r3c4-symmetric-ne-corner ==> Pr4c4 ≠ sw, Pr4c4 ≠ ne, Pr4c4 ≠ o
whip[1]: Pr3c5{ne .} ==> Br3c5 ≠ o, Br3c4 ≠ n, Br2c4 ≠ n, Br2c4 ≠ o, Br2c4 ≠ s, Br2c4 ≠ w, Br2c4 ≠ ns, Br2c4 ≠ nw, Br2c4 ≠ se, Br2c4 ≠ sw, Br2c4 ≠ esw, Br2c4 ≠ swn, Br2c4 ≠ nes, Br2c5 ≠ ne, Br2c5 ≠ ns, Br2c5 ≠ nw, Br2c5 ≠ se, Br2c5 ≠ ew, Br3c4 ≠ e, Br3c5 ≠ e, Br3c5 ≠ s, Br3c5 ≠ w, Br3c5 ≠ nw, Br3c5 ≠ se, Br3c5 ≠ ew, Br3c5 ≠ sw, Br3c5 ≠ esw, Br3c5 ≠ swn, Br3c5 ≠ wne
B-single: Br2c5 = sw
whip[1]: Br2c5{sw .} ==> Pr3c6 ≠ ns, Pr2c5 ≠ ew
P-single: Pr2c5 = ns
P-single: Pr3c6 = ew
whip[1]: Pr2c5{ns .} ==> Br1c4 ≠ ns, Br1c4 ≠ nw, Br1c4 ≠ se, Br1c4 ≠ sw, Br1c5 ≠ esw, Br1c5 ≠ swn, Br1c5 ≠ nes, Br2c4 ≠ ne, Br2c4 ≠ wne
B-single: Br1c5 = wne
whip[1]: Br1c5{wne .} ==> Pr1c5 ≠ ew
P-single: Pr1c5 = se
whip[1]: Pr1c5{se .} ==> Br1c4 ≠ ne
B-single: Br1c4 = ew
whip[1]: Br1c4{ew .} ==> Pr2c4 ≠ ew, Pr2c4 ≠ se, Pr1c4 ≠ ew
P-single: Pr1c4 = sw
whip[1]: Pr1c4{sw .} ==> Br1c3 ≠ ns, Br1c3 ≠ w, Br1c3 ≠ s, Br1c3 ≠ e, Br1c3 ≠ n, Br1c3 ≠ o, Br1c3 ≠ nw, Br1c3 ≠ se, Br1c3 ≠ ew, Br1c3 ≠ sw, Br1c3 ≠ esw, Br1c3 ≠ swn
whip[1]: Br1c3{nes .} ==> Pr1c3 ≠ o, Pr1c3 ≠ sw, Pr2c3 ≠ ne, Nr1c3 ≠ 0, Nr1c3 ≠ 1
whip[1]: Pr1c3{ew .} ==> Br1c2 ≠ sw, Br1c2 ≠ wne, Br1c2 ≠ nes, Br1c2 ≠ o, Br1c2 ≠ s, Br1c2 ≠ w, Br1c2 ≠ ne
whip[1]: Br1c2{swn .} ==> Nr1c2 ≠ 0
whip[1]: Pr2c4{nw .} ==> Br2c3 ≠ wne, Br2c3 ≠ nes
whip[1]: Br2c3{swn .} ==> Pr2c3 ≠ o, Pr2c3 ≠ nw, Pr2c3 ≠ ew, Pr3c3 ≠ ns, Pr3c3 ≠ ew, Pr3c3 ≠ sw, Pr3c4 ≠ ne, Pr3c4 ≠ ns
P-single: Pr3c3 = ne
whip[1]: Pr3c3{ne .} ==> Br3c2 ≠ n, Br2c2 ≠ n, Br2c2 ≠ o, Br2c2 ≠ s, Br2c2 ≠ w, Br2c2 ≠ ns, Br2c2 ≠ nw, Br2c2 ≠ se, Br2c2 ≠ sw, Br2c2 ≠ esw, Br2c2 ≠ swn, Br2c2 ≠ nes, Br3c2 ≠ e, Br3c2 ≠ ne, Br3c2 ≠ ns, Br3c2 ≠ nw, Br3c2 ≠ se, Br3c2 ≠ ew, Br3c2 ≠ esw, Br3c2 ≠ swn, Br3c2 ≠ wne, Br3c2 ≠ nes, Br3c3 ≠ esw, Br3c3 ≠ swn, Br3c3 ≠ wne
B-single: Br3c3 = nes
whip[1]: Br3c3{nes .} ==> Pr4c4 ≠ ew, Pr4c4 ≠ se, Pr4c4 ≠ ns, Pr4c3 ≠ nw, Pr4c3 ≠ ns, Pr3c4 ≠ ew
P-single: Pr3c4 = sw
P-single: Pr4c4 = nw
w[1]-1-in-r4c4-symmetric-nw-corner ==> Pr5c5 ≠ o
w[1]-1-in-r5c5-asymmetric-nw-corner ==> Pr6c6 ≠ sw, Pr6c6 ≠ ew, Pr6c6 ≠ ns, Pr6c6 ≠ ne
w[1]-3-in-r7c9-asymmetric-sw-corner ==> Vr7c10 = 1, Hr7c9 = 1, Vr6c10 = 0, Hr7c10 = 0
w[1]-3-in-r7c5-asymmetric-ne-corner ==> Vr7c5 = 1, Hr8c5 = 1, Vr8c5 = 0, Hr8c4 = 0
w[1]-2-in-r8c4-open-ne-corner ==> Hr9c4 = 1, Vr8c4 = 1, Hr9c3 = 0, Vr9c4 = 0
w[1]-adjacent-1-3-on-pseudo-edge-in-{r8 r7}c5 ==> Vr8c6 = 0, Hr9c5 = 0
w[1]-1-in-r8c6-asymmetric-ne-corner ==> Pr9c6 ≠ ew, Pr9c6 ≠ se, Pr9c6 ≠ nw, Pr9c6 ≠ ns
whip[1]: Pr3c4{sw .} ==> Br3c4 ≠ s, Br2c3 ≠ esw, Br2c4 ≠ ew
B-single: Br2c4 = e
B-single: Br2c3 = swn
B-single: Br3c4 = w
whip[1]: Br2c4{e .} ==> Nr2c4 ≠ 2, Nr2c4 ≠ 0, Pr2c4 ≠ ns, Nr2c4 ≠ 3
N-single: Nr2c4 = 1
P-single: Pr2c4 = nw
whip[1]: Pr2c4{nw .} ==> Br1c3 ≠ ne, Br1c3 ≠ wne
B-single: Br1c3 = nes
whip[1]: Br1c3{nes .} ==> Nr1c3 ≠ 2, Pr2c3 ≠ sw, Pr2c3 ≠ ns, Pr1c3 ≠ se
N-single: Nr1c3 = 3
P-single: Pr1c3 = ew
P-single: Pr2c3 = se
whip[1]: Pr1c3{ew .} ==> Br1c2 ≠ e, Br1c2 ≠ se, Br1c2 ≠ ew, Br1c2 ≠ esw
whip[1]: Br1c2{swn .} ==> Pr1c2 ≠ o, Pr1c2 ≠ sw
whip[1]: Pr1c2{ew .} ==> Br1c1 ≠ wne, Br1c1 ≠ o, Br1c1 ≠ s
whip[1]: Br1c1{swn .} ==> Nr1c1 ≠ 0
whip[1]: Pr2c3{se .} ==> Br1c2 ≠ ns, Br1c2 ≠ swn, Br2c2 ≠ ne, Br2c2 ≠ wne
whip[1]: Br2c2{ew .} ==> Pr2c2 ≠ ne, Pr2c2 ≠ se, Pr2c2 ≠ ew, Pr3c2 ≠ ne, Pr3c2 ≠ se, Pr3c2 ≠ ew, Nr2c2 ≠ 0, Nr2c2 ≠ 3
whip[1]: Br1c2{nw .} ==> Nr1c2 ≠ 3
whip[1]: Br3c4{w .} ==> Pr4c5 ≠ nw
whip[1]: Pr4c5{se .} ==> Br4c4 ≠ n, Br4c5 ≠ n, Br4c5 ≠ w
whip[1]: Br4c5{s .} ==> Pr5c5 ≠ ne, Pr4c5 ≠ se, Pr4c6 ≠ nw, Pr4c6 ≠ ew
P-single: Pr4c5 = o
P-single: Pr5c5 = sw
w[1]-1-in-r4c4-symmetric-ne-corner ==> Pr5c4 ≠ sw, Pr5c4 ≠ ne, Pr5c4 ≠ o
whip[1]: Pr4c5{o .} ==> Br3c5 ≠ ns, Br3c5 ≠ nes, Br4c4 ≠ e
whip[1]: Br3c5{ne .} ==> Nr3c5 ≠ 0, Nr3c5 ≠ 3
whip[1]: Pr5c5{sw .} ==> Br5c5 ≠ s, Br5c5 ≠ e, Br5c5 ≠ n, Br5c4 ≠ ns, Br5c4 ≠ w, Br5c4 ≠ s, Br5c4 ≠ e, Br5c4 ≠ n, Br5c4 ≠ o, Br4c5 ≠ s, Br4c4 ≠ w, Vr5c5 ≠ 0, Hr5c4 ≠ 0, Br5c4 ≠ nw, Br5c4 ≠ se, Br5c4 ≠ ew, Br5c4 ≠ sw, Br5c4 ≠ esw, Br5c4 ≠ swn
H-single: Hr5c4 = 1
V-single: Vr5c5 = 1
B-single: Br4c4 = s
B-single: Br4c5 = e
B-single: Br5c5 = w
vertical-line-r5{c4 c5} ==> Ir5c4 = in
whip[1]: Hr5c4{1 .} ==> Pr5c4 ≠ ns, Pr5c4 ≠ nw
whip[1]: Pr5c4{ew .} ==> Br4c3 ≠ se, Br4c3 ≠ ew, Br4c3 ≠ esw, Br4c3 ≠ wne, Br4c3 ≠ nes, Br5c3 ≠ sw, Br5c3 ≠ wne, Br5c3 ≠ nes, Br4c3 ≠ e, Br4c3 ≠ ne, Br5c3 ≠ o, Br5c3 ≠ s, Br5c3 ≠ w, Br5c3 ≠ ne
whip[1]: Br5c3{swn .} ==> Nr5c3 ≠ 0
whip[1]: Vr5c5{1 .} ==> Pr6c5 ≠ o, Pr6c5 ≠ se, Pr6c5 ≠ ew, Pr6c5 ≠ sw
whip[1]: Pr6c5{nw .} ==> Br6c4 ≠ ne, Br6c4 ≠ wne, Br6c4 ≠ nes, Br6c5 ≠ nw, Br6c5 ≠ swn, Br6c5 ≠ wne
whip[1]: Br4c5{e .} ==> Pr5c6 ≠ ew, Pr5c6 ≠ sw
whip[1]: Pr5c6{ns .} ==> Br4c6 ≠ s, Br4c6 ≠ ne, Br4c6 ≠ ns, Br4c6 ≠ se, Br4c6 ≠ nes, Br5c6 ≠ s, Br5c6 ≠ nw, Br5c6 ≠ se, Br5c6 ≠ swn, Br5c6 ≠ wne, Br4c6 ≠ o, Br4c6 ≠ n, Br4c6 ≠ e, Br5c6 ≠ o, Br5c6 ≠ e
whip[1]: Br5c6{nes .} ==> Nr5c6 ≠ 0
whip[1]: Br4c6{wne .} ==> Nr4c6 ≠ 0
whip[1]: Br5c5{w .} ==> Pr6c6 ≠ nw, Pr6c5 ≠ ne, Pr5c6 ≠ ns
P-single: Pr5c6 = ne
whip[1]: Pr5c6{ne .} ==> Br4c6 ≠ w, Br4c6 ≠ nw, Br4c6 ≠ ew, Br4c6 ≠ wne, Br5c6 ≠ w, Br5c6 ≠ ew, Br5c6 ≠ sw, Br5c6 ≠ esw
whip[1]: Br5c6{nes .} ==> Pr5c7 ≠ o, Pr5c7 ≠ ne, Pr5c7 ≠ ns, Pr5c7 ≠ se
whip[1]: Pr5c7{sw .} ==> Br4c7 ≠ esw, Br4c7 ≠ swn, Br5c7 ≠ nw, Br5c7 ≠ swn, Br5c7 ≠ wne
whip[1]: Br4c7{ew .} ==> Nr4c7 ≠ 3
whip[1]: Br4c6{swn .} ==> Nr4c6 ≠ 1
whip[1]: Pr6c5{nw .} ==> Br6c4 ≠ w, Br6c4 ≠ sw, Br6c5 ≠ ne, Br6c5 ≠ ns, Br6c5 ≠ nes, Br6c4 ≠ o, Br6c4 ≠ s, Br6c5 ≠ n
whip[1]: Br6c4{swn .} ==> Nr6c4 ≠ 0
whip[1]: Pr6c6{se .} ==> Br6c6 ≠ ne, Br6c6 ≠ ns, Br6c6 ≠ ew, Br6c6 ≠ sw
whip[1]: Br5c4{nes .} ==> Pr6c4 ≠ ne, Nr5c4 ≠ 0, Nr5c4 ≠ 1
whip[1]: Pr4c6{se .} ==> Br3c6 ≠ esw, Br3c6 ≠ swn
whip[1]: Br3c6{nes .} ==> Pr3c7 ≠ ne, Pr3c7 ≠ ns, Pr3c7 ≠ ew, Pr4c7 ≠ se, Pr4c7 ≠ ew
P-single: Pr3c7 = sw
whip[1]: Pr3c7{sw .} ==> Br3c7 ≠ ns, Br3c7 ≠ ne, Br2c6 ≠ nw, Br2c6 ≠ se, Br2c6 ≠ ew, Br2c7 ≠ se, Br2c7 ≠ ew, Br2c7 ≠ esw
B-single: Br2c7 = e
B-single: Br2c6 = ns
whip[1]: Br2c7{e .} ==> Nr2c7 ≠ 2, Pr3c8 ≠ nw, Nr2c7 ≠ 3
N-single: Nr2c7 = 1
P-single: Pr3c8 = ns
w[1]-1-in-r3c8-asymmetric-nw-corner ==> Pr4c9 ≠ ew
P-single: Pr4c9 = se
whip[1]: Pr3c8{ns .} ==> Br3c7 ≠ sw, Br3c8 ≠ s
B-single: Br3c8 = w
B-single: Br3c7 = ew
whip[1]: Br3c8{w .} ==> Pr4c8 ≠ ew
P-single: Pr4c8 = ns
whip[1]: Pr4c8{ns .} ==> Br4c7 ≠ n, Br4c7 ≠ ns, Br4c7 ≠ nw, Br4c8 ≠ nes
B-single: Br4c8 = esw
whip[1]: Br4c8{esw .} ==> Pr5c9 ≠ ew, Pr5c9 ≠ se, Pr5c9 ≠ ns, Pr5c8 ≠ sw, Pr5c8 ≠ ew, Pr5c8 ≠ ns
P-single: Pr5c8 = ne
P-single: Pr5c9 = nw
whip[1]: Pr5c8{ne .} ==> Br5c7 ≠ n, Br4c7 ≠ se, Br5c7 ≠ e, Br5c7 ≠ ne, Br5c7 ≠ ns, Br5c7 ≠ se, Br5c7 ≠ ew, Br5c7 ≠ esw, Br5c7 ≠ nes, Br5c8 ≠ nw, Br5c8 ≠ se, Br5c8 ≠ ew, Br5c8 ≠ sw
whip[1]: Br5c8{ns .} ==> Pr6c8 ≠ ns, Pr6c8 ≠ nw
whip[1]: Pr6c8{ew .} ==> Hr6c8 ≠ 0, Br6c7 ≠ sw, Br6c7 ≠ wne, Br6c7 ≠ nes, Br6c8 ≠ se, Br6c8 ≠ ew, Br6c8 ≠ sw, Br6c8 ≠ esw, Br5c8 ≠ ne, Br6c7 ≠ o, Br6c7 ≠ s, Br6c7 ≠ w, Br6c7 ≠ ne, Br6c8 ≠ o, Br6c8 ≠ e, Br6c8 ≠ s, Br6c8 ≠ w
H-single: Hr6c8 = 1
B-single: Br5c8 = ns
horizontal-line-{r5 r6}c8 ==> Ir6c8 = out
whip[1]: Hr6c8{1 .} ==> Pr6c9 ≠ ne, Pr6c9 ≠ ns
whip[1]: Pr6c9{sw .} ==> Br5c9 ≠ nw, Br5c9 ≠ ew, Br5c9 ≠ sw, Br5c9 ≠ esw, Br5c9 ≠ swn, Br5c9 ≠ wne, Br6c9 ≠ nw, Br6c9 ≠ se, Br5c9 ≠ w
whip[1]: Br6c8{nes .} ==> Nr6c8 ≠ 0
whip[1]: Br6c7{swn .} ==> Nr6c7 ≠ 0
whip[1]: Br5c7{sw .} ==> Pr5c7 ≠ ew, Nr5c7 ≠ 3
whip[1]: Pr5c9{nw .} ==> Br5c9 ≠ n, Br4c9 ≠ n, Br4c9 ≠ ne, Br4c9 ≠ ns, Br4c9 ≠ swn, Br4c9 ≠ nes, Br5c9 ≠ ne, Br5c9 ≠ ns, Br5c9 ≠ nes
whip[1]: Br5c9{se .} ==> Pr5c10 ≠ nw, Pr5c10 ≠ ew, Pr5c10 ≠ sw, Nr5c9 ≠ 3
whip[1]: Br4c9{wne .} ==> Nr4c9 ≠ 1
whip[1]: Pr4c7{nw .} ==> Br4c6 ≠ sw
whip[1]: Br4c6{swn .} ==> Nr4c6 ≠ 2
N-single: Nr4c6 = 3
w[1]-3-in-r4c6-closed-nw-corner ==> Pr5c7 ≠ nw
P-single: Pr5c7 = sw
whip[1]: Pr5c7{sw .} ==> Br5c7 ≠ s, Br5c7 ≠ o, Br5c6 ≠ ns, Br5c6 ≠ n, Br4c6 ≠ esw, Br4c7 ≠ ew
B-single: Br4c7 = e
B-single: Br4c6 = swn
whip[1]: Br4c7{e .} ==> Nr4c7 ≠ 2, Pr4c7 ≠ ns
N-single: Nr4c7 = 1
P-single: Pr4c7 = nw
whip[1]: Pr4c7{nw .} ==> Br3c6 ≠ wne
B-single: Br3c6 = nes
whip[1]: Br3c6{nes .} ==> Pr4c6 ≠ ns
P-single: Pr4c6 = se
whip[1]: Pr4c6{se .} ==> Br3c5 ≠ ne
B-single: Br3c5 = n
whip[1]: Br3c5{n .} ==> Nr3c5 ≠ 2
N-single: Nr3c5 = 1
whip[1]: Br5c6{nes .} ==> Pr6c7 ≠ se, Pr6c7 ≠ ew, Nr5c6 ≠ 1
whip[1]: Pr6c7{nw .} ==> Hr6c7 ≠ 1, Br5c7 ≠ sw, Br6c7 ≠ ns, Br6c7 ≠ nw, Br6c7 ≠ swn, Br6c7 ≠ n
H-single: Hr6c7 = 0
B-single: Br5c7 = w
no-horizontal-line-{r5 r6}c7 ==> Ir6c7 = in
different-colours-in-r6{c7 c8} ==> Hr6c8 = 1
whip[1]: Hr6c7{0 .} ==> Pr6c8 ≠ ew
P-single: Pr6c8 = se
whip[1]: Pr6c8{se .} ==> Br6c8 ≠ n, Br6c8 ≠ ne, Br6c8 ≠ ns, Br6c8 ≠ nes
whip[1]: Br6c8{wne .} ==> Pr7c8 ≠ se, Pr7c8 ≠ ew, Pr7c9 ≠ nw, Nr6c8 ≠ 1
whip[1]: Pr7c9{ew .} ==> Br6c9 ≠ ne, Br7c8 ≠ ne
whip[1]: Br7c8{sw .} ==> Pr8c8 ≠ o
whip[1]: Pr6c10{ew .} ==> Br5c10 ≠ sw, Br5c10 ≠ esw, Br5c10 ≠ swn, Br6c9 ≠ sw, Br5c10 ≠ o, Br5c10 ≠ n, Br5c10 ≠ e, Br5c10 ≠ ne
whip[1]: Br5c10{nes .} ==> Nr5c10 ≠ 0
whip[1]: Pr7c9{ew .} ==> Br7c8 ≠ sw
whip[1]: Pr8c8{se .} ==> Br7c7 ≠ ne, Br7c7 ≠ ns, Br7c7 ≠ ew, Br7c7 ≠ sw, Br8c7 ≠ ne, Br8c7 ≠ sw, Br8c7 ≠ wne, Br8c7 ≠ nes, Br8c8 ≠ ne, Br8c8 ≠ ns, Br8c8 ≠ ew, Br8c8 ≠ sw, Br8c7 ≠ o, Br8c7 ≠ s, Br8c7 ≠ w
whip[1]: Br8c7{swn .} ==> Nr8c7 ≠ 0
whip[1]: Pr7c8{nw .} ==> Hr7c8 ≠ 1, Br6c8 ≠ swn, Br7c8 ≠ ns, Br7c8 ≠ nw
H-single: Hr7c8 = 0
no-horizontal-line-{r6 r7}c8 ==> Ir7c8 = out
whip[1]: Hr7c8{0 .} ==> Pr7c9 ≠ ew
whip[1]: Pr7c9{se .} ==> Vr7c9 ≠ 0, Br7c9 ≠ nes
V-single: Vr7c9 = 1
w[1]-3-in-r7c9-closed-nw-corner ==> Pr8c10 ≠ se, Pr8c10 ≠ nw, Pr8c10 ≠ o
no-vertical-line-r6{c8 c9} ==> Ir6c9 = out
no-vertical-line-r6{c9 c10} ==> Ir6c10 = out
no-horizontal-line-{r6 r7}c10 ==> Ir7c10 = out
vertical-line-r7{c9 c10} ==> Ir7c9 = in
different-colours-in-{r5 r6}c9 ==> Hr6c9 = 1
whip[1]: Vr7c9{1 .} ==> Pr8c9 ≠ ew
whip[1]: Pr8c9{nw .} ==> Hr8c9 ≠ 1, Br7c9 ≠ esw, Br7c9 ≠ swn, Br8c9 ≠ ne, Br8c9 ≠ ns, Br8c9 ≠ nw
H-single: Hr8c9 = 0
B-single: Br7c9 = wne
no-horizontal-line-{r7 r8}c9 ==> Ir8c9 = in
whip[1]: Hr8c9{0 .} ==> Pr8c10 ≠ ew
P-single: Pr8c10 = ns
whip[1]: Pr8c10{ns .} ==> Br8c10 ≠ e, Br8c10 ≠ n, Br8c10 ≠ o, Br7c10 ≠ e, Br7c10 ≠ n, Br7c10 ≠ o, Vr8c10 ≠ 0, Hr8c10 ≠ 1, Br7c10 ≠ s, Br7c10 ≠ ne, Br7c10 ≠ ns, Br7c10 ≠ se, Br7c10 ≠ sw, Br7c10 ≠ esw, Br7c10 ≠ swn, Br7c10 ≠ nes, Br8c9 ≠ sw, Br8c10 ≠ s, Br8c10 ≠ ne, Br8c10 ≠ ns, Br8c10 ≠ nw, Br8c10 ≠ se, Br8c10 ≠ swn, Br8c10 ≠ wne, Br8c10 ≠ nes
H-single: Hr8c10 = 0
V-single: Vr8c10 = 1
vertical-line-r8{c9 c10} ==> Ir8c10 = out
whip[1]: Hr8c10{0 .} ==> Pr8c11 ≠ nw, Pr8c11 ≠ ew, Pr8c11 ≠ sw
whip[1]: Vr8c10{1 .} ==> Pr9c10 ≠ ew, Pr9c10 ≠ sw
whip[1]: Pr9c10{nw .} ==> Br9c9 ≠ ne, Br9c9 ≠ wne, Br9c9 ≠ nes, Br9c10 ≠ nw, Br9c10 ≠ swn, Br9c10 ≠ wne
whip[1]: Br8c10{esw .} ==> Nr8c10 ≠ 0
whip[1]: Br7c10{wne .} ==> Pr7c10 ≠ ne, Pr7c10 ≠ ew, Nr7c10 ≠ 0
whip[1]: Pr7c10{sw .} ==> Br7c10 ≠ nw, Br7c10 ≠ wne, Br6c10 ≠ s
whip[1]: Br6c10{w .} ==> Pr7c11 ≠ nw, Pr6c10 ≠ se, Pr6c11 ≠ sw, Pr7c11 ≠ ew, Pr7c11 ≠ sw
whip[1]: Pr6c10{ew .} ==> Br5c9 ≠ o
whip[1]: Br5c9{se .} ==> Nr5c9 ≠ 0
whip[1]: Br7c10{ew .} ==> Nr7c10 ≠ 3
whip[1]: Br7c9{wne .} ==> Pr7c10 ≠ ns, Pr7c9 ≠ ns
P-single: Pr7c9 = se
P-single: Pr7c10 = sw
w[1]-1-in-r6c10-symmetric-sw-corner ==> Pr6c11 ≠ ne, Pr6c11 ≠ o
whip[1]: Pr7c9{se .} ==> Br6c8 ≠ wne, Br6c9 ≠ ew
B-single: Br6c9 = ns
B-single: Br6c8 = nw
whip[1]: Br6c9{ns .} ==> Pr6c10 ≠ ns, Pr6c9 ≠ sw
P-single: Pr6c9 = ew
whip[1]: Pr6c9{ew .} ==> Br5c9 ≠ e
whip[1]: Pr6c10{ew .} ==> Br6c10 ≠ w
whip[1]: Br6c8{nw .} ==> Nr6c8 ≠ 3
N-single: Nr6c8 = 2
whip[1]: Pr6c11{ew .} ==> Br5c11 ≠ sw, Br5c11 ≠ esw, Br5c11 ≠ swn, Br5c11 ≠ o, Br5c11 ≠ n, Br5c11 ≠ e, Br5c11 ≠ ne
whip[1]: Br5c11{nes .} ==> Nr5c11 ≠ 0
whip[1]: Pr9c9{se .} ==> Br9c8 ≠ ne, Br9c8 ≠ sw, Br9c8 ≠ wne, Br9c8 ≠ nes, Br9c9 ≠ ns, Br9c9 ≠ ew, Br9c9 ≠ sw, Br9c9 ≠ esw, Br9c8 ≠ o, Br9c8 ≠ s, Br9c8 ≠ w, Br9c9 ≠ n, Br9c9 ≠ w
whip[1]: Br9c8{swn .} ==> Nr9c8 ≠ 0
whip[1]: Br5c7{w .} ==> Nr5c7 ≠ 2, Nr5c7 ≠ 0
N-single: Nr5c7 = 1
whip[1]: Pr4c4{nw .} ==> Br4c3 ≠ s, Br4c3 ≠ o, Br4c3 ≠ w, Br4c3 ≠ sw
whip[1]: Br4c3{swn .} ==> Nr4c3 ≠ 0
whip[1]: Vr7c5{1 .} ==> Br7c4 ≠ o, Pr7c5 ≠ o, Pr7c5 ≠ ne, Pr7c5 ≠ nw, Pr7c5 ≠ ew, Pr8c5 ≠ o, Pr8c5 ≠ se, Pr8c5 ≠ ew, Br7c4 ≠ n, Br7c4 ≠ s, Br7c4 ≠ w, Br7c4 ≠ ns, Br7c4 ≠ nw, Br7c4 ≠ sw, Br7c4 ≠ swn, Br7c5 ≠ nes
whip[1]: Br7c5{wne .} ==> Pr8c6 ≠ o, Pr8c6 ≠ se
whip[1]: Br7c4{nes .} ==> Nr7c4 ≠ 0
whip[1]: Pr8c5{nw .} ==> Br8c4 ≠ ne
whip[1]: Pr7c5{sw .} ==> Br6c4 ≠ se, Br6c4 ≠ esw, Br6c5 ≠ sw, Br6c5 ≠ esw
whip[1]: Br6c5{ew .} ==> Nr6c5 ≠ 3
whip[1]: Hr8c5{1 .} ==> Pr8c5 ≠ ns, Pr8c5 ≠ nw, Pr8c6 ≠ ne, Pr8c6 ≠ ns, Br7c5 ≠ wne, Br8c5 ≠ e, Br8c5 ≠ s, Br8c5 ≠ w
P-single: Pr9c4 = ne
P-single: Pr8c5 = ne
B-single: Br8c5 = n
w[1]-1-in-r8c5-asymmetric-nw-corner ==> Pr9c6 ≠ sw, Pr9c6 ≠ ne
P-single: Pr9c6 = o
whip[1]: Pr9c4{ne .} ==> Br9c4 ≠ o, Br9c3 ≠ n, Br8c3 ≠ ns, Br8c3 ≠ nw, Br8c3 ≠ se, Br8c3 ≠ sw, Br8c4 ≠ ns, Br8c4 ≠ nw, Br8c4 ≠ se, Br8c4 ≠ ew, Br9c3 ≠ e, Br9c3 ≠ ne, Br9c3 ≠ ns, Br9c3 ≠ nw, Br9c3 ≠ se, Br9c3 ≠ ew, Br9c3 ≠ esw, Br9c3 ≠ swn, Br9c3 ≠ wne, Br9c3 ≠ nes, Br9c4 ≠ e, Br9c4 ≠ s, Br9c4 ≠ w, Br9c4 ≠ nw, Br9c4 ≠ se, Br9c4 ≠ ew, Br9c4 ≠ sw, Br9c4 ≠ esw, Br9c4 ≠ swn, Br9c4 ≠ wne
B-single: Br8c4 = sw
whip[1]: Br8c4{sw .} ==> Pr9c5 ≠ ns, Pr9c5 ≠ ne, Pr8c4 ≠ ew
whip[1]: Pr8c4{sw .} ==> Br7c3 ≠ nw, Br7c3 ≠ se, Br7c3 ≠ esw, Br7c3 ≠ nes, Br7c4 ≠ se, Br7c4 ≠ esw, Br7c4 ≠ nes, Br7c3 ≠ o, Br7c3 ≠ n, Br7c3 ≠ w
whip[1]: Br7c3{wne .} ==> Nr7c3 ≠ 0
whip[1]: Pr9c5{sw .} ==> Br9c5 ≠ nw, Br9c5 ≠ se, Br9c5 ≠ swn, Br9c5 ≠ wne, Br9c5 ≠ o, Br9c5 ≠ e, Br9c5 ≠ s
whip[1]: Br9c5{nes .} ==> Nr9c5 ≠ 0
whip[1]: Br9c4{nes .} ==> Pr10c4 ≠ ne, Pr10c4 ≠ ns, Pr10c4 ≠ nw, Nr9c4 ≠ 0
whip[1]: Br9c3{sw .} ==> Pr9c3 ≠ se, Pr9c3 ≠ ew, Nr9c3 ≠ 3
whip[1]: Br8c5{n .} ==> Pr8c6 ≠ sw, Pr9c5 ≠ ew
P-single: Pr9c5 = sw
whip[1]: Pr9c5{sw .} ==> Br9c5 ≠ ns, Br9c5 ≠ ne, Br9c5 ≠ n, Br9c4 ≠ ns, Br9c4 ≠ n, Vr9c5 ≠ 0, Br9c5 ≠ nes
V-single: Vr9c5 = 1
whip[1]: Vr9c5{1 .} ==> Pr10c5 ≠ o, Pr10c5 ≠ se, Pr10c5 ≠ ew, Pr10c5 ≠ sw
whip[1]: Pr10c5{nw .} ==> Br10c4 ≠ ne, Br10c4 ≠ wne, Br10c4 ≠ nes, Br10c5 ≠ nw, Br10c5 ≠ swn, Br10c5 ≠ wne
whip[1]: Br9c4{nes .} ==> Nr9c4 ≠ 1
whip[1]: Pr8c6{ew .} ==> Br7c6 ≠ sw, Br7c6 ≠ esw, Br7c6 ≠ swn, Br7c6 ≠ o, Br7c6 ≠ n, Br7c6 ≠ e, Br7c6 ≠ ne, Br8c6 ≠ w
whip[1]: Br8c6{s .} ==> Pr9c7 ≠ nw
whip[1]: Br7c6{nes .} ==> Nr7c6 ≠ 0
whip[1]: Pr9c6{o .} ==> Vr9c6 ≠ 1, Hr9c6 ≠ 1, Br8c6 ≠ s, Br9c5 ≠ ew, Br9c5 ≠ esw, Br9c6 ≠ n, Br9c6 ≠ w, Br9c6 ≠ ne, Br9c6 ≠ ns, Br9c6 ≠ nw, Br9c6 ≠ ew, Br9c6 ≠ sw, Br9c6 ≠ esw, Br9c6 ≠ swn, Br9c6 ≠ wne, Br9c6 ≠ nes
H-single: Hr9c6 = 0
V-single: Vr9c6 = 0
whip[1]: Hr9c6{0 .} ==> Pr9c7 ≠ ew, Pr9c7 ≠ sw
whip[1]: Vr9c6{0 .} ==> Pr10c6 ≠ ne, Pr10c6 ≠ ns, Pr10c6 ≠ nw
whip[1]: Br9c6{se .} ==> Nr9c6 ≠ 3
whip[1]: Br9c5{sw .} ==> Nr9c5 ≠ 3
whip[1]: Pr8c3{sw .} ==> Br7c2 ≠ nw, Br7c2 ≠ se, Br7c2 ≠ esw, Br7c2 ≠ nes, Br7c2 ≠ o, Br7c2 ≠ n, Br7c2 ≠ w
whip[1]: Br7c2{wne .} ==> Nr7c2 ≠ 0
whip[1]: Pr9c8{ew .} ==> Br9c7 ≠ sw, Br9c7 ≠ wne, Br9c7 ≠ nes, Br9c7 ≠ o, Br9c7 ≠ s, Br9c7 ≠ w, Br9c7 ≠ ne
whip[1]: Br9c7{swn .} ==> Nr9c7 ≠ 0
whip[1]: Pr7c7{se .} ==> Br6c7 ≠ esw, Br7c6 ≠ wne, Br7c6 ≠ nes
whip[1]: Br7c6{ew .} ==> Nr7c6 ≠ 3
whip[1]: Br6c7{ew .} ==> Nr6c7 ≠ 3
whip[1]: Pr4c3{ew .} ==> Br4c2 ≠ s, Br4c2 ≠ w
whip[1]: Br4c2{e .} ==> Pr5c2 ≠ ne, Pr4c2 ≠ ns, Pr4c2 ≠ se, Pr4c2 ≠ sw, Pr5c3 ≠ nw, Pr5c3 ≠ ew, Pr5c3 ≠ sw
whip[1]: Pr5c3{se .} ==> Br5c2 ≠ ne, Br5c2 ≠ ns, Br5c2 ≠ nw, Br5c2 ≠ swn, Br5c2 ≠ wne, Br5c2 ≠ nes, Br5c2 ≠ n
whip[1]: Pr4c2{ew .} ==> Br4c1 ≠ esw, Br4c1 ≠ wne, Br4c1 ≠ nes
B-single: Br4c1 = swn
whip[1]: Br4c1{swn .} ==> Pr5c2 ≠ o, Pr4c2 ≠ ne, Pr4c2 ≠ o, Pr5c1 ≠ se, Pr5c1 ≠ ns, Pr5c1 ≠ o, Pr4c1 ≠ ns, Pr4c1 ≠ ne, Pr4c1 ≠ o, Vr4c1 ≠ 0, Hr5c1 ≠ 0, Hr4c1 ≠ 0
H-single: Hr4c1 = 1
H-single: Hr5c1 = 1
V-single: Vr4c1 = 1
w[1]-3-in-r4c1-asymmetric-se-corner ==> Vr3c1 = 0
w[1]-3-in-r4c1-asymmetric-ne-corner ==> Vr5c1 = 0
P-single: Pr4c1 = se
P-single: Pr5c1 = ne
P-single: Pr5c2 = sw
no-vertical-line-r5{c0 c1} ==> Ir5c1 = out
horizontal-line-{r4 r5}c1 ==> Ir4c1 = in
no-vertical-line-r4{c1 c2} ==> Ir4c2 = in
no-horizontal-line-{r4 r5}c2 ==> Ir5c2 = in
horizontal-line-{r3 r4}c1 ==> Ir3c1 = out
different-colours-in-r3{c1 c2} ==> Hr3c2 = 1
w[0]-adjacent-3-in-r4c1-nolines-east ==> Vr5c2 = 1
w[0]-adjacent-3-in-r3c3-nolines-west ==> Vr4c3 = 1
w[1]-3-in-r6c1-hit-by-verti-line-at-ne ==> Vr6c1 = 1, Hr7c1 = 1, Hr6c2 = 0
w[1]-3-in-r6c1-closed-sw-corner ==> Pr6c2 ≠ sw, Pr6c2 ≠ ne, Pr6c2 ≠ o
no-vertical-line-r7{c0 c1} ==> Ir7c1 = out
horizontal-line-{r6 r7}c1 ==> Ir6c1 = in
no-horizontal-line-{r5 r6}c2 ==> Ir6c2 = in
same-colour-in-r6{c1 c2} ==> Vr6c2 = 0
different-colours-in-{r5 r6}c1 ==> Hr6c1 = 1
w[1]-3-in-r6c1-closed-nw-corner ==> Pr7c2 ≠ se, Pr7c2 ≠ nw, Pr7c2 ≠ o
whip[1]: Hr4c1{1 .} ==> Br3c1 ≠ ne, Br3c1 ≠ nw, Br3c1 ≠ ew
whip[1]: Hr5c1{1 .} ==> Br5c1 ≠ o, Br5c1 ≠ e, Br5c1 ≠ s, Br5c1 ≠ w, Br5c1 ≠ se, Br5c1 ≠ ew, Br5c1 ≠ sw, Br5c1 ≠ esw
whip[1]: Br5c1{nes .} ==> Nr5c1 ≠ 0
whip[1]: Vr4c1{1 .} ==> Br4c0 ≠ o
B-single: Br4c0 = e
whip[1]: Vr3c1{0 .} ==> Br3c0 ≠ e, Pr3c1 ≠ ns, Br3c1 ≠ sw
P-single: Pr3c2 = ns
B-single: Br3c0 = o
whip[1]: Pr3c2{ns .} ==> Br3c2 ≠ o, Br2c2 ≠ e, Vr2c2 ≠ 0, Hr3c1 ≠ 1, Br2c1 ≠ ns, Br2c1 ≠ nw, Br2c1 ≠ se, Br2c1 ≠ sw, Br3c1 ≠ ns, Br3c2 ≠ s
H-single: Hr3c1 = 0
V-single: Vr2c2 = 1
P-single: Pr4c2 = nw
P-single: Pr2c2 = sw
P-single: Pr3c1 = o
B-single: Br3c1 = se
B-single: Br2c2 = ew
w[1]-1-in-r4c2-symmetric-nw-corner ==> Pr5c3 ≠ se, Pr5c3 ≠ o
vertical-line-r2{c1 c2} ==> Ir2c1 = out
same-colour-in-r2{c0 c1} ==> Vr2c1 = 0
w[1]-2-in-r2c1-open-sw-corner ==> Hr2c1 = 1, Vr1c2 = 0
no-vertical-line-r1{c1 c2} ==> Ir1c1 = in
different-colours-in-r1{c0 c1} ==> Hr1c1 = 1
different-colours-in-{r0 r1}c1 ==> Hr1c1 = 1
whip[1]: Pr4c2{nw .} ==> Br4c2 ≠ n, Br3c2 ≠ sw
B-single: Br3c2 = w
B-single: Br4c2 = e
whip[1]: Br3c2{w .} ==> Nr3c2 ≠ 3, Nr3c2 ≠ 2, Nr3c2 ≠ 0, Pr4c3 ≠ ew
N-single: Nr3c2 = 1
P-single: Pr4c3 = se
whip[1]: Pr4c3{se .} ==> Br4c3 ≠ n, Br4c3 ≠ ns
whip[1]: Br4c3{swn .} ==> Nr4c3 ≠ 1
whip[1]: Pr2c2{sw .} ==> Br1c1 ≠ e, Br1c1 ≠ nw, Br1c1 ≠ se, Br1c2 ≠ nw, Br2c1 ≠ ew
B-single: Br2c1 = ne
B-single: Br1c2 = n
B-single: Br1c1 = swn
whip[1]: Br2c1{ne .} ==> Pr2c1 ≠ ns
P-single: Pr2c1 = ne
whip[1]: Br1c2{n .} ==> Pr1c2 ≠ se, Nr1c2 ≠ 2
N-single: Nr1c2 = 1
P-single: Pr1c2 = ew
whip[1]: Br1c1{swn .} ==> Nr1c1 ≠ 2, Nr1c1 ≠ 1, Pr1c1 ≠ o
N-single: Nr1c1 = 3
P-single: Pr1c1 = se
whip[1]: Br2c2{ew .} ==> Nr2c2 ≠ 1
N-single: Nr2c2 = 2
whip[1]: Vr2c1{0 .} ==> Br2c0 ≠ e
B-single: Br2c0 = o
whip[1]: Vr1c1{1 .} ==> Br1c0 ≠ o
B-single: Br1c0 = e
whip[1]: Hr1c1{1 .} ==> Br0c1 ≠ o
B-single: Br0c1 = s
whip[1]: Pr5c3{ns .} ==> Br5c3 ≠ nw, Br5c3 ≠ se, Br5c3 ≠ swn, Br5c3 ≠ e
whip[1]: Vr5c1{0 .} ==> Br5c0 ≠ e, Pr6c1 ≠ ne, Pr6c1 ≠ ns, Br5c1 ≠ nw, Br5c1 ≠ swn, Br5c1 ≠ wne
B-single: Br5c0 = o
whip[1]: Pr6c1{se .} ==> Br6c1 ≠ esw, Br6c1 ≠ nes
whip[1]: Br6c1{wne .} ==> Pr6c1 ≠ o, Pr7c1 ≠ o, Pr7c1 ≠ se, Pr6c2 ≠ ns, Pr6c2 ≠ se
P-single: Pr6c1 = se
whip[1]: Pr6c1{se .} ==> Br5c1 ≠ n, Br5c1 ≠ ne
whip[1]: Br5c1{nes .} ==> Nr5c1 ≠ 1
whip[1]: Pr6c2{ew .} ==> Br5c2 ≠ sw, Br5c2 ≠ esw, Br6c1 ≠ wne, Br5c2 ≠ o, Br5c2 ≠ e, Br6c2 ≠ w
B-single: Br6c1 = swn
whip[1]: Br6c1{swn .} ==> Pr7c2 ≠ ns, Pr7c2 ≠ ne, Pr7c1 ≠ ns
P-single: Pr7c1 = ne
whip[1]: Pr7c1{ne .} ==> Br7c1 ≠ o, Br7c1 ≠ e, Br7c1 ≠ s, Br7c1 ≠ w, Br7c1 ≠ nw, Br7c1 ≠ se, Br7c1 ≠ ew, Br7c1 ≠ sw, Br7c1 ≠ esw, Br7c1 ≠ swn, Br7c1 ≠ wne
whip[1]: Br7c1{nes .} ==> Pr8c1 ≠ ne, Pr8c1 ≠ ns, Nr7c1 ≠ 0
whip[1]: Pr8c1{se .} ==> Br8c1 ≠ ne, Br8c1 ≠ ns, Br8c1 ≠ ew, Br8c1 ≠ sw, Br8c1 ≠ esw, Br8c1 ≠ nes, Br8c1 ≠ n, Br8c1 ≠ w
whip[1]: Pr7c2{sw .} ==> Br7c2 ≠ swn, Br7c2 ≠ wne, Br7c2 ≠ e, Br7c2 ≠ s
whip[1]: Br7c2{sw .} ==> Nr7c2 ≠ 1, Nr7c2 ≠ 3
N-single: Nr7c2 = 2
whip[1]: Br6c2{s .} ==> Pr6c3 ≠ sw, Pr7c3 ≠ nw
whip[1]: Br5c2{ew .} ==> Nr5c2 ≠ 0, Nr5c2 ≠ 3
whip[1]: Pr5c2{sw .} ==> Br5c2 ≠ s, Br5c1 ≠ ns, Br5c2 ≠ se
B-single: Br5c1 = nes
whip[1]: Br5c1{nes .} ==> Nr5c1 ≠ 2, Pr6c2 ≠ ew
N-single: Nr5c1 = 3
P-single: Pr6c2 = nw
w[1]-1-in-r6c2-symmetric-nw-corner ==> Pr7c3 ≠ se, Pr7c3 ≠ o
whip[1]: Pr6c2{nw .} ==> Br6c2 ≠ n
whip[1]: Br6c2{s .} ==> Pr6c3 ≠ nw, Pr6c3 ≠ ew
whip[1]: Pr7c3{sw .} ==> Br7c3 ≠ swn, Br7c3 ≠ wne, Br7c3 ≠ e, Br7c3 ≠ s
whip[1]: Br7c3{sw .} ==> Nr7c3 ≠ 1, Nr7c3 ≠ 3
N-single: Nr7c3 = 2
whip[1]: Vr6c1{1 .} ==> Br6c0 ≠ o
B-single: Br6c0 = e
whip[1]: Vr7c1{0 .} ==> Br7c0 ≠ e
B-single: Br7c0 = o
whip[1]: Pr5c11{sw .} ==> Br5c11 ≠ nw, Br5c11 ≠ se, Br5c11 ≠ wne, Br5c11 ≠ s
whip[1]: Br3c10{nes .} ==> Pr3c11 ≠ o, Pr3c11 ≠ ne, Pr3c11 ≠ ns, Pr3c11 ≠ se, Nr3c10 ≠ 0
whip[1]: Pr3c11{sw .} ==> Br2c11 ≠ sw, Br2c11 ≠ esw, Br3c11 ≠ nw, Br3c11 ≠ swn, Br3c11 ≠ wne
whip[1]: Br2c10{esw .} ==> Nr2c10 ≠ 1
whip[1]: Br1c10{ne .} ==> Nr1c10 ≠ 3
N-single: Nr1c10 = 2
whip[1]: Pr2c11{ns .} ==> Br2c11 ≠ s, Br2c11 ≠ se, Br2c11 ≠ o, Br2c11 ≠ e
whip[1]: Br2c11{nes .} ==> Nr2c11 ≠ 0
whip[1]: Vr2c11{0 .} ==> Pr2c11 ≠ ns, Pr3c11 ≠ nw, Br2c10 ≠ esw, Br2c11 ≠ w, Br2c11 ≠ ew
P-single: Pr2c11 = ne
B-single: Br2c10 = sw
whip[1]: Pr2c11{ne .} ==> Br1c11 ≠ w, Br1c11 ≠ ew
whip[1]: Br1c11{esw .} ==> Pr2c12 ≠ o, Pr2c12 ≠ ne, Pr2c12 ≠ ns, Pr2c12 ≠ se, Nr1c11 ≠ 1
whip[1]: Pr2c12{sw .} ==> Br2c12 ≠ nw, Br2c12 ≠ swn, Br2c12 ≠ wne
whip[1]: Br2c10{sw .} ==> Nr2c10 ≠ 3
N-single: Nr2c10 = 2
whip[1]: Pr3c11{sw .} ==> Br3c11 ≠ se, Br3c11 ≠ o, Br3c11 ≠ e, Br3c11 ≠ s
whip[1]: Br3c11{nes .} ==> Nr3c11 ≠ 0
whip[1]: Vr2c12{1 .} ==> Br2c12 ≠ o, Pr2c12 ≠ nw, Pr2c12 ≠ ew, Pr3c12 ≠ o, Pr3c12 ≠ se, Pr3c12 ≠ ew, Pr3c12 ≠ sw, Br2c11 ≠ n, Br2c11 ≠ ns, Br2c12 ≠ n, Br2c12 ≠ e, Br2c12 ≠ s, Br2c12 ≠ ne, Br2c12 ≠ ns, Br2c12 ≠ se, Br2c12 ≠ nes
P-single: Pr2c12 = sw
whip[1]: Pr2c12{sw .} ==> Vr1c12 ≠ 1, Hr2c12 ≠ 1, Br1c11 ≠ esw
B-single: Br1c11 = sw
whip[1]: Br1c11{sw .} ==> Nr1c11 ≠ 3, Pr1c12 ≠ se
N-single: Nr1c11 = 2
P-single: Pr1c12 = o
whip[1]: Pr1c12{o .} ==> Hr1c12 ≠ 1
whip[1]: Br2c12{esw .} ==> Pr2c13 ≠ nw, Pr2c13 ≠ ew, Pr2c13 ≠ sw, Nr2c12 ≠ 0
whip[1]: Br2c11{nes .} ==> Nr2c11 ≠ 1
whip[1]: Pr3c12{nw .} ==> Br3c11 ≠ ne, Br3c11 ≠ nes, Br3c12 ≠ nw, Br3c12 ≠ swn, Br3c12 ≠ wne
whip[1]: Hr3c11{0 .} ==> Pr3c11 ≠ ew, Pr3c12 ≠ nw, Br2c11 ≠ nes, Br3c11 ≠ n, Br3c11 ≠ ns
P-single: Pr3c11 = sw
B-single: Br2c11 = ne
whip[1]: Pr3c11{sw .} ==> Br3c10 ≠ ns, Br3c10 ≠ n
whip[1]: Br3c10{nes .} ==> Pr4c11 ≠ o, Pr4c11 ≠ se, Pr4c11 ≠ ew, Pr4c11 ≠ sw, Nr3c10 ≠ 1
whip[1]: Pr4c11{nw .} ==> Br4c10 ≠ ne
whip[1]: Br4c10{sw .} ==> Pr5c10 ≠ o
whip[1]: Pr5c10{se .} ==> Br5c10 ≠ se, Br5c10 ≠ s
whip[1]: Br2c11{ne .} ==> Nr2c11 ≠ 3
N-single: Nr2c11 = 2
whip[1]: Pr3c12{ns .} ==> Br3c12 ≠ s, Br3c12 ≠ se, Br3c12 ≠ o, Br3c12 ≠ e
whip[1]: Br3c12{nes .} ==> Nr3c12 ≠ 0
whip[1]: Vr3c12{1 .} ==> Pr3c12 ≠ ne, Pr4c12 ≠ o, Pr4c12 ≠ se, Pr4c12 ≠ ew, Pr4c12 ≠ sw, Br3c11 ≠ w, Br3c11 ≠ sw, Br3c12 ≠ n, Br3c12 ≠ ne, Br3c12 ≠ ns, Br3c12 ≠ nes
P-single: Pr3c12 = ns
whip[1]: Pr3c12{ns .} ==> Br2c12 ≠ sw, Br2c12 ≠ esw
whip[1]: Br2c12{ew .} ==> Pr3c13 ≠ nw, Pr3c13 ≠ ew, Pr3c13 ≠ sw, Nr2c12 ≠ 3
whip[1]: Br3c11{esw .} ==> Nr3c11 ≠ 1
whip[1]: Pr4c12{nw .} ==> Br4c12 ≠ nw, Br4c12 ≠ swn, Br4c12 ≠ wne
whip[1]: Hr4c11{0 .} ==> Pr4c11 ≠ ne, Pr4c12 ≠ nw, Br3c11 ≠ esw, Br4c11 ≠ n
B-single: Br3c11 = ew
whip[1]: Br3c11{ew .} ==> Nr3c11 ≠ 3
N-single: Nr3c11 = 2
w[1]-adjacent-1-2-on-pseudo-edge-in-{r4 r3}c11-fwd-diag-2s-3 ==> Vr4c11 = 0, Hr5c11 = 0
no-horizontal-line-{r4 r5}c11 ==> Ir5c11 = in
no-vertical-line-r4{c10 c11} ==> Ir4c10 = in
same-colour-in-r4{c9 c10} ==> Vr4c10 = 0
different-colours-in-{r3 r4}c10 ==> Hr4c10 = 1
whip[1]: Vr4c11{0 .} ==> Pr4c11 ≠ ns, Pr5c11 ≠ ne, Pr5c11 ≠ ns, Br4c10 ≠ ew, Br4c11 ≠ w
P-single: Pr4c11 = nw
w[1]-1-in-r4c11-symmetric-nw-corner ==> Pr5c12 ≠ se, Pr5c12 ≠ nw, Pr5c12 ≠ o
whip[1]: Pr4c11{nw .} ==> Br3c10 ≠ ne, Br4c10 ≠ sw
B-single: Br4c10 = ns
B-single: Br3c10 = nes
whip[1]: Br4c10{ns .} ==> Pr5c10 ≠ ns, Hr5c10 ≠ 0, Pr4c10 ≠ sw
H-single: Hr5c10 = 1
P-single: Pr4c10 = ew
P-single: Pr5c10 = se
horizontal-line-{r4 r5}c10 ==> Ir5c10 = out
same-colour-in-{r5 r6}c10 ==> Hr6c10 = 0
different-colours-in-r5{c10 c11} ==> Hr5c11 = 1
different-colours-in-r5{c9 c10} ==> Hr5c10 = 1
whip[1]: Hr5c10{1 .} ==> Br5c10 ≠ w, Br5c10 ≠ ew
whip[1]: Br5c10{nes .} ==> Nr5c10 ≠ 1
whip[1]: Pr4c10{ew .} ==> Br4c9 ≠ wne
B-single: Br4c9 = nw
whip[1]: Br4c9{nw .} ==> Nr4c9 ≠ 3
N-single: Nr4c9 = 2
whip[1]: Pr5c10{se .} ==> Br5c9 ≠ s, Br5c10 ≠ ns, Br5c10 ≠ nes
B-single: Br5c9 = se
whip[1]: Br5c9{se .} ==> Nr5c9 ≠ 1, Pr6c10 ≠ ew
N-single: Nr5c9 = 2
P-single: Pr6c10 = nw
w[1]-1-in-r6c10-symmetric-nw-corner ==> Pr7c11 ≠ se, Pr7c11 ≠ o
whip[1]: Pr6c10{nw .} ==> Br6c10 ≠ n
B-single: Br6c10 = e
whip[1]: Br6c10{e .} ==> Vr6c11 ≠ 0, Pr6c11 ≠ nw, Pr6c11 ≠ ew
V-single: Vr6c11 = 1
vertical-line-r6{c10 c11} ==> Ir6c11 = in
same-colour-in-{r5 r6}c11 ==> Hr6c11 = 0
w[1]-diagonal-3-2-in-{r7c12...r6c11}-non-closed-nw-corner ==> Hr8c12 = 1, Hr8c13 = 0
w[1]-3-in-r7c13-hit-by-horiz-line-at-sw ==> Hr7c13 = 1
w[1]-2-in-r6c14-open-sw-corner ==> Hr6c14 = 1, Vr6c15 = 1, Hr6c15 = 0, Vr5c15 = 0
w[1]-2-in-r6c12-open-se-corner ==> Hr6c12 = 1, Vr6c12 = 1, Vr5c12 = 0
w[1]-3+diagonal-2-isolated-end-in-{r7c12+r6c12...nw} ==> Hr7c11 = 0
w[1]-adjacent-1-3-on-pseudo-edge-in-{r6 r7}c13 ==> Hr6c13 = 0
w[1]-3-in-r7c13-closed-nw-corner ==> Pr8c14 ≠ se, Pr8c14 ≠ nw, Pr8c14 ≠ o
w[1]-3-in-r7c13-closed-ne-corner ==> Pr8c13 ≠ sw, Pr8c13 ≠ ne, Pr8c13 ≠ o
w[1]-3-in-r7c12-closed-sw-corner ==> Pr7c13 ≠ sw, Pr7c13 ≠ ne, Pr7c13 ≠ o
P-single: Pr7c11 = ns
P-single: Pr6c11 = ns
w[1]-1-in-r6c13-asymmetric-sw-corner ==> Pr6c14 ≠ ew, Pr6c14 ≠ ns
no-horizontal-line-{r6 r7}c11 ==> Ir7c11 = in
no-horizontal-line-{r7 r8}c11 ==> Ir8c11 = in
no-vertical-line-r8{c11 c12} ==> Ir8c12 = in
no-vertical-line-r8{c12 c13} ==> Ir8c13 = in
no-horizontal-line-{r7 r8}c13 ==> Ir7c13 = in
vertical-line-r7{c12 c13} ==> Ir7c12 = out
no-horizontal-line-{r6 r7}c12 ==> Ir6c12 = out
no-vertical-line-r6{c12 c13} ==> Ir6c13 = out
no-vertical-line-r6{c13 c14} ==> Ir6c14 = out
no-horizontal-line-{r6 r7}c14 ==> Ir7c14 = out
vertical-line-r6{c14 c15} ==> Ir6c15 = in
no-horizontal-line-{r5 r6}c15 ==> Ir5c15 = in
no-vertical-line-r5{c14 c15} ==> Ir5c14 = in
no-horizontal-line-{r5 r6}c13 ==> Ir5c13 = out
horizontal-line-{r5 r6}c12 ==> Ir5c12 = in
no-horizontal-line-{r8 r9}c12 ==> Ir9c12 = in
no-horizontal-line-{r9 r10}c12 ==> Ir10c12 = in
no-horizontal-line-{r10 r11}c12 ==> Ir11c12 = in
no-vertical-line-r11{c11 c12} ==> Ir11c11 = in
no-vertical-line-r11{c10 c11} ==> Ir11c10 = in
no-horizontal-line-{r10 r11}c10 ==> Ir10c10 = in
vertical-line-r10{c9 c10} ==> Ir10c9 = out
no-horizontal-line-{r9 r10}c9 ==> Ir9c9 = out
no-vertical-line-r9{c9 c10} ==> Ir9c10 = out
no-vertical-line-r9{c10 c11} ==> Ir9c11 = out
no-horizontal-line-{r9 r10}c11 ==> Ir10c11 = out
no-horizontal-line-{r11 r12}c11 ==> Ir12c11 = in
no-horizontal-line-{r12 r13}c11 ==> Ir13c11 = in
no-vertical-line-r13{c10 c11} ==> Ir13c10 = in
no-horizontal-line-{r13 r14}c10 ==> Ir14c10 = in
no-vertical-line-r14{c10 c11} ==> Ir14c11 = in
no-horizontal-line-{r14 r15}c11 ==> Ir15c11 = in
no-vertical-line-r15{c10 c11} ==> Ir15c10 = in
vertical-line-r14{c9 c10} ==> Ir14c9 = out
no-vertical-line-r13{c11 c12} ==> Ir13c12 = in
no-vertical-line-r13{c12 c13} ==> Ir13c13 = in
no-vertical-line-r13{c13 c14} ==> Ir13c14 = in
no-horizontal-line-{r13 r14}c14 ==> Ir14c14 = in
no-horizontal-line-{r14 r15}c14 ==> Ir15c14 = in
no-vertical-line-r15{c13 c14} ==> Ir15c13 = in
horizontal-line-{r14 r15}c13 ==> Ir14c13 = out
horizontal-line-{r12 r13}c12 ==> Ir12c12 = out
vertical-line-r12{c10 c11} ==> Ir12c10 = out
different-colours-in-{r12 r13}c10 ==> Hr13c10 = 1
different-colours-in-{r11 r12}c10 ==> Hr12c10 = 1
different-colours-in-{r11 r12}c12 ==> Hr12c12 = 1
different-colours-in-{r15 r16}c13 ==> Hr16c13 = 1
different-colours-in-{r15 r16}c14 ==> Hr16c14 = 1
different-colours-in-{r14 r15}c9 ==> Hr15c9 = 1
w[1]-2-in-r14c8-open-se-corner ==> Hr14c8 = 1, Vr14c8 = 1, Hr14c7 = 0
w[1]-diagonal-3-2-in-{r15c7...r14c8}-non-closed-ne-corner ==> Vr15c7 = 1, Hr16c6 = 0
w[1]-3-in-r15c9-closed-nw-corner ==> Pr16c10 ≠ nw
P-single: Pr16c10 = ew
no-horizontal-line-{r15 r16}c6 ==> Ir15c6 = out
no-vertical-line-r14{c8 c9} ==> Ir14c8 = out
vertical-line-r14{c7 c8} ==> Ir14c7 = in
no-horizontal-line-{r13 r14}c7 ==> Ir13c7 = in
no-vertical-line-r13{c7 c8} ==> Ir13c8 = in
horizontal-line-{r12 r13}c8 ==> Ir12c8 = out
vertical-line-r12{c7 c8} ==> Ir12c7 = in
no-vertical-line-r12{c6 c7} ==> Ir12c6 = in
no-vertical-line-r12{c5 c6} ==> Ir12c5 = in
no-vertical-line-r12{c4 c5} ==> Ir12c4 = in
horizontal-line-{r12 r13}c4 ==> Ir13c4 = out
vertical-line-r13{c4 c5} ==> Ir13c5 = in
no-horizontal-line-{r11 r12}c5 ==> Ir11c5 = in
no-horizontal-line-{r11 r12}c7 ==> Ir11c7 = in
same-colour-in-{r14 r15}c7 ==> Hr15c7 = 0
different-colours-in-{r15 r16}c10 ==> Hr16c10 = 1
different-colours-in-{r15 r16}c11 ==> Hr16c11 = 1
same-colour-in-{r8 r9}c10 ==> Hr9c10 = 0
different-colours-in-{r8 r9}c9 ==> Hr9c9 = 1

LOOP[6]: Hr9c9-Vr8c10-Vr7c10-Hr7c9-Vr7c9- ==> Vr8c9 = 0
P-single: Pr8c8 = se
P-single: Pr9c9 = se
no-vertical-line-r8{c8 c9} ==> Ir8c8 = in
different-colours-in-{r7 r8}c8 ==> Hr8c8 = 1
different-colours-in-r5{c12 c13} ==> Hr5c13 = 1
different-colours-in-{r4 r5}c12 ==> Hr5c12 = 1
different-colours-in-r5{c13 c14} ==> Hr5c14 = 1
same-colour-in-{r4 r5}c14 ==> Hr5c14 = 0
w[1]-diagonal-3-2-in-{r3c13...r4c14}-non-closed-se-corner ==> Vr4c15 = 1
vertical-line-r4{c14 c15} ==> Ir4c15 = out
same-colour-in-r4{c15 c16} ==> Vr4c16 = 0
different-colours-in-{r4 r5}c15 ==> Hr5c15 = 1
different-colours-in-{r3 r4}c15 ==> Hr4c15 = 1
different-colours-in-r5{c15 c16} ==> Hr5c16 = 1
different-colours-in-r6{c15 c16} ==> Hr6c16 = 1

LOOP[20]: Vr6c16-Vr5c16-Hr5c15-Vr4c15-Hr4c15-Vr3c16-Vr2c16-Vr1c16-Hr1c15-Vr1c15-Hr2c14-Vr2c14-Hr3c13-Vr3c13-Hr4c13-Vr4c14-Vr5c14-Hr6c14-Vr6c15- ==> Hr7c15 = 0
no-horizontal-line-{r6 r7}c15 ==> Ir7c15 = in
different-colours-in-r7{c15 c16} ==> Hr7c16 = 1
different-colours-in-r7{c14 c15} ==> Hr7c15 = 1

LOOP[22]: Vr7c15-Vr6c15-Hr6c14-Vr5c14-Vr4c14-Hr4c13-Vr3c13-Hr3c13-Vr2c14-Hr2c14-Vr1c15-Hr1c15-Vr1c16-Vr2c16-Vr3c16-Hr4c15-Vr4c15-Hr5c15-Vr5c16-Vr6c16-Vr7c16- ==> Hr8c15 = 0
no-horizontal-line-{r7 r8}c15 ==> Ir8c15 = in
horizontal-line-{r8 r9}c15 ==> Ir9c15 = out
horizontal-line-{r9 r10}c15 ==> Ir10c15 = in
horizontal-line-{r10 r11}c15 ==> Ir11c15 = out
same-colour-in-r11{c15 c16} ==> Vr11c16 = 0
different-colours-in-r10{c15 c16} ==> Hr10c16 = 1
w[1]-3-in-r9c15-hit-by-verti-line-at-se ==> Vr9c15 = 1
w[1]-diagonal-3-2-in-{r10c15...r9c14}-non-closed-nw-corner ==> Vr9c14 = 1
w[1]-3-in-r9c15-closed-sw-corner ==> Pr9c16 ≠ sw, Pr9c16 ≠ o
w[1]-3-in-r9c15-closed-nw-corner ==> Pr10c16 ≠ nw, Pr10c16 ≠ o
w[1]-3-in-r10c15-closed-ne-corner ==> Pr11c15 ≠ sw, Pr11c15 ≠ ne, Pr11c15 ≠ o
no-vertical-line-r8{c14 c15} ==> Ir8c14 = in
no-horizontal-line-{r8 r9}c14 ==> Ir9c14 = in
no-horizontal-line-{r9 r10}c14 ==> Ir10c14 = in
vertical-line-r9{c13 c14} ==> Ir9c13 = out
different-colours-in-r9{c12 c13} ==> Hr9c13 = 1
different-colours-in-{r8 r9}c13 ==> Hr9c13 = 1
w[0]-adjacent-3-in-r7c13-nolines-south ==> Hr8c14 = 1
different-colours-in-r8{c15 c16} ==> Hr8c16 = 1
different-colours-in-r8{c10 c11} ==> Hr8c11 = 1
different-colours-in-r7{c10 c11} ==> Hr7c11 = 1
whip[1]: Vr6c11{1 .} ==> Br6c11 ≠ ne, Br6c11 ≠ ns, Br6c11 ≠ se
whip[1]: Hr6c11{0 .} ==> Pr6c12 ≠ ew, Br5c11 ≠ ns, Br5c11 ≠ nes, Br6c11 ≠ nw
whip[1]: Br5c11{ew .} ==> Pr5c11 ≠ ew, Pr5c12 ≠ ew, Pr5c12 ≠ sw, Nr5c11 ≠ 3
P-single: Pr5c11 = sw
w[1]-1-in-r4c11-symmetric-sw-corner ==> Pr4c12 ≠ ne
P-single: Pr4c12 = ns
whip[1]: Pr5c11{sw .} ==> Br4c11 ≠ s, Br5c10 ≠ nw
B-single: Br5c10 = wne
B-single: Br4c11 = e
whip[1]: Br5c10{wne .} ==> Nr5c10 ≠ 2
N-single: Nr5c10 = 3
whip[1]: Pr4c12{ns .} ==> Br4c12 ≠ e, Br4c12 ≠ n, Br4c12 ≠ o, Br3c12 ≠ sw, Br3c12 ≠ esw, Br4c12 ≠ s, Br4c12 ≠ ne, Br4c12 ≠ ns, Br4c12 ≠ se, Br4c12 ≠ nes
whip[1]: Br4c12{esw .} ==> Pr4c13 ≠ nw, Pr4c13 ≠ ew, Pr4c13 ≠ sw, Nr4c12 ≠ 0
whip[1]: Br3c12{ew .} ==> Nr3c12 ≠ 3
whip[1]: Pr5c12{ns .} ==> Br5c12 ≠ s, Br5c12 ≠ nw, Br5c12 ≠ se, Br5c12 ≠ swn, Br5c12 ≠ wne, Br5c12 ≠ o, Br5c12 ≠ e
whip[1]: Br5c12{nes .} ==> Nr5c12 ≠ 0
whip[1]: Pr6c12{se .} ==> Br5c12 ≠ ne, Br5c12 ≠ sw, Br5c12 ≠ esw, Br6c11 ≠ sw, Br6c12 ≠ ne, Br6c12 ≠ ns, Br6c12 ≠ se, Br5c12 ≠ n
B-single: Br6c11 = ew
whip[1]: Br6c11{ew .} ==> Pr7c12 ≠ ew
P-single: Pr7c12 = ns
whip[1]: Pr7c12{ns .} ==> Br7c11 ≠ n, Br7c11 ≠ o, Br6c12 ≠ sw, Br7c11 ≠ s, Br7c11 ≠ w, Br7c11 ≠ ne, Br7c11 ≠ ns, Br7c11 ≠ nw, Br7c11 ≠ sw, Br7c11 ≠ swn, Br7c11 ≠ wne, Br7c11 ≠ nes, Br7c12 ≠ swn, Br7c12 ≠ wne, Br7c12 ≠ nes
B-single: Br7c12 = esw
whip[1]: Br7c12{esw .} ==> Pr8c13 ≠ ew, Pr8c13 ≠ se, Pr8c13 ≠ ns, Pr8c12 ≠ sw, Pr8c12 ≠ ew, Pr8c12 ≠ se, Pr8c12 ≠ nw, Pr8c12 ≠ ns, Pr8c12 ≠ o, Pr7c13 ≠ ew
P-single: Pr8c12 = ne
P-single: Pr8c13 = nw
whip[1]: Pr8c12{ne .} ==> Br8c12 ≠ o, Br8c11 ≠ n, Br7c11 ≠ se, Br7c11 ≠ esw, Br8c11 ≠ e, Br8c11 ≠ ne, Br8c11 ≠ ns, Br8c11 ≠ nw, Br8c11 ≠ se, Br8c11 ≠ ew, Br8c11 ≠ esw, Br8c11 ≠ swn, Br8c11 ≠ wne, Br8c11 ≠ nes, Br8c12 ≠ e, Br8c12 ≠ s, Br8c12 ≠ w, Br8c12 ≠ nw, Br8c12 ≠ se, Br8c12 ≠ ew, Br8c12 ≠ sw, Br8c12 ≠ esw, Br8c12 ≠ swn, Br8c12 ≠ wne
whip[1]: Br8c12{nes .} ==> Pr9c12 ≠ ns, Pr9c12 ≠ nw, Nr8c12 ≠ 0
whip[1]: Pr9c12{sw .} ==> Br9c11 ≠ sw, Br9c12 ≠ se, Br9c12 ≠ o, Br9c12 ≠ e, Br9c12 ≠ s
whip[1]: Br9c12{nes .} ==> Nr9c12 ≠ 0
whip[1]: Br8c11{sw .} ==> Pr8c11 ≠ ne, Pr8c11 ≠ se, Nr8c11 ≠ 3
whip[1]: Br7c11{ew .} ==> Nr7c11 ≠ 0, Nr7c11 ≠ 3
whip[1]: Pr8c13{nw .} ==> Br8c13 ≠ n, Br7c13 ≠ esw, Br7c13 ≠ swn, Br7c13 ≠ nes, Br8c12 ≠ ne, Br8c12 ≠ nes, Br8c13 ≠ w, Br8c13 ≠ ne, Br8c13 ≠ ns, Br8c13 ≠ nw, Br8c13 ≠ ew, Br8c13 ≠ sw, Br8c13 ≠ esw, Br8c13 ≠ swn, Br8c13 ≠ wne, Br8c13 ≠ nes
B-single: Br7c13 = wne
whip[1]: Br7c13{wne .} ==> Pr8c14 ≠ sw, Pr8c14 ≠ ew, Pr7c14 ≠ ew, Pr7c14 ≠ se, Pr7c14 ≠ nw, Pr7c14 ≠ ns, Pr7c14 ≠ o, Pr7c13 ≠ ns
P-single: Pr6c12 = se
P-single: Pr6c15 = sw
P-single: Pr7c13 = se
P-single: Pr7c14 = sw
w[1]-1-in-r6c13-asymmetric-se-corner ==> Pr6c13 ≠ ew, Pr6c13 ≠ ns
whip[1]: Pr6c12{se .} ==> Br5c12 ≠ w, Br5c11 ≠ ew, Br5c12 ≠ ew, Br6c12 ≠ ew
B-single: Br6c12 = nw
B-single: Br5c11 = w
whip[1]: Br6c12{nw .} ==> Pr6c13 ≠ se
P-single: Pr6c13 = nw
whip[1]: Pr6c13{nw .} ==> Br6c13 ≠ n, Br5c13 ≠ s, Br5c13 ≠ e, Br5c13 ≠ n, Br5c13 ≠ o, Br5c12 ≠ ns, Br5c13 ≠ ne, Br5c13 ≠ ns, Br5c13 ≠ se, Br5c13 ≠ sw, Br5c13 ≠ esw, Br5c13 ≠ swn, Br5c13 ≠ nes, Br6c13 ≠ w
B-single: Br5c12 = nes
whip[1]: Br5c12{nes .} ==> Nr5c12 ≠ 2, Nr5c12 ≠ 1, Pr5c13 ≠ ew, Pr5c13 ≠ se, Pr5c13 ≠ nw, Pr5c13 ≠ ns, Pr5c13 ≠ ne, Pr5c13 ≠ o, Pr5c12 ≠ ns
N-single: Nr5c12 = 3
P-single: Pr5c12 = ne
P-single: Pr5c13 = sw
whip[1]: Pr5c12{ne .} ==> Br4c12 ≠ w, Br4c12 ≠ ew
whip[1]: Br4c12{esw .} ==> Nr4c12 ≠ 1
whip[1]: Pr5c13{sw .} ==> Br4c13 ≠ ns, Br4c13 ≠ w, Br4c13 ≠ s, Br4c12 ≠ esw, Br4c13 ≠ nw, Br4c13 ≠ se, Br4c13 ≠ ew, Br4c13 ≠ sw, Br4c13 ≠ esw, Br4c13 ≠ swn, Br4c13 ≠ wne, Br4c13 ≠ nes, Br5c13 ≠ nw, Br5c13 ≠ wne
B-single: Br4c12 = sw
whip[1]: Br4c12{sw .} ==> Nr4c12 ≠ 3, Pr4c13 ≠ se, Pr4c13 ≠ ns
N-single: Nr4c12 = 2
whip[1]: Pr4c13{ne .} ==> Br3c13 ≠ wne, Br3c13 ≠ nes
whip[1]: Br3c13{swn .} ==> Pr3c13 ≠ o, Pr3c13 ≠ ne, Pr4c13 ≠ o, Pr4c14 ≠ ne, Pr4c14 ≠ ns
P-single: Pr4c13 = ne
whip[1]: Pr4c13{ne .} ==> Br4c13 ≠ o, Br3c12 ≠ w, Br4c13 ≠ e
B-single: Br3c12 = ew
whip[1]: Br3c12{ew .} ==> Nr3c12 ≠ 1
N-single: Nr3c12 = 2
whip[1]: Br4c13{ne .} ==> Pr5c14 ≠ nw, Nr4c13 ≠ 0, Nr4c13 ≠ 3, Pr5c14 ≠ ew
whip[1]: Pr5c14{se .} ==> Br4c14 ≠ ne, Br4c14 ≠ sw, Br5c14 ≠ ne, Br5c14 ≠ ns, Br5c14 ≠ se, Br5c14 ≠ nes, Br5c13 ≠ w, Br5c14 ≠ o, Br5c14 ≠ n, Br5c14 ≠ e, Br5c14 ≠ s
B-single: Br5c13 = ew
whip[1]: Br5c13{ew .} ==> Nr5c13 ≠ 3, Nr5c13 ≠ 1, Nr5c13 ≠ 0, Pr6c14 ≠ sw
N-single: Nr5c13 = 2
P-single: Pr6c14 = ne
whip[1]: Pr6c14{ne .} ==> Br5c14 ≠ w, Br5c14 ≠ nw, Br5c14 ≠ ew, Br5c14 ≠ wne, Br6c13 ≠ e, Br6c14 ≠ nw, Br6c14 ≠ se, Br6c14 ≠ ew, Br6c14 ≠ sw
B-single: Br6c13 = s
whip[1]: Br5c14{swn .} ==> Pr5c15 ≠ sw, Nr5c14 ≠ 0, Nr5c14 ≠ 1
whip[1]: Pr5c15{ew .} ==> Br4c14 ≠ nw, Br4c14 ≠ se, Br5c15 ≠ nw, Br5c15 ≠ se, Br5c15 ≠ swn, Br5c15 ≠ wne, Br4c15 ≠ n, Br4c15 ≠ e, Br5c15 ≠ o, Br5c15 ≠ e, Br5c15 ≠ s
whip[1]: Br5c15{nes .} ==> Nr5c15 ≠ 0
whip[1]: Br4c15{swn .} ==> Nr4c15 ≠ 1
whip[1]: Pr4c14{sw .} ==> Vr3c14 ≠ 1, Br3c13 ≠ esw
B-single: Br3c13 = swn
whip[1]: Br3c13{swn .} ==> Pr3c14 ≠ se, Pr3c14 ≠ ns, Pr3c13 ≠ ns
P-single: Pr3c13 = se
whip[1]: Pr3c13{se .} ==> Br2c13 ≠ e, Br2c13 ≠ n, Br2c12 ≠ ew, Br2c13 ≠ nw, Br2c13 ≠ ew, Br2c13 ≠ esw, Br2c13 ≠ swn
B-single: Br2c12 = w
whip[1]: Br2c12{w .} ==> Nr2c12 ≠ 2, Pr2c13 ≠ ns, Pr2c13 ≠ se
N-single: Nr2c12 = 1
whip[1]: Br2c13{se .} ==> Nr2c13 ≠ 1, Nr2c13 ≠ 3
N-single: Nr2c13 = 2
whip[1]: Pr3c14{ew .} ==> Br2c14 ≠ swn, Br2c14 ≠ n
whip[1]: Br2c14{nw .} ==> Nr2c14 ≠ 1, Nr2c14 ≠ 3
N-single: Nr2c14 = 2
whip[1]: Br5c11{w .} ==> Nr5c11 ≠ 2
N-single: Nr5c11 = 1
whip[1]: Pr6c15{sw .} ==> Br6c15 ≠ ns, Br6c15 ≠ ne, Br6c15 ≠ s, Br6c15 ≠ e, Br6c15 ≠ n, Br6c15 ≠ o, Br6c14 ≠ ns, Br5c15 ≠ ns, Br5c15 ≠ w, Br5c14 ≠ esw, Br5c15 ≠ ew, Br5c15 ≠ sw, Br5c15 ≠ esw, Br5c15 ≠ nes, Br6c15 ≠ nw, Br6c15 ≠ se, Br6c15 ≠ swn, Br6c15 ≠ wne, Br6c15 ≠ nes
B-single: Br6c14 = ne
whip[1]: Br6c14{ne .} ==> Pr7c15 ≠ ew, Pr7c15 ≠ sw
whip[1]: Pr7c15{ns .} ==> Br7c14 ≠ ne, Br7c14 ≠ ns, Br7c14 ≠ nw, Br7c14 ≠ swn, Br7c14 ≠ wne, Br7c14 ≠ nes, Br7c15 ≠ s, Br7c15 ≠ nw, Br7c15 ≠ se, Br7c15 ≠ swn, Br7c15 ≠ wne, Br7c14 ≠ n, Br7c15 ≠ o, Br7c15 ≠ e
whip[1]: Br7c15{nes .} ==> Nr7c15 ≠ 0
whip[1]: Br6c15{esw .} ==> Pr6c16 ≠ nw, Pr6c16 ≠ sw, Nr6c15 ≠ 0
whip[1]: Br5c15{ne .} ==> Pr5c16 ≠ o, Pr5c16 ≠ ns, Pr5c15 ≠ ns, Nr5c15 ≠ 3
whip[1]: Pr5c15{ew .} ==> Br4c15 ≠ nw, Br4c15 ≠ ew
whip[1]: Pr7c14{sw .} ==> Br7c14 ≠ s, Br7c14 ≠ e, Br7c14 ≠ o, Br7c14 ≠ se
whip[1]: Br7c14{esw .} ==> Nr7c14 ≠ 0
whip[1]: Pr8c14{ns .} ==> Br8c14 ≠ s, Br8c14 ≠ nw, Br8c14 ≠ se, Br8c14 ≠ swn, Br8c14 ≠ wne, Br8c14 ≠ o, Br8c14 ≠ e
whip[1]: Br8c14{nes .} ==> Nr8c14 ≠ 0
whip[1]: Br8c13{se .} ==> Pr9c13 ≠ ne, Pr9c13 ≠ ns, Pr9c13 ≠ nw, Nr8c13 ≠ 3
whip[1]: Br8c12{ns .} ==> Nr8c12 ≠ 3
whip[1]: Pr7c11{ns .} ==> Br7c11 ≠ e, Br7c10 ≠ w
B-single: Br7c10 = ew
B-single: Br7c11 = ew
whip[1]: Br7c10{ew .} ==> Nr7c10 ≠ 1, Pr8c11 ≠ o
N-single: Nr7c10 = 2
P-single: Pr8c11 = ns
whip[1]: Pr8c11{ns .} ==> Br8c11 ≠ o, Br8c10 ≠ w, Br8c10 ≠ sw, Br8c11 ≠ s
whip[1]: Br8c11{sw .} ==> Pr9c11 ≠ ew, Pr9c11 ≠ sw, Nr8c11 ≠ 0
whip[1]: Pr9c11{ns .} ==> Br8c10 ≠ esw, Br9c10 ≠ ne, Br9c10 ≠ ns, Br9c10 ≠ nes, Br9c11 ≠ nw, Br9c11 ≠ se, Br9c10 ≠ n
B-single: Br8c10 = ew
whip[1]: Br8c10{ew .} ==> Nr8c10 ≠ 3, Nr8c10 ≠ 1, Pr9c10 ≠ ne
N-single: Nr8c10 = 2
whip[1]: Pr9c10{nw .} ==> Br9c9 ≠ o, Br9c9 ≠ s
whip[1]: Br9c9{swn .} ==> Nr9c9 ≠ 0
whip[1]: Br7c11{ew .} ==> Nr7c11 ≠ 1
N-single: Nr7c11 = 2
whip[1]: Hr13c10{1 .} ==> Br13c10 ≠ o, Br12c10 ≠ o, Pr13c10 ≠ o, Pr13c10 ≠ ns, Pr13c10 ≠ nw, Pr13c10 ≠ sw, Pr13c11 ≠ ns, Pr13c11 ≠ se, Br12c10 ≠ n, Br12c10 ≠ e, Br12c10 ≠ w, Br12c10 ≠ ne, Br12c10 ≠ nw, Br12c10 ≠ ew, Br12c10 ≠ wne, Br13c10 ≠ e, Br13c10 ≠ w, Br13c10 ≠ ew
whip[1]: Br13c10{wne .} ==> Nr13c10 ≠ 0
whip[1]: Br12c10{nes .} ==> Nr12c10 ≠ 0
whip[1]: Pr13c11{ew .} ==> Vr13c11 ≠ 1, Br12c11 ≠ sw, Br13c10 ≠ wne, Br12c11 ≠ ne, Br13c10 ≠ ne
whip[1]: Br13c10{nw .} ==> Pr14c11 ≠ ne, Nr13c10 ≠ 3
P-single: Pr14c11 = o
whip[1]: Pr14c11{o .} ==> Hr14c11 ≠ 1, Br14c11 ≠ n, Br14c11 ≠ ne
whip[1]: Br14c11{e .} ==> Nr14c11 ≠ 2, Pr14c12 ≠ nw, Pr14c12 ≠ ew
whip[1]: Pr14c12{se .} ==> Vr14c12 ≠ 0, Br13c12 ≠ ne, Br13c12 ≠ sw, Br14c12 ≠ ne, Br14c12 ≠ ns, Br14c12 ≠ se, Br14c11 ≠ o
V-single: Vr14c12 = 1
B-single: Br14c11 = e
vertical-line-r14{c11 c12} ==> Ir14c12 = out
same-colour-in-r14{c12 c13} ==> Vr14c13 = 0
different-colours-in-{r13 r14}c12 ==> Hr14c12 = 1

LOOP[6]: Vr14c12-Hr14c12-Hr14c13-Vr14c14-Hr15c13- ==> Hr15c12 = 0
no-horizontal-line-{r14 r15}c12 ==> Ir15c12 = out
same-colour-in-{r15 r16}c12 ==> Hr16c12 = 0
different-colours-in-r15{c12 c13} ==> Hr15c13 = 1
different-colours-in-r15{c11 c12} ==> Hr15c12 = 1
whip[1]: Vr14c12{1 .} ==> Pr15c12 ≠ se
P-single: Pr15c12 = ns
whip[1]: Pr15c12{ns .} ==> Br15c12 ≠ e, Br15c12 ≠ n, Br15c12 ≠ o, Br15c11 ≠ o, Br14c12 ≠ sw, Br15c11 ≠ s, Br15c12 ≠ s, Br15c12 ≠ ne, Br15c12 ≠ ns, Br15c12 ≠ nw, Br15c12 ≠ se, Br15c12 ≠ swn, Br15c12 ≠ wne, Br15c12 ≠ nes
whip[1]: Br15c12{esw .} ==> Pr16c12 ≠ o, Pr16c12 ≠ ew, Pr15c13 ≠ ew, Nr15c12 ≠ 0
whip[1]: Pr15c13{se .} ==> Br14c13 ≠ esw, Br14c13 ≠ swn, Br15c12 ≠ sw, Br15c13 ≠ ne, Br15c13 ≠ ns, Br15c13 ≠ se, Br15c13 ≠ nes, Br15c12 ≠ w, Br15c13 ≠ o, Br15c13 ≠ n, Br15c13 ≠ e, Br15c13 ≠ s
whip[1]: Br15c13{wne .} ==> Pr16c13 ≠ o, Pr16c13 ≠ ew, Nr15c13 ≠ 0
whip[1]: Br15c12{esw .} ==> Nr15c12 ≠ 1
whip[1]: Br14c13{nes .} ==> Pr14c13 ≠ ns, Pr14c14 ≠ o, Pr14c14 ≠ ne, Pr14c14 ≠ ns, Pr14c14 ≠ nw, Pr14c14 ≠ se, Pr14c14 ≠ ew, Pr15c14 ≠ o, Pr15c14 ≠ se, Pr15c14 ≠ ew, Pr15c14 ≠ sw
P-single: Pr14c14 = sw
P-single: Pr14c13 = ew
w[1]-1-in-r13c14-symmetric-sw-corner ==> Pr13c15 ≠ sw, Pr13c15 ≠ ne, Pr13c15 ≠ o
whip[1]: Pr14c14{sw .} ==> Br14c14 ≠ ns, Br14c14 ≠ ne, Br14c14 ≠ s, Br14c14 ≠ e, Br14c14 ≠ n, Br14c14 ≠ o, Br13c14 ≠ w, Br13c14 ≠ s, Br13c13 ≠ ne, Br13c13 ≠ w, Br13c13 ≠ e, Br13c13 ≠ n, Br13c13 ≠ o, Br13c13 ≠ nw, Br13c13 ≠ se, Br13c13 ≠ ew, Br13c13 ≠ esw, Br13c13 ≠ wne, Br13c13 ≠ nes, Br14c14 ≠ nw, Br14c14 ≠ se, Br14c14 ≠ swn, Br14c14 ≠ wne, Br14c14 ≠ nes
whip[1]: Br14c14{esw .} ==> Pr14c15 ≠ nw, Pr14c15 ≠ ew, Pr14c15 ≠ sw, Nr14c14 ≠ 0
whip[1]: Br13c13{swn .} ==> Pr13c14 ≠ ns, Pr13c14 ≠ se, Pr13c14 ≠ sw, Nr13c13 ≠ 0
whip[1]: Pr14c13{ew .} ==> Br13c12 ≠ nw, Br13c12 ≠ se, Br13c12 ≠ ew, Br13c13 ≠ sw, Br13c13 ≠ swn, Br14c12 ≠ ew, Br14c13 ≠ wne
B-single: Br14c13 = nes
B-single: Br14c12 = nw
B-single: Br13c12 = ns
whip[1]: Br14c13{nes .} ==> Pr15c14 ≠ ns, Pr15c14 ≠ ne, Pr15c13 ≠ ns
P-single: Pr14c12 = se
P-single: Pr15c13 = se
P-single: Pr15c14 = nw
whip[1]: Pr14c12{se .} ==> Vr13c12 ≠ 1
whip[1]: Pr15c13{se .} ==> Br15c13 ≠ w, Br15c13 ≠ ew, Br15c13 ≠ sw, Br15c13 ≠ esw
whip[1]: Br15c13{wne .} ==> Pr16c14 ≠ nw, Nr15c13 ≠ 1
whip[1]: Pr16c14{ew .} ==> Br15c14 ≠ nw, Br15c14 ≠ ew, Br15c14 ≠ wne, Br15c14 ≠ w
whip[1]: Pr15c14{nw .} ==> Br15c14 ≠ n, Br14c14 ≠ sw, Br14c14 ≠ esw, Br15c13 ≠ wne, Br15c14 ≠ ne, Br15c14 ≠ ns, Br15c14 ≠ sw, Br15c14 ≠ esw, Br15c14 ≠ swn, Br15c14 ≠ nes
whip[1]: Br15c14{se .} ==> Pr16c14 ≠ ne, Pr15c15 ≠ nw, Pr15c15 ≠ ew, Pr15c15 ≠ sw, Nr15c14 ≠ 3
whip[1]: Br14c14{ew .} ==> Nr14c14 ≠ 3
whip[1]: Br13c12{ns .} ==> Pr13c13 ≠ se, Pr13c13 ≠ ns, Pr13c12 ≠ ns, Pr13c12 ≠ sw
whip[1]: Pr13c12{ew .} ==> Br12c11 ≠ nw, Br12c11 ≠ se, Br12c12 ≠ nw, Br12c12 ≠ ew, Br12c12 ≠ wne, Br12c12 ≠ o, Br12c12 ≠ n, Br12c12 ≠ e, Br12c12 ≠ w, Br12c12 ≠ ne
whip[1]: Br12c12{nes .} ==> Nr12c12 ≠ 0
whip[1]: Pr13c13{ew .} ==> Br12c13 ≠ sw, Br12c13 ≠ ne
whip[1]: Br13c13{ns .} ==> Nr13c13 ≠ 3
whip[1]: Pr13c15{ew .} ==> Br12c15 ≠ sw, Br12c15 ≠ esw, Br12c15 ≠ swn, Br12c15 ≠ o, Br12c15 ≠ n, Br12c15 ≠ e, Br12c15 ≠ ne
whip[1]: Br12c15{nes .} ==> Nr12c15 ≠ 0
whip[1]: Br15c11{se .} ==> Nr15c11 ≠ 0
whip[1]: Br14c11{e .} ==> Nr14c11 ≠ 0
N-single: Nr14c11 = 1
whip[1]: Hr16c12{0 .} ==> Br16c12 ≠ n, Pr16c12 ≠ ne, Pr16c13 ≠ nw, Br15c12 ≠ esw
P-single: Pr16c13 = ne
P-single: Pr16c12 = nw
B-single: Br15c12 = ew
B-single: Br16c12 = o
whip[1]: Pr16c13{ne .} ==> Br16c13 ≠ o, Br15c13 ≠ nw
B-single: Br15c13 = swn
B-single: Br16c13 = n
whip[1]: Br15c13{swn .} ==> Nr15c13 ≠ 2, Pr16c14 ≠ o
N-single: Nr15c13 = 3
P-single: Pr16c14 = ew
whip[1]: Pr16c14{ew .} ==> Br15c14 ≠ e, Br15c14 ≠ o, Br16c14 ≠ o
B-single: Br16c14 = n
whip[1]: Br16c14{n .} ==> Pr16c15 ≠ o, Pr16c15 ≠ ne
whip[1]: Pr16c15{ew .} ==> Br15c15 ≠ esw, Br15c15 ≠ o, Br15c15 ≠ n
whip[1]: Br15c15{nes .} ==> Nr15c15 ≠ 0
whip[1]: Br15c14{se .} ==> Nr15c14 ≠ 0
whip[1]: Pr16c12{nw .} ==> Br15c11 ≠ e, Br16c11 ≠ o
B-single: Br16c11 = n
B-single: Br15c11 = se
whip[1]: Br16c11{n .} ==> Pr16c11 ≠ o
P-single: Pr16c11 = ew
w[1]-1-in-r15c10-asymmetric-se-corner ==> Pr15c10 ≠ ns
P-single: Pr15c10 = nw
whip[1]: Pr16c11{ew .} ==> Br15c10 ≠ w, Br16c10 ≠ o
B-single: Br16c10 = n
B-single: Br15c10 = s
whip[1]: Pr15c10{nw .} ==> Br14c9 ≠ e, Br14c9 ≠ ne, Br14c9 ≠ ew, Br14c9 ≠ wne, Br15c9 ≠ esw
B-single: Br15c9 = swn
whip[1]: Br15c9{swn .} ==> Pr15c9 ≠ sw, Pr15c9 ≠ ns
P-single: Pr14c8 = se
P-single: Pr15c9 = se
whip[1]: Pr14c8{se .} ==> Br14c7 ≠ w, Br14c7 ≠ s, Br14c7 ≠ n, Br14c7 ≠ o, Br13c8 ≠ w, Br13c8 ≠ e, Br13c8 ≠ n, Br13c8 ≠ o, Br13c7 ≠ s, Br13c7 ≠ e, Br13c7 ≠ ne, Br13c7 ≠ ns, Br13c7 ≠ ew, Br13c7 ≠ sw, Br13c7 ≠ swn, Br13c7 ≠ wne, Br13c8 ≠ ne, Br13c8 ≠ nw, Br13c8 ≠ ew, Br13c8 ≠ sw, Br13c8 ≠ esw, Br13c8 ≠ swn, Br13c8 ≠ wne, Br14c7 ≠ ne, Br14c7 ≠ ns, Br14c7 ≠ nw, Br14c7 ≠ sw, Br14c7 ≠ swn, Br14c7 ≠ wne, Br14c8 ≠ ne, Br14c8 ≠ ns, Br14c8 ≠ ew
B-single: Br14c8 = nw
whip[1]: Br14c8{nw .} ==> Pr15c8 ≠ se, Pr14c9 ≠ se, Pr14c9 ≠ ns
P-single: Pr15c8 = ns
whip[1]: Pr15c8{ns .} ==> Br15c7 ≠ nes, Br15c8 ≠ wne
B-single: Br15c8 = ew
B-single: Br15c7 = esw
whip[1]: Br15c8{ew .} ==> Nr15c8 ≠ 3
N-single: Nr15c8 = 2
whip[1]: Br15c7{esw .} ==> Pr15c7 ≠ ew, Pr15c7 ≠ ne, Pr16c7 ≠ ew
P-single: Pr16c7 = ne
whip[1]: Pr16c7{ne .} ==> Br16c6 ≠ n, Br15c6 ≠ s, Br15c6 ≠ ns, Br15c6 ≠ sw, Br15c6 ≠ swn
B-single: Br16c6 = o
whip[1]: Br16c6{o .} ==> Pr16c6 ≠ ne, Pr16c6 ≠ ew
w[1]-1-in-r13c3-symmetric-se-corner ==> Pr13c3 ≠ se, Pr13c3 ≠ nw, Pr13c3 ≠ o
whip[1]: Pr13c3{sw .} ==> Br12c2 ≠ nw, Br12c2 ≠ se, Br12c2 ≠ esw, Br12c2 ≠ nes, Br12c2 ≠ o, Br12c2 ≠ n, Br12c2 ≠ w, Br13c3 ≠ e, Br13c3 ≠ s
whip[1]: Br13c3{w .} ==> Hr14c3 ≠ 1, Vr13c4 ≠ 1, Pr13c4 ≠ ns, Pr14c3 ≠ ne, Pr14c4 ≠ nw, Pr13c4 ≠ se, Pr13c4 ≠ sw, Pr14c3 ≠ se, Pr14c3 ≠ ew
V-single: Vr13c4 = 0
H-single: Hr14c3 = 0
no-vertical-line-r13{c3 c4} ==> Ir13c3 = out
no-horizontal-line-{r13 r14}c3 ==> Ir14c3 = out
whip[1]: Vr13c4{0 .} ==> Br13c4 ≠ nw, Br13c4 ≠ ew, Br13c4 ≠ sw
whip[1]: Hr14c3{0 .} ==> Br14c3 ≠ n, Br14c3 ≠ ne, Br14c3 ≠ ns, Br14c3 ≠ nw, Br14c3 ≠ swn, Br14c3 ≠ wne, Br14c3 ≠ nes
whip[1]: Pr13c5{sw .} ==> Br12c4 ≠ nw, Br12c4 ≠ se, Br12c4 ≠ esw, Br12c4 ≠ nes, Br13c5 ≠ nw, Br13c5 ≠ se, Br12c4 ≠ o, Br12c4 ≠ n, Br12c4 ≠ w
whip[1]: Br12c4{wne .} ==> Nr12c4 ≠ 0
whip[1]: Pr14c5{ew .} ==> Br13c5 ≠ sw, Br14c4 ≠ sw, Br14c5 ≠ nw, Br13c5 ≠ ne, Br14c4 ≠ ne
whip[1]: Br14c5{sw .} ==> Pr15c6 ≠ se
whip[1]: Pr15c6{ew .} ==> Br14c6 ≠ sw, Br15c5 ≠ sw, Br15c6 ≠ wne, Br14c6 ≠ ne, Br15c5 ≠ ne
whip[1]: Br15c6{ew .} ==> Nr15c6 ≠ 3
whip[1]: Pr14c4{se .} ==> Br14c4 ≠ ns, Br14c4 ≠ ew
whip[1]: Br12c2{wne .} ==> Nr12c2 ≠ 0
whip[1]: Pr14c7{ew .} ==> Br13c7 ≠ o, Br13c7 ≠ n
whip[1]: Br13c7{nw .} ==> Vr13c7 ≠ 0, Pr13c7 ≠ ne, Pr13c7 ≠ ew, Pr13c8 ≠ ns, Pr13c8 ≠ se, Pr13c8 ≠ sw, Pr14c7 ≠ se, Pr14c7 ≠ ew, Nr13c7 ≠ 0, Nr13c7 ≠ 3
V-single: Vr13c7 = 1
vertical-line-r13{c6 c7} ==> Ir13c6 = out
different-colours-in-r13{c5 c6} ==> Hr13c6 = 1
different-colours-in-{r12 r13}c6 ==> Hr13c6 = 1
whip[1]: Vr13c7{1 .} ==> Br13c6 ≠ o, Br13c6 ≠ n, Br13c6 ≠ s, Br13c6 ≠ w, Br13c6 ≠ ns, Br13c6 ≠ nw, Br13c6 ≠ sw, Br13c6 ≠ swn
whip[1]: Br13c6{nes .} ==> Nr13c6 ≠ 0
whip[1]: Vr13c6{1 .} ==> Pr13c6 ≠ nw, Pr13c6 ≠ ew, Pr14c6 ≠ ew, Pr14c6 ≠ sw, Br13c5 ≠ ns, Br13c6 ≠ e, Br13c6 ≠ ne, Br13c6 ≠ se, Br13c6 ≠ nes
B-single: Br13c5 = ew
whip[1]: Br13c5{ew .} ==> Pr14c5 ≠ ew, Pr13c5 ≠ ew, Hr14c5 ≠ 1, Hr13c5 ≠ 1
H-single: Hr14c5 = 0
P-single: Pr14c6 = ns
no-horizontal-line-{r13 r14}c5 ==> Ir14c5 = in
whip[1]: Hr14c5{0 .} ==> Br14c5 ≠ ne, Br14c5 ≠ ns
whip[1]: Pr14c6{ns .} ==> Vr14c6 ≠ 0, Hr14c6 ≠ 1, Br13c6 ≠ esw, Br14c5 ≠ sw, Br14c6 ≠ ns, Br14c6 ≠ nw, Br14c6 ≠ se
H-single: Hr14c6 = 0
V-single: Vr14c6 = 1
B-single: Br14c6 = ew
vertical-line-r14{c5 c6} ==> Ir14c6 = out
same-colour-in-{r14 r15}c6 ==> Hr15c6 = 0
different-colours-in-r14{c6 c7} ==> Hr14c7 = 1
whip[1]: Hr14c6{0 .} ==> Pr14c7 ≠ nw
P-single: Pr14c7 = ns
whip[1]: Pr14c7{ns .} ==> Br14c7 ≠ e
B-single: Br14c7 = ew
whip[1]: Br14c7{ew .} ==> Nr14c7 ≠ 3, Nr14c7 ≠ 1, Nr14c7 ≠ 0, Pr15c7 ≠ sw
N-single: Nr14c7 = 2
P-single: Pr15c7 = ns
whip[1]: Pr15c7{ns .} ==> Br15c6 ≠ ne
whip[1]: Br15c6{ew .} ==> Pr15c6 ≠ ew
whip[1]: Br13c6{wne .} ==> Nr13c6 ≠ 1
whip[1]: Pr15c5{se .} ==> Br15c4 ≠ ne, Br15c4 ≠ sw, Br15c4 ≠ wne, Br15c4 ≠ nes, Br15c5 ≠ ns, Br15c5 ≠ ew, Br15c4 ≠ o, Br15c4 ≠ s, Br15c4 ≠ w
whip[1]: Br15c4{swn .} ==> Nr15c4 ≠ 0
whip[1]: Pr13c5{sw .} ==> Br13c4 ≠ ns
whip[1]: Pr13c6{se .} ==> Br12c6 ≠ ne, Br12c6 ≠ sw
whip[1]: Hr13c6{1 .} ==> Pr13c6 ≠ ns, Pr13c7 ≠ ns, Br12c6 ≠ nw, Br12c6 ≠ ew, Br13c6 ≠ ew
P-single: Pr13c7 = sw
P-single: Pr13c6 = se
B-single: Br13c6 = wne
w[1]-1-in-r12c7-symmetric-sw-corner ==> Pr12c8 ≠ sw, Pr12c8 ≠ ne, Pr12c8 ≠ o
w[1]-1-in-r11c8-asymmetric-sw-corner ==> Pr11c9 ≠ ew, Pr11c9 ≠ nw, Pr11c9 ≠ ns
whip[1]: Pr13c7{sw .} ==> Br12c7 ≠ w, Br12c7 ≠ s, Br12c6 ≠ se, Br13c7 ≠ nw
B-single: Br13c7 = w
B-single: Br12c6 = ns
whip[1]: Br13c7{w .} ==> Nr13c7 ≠ 2, Pr13c8 ≠ nw, Pr13c8 ≠ ew
N-single: Nr13c7 = 1
whip[1]: Pr13c8{ne .} ==> Br12c8 ≠ wne, Br12c8 ≠ nes
whip[1]: Br12c8{swn .} ==> Pr12c8 ≠ nw, Pr12c8 ≠ ew, Pr13c8 ≠ o, Pr13c9 ≠ o, Pr13c9 ≠ ne, Pr13c9 ≠ ns, Pr13c9 ≠ se
P-single: Pr13c8 = ne
w[1]-1-in-r12c7-asymmetric-se-corner ==> Pr12c7 ≠ ew, Pr12c7 ≠ ns
whip[1]: Pr13c8{ne .} ==> Br12c7 ≠ n, Br13c8 ≠ s, Br13c8 ≠ se
B-single: Br12c7 = e
whip[1]: Br12c7{e .} ==> Pr12c7 ≠ se
P-single: Pr12c7 = nw
whip[1]: Pr12c7{nw .} ==> Br11c7 ≠ s, Br11c7 ≠ e, Br11c7 ≠ n, Br11c7 ≠ o, Br11c6 ≠ s, Br11c6 ≠ e, Br11c6 ≠ n, Br11c6 ≠ o, Vr11c7 ≠ 0, Hr12c6 ≠ 0, Br11c6 ≠ w, Br11c6 ≠ ne, Br11c6 ≠ ns, Br11c6 ≠ nw, Br11c6 ≠ ew, Br11c6 ≠ sw, Br11c6 ≠ swn, Br11c6 ≠ wne, Br11c7 ≠ ne, Br11c7 ≠ ns, Br11c7 ≠ se, Br11c7 ≠ sw, Br11c7 ≠ esw, Br11c7 ≠ swn, Br11c7 ≠ nes
H-single: Hr12c6 = 1
V-single: Vr11c7 = 1
w[1]-3-in-r10c7-hit-by-verti-line-at-sw ==> Vr10c8 = 1, Hr10c7 = 1, Hr11c6 = 0
w[1]-3-in-r10c7-closed-ne-corner ==> Pr11c7 ≠ sw, Pr11c7 ≠ ne, Pr11c7 ≠ o
vertical-line-r11{c6 c7} ==> Ir11c6 = out
no-horizontal-line-{r10 r11}c6 ==> Ir10c6 = out
different-colours-in-r11{c5 c6} ==> Hr11c6 = 1
whip[1]: Hr12c6{1 .} ==> Pr12c6 ≠ ns, Pr12c6 ≠ sw
whip[1]: Pr12c6{ew .} ==> Vr12c6 ≠ 1, Br11c5 ≠ nw, Br11c5 ≠ se
whip[1]: Vr11c7{1 .} ==> Pr11c7 ≠ nw, Pr11c7 ≠ ew
whip[1]: Pr11c7{se .} ==> Br10c7 ≠ esw, Br10c7 ≠ swn, Br11c6 ≠ nes, Br10c6 ≠ s
whip[1]: Br10c6{w .} ==> Pr10c6 ≠ se, Pr10c7 ≠ sw, Pr11c6 ≠ se, Pr11c6 ≠ ew
whip[1]: Pr11c6{sw .} ==> Br11c5 ≠ sw, Br10c5 ≠ o, Br10c5 ≠ n, Br10c5 ≠ w
whip[1]: Br10c5{nes .} ==> Nr10c5 ≠ 0
whip[1]: Pr10c6{sw .} ==> Br10c5 ≠ se, Br10c5 ≠ ew, Br10c5 ≠ esw, Br10c5 ≠ e
whip[1]: Br10c5{nes .} ==> Pr11c5 ≠ ns
whip[1]: Pr11c5{sw .} ==> Br10c4 ≠ nw, Br10c4 ≠ se, Br10c4 ≠ esw, Br11c4 ≠ se, Br11c4 ≠ ew, Br11c4 ≠ esw, Br10c4 ≠ o, Br10c4 ≠ n, Br10c4 ≠ w, Br11c4 ≠ e
whip[1]: Br10c4{swn .} ==> Nr10c4 ≠ 0
whip[1]: Br11c6{esw .} ==> Nr11c6 ≠ 0, Nr11c6 ≠ 1
whip[1]: Br10c7{nes .} ==> Pr10c7 ≠ o, Pr10c7 ≠ ns, Pr10c7 ≠ nw, Pr10c8 ≠ o, Pr10c8 ≠ ne, Pr10c8 ≠ ns, Pr10c8 ≠ nw, Pr10c8 ≠ se, Pr10c8 ≠ ew, Pr11c8 ≠ o, Pr11c8 ≠ se, Pr11c8 ≠ ew, Pr11c8 ≠ sw
P-single: Pr10c8 = sw
whip[1]: Pr10c8{sw .} ==> Br10c8 ≠ ns, Br10c8 ≠ ne, Br10c8 ≠ s, Br10c8 ≠ e, Br10c8 ≠ n, Br10c8 ≠ o, Br9c8 ≠ ns, Br9c7 ≠ e, Br9c7 ≠ n, Br9c7 ≠ nw, Br9c7 ≠ se, Br9c7 ≠ ew, Br9c7 ≠ esw, Br9c8 ≠ nw, Br9c8 ≠ se, Br9c8 ≠ ew, Br9c8 ≠ esw, Br9c8 ≠ swn, Br10c8 ≠ nw, Br10c8 ≠ se, Br10c8 ≠ swn, Br10c8 ≠ wne, Br10c8 ≠ nes
whip[1]: Br10c8{esw .} ==> Pr10c9 ≠ nw, Pr10c9 ≠ ew, Pr10c9 ≠ sw, Nr10c8 ≠ 0
whip[1]: Br9c8{e .} ==> Nr9c8 ≠ 2, Pr9c8 ≠ ns, Pr9c8 ≠ se, Nr9c8 ≠ 3
N-single: Nr9c8 = 1
whip[1]: Pr9c8{ew .} ==> Hr9c7 ≠ 0, Br8c7 ≠ nw, Br8c7 ≠ ew, Br8c7 ≠ n, Br8c7 ≠ e
H-single: Hr9c7 = 1
whip[1]: Hr9c7{1 .} ==> Pr9c7 ≠ o, Pr9c7 ≠ ns
whip[1]: Br8c7{swn .} ==> Nr8c7 ≠ 1
whip[1]: Br9c7{swn .} ==> Nr9c7 ≠ 1
whip[1]: Pr11c8{nw .} ==> Br11c7 ≠ wne
whip[1]: Br11c7{ew .} ==> Nr11c7 ≠ 0, Nr11c7 ≠ 3
whip[1]: Pr10c7{ew .} ==> Br9c6 ≠ se
whip[1]: Br9c6{s .} ==> Nr9c6 ≠ 2
whip[1]: Vr11c6{1 .} ==> Pr11c6 ≠ nw, Pr12c6 ≠ ew, Br11c5 ≠ ns, Br11c6 ≠ se
P-single: Pr12c6 = ne
B-single: Br11c6 = esw
whip[1]: Pr12c6{ne .} ==> Hr12c5 ≠ 1
whip[1]: Br11c6{esw .} ==> Nr11c6 ≠ 2
N-single: Nr11c6 = 3
whip[1]: Br11c5{ew .} ==> Pr12c5 ≠ se, Pr12c5 ≠ ew
whip[1]: Pr11c6{sw .} ==> Br10c5 ≠ nes
whip[1]: Br10c5{sw .} ==> Nr10c5 ≠ 3
whip[1]: Br13c8{nes .} ==> Nr13c8 ≠ 0, Nr13c8 ≠ 1
whip[1]: Pr13c9{sw .} ==> Br12c9 ≠ sw, Br12c9 ≠ esw, Br12c9 ≠ swn, Br13c9 ≠ wne
whip[1]: Br13c9{ew .} ==> Nr13c9 ≠ 3
whip[1]: Pr12c8{se .} ==> Br11c8 ≠ n, Br11c8 ≠ e
whip[1]: Br11c8{w .} ==> Pr11c8 ≠ ne, Pr12c9 ≠ ns, Pr12c9 ≠ nw, Pr11c9 ≠ sw
whip[1]: Pr11c9{ne .} ==> Br10c8 ≠ sw, Br10c8 ≠ esw, Br10c9 ≠ s, Br10c9 ≠ w, Br10c9 ≠ ns, Br10c9 ≠ nw, Br10c9 ≠ se, Br10c9 ≠ ew, Br10c9 ≠ wne, Br10c9 ≠ nes, Br11c9 ≠ nw, Br11c9 ≠ ew, Br11c9 ≠ sw
whip[1]: Br10c8{ew .} ==> Nr10c8 ≠ 3
whip[1]: Pr12c9{ew .} ==> Br12c9 ≠ se, Br12c9 ≠ ew, Br11c9 ≠ ne, Br12c9 ≠ o, Br12c9 ≠ e, Br12c9 ≠ s, Br12c9 ≠ w
whip[1]: Br12c9{nes .} ==> Pr12c10 ≠ ne, Pr12c10 ≠ ns, Nr12c9 ≠ 0
whip[1]: Pr12c10{sw .} ==> Br11c10 ≠ sw, Br11c10 ≠ esw, Br11c10 ≠ swn, Br12c10 ≠ swn
whip[1]: Pr11c8{nw .} ==> Br11c7 ≠ w
whip[1]: Br11c7{ew .} ==> Nr11c7 ≠ 1
N-single: Nr11c7 = 2
whip[1]: Br13c6{wne .} ==> Nr13c6 ≠ 2
N-single: Nr13c6 = 3
whip[1]: Pr16c5{ew .} ==> Br16c4 ≠ o, Hr16c4 ≠ 0, Br15c4 ≠ nw, Br15c4 ≠ ew, Br15c4 ≠ n, Br15c4 ≠ e
H-single: Hr16c4 = 1
B-single: Br16c4 = n
horizontal-line-{r15 r16}c4 ==> Ir15c4 = in
whip[1]: Hr16c4{1 .} ==> Pr16c4 ≠ o, Pr16c4 ≠ nw
whip[1]: Pr16c4{ew .} ==> Br15c3 ≠ nw, Br15c3 ≠ se, Br15c3 ≠ esw, Br15c3 ≠ nes, Br15c3 ≠ o, Br15c3 ≠ n, Br15c3 ≠ w
whip[1]: Br15c3{wne .} ==> Nr15c3 ≠ 0
whip[1]: Br15c4{swn .} ==> Nr15c4 ≠ 1
whip[1]: Pr14c9{ew .} ==> Br13c9 ≠ e, Br13c9 ≠ ne
whip[1]: Br14c9{nes .} ==> Nr14c9 ≠ 1
whip[1]: Br15c11{se .} ==> Nr15c11 ≠ 1
N-single: Nr15c11 = 2
whip[1]: Br15c12{ew .} ==> Nr15c12 ≠ 3
N-single: Nr15c12 = 2
whip[1]: Pr13c10{ew .} ==> Br12c9 ≠ nes
whip[1]: Hr12c10{1 .} ==> Br11c10 ≠ o, Pr12c10 ≠ nw, Pr12c10 ≠ sw, Pr12c11 ≠ ne, Pr12c11 ≠ ns, Br11c10 ≠ n, Br11c10 ≠ e, Br11c10 ≠ w, Br11c10 ≠ ne, Br11c10 ≠ nw, Br11c10 ≠ ew, Br11c10 ≠ wne, Br12c10 ≠ s, Br12c10 ≠ se, Br12c10 ≠ sw, Br12c10 ≠ esw
P-single: Pr11c9 = ne
P-single: Pr12c10 = ew
whip[1]: Pr11c9{ne .} ==> Br10c9 ≠ n, Br10c9 ≠ o, Vr10c9 ≠ 0, Hr11c9 ≠ 0, Br10c8 ≠ w, Br10c9 ≠ e, Br10c9 ≠ ne, Br11c9 ≠ se
H-single: Hr11c9 = 1
V-single: Vr10c9 = 1
B-single: Br11c9 = ns
B-single: Br10c8 = ew
no-vertical-line-r11{c9 c10} ==> Ir11c9 = in
no-vertical-line-r11{c8 c9} ==> Ir11c8 = in
no-horizontal-line-{r10 r11}c8 ==> Ir10c8 = in
no-horizontal-line-{r9 r10}c8 ==> Ir9c8 = in
no-vertical-line-r9{c7 c8} ==> Ir9c7 = in
horizontal-line-{r8 r9}c7 ==> Ir8c7 = out
horizontal-line-{r9 r10}c7 ==> Ir10c7 = out
horizontal-line-{r11 r12}c9 ==> Ir12c9 = out
same-colour-in-r12{c9 c10} ==> Vr12c10 = 0
same-colour-in-r12{c8 c9} ==> Vr12c9 = 0
w[1]-adjacent-1-2-on-pseudo-edge-in-r11{c8 c9}-fwd-diag-2s-3 ==> Vr11c8 = 0
w[1]-2-in-r11c7-open-se-corner ==> Hr11c7 = 1, Vr10c7 = 0
w[1]-adjacent-1-3-on-pseudo-edge-in-r12{c7 c8} ==> Hr12c8 = 1
w[1]-3-in-r12c8-closed-nw-corner ==> Pr13c9 ≠ nw
w[1]-3-in-r10c7-closed-se-corner ==> Pr10c7 ≠ se

LOOP[8]: Hr13c10-Vr12c11-Hr12c10-Hr12c9-Hr12c8-Vr12c8-Hr13c8- ==> Hr13c9 = 0
no-horizontal-line-{r12 r13}c9 ==> Ir13c9 = out
same-colour-in-{r13 r14}c9 ==> Hr14c9 = 0
different-colours-in-r13{c9 c10} ==> Hr13c10 = 1
different-colours-in-r13{c8 c9} ==> Hr13c9 = 1
different-colours-in-r8{c7 c8} ==> Hr8c8 = 1
w[1]-2-in-r7c7-open-se-corner ==> Hr7c7 = 1, Vr7c7 = 1, Hr7c6 = 0, Vr6c7 = 0
w[1]-2-in-r6c6-open-se-corner ==> Hr6c6 = 1, Vr6c6 = 1
P-single: Pr7c7 = se
P-single: Pr6c6 = se
vertical-line-r6{c5 c6} ==> Ir6c6 = in
no-horizontal-line-{r6 r7}c6 ==> Ir7c6 = in
vertical-line-r7{c6 c7} ==> Ir7c7 = out
different-colours-in-r9{c8 c9} ==> Hr9c9 = 1

LOOP[30]: Hr9c7-Vr8c8-Hr8c8-Vr7c9-Hr7c9-Vr7c10-Vr8c10-Hr9c9-Vr9c9-Vr10c9-Hr11c9-Vr10c10-Hr10c10-Vr10c11-Hr11c11-Vr10c12-Vr9c12-Hr9c11-Vr8c11-Vr7c11-Vr6c11-Vr5c11-Hr5c10-Vr5c10-Hr6c9-Hr6c8-Vr6c8-Hr7c7-Vr7c7- ==> Vr8c7 = 0
w[1]-diagonal-3-1-in-{r7c5...r8c6}-open-end ==> Hr7c5 = 1
w[1]-3-in-r7c5-closed-nw-corner ==> Pr8c6 ≠ nw
P-single: Pr8c6 = ew
w[1]-1-in-r8c6-asymmetric-nw-corner ==> Pr9c7 ≠ ne
P-single: Pr9c7 = se
no-vertical-line-r6{c4 c5} ==> Ir6c4 = out
no-horizontal-line-{r6 r7}c4 ==> Ir7c4 = out
no-horizontal-line-{r7 r8}c4 ==> Ir8c4 = out
no-vertical-line-r8{c4 c5} ==> Ir8c5 = out
no-vertical-line-r8{c5 c6} ==> Ir8c6 = out
no-horizontal-line-{r8 r9}c6 ==> Ir9c6 = out
no-vertical-line-r9{c5 c6} ==> Ir9c5 = out
vertical-line-r9{c4 c5} ==> Ir9c4 = in
no-vertical-line-r9{c3 c4} ==> Ir9c3 = in
no-horizontal-line-{r8 r9}c3 ==> Ir8c3 = in
horizontal-line-{r7 r8}c5 ==> Ir7c5 = in
same-colour-in-{r9 r10}c6 ==> Hr10c6 = 0
w[0]-adjacent-3-in-r10c7-nolines-west ==> Vr9c7 = 1
different-colours-in-{r7 r8}c6 ==> Hr8c6 = 1
different-colours-in-{r5 r6}c4 ==> Hr6c4 = 1
whip[1]: Hr11c9{1 .} ==> Pr11c10 ≠ ns, Pr11c10 ≠ se
whip[1]: Pr11c10{ew .} ==> Br10c10 ≠ esw, Br10c10 ≠ swn
whip[1]: Br10c10{nes .} ==> Pr10c10 ≠ o, Pr10c10 ≠ ns, Pr10c10 ≠ nw, Pr10c10 ≠ sw, Pr10c11 ≠ ns, Pr10c11 ≠ ew, Pr11c11 ≠ ew, Pr11c11 ≠ sw
P-single: Pr9c12 = sw
P-single: Pr10c11 = sw
whip[1]: Pr9c12{sw .} ==> Br9c12 ≠ ns, Br9c12 ≠ ne, Br9c12 ≠ n, Br9c11 ≠ ns, Br8c12 ≠ ns, Br8c11 ≠ w, Br9c11 ≠ ew, Br9c12 ≠ nw, Br9c12 ≠ swn, Br9c12 ≠ wne, Br9c12 ≠ nes
B-single: Br9c11 = ne
B-single: Br8c11 = sw
B-single: Br8c12 = n
whip[1]: Br9c11{ne .} ==> Pr9c11 ≠ ns, Pr10c12 ≠ ew
P-single: Pr10c12 = ns
P-single: Pr9c11 = ne
whip[1]: Pr10c12{ns .} ==> Br10c12 ≠ e, Br10c12 ≠ n, Br10c12 ≠ o, Br9c12 ≠ sw, Br9c12 ≠ esw, Br10c11 ≠ swn, Br10c11 ≠ wne, Br10c11 ≠ nes, Br10c12 ≠ s, Br10c12 ≠ ne, Br10c12 ≠ ns, Br10c12 ≠ nw, Br10c12 ≠ se, Br10c12 ≠ swn, Br10c12 ≠ wne, Br10c12 ≠ nes
B-single: Br10c11 = esw
whip[1]: Br10c11{esw .} ==> Pr11c12 ≠ sw, Pr11c12 ≠ ew, Pr11c12 ≠ se, Pr11c12 ≠ ns, Pr11c12 ≠ ne, Pr11c12 ≠ o, Pr11c11 ≠ ns
P-single: Pr11c11 = ne
P-single: Pr11c12 = nw
w[1]-1-in-r11c11-asymmetric-ne-corner ==> Pr12c11 ≠ ew
P-single: Pr12c11 = sw
whip[1]: Pr11c11{ne .} ==> Br10c10 ≠ nes, Br11c10 ≠ ns, Br11c10 ≠ se, Br11c10 ≠ nes, Br11c11 ≠ e, Br11c11 ≠ s, Br11c11 ≠ w
B-single: Br11c11 = n
B-single: Br11c10 = s
B-single: Br10c10 = wne
whip[1]: Br11c11{n .} ==> Pr12c12 ≠ nw
P-single: Pr12c12 = se
whip[1]: Pr12c12{se .} ==> Br12c12 ≠ s, Br11c12 ≠ w, Br11c12 ≠ e, Br11c12 ≠ n, Br11c12 ≠ o, Br11c12 ≠ ne, Br11c12 ≠ nw, Br11c12 ≠ ew, Br11c12 ≠ sw, Br11c12 ≠ esw, Br11c12 ≠ swn, Br11c12 ≠ wne, Br12c11 ≠ ns, Br12c12 ≠ ns, Br12c12 ≠ se, Br12c12 ≠ sw, Br12c12 ≠ esw, Br12c12 ≠ nes
B-single: Br12c12 = swn
B-single: Br12c11 = ew
whip[1]: Br12c12{swn .} ==> Nr12c12 ≠ 2, Nr12c12 ≠ 1, Pr13c13 ≠ nw, Pr13c12 ≠ ew, Pr12c13 ≠ sw, Pr12c13 ≠ se, Pr12c13 ≠ ns, Pr12c13 ≠ ne, Pr12c13 ≠ o, Vr12c13 ≠ 1
V-single: Vr12c13 = 0
N-single: Nr12c12 = 3
P-single: Pr13c12 = ne
P-single: Pr13c13 = ew
no-vertical-line-r12{c12 c13} ==> Ir12c13 = out
different-colours-in-{r12 r13}c13 ==> Hr13c13 = 1
whip[1]: Vr12c13{0 .} ==> Br12c13 ≠ nw, Br12c13 ≠ ew
whip[1]: Br12c13{se .} ==> Pr13c14 ≠ ne
whip[1]: Pr12c15{ew .} ==> Br11c15 ≠ sw, Br11c15 ≠ esw, Br11c15 ≠ swn, Br12c14 ≠ sw, Br11c15 ≠ o, Br11c15 ≠ n, Br11c15 ≠ e, Br11c15 ≠ ne, Br12c14 ≠ ne
whip[1]: Br11c15{nes .} ==> Nr11c15 ≠ 0
whip[1]: Pr13c14{ew .} ==> Br13c13 ≠ s
B-single: Br13c13 = ns
whip[1]: Br13c13{ns .} ==> Nr13c13 ≠ 1
N-single: Nr13c13 = 2
whip[1]: Pr13c12{ne .} ==> Hr13c11 ≠ 1
whip[1]: Pr12c13{ew .} ==> Br11c13 ≠ sw, Br11c13 ≠ esw, Br11c13 ≠ swn, Br11c13 ≠ o, Br11c13 ≠ n, Br11c13 ≠ e, Br11c13 ≠ ne
whip[1]: Br11c13{nes .} ==> Nr11c13 ≠ 0
whip[1]: Br12c11{ew .} ==> Pr13c11 ≠ ew
P-single: Pr13c11 = nw
whip[1]: Pr13c11{nw .} ==> Br12c10 ≠ ns
B-single: Br12c10 = nes
whip[1]: Br12c10{nes .} ==> Nr12c10 ≠ 2, Nr12c10 ≠ 1, Pr13c10 ≠ ne
N-single: Nr12c10 = 3
whip[1]: Pr13c10{ew .} ==> Br12c9 ≠ wne, Br12c9 ≠ ne, Br13c9 ≠ s
whip[1]: Br13c9{ew .} ==> Nr13c9 ≠ 1
N-single: Nr13c9 = 2
whip[1]: Br12c9{nw .} ==> Nr12c9 ≠ 3
whip[1]: Br11c12{nes .} ==> Nr11c12 ≠ 0
whip[1]: Br11c10{s .} ==> Nr11c10 ≠ 3, Nr11c10 ≠ 2, Nr11c10 ≠ 0, Pr11c10 ≠ ew
N-single: Nr11c10 = 1
P-single: Pr11c10 = nw
whip[1]: Pr11c10{nw .} ==> Br10c9 ≠ sw, Br10c9 ≠ swn
B-single: Br10c9 = esw
whip[1]: Br10c9{esw .} ==> Nr10c9 ≠ 2, Nr10c9 ≠ 1, Nr10c9 ≠ 0, Pr10c10 ≠ ew, Pr10c10 ≠ ne, Pr10c9 ≠ se, Pr10c9 ≠ ne, Pr10c9 ≠ o
N-single: Nr10c9 = 3
P-single: Pr10c9 = ns
P-single: Pr10c10 = se
w[1]-1-in-r9c8-asymmetric-se-corner ==> Pr9c8 ≠ ew
P-single: Pr9c8 = nw
whip[1]: Pr10c9{ns .} ==> Br9c9 ≠ e, Br9c8 ≠ n, Br9c9 ≠ se, Br9c9 ≠ swn
B-single: Br9c9 = nw
B-single: Br9c8 = e
whip[1]: Br9c9{nw .} ==> Nr9c9 ≠ 3, Nr9c9 ≠ 1, Pr9c10 ≠ ns
N-single: Nr9c9 = 2
P-single: Pr7c8 = nw
P-single: Pr8c9 = nw
P-single: Pr9c10 = nw
whip[1]: Pr7c8{nw .} ==> Br6c7 ≠ e, Br6c7 ≠ ew, Br7c7 ≠ se, Br7c8 ≠ ew
B-single: Br7c8 = se
B-single: Br7c7 = nw
B-single: Br6c7 = se
whip[1]: Br7c7{nw .} ==> Pr8c7 ≠ ew, Pr8c7 ≠ se
whip[1]: Pr8c7{nw .} ==> Br7c6 ≠ w, Br7c6 ≠ ns, Br7c6 ≠ nw, Br8c7 ≠ ns, Br8c7 ≠ swn, Br7c6 ≠ s
whip[1]: Br7c6{ew .} ==> Pr7c6 ≠ se, Pr7c6 ≠ ew, Nr7c6 ≠ 1
N-single: Nr7c6 = 2
whip[1]: Pr7c6{nw .} ==> Br6c5 ≠ w, Br6c6 ≠ se, Br6c5 ≠ o, Br6c5 ≠ s
B-single: Br6c6 = nw
whip[1]: Br6c6{nw .} ==> Pr6c7 ≠ ns
P-single: Pr6c7 = nw
whip[1]: Pr6c7{nw .} ==> Br5c6 ≠ ne
B-single: Br5c6 = nes
whip[1]: Br5c6{nes .} ==> Nr5c6 ≠ 2
N-single: Nr5c6 = 3
whip[1]: Br6c5{ew .} ==> Nr6c5 ≠ 0
whip[1]: Br6c7{se .} ==> Nr6c7 ≠ 1
N-single: Nr6c7 = 2
whip[1]: Pr8c9{nw .} ==> Br8c8 ≠ se, Br8c9 ≠ ew
B-single: Br8c9 = se
B-single: Br8c8 = nw
whip[1]: Pr9c10{nw .} ==> Br9c10 ≠ w, Br9c10 ≠ ew, Br9c10 ≠ sw, Br9c10 ≠ esw
whip[1]: Br9c10{se .} ==> Nr9c10 ≠ 3
whip[1]: Pr10c10{se .} ==> Br9c10 ≠ e, Br9c10 ≠ o
whip[1]: Br9c10{se .} ==> Nr9c10 ≠ 0
whip[1]: Pr11c12{nw .} ==> Br10c12 ≠ sw, Br10c12 ≠ esw, Br11c12 ≠ ns, Br11c12 ≠ nes
whip[1]: Br11c12{se .} ==> Pr11c13 ≠ nw, Pr11c13 ≠ ew, Pr11c13 ≠ sw, Nr11c12 ≠ 3
whip[1]: Br10c12{ew .} ==> Pr10c13 ≠ nw, Pr10c13 ≠ ew, Pr10c13 ≠ sw, Nr10c12 ≠ 0, Nr10c12 ≠ 3
whip[1]: Br9c12{ew .} ==> Pr9c13 ≠ ew, Pr9c13 ≠ sw, Nr9c12 ≠ 3
whip[1]: Pr9c13{se .} ==> Br9c13 ≠ ne, Br9c13 ≠ ns, Br9c13 ≠ ew, Br9c13 ≠ sw, Br9c13 ≠ esw, Br9c13 ≠ nes, Br9c13 ≠ n, Br9c13 ≠ w
whip[1]: Pr9c11{ne .} ==> Br9c10 ≠ se
B-single: Br9c10 = s
whip[1]: Br9c10{s .} ==> Nr9c10 ≠ 2
N-single: Nr9c10 = 1
whip[1]: Br8c11{sw .} ==> Nr8c11 ≠ 1
N-single: Nr8c11 = 2
whip[1]: Br8c12{n .} ==> Nr8c12 ≠ 2
N-single: Nr8c12 = 1
whip[1]: Br10c8{ew .} ==> Nr10c8 ≠ 1
N-single: Nr10c8 = 2
whip[1]: Vr12c9{0 .} ==> Pr12c9 ≠ se, Br12c8 ≠ esw, Br12c9 ≠ nw
P-single: Pr12c9 = ew
B-single: Br12c8 = swn
w[1]-1-in-r11c8-asymmetric-se-corner ==> Pr11c8 ≠ ns
P-single: Pr11c8 = nw
whip[1]: Pr12c9{ew .} ==> Br11c8 ≠ w
B-single: Br11c8 = s
whip[1]: Br11c8{s .} ==> Pr12c8 ≠ ns
P-single: Pr11c7 = se
P-single: Pr12c8 = se
w[1]-1-in-r10c6-symmetric-se-corner ==> Pr10c6 ≠ o
whip[1]: Pr11c7{se .} ==> Br10c6 ≠ e, Br10c7 ≠ wne, Br11c7 ≠ ew
B-single: Br11c7 = nw
B-single: Br10c7 = nes
whip[1]: Pr10c6{sw .} ==> Hr10c5 ≠ 0, Br10c5 ≠ sw, Br9c5 ≠ w, Br10c5 ≠ s
H-single: Hr10c5 = 1
B-single: Br9c5 = sw
no-horizontal-line-{r9 r10}c4 ==> Ir10c4 = in
no-vertical-line-r10{c4 c5} ==> Ir10c5 = in
same-colour-in-{r10 r11}c5 ==> Hr11c5 = 0
P-single: Pr11c6 = ns
w[1]-1-in-r10c6-asymmetric-sw-corner ==> Pr10c7 ≠ ew
P-single: Pr10c7 = ne
different-colours-in-r10{c5 c6} ==> Hr10c6 = 1
whip[1]: Hr10c5{1 .} ==> Pr10c5 ≠ ns, Pr10c5 ≠ nw
P-single: Pr10c5 = ne
whip[1]: Pr10c5{ne .} ==> Br9c4 ≠ nes, Br10c4 ≠ e, Br10c4 ≠ ns, Br10c4 ≠ ew, Br10c4 ≠ swn
B-single: Br9c4 = ne
whip[1]: Br9c4{ne .} ==> Nr9c4 ≠ 3, Pr10c4 ≠ se, Pr10c4 ≠ ew
N-single: Nr9c4 = 2
whip[1]: Pr10c4{sw .} ==> Br10c3 ≠ nw, Br10c3 ≠ se, Br10c3 ≠ ew, Br10c3 ≠ esw, Br10c3 ≠ swn, Br10c3 ≠ n, Br10c3 ≠ e, Br10c3 ≠ ns
whip[1]: Br10c4{sw .} ==> Hr11c4 ≠ 0, Pr11c4 ≠ o, Pr11c4 ≠ ns, Pr11c4 ≠ nw, Pr11c4 ≠ sw, Pr11c5 ≠ ne, Nr10c4 ≠ 3
H-single: Hr11c4 = 1
horizontal-line-{r10 r11}c4 ==> Ir11c4 = out
different-colours-in-r11{c4 c5} ==> Hr11c5 = 1
different-colours-in-{r11 r12}c4 ==> Hr12c4 = 1
whip[1]: Hr11c4{1 .} ==> Br11c4 ≠ o, Br11c4 ≠ s, Br11c4 ≠ w, Br11c4 ≠ sw
whip[1]: Br11c4{nes .} ==> Nr11c4 ≠ 0
whip[1]: Vr11c5{1 .} ==> Pr11c5 ≠ ew, Br11c4 ≠ n, Br11c4 ≠ ns, Br11c4 ≠ nw, Br11c4 ≠ swn, Br11c5 ≠ ne
P-single: Pr11c5 = sw
B-single: Br11c5 = ew
whip[1]: Pr11c5{sw .} ==> Br10c5 ≠ ns
B-single: Br10c5 = ne
whip[1]: Br10c5{ne .} ==> Nr10c5 ≠ 1, Pr10c6 ≠ ew
N-single: Nr10c5 = 2
P-single: Pr10c6 = sw
whip[1]: Pr10c6{sw .} ==> Br10c6 ≠ n, Br9c6 ≠ s
B-single: Br10c6 = w
whip[1]: Br11c4{nes .} ==> Pr12c4 ≠ ne, Nr11c4 ≠ 1
whip[1]: Hr12c4{1 .} ==> Pr12c4 ≠ o, Pr12c4 ≠ ns, Pr12c4 ≠ nw, Pr12c4 ≠ sw, Pr12c5 ≠ ns, Br11c4 ≠ ne, Br11c4 ≠ wne, Br12c4 ≠ e, Br12c4 ≠ s, Br12c4 ≠ ew, Br12c4 ≠ sw
P-single: Pr12c5 = nw
B-single: Br11c4 = nes
w[1]-1-in-r12c3-asymmetric-ne-corner ==> Pr13c3 ≠ ew, Pr13c3 ≠ ns
whip[1]: Pr12c5{nw .} ==> Vr12c5 ≠ 1, Br12c4 ≠ ne, Br12c4 ≠ wne
whip[1]: Br12c4{swn .} ==> Pr13c4 ≠ o, Pr13c4 ≠ nw, Pr13c5 ≠ ns, Nr12c4 ≠ 1
P-single: Pr15c6 = ns
P-single: Pr14c5 = ns
P-single: Pr14c4 = o
P-single: Pr13c5 = sw
w[1]-1-in-r12c3-asymmetric-se-corner ==> Pr12c3 ≠ sw, Pr12c3 ≠ ew, Pr12c3 ≠ ns, Pr12c3 ≠ ne
w[1]-3-in-r11c2-symmetric-se-corner ==> Vr11c3 = 1, Hr12c2 = 1
w[1]-3-in-r11c2-closed-se-corner ==> Pr11c2 ≠ se, Pr11c2 ≠ nw, Pr11c2 ≠ o
whip[1]: Pr15c6{ns .} ==> Br15c6 ≠ e, Vr15c6 ≠ 0, Hr15c5 ≠ 1, Br14c5 ≠ se, Br15c5 ≠ nw
H-single: Hr15c5 = 0
V-single: Vr15c6 = 1
w[1]-diagonal-3-2-in-{r13c6...r14c5}-non-closed-sw-corner ==> Vr14c5 = 1
P-single: Pr16c6 = nw
P-single: Pr15c5 = nw
B-single: Br15c5 = se
B-single: Br14c5 = ew
B-single: Br15c6 = ew
vertical-line-r14{c4 c5} ==> Ir14c4 = out
vertical-line-r15{c5 c6} ==> Ir15c5 = in
different-colours-in-{r15 r16}c5 ==> Hr16c5 = 1
same-colour-in-r15{c4 c5} ==> Vr15c5 = 0
different-colours-in-{r14 r15}c4 ==> Hr15c4 = 1
same-colour-in-r14{c3 c4} ==> Vr14c4 = 0
same-colour-in-{r13 r14}c4 ==> Hr14c4 = 0
whip[1]: Vr14c5{1 .} ==> Br14c4 ≠ nw
B-single: Br14c4 = se
whip[1]: Br14c4{se .} ==> Pr15c4 ≠ nw, Pr15c4 ≠ ns
whip[1]: Pr15c4{ew .} ==> Br14c3 ≠ se, Br14c3 ≠ ew, Br14c3 ≠ esw, Br15c3 ≠ sw, Br15c3 ≠ wne, Br15c4 ≠ se, Br15c4 ≠ esw, Br14c3 ≠ e, Br15c3 ≠ s, Br15c3 ≠ ne
whip[1]: Br14c3{sw .} ==> Nr14c3 ≠ 3
whip[1]: Br15c4{swn .} ==> Pr16c5 ≠ nw
P-single: Pr16c5 = ew
whip[1]: Pr16c5{ew .} ==> Br16c5 ≠ o
B-single: Br16c5 = n
whip[1]: Br15c6{ew .} ==> Nr15c6 ≠ 1
N-single: Nr15c6 = 2
whip[1]: Hr14c4{0 .} ==> Br13c4 ≠ se
B-single: Br13c4 = ne
whip[1]: Vr11c3{1 .} ==> Br11c3 ≠ o, Pr11c3 ≠ o, Pr11c3 ≠ ne, Pr11c3 ≠ nw, Pr11c3 ≠ ew, Pr12c3 ≠ o, Pr12c3 ≠ se, Br11c2 ≠ swn, Br11c3 ≠ n, Br11c3 ≠ e, Br11c3 ≠ s, Br11c3 ≠ ne, Br11c3 ≠ ns, Br11c3 ≠ se, Br11c3 ≠ nes
P-single: Pr12c3 = nw
whip[1]: Pr12c3{nw .} ==> Br12c3 ≠ n, Br12c2 ≠ s, Br12c2 ≠ e, Br11c2 ≠ wne, Br11c3 ≠ sw, Br11c3 ≠ esw, Br11c3 ≠ swn, Br12c2 ≠ ne, Br12c2 ≠ ew, Br12c2 ≠ sw, Br12c2 ≠ wne, Br12c3 ≠ w
whip[1]: Br12c3{s .} ==> Pr13c3 ≠ ne, Pr12c4 ≠ ew
P-single: Pr12c4 = se
P-single: Pr13c3 = sw
whip[1]: Pr12c4{se .} ==> Br12c3 ≠ s, Vr12c4 ≠ 0, Vr11c4 ≠ 1, Br11c3 ≠ ew, Br11c3 ≠ wne, Br12c4 ≠ ns
V-single: Vr11c4 = 0
V-single: Vr12c4 = 1
w[1]-diagonal-1-1-in-{r13c3...r14c2}-with-no-ne-outer-sides ==> Hr15c2 = 0, Vr14c2 = 0
P-single: Pr15c1 = ne
B-single: Br12c4 = swn
B-single: Br12c3 = e
no-horizontal-line-{r12 r13}c3 ==> Ir12c3 = out
no-vertical-line-r12{c2 c3} ==> Ir12c2 = out
horizontal-line-{r11 r12}c2 ==> Ir11c2 = in
vertical-line-r11{c2 c3} ==> Ir11c3 = out
whip[1]: Vr11c4{0 .} ==> Pr11c4 ≠ se
whip[1]: Pr11c4{ew .} ==> Br10c3 ≠ nes, Br10c3 ≠ o, Br10c3 ≠ w
whip[1]: Br10c3{wne .} ==> Nr10c3 ≠ 0
whip[1]: Vr12c4{1 .} ==> Pr13c4 ≠ ew
P-single: Pr13c4 = ne
w[1]-1-in-r13c3-symmetric-ne-corner ==> Pr14c3 ≠ sw
P-single: Pr14c3 = ns
w[1]-1-in-r14c2-asymmetric-ne-corner ==> Pr15c2 ≠ ew, Pr15c2 ≠ ns
whip[1]: Pr13c4{ne .} ==> Br13c3 ≠ n
B-single: Br13c3 = w
whip[1]: Br13c3{w .} ==> Vr13c3 ≠ 0
V-single: Vr13c3 = 1
vertical-line-r13{c2 c3} ==> Ir13c2 = in
different-colours-in-{r12 r13}c2 ==> Hr13c2 = 1
whip[1]: Vr13c3{1 .} ==> Br13c2 ≠ ns, Br13c2 ≠ nw, Br13c2 ≠ sw
whip[1]: Br13c2{ew .} ==> Pr14c2 ≠ ne
P-single: Pr14c1 = ns
P-single: Pr14c2 = o
w[1]-1-in-r14c2-symmetric-nw-corner ==> Pr15c3 ≠ se, Pr15c3 ≠ nw, Pr15c3 ≠ o
whip[1]: Pr14c1{ns .} ==> Vr14c1 ≠ 0, Vr13c1 ≠ 0, Hr14c1 ≠ 1, Br13c1 ≠ ne, Br13c1 ≠ ns, Br13c1 ≠ se, Br13c1 ≠ sw, Br14c1 ≠ ne, Br14c1 ≠ ns, Br14c1 ≠ nw, Br14c1 ≠ se
H-single: Hr14c1 = 0
V-single: Vr13c1 = 1
V-single: Vr14c1 = 1
w[1]-2-in-r14c1-open-ne-corner ==> Hr15c1 = 1, Vr15c1 = 0
w[1]-3-in-r11c2-asymmetric-sw-corner ==> Hr11c2 = 1, Vr10c3 = 0, Hr11c3 = 0
P-single: Pr13c1 = se
no-horizontal-line-{r10 r11}c3 ==> Ir10c3 = out
no-vertical-line-r10{c2 c3} ==> Ir10c2 = out
no-vertical-line-r15{c0 c1} ==> Ir15c1 = out
horizontal-line-{r14 r15}c1 ==> Ir14c1 = in
no-vertical-line-r14{c1 c2} ==> Ir14c2 = in
no-horizontal-line-{r14 r15}c2 ==> Ir15c2 = in
no-horizontal-line-{r13 r14}c1 ==> Ir13c1 = in
same-colour-in-r13{c1 c2} ==> Vr13c2 = 0
w[1]-2-in-r13c1-open-se-corner ==> Hr13c1 = 1, Vr12c1 = 0
no-vertical-line-r12{c0 c1} ==> Ir12c1 = out
same-colour-in-r12{c1 c2} ==> Vr12c2 = 0
different-colours-in-{r15 r16}c2 ==> Hr16c2 = 1
different-colours-in-r15{c1 c2} ==> Hr15c2 = 1
different-colours-in-r14{c2 c3} ==> Hr14c3 = 1

LOOP[10]: Vr14c3-Vr13c3-Hr13c2-Hr13c1-Vr13c1-Vr14c1-Hr15c1-Vr15c2-Hr16c2- ==> Vr15c3 = 0
no-vertical-line-r15{c2 c3} ==> Ir15c3 = in
same-colour-in-r15{c3 c4} ==> Vr15c4 = 0
different-colours-in-{r15 r16}c3 ==> Hr16c3 = 1
different-colours-in-{r14 r15}c3 ==> Hr15c3 = 1
same-colour-in-{r13 r14}c2 ==> Hr14c2 = 0
different-colours-in-r10{c3 c4} ==> Hr10c4 = 1
different-colours-in-{r9 r10}c3 ==> Hr10c3 = 1
whip[1]: Vr13c1{1 .} ==> Br13c0 ≠ o
B-single: Br13c0 = e
whip[1]: Vr14c1{1 .} ==> Br14c0 ≠ o
B-single: Br14c0 = e
whip[1]: Hr15c1{1 .} ==> Br15c1 ≠ o, Pr15c2 ≠ ne, Br14c1 ≠ ew, Br15c1 ≠ e, Br15c1 ≠ sw, Br15c1 ≠ esw
P-single: Pr15c2 = sw
B-single: Br14c1 = sw
whip[1]: Pr15c2{sw .} ==> Br15c2 ≠ ns, Br15c2 ≠ ne, Br15c2 ≠ s, Br15c2 ≠ e, Br15c2 ≠ n, Br15c2 ≠ o, Br15c1 ≠ n, Br14c2 ≠ w, Br14c2 ≠ s, Br15c1 ≠ swn, Br15c2 ≠ nw, Br15c2 ≠ se, Br15c2 ≠ swn, Br15c2 ≠ wne, Br15c2 ≠ nes
B-single: Br15c1 = ne
whip[1]: Br15c1{ne .} ==> Nr15c1 ≠ 3, Nr15c1 ≠ 1, Nr15c1 ≠ 0, Pr16c2 ≠ nw, Pr16c2 ≠ o, Pr16c1 ≠ ne, Pr16c2 ≠ ew
N-single: Nr15c1 = 2
P-single: Pr16c2 = ne
P-single: Pr16c1 = o
whip[1]: Pr16c2{ne .} ==> Br16c2 ≠ o, Br16c1 ≠ n, Br15c2 ≠ w, Br15c2 ≠ ew
B-single: Br16c1 = o
B-single: Br16c2 = n
whip[1]: Br16c2{n .} ==> Pr16c3 ≠ o, Pr16c3 ≠ ne
whip[1]: Pr16c3{ew .} ==> Br15c3 ≠ swn, Br15c3 ≠ e
whip[1]: Br15c3{ew .} ==> Nr15c3 ≠ 1, Nr15c3 ≠ 3
N-single: Nr15c3 = 2
whip[1]: Br15c2{esw .} ==> Pr15c3 ≠ ew, Pr15c3 ≠ sw, Nr15c2 ≠ 0, Nr15c2 ≠ 1
whip[1]: Pr15c3{ns .} ==> Br14c3 ≠ s, Br14c2 ≠ n, Br14c3 ≠ o
B-single: Br14c2 = e
whip[1]: Br14c3{sw .} ==> Nr14c3 ≠ 0
whip[1]: Vr15c1{0 .} ==> Br15c0 ≠ e
B-single: Br15c0 = o
whip[1]: Hr11c2{1 .} ==> Pr11c2 ≠ ns, Pr11c3 ≠ ns, Pr11c3 ≠ se, Br10c2 ≠ ne, Br10c2 ≠ nw, Br10c2 ≠ ew, Br11c2 ≠ esw
P-single: Pr11c3 = sw
B-single: Br11c2 = nes
whip[1]: Pr11c3{sw .} ==> Br10c3 ≠ s, Br10c2 ≠ se, Br10c3 ≠ sw, Br10c3 ≠ wne, Br11c3 ≠ nw
B-single: Br11c3 = w
B-single: Br10c3 = ne
whip[1]: Br11c3{w .} ==> Nr11c3 ≠ 3, Nr11c3 ≠ 2, Nr11c3 ≠ 0, Pr11c4 ≠ ew
N-single: Nr11c3 = 1
P-single: Pr11c4 = ne
whip[1]: Pr11c4{ne .} ==> Br10c4 ≠ s
B-single: Br10c4 = sw
whip[1]: Br10c4{sw .} ==> Nr10c4 ≠ 1, Pr10c4 ≠ o
N-single: Nr10c4 = 2
P-single: Pr10c4 = sw
whip[1]: Pr10c4{sw .} ==> Br9c3 ≠ w, Br9c3 ≠ o
whip[1]: Br9c3{sw .} ==> Pr10c3 ≠ o, Pr10c3 ≠ ns, Pr10c3 ≠ nw, Nr9c3 ≠ 0
whip[1]: Pr10c3{ew .} ==> Br9c2 ≠ se, Br9c2 ≠ esw, Br9c2 ≠ nes
whip[1]: Br10c3{ne .} ==> Nr10c3 ≠ 3, Nr10c3 ≠ 1, Pr10c3 ≠ se
N-single: Nr10c3 = 2
whip[1]: Pr10c3{ew .} ==> Br9c2 ≠ nw, Br9c2 ≠ o, Br9c2 ≠ n, Br9c2 ≠ w
whip[1]: Br9c2{wne .} ==> Nr9c2 ≠ 0
whip[1]: Br11c2{nes .} ==> Pr12c2 ≠ nw, Pr12c2 ≠ ns, Vr11c2 ≠ 1
V-single: Vr11c2 = 0
no-vertical-line-r11{c1 c2} ==> Ir11c1 = in
different-colours-in-{r11 r12}c1 ==> Hr12c1 = 1
different-colours-in-r11{c0 c1} ==> Hr11c1 = 1

LOOP[6]: Vr11c1-Hr12c1-Hr12c2-Vr11c3-Hr11c2- ==> Hr11c1 = 0
no-horizontal-line-{r10 r11}c1 ==> Ir10c1 = in
different-colours-in-r10{c1 c2} ==> Hr10c2 = 1
different-colours-in-r10{c0 c1} ==> Hr10c1 = 1

LOOP[8]: Vr10c1-Vr11c1-Hr12c1-Hr12c2-Vr11c3-Hr11c2-Vr10c2- ==> Hr10c1 = 0
no-horizontal-line-{r9 r10}c1 ==> Ir9c1 = in
different-colours-in-r9{c0 c1} ==> Hr9c1 = 1
whip[1]: Vr11c2{0 .} ==> Br11c1 ≠ e, Br11c1 ≠ ne, Br11c1 ≠ se, Br11c1 ≠ ew, Br11c1 ≠ esw, Br11c1 ≠ wne, Br11c1 ≠ nes
whip[1]: Hr12c1{1 .} ==> Br11c1 ≠ o, Pr12c1 ≠ ns, Pr12c2 ≠ se, Br11c1 ≠ n, Br11c1 ≠ w, Br11c1 ≠ nw, Br12c1 ≠ se, Br12c1 ≠ ew, Br12c1 ≠ sw
P-single: Pr12c2 = ew
P-single: Pr12c1 = ne
whip[1]: Pr12c2{ew .} ==> Br12c1 ≠ ne, Br12c2 ≠ swn
B-single: Br12c2 = ns
whip[1]: Br12c2{ns .} ==> Nr12c2 ≠ 3, Nr12c2 ≠ 1, Pr13c2 ≠ ns
N-single: Nr12c2 = 2
P-single: Pr13c2 = ew
whip[1]: Pr13c2{ew .} ==> Br12c1 ≠ nw, Br13c1 ≠ ew, Br13c2 ≠ se, Br13c2 ≠ ew
B-single: Br13c2 = ne
B-single: Br13c1 = nw
B-single: Br12c1 = ns
whip[1]: Pr12c1{ne .} ==> Br11c1 ≠ s, Br11c1 ≠ ns
whip[1]: Br11c1{swn .} ==> Pr11c1 ≠ o, Pr11c1 ≠ ne, Nr11c1 ≠ 0, Nr11c1 ≠ 1
whip[1]: Pr11c1{se .} ==> Br10c1 ≠ ne, Br10c1 ≠ sw, Br10c1 ≠ esw, Br10c1 ≠ swn, Br10c1 ≠ o, Br10c1 ≠ n, Br10c1 ≠ e
whip[1]: Br10c1{nes .} ==> Nr10c1 ≠ 0
whip[1]: Vr11c1{1 .} ==> Br11c0 ≠ o
B-single: Br11c0 = e
whip[1]: Hr11c1{0 .} ==> Pr11c1 ≠ se, Pr11c2 ≠ ew, Br10c1 ≠ s, Br10c1 ≠ ns, Br10c1 ≠ se, Br10c1 ≠ nes, Br11c1 ≠ swn
P-single: Pr10c3 = ne
P-single: Pr11c2 = ne
P-single: Pr11c1 = ns
B-single: Br11c1 = sw
whip[1]: Pr10c3{ne .} ==> Vr9c3 ≠ 0, Hr10c2 ≠ 1, Br9c2 ≠ s, Br9c2 ≠ ns, Br9c2 ≠ sw, Br9c2 ≠ swn, Br9c3 ≠ s, Br10c2 ≠ ns
H-single: Hr10c2 = 0
V-single: Vr9c3 = 1
B-single: Br10c2 = sw
B-single: Br9c3 = sw
vertical-line-r9{c2 c3} ==> Ir9c2 = out
different-colours-in-r9{c1 c2} ==> Hr9c2 = 1

LOOP[10]: Vr9c2-Vr10c2-Hr11c2-Vr11c3-Hr12c2-Hr12c1-Vr11c1-Vr10c1-Vr9c1- ==> Hr9c1 = 0
no-horizontal-line-{r8 r9}c1 ==> Ir8c1 = in
different-colours-in-r8{c0 c1} ==> Hr8c1 = 1
different-colours-in-{r7 r8}c1 ==> Hr8c1 = 1

LOOP[12]: Hr8c1-Vr8c1-Vr9c1-Vr10c1-Vr11c1-Hr12c1-Hr12c2-Vr11c3-Hr11c2-Vr10c2-Vr9c2- ==> Vr8c2 = 0
no-vertical-line-r8{c1 c2} ==> Ir8c2 = in
same-colour-in-r8{c2 c3} ==> Vr8c3 = 0
w[1]-2-in-r8c3-open-sw-corner ==> Hr8c3 = 1, Vr7c4 = 0
no-vertical-line-r7{c3 c4} ==> Ir7c3 = out
different-colours-in-{r8 r9}c2 ==> Hr9c2 = 1
whip[1]: Hr10c2{0 .} ==> Pr10c2 ≠ ne, Pr10c2 ≠ ew
whip[1]: Pr10c2{sw .} ==> Br9c1 ≠ nw, Br9c1 ≠ se, Br9c1 ≠ esw, Br9c1 ≠ nes, Br10c1 ≠ nw, Br9c1 ≠ o, Br9c1 ≠ n, Br9c1 ≠ w, Br10c1 ≠ w
whip[1]: Br10c1{wne .} ==> Pr10c1 ≠ o, Pr10c1 ≠ ne, Nr10c1 ≠ 1
whip[1]: Pr10c1{se .} ==> Br9c1 ≠ ne, Br9c1 ≠ sw, Br9c1 ≠ swn, Br9c1 ≠ e
whip[1]: Br9c1{wne .} ==> Nr9c1 ≠ 0
whip[1]: Vr9c3{1 .} ==> Pr9c3 ≠ o, Pr9c3 ≠ nw
whip[1]: Pr9c3{sw .} ==> Br8c2 ≠ nw, Br8c2 ≠ se, Br8c2 ≠ esw, Br8c2 ≠ nes, Br8c2 ≠ o, Br8c2 ≠ n, Br8c2 ≠ w
whip[1]: Br8c2{wne .} ==> Nr8c2 ≠ 0
whip[1]: Br9c3{sw .} ==> Nr9c3 ≠ 1
N-single: Nr9c3 = 2
whip[1]: Vr9c2{1 .} ==> Pr9c2 ≠ o, Pr9c2 ≠ ne, Pr9c2 ≠ nw, Pr9c2 ≠ ew, Pr10c2 ≠ sw, Br9c1 ≠ s, Br9c1 ≠ ns, Br9c2 ≠ e, Br9c2 ≠ ne
P-single: Pr10c2 = ns
whip[1]: Pr10c2{ns .} ==> Br10c1 ≠ wne
B-single: Br10c1 = ew
whip[1]: Br10c1{ew .} ==> Nr10c1 ≠ 3, Pr10c1 ≠ se
N-single: Nr10c1 = 2
P-single: Pr10c1 = ns
whip[1]: Br9c2{wne .} ==> Nr9c2 ≠ 1
whip[1]: Br9c1{wne .} ==> Pr9c1 ≠ o, Pr9c1 ≠ ne, Nr9c1 ≠ 1
whip[1]: Pr9c1{se .} ==> Br8c1 ≠ swn, Br8c1 ≠ o, Br8c1 ≠ e
whip[1]: Br8c1{wne .} ==> Nr8c1 ≠ 0
whip[1]: Pr9c2{sw .} ==> Br8c1 ≠ se, Br8c2 ≠ sw, Br8c2 ≠ swn
whip[1]: Br8c1{wne .} ==> Pr8c2 ≠ ns, Pr8c2 ≠ se
whip[1]: Pr8c2{sw .} ==> Br8c2 ≠ wne
whip[1]: Br8c2{ew .} ==> Nr8c2 ≠ 3
whip[1]: Hr9c1{0 .} ==> Pr9c1 ≠ se, Pr9c2 ≠ sw, Br8c1 ≠ s, Br9c1 ≠ wne
P-single: Pr9c1 = ns
B-single: Br9c1 = ew
whip[1]: Br9c1{ew .} ==> Nr9c1 ≠ 3
N-single: Nr9c1 = 2
whip[1]: Br8c1{wne .} ==> Pr8c1 ≠ o, Pr8c2 ≠ o, Pr8c2 ≠ ne, Nr8c1 ≠ 1
P-single: Pr8c1 = se
whip[1]: Pr8c1{se .} ==> Br7c1 ≠ n, Br7c1 ≠ ne
whip[1]: Br7c1{nes .} ==> Nr7c1 ≠ 1
whip[1]: Pr8c2{sw .} ==> Br7c2 ≠ sw
whip[1]: Br7c2{ew .} ==> Pr7c3 ≠ ne
whip[1]: Pr7c3{sw .} ==> Br6c3 ≠ sw, Br6c3 ≠ esw, Br6c3 ≠ swn
whip[1]: Pr9c2{se .} ==> Br8c2 ≠ ne, Br8c2 ≠ e
whip[1]: Vr8c1{1 .} ==> Br8c0 ≠ o
B-single: Br8c0 = e
whip[1]: Vr8c2{0 .} ==> Pr8c2 ≠ sw, Pr9c2 ≠ ns, Br8c1 ≠ wne, Br8c2 ≠ ew
P-single: Pr9c2 = se
B-single: Br8c1 = nw
whip[1]: Pr9c2{se .} ==> Br9c2 ≠ ew
B-single: Br9c2 = wne
whip[1]: Br9c2{wne .} ==> Nr9c2 ≠ 2, Pr9c3 ≠ ns
N-single: Nr9c2 = 3
P-single: Pr8c4 = sw
P-single: Pr9c3 = sw
whip[1]: Pr8c4{sw .} ==> Br7c3 ≠ ne, Br7c3 ≠ ew, Br7c4 ≠ ew, Br7c4 ≠ wne, Br8c3 ≠ ew
B-single: Br8c3 = ne
whip[1]: Br8c3{ne .} ==> Pr8c3 ≠ ns
whip[1]: Br7c4{ne .} ==> Pr7c4 ≠ ns, Pr7c4 ≠ se, Nr7c4 ≠ 3
whip[1]: Br8c1{nw .} ==> Nr8c1 ≠ 3
N-single: Nr8c1 = 2
whip[1]: Pr7c3{ew .} ==> Br6c3 ≠ o, Br6c3 ≠ n, Br6c3 ≠ e, Br6c3 ≠ ne, Br7c2 ≠ ne
whip[1]: Br6c3{nes .} ==> Nr6c3 ≠ 0
whip[1]: Br11c1{sw .} ==> Nr11c1 ≠ 3
N-single: Nr11c1 = 2
whip[1]: Vr10c1{1 .} ==> Br10c0 ≠ o
B-single: Br10c0 = e
whip[1]: Vr9c1{1 .} ==> Br9c0 ≠ o
B-single: Br9c0 = e
whip[1]: Vr12c1{0 .} ==> Br12c0 ≠ e
B-single: Br12c0 = o
whip[1]: Vr15c3{0 .} ==> Pr16c3 ≠ nw, Pr15c3 ≠ ns, Br15c2 ≠ esw, Br15c3 ≠ ew
P-single: Pr15c3 = ne
P-single: Pr16c3 = ew
B-single: Br15c3 = ns
B-single: Br15c2 = sw
whip[1]: Pr15c3{ne .} ==> Br14c3 ≠ w
B-single: Br14c3 = sw
whip[1]: Br14c3{sw .} ==> Nr14c3 ≠ 1, Pr15c4 ≠ se
N-single: Nr14c3 = 2
P-single: Pr15c4 = ew
whip[1]: Pr15c4{ew .} ==> Br15c4 ≠ swn
B-single: Br15c4 = ns
whip[1]: Br15c4{ns .} ==> Nr15c4 ≠ 3, Pr16c4 ≠ ne
N-single: Nr15c4 = 2
P-single: Pr16c4 = ew
whip[1]: Pr16c4{ew .} ==> Br16c3 ≠ o
B-single: Br16c3 = n
whip[1]: Br15c2{sw .} ==> Nr15c2 ≠ 3
N-single: Nr15c2 = 2
whip[1]: Br12c4{swn .} ==> Nr12c4 ≠ 2
N-single: Nr12c4 = 3
whip[1]: Br11c4{nes .} ==> Nr11c4 ≠ 2
N-single: Nr11c4 = 3
whip[1]: Br9c5{sw .} ==> Nr9c5 ≠ 1
N-single: Nr9c5 = 2
whip[1]: Pr10c7{ne .} ==> Br9c6 ≠ o, Br9c7 ≠ ns
B-single: Br9c7 = swn
B-single: Br9c6 = e
whip[1]: Br9c7{swn .} ==> Nr9c7 ≠ 2
N-single: Nr9c7 = 3
whip[1]: Br9c6{e .} ==> Nr9c6 ≠ 0
N-single: Nr9c6 = 1
whip[1]: Hr13c9{0 .} ==> Pr13c9 ≠ ew, Pr13c10 ≠ ew, Br12c9 ≠ ns, Br13c9 ≠ ns
P-single: Pr13c10 = se
P-single: Pr13c9 = sw
B-single: Br13c9 = ew
B-single: Br12c9 = n
whip[1]: Pr13c10{se .} ==> Br13c10 ≠ n
B-single: Br13c10 = nw
whip[1]: Br13c10{nw .} ==> Nr13c10 ≠ 1, Pr14c10 ≠ sw
N-single: Nr13c10 = 2
P-single: Pr14c10 = ns
whip[1]: Pr14c10{ns .} ==> Br14c9 ≠ nes
B-single: Br14c9 = se
whip[1]: Br14c9{se .} ==> Nr14c9 ≠ 3, Pr14c9 ≠ ew
N-single: Nr14c9 = 2
P-single: Pr14c9 = nw
whip[1]: Pr14c9{nw .} ==> Br13c8 ≠ ns
B-single: Br13c8 = nes
whip[1]: Br13c8{nes .} ==> Nr13c8 ≠ 2
N-single: Nr13c8 = 3
whip[1]: Br12c9{n .} ==> Nr12c9 ≠ 2
N-single: Nr12c9 = 1
whip[1]: Vr8c7{0 .} ==> Pr8c7 ≠ ns, Br8c6 ≠ e, Br8c7 ≠ esw
P-single: Pr7c6 = nw
P-single: Pr8c7 = nw
B-single: Br8c7 = se
B-single: Br8c6 = n
whip[1]: Pr7c6{nw .} ==> Br6c5 ≠ e, Br6c5 ≠ ew, Br7c5 ≠ esw, Br7c6 ≠ ew
B-single: Br7c6 = se
B-single: Br7c5 = swn
B-single: Br6c5 = se
whip[1]: Br7c5{swn .} ==> Pr7c5 ≠ sw, Pr7c5 ≠ ns
P-single: Pr7c5 = se
whip[1]: Pr7c5{se .} ==> Br6c4 ≠ e, Br6c4 ≠ ns, Br6c4 ≠ ew, Br6c4 ≠ swn, Br7c4 ≠ ne
B-single: Br7c4 = e
whip[1]: Br7c4{e .} ==> Nr7c4 ≠ 2, Pr7c4 ≠ ne, Pr7c4 ≠ ew
N-single: Nr7c4 = 1
whip[1]: Pr7c4{nw .} ==> Br6c3 ≠ ns, Br6c3 ≠ ew, Br6c3 ≠ wne, Br6c3 ≠ s
whip[1]: Br6c4{nw .} ==> Pr6c4 ≠ o, Pr6c4 ≠ ns, Pr6c4 ≠ nw, Pr6c4 ≠ sw, Pr6c5 ≠ ns, Nr6c4 ≠ 3
P-single: Pr6c5 = nw
whip[1]: Pr6c5{nw .} ==> Br5c4 ≠ ne, Br5c4 ≠ wne
B-single: Br5c4 = nes
whip[1]: Br5c4{nes .} ==> Nr5c4 ≠ 2, Pr5c4 ≠ se, Vr5c4 ≠ 1
V-single: Vr5c4 = 0
N-single: Nr5c4 = 3
P-single: Pr5c4 = ew
no-vertical-line-r5{c3 c4} ==> Ir5c3 = in
same-colour-in-r5{c2 c3} ==> Vr5c3 = 0
different-colours-in-{r4 r5}c3 ==> Hr5c3 = 1
whip[1]: Vr5c4{0 .} ==> Br5c3 ≠ ew, Br5c3 ≠ esw
whip[1]: Br5c3{ns .} ==> Pr5c3 ≠ ns, Pr6c3 ≠ ne, Pr6c3 ≠ ns, Nr5c3 ≠ 3
P-single: Pr5c3 = ne
whip[1]: Pr5c3{ne .} ==> Br4c3 ≠ nw, Br5c2 ≠ ew
B-single: Br5c2 = w
B-single: Br4c3 = swn
whip[1]: Br5c2{w .} ==> Nr5c2 ≠ 2
N-single: Nr5c2 = 1
whip[1]: Br4c3{swn .} ==> Nr4c3 ≠ 2
N-single: Nr4c3 = 3
whip[1]: Pr6c3{se .} ==> Br6c3 ≠ nes, Br6c3 ≠ w
whip[1]: Br6c3{se .} ==> Nr6c3 ≠ 1, Nr6c3 ≠ 3
N-single: Nr6c3 = 2
whip[1]: Br6c5{se .} ==> Nr6c5 ≠ 1
N-single: Nr6c5 = 2
whip[1]: Br8c7{se .} ==> Nr8c7 ≠ 3
N-single: Nr8c7 = 2
whip[1]: Hr5c14{0 .} ==> Pr5c14 ≠ se, Pr5c15 ≠ ew, Br4c14 ≠ ns, Br5c14 ≠ swn
P-single: Pr5c15 = ne
P-single: Pr5c14 = ns
B-single: Br5c14 = sw
B-single: Br4c14 = ew
whip[1]: Pr5c15{ne .} ==> Br4c15 ≠ ns, Br4c15 ≠ se
whip[1]: Br4c15{swn .} ==> Pr4c15 ≠ nw, Pr4c15 ≠ ew, Nr4c15 ≠ 2
N-single: Nr4c15 = 3
w[1]-3-in-r4c15-closed-nw-corner ==> Pr5c16 ≠ nw
P-single: Pr5c16 = sw
whip[1]: Pr5c16{sw .} ==> Br5c15 ≠ n, Br4c15 ≠ esw
B-single: Br4c15 = swn
B-single: Br5c15 = ne
whip[1]: Br4c15{swn .} ==> Pr4c15 ≠ ns, Pr4c16 ≠ ns
P-single: Pr4c16 = nw
P-single: Pr4c15 = se
whip[1]: Pr4c16{nw .} ==> Br3c15 ≠ e, Br3c15 ≠ ew
whip[1]: Br3c15{esw .} ==> Nr3c15 ≠ 1
whip[1]: Pr4c15{se .} ==> Vr3c15 ≠ 1, Hr4c14 ≠ 1, Br3c15 ≠ esw
B-single: Br3c15 = se
whip[1]: Br3c15{se .} ==> Nr3c15 ≠ 3, Pr3c15 ≠ sw
N-single: Nr3c15 = 2
P-single: Pr2c14 = se
P-single: Pr3c15 = o
whip[1]: Pr2c14{se .} ==> Hr2c13 ≠ 1, Br2c13 ≠ ns, Br2c14 ≠ ns
B-single: Br2c14 = nw
B-single: Br2c13 = se
whip[1]: Br2c14{nw .} ==> Pr3c14 ≠ ew, Hr3c14 ≠ 1
P-single: Pr2c13 = o
P-single: Pr3c14 = nw
whip[1]: Pr2c13{o .} ==> Vr1c13 ≠ 1
whip[1]: Br5c15{ne .} ==> Nr5c15 ≠ 1, Pr6c16 ≠ o
N-single: Nr5c15 = 2
P-single: Pr6c16 = ns
whip[1]: Pr6c16{ns .} ==> Br6c15 ≠ w, Br6c15 ≠ sw
whip[1]: Br6c15{esw .} ==> Pr7c16 ≠ o, Pr7c16 ≠ sw, Nr6c15 ≠ 1
whip[1]: Pr7c16{nw .} ==> Br7c15 ≠ w, Br7c15 ≠ ne, Br7c15 ≠ sw, Br7c15 ≠ nes
whip[1]: Pr5c14{ns .} ==> Br4c13 ≠ n
B-single: Br4c13 = ne
whip[1]: Br4c13{ne .} ==> Nr4c13 ≠ 1, Pr4c14 ≠ ew
N-single: Nr4c13 = 2
P-single: Pr4c14 = sw
whip[1]: Br5c14{sw .} ==> Nr5c14 ≠ 3
N-single: Nr5c14 = 2
whip[1]: Vr4c16{0 .} ==> Br4c16 ≠ w
B-single: Br4c16 = o
whip[1]: Vr5c16{1 .} ==> Br5c16 ≠ o
B-single: Br5c16 = w
whip[1]: Vr6c16{1 .} ==> Br6c16 ≠ o
B-single: Br6c16 = w
whip[1]: Hr7c15{0 .} ==> Pr7c16 ≠ nw, Pr7c15 ≠ ne, Br6c15 ≠ esw, Br7c15 ≠ n, Br7c15 ≠ ns
P-single: Pr7c15 = ns
P-single: Pr7c16 = ns
B-single: Br6c15 = ew
whip[1]: Pr7c15{ns .} ==> Br7c14 ≠ w, Br7c14 ≠ sw
whip[1]: Br7c14{esw .} ==> Pr8c15 ≠ o, Pr8c15 ≠ se, Pr8c15 ≠ ew, Pr8c15 ≠ sw, Nr7c14 ≠ 1
whip[1]: Pr8c15{nw .} ==> Br8c14 ≠ ne, Br8c14 ≠ nes, Br8c15 ≠ nw, Br8c15 ≠ swn, Br8c15 ≠ wne
whip[1]: Br6c15{ew .} ==> Nr6c15 ≠ 3
N-single: Nr6c15 = 2
whip[1]: Br7c15{esw .} ==> Pr8c16 ≠ o, Pr8c16 ≠ sw, Nr7c15 ≠ 1
whip[1]: Pr8c16{nw .} ==> Br8c15 ≠ w, Br8c15 ≠ ne, Br8c15 ≠ sw, Br8c15 ≠ nes, Br8c15 ≠ o, Br8c15 ≠ s
whip[1]: Br8c15{esw .} ==> Nr8c15 ≠ 0
whip[1]: Vr7c16{1 .} ==> Br7c16 ≠ o
B-single: Br7c16 = w
whip[1]: Hr8c15{0 .} ==> Pr8c16 ≠ nw, Pr8c15 ≠ ne, Br7c15 ≠ esw, Br8c15 ≠ n, Br8c15 ≠ ns
P-single: Pr8c16 = ns
B-single: Br7c15 = ew
whip[1]: Br7c15{ew .} ==> Nr7c15 ≠ 3
N-single: Nr7c15 = 2
whip[1]: Pr8c15{nw .} ==> Br8c14 ≠ w, Br8c14 ≠ sw
whip[1]: Vr11c16{0 .} ==> Br11c16 ≠ w, Pr11c16 ≠ ns, Pr11c16 ≠ sw, Pr12c16 ≠ ns, Pr12c16 ≠ nw, Br11c15 ≠ se, Br11c15 ≠ ew, Br11c15 ≠ wne, Br11c15 ≠ nes
B-single: Br11c16 = o
whip[1]: Br11c15{nw .} ==> Nr11c15 ≠ 3
whip[1]: Pr12c16{sw .} ==> Br12c15 ≠ nw, Br12c15 ≠ se, Br12c15 ≠ ew, Br12c15 ≠ ns
whip[1]: Br12c15{nes .} ==> Nr12c15 ≠ 2
whip[1]: Pr11c16{nw .} ==> Br10c15 ≠ swn, Br10c15 ≠ wne
whip[1]: Br10c15{nes .} ==> Pr11c16 ≠ o, Pr11c15 ≠ ns, Pr11c15 ≠ nw
P-single: Pr11c16 = nw
whip[1]: Pr11c16{nw .} ==> Br11c15 ≠ s, Br11c15 ≠ w
whip[1]: Br11c15{nw .} ==> Nr11c15 ≠ 1
N-single: Nr11c15 = 2
whip[1]: Pr11c15{ew .} ==> Br10c14 ≠ se, Br10c14 ≠ ew, Br10c14 ≠ esw, Br10c14 ≠ wne, Br10c14 ≠ nes, Br10c15 ≠ esw, Br11c14 ≠ sw, Br11c14 ≠ wne, Br11c14 ≠ nes, Br10c14 ≠ e, Br10c14 ≠ ne, Br11c14 ≠ o, Br11c14 ≠ s, Br11c14 ≠ w, Br11c14 ≠ ne
B-single: Br10c15 = nes
whip[1]: Br10c15{nes .} ==> Pr10c15 ≠ sw, Pr10c15 ≠ ns, Pr10c16 ≠ ns
P-single: Pr10c16 = sw
whip[1]: Pr10c16{sw .} ==> Br9c15 ≠ esw, Br9c15 ≠ wne, Br9c15 ≠ nes
B-single: Br9c15 = swn
whip[1]: Br9c15{swn .} ==> Pr10c15 ≠ ew, Pr9c15 ≠ ew, Pr9c15 ≠ nw, Pr9c15 ≠ ns, Pr9c16 ≠ ns
P-single: Pr9c16 = nw
P-single: Pr9c15 = se
P-single: Pr10c15 = ne
whip[1]: Pr9c16{nw .} ==> Br8c15 ≠ e, Br8c15 ≠ ew
whip[1]: Br8c15{esw .} ==> Nr8c15 ≠ 1
whip[1]: Pr9c15{se .} ==> Br8c14 ≠ ns, Br8c14 ≠ ew, Br8c14 ≠ esw, Br8c15 ≠ esw, Br9c14 ≠ ne, Br9c14 ≠ ns, Br9c14 ≠ nw, Br9c14 ≠ sw
B-single: Br8c15 = se
B-single: Br8c14 = n
whip[1]: Br8c15{se .} ==> Nr8c15 ≠ 3, Pr8c15 ≠ ns
N-single: Nr8c15 = 2
P-single: Pr8c15 = nw
whip[1]: Pr8c15{nw .} ==> Br7c14 ≠ ew
B-single: Br7c14 = esw
whip[1]: Br7c14{esw .} ==> Nr7c14 ≠ 2, Pr8c14 ≠ ns
N-single: Nr7c14 = 3
P-single: Pr8c14 = ne
whip[1]: Pr8c14{ne .} ==> Br8c13 ≠ e, Br8c13 ≠ se
whip[1]: Br8c13{s .} ==> Pr9c14 ≠ ne, Pr9c14 ≠ ns, Nr8c13 ≠ 2
whip[1]: Pr9c14{sw .} ==> Br9c13 ≠ se, Br9c14 ≠ se, Br8c13 ≠ o, Br9c13 ≠ o, Br9c13 ≠ e, Br9c13 ≠ s
B-single: Br8c13 = s
B-single: Br9c14 = ew
whip[1]: Br8c13{s .} ==> Nr8c13 ≠ 0, Pr9c13 ≠ o
N-single: Nr8c13 = 1
P-single: Pr9c13 = se
whip[1]: Pr9c13{se .} ==> Br9c12 ≠ w
B-single: Br9c12 = ew
whip[1]: Br9c12{ew .} ==> Nr9c12 ≠ 1, Pr10c13 ≠ se, Pr10c13 ≠ o
N-single: Nr9c12 = 2
whip[1]: Pr10c13{ns .} ==> Br10c13 ≠ s, Br10c13 ≠ nw, Br10c13 ≠ se, Br10c13 ≠ swn, Br10c13 ≠ wne, Br10c13 ≠ o, Br10c13 ≠ e
whip[1]: Br10c13{nes .} ==> Nr10c13 ≠ 0
whip[1]: Br9c14{ew .} ==> Pr10c14 ≠ ew, Pr10c14 ≠ se, Pr9c14 ≠ ew
P-single: Pr9c14 = sw
whip[1]: Pr9c14{sw .} ==> Br9c13 ≠ nw, Br9c13 ≠ swn
B-single: Br9c13 = wne
whip[1]: Br9c13{wne .} ==> Nr9c13 ≠ 2, Nr9c13 ≠ 1, Nr9c13 ≠ 0, Pr10c14 ≠ nw, Pr10c13 ≠ ne, Hr10c13 ≠ 1
H-single: Hr10c13 = 0
N-single: Nr9c13 = 3
P-single: Pr10c13 = ns
P-single: Pr10c14 = ns
no-horizontal-line-{r9 r10}c13 ==> Ir10c13 = out
different-colours-in-r10{c13 c14} ==> Hr10c14 = 1
different-colours-in-r10{c12 c13} ==> Hr10c13 = 1

LOOP[6]: Vr10c13-Vr9c13-Hr9c13-Vr9c14-Vr10c14- ==> Hr11c13 = 0
no-horizontal-line-{r10 r11}c13 ==> Ir11c13 = out
same-colour-in-{r11 r12}c13 ==> Hr12c13 = 0
w[1]-2-in-r12c13-open-nw-corner ==> Vr12c14 = 1, Hr13c14 = 0
w[1]-diagonal-3-1-in-{r14c15...r13c14}-open-end ==> Vr14c16 = 1, Hr15c15 = 1
w[1]-3-in-r14c15-closed-se-corner ==> Pr14c15 ≠ se, Pr14c15 ≠ o
w[1]-1-in-r13c14-asymmetric-se-corner ==> Pr13c14 ≠ ew
P-single: Pr12c13 = nw
P-single: Pr13c14 = nw
no-vertical-line-r15{c15 c16} ==> Ir15c15 = out
horizontal-line-{r14 r15}c15 ==> Ir14c15 = in
no-horizontal-line-{r12 r13}c14 ==> Ir12c14 = in
same-colour-in-r14{c14 c15} ==> Vr14c15 = 0
w[0]-adjacent-3-in-r14c15-nolines-west ==> Vr15c15 = 1, Vr13c15 = 1, Hr14c15 = 1, Vr13c16 = 0
w[1]-3-in-r14c15-closed-ne-corner ==> Pr15c15 ≠ ne, Pr15c15 ≠ o
no-vertical-line-r13{c15 c16} ==> Ir13c15 = out
different-colours-in-r11{c12 c13} ==> Hr11c13 = 1

LOOP[12]: Vr10c14-Vr9c14-Hr9c13-Vr9c13-Vr10c13-Vr11c13-Hr12c12-Vr12c12-Hr13c12-Hr13c13-Vr12c14- ==> Vr11c14 = 0
no-vertical-line-r11{c13 c14} ==> Ir11c14 = out
same-colour-in-r11{c14 c15} ==> Vr11c15 = 0
P-single: Pr12c16 = sw
P-single: Pr11c15 = ew
different-colours-in-{r11 r12}c14 ==> Hr12c14 = 1
different-colours-in-{r10 r11}c14 ==> Hr11c14 = 1
whip[1]: Hr10c13{0 .} ==> Br10c13 ≠ n, Br10c13 ≠ ne, Br10c13 ≠ ns, Br10c13 ≠ nes
whip[1]: Br10c13{esw .} ==> Pr11c13 ≠ o, Pr11c13 ≠ se
whip[1]: Pr11c13{ns .} ==> Br10c12 ≠ w, Br11c13 ≠ s, Br11c13 ≠ nw, Br11c13 ≠ se, Br11c13 ≠ wne
B-single: Br10c12 = ew
whip[1]: Br10c12{ew .} ==> Nr10c12 ≠ 1
N-single: Nr10c12 = 2
whip[1]: Pr10c14{ns .} ==> Br10c14 ≠ n, Br10c14 ≠ o, Br10c13 ≠ w, Br10c13 ≠ sw, Br10c14 ≠ s, Br10c14 ≠ ns, Br10c14 ≠ nw, Br10c14 ≠ swn
whip[1]: Br10c14{sw .} ==> Pr11c14 ≠ o, Pr11c14 ≠ se, Pr11c14 ≠ ew, Pr11c14 ≠ sw, Nr10c14 ≠ 0, Nr10c14 ≠ 3
whip[1]: Pr11c14{nw .} ==> Br11c13 ≠ nes, Br11c14 ≠ nw, Br11c14 ≠ swn
whip[1]: Br11c14{esw .} ==> Nr11c14 ≠ 0
whip[1]: Br11c13{ew .} ==> Nr11c13 ≠ 3
whip[1]: Br10c13{esw .} ==> Nr10c13 ≠ 1
whip[1]: Hr11c13{0 .} ==> Pr11c13 ≠ ne, Pr11c14 ≠ nw, Br10c13 ≠ esw, Br11c13 ≠ ns
P-single: Pr11c13 = ns
B-single: Br10c13 = ew
whip[1]: Pr11c13{ns .} ==> Br11c12 ≠ s
B-single: Br11c12 = se
whip[1]: Br11c12{se .} ==> Nr11c12 ≠ 1
N-single: Nr11c12 = 2
whip[1]: Br10c13{ew .} ==> Nr10c13 ≠ 3
N-single: Nr10c13 = 2
whip[1]: Br11c13{ew .} ==> Pr12c14 ≠ ew
whip[1]: Pr12c14{se .} ==> Br11c14 ≠ esw, Br12c13 ≠ ns, Br12c14 ≠ ns, Br12c14 ≠ se, Br11c14 ≠ n, Br11c14 ≠ e
B-single: Br12c13 = se
whip[1]: Br11c14{ew .} ==> Pr12c15 ≠ se, Nr11c14 ≠ 1, Nr11c14 ≠ 3
N-single: Nr11c14 = 2
whip[1]: Pr12c15{ew .} ==> Br11c14 ≠ se, Br12c15 ≠ wne, Br12c15 ≠ s
whip[1]: Br12c15{nes .} ==> Pr13c16 ≠ ns, Pr13c16 ≠ sw
whip[1]: Pr13c16{nw .} ==> Br13c15 ≠ ne, Br13c15 ≠ se, Br13c15 ≠ ew, Br13c15 ≠ esw, Br13c15 ≠ wne, Br13c15 ≠ nes, Br13c15 ≠ e
whip[1]: Br13c15{swn .} ==> Pr14c16 ≠ ns, Pr14c16 ≠ nw
whip[1]: Pr14c16{sw .} ==> Br14c15 ≠ esw, Br14c15 ≠ swn
whip[1]: Br14c15{nes .} ==> Pr14c16 ≠ o, Pr15c16 ≠ o, Pr15c16 ≠ sw, Pr14c15 ≠ ns
P-single: Pr14c15 = ne
P-single: Pr14c16 = sw
whip[1]: Pr14c15{ne .} ==> Br13c15 ≠ n, Br13c15 ≠ o, Br13c14 ≠ n, Br13c15 ≠ s, Br13c15 ≠ w, Br13c15 ≠ ns, Br13c15 ≠ nw, Br14c14 ≠ ew, Br14c15 ≠ wne
B-single: Br14c15 = nes
B-single: Br14c14 = w
B-single: Br13c14 = e
whip[1]: Br14c15{nes .} ==> Pr15c15 ≠ ns, Pr15c16 ≠ ns
P-single: Pr15c16 = nw
P-single: Pr15c15 = se
whip[1]: Pr15c16{nw .} ==> Br15c15 ≠ w, Br15c15 ≠ se, Br15c15 ≠ nes
B-single: Br15c15 = nw
whip[1]: Br15c15{nw .} ==> Nr15c15 ≠ 3, Nr15c15 ≠ 1, Pr16c15 ≠ ew, Pr16c16 ≠ nw
N-single: Nr15c15 = 2
P-single: Pr16c16 = o
P-single: Pr16c15 = nw
whip[1]: Pr16c16{o .} ==> Br16c15 ≠ n
B-single: Br16c15 = o
whip[1]: Pr16c15{nw .} ==> Br15c14 ≠ s
B-single: Br15c14 = se
whip[1]: Br15c14{se .} ==> Nr15c14 ≠ 1
N-single: Nr15c14 = 2
whip[1]: Br14c14{w .} ==> Nr14c14 ≠ 2
N-single: Nr14c14 = 1
whip[1]: Br13c14{e .} ==> Pr13c15 ≠ ew
whip[1]: Br13c15{swn .} ==> Nr13c15 ≠ 0, Nr13c15 ≠ 1
whip[1]: Vr14c16{1 .} ==> Br14c16 ≠ o
B-single: Br14c16 = w
whip[1]: Vr15c16{0 .} ==> Br15c16 ≠ w
B-single: Br15c16 = o
whip[1]: Vr13c16{0 .} ==> Br13c16 ≠ w
B-single: Br13c16 = o
whip[1]: Vr11c14{0 .} ==> Pr11c14 ≠ ns, Pr12c14 ≠ ns, Br11c13 ≠ ew, Br11c14 ≠ ew
P-single: Pr13c15 = se
P-single: Pr12c14 = se
P-single: Pr11c14 = ne
B-single: Br11c14 = ns
B-single: Br11c13 = w
whip[1]: Pr13c15{se .} ==> Br12c15 ≠ w, Vr12c15 ≠ 1, Hr13c15 ≠ 0, Br12c14 ≠ ew, Br13c15 ≠ sw
H-single: Hr13c15 = 1
V-single: Vr12c15 = 0
B-single: Br13c15 = swn
B-single: Br12c14 = nw
B-single: Br12c15 = nes
no-vertical-line-r12{c14 c15} ==> Ir12c15 = in
different-colours-in-r12{c15 c16} ==> Hr12c16 = 1
different-colours-in-{r11 r12}c15 ==> Hr12c15 = 1

LOOP[212]: Hr8c1-Vr8c1-Vr9c1-Vr10c1-Vr11c1-Hr12c1-Hr12c2-Vr11c3-Hr11c2-Vr10c2-Vr9c2-Hr9c2-Vr9c3-Hr10c3-Vr10c4-Hr11c4-Vr11c5-Hr12c4-Vr12c4-Hr13c4-Vr13c5-Vr14c5-Hr15c4-Hr15c3-Vr14c3-Vr13c3-Hr13c2-Hr13c1-Vr13c1-Vr14c1-Hr15c1-Vr15c2-Hr16c2-Hr16c3-Hr16c4-Hr16c5-Vr15c6-Vr14c6-Vr13c6-Hr13c6-Vr13c7-Vr14c7-Vr15c7-Hr16c7-Vr15c8-Vr14c8-Hr14c8-Vr13c9-Hr13c8-Vr12c8-Hr12c8-Hr12c9-Hr12c10-Vr12c11-Hr13c10-Vr13c10-Vr14c10-Hr15c9-Vr15c9-Hr16c9-Hr16c10-Hr16c11-Vr15c12-Vr14c12-Hr14c12-Hr14c13-Vr14c14-Hr15c13-Vr15c13-Hr16c13-Hr16c14-Vr15c15-Hr15c15-Vr14c16-Hr14c15-Vr13c15-Hr13c15-Vr12c16-Hr12c15-Hr12c14-Vr12c14-Hr13c13-Hr13c12-Vr12c12-Hr12c12-Vr11c13-Vr10c13-Vr9c13-Hr9c13-Vr9c14-Vr10c14-Hr11c14-Hr11c15-Vr10c16-Hr10c15-Vr9c15-Hr9c15-Vr8c16-Vr7c16-Vr6c16-Vr5c16-Hr5c15-Vr4c15-Hr4c15-Vr3c16-Vr2c16-Vr1c16-Hr1c15-Vr1c15-Hr2c14-Vr2c14-Hr3c13-Vr3c13-Hr4c13-Vr4c14-Vr5c14-Hr6c14-Vr6c15-Vr7c15-Hr8c14-Vr7c14-Hr7c13-Vr7c13-Hr8c12-Vr7c12-Vr6c12-Hr6c12-Vr5c13-Hr5c12-Vr4c12-Vr3c12-Vr2c12-Hr2c11-Vr1c11-Hr1c10-Hr1c9-Vr1c9-Hr2c9-Vr2c10-Hr3c10-Vr3c11-Hr4c10-Hr4c9-Vr4c9-Hr5c8-Vr4c8-Vr3c8-Vr2c8-Vr1c8-Hr1c7-Vr1c7-Hr2c6-Vr1c6-Hr1c5-Vr1c5-Vr2c5-Hr3c5-Hr3c6-Vr3c7-Hr4c6-Vr4c6-Hr5c6-Vr5c7-Hr6c6-Vr6c6-Hr7c5-Vr7c5-Hr8c5-Hr8c6-Vr7c7-Hr7c7-Vr6c8-Hr6c8-Hr6c9-Vr5c10-Hr5c10-Vr5c11-Vr6c11-Vr7c11-Vr8c11-Hr9c11-Vr9c12-Vr10c12-Hr11c11-Vr10c11-Hr10c10-Vr10c10-Hr11c9-Vr10c9-Vr9c9-Hr9c9-Vr8c10-Vr7c10-Hr7c9-Vr7c9-Hr8c8-Vr8c8-Hr9c7-Vr9c7-Hr10c7-Vr10c8-Hr11c7-Vr11c7-Hr12c6-Vr11c6-Vr10c6-Hr10c5-Vr9c5-Hr9c4-Vr8c4-Hr8c3- ==> Hr8c2 = 0
w[1]-diagonal-3-2s-in-{r5c4...r7c2}-non-closed-sw-end ==> Vr7c2 = 1
w[1]-diagonal-3-2-in-{r6c1...r7c2}-non-closed-se-corner ==> Vr7c3 = 1
vertical-line-r7{c2 c3} ==> Ir7c2 = in
whip[1]: Hr13c15{1 .} ==> Pr13c16 ≠ o
P-single: Pr13c16 = nw
whip[1]: Vr12c15{0 .} ==> Pr12c15 ≠ ns
P-single: Pr12c15 = ew
whip[1]: Pr12c15{ew .} ==> Br11c15 ≠ nw
B-single: Br11c15 = ns
whip[1]: Br13c15{swn .} ==> Nr13c15 ≠ 2
N-single: Nr13c15 = 3
whip[1]: Br12c15{nes .} ==> Nr12c15 ≠ 1
N-single: Nr12c15 = 3
whip[1]: Vr12c16{1 .} ==> Br12c16 ≠ o
B-single: Br12c16 = w
whip[1]: Hr8c2{0 .} ==> Pr8c2 ≠ ew, Pr8c3 ≠ ew, Br7c2 ≠ ns, Br8c2 ≠ ns
P-single: Pr7c4 = o
P-single: Pr8c3 = ne
P-single: Pr8c2 = nw
B-single: Br8c2 = s
B-single: Br7c2 = ew
whip[1]: Pr7c4{o .} ==> Vr6c4 ≠ 1, Hr7c3 ≠ 1, Br6c3 ≠ se, Br6c4 ≠ nw, Br7c3 ≠ ns
H-single: Hr7c3 = 0
V-single: Vr6c4 = 0
w[1]-2-in-r6c3-open-se-corner ==> Hr6c3 = 1, Vr6c3 = 1
P-single: Pr6c3 = se
B-single: Br7c3 = sw
B-single: Br6c4 = n
B-single: Br6c3 = nw
w[1]-1-in-r6c2-asymmetric-ne-corner ==> Pr7c2 ≠ ew
P-single: Pr7c2 = sw
vertical-line-r6{c2 c3} ==> Ir6c3 = out

PUZZLE 0 SOLVED. rating-type = W+nW1eq+Col+Loop, MOST COMPLEX RULE TRIED = W[1]

XXXOXOXOXXOOOOX
OXOOXXXOOXXOOXX
OXXOOOXOOOXOXXX
XXOOOXXOXXXOOXO
OXXXOOXXXOXXOXX
XXOOOXXOOOXOOOX
OXOOXXOOXOXOXOX
XXXOOOOXXOXXXXX
XOXXOOXXOOOXOXO
XOOXXOOXOXOXOXX
XXOOXOXXXXXXOOO
OOOXXXXOOOXOOXX
XXOOXOXXOXXXXXO
XXOOXOXOOXXOOXX
OXXXXOXOXXXOXXO

.———.———.———.   .———.   .———.   .———.———.   .   .   .   .———.
|           | 2 | 3 | 3 |   | 2 |       |     0   0   2 |   |
.———.   .———.   .   .———.   .   .———.   .———.   .   .———.   .
  2 |   | 3     | 2   2     | 1     |       |       |       |
.   .   .———.   .———.———.   .   .   .———.   .   .———.   .   .
  2 |     3 | 1       3 | 2 | 1   1     |   |   | 3   0     |
.———.   .———.   .   .———.   .   .———.———.   .   .———.   .———.
| 3   1 |     1   1 |       | 3 |     2   1 |       | 2 |
.———.   .———.———.   .———.   .———.   .———.   .———.   .   .———.
    |           | 1     |     2     |   |       |   |       |
.———.   .———.———.   .———.   .———.———.   .   .———.   .———.   .
| 3   1 |           | 2     |     2   1 | 2 | 2   1   2 |   |
.———.   .   .   .———.   .———.   .———.   .   .   .———.   .   .
    |   |       | 3     | 2   2 | 3 |   |   | 3 | 3 |   |   |
.———.   .———.   .———.———.   .———.   .   .   .———.   .———.   .
|         2 | 2   1   1     | 2   2 |   |                   |
.   .———.   .———.   .   .———.   .———.   .———.   .———.   .———.
|   |   |       |       |       |         2 |   |   | 2 | 3
.   .   .———.   .———.   .———.   .   .———.   .   .   .   .———.
|   | 2     |       | 1   3 |   |   | 3 | 3 |   |   |     3 |
.   .———.   .———.   .   .———.   .———.   .———.   .   .———.———.
|     3 |       | 2 |   |     1   2       1     |
.———.———.   .———.   .———.   .———.———.———.   .———.   .———.———.
  2       1 |     0   2   1 | 3         | 2 |     2 | 2     |
.———.———.   .———.   .———.   .———.   .———.   .———.———.   .———.
| 2   2 | 1   2 | 2 |   |       |   |     0   2       1 |
.   .   .   .   .   .   .   .———.   .   .   .———.———.   .———.
| 2   1 |     2 | 2 | 2 |   | 2     | 1     | 2   3 |     3 |
.———.   .———.———.   .   .   .   .———.   .   .   .———.   .———.
    |             2 |   | 3 |   | 3   1     |   |       |
.   .———.———.———.———.   .———.   .———.———.———.   .———.———.   .

init-time = 1.37s, solve-time = 5m 41.46s, total-time = 5m 42.83s
nb-facts=<Fact-466668>
Quasi-Loop max length = 212
Colours effectively used
***********************************************************************************************
***  SlitherRules 2.1.s based on CSP-Rules 2.1.s, config = W+nW1eq+Col+Loop
***  Using CLIPS 6.32-r770
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
***********************************************************************************************