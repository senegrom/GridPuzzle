
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / SUDORULES
;;;                              SUDORULES CONFIGURATION FILE
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
               ;;;                                                    ;;;
               ;;;              copyright Denis Berthier              ;;;
               ;;;     https://denis-berthier.pagesperso-orange.fr    ;;;
               ;;;            January 2006 - August 2020              ;;;
               ;;;                                                    ;;;
               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



; -*- clips -*-





;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; INSTALLATION ONLY:
;;; Define environment variables: OS and installation directory
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(clear) ; clean CLIPS of anything it may have had before.
;;; Default setting is for Unix and MacOS,
;;; but it should also work for recent versions of Windows:
(defglobal ?*Directory-symbol* = "/")


;;; Define your general CSP-Rules installation directory (including the ending directory symbol /).
;;; This is the directory in which the CSP-Rules-V2.1 version is installed, not the CSP-Rules-V2.1 directory.
;;; By defining the path in an absolute way, you will be able to launch CSP-Rules-V2.1 from anywhere.
;;; You need to write something as follows.
;;; For Unix (including MacOS):
 (defglobal ?*CSP-Rules* = "/Users/berthier/Documents/Projets/CSP-Rules/")   ; <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
;;; For Windows:
; (defglobal ?*CSP-Rules* = "c:/Users/berthier/Documents/Projets/CSP-Rules/") ; <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<


;;; CLIPS is the underlying inference engine.
;;; The version of CLIPS used may be defined here (used only for displaying it in the banner)
(defglobal ?*Clips-version* = "6.32-r813");                                     <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<


;;; Description of the computer used for the resolution
(defglobal ?*Computer-description* =
    "MacBookPro Retina Mid-2012 i7 2.7GHz, 16GB 1600MHz DDR3, MacOS 10.15.7"
)                                                                               <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; Define the application
;;; Define useful directories and load all the globals
;;; (they must be available before choosing the configuration of rules)
;;;
;;; Do NOT change any of the following
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; An ?*Application* must be defined as the name of the application (here, SudoRules), not as the name of the puzzle (Sudoku).
;;; This name must coincide with the leading part of the name of the directory for the application inside the CSP-Rules-V2.1 directory.
;;; The version number of the ?*Application* must also be defined.
;;; This allows to have several versions of the same application based on the same version of CSP-Rules.
;;; For historical reasons, SudoRules version number inside CSP-Rules-V2.1 is not 2.1 but 20.1
;;; (there were many versions of SudoRules before the development of a generic CSP-Rules core).
(defglobal ?*Application* = "SudoRules")
(defglobal ?*Application-VersionNumber* = 20.1)

(defglobal ?*CSP-Rules-current-version* = (str-cat ?*CSP-Rules* "CSP-Rules-V2.1" ?*Directory-symbol*))
(defglobal ?*CSP-Rules-Generic-Dir* = (str-cat ?*CSP-Rules-current-version* "CSP-Rules-Generic" ?*Directory-symbol*))
(defglobal ?*CSP-Rules-Generic-Loader* = (str-cat ?*CSP-Rules-Generic-Dir* "CSP-Rules-Generic-Loader.clp"))

(defglobal ?*Application-Dir* = (str-cat ?*CSP-Rules-current-version* ?*Application* "-V" ?*Application-VersionNumber* ?*Directory-symbol*))
(defglobal ?*Application-Loader* = (str-cat ?*Application-Dir* ?*Application* "-Loader.clp"))

;;; load definitions for the global variables necessary for the upcoming choices
(load (str-cat ?*CSP-Rules-Generic-Dir* "GENERAL" ?*Directory-symbol* "globals.clp"))
(load (str-cat ?*Application-Dir* "GENERAL" ?*Directory-symbol* "globals.clp"))




;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; General application-specific choices
;;; Define grid size and related parameters
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Because ordinary Sudoku puzzles are 9x9 (i.e. segment-size = 3),
;;; SudoRules has its own way of dealing with the size of puzzles
;;; and this can only be done here; maximum segment size is 9
;;; you don't need do change anything for the standard 9x9 puzzles
 (bind ?*segment-size* 3) ;                                                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<





;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;                                                                                                      ;;;
;;;                                      DEFINE YOUR CONFIGURATION HERE:                                 ;;;
;;;                                         Choose general settings                                      ;;;
;;;                     Define your resolution theory (i.e. your set of resolution rules)                ;;;
;;;                         Simply delete the leading semicolon of the proper line(s)                    ;;;
;;;                                                                                                      ;;;
;;;                                        IN ORDER TO AVOID ERRORS,                                     ;;;
;;;                       DELETE SEMI-COLONS IN ONLY ONE SECTION OF RULES AT A TIME                      ;;;
;;;                                                                                                      ;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;                                                                                                      ;;;
;;;                                                                                                      ;;;
;;;                                                                                                      ;;;

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; 0) Choose general settings
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; DON'T CHANGE ANYTHING IN THIS SECTION UNLESS YOU HAVE SOME REASON

;;; Possibly change the type of optimisation for the chain rules.
;;; Default is pre-defined as SPEED.
;;; Don't change this unless you meet a memory overflow problem.
; (bind ?*chain-rules-optimisation-type* MEMORY)


;;; In the previous standard behaviour of CSP-Rules, when a pattern could have produced more than one elimination,
;;; the activation of a simpler rule by the first elimination could prevent further potential eliminations.
;;; This default behaviour is now changed for Whips[1], bivalue-chains (typed or not),
;;; z-chains (typed or not), t-Whips (typed or not), Oddagons and Subsets.
;;; However, CSP-Rules allows to revert to the previous behaviour,
;;; independently for Subsets, for chains that allow this behaviour and for Oddagons.
;;; Un-comment the relevant line(s) below if you want these rules to be "interrupted" as all the other chain rules:
; (bind ?*blocked-chains* FALSE)
; (bind ?*blocked-oddagons* FALSE)
; (bind ?*blocked-Subsets* FALSE)
;;; The old interrupted behaviour can be globally selected by a single choice;
;;; (equivalent to selecting all the above values):
; (bind ?*unblocked-behaviour* TRUE)


;;; Choose what's printed as the output.
;;; The default combination is what has been used in PBCS.
;;; Changes below will print more or less details.
; (bind ?*print-init-details* TRUE)
; (bind ?*print-ECP-details* TRUE)
; (bind ?*print-actions* FALSE)
; (bind ?*print-levels* TRUE)
; (bind ?*print-solution* FALSE)

;;; Note that the following print options are time consuming.
;;; De-activate them for a faster solution.
;;; The resolution state after BRT is printed by default.
;;; Un-comment this if you do not want to print it:
; (bind ?*print-RS-after-Singles* FALSE)

;;; The resolution state after Singles and whips[1] is printed by default.
;;; Un-comment this if you do not want to print it:
; (bind ?*print-RS-after-whips[1]* FALSE)

;;; The resolution state is printed by default at the end of resolution
;;; if the solution has not been found.
;;; Un-comment this if you do not want to print it:
; (bind ?*print-final-RS* FALSE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; 1) Choose ordinary resolution rules
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; My standard config and its usual variants
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; My most usual rules (config = W+S+Fin, with unrestricted lengths):
;;; Sudoku-specific:
 (bind ?*Subsets* TRUE)
 (bind ?*FinnedFish* TRUE)
;;; generic:
; (bind ?*Whips[1]* TRUE) ; allows to more easily activate only whips[1]
 (bind ?*Bivalue-Chains* TRUE)
 (bind ?*Whips* TRUE)


;;; Some additional rules I use frequently:
 (bind ?*z-Chains* TRUE)
 (bind ?*t-Whips* TRUE)
; (bind ?*G-Whips* TRUE)


;;; Some optional intermediary Typed Chains, allowing more varied resolution paths:
;;; (remember that whips[1] cannot be type-restricted)
; (bind ?*Typed-Bivalue-Chains* TRUE)
; (bind ?*Typed-z-Chains* TRUE)
; (bind ?*Typed-t-Whips* TRUE)
; (bind ?*Typed-Whips* TRUE)

;;; Choose stricter type restrictions in the above Typed Chains.
;;; The same type restrictions will apply to all the typed-chains.
;;; Type restrictions correspond to working in only some of the four 2D-spaces,
;;; i.e. using only part of the Extended Sudoku Board.
;;; BEWARE: type restrictions defined by global variable ?*allowed-csp-types*
;;; will apply only if ?*restrict-csp-types-in-typed-chains* is set to TRUE.
; (bind ?*restrict-csp-types-in-typed-chains* TRUE)
; (bind ?*allowed-csp-types* (create$ rc))


;;; Some additional rules I use occasionally:
; (bind ?*G2-Whips* TRUE)
; (bind ?*Braids* TRUE)
; (bind ?*G-Bivalue-Chains* TRUE)
; (bind ?*G-Braids* TRUE)
; (bind ?*Quick-B-Rating* TRUE)

; (bind ?*Oddagons* TRUE)



;;; Some additional rules I almost never use:
; (bind ?*Forcing-Whips* TRUE)
; (bind ?*Forcing-G-Whips* TRUE)
; (bind ?*Forcing-Braids* TRUE)
; (bind ?*Forcing-G-Braids* TRUE)


;;; Setting ?*All-generic-chain-rules* to TRUE will activate all the generic chain rules listed above,
;;; (which doesn't include the Subset rules),
;;; with the max-lengths as specified below (but automatically modified for consistency).
;;; It is NOT RECOMMENDED to use this possibility, unless you know what you are doing
;;; Many complex rules are loaded and memory overflow problems may appear.
; (bind ?*All-generic-chain-rules* TRUE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; Sudoku-specific rules (besides Subsets):
;;; uniqueness and "exotic" patterns
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; U-resolution rules for uniqueness.
;;; BEWARE: don't activate the following uniqueness rules,
;;; if you are not sure that the puzzle has a unique solution.
;;; The result would be undefined.
; (bind ?*Unique-Rectangles* TRUE)
; (bind ?*BUG* TRUE)

;;; Exotic patterns
;;; Belt (sk-loop) and J-Exocet rules fall under the category of what I called exotic patterns,
;;; because they are very specialised and rarely present in a puzzle -
;;; a name that has immediately been adopted on the Sudoku forums

; (bind ?*Belt4* TRUE)
; (bind ?*Belt6* TRUE)

; (bind ?*J-Exocet* TRUE)
; (bind ?*J2-Exocet* TRUE)
; (bind ?*J3-Exocet* TRUE)
; (bind ?*J4-Exocet* TRUE)
; (bind ?*J5-Exocet* TRUE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; Change the default maximal lengths of the chain patterns
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Don't change these lengths unless you have some reason.

;;; The maximum length of all the generic chains can be lowered at once:
; (bind ?*all-chains-max-length* 36)

;;; Maximum lengths can also be lowered individually:
; (bind ?*bivalue-chains-max-length* 20)
; (bind ?*z-chains-max-length* 20)
; (bind ?*t-whips-max-length* 36)
; (bind ?*whips-max-length* 36)
; (bind ?*g2whips-max-length* 36)
; (bind ?*g-bivalue-chains-max-length* 20)
; (bind ?*gwhips-max-length* 36)
; (bind ?*braids-max-length* 36)
; (bind ?*gbraids-max-length* 36)
; (bind ?*oddagons-max-length* 15)

; (bind ?*typed-bivalue-chains-max-length* 20)
; (bind ?*typed-z-chains-max-length* 20)
; (bind ?*typed-t-whips-max-length* 36)
; (bind ?*typed-whips-max-length* 36)

; (bind ?*forcing-whips-max-length* 36)
; (bind ?*forcing-gwhips-max-length* 36)
; (bind ?*forcing-braids-max-length* 36)
; (bind ?*forcing-gbraids-max-length* 36)




;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; 2) Choose typical T&E config options, for various predefined purposes
;;;
;;; DO NOT FORGET TO DISABLE ALL THE RULES IN THE OTHER SECTIONS
;;; BEFORE ACTIVATING T&E
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Un-comment the proper line(s) below to change the level of details you want to be printed.
;;; This can make T&E faster.
; (bind ?*print-actions* FALSE)
; (bind ?*print-levels* TRUE)
; (bind ?*print-ECP-details* TRUE)
; (bind ?*print-solution* FALSE)
; (bind ?*print-hypothesis* FALSE)
; (bind ?*print-phase* TRUE)
; (bind ?*print-RS-after-Singles* FALSE)
; (bind ?*print-RS-after-whips[1]* FALSE)
; (bind ?*print-final-RS* FALSE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; 2a) for checking membership in T&E(k) or gT&E(k), k = 1,2,3
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Choose one of the following 3 depths of T&E:
;;; - depth 2 is enough for all the 9x9 Sudokus
;;; - but deeper T&E is often required for larger Sudokus or for Sukakus

; (bind ?*TE1* TRUE) ;;; for T&E at level 1
; (bind ?*TE2* TRUE) ;;; for T&E at level 2
; (bind ?*TE3* TRUE) ;;; for T&E at level 3

;;; In addition to the previous choice, you can give priority to bivalue candidates:
; (bind ?*special-TE* TRUE)

;;; For gT&E(k) instead of T&E(k), activate the additional next line:
; (bind ?*Whips[1]* TRUE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; 2b) For computing the SpB classification
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Choose one of the following forms of T&E(1, Sp or SpFin)
; (bind ?*TE1* TRUE) ;;; for T&E at level 1
;;; For T&E at level 1, with priority for bivalue variables, add the following:
; (bind ?*special-TE* TRUE)

;;; Remember that whips[1] are always activated before Subsets,
;;; even if you don’t activate them explicitly here.
;;; But you can choose to activate only them, to get gT&E (as in 2a)
; (bind ?*Whips[1]* TRUE)

;;; choose which Subsets[p] and FinnedFish[p] are activated:
; (bind ?*Subsets[2]* TRUE)
; (bind ?*Subsets[3]* TRUE)
; (bind ?*Subsets[4]* TRUE)
; (bind ?*Subsets* TRUE)

; (bind ?*FinnedFish[2]* TRUE)
; (bind ?*FinnedFish[3]* TRUE)
; (bind ?*FinnedFish[4]* TRUE)
; (bind ?*FinnedFish* TRUE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; 2c) for computing the BpB classification
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Choose one of the following forms of T&E(1)
; (bind ?*TE1* TRUE) ;;; for T&E at level 1
;;; For T&E at level 1, with priority for bivalue variables, add the following:
; (bind ?*special-TE* TRUE)

;;; Choose p (here p = 3):
; (bind ?*Whips* TRUE)
; (bind ?*Braids* TRUE)
; (bind ?*whips-max-length* 3)
; (bind ?*braids-max-length* 3)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; 2d) for looking for backdoors, anti-backdoors or anti-backdoor pairs
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Choose one or several of backdoors, anti-backdoors and anti-backdoor pairs:
; (bind ?*Backdoors* TRUE)
; (bind ?*Anti-backdoors* TRUE)
; (bind ?*Anti-backdoor-pairs* TRUE)

;;; for W1-backdoors, W1-anti-backdoors or W1-anti-backdoor pairs, add the following:
; (bind ?*Whips[1]* TRUE)
;;; for S-backdoors, S-anti-backdoors or S-anti-backdoor pairs, add the following:
; (bind ?*Subsets* TRUE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; 2e) for solving with Forcing-T&E
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; For Forcing{2} T&E OR Forcing{3} T&E, activate only one of the following
;;; The possibility of activating both together is not yet available
; (bind ?*Forcing{2}-TE* TRUE)
; (bind ?*Forcing{3}-TE* TRUE)

;;; for Forcing{2}-T&E(W1) or Forcing{3}-T&E(W1), add:
; (bind ?*Whips[1]* TRUE)
;;; for Forcing{2}-T&E(S) or Forcing{3}-T&E(S), add:
; (bind ?*Subsets* TRUE)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; 3) Choose DFS (depth-first search) options
;;;
;;; DO NOT FORGET TO DISABLE ALL THE RULES IN THE OTHER SECTIONS BEFORE ACTIVATING DFS
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; DFS can be used to provide a relatively fast solution

;;; To block all output:
; (bind ?*print-actions* FALSE)
; (bind ?*print-levels* TRUE)
; (bind ?*print-ECP-details* TRUE)
; (bind ?*print-solution* FALSE)
; (bind ?*print-hypothesis* FALSE)
; (bind ?*print-solution* FALSE)
; (bind ?*print-phase* TRUE)
; (bind ?*print-RS-after-Singles* FALSE)
; (bind ?*print-RS-after-whips[1]* FALSE)
; (bind ?*print-final-RS* FALSE)

;;; To activate DFS:
; (bind ?*DFS* TRUE)
;;; To activate priority for bivalue candidates, activate this line, in addition to the above line:
; (bind ?*special-DFS* TRUE)

;;; Activate short whips for combining whips[1] or whips[2] with DFS:
;;; this often gives a faster result (but not with larger whips)
; (bind ?*Whips* TRUE)
; (bind ?*whips-max-length* 1)
; (bind ?*whips-max-length* 2)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; 4) Use rules based on intermediate binary contradictions
;;;
;;; DO NOT FORGET TO DISABLE ALL THE RULES IN THE OTHER SECTIONS
;;; BEFORE ACTIVATING ANY OF THE RULES BELOW
;;; ACTIVATE RULES FROM ONLY ONE OF THE FOLLOWING SUB-SECTIONS AT A TIME
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; BEWARE: this section should not be used unless you have a deep understanding
;;; of these rules, as described in chapter 12 of PBCS


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; Compute pairwise Bi-Whip / Bi-Braid contradictions using Bi-Whips / Bi-Braids,
;;; thus getting a list ?*all-biwhip-contrads* / ?*all-bibraid-contrads*
;;; plus the associated effective bi-Whips / bi-Braids
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; This will typically be used in combination with W*-Whips
;;; but it may be used independently, just to get an idea of the numbers of contradictions involved
;;; and how they increase with p
;;; Choose the maximum length of the Bi-Whips / Bi-Braids
; (bind ?*Bi-Whips* TRUE)
; (bind ?*biwhips-max-length* 4)
; (bind ?*Bi-Braids* TRUE)
; (bind ?*bibraids-max-length* 4)

;;; Notice that ?*chain-rules-optimisation-type* MEMORY will not alllow
;;; for continuous updating of the bi-Whip / bi-Braid contradictions
;;; when combined with W*-Whips / B*-Braids
; (bind ?*chain-rules-optimisation-type* MEMORY)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; Use Bi-Whips plus W*-Whips or Bi-Braids plus B*-Braids
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Notice that ?*chain-rules-optimisation-type* MEMORY will not alllow
;;; for continuous updating of the bi-Whip / bi-Braid contradictions
;;; when combined with W*-Whips / B*-Braids
; (bind ?*chain-rules-optimisation-type* MEMORY)

; (bind ?*Whips* TRUE)
; (bind ?*whips-max-length* 3)
; (bind ?*Bi-Whips* TRUE)
; (bind ?*biwhips-max-length* 3)
; (bind ?*W*-Whips* TRUE)
; (bind ?*w*-whips-max-length* 1)

; (bind ?*G-Whips* TRUE)
; (bind ?*gwhips-max-length* 3)

; (bind ?*Braids* = TRUE)
; (bind ?*braids-max-length* = 2)
; (bind ?*Bi-Braids* = TRUE)
; (bind ?*bibraids-max-length* = 2)
; (bind ?*B*-Braids* TRUE)
; (bind ?*b*-braids-max-length* 20)


;;; SHOULD BE MOVED TO GENERIC LOADER
;;; When W*-Whips[p] are active, Whips[p] must be active also
;(if ?*W*-Whips* then
;   (bind ?*Whips* TRUE)
;    (bind ?*whips-max-length* (max ?*whips-max-length* ?*w*-whips-max-length*))
;)
;;; When Bi-Whips[q] are active, Whips[q] must be active also
; (if ?*Bi-Whips* then (bind ?*whips-max-length*  (max ?*whips-max-length* ?*biwhips-max-length*)))



;;; if bi-braids are used, bi-whips of minimum length up to 2 must be used

;;; when bi-whips [resp. bi-braids] are activated
;;; whips [resp. braids] of at least same max length must be activated
; (bind ?*Whips* TRUE)
; (bind ?*Braids* TRUE)
; (bind ?*whips-max-length* 2)
; (bind ?*braids-max-length* 2)


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; for checking membership in B*B (without rating)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; choose one of the following forms of T&E(1)
; (bind ?*TE1* TRUE) ;;; for T&E at level 1
;;; for T&E at level 1, with priority for bivalue variables, add the following:
; (bind ?*special-TE* TRUE)

; (bind ?*simple-bi-TE* TRUE) ;;; adds ECP* rule so that bibraid links can be used in context 0, thus simulating B*-braids


;;; for checking membership in B*B[1] = Forcing-bi-braids = Forcing-bi-TE
;;; choose one of the following forms of T&E(1)
; (bind ?*TE1* TRUE) ;;; for T&E at level 1
;;; for T&E at level 1, with priority for bivalue variables, add the following:
; (bind ?*special-TE* TRUE)

; (bind ?*simple-bi-TE* TRUE) ;;; adds ECP* rule so that bibraid links can be used in context 0, thus simulating B*-braids
; (bind ?*Forcing-bi-TE* TRUE) ;;; restricts the use of bibraid links in context 0 to only the forcing-biTE rule




;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; Compute pairwise contradictions using bi-T&E,
;;; thus getting a list ?*all-contrads*
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; using bi-T&E, thus getting a list ?*all-contrads* of contradictory pairs
; (bind ?*chain-rules-optimisation-type* MEMORY)
; (bind ?*Bi-TE* TRUE)
; (bind ?*print-Bi-TE-hypothesis* TRUE)
; (bind ?*print-print-contradictions* TRUE)
;;; add this to exclude some pairs from the calculations
;;; useful when Bi-T&E(Bp) have already been calculated
;;; and one wants to calculate Bi-T&E(Bp+1)
; (bind ?*excluded-pairs ...result of previous computations...)
;;; add this to compute all the bi-braid-contrads[Bp], using Bi-T&E(Bp) (here p=2)
; (bind ?*Whips* TRUE)
; (bind ?*whips-max-length* 2)
; (bind ?*Braids* TRUE)
; (bind ?*braids-max-length* 2)


;;; when bi-braid-contrads are pre-computed by bi-TE, they must be loaded before solve is launched
;;; notice that, if g-whips are active, bibraid-contrads must be loaded in the gW format
; (bind ?*pre-computed-all-bi-braid-contrads* TRUE)


;;; should be set to TRUE when bi-TE is used dynamically in conjunction with other rules
; (bind ?*Context-restriction* = TRUE)





;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; Use W-Whips and/or B-Braids
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; (bind ?*W-Whips* TRUE)
; (bind ?*w-whips-max-length* 36)
; (bind ?*B-Braids* TRUE)
; (bind ?*b-braids-max-length* 36)

;;; if forcing-whips, forcing-braids, one must also activate Bi-whips or bi-braids or bi-T&E
; (bind ?*Bi-Whips* TRUE)
; (defglobal ?*Bi-Braids* = TRUE)
; (bind ?*simple-bi-TE* TRUE)
; (bind ?*print-biTE-hypothesis* TRUE)

;;; if bi-braids are used, bi-whips of minimum length up to 2 must be used
; (bind ?*biwhips-max-length* 36)
; (defglobal ?*bibraids-max-length* = 36)




;;; if forcing-whips, forcing-braids, w*-whips, b*-braids, w-whips or b-braids are activated, one must also activate Bi-whips or bi-braids or bi-T&E
; (bind ?*Forcing-Bi-Whips* TRUE)
; (bind ?*Forcing-Bi-Braids* TRUE)
; (bind ?*Forcing-bi-TE* TRUE)



;;;                                                                                                      ;;;
;;;                                                                                                      ;;;
;;;                                                                                                      ;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;                                                                                                      ;;;
;;;                                         end of allowed changes                                       ;;;
;;;                                                                                                      ;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;






;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; AUTOMATIC CONFIGURATION AND LOADING (DO NOT CHANGE ANYTHING BELOW THIS LINE)
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;;; Because grid size may have been changed in this file,
;;; redefine the associated internal factors;
;;; this has to be done BEFORE loading
(redefine-internal-factors)


;;; now, load all
;;; Notice that the generic loader also loads the application-specific files
(if (and (or ?*G-Bivalue-Chains* ?*G-Whips* ?*G-Braids*) (> ?*segment-size* 4))
    then (printout t
        "BEWARE: g-labels, g-bivalue-chains, g-whips and g-braids are not managed” crlf
        “for segment size larger than 4, i.e. grid size larger than 16" crlf)
    else (redefine-all-chains-max-length)
         (batch ?*CSP-Rules-Generic-Loader*)
)

	

