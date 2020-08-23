
(solve
10 10
. . . . . 2 3 . . 3
. 2 . 2 . . . . . . 
. 2 . . 3 0 2 2 . 3
2 2 . 0 . . 3 . 1 3 
2 . . 2 . 2 . . 1 . 
3 3 . 0 2 . 1 . . . 
. 2 . . 2 3 . . . 2
. . . 3 . . 0 . . 3
1 . . . . 3 . 3 . . 
. . 2 3 . 2 2 . . 3
)


***********************************************************************************************
***  SlitherRules 2.1.s based on CSP-Rules 2.1.s, config = W+nW1eq+Col+Loop
***  Using CLIPS 6.32-r767
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
***********************************************************************************************

. . . . . 2 3 . . 3
. 2 . 2 . . . . . .
. 2 . . 3 0 2 2 . 3
2 2 . 0 . . 3 . 1 3
2 . . 2 . 2 . . 1 .
3 3 . 0 2 . 1 . . .
. 2 . . 2 3 . . . 2
. . . 3 . . 0 . . 3
1 . . . . 3 . 3 . .
. . 2 3 . 2 2 . . 3

start init-grid-structure 0.0334060192108154
start create-csp-variables
start create-labels 0.00142288208007812
start init-physical-csp-links 0.0119850635528564
start init-physical-non-csp-links 11.9722459316254
     start init-physical-PH-and-PV-non-csp-links at local time 0
     start init-physical-BH-and-BV-non-csp-links at local time 3.4804060459137
     start init-physical-BN-non-csp-links at local time 12.5342211723328
     start init-physical-BP-non-csp-links at local time 22.2898530960083
     end init-physical-BP-non-csp-links at local time 250.551821947098
end init-physical-non-csp-links 262.524119853973
start init-corner-B-c-values 262.557790994644
start init-outer-B-candidates 262.557847976685
start init-outer-I-candidates 262.558642864227
start init-H-candidates 262.559084892273
start init-V-candidates 262.562779903412
start init-P-candidates 262.566249847412
start init-inner-I-candidates 262.573027849197
start init-inner-N-and-B-candidates 262.575477838516
start solution 262.588674068451
entering BRT
w[0]-0-in-r8c7 ==> Hr9c7 = 0, Hr8c7 = 0, Vr8c8 = 0, Vr8c7 = 0
w[0]-0-in-r6c4 ==> Hr7c4 = 0, Hr6c4 = 0, Vr6c5 = 0, Vr6c4 = 0
w[0]-0-in-r4c4 ==> Hr5c4 = 0, Hr4c4 = 0, Vr4c5 = 0, Vr4c4 = 0
w[0]-0-in-r3c6 ==> Hr4c6 = 0, Hr3c6 = 0, Vr3c7 = 0, Vr3c6 = 0
w[0]-adjacent-3-0-in-r3{c5 c6} ==> Vr4c6 = 1, Vr2c6 = 1, Vr3c5 = 1, Hr4c5 = 1, Hr3c5 = 1, Vr2c5 = 0, Hr3c4 = 0
w[1]-3-in-se-corner ==> Vr10c11 = 1, Hr11c10 = 1
w[1]-3-in-ne-corner ==> Vr1c11 = 1, Hr1c10 = 1
w[1]-2-in-r2c4-open-se-corner ==> Hr2c4 = 1, Vr2c4 = 1, Hr2c3 = 0, Vr1c4 = 0
w[1]-diagonal-3-0-in-{r9c8...r8c7} ==> Vr9c8 = 1, Hr9c8 = 1
w[1]-diagonal-3-0-in-{r9c6...r8c7} ==> Vr9c7 = 1, Hr9c6 = 1
w[1]-diagonal-3-0-in-{r7c6...r8c7} ==> Vr7c7 = 1, Hr8c6 = 1
w[1]-diagonal-3-0-in-{r4c7...r3c6} ==> Vr4c7 = 1, Hr4c7 = 1
w[1]-diagonal-3-2+0-in-{r7c6...r6c5+r6c4} ==> Hr6c5 = 1
w[1]-diagonal-3-2-2+0-in-{r7c6...r5c4+r4c4} ==> Vr5c4 = 1
w[1]-diagonal-3-2-2+0-in-{r4c7...r6c5+r6c4} ==> Vr4c8 = 1, Hr7c5 = 1, Vr3c8 = 0, Hr4c8 = 0
w[1]-2-in-r3c8-open-sw-corner ==> Hr3c8 = 1, Vr3c9 = 1, Hr3c9 = 0, Vr2c9 = 0
w[1]-3+diagonal-2-0-in-{r7c6+r7c5...r6c4} ==> Hr7c6 = 1, Vr6c7 = 0, Vr6c6 = 0, Hr7c7 = 0
w[1]-3-in-r10c10-closed-se-corner ==> Pr10c10 ≠ se, Pr10c10 ≠ nw, Pr10c10 ≠ o
w[1]-3-in-r9c8-closed-nw-corner ==> Pr10c9 ≠ se, Pr10c9 ≠ nw, Pr10c9 ≠ o
w[1]-3-in-r9c6-closed-ne-corner ==> Pr10c6 ≠ sw, Pr10c6 ≠ ne, Pr10c6 ≠ o
w[1]-3-in-r7c6-closed-ne-corner ==> Pr8c6 ≠ o
w[1]-3-in-r4c7-closed-nw-corner ==> Pr5c8 ≠ se, Pr5c8 ≠ nw, Pr5c8 ≠ o
w[1]-3-in-r3c5-closed-sw-corner ==> Pr3c6 ≠ o
w[1]-3-in-r3c5-closed-nw-corner ==> Pr4c6 ≠ o
w[1]-3-in-r1c10-closed-ne-corner ==> Pr2c10 ≠ sw, Pr2c10 ≠ ne, Pr2c10 ≠ o
w[1]-3-in-r8c4-asymmetric-ne-corner ==> Vr8c4 = 1, Hr9c4 = 1, Vr9c4 = 0, Hr9c3 = 0
adjacent-3s-in-r6{c1 c2} ==> Vr6c3 = 1, Vr6c2 = 1, Vr6c1 = 1, Vr7c2 = 0, Vr5c2 = 0
adjacent-3s-in-c10{r3 r4} ==> Hr5c10 = 1, Hr4c10 = 1, Hr3c10 = 1, Hr4c9 = 0
P-single: Pr4c6 = sw
P-single: Pr3c6 = nw
P-single: Pr7c5 = se
V-single: Vr7c5 = 1
w[1]-3-in-r8c4-hit-by-verti-line-at-ne ==> Hr8c5 = 0
P-single: Pr8c6 = se
V-single: Vr7c6 = 0
V-single: Vr8c6 = 1
w[1]-3-in-r9c6-hit-by-verti-line-at-nw ==> Hr10c6 = 1
w[1]-2-in-r10c7-open-nw-corner ==> Hr11c7 = 1, Vr10c8 = 1, Hr11c8 = 0
w[1]-diagonal-3-2-in-{r9c8...r10c7}-non-closed-sw-corner ==> Vr9c9 = 1, Vr8c9 = 0, Hr9c9 = 0
w[1]-3-in-r9c6-closed-se-corner ==> Pr9c6 ≠ se, Pr9c6 ≠ nw, Pr9c6 ≠ o
P-single: Pr11c7 = ew
H-single: Hr11c6 = 1
P-single: Pr3c7 = ne
H-single: Hr3c7 = 1
V-single: Vr2c7 = 1
w[1]-3-in-r1c7-hit-by-verti-line-at-sw ==> Vr1c8 = 1, Hr1c7 = 1, Hr2c6 = 0
w[1]-3-in-r1c7-closed-ne-corner ==> Pr2c7 ≠ sw, Pr2c7 ≠ ne, Pr2c7 ≠ o
P-single: Pr4c7 = se
P-single: Pr6c5 = ne
V-single: Vr5c5 = 1
P-single: Pr6c4 = nw
H-single: Hr6c3 = 1
w[1]-3-in-r6c2-hit-by-horiz-line-at-ne ==> Hr7c2 = 1
w[1]-diagonal-3-2-in-{r6c1...r7c2}-non-closed-se-corner ==> Hr8c2 = 1, Hr6c1 = 1, Vr5c1 = 0
w[1]-diagonal-3-2-in-{r6c2...r5c1}-non-closed-nw-corner ==> Hr5c1 = 1
w[1]-3-in-r6c1-closed-ne-corner ==> Pr7c1 ≠ ne, Pr7c1 ≠ o
w[1]-3-in-r6c2-closed-sw-corner ==> Pr6c3 ≠ sw, Pr6c3 ≠ ne, Pr6c3 ≠ o
P-single: Pr5c4 = sw
H-single: Hr5c3 = 1
P-single: Pr5c5 = se
H-single: Hr5c5 = 1
w[1]-2-in-r5c6-open-nw-corner ==> Hr6c6 = 1, Vr5c7 = 1, Hr6c7 = 0
w[1]-1-in-r4c9-asymmetric-nw-corner ==> Pr5c10 ≠ sw, Pr5c10 ≠ ew, Pr5c10 ≠ ns, Pr5c10 ≠ ne
entering level Loop with <Fact-93985>
entering level Col with <Fact-94147>
vertical-line-r10{c10 c11} ==> Ir10c10 = in
vertical-line-r1{c10 c11} ==> Ir1c10 = in
vertical-line-r6{c0 c1} ==> Ir6c1 = in
no-horizontal-line-{r6 r7}c1 ==> Ir7c1 = in
no-vertical-line-r7{c1 c2} ==> Ir7c2 = in
no-vertical-line-r7{c2 c3} ==> Ir7c3 = in
no-horizontal-line-{r6 r7}c3 ==> Ir6c3 = in
no-vertical-line-r6{c3 c4} ==> Ir6c4 = in
no-vertical-line-r6{c4 c5} ==> Ir6c5 = in
no-vertical-line-r6{c5 c6} ==> Ir6c6 = in
no-vertical-line-r6{c6 c7} ==> Ir6c7 = in
no-horizontal-line-{r5 r6}c7 ==> Ir5c7 = in
vertical-line-r5{c6 c7} ==> Ir5c6 = out
no-vertical-line-r5{c5 c6} ==> Ir5c5 = out
vertical-line-r5{c4 c5} ==> Ir5c4 = in
no-horizontal-line-{r4 r5}c4 ==> Ir4c4 = in
no-vertical-line-r4{c3 c4} ==> Ir4c3 = in
horizontal-line-{r4 r5}c3 ==> Ir5c3 = out
no-vertical-line-r5{c2 c3} ==> Ir5c2 = out
no-vertical-line-r5{c1 c2} ==> Ir5c1 = out
horizontal-line-{r4 r5}c1 ==> Ir4c1 = in
no-horizontal-line-{r5 r6}c2 ==> Ir6c2 = out
no-vertical-line-r4{c4 c5} ==> Ir4c5 = in
vertical-line-r4{c5 c6} ==> Ir4c6 = out
no-horizontal-line-{r3 r4}c6 ==> Ir3c6 = out
no-vertical-line-r3{c5 c6} ==> Ir3c5 = out
vertical-line-r3{c4 c5} ==> Ir3c4 = in
no-horizontal-line-{r2 r3}c4 ==> Ir2c4 = in
no-vertical-line-r2{c4 c5} ==> Ir2c5 = in
vertical-line-r2{c5 c6} ==> Ir2c6 = out
no-horizontal-line-{r1 r2}c6 ==> Ir1c6 = out
vertical-line-r2{c6 c7} ==> Ir2c7 = in
horizontal-line-{r2 r3}c7 ==> Ir3c7 = out
no-vertical-line-r3{c7 c8} ==> Ir3c8 = out
no-horizontal-line-{r3 r4}c8 ==> Ir4c8 = out
vertical-line-r4{c7 c8} ==> Ir4c7 = in
vertical-line-r3{c8 c9} ==> Ir3c9 = in
no-horizontal-line-{r2 r3}c9 ==> Ir2c9 = in
no-vertical-line-r2{c8 c9} ==> Ir2c8 = in
no-horizontal-line-{r3 r4}c9 ==> Ir4c9 = in
vertical-line-r2{c3 c4} ==> Ir2c3 = out
no-horizontal-line-{r1 r2}c3 ==> Ir1c3 = out
no-vertical-line-r1{c3 c4} ==> Ir1c4 = out
no-horizontal-line-{r6 r7}c7 ==> Ir7c7 = in
no-horizontal-line-{r7 r8}c7 ==> Ir8c7 = in
no-vertical-line-r8{c6 c7} ==> Ir8c6 = in
vertical-line-r8{c5 c6} ==> Ir8c5 = out
no-horizontal-line-{r7 r8}c5 ==> Ir7c5 = out
no-vertical-line-r7{c5 c6} ==> Ir7c6 = out
vertical-line-r7{c4 c5} ==> Ir7c4 = in
no-horizontal-line-{r8 r9}c5 ==> Ir9c5 = out
no-vertical-line-r9{c5 c6} ==> Ir9c6 = out
vertical-line-r9{c6 c7} ==> Ir9c7 = in
no-horizontal-line-{r9 r10}c7 ==> Ir10c7 = in
no-vertical-line-r10{c6 c7} ==> Ir10c6 = in
vertical-line-r10{c7 c8} ==> Ir10c8 = out
vertical-line-r9{c7 c8} ==> Ir9c8 = out
vertical-line-r9{c8 c9} ==> Ir9c9 = in
no-horizontal-line-{r8 r9}c9 ==> Ir8c9 = in
no-vertical-line-r8{c8 c9} ==> Ir8c8 = in
horizontal-line-{r7 r8}c2 ==> Ir8c2 = out
no-horizontal-line-{r0 r1}c8 ==> Ir1c8 = out
vertical-line-r1{c7 c8} ==> Ir1c7 = in
same-colour-in-{r1 r2}c7 ==> Hr2c7 = 0
different-colours-in-r1{c6 c7} ==> Hr1c7 = 1
w[1]-3-in-r1c7-closed-nw-corner ==> Pr2c8 ≠ se, Pr2c8 ≠ nw, Pr2c8 ≠ o

LOOP[6]: Hr3c7-Vr2c7-Vr1c7-Hr1c7-Vr1c8- ==> Vr2c8 = 0
different-colours-in-{r1 r2}c8 ==> Hr2c8 = 1
same-colour-in-{r9 r10}c8 ==> Hr10c8 = 0
same-colour-in-r7{c3 c4} ==> Vr7c4 = 0
same-colour-in-{r0 r1}c4 ==> Hr1c4 = 0
same-colour-in-{r0 r1}c3 ==> Hr1c3 = 0
different-colours-in-r4{c8 c9} ==> Hr4c9 = 1
same-colour-in-{r4 r5}c7 ==> Hr5c7 = 0
different-colours-in-r4{c0 c1} ==> Hr4c1 = 1
different-colours-in-r7{c0 c1} ==> Hr7c1 = 1
Starting_init_links_with_<Fact-94326>
2317 candidates, 7964 csp-links and 29430 links. Density = 1.1%
starting non trivial part of solution
Entering_level_W1_with_<Fact-169119>
whip[1]: Vr7c1{1 .} ==> Br7c1 ≠ nes, Br7c0 ≠ o, Br7c1 ≠ o, Pr8c1 ≠ o, Pr8c1 ≠ se, Br7c1 ≠ n, Br7c1 ≠ e, Br7c1 ≠ s, Br7c1 ≠ ne, Br7c1 ≠ ns, Br7c1 ≠ se
B-single: Br7c0 = e
whip[1]: Br7c1{wne .} ==> Nr7c1 ≠ 0
whip[1]: Pr8c1{ns .} ==> Br8c1 ≠ s, Br8c1 ≠ nw, Br8c1 ≠ se, Br8c1 ≠ swn, Br8c1 ≠ wne, Br8c1 ≠ o, Br8c1 ≠ e
whip[1]: Br8c1{nes .} ==> Nr8c1 ≠ 0
whip[1]: Vr4c1{1 .} ==> Br4c1 ≠ se, Br4c0 ≠ o, Pr4c1 ≠ o, Pr4c1 ≠ ne, Br4c1 ≠ ne, Br4c1 ≠ ns
B-single: Br4c0 = e
whip[1]: Br4c1{sw .} ==> Pr4c2 ≠ sw, Pr5c2 ≠ nw
whip[1]: Pr5c2{ew .} ==> Br4c2 ≠ sw, Br5c1 ≠ sw, Br5c2 ≠ se, Br4c2 ≠ ne, Br5c1 ≠ ne, Br5c2 ≠ o, Br5c2 ≠ e, Br5c2 ≠ s
whip[1]: Br5c2{nes .} ==> Nr5c2 ≠ 0
whip[1]: Pr4c1{se .} ==> Br3c1 ≠ ne, Br3c1 ≠ sw, Br3c1 ≠ esw, Br3c1 ≠ swn, Br3c1 ≠ o, Br3c1 ≠ n, Br3c1 ≠ e
whip[1]: Br3c1{nes .} ==> Nr3c1 ≠ 0
whip[1]: Hr5c7{0 .} ==> Br5c7 ≠ nes, Pr5c7 ≠ se, Pr5c7 ≠ ew, Pr5c8 ≠ ew, Pr5c8 ≠ sw, Br4c7 ≠ esw, Br4c7 ≠ swn, Br4c7 ≠ nes, Br5c7 ≠ n, Br5c7 ≠ ne, Br5c7 ≠ ns, Br5c7 ≠ nw, Br5c7 ≠ swn, Br5c7 ≠ wne
B-single: Br4c7 = wne
P-single: Pr3c9 = sw
P-single: Pr4c8 = sw
whip[1]: Pr3c9{sw .} ==> Br3c9 ≠ ns, Br3c9 ≠ ne, Br3c9 ≠ s, Br3c9 ≠ e, Br3c9 ≠ n, Br3c9 ≠ o, Br3c8 ≠ ns, Br2c9 ≠ ns, Br2c9 ≠ w, Br2c9 ≠ s, Br2c8 ≠ ne, Br2c8 ≠ w, Br2c8 ≠ e, Br2c8 ≠ n, Br2c8 ≠ o, Br2c8 ≠ nw, Br2c8 ≠ se, Br2c8 ≠ ew, Br2c8 ≠ esw, Br2c8 ≠ wne, Br2c8 ≠ nes, Br2c9 ≠ nw, Br2c9 ≠ se, Br2c9 ≠ ew, Br2c9 ≠ sw, Br2c9 ≠ esw, Br2c9 ≠ swn, Br2c9 ≠ wne, Br2c9 ≠ nes, Br3c8 ≠ nw, Br3c8 ≠ se, Br3c8 ≠ ew, Br3c8 ≠ sw, Br3c9 ≠ nw, Br3c9 ≠ se, Br3c9 ≠ swn, Br3c9 ≠ wne, Br3c9 ≠ nes
B-single: Br3c8 = ne
P-single: Pr3c8 = ew
whip[1]: Pr3c8{ew .} ==> Br3c7 ≠ ne, Br2c7 ≠ ne, Br2c7 ≠ w, Br2c7 ≠ e, Br2c7 ≠ n, Br2c7 ≠ o, Br2c7 ≠ nw, Br2c7 ≠ se, Br2c7 ≠ ew, Br2c7 ≠ esw, Br2c7 ≠ wne, Br2c7 ≠ nes, Br2c8 ≠ sw, Br2c8 ≠ swn, Br3c7 ≠ se, Br3c7 ≠ ew, Br3c7 ≠ sw
whip[1]: Br2c8{ns .} ==> Pr2c8 ≠ ns, Pr2c9 ≠ ns, Pr2c9 ≠ se, Nr2c8 ≠ 0, Nr2c8 ≠ 3, Pr2c8 ≠ sw, Pr2c9 ≠ sw
whip[1]: Pr2c8{ew .} ==> Br1c7 ≠ esw, Br1c7 ≠ nes, Br1c8 ≠ nw, Br1c8 ≠ ew, Br1c8 ≠ wne, Br1c8 ≠ o, Br1c8 ≠ n, Br1c8 ≠ e, Br1c8 ≠ w, Br1c8 ≠ ne, Br2c8 ≠ s
B-single: Br2c8 = ns
N-single: Nr2c8 = 2
whip[1]: Pr2c9{ew .} ==> Br1c9 ≠ sw, Br1c9 ≠ esw, Br1c9 ≠ swn, Br1c9 ≠ o, Br1c9 ≠ n, Br1c9 ≠ e, Br1c9 ≠ ne
whip[1]: Br1c9{nes .} ==> Nr1c9 ≠ 0
whip[1]: Br1c8{nes .} ==> Nr1c8 ≠ 0
whip[1]: Br1c7{wne .} ==> Pr1c7 ≠ ew, Pr1c8 ≠ o, Pr1c8 ≠ se, Pr2c7 ≠ ew
P-single: Pr2c7 = ns
P-single: Pr1c7 = se
whip[1]: Pr2c7{ns .} ==> Br2c6 ≠ n, Br2c6 ≠ o, Br1c6 ≠ ns, Br1c6 ≠ nw, Br1c6 ≠ se, Br1c6 ≠ sw, Br1c7 ≠ swn, Br2c6 ≠ s, Br2c6 ≠ w, Br2c6 ≠ ne, Br2c6 ≠ ns, Br2c6 ≠ nw, Br2c6 ≠ sw, Br2c6 ≠ swn, Br2c6 ≠ wne, Br2c6 ≠ nes, Br2c7 ≠ s, Br2c7 ≠ ns, Br2c7 ≠ swn
B-single: Br2c7 = sw
N-single: Nr2c7 = 2
P-single: Pr2c8 = ne
B-single: Br1c7 = wne
P-single: Pr1c8 = sw
whip[1]: Pr2c8{ne .} ==> Br1c8 ≠ s, Br1c8 ≠ ns, Br1c8 ≠ se, Br1c8 ≠ nes
whip[1]: Br1c8{swn .} ==> Pr1c9 ≠ sw, Nr1c8 ≠ 1
whip[1]: Pr1c9{ew .} ==> Br1c9 ≠ ew, Br1c9 ≠ w
whip[1]: Pr1c8{sw .} ==> Br1c8 ≠ swn
whip[1]: Br1c8{esw .} ==> Pr1c9 ≠ ew
whip[1]: Pr1c9{se .} ==> Br1c9 ≠ ns, Br1c9 ≠ nes
whip[1]: Br2c6{esw .} ==> Pr2c6 ≠ se, Pr2c6 ≠ ew, Nr2c6 ≠ 0
whip[1]: Pr2c6{nw .} ==> Vr1c6 ≠ 0, Br1c5 ≠ w, Br1c5 ≠ ns, Br1c5 ≠ nw, Br1c5 ≠ sw, Br1c5 ≠ swn, Br1c6 ≠ ne, Br2c5 ≠ w, Br2c5 ≠ ne, Br2c5 ≠ sw, Br2c5 ≠ wne, Br2c5 ≠ nes, Br1c5 ≠ o, Br1c5 ≠ n, Br1c5 ≠ s, Br2c5 ≠ o, Br2c5 ≠ s
V-single: Vr1c6 = 1
B-single: Br1c6 = ew
P-single: Pr1c6 = sw
H-single: Hr1c5 = 1
horizontal-line-{r0 r1}c5 ==> Ir1c5 = in
same-colour-in-{r1 r2}c5 ==> Hr2c5 = 0
different-colours-in-r1{c4 c5} ==> Hr1c5 = 1
whip[1]: Pr1c6{sw .} ==> Br1c5 ≠ e, Br1c5 ≠ se, Br1c5 ≠ ew, Br1c5 ≠ esw
whip[1]: Br1c5{nes .} ==> Pr1c5 ≠ o, Pr1c5 ≠ sw, Nr1c5 ≠ 0, Nr1c5 ≠ 1
whip[1]: Pr1c5{ew .} ==> Br1c4 ≠ sw, Br1c4 ≠ wne, Br1c4 ≠ nes, Br1c4 ≠ o, Br1c4 ≠ s, Br1c4 ≠ w, Br1c4 ≠ ne
whip[1]: Br1c4{swn .} ==> Nr1c4 ≠ 0
whip[1]: Hr1c5{1 .} ==> Br0c5 ≠ o
B-single: Br0c5 = s
whip[1]: Hr2c5{0 .} ==> Pr2c5 ≠ se, Pr2c5 ≠ ew, Pr2c6 ≠ nw, Br1c5 ≠ nes, Br2c5 ≠ n, Br2c5 ≠ ns, Br2c5 ≠ nw, Br2c5 ≠ swn
P-single: Pr2c6 = ns
whip[1]: Pr2c6{ns .} ==> Br2c6 ≠ e, Br2c6 ≠ se
whip[1]: Br2c6{esw .} ==> Nr2c6 ≠ 1
whip[1]: Br2c5{esw .} ==> Nr2c5 ≠ 0
whip[1]: Pr2c5{nw .} ==> Br1c4 ≠ ns, Br1c4 ≠ nw, Br1c4 ≠ swn, Br1c5 ≠ ne, Br2c4 ≠ ne, Br2c4 ≠ sw, Br1c4 ≠ n
B-single: Br1c5 = wne
N-single: Nr1c5 = 3
P-single: Pr1c5 = se
whip[1]: Br1c4{esw .} ==> Pr1c4 ≠ se, Pr1c4 ≠ ew
whip[1]: Pr1c4{sw .} ==> Br1c3 ≠ nw, Br1c3 ≠ se, Br1c3 ≠ ew, Br1c3 ≠ esw, Br1c3 ≠ swn, Br1c3 ≠ n, Br1c3 ≠ e, Br1c3 ≠ ns
whip[1]: Pr4c9{ns .} ==> Br4c8 ≠ ne, Br4c8 ≠ ns, Br4c8 ≠ nw, Br4c8 ≠ swn, Br4c8 ≠ wne, Br4c8 ≠ nes, Br4c9 ≠ s, Br4c8 ≠ n, Br4c9 ≠ e
whip[1]: Br4c9{w .} ==> Hr5c9 ≠ 1, Vr4c10 ≠ 1, Pr4c10 ≠ ns, Pr5c9 ≠ ne, Pr5c10 ≠ nw, Pr4c10 ≠ se, Pr4c10 ≠ sw, Pr5c9 ≠ se, Pr5c9 ≠ ew
V-single: Vr4c10 = 0
H-single: Hr5c9 = 0
w[1]-3-in-r3c10-isolated-at-sw-corner ==> Vr3c10 = 1
w[1]-3-in-r4c10-hit-by-verti-line-at-nw ==> Vr4c11 = 1
w[1]-3-in-r4c10-closed-se-corner ==> Pr4c10 ≠ nw, Pr4c10 ≠ o
w[1]-3-in-r4c10-closed-ne-corner ==> Pr5c10 ≠ o
w[1]-3-in-r3c10-closed-sw-corner ==> Pr3c11 ≠ sw, Pr3c11 ≠ o
w[1]-3-in-r3c10-closed-nw-corner ==> Pr4c11 ≠ nw, Pr4c11 ≠ o
w[1]-diagonal-closed-3-1-in-{r4c10...r5c9} ==> Vr5c9 = 0, Hr6c9 = 0
P-single: Pr5c10 = se
V-single: Vr5c10 = 1
w[1]-1-in-r5c9-asymmetric-ne-corner ==> Pr6c9 ≠ ew, Pr6c9 ≠ se, Pr6c9 ≠ nw, Pr6c9 ≠ ns
no-vertical-line-r3{c10 c11} ==> Ir3c10 = out
horizontal-line-{r2 r3}c10 ==> Ir2c10 = in
horizontal-line-{r3 r4}c10 ==> Ir4c10 = in
horizontal-line-{r4 r5}c10 ==> Ir5c10 = out
vertical-line-r5{c9 c10} ==> Ir5c9 = in
no-vertical-line-r5{c8 c9} ==> Ir5c8 = in
no-horizontal-line-{r5 r6}c9 ==> Ir6c9 = in
same-colour-in-r5{c7 c8} ==> Vr5c8 = 0
different-colours-in-{r4 r5}c8 ==> Hr5c8 = 1
different-colours-in-r2{c10 c11} ==> Hr2c11 = 1
w[1]-3-in-r1c10-hit-by-verti-line-at-se ==> Vr1c10 = 1
w[1]-3-in-r1c10-closed-nw-corner ==> Pr2c11 ≠ nw, Pr2c11 ≠ o
no-horizontal-line-{r0 r1}c9 ==> Ir1c9 = out
different-colours-in-{r1 r2}c9 ==> Hr2c9 = 1
same-colour-in-r1{c8 c9} ==> Vr1c9 = 0
whip[1]: Vr4c10{0 .} ==> Br4c10 ≠ esw, Br4c10 ≠ swn, Br4c10 ≠ wne
B-single: Br4c10 = nes
P-single: Pr4c11 = sw
P-single: Pr5c11 = nw
whip[1]: Pr4c11{sw .} ==> Br3c10 ≠ esw, Br3c10 ≠ wne, Br3c10 ≠ nes
B-single: Br3c10 = swn
P-single: Pr3c11 = nw
P-single: Pr3c10 = se
P-single: Pr4c10 = ne
w[1]-1-in-r4c9-symmetric-ne-corner ==> Pr5c9 ≠ sw, Pr5c9 ≠ o
whip[1]: Pr3c11{nw .} ==> Br2c10 ≠ s, Br2c10 ≠ e, Br2c10 ≠ n, Br2c10 ≠ o, Br2c10 ≠ w, Br2c10 ≠ ne, Br2c10 ≠ ns, Br2c10 ≠ nw, Br2c10 ≠ ew, Br2c10 ≠ sw, Br2c10 ≠ swn, Br2c10 ≠ wne
whip[1]: Br2c10{nes .} ==> Pr2c10 ≠ se, Nr2c10 ≠ 0, Nr2c10 ≠ 1
whip[1]: Pr2c10{ew .} ==> Br1c9 ≠ nw, Br2c9 ≠ o, Br2c9 ≠ ne
whip[1]: Br2c9{e .} ==> Nr2c9 ≠ 0, Nr2c9 ≠ 2, Nr2c9 ≠ 3
N-single: Nr2c9 = 1
w[1]-1-in-r2c9-symmetric-se-corner ==> Pr2c9 ≠ nw
P-single: Pr2c9 = ew
whip[1]: Pr2c9{ew .} ==> Br2c9 ≠ e, Br1c8 ≠ esw, Br1c9 ≠ wne
B-single: Br1c8 = sw
N-single: Nr1c8 = 2
P-single: Pr1c9 = o
B-single: Br2c9 = n
whip[1]: Pr2c10{ew .} ==> Br2c10 ≠ esw
whip[1]: Br1c9{se .} ==> Pr1c10 ≠ ew, Pr1c10 ≠ sw, Nr1c9 ≠ 3
whip[1]: Pr1c10{se .} ==> Br1c10 ≠ nes
B-single: Br1c10 = wne
P-single: Pr1c11 = sw
P-single: Pr1c10 = se
P-single: Pr2c11 = ns
P-single: Pr2c10 = nw
whip[1]: Pr1c10{se .} ==> Br1c9 ≠ s
B-single: Br1c9 = se
N-single: Nr1c9 = 2
whip[1]: Pr2c11{ns .} ==> Br2c10 ≠ nes
B-single: Br2c10 = se
N-single: Nr2c10 = 2
whip[1]: Pr3c10{se .} ==> Br3c9 ≠ w, Br3c9 ≠ sw
whip[1]: Br3c9{esw .} ==> Nr3c9 ≠ 0, Nr3c9 ≠ 1
whip[1]: Pr4c10{ne .} ==> Br4c9 ≠ n, Br3c9 ≠ esw
B-single: Br3c9 = ew
N-single: Nr3c9 = 2
P-single: Pr4c9 = ns
B-single: Br4c9 = w
whip[1]: Pr4c9{ns .} ==> Br4c8 ≠ o, Br4c8 ≠ s, Br4c8 ≠ w, Br4c8 ≠ sw
whip[1]: Br4c8{esw .} ==> Nr4c8 ≠ 0
whip[1]: Pr5c9{nw .} ==> Br5c8 ≠ w, Br5c8 ≠ ne, Br5c8 ≠ sw, Br5c8 ≠ wne, Br5c8 ≠ nes, Br5c8 ≠ o, Br5c8 ≠ s, Br5c9 ≠ n
whip[1]: Br5c9{w .} ==> Pr6c9 ≠ ne, Pr6c10 ≠ nw
whip[1]: Pr6c9{sw .} ==> Br5c8 ≠ se, Br5c8 ≠ ew, Br5c8 ≠ esw, Br6c8 ≠ nw, Br6c8 ≠ se, Br6c8 ≠ ew, Br6c8 ≠ esw, Br6c8 ≠ swn, Br6c9 ≠ nw, Br6c9 ≠ swn, Br6c9 ≠ wne, Br6c9 ≠ nes, Br5c8 ≠ e, Br5c9 ≠ s, Br5c9 ≠ w, Br6c8 ≠ n, Br6c8 ≠ e, Br6c8 ≠ ns, Br6c9 ≠ n, Br6c9 ≠ ne, Br6c9 ≠ ns
B-single: Br5c9 = e
P-single: Pr5c9 = nw
whip[1]: Pr5c9{nw .} ==> Br4c8 ≠ e, Br4c8 ≠ ew
whip[1]: Br4c8{esw .} ==> Pr5c8 ≠ ns, Nr4c8 ≠ 1
P-single: Pr5c8 = ne
whip[1]: Pr5c8{ne .} ==> Br4c8 ≠ se, Br5c7 ≠ e, Br5c7 ≠ se, Br5c7 ≠ ew, Br5c7 ≠ esw, Br5c8 ≠ nw, Br5c8 ≠ swn
B-single: Br4c8 = esw
N-single: Nr4c8 = 3
whip[1]: Br5c8{ns .} ==> Pr6c8 ≠ ne, Pr6c8 ≠ ns, Pr6c8 ≠ nw, Nr5c8 ≠ 0, Nr5c8 ≠ 3
whip[1]: Br5c7{sw .} ==> Nr5c7 ≠ 3
whip[1]: Pr6c10{ns .} ==> Br5c10 ≠ s, Br5c10 ≠ ne, Br5c10 ≠ ns, Br5c10 ≠ se, Br5c10 ≠ nes, Br6c10 ≠ s, Br6c10 ≠ nw, Br6c10 ≠ se, Br6c10 ≠ swn, Br6c10 ≠ wne, Br5c10 ≠ o, Br5c10 ≠ n, Br5c10 ≠ e, Br6c10 ≠ o, Br6c10 ≠ e
whip[1]: Br6c10{nes .} ==> Nr6c10 ≠ 0
whip[1]: Br5c10{wne .} ==> Nr5c10 ≠ 0
whip[1]: Pr5c11{nw .} ==> Br5c10 ≠ w, Br5c10 ≠ ew, Br5c10 ≠ sw, Br5c10 ≠ esw, Br5c10 ≠ wne
whip[1]: Br5c10{swn .} ==> Pr6c11 ≠ ns, Pr6c11 ≠ nw, Nr5c10 ≠ 1
whip[1]: Pr6c11{sw .} ==> Br6c10 ≠ ew, Br6c10 ≠ esw, Br6c10 ≠ n, Br6c10 ≠ ns
whip[1]: Vr4c11{1 .} ==> Br4c11 ≠ o
B-single: Br4c11 = w
whip[1]: Vr5c11{0 .} ==> Br5c11 ≠ w
B-single: Br5c11 = o
whip[1]: Vr3c11{0 .} ==> Br3c11 ≠ w
B-single: Br3c11 = o
whip[1]: Vr2c11{1 .} ==> Br2c11 ≠ o
B-single: Br2c11 = w
whip[1]: Hr1c9{0 .} ==> Br0c9 ≠ s
B-single: Br0c9 = o
whip[1]: Pr4c8{sw .} ==> Br3c7 ≠ nw
B-single: Br3c7 = ns
whip[1]: Pr5c7{nw .} ==> Br4c6 ≠ w, Br4c6 ≠ ns, Br4c6 ≠ nw, Br4c6 ≠ sw, Br4c6 ≠ swn, Br5c6 ≠ ne, Br5c6 ≠ sw, Br4c6 ≠ o, Br4c6 ≠ n, Br4c6 ≠ s
whip[1]: Br4c6{nes .} ==> Nr4c6 ≠ 0
whip[1]: Hr1c3{0 .} ==> Br1c3 ≠ nes, Br0c3 ≠ s, Pr1c3 ≠ se, Pr1c3 ≠ ew, Pr1c4 ≠ sw, Br1c3 ≠ ne, Br1c3 ≠ wne
P-single: Pr1c4 = o
B-single: Br0c3 = o
whip[1]: Pr1c4{o .} ==> Br1c4 ≠ ew, Br1c4 ≠ esw
whip[1]: Br1c4{se .} ==> Pr2c4 ≠ ne, Pr2c4 ≠ ns, Nr1c4 ≠ 3
whip[1]: Pr2c4{sw .} ==> Br2c3 ≠ sw, Br2c4 ≠ se, Br2c3 ≠ o, Br2c3 ≠ s, Br2c3 ≠ w
whip[1]: Br2c3{nes .} ==> Nr2c3 ≠ 0
whip[1]: Br1c3{sw .} ==> Nr1c3 ≠ 3
whip[1]: Pr1c3{sw .} ==> Br1c2 ≠ nw, Br1c2 ≠ se, Br1c2 ≠ ew, Br1c2 ≠ esw, Br1c2 ≠ swn, Br1c2 ≠ n, Br1c2 ≠ e, Br1c2 ≠ ns
whip[1]: Hr1c4{0 .} ==> Br0c4 ≠ s
B-single: Br0c4 = o
whip[1]: Vr7c4{0 .} ==> Br7c4 ≠ wne, Pr7c4 ≠ sw, Pr8c4 ≠ ne, Pr8c4 ≠ ns, Pr8c4 ≠ nw, Br7c3 ≠ e, Br7c3 ≠ ne, Br7c3 ≠ se, Br7c3 ≠ ew, Br7c3 ≠ esw, Br7c3 ≠ wne, Br7c3 ≠ nes, Br7c4 ≠ w, Br7c4 ≠ nw, Br7c4 ≠ ew, Br7c4 ≠ sw, Br7c4 ≠ esw, Br7c4 ≠ swn
P-single: Pr7c4 = o
whip[1]: Pr7c4{o .} ==> Br6c3 ≠ e, Br6c3 ≠ s, Br6c3 ≠ ne, Br6c3 ≠ ns, Br6c3 ≠ se, Br6c3 ≠ ew, Br6c3 ≠ sw, Br6c3 ≠ esw, Br6c3 ≠ swn, Br6c3 ≠ wne, Br6c3 ≠ nes, Br7c3 ≠ n, Br7c3 ≠ ns, Br7c3 ≠ nw, Br7c3 ≠ swn, Br7c4 ≠ n, Br7c4 ≠ ne, Br7c4 ≠ ns, Br7c4 ≠ nes
whip[1]: Br7c4{se .} ==> Nr7c4 ≠ 3
whip[1]: Br7c3{sw .} ==> Pr7c3 ≠ se, Pr7c3 ≠ ew, Nr7c3 ≠ 3
whip[1]: Pr7c3{nw .} ==> Br6c2 ≠ swn, Br7c2 ≠ ne, Br7c2 ≠ sw, Br6c3 ≠ o, Br6c3 ≠ n
whip[1]: Br6c3{nw .} ==> Pr6c3 ≠ nw, Pr6c3 ≠ ew, Nr6c3 ≠ 0, Nr6c3 ≠ 3
whip[1]: Pr6c3{se .} ==> Br5c2 ≠ ns, Br5c2 ≠ sw, Br5c2 ≠ esw, Br5c2 ≠ swn, Br5c2 ≠ nes, Br5c3 ≠ ne, Br5c3 ≠ sw, Br5c3 ≠ esw, Br5c3 ≠ swn, Br6c2 ≠ wne, Br6c2 ≠ nes, Br5c3 ≠ o, Br5c3 ≠ n, Br5c3 ≠ e
B-single: Br6c2 = esw
P-single: Pr7c2 = ne
P-single: Pr7c3 = nw
whip[1]: Pr7c2{ne .} ==> Br6c1 ≠ esw, Br6c1 ≠ swn, Br6c1 ≠ nes, Br7c1 ≠ nw, Br7c1 ≠ ew, Br7c1 ≠ esw, Br7c1 ≠ swn, Br7c1 ≠ wne, Br7c2 ≠ nw, Br7c2 ≠ se, Br7c2 ≠ ew
B-single: Br7c2 = ns
B-single: Br6c1 = wne
P-single: Pr6c1 = se
P-single: Pr7c1 = ns
P-single: Pr6c2 = sw
whip[1]: Pr6c1{se .} ==> Br5c1 ≠ nw, Br5c1 ≠ ew
whip[1]: Br5c1{se .} ==> Pr5c1 ≠ ns
P-single: Pr4c1 = ns
H-single: Hr4c1 = 0
V-single: Vr3c1 = 1
P-single: Pr5c1 = ne
vertical-line-r3{c0 c1} ==> Ir3c1 = in
whip[1]: Pr4c1{ns .} ==> Br3c1 ≠ s, Br3c1 ≠ ns, Br3c1 ≠ se, Br3c1 ≠ nes, Br4c1 ≠ nw
whip[1]: Br3c1{wne .} ==> Pr3c1 ≠ o, Pr3c1 ≠ ne
whip[1]: Pr3c1{se .} ==> Br2c1 ≠ ne, Br2c1 ≠ sw, Br2c1 ≠ esw, Br2c1 ≠ swn, Br2c1 ≠ o, Br2c1 ≠ n, Br2c1 ≠ e
whip[1]: Br2c1{nes .} ==> Nr2c1 ≠ 0
whip[1]: Vr3c1{1 .} ==> Br3c0 ≠ o
B-single: Br3c0 = e
whip[1]: Pr5c1{ne .} ==> Br4c1 ≠ ew, Br5c1 ≠ se
B-single: Br5c1 = ns
P-single: Pr5c2 = ew
H-single: Hr5c2 = 1
V-single: Vr4c2 = 0
B-single: Br4c1 = sw
no-vertical-line-r4{c1 c2} ==> Ir4c2 = in
same-colour-in-r4{c2 c3} ==> Vr4c3 = 0
P-single: Pr4c2 = ne
H-single: Hr4c2 = 1
V-single: Vr3c2 = 1
vertical-line-r3{c1 c2} ==> Ir3c2 = out
whip[1]: Pr5c2{ew .} ==> Br5c2 ≠ w, Br4c2 ≠ nw, Br4c2 ≠ ew, Br5c2 ≠ nw, Br5c2 ≠ ew, Br5c2 ≠ wne
whip[1]: Br5c2{ne .} ==> Pr5c3 ≠ ne, Pr5c3 ≠ ns, Nr5c2 ≠ 3
whip[1]: Pr5c3{sw .} ==> Br4c2 ≠ se, Br4c3 ≠ nw, Br4c3 ≠ ew, Br4c3 ≠ sw, Br4c3 ≠ esw, Br4c3 ≠ swn, Br4c3 ≠ wne, Br5c3 ≠ nw, Br5c3 ≠ se, Br5c3 ≠ wne, Br4c3 ≠ w, Br5c3 ≠ s
B-single: Br4c2 = ns
P-single: Pr4c3 = ew
H-single: Hr4c3 = 1
V-single: Vr3c3 = 0
no-vertical-line-r3{c2 c3} ==> Ir3c3 = out
different-colours-in-r3{c3 c4} ==> Hr3c4 = 1
same-colour-in-{r2 r3}c3 ==> Hr3c3 = 0
whip[1]: Pr4c3{ew .} ==> Br4c3 ≠ s, Br4c3 ≠ e, Br4c3 ≠ o, Br3c3 ≠ ne, Br3c3 ≠ w, Br3c3 ≠ e, Br3c3 ≠ n, Br3c3 ≠ o, Br3c2 ≠ ne, Br3c2 ≠ nw, Br3c2 ≠ se, Br3c2 ≠ ew, Br3c3 ≠ nw, Br3c3 ≠ ew, Br3c3 ≠ sw, Br3c3 ≠ esw, Br3c3 ≠ swn, Br3c3 ≠ wne, Br4c3 ≠ se
whip[1]: Br4c3{nes .} ==> Pr4c4 ≠ o, Nr4c3 ≠ 0
P-single: Pr4c4 = nw
whip[1]: Pr4c4{nw .} ==> Br3c4 ≠ s, Br3c4 ≠ e, Br3c4 ≠ n, Br3c4 ≠ o, Br3c3 ≠ s, Br3c3 ≠ ns, Br3c4 ≠ ne, Br3c4 ≠ ns, Br3c4 ≠ se, Br3c4 ≠ sw, Br3c4 ≠ esw, Br3c4 ≠ swn, Br3c4 ≠ nes, Br4c3 ≠ ne, Br4c3 ≠ nes
whip[1]: Br4c3{ns .} ==> Nr4c3 ≠ 3
whip[1]: Br3c4{wne .} ==> Pr3c4 ≠ nw, Pr3c4 ≠ ew, Nr3c4 ≠ 0
whip[1]: Pr3c4{se .} ==> Br2c3 ≠ ns, Br2c3 ≠ se, Br2c3 ≠ esw, Br2c3 ≠ swn, Br2c3 ≠ nes, Br3c3 ≠ nes
B-single: Br3c3 = se
N-single: Nr3c3 = 2
P-single: Pr3c3 = o
H-single: Hr3c2 = 0
V-single: Vr2c3 = 0
w[1]-2-in-r2c2-open-se-corner ==> Hr2c2 = 1, Vr2c2 = 1, Hr2c1 = 0, Vr1c2 = 0
P-single: Pr2c2 = se
no-vertical-line-r2{c2 c3} ==> Ir2c2 = out
vertical-line-r2{c1 c2} ==> Ir2c1 = in
no-horizontal-line-{r1 r2}c1 ==> Ir1c1 = in
no-vertical-line-r1{c1 c2} ==> Ir1c2 = in
different-colours-in-r1{c2 c3} ==> Hr1c3 = 1
different-colours-in-{r0 r1}c2 ==> Hr1c2 = 1
different-colours-in-r1{c0 c1} ==> Hr1c1 = 1
different-colours-in-{r0 r1}c1 ==> Hr1c1 = 1
same-colour-in-{r2 r3}c1 ==> Hr3c1 = 0
different-colours-in-r2{c0 c1} ==> Hr2c1 = 1
whip[1]: Pr3c3{o .} ==> Br2c2 ≠ ne, Br2c2 ≠ ns, Br2c2 ≠ se, Br2c2 ≠ ew, Br2c2 ≠ sw, Br2c3 ≠ nw, Br2c3 ≠ ew, Br2c3 ≠ wne, Br3c2 ≠ ns
B-single: Br3c2 = sw
P-single: Pr3c2 = ns
B-single: Br2c2 = nw
whip[1]: Pr3c2{ns .} ==> Br2c1 ≠ s, Br2c1 ≠ w, Br2c1 ≠ ns, Br2c1 ≠ nw, Br2c1 ≠ se, Br2c1 ≠ nes, Br3c1 ≠ w, Br3c1 ≠ nw, Br3c1 ≠ wne
B-single: Br3c1 = ew
N-single: Nr3c1 = 2
P-single: Pr3c1 = ns
whip[1]: Br2c1{wne .} ==> Pr2c1 ≠ o, Pr2c1 ≠ ne, Nr2c1 ≠ 1
whip[1]: Pr2c1{se .} ==> Br1c1 ≠ swn, Br1c1 ≠ o, Br1c1 ≠ e
whip[1]: Br1c1{wne .} ==> Nr1c1 ≠ 0
whip[1]: Pr2c3{ew .} ==> Br1c2 ≠ wne, Br1c3 ≠ sw, Br1c2 ≠ o, Br1c2 ≠ w, Br1c2 ≠ ne, Br1c3 ≠ o
whip[1]: Br1c3{w .} ==> Nr1c3 ≠ 0, Nr1c3 ≠ 2
N-single: Nr1c3 = 1
whip[1]: Br1c2{nes .} ==> Pr1c2 ≠ se, Nr1c2 ≠ 0
whip[1]: Pr1c2{sw .} ==> Br1c1 ≠ se
whip[1]: Br2c3{ne .} ==> Nr2c3 ≠ 3
whip[1]: Hr2c1{0 .} ==> Pr2c1 ≠ se, Br1c1 ≠ s, Br2c1 ≠ wne
P-single: Pr2c1 = ns
B-single: Br2c1 = ew
N-single: Nr2c1 = 2
whip[1]: Br1c1{wne .} ==> Pr1c1 ≠ o, Pr1c2 ≠ o, Nr1c1 ≠ 1
P-single: Pr1c1 = se
whip[1]: Pr1c2{sw .} ==> Br1c2 ≠ s
whip[1]: Br1c2{nes .} ==> Nr1c2 ≠ 1
whip[1]: Vr1c2{0 .} ==> Pr1c2 ≠ sw, Br1c1 ≠ wne, Br1c2 ≠ sw
P-single: Pr1c2 = ew
B-single: Br1c2 = nes
N-single: Nr1c2 = 3
P-single: Pr1c3 = sw
P-single: Pr2c3 = nw
B-single: Br1c1 = nw
N-single: Nr1c1 = 2
w[1]-1-in-r1c3-asymmetric-nw-corner ==> Pr2c4 ≠ sw, Pr2c4 ≠ ew
P-single: Pr2c4 = se
whip[1]: Pr1c3{sw .} ==> Br1c3 ≠ s
B-single: Br1c3 = w
whip[1]: Pr2c3{nw .} ==> Br2c3 ≠ n, Br2c3 ≠ ne
B-single: Br2c3 = e
N-single: Nr2c3 = 1
P-single: Pr3c4 = ns
whip[1]: Pr3c4{ns .} ==> Br2c4 ≠ ns, Br3c4 ≠ nw, Br3c4 ≠ wne
whip[1]: Br3c4{ew .} ==> Nr3c4 ≠ 3
whip[1]: Pr2c4{se .} ==> Br1c4 ≠ e, Br2c4 ≠ ew
B-single: Br2c4 = nw
P-single: Pr2c5 = nw
B-single: Br1c4 = se
N-single: Nr1c4 = 2
whip[1]: Pr2c5{nw .} ==> Br2c5 ≠ ew, Br2c5 ≠ esw
whip[1]: Br2c5{se .} ==> Nr2c5 ≠ 3
whip[1]: Pr3c5{se .} ==> Br3c5 ≠ esw, Br3c5 ≠ nes
whip[1]: Br3c5{wne .} ==> Pr3c5 ≠ o, Pr4c5 ≠ o
P-single: Pr4c5 = ne
P-single: Pr3c5 = se
whip[1]: Pr4c5{ne .} ==> Br4c5 ≠ o, Br3c4 ≠ w, Br3c5 ≠ wne, Br4c5 ≠ e, Br4c5 ≠ s, Br4c5 ≠ w, Br4c5 ≠ nw, Br4c5 ≠ se, Br4c5 ≠ ew, Br4c5 ≠ sw, Br4c5 ≠ esw, Br4c5 ≠ swn, Br4c5 ≠ wne
B-single: Br3c5 = swn
B-single: Br3c4 = ew
N-single: Nr3c4 = 2
whip[1]: Br4c5{nes .} ==> Nr4c5 ≠ 0
whip[1]: Pr3c5{se .} ==> Br2c5 ≠ e
B-single: Br2c5 = se
N-single: Nr2c5 = 2
whip[1]: Hr1c2{1 .} ==> Br0c2 ≠ o
B-single: Br0c2 = s
whip[1]: Vr1c1{1 .} ==> Br1c0 ≠ o
B-single: Br1c0 = e
whip[1]: Hr1c1{1 .} ==> Br0c1 ≠ o
B-single: Br0c1 = s
whip[1]: Vr2c1{1 .} ==> Br2c0 ≠ o
B-single: Br2c0 = e
whip[1]: Br5c3{nes .} ==> Nr5c3 ≠ 0
whip[1]: Pr8c2{ew .} ==> Br8c1 ≠ sw, Br8c1 ≠ nes, Br8c2 ≠ se, Br8c2 ≠ ew, Br8c2 ≠ sw, Br8c2 ≠ esw, Br8c1 ≠ w, Br8c1 ≠ ne, Br8c2 ≠ o, Br8c2 ≠ e, Br8c2 ≠ s, Br8c2 ≠ w
whip[1]: Br8c2{nes .} ==> Nr8c2 ≠ 0
whip[1]: Pr8c3{sw .} ==> Br7c3 ≠ sw, Br8c3 ≠ nw, Br8c3 ≠ se, Br8c3 ≠ swn, Br8c3 ≠ wne, Br7c3 ≠ w, Br8c3 ≠ o, Br8c3 ≠ e, Br8c3 ≠ s
whip[1]: Br8c3{nes .} ==> Nr8c3 ≠ 0
whip[1]: Br7c3{s .} ==> Nr7c3 ≠ 2
whip[1]: Br7c1{sw .} ==> Nr7c1 ≠ 3
whip[1]: Hr10c8{0 .} ==> Br10c8 ≠ nes, Pr10c8 ≠ se, Pr10c8 ≠ ew, Pr10c9 ≠ ew, Pr10c9 ≠ sw, Br9c8 ≠ esw, Br9c8 ≠ swn, Br9c8 ≠ nes, Br10c8 ≠ n, Br10c8 ≠ ne, Br10c8 ≠ ns, Br10c8 ≠ nw, Br10c8 ≠ swn, Br10c8 ≠ wne
B-single: Br9c8 = wne
P-single: Pr9c8 = se
P-single: Pr9c9 = sw
whip[1]: Pr9c8{se .} ==> Br9c7 ≠ w, Br9c7 ≠ s, Br9c7 ≠ n, Br9c7 ≠ o, Br8c8 ≠ w, Br8c8 ≠ e, Br8c8 ≠ n, Br8c8 ≠ o, Br8c8 ≠ ne, Br8c8 ≠ nw, Br8c8 ≠ ew, Br8c8 ≠ sw, Br8c8 ≠ esw, Br8c8 ≠ swn, Br8c8 ≠ wne, Br9c7 ≠ ne, Br9c7 ≠ ns, Br9c7 ≠ nw, Br9c7 ≠ sw, Br9c7 ≠ swn, Br9c7 ≠ wne, Br9c7 ≠ nes
whip[1]: Br9c7{esw .} ==> Nr9c7 ≠ 0
whip[1]: Br8c8{nes .} ==> Nr8c8 ≠ 0
whip[1]: Pr9c9{sw .} ==> Br9c9 ≠ ns, Br9c9 ≠ ne, Br9c9 ≠ s, Br9c9 ≠ e, Br9c9 ≠ n, Br9c9 ≠ o, Br8c9 ≠ ns, Br8c9 ≠ w, Br8c9 ≠ s, Br8c8 ≠ se, Br8c8 ≠ nes, Br8c9 ≠ nw, Br8c9 ≠ se, Br8c9 ≠ ew, Br8c9 ≠ sw, Br8c9 ≠ esw, Br8c9 ≠ swn, Br8c9 ≠ wne, Br8c9 ≠ nes, Br9c9 ≠ nw, Br9c9 ≠ se, Br9c9 ≠ swn, Br9c9 ≠ wne, Br9c9 ≠ nes
whip[1]: Br9c9{esw .} ==> Pr9c10 ≠ nw, Pr9c10 ≠ ew, Pr9c10 ≠ sw, Nr9c9 ≠ 0
whip[1]: Br8c9{ne .} ==> Pr8c9 ≠ ns, Pr8c9 ≠ se, Nr8c9 ≠ 3, Pr8c9 ≠ sw
whip[1]: Br8c8{ns .} ==> Nr8c8 ≠ 3
whip[1]: Pr10c9{ns .} ==> Br10c9 ≠ s, Br10c9 ≠ nw, Br10c9 ≠ se, Br10c9 ≠ swn, Br10c9 ≠ wne, Br10c9 ≠ o, Br10c9 ≠ e
whip[1]: Br10c9{nes .} ==> Nr10c9 ≠ 0
whip[1]: Pr10c8{nw .} ==> Br10c7 ≠ ne, Br10c7 ≠ sw
whip[1]: Hr1c6{0 .} ==> Br0c6 ≠ s
B-single: Br0c6 = o
whip[1]: Hr6c7{0 .} ==> Br6c7 ≠ n, Pr6c7 ≠ ne, Pr6c7 ≠ ew, Pr6c8 ≠ ew, Pr6c8 ≠ sw, Br5c7 ≠ s, Br5c7 ≠ sw
whip[1]: Br5c7{w .} ==> Nr5c7 ≠ 2
whip[1]: Pr6c8{se .} ==> Br6c8 ≠ ne, Br6c8 ≠ sw, Br6c8 ≠ nes, Br6c8 ≠ w
whip[1]: Br6c8{wne .} ==> Pr7c8 ≠ ne, Pr7c9 ≠ nw, Nr6c8 ≠ 2
whip[1]: Pr6c7{sw .} ==> Br5c6 ≠ nw, Br6c6 ≠ sw, Br6c6 ≠ o, Br6c6 ≠ s, Br6c6 ≠ w
whip[1]: Br6c6{nes .} ==> Nr6c6 ≠ 0
whip[1]: Br6c7{w .} ==> Pr7c7 ≠ ne, Pr7c8 ≠ nw
whip[1]: Vr5c7{1 .} ==> Br5c6 ≠ ns, Br5c7 ≠ o, Pr5c7 ≠ nw, Pr6c7 ≠ sw
P-single: Pr5c7 = ns
B-single: Br5c7 = w
N-single: Nr5c7 = 1
whip[1]: Pr5c7{ns .} ==> Br4c6 ≠ se, Br4c6 ≠ esw, Br4c6 ≠ nes
whip[1]: Br4c6{wne .} ==> Pr5c6 ≠ ne, Pr5c6 ≠ ew
whip[1]: Pr6c7{nw .} ==> Br6c6 ≠ ne, Br6c6 ≠ wne, Br6c6 ≠ nes
whip[1]: Hr6c6{1 .} ==> Br6c6 ≠ esw, Pr6c6 ≠ ns, Pr6c6 ≠ nw, Pr6c7 ≠ ns, Br5c6 ≠ ew, Br6c6 ≠ e, Br6c6 ≠ se, Br6c6 ≠ ew
P-single: Pr6c7 = nw
B-single: Br5c6 = se
w[1]-1-in-r6c7-symmetric-nw-corner ==> Pr7c8 ≠ se, Pr7c8 ≠ o
whip[1]: Pr6c7{nw .} ==> Br6c7 ≠ w
whip[1]: Br6c7{s .} ==> Pr7c7 ≠ ns, Pr7c7 ≠ nw
whip[1]: Pr7c8{sw .} ==> Br7c7 ≠ sw, Br7c8 ≠ nw, Br7c8 ≠ se, Br7c8 ≠ swn, Br7c8 ≠ wne, Br7c7 ≠ o, Br7c7 ≠ s, Br7c7 ≠ w, Br7c8 ≠ o, Br7c8 ≠ e, Br7c8 ≠ s
whip[1]: Br7c8{nes .} ==> Nr7c8 ≠ 0
whip[1]: Br7c7{nes .} ==> Nr7c7 ≠ 0
whip[1]: Pr5c6{nw .} ==> Br4c5 ≠ ne, Br4c5 ≠ ns, Br5c5 ≠ ne, Br5c5 ≠ se, Br5c5 ≠ ew, Br5c5 ≠ esw, Br5c5 ≠ wne, Br5c5 ≠ nes, Br5c5 ≠ e
whip[1]: Br4c5{nes .} ==> Nr4c5 ≠ 2
whip[1]: Pr6c6{ew .} ==> Br6c5 ≠ sw, Br6c5 ≠ ne
whip[1]: Hr5c5{1 .} ==> Br5c5 ≠ sw, Br5c5 ≠ o, Pr5c6 ≠ o, Br4c5 ≠ n, Br5c5 ≠ s, Br5c5 ≠ w
P-single: Pr5c6 = nw
B-single: Br4c5 = nes
N-single: Nr4c5 = 3
whip[1]: Pr5c6{nw .} ==> Br4c6 ≠ e, Br4c6 ≠ ne
whip[1]: Br4c6{wne .} ==> Nr4c6 ≠ 1
whip[1]: Br5c5{swn .} ==> Nr5c5 ≠ 0
whip[1]: Pr5c5{se .} ==> Br5c5 ≠ ns, Br5c5 ≠ n, Br5c4 ≠ ne, Br5c4 ≠ ns, Br5c4 ≠ nw, Br5c4 ≠ sw
whip[1]: Br5c5{swn .} ==> Nr5c5 ≠ 1
whip[1]: Hr5c3{1 .} ==> Br5c3 ≠ ew, Pr5c3 ≠ sw, Br4c3 ≠ n, Br5c3 ≠ w
P-single: Pr5c3 = ew
B-single: Br4c3 = ns
N-single: Nr4c3 = 2
whip[1]: Pr5c3{ew .} ==> Br5c2 ≠ ne
B-single: Br5c2 = n
N-single: Nr5c2 = 1
P-single: Pr6c3 = se
whip[1]: Pr6c3{se .} ==> Br6c3 ≠ w
B-single: Br6c3 = nw
N-single: Nr6c3 = 2
whip[1]: Br5c3{nes .} ==> Nr5c3 ≠ 1
whip[1]: Pr5c4{sw .} ==> Br5c4 ≠ se, Br5c3 ≠ ns
B-single: Br5c3 = nes
N-single: Nr5c3 = 3
B-single: Br5c4 = ew
whip[1]: Vr5c1{0 .} ==> Br5c0 ≠ e
B-single: Br5c0 = o
whip[1]: Pr6c5{ne .} ==> Br6c5 ≠ ew, Br5c5 ≠ nw, Br6c5 ≠ nw, Br6c5 ≠ se
B-single: Br6c5 = ns
P-single: Pr6c6 = ew
P-single: Pr7c6 = ew
B-single: Br5c5 = swn
N-single: Nr5c5 = 3
whip[1]: Pr6c6{ew .} ==> Br6c6 ≠ nw, Br6c6 ≠ swn
whip[1]: Br6c6{ns .} ==> Nr6c6 ≠ 3
whip[1]: Pr7c6{ew .} ==> Br7c5 ≠ ne, Br6c6 ≠ n, Br7c5 ≠ se, Br7c5 ≠ ew, Br7c5 ≠ sw, Br7c6 ≠ esw, Br7c6 ≠ swn, Br7c6 ≠ wne
B-single: Br7c6 = nes
P-single: Pr7c7 = sw
P-single: Pr8c7 = nw
B-single: Br6c6 = ns
N-single: Nr6c6 = 2
w[1]-1-in-r6c7-symmetric-sw-corner ==> Pr6c8 ≠ o
P-single: Pr6c8 = se
H-single: Hr6c8 = 1
V-single: Vr6c8 = 1
vertical-line-r6{c7 c8} ==> Ir6c8 = out
different-colours-in-r6{c8 c9} ==> Hr6c9 = 1
whip[1]: Pr7c7{sw .} ==> Br7c7 ≠ ns, Br7c7 ≠ ne, Br7c7 ≠ e, Br7c7 ≠ n, Br6c7 ≠ s, Br7c7 ≠ nw, Br7c7 ≠ se, Br7c7 ≠ swn, Br7c7 ≠ wne, Br7c7 ≠ nes
B-single: Br6c7 = e
P-single: Pr7c8 = ns
H-single: Hr7c8 = 0
V-single: Vr7c8 = 1
vertical-line-r7{c7 c8} ==> Ir7c8 = out
different-colours-in-{r7 r8}c8 ==> Hr8c8 = 1

LOOP[6]: Hr8c8-Vr7c8-Vr6c8-Hr6c8-Vr6c9- ==> Vr7c9 = 0
no-vertical-line-r7{c8 c9} ==> Ir7c9 = out
different-colours-in-{r7 r8}c9 ==> Hr8c9 = 1
w[1]-3-in-r8c10-hit-by-horiz-line-at-nw ==> Vr8c11 = 1, Hr9c10 = 1, Vr7c10 = 0
w[1]-3-in-r8c10-closed-se-corner ==> Pr8c10 ≠ se, Pr8c10 ≠ nw, Pr8c10 ≠ o
no-vertical-line-r9{c10 c11} ==> Ir9c10 = out
horizontal-line-{r8 r9}c10 ==> Ir8c10 = in
no-vertical-line-r7{c9 c10} ==> Ir7c10 = out
same-colour-in-r7{c10 c11} ==> Vr7c11 = 0
different-colours-in-{r7 r8}c10 ==> Hr8c10 = 1
w[1]-3-in-r8c10-closed-ne-corner ==> Pr9c10 ≠ ne, Pr9c10 ≠ o
same-colour-in-r8{c9 c10} ==> Vr8c10 = 0
different-colours-in-{r9 r10}c10 ==> Hr10c10 = 1
w[1]-3-in-r10c10-closed-ne-corner ==> Pr11c10 ≠ ne, Pr11c10 ≠ o
different-colours-in-r9{c9 c10} ==> Hr9c10 = 1
no-vertical-line-r10{c9 c10} ==> Ir10c9 = in
different-colours-in-{r10 r11}c9 ==> Hr11c9 = 1
different-colours-in-r10{c8 c9} ==> Hr10c9 = 1
different-colours-in-{r6 r7}c9 ==> Hr7c9 = 1
whip[1]: Pr7c8{ns .} ==> Br7c8 ≠ n, Br6c8 ≠ o, Br6c8 ≠ s, Br7c8 ≠ ne, Br7c8 ≠ ns, Br7c8 ≠ nes
B-single: Br6c8 = wne
N-single: Nr6c8 = 3
P-single: Pr6c9 = sw
whip[1]: Pr6c9{sw .} ==> Br6c9 ≠ s, Br6c9 ≠ e, Br6c9 ≠ o, Br5c8 ≠ n, Br6c9 ≠ se
B-single: Br5c8 = ns
N-single: Nr5c8 = 2
whip[1]: Br6c9{esw .} ==> Nr6c9 ≠ 0
whip[1]: Pr7c9{ns .} ==> Br7c9 ≠ s, Br7c9 ≠ nw, Br7c9 ≠ se, Br7c9 ≠ swn, Br7c9 ≠ wne, Br7c9 ≠ o, Br7c9 ≠ e
whip[1]: Br7c9{nes .} ==> Nr7c9 ≠ 0
whip[1]: Br7c8{esw .} ==> Pr8c8 ≠ o
P-single: Pr8c8 = ne
whip[1]: Pr8c8{ne .} ==> Br7c7 ≠ esw, Br7c8 ≠ w, Br7c8 ≠ ew, Br8c8 ≠ s
B-single: Br8c8 = ns
N-single: Nr8c8 = 2
B-single: Br7c7 = ew
N-single: Nr7c7 = 2
whip[1]: Pr8c9{ew .} ==> Br7c9 ≠ sw, Br7c9 ≠ esw, Br7c9 ≠ n, Br7c9 ≠ ne
whip[1]: Br7c8{esw .} ==> Nr7c8 ≠ 1
whip[1]: Vr7c9{0 .} ==> Pr7c9 ≠ ns, Pr8c9 ≠ nw, Br7c8 ≠ esw, Br7c9 ≠ w, Br7c9 ≠ ew
P-single: Pr8c9 = ew
P-single: Pr7c9 = ne
B-single: Br7c8 = sw
N-single: Nr7c8 = 2
whip[1]: Pr8c9{ew .} ==> Br8c9 ≠ e, Br8c9 ≠ o
whip[1]: Br8c9{ne .} ==> Pr8c10 ≠ ns, Nr8c9 ≠ 0
P-single: Pr8c10 = ew
whip[1]: Pr8c10{ew .} ==> Br8c9 ≠ ne, Br7c10 ≠ ne, Br7c9 ≠ nes, Br7c10 ≠ nw, Br7c10 ≠ ew, Br7c10 ≠ sw, Br8c10 ≠ esw, Br8c10 ≠ swn, Br8c10 ≠ wne
B-single: Br8c10 = nes
P-single: Pr8c11 = sw
P-single: Pr9c11 = nw
P-single: Pr9c10 = se
B-single: Br7c9 = ns
N-single: Nr7c9 = 2
P-single: Pr7c10 = ew
H-single: Hr7c10 = 1
V-single: Vr6c10 = 0
B-single: Br8c9 = n
N-single: Nr8c9 = 1
no-vertical-line-r6{c9 c10} ==> Ir6c10 = in
different-colours-in-r6{c10 c11} ==> Hr6c11 = 1
different-colours-in-{r5 r6}c10 ==> Hr6c10 = 1
whip[1]: Pr8c11{sw .} ==> Br7c10 ≠ se
B-single: Br7c10 = ns
P-single: Pr7c11 = nw
whip[1]: Pr7c11{nw .} ==> Br6c10 ≠ w, Br6c10 ≠ ne, Br6c10 ≠ sw
B-single: Br6c10 = nes
N-single: Nr6c10 = 3
P-single: Pr6c11 = sw
P-single: Pr6c10 = ne
whip[1]: Pr6c11{sw .} ==> Br5c10 ≠ nw
B-single: Br5c10 = swn
N-single: Nr5c10 = 3
whip[1]: Pr6c10{ne .} ==> Br6c9 ≠ ew, Br6c9 ≠ esw
whip[1]: Br6c9{sw .} ==> Nr6c9 ≠ 3
whip[1]: Pr9c11{nw .} ==> Br9c10 ≠ s, Br9c10 ≠ e, Br9c10 ≠ o, Br9c10 ≠ w, Br9c10 ≠ ne, Br9c10 ≠ se, Br9c10 ≠ ew, Br9c10 ≠ sw, Br9c10 ≠ esw, Br9c10 ≠ wne, Br9c10 ≠ nes
whip[1]: Br9c10{swn .} ==> Pr10c11 ≠ ns, Pr10c11 ≠ nw, Nr9c10 ≠ 0
whip[1]: Pr10c11{sw .} ==> Br10c10 ≠ esw
B-single: Br10c10 = nes
P-single: Pr11c11 = nw
P-single: Pr11c10 = ew
P-single: Pr10c11 = sw
whip[1]: Pr11c11{nw .} ==> Br11c10 ≠ o
B-single: Br11c10 = n
whip[1]: Pr11c10{ew .} ==> Br10c9 ≠ ne, Br10c9 ≠ w, Br10c9 ≠ n, Br11c9 ≠ o, Br10c9 ≠ ew, Br10c9 ≠ esw, Br10c9 ≠ nes
B-single: Br11c9 = n
whip[1]: Pr11c9{ew .} ==> Br10c8 ≠ se, Br10c8 ≠ esw, Br10c8 ≠ o, Br10c8 ≠ w
whip[1]: Br10c8{sw .} ==> Nr10c8 ≠ 0, Nr10c8 ≠ 3
whip[1]: Br10c9{sw .} ==> Nr10c9 ≠ 1, Nr10c9 ≠ 3
N-single: Nr10c9 = 2
whip[1]: Pr10c11{sw .} ==> Br9c10 ≠ n, Br9c10 ≠ nw
whip[1]: Br9c10{swn .} ==> Nr9c10 ≠ 1
whip[1]: Pr10c10{ew .} ==> Br9c9 ≠ esw, Br9c9 ≠ w
whip[1]: Br9c9{sw .} ==> Nr9c9 ≠ 1, Nr9c9 ≠ 3
N-single: Nr9c9 = 2
P-single: Pr10c9 = ns
whip[1]: Pr10c9{ns .} ==> Br9c9 ≠ sw, Br10c8 ≠ s, Br10c8 ≠ sw, Br10c9 ≠ ns
B-single: Br10c9 = sw
P-single: Pr11c9 = ne
P-single: Pr10c10 = ne
B-single: Br9c9 = ew
whip[1]: Pr11c9{ne .} ==> Br11c8 ≠ n
B-single: Br11c8 = o
P-single: Pr11c8 = nw
whip[1]: Pr11c8{nw .} ==> Br10c8 ≠ e, Br11c7 ≠ o, Br10c7 ≠ ns, Br10c7 ≠ nw, Br10c7 ≠ ew
B-single: Br10c7 = se
P-single: Pr10c8 = ns
B-single: Br11c7 = n
B-single: Br10c8 = ew
N-single: Nr10c8 = 2
whip[1]: Pr10c8{ns .} ==> Br9c7 ≠ se, Br9c7 ≠ esw
whip[1]: Br9c7{ew .} ==> Nr9c7 ≠ 3
whip[1]: Pr10c7{nw .} ==> Br9c6 ≠ swn, Br9c6 ≠ wne, Br10c6 ≠ ne, Br10c6 ≠ se, Br10c6 ≠ ew
whip[1]: Br9c6{nes .} ==> Pr9c7 ≠ o, Pr10c6 ≠ ns, Pr10c7 ≠ o
P-single: Pr10c7 = nw
P-single: Pr10c6 = ew
H-single: Hr10c5 = 1
V-single: Vr10c6 = 0
w[1]-3-in-r10c4-hit-by-horiz-line-at-ne ==> Vr10c4 = 1, Hr11c4 = 1, Vr9c5 = 0
w[1]-3-in-r10c4-closed-sw-corner ==> Pr10c5 ≠ sw, Pr10c5 ≠ ne, Pr10c5 ≠ o
w[1]-3-in-r8c4-isolated-at-se-corner ==> Vr8c5 = 1
w[1]-3-in-r8c4-closed-se-corner ==> Pr8c4 ≠ se, Pr8c4 ≠ o
P-single: Pr9c7 = sw
vertical-line-r8{c4 c5} ==> Ir8c4 = in
vertical-line-r8{c3 c4} ==> Ir8c3 = out
no-horizontal-line-{r8 r9}c3 ==> Ir9c3 = out
no-vertical-line-r9{c3 c4} ==> Ir9c4 = out
no-horizontal-line-{r10 r11}c3 ==> Ir10c3 = out
vertical-line-r10{c3 c4} ==> Ir10c4 = in
no-vertical-line-r10{c5 c6} ==> Ir10c5 = in
different-colours-in-{r10 r11}c5 ==> Hr11c5 = 1
w[1]-3-in-r10c4-hit-by-horiz-line-at-se ==> Hr10c4 = 1
w[1]-3-in-r10c4-closed-nw-corner ==> Pr11c5 ≠ nw, Pr11c5 ≠ o
same-colour-in-r10{c4 c5} ==> Vr10c5 = 0
same-colour-in-r8{c2 c3} ==> Vr8c3 = 0
different-colours-in-{r7 r8}c3 ==> Hr8c3 = 1

LOOP[108]: Hr8c2-Hr8c3-Vr8c4-Hr9c4-Vr8c5-Vr7c5-Hr7c5-Hr7c6-Vr7c7-Hr8c6-Vr8c6-Hr9c6-Vr9c7-Hr10c6-Hr10c5-Hr10c4-Vr10c4-Hr11c4-Hr11c5-Hr11c6-Hr11c7-Vr10c8-Vr9c8-Hr9c8-Vr9c9-Vr10c9-Hr11c9-Hr11c10-Vr10c11-Hr10c10-Vr9c10-Hr9c10-Vr8c11-Hr8c10-Hr8c9-Hr8c8-Vr7c8-Vr6c8-Hr6c8-Vr6c9-Hr7c9-Hr7c10-Vr6c11-Hr6c10-Vr5c10-Hr5c10-Vr4c11-Hr4c10-Vr3c10-Hr3c10-Vr2c11-Vr1c11-Hr1c10-Vr1c10-Hr2c9-Hr2c8-Vr1c8-Hr1c7-Vr1c7-Vr2c7-Hr3c7-Hr3c8-Vr3c9-Vr4c9-Hr5c8-Vr4c8-Hr4c7-Vr4c7-Vr5c7-Hr6c6-Hr6c5-Vr5c5-Hr5c5-Vr4c6-Hr4c5-Vr3c5-Hr3c5-Vr2c6-Vr1c6-Hr1c5-Vr1c5-Hr2c4-Vr2c4-Vr3c4-Hr4c3-Hr4c2-Vr3c2-Vr2c2-Hr2c2-Vr1c3-Hr1c2-Hr1c1-Vr1c1-Vr2c1-Vr3c1-Vr4c1-Hr5c1-Hr5c2-Hr5c3-Vr5c4-Hr6c3-Vr6c3-Hr7c2-Vr6c2-Hr6c1-Vr6c1-Vr7c1- ==> Hr8c1 = 0
no-horizontal-line-{r7 r8}c1 ==> Ir8c1 = in
different-colours-in-r8{c1 c2} ==> Hr8c2 = 1
different-colours-in-r8{c0 c1} ==> Hr8c1 = 1

LOOP[110]: Vr8c1-Vr7c1-Vr6c1-Hr6c1-Vr6c2-Hr7c2-Vr6c3-Hr6c3-Vr5c4-Hr5c3-Hr5c2-Hr5c1-Vr4c1-Vr3c1-Vr2c1-Vr1c1-Hr1c1-Hr1c2-Vr1c3-Hr2c2-Vr2c2-Vr3c2-Hr4c2-Hr4c3-Vr3c4-Vr2c4-Hr2c4-Vr1c5-Hr1c5-Vr1c6-Vr2c6-Hr3c5-Vr3c5-Hr4c5-Vr4c6-Hr5c5-Vr5c5-Hr6c5-Hr6c6-Vr5c7-Vr4c7-Hr4c7-Vr4c8-Hr5c8-Vr4c9-Vr3c9-Hr3c8-Hr3c7-Vr2c7-Vr1c7-Hr1c7-Vr1c8-Hr2c8-Hr2c9-Vr1c10-Hr1c10-Vr1c11-Vr2c11-Hr3c10-Vr3c10-Hr4c10-Vr4c11-Hr5c10-Vr5c10-Hr6c10-Vr6c11-Hr7c10-Hr7c9-Vr6c9-Hr6c8-Vr6c8-Vr7c8-Hr8c8-Hr8c9-Hr8c10-Vr8c11-Hr9c10-Vr9c10-Hr10c10-Vr10c11-Hr11c10-Hr11c9-Vr10c9-Vr9c9-Hr9c8-Vr9c8-Vr10c8-Hr11c7-Hr11c6-Hr11c5-Hr11c4-Vr10c4-Hr10c4-Hr10c5-Hr10c6-Vr9c7-Hr9c6-Vr8c6-Hr8c6-Vr7c7-Hr7c6-Hr7c5-Vr7c5-Vr8c5-Hr9c4-Vr8c4-Hr8c3-Hr8c2-Vr8c2- ==> Hr9c1 = 0
no-horizontal-line-{r8 r9}c1 ==> Ir9c1 = in
different-colours-in-r9{c0 c1} ==> Hr9c1 = 1
whip[1]: Pr10c7{nw .} ==> Br9c7 ≠ e, Br10c6 ≠ sw
B-single: Br9c7 = ew
N-single: Nr9c7 = 2
whip[1]: Pr10c6{ew .} ==> Br10c5 ≠ ne, Br10c5 ≠ w, Br10c5 ≠ s, Br10c5 ≠ e, Br10c5 ≠ o, Br9c5 ≠ ne, Br9c5 ≠ w, Br9c5 ≠ e, Br9c5 ≠ n, Br9c5 ≠ o, Br9c5 ≠ nw, Br9c5 ≠ se, Br9c5 ≠ ew, Br9c5 ≠ esw, Br9c5 ≠ wne, Br9c5 ≠ nes, Br9c6 ≠ esw, Br10c5 ≠ se, Br10c5 ≠ ew, Br10c5 ≠ sw, Br10c5 ≠ esw, Br10c5 ≠ wne, Br10c5 ≠ nes, Br10c6 ≠ nw
B-single: Br10c6 = ns
P-single: Pr11c6 = ew
B-single: Br9c6 = nes
whip[1]: Pr11c6{ew .} ==> Br10c5 ≠ n, Br11c6 ≠ o, Br11c5 ≠ o, Br10c5 ≠ nw
B-single: Br11c5 = n
B-single: Br11c6 = n
whip[1]: Br10c5{swn .} ==> Pr10c5 ≠ ns, Pr10c5 ≠ nw, Nr10c5 ≠ 0, Nr10c5 ≠ 1
whip[1]: Pr10c5{ew .} ==> Br9c4 ≠ se, Br9c4 ≠ ew, Br9c4 ≠ esw, Br9c4 ≠ wne, Br9c4 ≠ nes, Br9c5 ≠ sw, Br9c5 ≠ swn, Br10c4 ≠ wne, Br10c4 ≠ nes, Br9c4 ≠ e, Br9c4 ≠ ne
whip[1]: Br9c4{swn .} ==> Pr9c5 ≠ ns, Pr9c5 ≠ se, Pr9c5 ≠ sw
whip[1]: Br10c4{swn .} ==> Pr11c4 ≠ ew, Pr11c5 ≠ ne, Pr10c4 ≠ nw, Pr10c4 ≠ ew
P-single: Pr11c5 = ew
P-single: Pr11c4 = ne
whip[1]: Pr11c5{ew .} ==> Br11c4 ≠ o, Br10c4 ≠ esw, Br10c5 ≠ swn
B-single: Br10c5 = ns
N-single: Nr10c5 = 2
P-single: Pr10c5 = ew
B-single: Br10c4 = swn
P-single: Pr10c4 = se
B-single: Br11c4 = n
whip[1]: Pr10c5{ew .} ==> Br9c4 ≠ w, Br9c4 ≠ n, Br9c4 ≠ o, Br9c4 ≠ nw
whip[1]: Br9c4{swn .} ==> Nr9c4 ≠ 0
whip[1]: Pr10c4{se .} ==> Br9c3 ≠ s, Br9c3 ≠ e, Br9c3 ≠ ne, Br9c3 ≠ ns, Br9c3 ≠ se, Br9c3 ≠ ew, Br9c3 ≠ sw, Br9c3 ≠ esw, Br9c3 ≠ swn, Br9c3 ≠ wne, Br9c3 ≠ nes, Br9c4 ≠ sw, Br9c4 ≠ swn, Br10c3 ≠ ne, Br10c3 ≠ ns, Br10c3 ≠ nw, Br10c3 ≠ sw
whip[1]: Br10c3{ew .} ==> Pr10c3 ≠ ne, Pr10c3 ≠ ew
whip[1]: Pr10c3{sw .} ==> Vr10c3 ≠ 0, Br9c2 ≠ nw, Br9c2 ≠ se, Br9c2 ≠ esw, Br9c2 ≠ nes, Br10c2 ≠ nw, Br10c2 ≠ sw, Br10c2 ≠ swn, Br10c3 ≠ se, Br9c2 ≠ o, Br9c2 ≠ n, Br9c2 ≠ w, Br10c2 ≠ o, Br10c2 ≠ n, Br10c2 ≠ s, Br10c2 ≠ w, Br10c2 ≠ ns
V-single: Vr10c3 = 1
B-single: Br10c3 = ew
P-single: Pr11c3 = nw
H-single: Hr11c2 = 1
horizontal-line-{r10 r11}c2 ==> Ir10c2 = in
whip[1]: Pr11c3{nw .} ==> Br10c2 ≠ e, Br11c3 ≠ n, Br11c2 ≠ o, Br10c2 ≠ ne, Br10c2 ≠ ew, Br10c2 ≠ wne
B-single: Br11c2 = n
B-single: Br11c3 = o
whip[1]: Pr11c2{ew .} ==> Br10c1 ≠ esw, Br10c1 ≠ o, Br10c1 ≠ n
whip[1]: Br10c1{swn .} ==> Nr10c1 ≠ 0
whip[1]: Br10c2{nes .} ==> Pr10c2 ≠ se, Nr10c2 ≠ 0, Nr10c2 ≠ 1
whip[1]: Br9c2{wne .} ==> Nr9c2 ≠ 0
whip[1]: Br9c4{ns .} ==> Pr9c4 ≠ ns, Pr9c4 ≠ se, Nr9c4 ≠ 3, Pr9c4 ≠ sw
whip[1]: Br9c3{nw .} ==> Nr9c3 ≠ 3
whip[1]: Br9c5{ns .} ==> Nr9c5 ≠ 0, Nr9c5 ≠ 3
whip[1]: Pr9c6{ew .} ==> Br8c5 ≠ nw, Br8c5 ≠ se, Br8c5 ≠ esw, Br8c5 ≠ nes, Br8c6 ≠ nw, Br8c6 ≠ ew, Br8c6 ≠ wne, Br8c5 ≠ o, Br8c5 ≠ n, Br8c5 ≠ w, Br8c6 ≠ o, Br8c6 ≠ n, Br8c6 ≠ e, Br8c6 ≠ w, Br8c6 ≠ ne
whip[1]: Br8c6{nes .} ==> Nr8c6 ≠ 0
whip[1]: Br8c5{wne .} ==> Nr8c5 ≠ 0
whip[1]: Vr8c5{1 .} ==> Pr8c5 ≠ nw, Pr8c5 ≠ ew, Pr9c5 ≠ o, Pr9c5 ≠ ew, Br8c4 ≠ swn, Br8c5 ≠ e, Br8c5 ≠ s, Br8c5 ≠ ne, Br8c5 ≠ ns
whip[1]: Br8c5{wne .} ==> Nr8c5 ≠ 1
whip[1]: Br8c4{nes .} ==> Pr9c4 ≠ o
whip[1]: Pr9c4{ew .} ==> Br8c3 ≠ n, Br8c3 ≠ w
whip[1]: Br8c3{nes .} ==> Nr8c3 ≠ 1
whip[1]: Pr8c5{se .} ==> Br7c4 ≠ se, Br8c4 ≠ wne, Br8c4 ≠ nes, Br7c4 ≠ s
B-single: Br8c4 = esw
P-single: Pr8c4 = sw
P-single: Pr9c4 = ne
P-single: Pr9c5 = nw
whip[1]: Pr8c4{sw .} ==> Br8c3 ≠ ns, Br7c3 ≠ o, Br8c3 ≠ ew, Br8c3 ≠ sw, Br8c3 ≠ esw
B-single: Br7c3 = s
N-single: Nr7c3 = 1
P-single: Pr8c3 = ew
whip[1]: Pr8c3{ew .} ==> Br8c2 ≠ ne, Br8c2 ≠ wne, Br8c2 ≠ nes
whip[1]: Br8c2{swn .} ==> Pr9c3 ≠ ne, Pr9c3 ≠ ns, Pr9c3 ≠ nw
whip[1]: Pr9c4{ne .} ==> Br9c3 ≠ n, Br8c3 ≠ nes, Br9c3 ≠ nw, Br9c4 ≠ s
B-single: Br9c4 = ns
N-single: Nr9c4 = 2
B-single: Br8c3 = ne
N-single: Nr8c3 = 2
whip[1]: Pr9c3{sw .} ==> Br9c2 ≠ ew, Br9c2 ≠ swn, Br9c2 ≠ e, Br9c2 ≠ ns
whip[1]: Br9c3{w .} ==> Nr9c3 ≠ 2
whip[1]: Pr9c5{nw .} ==> Br8c5 ≠ sw, Br8c5 ≠ swn, Br9c5 ≠ ns
B-single: Br9c5 = s
N-single: Nr9c5 = 1
P-single: Pr9c6 = ne
whip[1]: Pr9c6{ne .} ==> Br8c6 ≠ s, Br8c6 ≠ ns, Br8c6 ≠ se, Br8c6 ≠ nes
whip[1]: Br8c6{swn .} ==> Nr8c6 ≠ 1
whip[1]: Br7c4{e .} ==> Nr7c4 ≠ 2
whip[1]: Pr9c7{sw .} ==> Br8c6 ≠ esw
whip[1]: Hr8c1{0 .} ==> Pr8c1 ≠ ne, Pr8c2 ≠ ew, Br7c1 ≠ sw, Br8c1 ≠ n, Br8c1 ≠ ns
P-single: Pr8c2 = se
P-single: Pr8c1 = ns
B-single: Br7c1 = w
N-single: Nr7c1 = 1
whip[1]: Pr8c2{se .} ==> Br8c2 ≠ n, Br8c2 ≠ ns
whip[1]: Br8c2{swn .} ==> Pr9c2 ≠ o, Pr9c2 ≠ se, Pr9c2 ≠ ew, Pr9c2 ≠ sw, Nr8c2 ≠ 1
whip[1]: Pr9c2{nw .} ==> Br9c2 ≠ wne
whip[1]: Br9c2{sw .} ==> Pr10c2 ≠ ns, Pr10c2 ≠ nw, Nr9c2 ≠ 3
whip[1]: Pr10c2{sw .} ==> Br10c1 ≠ e
whip[1]: Br10c1{swn .} ==> Pr10c1 ≠ o, Nr10c1 ≠ 1
whip[1]: Pr10c1{se .} ==> Br9c1 ≠ n, Br9c1 ≠ e
whip[1]: Br9c1{w .} ==> Vr9c2 ≠ 1, Pr9c1 ≠ ne, Pr10c1 ≠ ne, Pr9c2 ≠ ns, Pr9c2 ≠ nw, Pr10c2 ≠ ne, Pr9c1 ≠ se
V-single: Vr9c2 = 0
P-single: Pr9c2 = ne
H-single: Hr9c2 = 1
horizontal-line-{r8 r9}c2 ==> Ir9c2 = in
same-colour-in-{r9 r10}c2 ==> Hr10c2 = 0
different-colours-in-r9{c2 c3} ==> Hr9c3 = 1
whip[1]: Vr9c2{0 .} ==> Br9c2 ≠ sw
whip[1]: Pr9c2{ne .} ==> Br8c1 ≠ esw, Br8c2 ≠ nw, Br9c2 ≠ s
B-single: Br9c2 = ne
N-single: Nr9c2 = 2
P-single: Pr9c3 = sw
P-single: Pr10c3 = ns
B-single: Br8c2 = swn
N-single: Nr8c2 = 3
B-single: Br8c1 = ew
N-single: Nr8c1 = 2
w[1]-adjacent-1-2-on-edge-forward-diagonal-2s-3-in-{r9 r8}c1 ==> Hr10c1 = 0
P-single: Pr9c1 = ns
w[1]-1-in-r9c1-asymmetric-nw-corner ==> Pr10c2 ≠ sw
P-single: Pr10c2 = o
V-single: Vr10c2 = 0
no-vertical-line-r10{c1 c2} ==> Ir10c1 = in
different-colours-in-{r10 r11}c1 ==> Hr11c1 = 1

LOOP[116]: Hr11c1-Hr11c2-Vr10c3-Vr9c3-Hr9c2-Vr8c2-Hr8c2-Hr8c3-Vr8c4-Hr9c4-Vr8c5-Vr7c5-Hr7c5-Hr7c6-Vr7c7-Hr8c6-Vr8c6-Hr9c6-Vr9c7-Hr10c6-Hr10c5-Hr10c4-Vr10c4-Hr11c4-Hr11c5-Hr11c6-Hr11c7-Vr10c8-Vr9c8-Hr9c8-Vr9c9-Vr10c9-Hr11c9-Hr11c10-Vr10c11-Hr10c10-Vr9c10-Hr9c10-Vr8c11-Hr8c10-Hr8c9-Hr8c8-Vr7c8-Vr6c8-Hr6c8-Vr6c9-Hr7c9-Hr7c10-Vr6c11-Hr6c10-Vr5c10-Hr5c10-Vr4c11-Hr4c10-Vr3c10-Hr3c10-Vr2c11-Vr1c11-Hr1c10-Vr1c10-Hr2c9-Hr2c8-Vr1c8-Hr1c7-Vr1c7-Vr2c7-Hr3c7-Hr3c8-Vr3c9-Vr4c9-Hr5c8-Vr4c8-Hr4c7-Vr4c7-Vr5c7-Hr6c6-Hr6c5-Vr5c5-Hr5c5-Vr4c6-Hr4c5-Vr3c5-Hr3c5-Vr2c6-Vr1c6-Hr1c5-Vr1c5-Hr2c4-Vr2c4-Vr3c4-Hr4c3-Hr4c2-Vr3c2-Vr2c2-Hr2c2-Vr1c3-Hr1c2-Hr1c1-Vr1c1-Vr2c1-Vr3c1-Vr4c1-Hr5c1-Hr5c2-Hr5c3-Vr5c4-Hr6c3-Vr6c3-Hr7c2-Vr6c2-Hr6c1-Vr6c1-Vr7c1-Vr8c1-Vr9c1- ==> Vr10c1 = 1
PUZZLE 0 SOLVED. rating-type = W+nW1eq+Col+Loop, MOST COMPLEX RULE TRIED = W[1]

XXOOXOXOOX
XOOXXOXXXX
XOOXOOOOXO
XXXXXOXOXX
OOOXOOXXXO
XOXXXXXOXX
XXXXOOXOOO
XOOXOXXXXX
XXOOOOXOXO
XXOXXXXOXX

.———.———.   .   .———.   .———.   .   .———.
|       |       |   | 2 | 3 |       | 3 |
.   .———.   .———.   .   .   .———.———.   .
|   | 2     | 2     |   |               |
.   .   .   .   .———.   .———.———.   .———.
|   | 2     |   | 3   0   2   2 |   | 3
.   .———.———.   .———.   .———.   .   .———.
| 2   2       0     |   | 3 |   | 1   3 |
.———.———.———.   .———.   .   .———.   .———.
  2         | 2 |     2 |         1 |
.———.   .———.   .———.———.   .———.   .———.
| 3 | 3 |     0   2       1 |   |       |
.   .———.   .   .———.———.   .   .———.———.
|     2         | 2   3 |   |         2
.   .———.———.   .   .———.   .———.———.———.
|   |       | 3 |   |     0           3 |
.   .———.   .———.   .———.   .———.   .———.
| 1     |             3 |   | 3 |   |
.   .   .   .———.———.———.   .   .   .———.
|       | 2 | 3       2   2 |   |     3 |
.———.———.   .———.———.———.———.   .———.———.

init-time = 4m 22.59s, solve-time = 2m 26.64s, total-time = 6m 49.23s
nb-facts=<Fact-181610>
Quasi-Loop max length = 116
Colours effectively used
***********************************************************************************************
***  SlitherRules 2.1.s based on CSP-Rules 2.1.s, config = W+nW1eq+Col+Loop
***  Using CLIPS 6.32-r767
***  Running on MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.4
***********************************************************************************************