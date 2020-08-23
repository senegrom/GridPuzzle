
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              BLOCKED-TYPED-T-WHIP[13]
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





(defrule activate-typed-t-whip[13]
   (declare (salience ?*activate-typed-t-whip[13]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont typed-t-whip))
=>
   (if ?*print-levels* then (printout t Entering_level_TytW13))
   (assert (technique ?cont typed-partial-whip[12]))
   (assert (technique ?cont typed-t-whip[13]))
   (bind ?*technique* TytW[13])
)



(defrule track-typed-t-whip[13]
   (declare (salience ?*activate-typed-t-whip[13]-salience*))
   ?level <- (technique ?cont typed-t-whip[13])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; typed-t-whip elimination rule

(defrule detect-typed-t-whip[13]
   (declare (salience ?*typed-t-whip[13]-salience*))
   (typed-chain
      (type typed-partial-whip)
      (csp-type ?csp-type)
      (context ?cont)
      (length 12)
      (target ?zzz1)
      (llcs $?llcs)
      (rlcs $?rlcs)
      (csp-vars $?csp-vars)
      (last-rlc ?last-rlc)
   )
   
   ;;; front part
   (typed-chain
      (type typed-partial-whip)
      (csp-type ?csp-type)
      (context ?cont)
      (length 1)
      (target ?zzz&~?zzz1&:(not (member$ ?zzz $?llcs))&:(not (member$ ?zzz $?rlcs)))
      (llcs ?llc0&~?zzz1&:(not (member$ ?llc0 $?llcs))&:(not (member$ ?llc0 $?rlcs)))
      (rlcs ?zzz1) ; ?rlc0 = ?zzz1 makes the junction between the two typed-partial-whips
      (csp-vars ?csp0&:(not (member$ ?csp0 $?csp-vars)))
      (last-rlc ?zzz1)
   )
   (exists-link ?cont ?zzz ?last-rlc)
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
   (if (or ?*print-actions* ?*print-L13* ?*print-typed-t-whip* ?*print-typed-t-whip-13*) then
      (print-typed-t-whip-without-crlf ?csp-type 13 ?zzz 
         (create$ ?llc0 (subseq$ $?llcs 1 11))
         (create$ ?zzz1 (subseq$ $?rlcs 1 11))
         (create$ ?csp0 (subseq$ $?csp-vars 1 11))
         (nth$ 12 $?llcs) . (nth$ 12 $?csp-vars)
      )
   )
   (assert (apply-rule-as-a-pseudo-block ?cont))
   (assert (pseudo-blocked ?cont typed-t-whip[13]  ?csp-type ?zzz ?zzz1 $?csp-vars $?llcs $?rlcs ?last-rlc ?zzz ?csp0 ?llc0 ?zzz1))
)



;;; apply-typed-t-whip[13]-to-more-targets

(defrule apply-typed-t-whip[13]-to-more-targets
   (declare (salience ?*apply-a-blocked-rule-salience-1*))
   (pseudo-blocked ?cont typed-t-whip[13]  ?csp-type ?zzz ?zzz1 $?csp-vars $?llcs $?rlcs ?last-rlc ?zzz ?csp0 ?llc0 ?zzz1)
   ;;; identify the other targets ?zzz-bis
   (typed-chain
      (type typed-partial-whip)
      (csp-type ?csp-type)
      (context ?cont)
      (length 1)
      (target ?zzz-bis&~?zzz&~?zzz1&:(not (member$ ?zzz-bis $?llcs))&:(not (member$ ?zzz-bis $?rlcs)))
      (llcs ?llc0&~?zzz-bis&~?zzz1&:(not (member$ ?llc0 $?llcs))&:(not (member$ ?llc0 $?rlcs)))
      (rlcs ?zzz1) ; ?rlc0 = ?zzz1 makes the junction between the two typed-partial-whips
      (csp-vars ?csp0&:(not (member$ ?csp0 $?csp-vars)))
      (last-rlc ?zzz1)
   )
   (exists-link ?cont ?zzz-bis ?last-rlc)
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz-bis))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))n
   (if (or ?*print-actions* ?*print-L13* ?*print-typed-t-whip* ?*print-typed-t-whip-13*) then
      (printout t ", ")
      (print-deleted-candidate ?zzz-bis)
   )
)


