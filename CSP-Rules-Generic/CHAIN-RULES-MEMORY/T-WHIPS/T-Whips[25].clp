
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              T-WHIP[25]
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





(defrule activate-t-whip[25]
   (declare (salience ?*activate-t-whip[25]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont t-whip))
=>
   (if ?*print-levels* then (printout t Entering_level_tW25))
   (assert (technique ?cont partial-whip[24]))
   (assert (technique ?cont t-whip[25]))
   (bind ?*technique* tW[25])
)



(defrule track-t-whip[25]
   (declare (salience ?*activate-t-whip[25]-salience*))
   ?level <- (technique ?cont t-whip[25])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; t-whip elimination rule

(defrule t-whip[25]
   (declare (salience ?*t-whip[25]-salience*))
   (chain
      (type partial-whip)
      (context ?cont)
      (length 24)
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
   (if (or ?*print-actions* ?*print-L25* ?*print-t-whip* ?*print-t-whip-25*) then
      (print-t-whip 25 ?zzz 
         (create$ ?llc0 (subseq$ $?llcs 1 23))
         (create$ ?zzz1 (subseq$ $?rlcs 1 23))
         (create$ ?csp0 (subseq$ $?csp-vars 1 23))
         (nth$ 24 $?llcs) . (nth$ 24 $?csp-vars)
      )
   )
)


