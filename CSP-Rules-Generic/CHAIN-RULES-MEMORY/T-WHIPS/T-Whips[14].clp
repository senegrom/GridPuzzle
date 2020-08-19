
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              T-WHIP[14]
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





(defrule activate-t-whip[14]
   (declare (salience ?*activate-t-whip[14]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont t-whip))
=>
   (if ?*print-levels* then (printout t Entering_level_tW14))
   (assert (technique ?cont partial-whip[13]))
   (assert (technique ?cont t-whip[14]))
   (bind ?*technique* tW[14])
)



(defrule track-t-whip[14]
   (declare (salience ?*activate-t-whip[14]-salience*))
   ?level <- (technique ?cont t-whip[14])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; t-whip elimination rule

(defrule t-whip[14]
   (declare (salience ?*t-whip[14]-salience*))
   (chain
      (type partial-whip)
      (context ?cont)
      (length 13)
      (target ?zzz1)
      (llcs $?llcs)
      (rlcs $?rlcs)
      (csp-vars $?csp-vars)
      (last-rlc ?last-rlc)
   )
   
   ;;; front part
   (chain
      (type partial-whip)
      (context ?cont)
      (length 1)
      (target ?zzz&~?zzz1&:(not (member$ ?zzz $?llcs))&:(not (member$ ?zzz $?rlcs)))
      (llcs ?llc0&~?zzz1&:(not (member$ ?llc0 $?llcs))&:(not (member$ ?llc0 $?rlcs)))
      (rlcs ?zzz1) ; ?rlc0 = ?zzz1 makes the junction between the two partial-whips
      (csp-vars ?csp0&:(not (member$ ?csp0 $?csp-vars)))
      (last-rlc ?zzz1)
   )
   
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz&:(linked ?zzz ?last-rlc)))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
   (if (or ?*print-actions* ?*print-L14* ?*print-t-whip* ?*print-t-whip-14*) then
      (print-t-whip 14 ?zzz 
         (create$ ?llc0 (subseq$ $?llcs 1 12))
         (create$ ?zzz1 (subseq$ $?rlcs 1 12))
         (create$ ?csp0 (subseq$ $?csp-vars 1 12))
         (nth$ 13 $?llcs) . (nth$ 13 $?csp-vars)
      )
   )
)



