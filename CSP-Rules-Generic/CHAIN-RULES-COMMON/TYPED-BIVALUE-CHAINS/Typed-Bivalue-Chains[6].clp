
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              TYPED-BIVALUE-CHAIN[6]
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





(defrule activate-typed-bivalue-chain[6]
   (declare (salience ?*activate-typed-bivalue-chain[6]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont typed-bivalue-chain))
=>
   (if ?*print-levels* then (printout t Entering_level_TyBC6))
   (assert (technique ?cont typed-bivalue-chain[6]))
   (bind ?*technique* TyBC[6])
)



(defrule track-typed-bivalue-chain[6]
   (declare (salience ?*activate-typed-bivalue-chain[6]-salience*))
   ?level <- (technique ?cont typed-bivalue-chain[6])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; typed-bivalue-chain elimination rule

(defrule typed-bivalue-chain[6]
   (declare (salience ?*typed-bivalue-chain[6]-salience*))
   (typed-chain
      (type typed-bivalue-chain)
      (csp-type ?csp-type)
      (context ?cont)
      (length 6)
      (llcs $?llcs)
      (rlcs $?rlcs)
      (csp-vars $?csp-vars)
      (last-rlc ?last-rlc)
   )
   
   (exists-link ?cont ?zzz ?last-rlc)
   (exists-link ?cont ?zzz ?uuu1&:(eq ?uuu1 (first $?llcs)))
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
   (if (or ?*print-actions* ?*print-L6* ?*print-typed-bivalue-chain* ?*print-typed-bivalue-chain-6*) then
      (print-typed-bivalue-chain ?csp-type 6 ?zzz $?llcs $?rlcs $?csp-vars)
   )
)



;;; extension of an existing typed-bivalue-chain with a pair of candidates

(defrule typed-partial-bivalue-chain[6]
   (declare (salience ?*typed-partial-bivalue-chain[6]-salience*))
   (logical
      (typed-chain
         (type typed-bivalue-chain)
         (csp-type ?csp-type)
         (context ?cont)
         (length 5)
         (llcs $?llcs)
         (rlcs $?rlcs)
         (csp-vars $?csp-vars)
         (last-rlc ?last-rlc)
      )
      
      (technique ?cont typed-bivalue-chain[6])
      ;;; ?new-llc
      (exists-link ?cont ?new-llc&:(not (member$ ?new-llc $?llcs))&:(not (member$ ?new-llc $?rlcs)) ?last-rlc)
      ;;; ?new-csp
      (is-typed-csp-variable-for-label (csp-var ?new-csp&:(not (member$ ?new-csp $?csp-vars))) (label ?new-llc) (csp-var-type ?csp-type))
      ;;; ?new-rlc
      ;;; the following condition implies that new-csp is not a csp variable for zzz or any of the previous rlcs
      (bivalue
         ?cont
         ?new-llc
         ?new-rlc&:(not (member$ ?new-rlc $?llcs))&:(not (member$ ?new-rlc $?rlcs))
         ?new-csp
      )
   )
=>
   (assert
      (typed-chain
         (type typed-bivalue-chain)
         (csp-type ?csp-type)
         (context ?cont)
         (length 6)
         (llcs $?llcs ?new-llc)
         (rlcs $?rlcs ?new-rlc)
         (csp-vars $?csp-vars ?new-csp)
         (last-rlc ?new-rlc)
      )
   )
)


