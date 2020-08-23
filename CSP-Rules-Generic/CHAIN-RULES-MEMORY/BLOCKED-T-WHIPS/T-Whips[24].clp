
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              BLOCKED-T-WHIP[24]
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





(defrule activate-t-whip[24]
   (declare (salience ?*activate-t-whip[24]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont t-whip))
=>
   (if ?*print-levels* then (printout t Entering_level_tW24))
   (assert (technique ?cont partial-whip[23]))
   (assert (technique ?cont t-whip[24]))
   (bind ?*technique* tW[24])
)



(defrule track-t-whip[24]
   (declare (salience ?*activate-t-whip[24]-salience*))
   ?level <- (technique ?cont t-whip[24])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; t-whip elimination rule

(defrule detect-t-whip[24]
   (declare (salience ?*t-whip[24]-salience*))
   (chain
      (type partial-whip)
      (context ?cont)
      (length 23)
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
   (if (or ?*print-actions* ?*print-L24* ?*print-t-whip* ?*print-t-whip-24*) then
      (print-t-whip-without-crlf 24 ?zzz 
         (create$ ?llc0 (subseq$ $?llcs 1 22))
         (create$ ?zzz1 (subseq$ $?rlcs 1 22))
         (create$ ?csp0 (subseq$ $?csp-vars 1 22))
         (nth$ 23 $?llcs) . (nth$ 23 $?csp-vars)
      )
   )
   (assert (apply-rule-as-a-pseudo-block ?cont))
   (assert (pseudo-blocked ?cont t-whip[24] ?zzz ?zzz1 $?csp-vars $?llcs $?rlcs ?last-rlc ?zzz ?csp0 ?llc0 ?zzz1))
)



;;; apply-t-whip[24]-to-more-targets

(defrule apply-t-whip[24]-to-more-targets
   (declare (salience ?*apply-a-blocked-rule-salience-1*))
   (pseudo-blocked ?cont t-whip[24] ?zzz ?zzz1 $?csp-vars $?llcs $?rlcs ?last-rlc ?zzz ?csp0 ?llc0 ?zzz1)
   ;;; identify the other targets ?zzz-bis
   (chain
      (type partial-whip)
      (context ?cont)
      (length 1)
      (target ?zzz-bis&~?zzz&~?zzz1&:(not (member$ ?zzz-bis $?llcs))&:(not (member$ ?zzz-bis $?rlcs)))
      (llcs ?llc0&~?zzz-bis)
      (rlcs ?zzz1) ; ?rlc0 = ?zzz1 makes the junction between the two partial-whips
      (csp-vars ?csp0)
      (last-rlc ?zzz1)
   )
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz-bis&:(linked ?zzz-bis ?last-rlc)))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))n
   (if (or ?*print-actions* ?*print-L24* ?*print-t-whip* ?*print-t-whip-24*) then
      (printout t ", ")
      (print-deleted-candidate ?zzz-bis)
   )
)


