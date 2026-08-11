"""Apply the correctness-gated Hidato/Numbrix guarantee patch."""

import base64
import subprocess
import tempfile
import zlib
from pathlib import Path

_PATCH = (
    "c-pmFTa(+il763Gft`I=YDLkaB<fa2TlPtLv#DD9q>fX0nVMoC64EfHNF9>$Sn>M5Z#Mvv00>GN$FZwsBodcKU%zhj#K~?)Mx%XF"
    "5&CLhBypLipIGsVZp*5mQ5EuM{Ec@!lkN2}cS#nr&%|FW7t_d(rV;g{o$t?f%hh;FgYja)wsAD^w*iZ%yRqjjmTbzFD>~l=e!OIp"
    "cs!Xd=JQ=dSF_o6JfFtFbUa&4h(8|BXS2J}Xmks$cf;ZECVF4LCZk{#xC=7GU%pS^NtDvEBtOCs=cmKrRMBn9@S98ic}m$2c~;RR"
    "V}(oJiFY5^zfLTR*h7+4kAw9cssEKM-Fab>eWGa+(~5-!%nu_PJuzo+VHl8l0#ciScOx7YvmFVuyg0zHKUlaw(Sl|bV-C)DN%MV8"
    "eyl$Z$mqY?Z|l3^#dXB%nj*LTYFk=)UDF+h5lhpsWL3E)aS~O?5SQ$V{12AFQ_i19@_*!go-wlFzvMC|p$%{D@9%$=%M+T#B%)cK"
    "B@sL-8Np>5+Q^pe@`3^F6*;iOmKEhwa`b?E&0@_4Bq<3cX|jK+o*Dim@9BZXznqR~vkj@9SRt0&GOj3df9m>kGMxJhclv!bCE1bc"
    "d}PkPl^l?0V~Aw<2^rXo_TY&=1SL^wL-><cXw9IIiw}l6`b+%BY2u?eJ&h#0BavwqJ-}I6UU5<1JjvU$$^n*&jrq<N;s^SHfrE~)"
    "lg<G+yZAD|_AV7jpTdbdVk7fqoUo8vzoKbsVYJ5Vnp8f1O#Zgv>yf_+N0GA3J|9$73{0{<0tN;P*WDqyPW)1wEOG;0Uy=3NPNHSj"
    "LnG)%va!+41v~r}!8Ve(D%jRaiu}23R=j0Gl&4oF_$WbPvhab+@IXI@EM*7#1f3ePk(2PtwFyW~GXcMJO`_G$QJ;R^u8CcxGt6?Z"
    "?vh-v>QrPc)tVbb4NA%+D=P|)vSqZZM76bW$BUKgPrx0omhL3@F7Eiwq_Npk=$aDDq|&+s#o`jK25O|HaUAYpVi`gZk3O>44AT%J"
    "f2vr4bUZZMJn}#&ENEnnfw0p7qEw|tK3YXjE(WX&UmpO_A*QSH14hd9?7<3`V}E%=@V67J2Ji~wXZy}2p65L(t^mk*2ZtyU5x!OT"
    "f8k&d<|Eb~;TsUghJ5+jPL`tO#2TJOATb*@QuNTWx#3sQDB43LimEHV4dy5^L3L^Nm74QiWMX(@VB-%$Ljd8>v|uzokL1QBi#xnG"
    "l&EzTahz01o&f<cu~Ie%Za+M#;Fe`;1ZDaVv>?S*T;SMR_fzet%`M`xp@fb@(so9IyF*O+_|`3vVM4i2TKHoZ5aMDsLD%$`<`QO-"
    "&^xf9Qb{O=-_K1A{{lDFp5uyLTr}FURRh&R(eQ|Q{=Vaz$&@&=zIT_0in|yfyW^fr8$X6zMOgXjNUNvtc>3dyl$D))`_f36bwes0"
    "ZzDEe?EEMSCTy{Y<2fBqr`v5jj^bb$Z^siF%{*_u^k=g<^{4(K2$qa)r-8qkE`!;Ot^x{~`))B_Ojmwy)_swhPVRkiG>_z%f8!7M"
    "0>1k|vJ=nWNOCylMMZuBPVNg#aroPIX-`k<J^Wcu5?1yLi=MIsZ0hGC-z6#QE}>HAq1M*R)eHR~p5c1k*_hFnUX>s7G~b`wDG+_4"
    "Q<Z#TZ{pu+1QvZpd%qjm=bt!<_3XER3|Ur{Z>s-gw5<LC?!Z+ZzRSh4yWz_gtLM1_jE2X8mFQ{|gFysz#}O|1drph^2Sj!o8P|De"
    "MYqId=KD*O8vdHMjxJPA{xe9LJ3fVh1Dow|vK!mceXqq^cTXgZmLsx_#ARJ{YhkN(VrRoXX<BG&W3}~_vXLveIGJO-@F#)mFTRb9"
    "jaxJJR6>H{{QjN1A!vdm2ZbT;Wu1VRLyoM#0EJPV<U8Vf-g}RHU;qlLryStg4mO8zrMg%O1S+wD6cno_Fagj-M2q5_WP4Z|oaU%}"
    "0%VV(CeM7iJWJ2y_k61^2Xs_9VHg=;9a7SRwt9Rja6NprONz20$09${y&(ArjPs1}(e=!F=;$>BrzbIXyU*)fZlh&(mVuZkY?@5Y"
    "G5~XkO_RB~X1PNNV5ALTVU!=wA^Qw&5Fi1@`zn`e4aYjA)tY-kYw$XO$en>_T|!JA^oA~Ow6BD(=|n5zWgVcR7^2ENTCy>OooGA>"
    "W>YqqPRA^OIK|@GauH8`Hub#en9jzFNw8vcwcW9J5mA`xFX=R%tRTciK@g4UeAgSGOaeMF$sE9q(OrQly0aA+qV)72h?GSf=t8WC"
    "nt&t`Q3tk3pS(L|QI%sZE+?eLNuVzj-3>vkL?9E@=ui!5AK*;`8~frB|JlrHQ<tCO&%c0khYtcCwn$X`e3L%YbNK-bs@x?k=HX!Y"
    "x*^^H?MBKrlVA?|DAW&M#Njnd;?}b^GBc^-wau(Cy2xi}BI<Xvi2D20T(c*`>m>8Sq_qrwsAeRhXai^;rtO*IyA7#iNPIb%=W&7="
    "H!`8Y(+Us%^RMCsVCsK@awY{M3>4%{;`{)*BhLojHjkoHfrtF<H%{Mgzj<|L`eW;QX@Q7BCNM53bCSdmOcA(4U^pac0)wz>UeX-{"
    "$6h|+jHc?l%}?M0u&xf;LSP~gLZc#wSSPR`sVhFEN8WNewRDS$P0nI9n!^5khq8?m4RxX(1v=(69BA2(={g`9vy3AK$nsM?PRVTw"
    "iUo^bk!Np<A}@^iaL?b2YRPL6Q8J%`6F}I(FD-C~do3eT)b>`BQjeqr3rhqt;*Anrgz`$%VF6a?6l$;$hGm*pWf<aJfkYQ40L=<z"
    "vSN&(JUktF_K6Nk9pPZr=L3EF=G{O312txku{;Hf7ziIc4%{Vp;TZs;aSMoS*iEGk|9#Bz=WK0Fq!nlcIvVpF6--FjP2-KY*(gJ="
    "<iO@d*2t)XZ6N@-qB?@4KDuV5<WVVYNZJ24s5Y3_0}Ou95$uIZq<{>v94WG4;nKus;n+rIfvW4=#BklkHPaqDbv|)E@mYir&Of_1"
    "Qp<q)S)GA<GY)G{YM>(>goQmQtVLj<1%kEkD>U#|KMIn+6dc;YLe?QQB8uZ^H;yB^po?*|oKZjC#dI}elX&OPr*s@lgIOFv%02_2"
    "vt3YsyxhkAERL3RIc7eEZ}EH_P5jAjzKtirwiglE$>`uB`!H^qGaqx5A^$x?)8zG&<1syp49>x2`q3sx_Xr+4*4>4XL-Bh;vtpOA"
    "XLS-J34EBQ(F}B{4)~qSkKguRs}qiF_i0)X(&^AA7!_bnPVcs*qc5eUYDBvZX}BgKoqEOAJ!8xOMkb%?Rs#or3@qciS+~B=z)piM"
    "gqDzzbpt)|vMgfoOt8yZ@Uu?lwF=b1T3K0`^D85p8eTDASuDL^zuE|Cz5!$?)7d0uY!3NI94!{J$%JhKFyZksTJ3_#IEv$V>3P`g"
    "GMPY1GlN7XTCBE^)$HhM>hCC>0-B!A;_)<EMAyt$r=rh#^-*ZNV6$^FM9WozYWQn2?&p+dQlYp4tUG@Ft`icieqIdYTBs^~-{_&X"
    "C?r7n>DUZz)kAzYk_YpeM{(G&w)pZWwB$9MlJY}49K&o7r3k<g_}KL`3<7tivIc@vx~0*_zn|hgB0-sJ*WD*-*NoXBlW%{Alu_b{"
    "BQn<Hw50UU_08COX6%h5XsWhm5&>&5C6uUEcYybAKOf;JfZN;7nfz28Pe9!smi%ID<%MAeP&^F3-gk;m7aLM~8&R&eUA(CA<eM5!"
    "+T=hX%xoGNzN}fq(j;PU4!M36j~a$o@%!qjdkfjq4^pSDYdw?b>-%_dzsF1ZJaoPq-4(D<x4+|B+s5$Lc8y`DO+(umA8_tA?Ha?&"
    "Z5n(qZ_^lFZqMKYd3(mNuUVxdAbZyYaL?8)f#kac5&8hHE{&!NONzrMw9o4sm%2*5;#KPT#GN+CPq|l2%CM|!Msjfxo<)g>d-X1;"
    "zkZ3WBpbIy0Hg5nBW|oF<5)8g73sQ0z^x=rGDZucgw3XAz%!FF+@3>Oyy5=Yq{G%~aPdles8yib^*vY#ct%fY<rtpQ6?f(X#8!rd"
    "T&#LIa(0_9%94bvFo46;t6p_gOdrKBz4M~7*U*&{Bo#Z9kksj;KC<&BrH5@y2@Y5j2V9neA0Nh#1DP~Ba)bKuVBmIrR$Fch`6WPj"
    "NJ>!ceW#IC2NN$)AXgRrni!P?RVy#V>2<3G{S1{Pwuclca8(ZhZ4#dzaE-^VOIO-jBpYCkxzWg2R&(rfn&H5uE*+B0kpl*<>a^v1"
    "5nZu@#O0y)IUiU>5qI${q=7|tM8tWDV6%lWhR-URBK6=BfDvGK#?kH~5Le2aw(TiN<FGaH5a|GgI~5UAvIRRPZgBC&8CVNM`tuI_"
    "-Dvh;;@x&~ll`>;RKoGLj3oMN_&M>`a0&-qF5HR#{Z88AzjrhRl{)|c<QI3`1>iD7<XB(u>Aw|U;S>8Dsi04kiumOOyr~;b+EXb#"
    "DT-UY(7e@Nc(oniMgyCo6wlXFkDB8b>gQ_BP;7av*{S364N`OlRmFMTEju)udGvT>S?pM|4y7LrGUF<NC@`?xD4J{8+j8xBjdiG|"
    "zi$5+Nz{cAy~@xtXJBh**1m$Kv13J?#vQmy#eP6&i6d<NsN9LjE3prGdP1A9B}6vE(7VDk>u6r7Cc+Ij;OTfU!5hc#?4U#-HT*}9"
    ")9UysGK5ofo?i59meKu=t`7?KE^jAD0R^h#6ueyqyel{emaZQ(+-*V=-BXMyg1a`KS1SO&+aN4WAP6ES+nWO!l)vJg4v)rP@Mp*U"
    ")!o1yr@+y_wZTz_J)1r1AX{%oMG$9rl1n;0x^U=ENuJ{6h(hrf4QzhJ6WrU@_#)Apfm;V(@2#cM4r~KodIizd1r^U!EY}3ou9>=b"
    "ce7`&>di0^)R|^p3EDY4d;xc*E&*3-1~zQ#c6^{N)uC8qn;ah8=`lqscEWa5$$y5t_pVhuQR=+-{w`zBct6L;A&*&IofOs2@s0mH"
    "$XNVsG+i({U(9AfJomT3E|^n)wVm$RHeN-G9gF?B&&!^#V)p4(c1lxO-n>j7n*7)uW8a3)|0e5hDBB*6N%S%0=(K)t#zpYK3%dxr"
    "6SST|wWG0~_CM$-a+kb69kxaCxvy2v-luU}W1rMATeG0~rs@1s5*yoX8zwj1&Bd>JTk)-Ll-I^DgU&wFmNa!DgP;ZfzZQb?4z&0P"
    "%q}P-76pJm=bnoJ3q1EOaSWCZWP^&LI7louI2Bd+oWKLHe8s;WSt0Txr&+cxzi@@vkmk8FammD}YbxnAzfa}28Ia=+nm&Kj7T^be"
    "q27T3z`fq1!e@zFUH<W=ZWTV#(z5bZBM7}9&CZI~>ZDy3B{Md!osysv)m8Jra;x%mxNVzSV{hFBx#+i*0WS1DH4p24m5>%J<ZUEz"
    "2(dksO)5?;cF|+Fx#@OV@O(C~G-7OKMk~g~H<~e;5%Rbti}EbKac5@=%IFdh_xR86u1QOrAL68-M|+2rY9r9|Qa4U{7(dD<9q7Z~"
    "4-7#uDfW<7A@7ml_jn=iEvcSBM0ls5iZ812;_MjK$$MmLtK^EZv9^uudC!~Z#O<0YXUY>kj<I3`F*f2$2pp~cT?7_d;F-s7z!iCj"
    "YfRpZ;+jv}=93<l%dL@>ygfpD*&zqD-q9^gzoNZKbMX*n;?-!6=0Z$OYMqjyQH_goJ4HKNAP>t^@d+V*l%h{YTNKfo`|12t)mDlZ"
    "38vhozxQ~f(H6Vb9mf&YK%5!=Ze1|1pWz;;i;lc9XGiRR#WobNsh8$7E*<$LJ{^vtwE@;qfMP8$T+MLjhKIjCM?%qS^SX}u8=ST2"
    "N(C{BFSW_5WDFc*M{HcN3XmHDLaZ;KX6AsTKyszTynjYq^4wqQ;;>k8!0E5QiL|?gAVO4Mjj)P4fRlvvr)><x|4qOBDXRdN{3>d`"
    "${*&z*^(*@WlMFFY#D#1)YNO6^!udsH;A@x26_c!#@b*0g?m<E!MoXmqwCHVV)BrOIipIelJLN1KbrCr=EE=J6!|qtaRZ0Mbse~="
    "R&1)nyFC&vt+8l%H5M)PNGQ@f%nUn~gH9hwBLhR4PJ@S59o6bhIAva03%qGMQYVXdwOBV~X>gsdq1CsP>JB(_K*tdCn#~3H{F8kD"
    "P6*^yzQ2r_(h8?&g&eXe<f|l_SbEl61P$)~A5PYrrT"
)


def main() -> None:
    patch = zlib.decompress(base64.b85decode(_PATCH.encode("ascii")))
    with tempfile.NamedTemporaryFile(suffix=".patch", delete=False) as handle:
        handle.write(patch)
        patch_path = Path(handle.name)
    try:
        subprocess.run(
            ["git", "apply", "--whitespace=error-all", str(patch_path)],
            check=True,
        )
    finally:
        patch_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
