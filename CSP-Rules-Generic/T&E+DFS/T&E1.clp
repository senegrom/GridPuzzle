
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              TRIAL & ERROR depth 1
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
               ;;;                                                    ;;;
               ;;;              copyright Denis Berthier              ;;;
               ;;;     https://denis-berthier.pagesperso-orange.fr    ;;;
               ;;;              January 2006 - June 2020              ;;;
               ;;;                                                    ;;;
               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



; -*- clips -*-





;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; CONTEXT INITIALIZATION
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


(defrule TE1-init-non-first-context-c-values
	"copy all the c-values from the parent context"
	(declare (salience ?*init-context-salience*))
    (technique 0 TE)
	(context (name ?cont&~0) (parent ?par&0))
	(technique ?cont BRT)
	(not (clean-and-retract ?cont))
	?cv <- (candidate (context ?par) (status c-value))
=>
	;;; copied c-values are created with flag 0, 
    ;;; because all the incompatible candidates have been eliminated
    (duplicate ?cv (context ?cont) (flag 0))
)


(defrule TE1-init-non-first-context-candidates
	"copy all the candidates from the parent context, except those linked to the generating c-value"
	(declare (salience ?*init-context-salience*))
    (technique 0 TE)
	(context (name ?cont&~0) (parent ?par&0) (generating-cand ?gen-cand))
	(technique ?cont BRT)
	(not (clean-and-retract ?cont))
	?cand <- (candidate (context ?par) (status cand) (label ?xxx&~?gen-cand&:(not (labels-linked ?xxx ?gen-cand))))
=>
	(duplicate ?cand (context ?cont))
)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; DETECTION OF CONTRADICTION IN CONTEXT 
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    

(defrule TE1-detect-contradiction-in-non-first-context
	(declare (salience ?*contradiction-in-context-salience*))
	;;; if, in a context generated by ?gen-cand, which is not the first
    (technique 0 TE)
	(context (name ?cont&~0) (parent ?par&0) (generating-cand ?gen-cand))
	?g <- (candidate (context ?par) (status cand) (label ?gen-cand))
	;;; if there is a csp-variable with no c-value and no candidate in ?cont
	(csp-variable (name ?csp)) ; (type rc)
	(forall (is-csp-variable-for-label (csp-var ?csp) (label ?lab))
        (not (candidate (context ?cont) (label ?lab)))
    )
    (phase ?par ?ph)
    (not (clean-and-retract ?cont))
=>
	;;; then eliminate the generating candidate from the parent context
	(retract ?g)
	(if (eq ?par 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
	(if (or ?*print-actions* ?*print-hypothesis*) then
		(printout t "NO POSSIBLE VALUE for csp-variable " ?csp " IN CONTEXT " ?cont ".")
		(printout t " RETRACTING CANDIDATE " (print-label ?gen-cand) " FROM CONTEXT " ?par "." crlf crlf)
	)
	;;; remember that this phase was productive
	(assert (phase-productive-in-context ?par ?ph))
	;;; properly destroy the present context so as not to saturate memory
	(assert (clean-and-retract ?cont))
)




;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; CLEANING OF CONTRADICTORY CONTEXT 
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


;;; should use (do-for-all-facts ...)

(defrule TE1-clean-context-technique
	(declare (salience ?*clean-context-salience*))
    (technique 0 TE)
	(clean-and-retract ?cont)
	?xx <- (technique ?cont $?)
=>
	(retract ?xx)
)


(defrule TE1-clean-context-candidates
	(declare (salience ?*clean-context-salience*))
    (technique 0 TE)
	(clean-and-retract ?cont)
	?cand <- (candidate (context ?cont))
=>
	(retract ?cand)
)


(defrule TE1-clean-context-csp-linked
	(declare (salience ?*clean-context-salience*))
    (technique 0 TE)
	(clean-and-retract ?cont)
	?xx <- (csp-linked ?cont $?)
=>
	(retract ?xx)
)


(defrule TE1-clean-context-exists-link
	(declare (salience ?*clean-context-salience*))
    (technique 0 TE)
	(clean-and-retract ?cont)
	?xx <- (exists-link ?cont $?)
=>
	(retract ?xx)
)


(defrule TE1-clean-context-chains
	(declare (salience ?*clean-context-salience*))
    (technique 0 TE)
	(clean-and-retract ?cont)
	?xx <- (chain (context ?cont))
=>
	(retract ?xx)
)


(defrule TE1-clean-context-end
	(declare (salience ?*clean-context-salience*))
    (technique 0 TE)
	?ctx <- (context (name ?cont&~0) (parent ?par&0))
	?rr <- (clean-and-retract ?cont)
	(not (init-context ?cont))
	(not (candidate (context ?cont)))
    (not (csp-linked ?cont $?))
    (not (exists-link ?cont $?))
    (not (chain (context ?cont)))
=>
	(retract ?rr)
	(retract ?ctx)
	(if (or ?*print-actions* ?*print-hypothesis*) then
		(printout t "BACK IN CONTEXT " ?par " with " ?*nb-csp-variables-solved* " csp-variables solved and " ?*nb-candidates* " candidates remaining." crlf crlf)
	)
)




;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; DETECTION OF NO CONTRADICTION 
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


(defrule TE1-no-contradiction-in-non-first-context
	(declare (salience ?*level1-no-contrad-found-in-context-salience*))
	;;; after all the resolution rules have been applied
    (technique 0 TE)
	(context (name ?cont&~0) (parent ?par&0) (generating-cand ?gen-cand))
=>
	(if (or ?*print-actions* ?*print-hypothesis*) then
		(printout t "NO CONTRADICTION FOUND IN CONTEXT " ?cont "." crlf)
	)
	;;; properly destroy the present context so as not to saturate memory
	(assert (clean-and-retract ?cont))
)




;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; START T&E, CONTEXT GENERATION AND PHASE ITERATION IN A CONTEXT 
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


(defrule TE1-start
	(declare (salience ?*level1-generate-context-salience*))
    ;;; level 1
    (technique 0 BRT)
=>
    (assert (technique 0 TE))
	(assert (phase 0 1))
	(printout t crlf "*** STARTING T&E IN CONTEXT " 0  " with " ?*nb-csp-variables-solved* " csp-variables solved and " ?*nb-candidates* " candidates remaining ***" crlf)
	(if ?*print-phase* then
        (if ?*print-hypothesis* then (printout t crlf))
        (printout t "        STARTING PHASE " 1 " IN CONTEXT " 0 " with " ?*nb-csp-variables-solved* " csp-variables solved and " ?*nb-candidates* " candidates remaining" crlf)
        (if ?*print-hypothesis* then (printout t crlf))
    )
)



(defrule TE1-generate-context
	(declare (salience ?*level1-generate-context-salience*))
    (technique 0 TE)
    ;;; currently only one level of T&E: T&E(1)
	(context (name ?par&0) (depth ?depth&0))
    ;;; only one context other than 0 is considered at a time:
	(not (context (name ?cont&~?par) (parent ?par)))
	;;; each remaining cand will be re-tried in each phase, but not re-tried in the same phase
	(phase ?par ?ph) 
    ?gen <- (candidate (context ?par) (status cand) (label ?gen-cand))
	(not (TE1-tried ?par ?ph ?gen-cand))
=>
	;;; choose ?gen-cand as a hypothesis	
	(bind ?*context-counter* (+ ?*context-counter* 1))
	(bind ?depth1 (+ 1 ?depth))
	(if (or ?*print-actions* ?*print-hypothesis*) then 
		(printout t "GENERATING CONTEXT " ?*context-counter* " AT DEPTH " ?depth1 ", SON OF CONTEXT " ?par ", FROM HYPOTHESIS " (print-label ?gen-cand) "." crlf)
	)
	;;; assert the new context
	(assert (context (name ?*context-counter*) (parent ?par) (depth ?depth1) (generating-cand ?gen-cand)))
	(assert (technique ?*context-counter* BRT))
	;;; assert the generating value of the new context, with flag 0
	(duplicate ?gen (context ?*context-counter*) (status c-value) (flag 0))
	;;; remember that ?gen-cand was tried in ?par at phase ?ph
	(assert (TE1-tried ?par ?ph ?gen-cand))
)


(defrule TE1-iterate-phase
	(declare (salience ?*level1-iterate-phase-salience*))
	;;; if the grid is not solved by phase ?ph
    (technique 0 TE)
    ;;; only T&E(1)
	(context (name ?par&0) (depth ?depth&0))
    ;;; if there is a csp-variable with no c-value in ?par
	(csp-variable (name ?csp)) ; (type rc)
	(forall (is-csp-variable-for-label (csp-var ?csp) (label ?lab))
        (not (candidate (context ?par) (status c-value) (label ?lab)))
    )
	?phase <- (phase ?par ?ph)
	;;; and if phase ?ph was productive
	?ce <- (phase-productive-in-context ?par ?ph)
	
=>
	(if ?*print-phase* then
        (if ?*print-hypothesis* then (printout t crlf))
        (printout t "        STARTING PHASE " (+ ?ph 1) " IN CONTEXT " ?par " with " ?*nb-csp-variables-solved* " csp-variables solved and " ?*nb-candidates* " candidates remaining" crlf)
        (if ?*print-hypothesis* then (printout t crlf))
    )
	(assert (phase ?par (+ ?ph 1)))
	(retract ?ce)
	(retract ?phase)
)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; CLEAN WHAT'S LEFT BY T&E 
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


(defrule TE1-clean-1
	(declare (salience ?*TE-clean-salience*))
    ?t <- (technique 0 TE)
=>
	(retract ?t)
)


(defrule TE1-clean-2
	(declare (salience ?*TE-clean-salience*))
    (not (technique 0 TE))
	?ph <- (phase ?x ?y)
=>
	(retract ?ph)
)


(defrule TE1-clean-3
	(declare (salience ?*TE-clean-salience*))
    (not (technique 0 TE))
    (not (phase ? ?))
	?b <- (TE1-tried ?par&0 ?ph ?gen-cand)
=>
	(retract ?b)
)








