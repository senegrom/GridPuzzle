
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              BLOCKED-BIVALUE-CHAIN[5]
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





(defrule activate-bivalue-chain[5]
   (declare (salience ?*activate-bivalue-chain[5]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont bivalue-chain))
=>
   (if ?*print-levels* then (printout t Entering_level_BC5))
   (assert (technique ?cont bivalue-chain[5]))
   (bind ?*technique* BC[5])
)



(defrule track-bivalue-chain[5]
   (declare (salience ?*activate-bivalue-chain[5]-salience*))
   ?level <- (technique ?cont bivalue-chain[5])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; extension of an existing bivalue-chain with a pair of candidates

(defrule partial-bivalue-chain[5]
   (declare (salience ?*partial-bivalue-chain[5]-salience*))
   (logical
      (chain
         (type bivalue-chain)
         (context ?cont)
         (length 4)
         (llcs $?llcs)
         (rlcs $?rlcs)
         (csp-vars $?csp-vars)
         (last-rlc ?last-rlc)
      )
      
      (technique ?cont bivalue-chain[5])
      ;;; ?new-llc
      (exists-link ?cont ?new-llc&:(not (member$ ?new-llc $?llcs))&:(not (member$ ?new-llc $?rlcs)) ?last-rlc)
      ;;; ?new-rlc and ?new-csp
      ;;; the following condition implies that new-csp is not a csp variable for zzz or any of the previous rlcs
      (bivalue
         ?cont
         ?new-llc
         ?new-rlc&:(not (member$ ?new-rlc $?llcs))&:(not (member$ ?new-rlc $?rlcs))
         ?new-csp&:(not (member$ ?new-csp $?csp-vars))
      )
   )
=>
   (assert
      (chain
         (type bivalue-chain)
         (context ?cont)
         (length 5)
         (llcs $?llcs ?new-llc)
         (rlcs $?rlcs ?new-rlc)
         (csp-vars $?csp-vars ?new-csp)
         (last-rlc ?new-rlc)
      )
   )
)



;;; bivalue-chain elimination rules

(defrule apply1-bivalue-chain[5]
   (declare (salience ?*bivalue-chain[5]-salience*))
   (chain
      (type bivalue-chain)
      (context ?cont)
      (length 5)
      (llcs $?llcs)
      (rlcs $?rlcs)
      (csp-vars $?csp-vars)
      (last-rlc ?last-rlc)
   )
   
   ;;; identify a first target
   (exists-link ?cont ?zzz ?last-rlc)
   (exists-link ?cont ?zzz ?uuu1&:(eq ?uuu1 (first $?llcs)))
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
   (if (or ?*print-actions* ?*print-L5* ?*print-bivalue-chain* ?*print-bivalue-chain-5*) then
      (print-bivalue-chain-without-crlf 5 ?zzz $?llcs $?rlcs $?csp-vars)
   )
   (assert (apply-rule-as-a-pseudo-block ?cont))
   (assert (pseudo-blocked ?cont bivalue-chain[5] 5 ?zzz $?llcs $?rlcs $?csp-vars))
)



(defrule apply2-bivalue-chain[5]
   (declare (salience ?*apply-a-blocked-rule-salience*))
   (chain
      (type bivalue-chain)
      (context ?cont)
      (length 5)
      (llcs $?llcs)
      (rlcs $?rlcs)
      (csp-vars $?csp-vars)
      (last-rlc ?last-rlc)
   )
   
   (apply-rule-as-a-pseudo-block ?cont)
   (pseudo-blocked ?cont bivalue-chain[5] 5 ?zzz $?llcs $?rlcs $?csp-vars)
   ;;; identify one more target
   (exists-link ?cont ?zzz2&~?zzz ?last-rlc)
   (exists-link ?cont ?zzz2 ?uuu1&:(eq ?uuu1 (first $?llcs)))
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz2))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
   (if (or ?*print-actions* ?*print-L5* ?*print-bivalue-chain* ?*print-bivalue-chain-5*) then
      (printout t ", ")
      (print-deleted-candidate ?zzz2)
   )
)


