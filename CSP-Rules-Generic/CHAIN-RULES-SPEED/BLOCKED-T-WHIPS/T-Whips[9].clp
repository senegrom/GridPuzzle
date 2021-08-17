
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              BLOCKED-T-WHIP[9]
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
               ;;;                                                    ;;;
               ;;;              copyright Denis Berthier              ;;;
               ;;;     https://denis-berthier.pagesperso-orange.fr    ;;;
               ;;;             January 2006 - August 2021             ;;;
               ;;;                                                    ;;;
               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



; -*- clips -*-





(defrule activate-t-whip[9]
   (declare (salience ?*activate-t-whip[9]-salience*))
   (logical
      (play)
      (context (name ?cont))
      (not (deactivate ?cont t-whip))
   )
=>
   (if ?*print-levels* then (printout t Entering_level_tW9))
   (assert (technique ?cont partial-whip[8]))
   (assert (technique ?cont t-whip[9]))
   (bind ?*technique* tW[9])
)



(defrule track-t-whip[9]
   (declare (salience ?*activate-t-whip[9]-salience*))
   ?level <- (technique ?cont t-whip[9])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



;;; t-whip elimination rule

(defrule detect-t-whip[9]
   (declare (salience ?*t-whip[9]-salience*))
   (chain
      (type partial-whip)
      (context ?cont)
      (length 8)
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
   
   (exists-link ?cont ?zzz ?last-rlc)
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
   (if (or ?*print-actions* ?*print-L9* ?*print-t-whip* ?*print-t-whip-9*) then
      (print-t-whip-without-crlf 9 ?zzz 
         (create$ ?llc0 (subseq$ $?llcs 1 7))
         (create$ ?zzz1 (subseq$ $?rlcs 1 7))
         (create$ ?csp0 (subseq$ $?csp-vars 1 7))
         (nth$ 8 $?llcs) . (nth$ 8 $?csp-vars)
      )
   )
   (assert (apply-rule-as-a-pseudo-block ?cont))
   (assert (pseudo-blocked ?cont t-whip[9] ?zzz ?zzz1 $?csp-vars $?llcs $?rlcs ?last-rlc ?zzz ?csp0 ?llc0 ?zzz1))
)



;;; apply-t-whip[9]-to-more-targets

(defrule apply-t-whip[9]-to-more-targets
   (declare (salience ?*apply-a-blocked-rule-salience-1*))
   (pseudo-blocked ?cont t-whip[9] ?zzz ?zzz1 $?csp-vars $?llcs $?rlcs ?last-rlc ?zzz ?csp0 ?llc0 ?zzz1)
   ;;; identify the other targets ?zzz-bis
   (chain
      (type partial-whip)
      (context ?cont)
      (length 1)
      (target ?zzz-bis&~?zzz&~?zzz1&:(not (member$ ?zzz-bis $?llcs))&:(not (member$ ?zzz-bis $?rlcs)))
      (llcs ?llc0&~?zzz-bis&~?zzz1&:(not (member$ ?llc0 $?llcs))&:(not (member$ ?llc0 $?rlcs)))
      (rlcs ?zzz1) ; ?rlc0 = ?zzz1 makes the junction between the two partial-whips
      (csp-vars ?csp0)
      (last-rlc ?zzz1)
   )
   (exists-link ?cont ?zzz-bis ?last-rlc)
   ?cand <- (candidate (context ?cont) (status cand) (label ?zzz-bis))
=>
   (retract ?cand)
   (if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))n
   (if (or ?*print-actions* ?*print-L9* ?*print-t-whip* ?*print-t-whip-9*) then
      (printout t ", ")
      (print-deleted-candidate ?zzz-bis)
   )
)



