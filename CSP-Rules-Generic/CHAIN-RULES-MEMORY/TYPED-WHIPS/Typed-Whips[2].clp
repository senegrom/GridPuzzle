
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              TYPED-WHIP[2]
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
               ;;;                                                    ;;;
               ;;;              copyright Denis Berthier              ;;;
               ;;;     https://denis-berthier.pagesperso-orange.fr    ;;;
               ;;;             January 2006 - August 2020             ;;;
               ;;;                                                    ;;;
               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



; -*- clips -*-





;;; SPECIAL CASE. DO NOT USE THE AUTOMATIC GENERATOR


(defrule activate-typed-whip[2]
	(declare (salience ?*activate-typed-whip[2]-salience*))
	(logical (play) (context (name ?cont)))
	(not (deactivate ?cont typed-whip))
=>
	(if ?*print-levels* then (printout t "Entering_level_TyW2"))
    (assert (technique ?cont typed-partial-whip[1]))
    (assert (technique ?cont typed-whip[2]))
	(bind ?*technique* TyW[2])
)



(defrule track-typed-whip[2]
	(declare (salience ?*activate-typed-whip[2]-salience*))
	?level <- (technique ?cont typed-whip[2])
=>
	(if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; typed-whip elimination rule

(defrule typed-whip[2]
	(declare (salience ?*typed-whip[2]-salience*))
    (typed-chain
        (type typed-partial-whip)
        (csp-type ?csp-type)
        (context ?cont)
        (length 1)
        (target ?zzz)
        (llcs ?llc1)
        (rlcs ?rlc1)
        (csp-vars ?csp1)
        (last-rlc ?rlc1)
    )
    ;;; ?new-llc
    (exists-link ?cont ?new-llc&~?zzz&~?llc1&~?rlc1 ?rlc1)
    
    ;;; ?new-csp
    (is-typed-csp-variable-for-label (csp-var ?new-csp&~?csp1) (label ?new-llc) (csp-var-type ?csp-type))
    ;;; because, in a typed partial whip, ?zzz cannot be linked to any candidate in $?rlcs
    ;;; the following condition implies that ?zzz is not linked to ?new-llc by ?new-csp
    ;;; i.e. that ?zzz is not a candidate for ?new-csp
    (forall (typed-csp-linked ?cont ?new-llc ?xxx ?new-csp ?csp-type)
        (test (linked-or ?xxx ?zzz ?rlc1))
    )
	
    ?cand <- (candidate (context ?cont) (status cand) (label ?zzz))
=>
	(retract ?cand)
	(if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
	(if (or ?*print-actions* ?*print-L2* ?*print-typed-whip* ?*print-typed-whip-2*) then
		(print-typed-whip ?csp-type 2 ?zzz (create$ ?llc1) (create$ ?rlc1) (create$ ?csp1) ?new-llc . ?new-csp)
	)
)


