
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              FORCING-G-BRAID[36]
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





(defrule activate-forcing-gbraid[36]
   (declare (salience ?*activate-forcing-gbraid[36]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont forcing-gbraid))
=>
   (if ?*print-levels* then (printout t Entering_level_FB36))
   (assert (technique ?cont forcing-gbraid[36]))
   (bind ?*technique* FgB[36])
)



(defrule track-forcing-gbraid[36]
   (declare (salience ?*activate-forcing-gbraid[36]-salience*))
   ?level <- (technique ?cont forcing-gbraid[36])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



(defrule forcing-gbraid[36]-value
   (declare (salience ?*forcing-gbraid[36]-value-salience*))
   (bivalue ?cont ?zzz1 ?zzz2 ?ll)
   (technique ?cont forcing-gbraid[36])
   (chain
      (type ?type1&partial-whip|partial-gwhip|partial-braid|partial-gbraid)
      (context ?cont)
      (length ?p1&:(< ?p1 35))
      (target ?zzz1)
      (llcs $llcs1)
      (rlcs $rlcs1)
      (csp-vars $?csps1)
      (last-rlc ?cand)
   )
   (chain
      (type ?type2&partial-whip|partial-gwhip|partial-braid|partial-gbraid&:(or (eq ?type1 partial-gbraid) (eq ?type2 partial-bgraid)))
      (context ?cont)
      (length ?p2&:(<= ?p1 ?p2)&:(= (+ ?p1 ?p2) 35))
      (target ?zzz2)
      (llcs $llcs2)
      (rlcs $rlcs2)
      (csp-vars $?csps2)
      (last-rlc ?cand)
   )
   ?mod <- (candidate (context ?cont) (status cand) (label ?cand))
=>
   (modify ?mod (status c-value))
   (if (or ?*print-actions* ?*print-L36* ?*print-forcing-gbraid* ?*print-forcing-gbraid-36*) then
      (print-forcing-gbraid-assert-value 
         ?type1 ?p1 ?zzz1 $llcs1 $rlcs1 $?csps1
         ?type2 ?p2 ?zzz2 $llcs2 $rlcs2 $?csps2
         ?cand
      )
   )
)



(defrule forcing-gbraid[36]-candidate
   (declare (salience ?*forcing-gbraid[36]-candidate-salience*))
   (bivalue ?cont ?zzz1 ?zzz2 ?ll)
   (technique ?cont forcing-gbraid[36])
   (chain
      (type ?type1&partial-whip|partial-gwhip|partial-braid|partial-gbraid)
      (context ?cont)
      (length ?p1&:(< ?p1 35))
      (target ?zzz1)
      (llcs $llcs1)
      (rlcs $rlcs1)
      (csp-vars $?csps1)
      (last-rlc ?last-rlc1)
   )
   (chain
      (type ?type2&partial-whip|partial-gwhip|partial-braid|partial-gbraid&:(or (eq ?type1 partial-gbraid) (eq ?type2 partial-bgraid)))
      (context ?cont)
      (length ?p2&:(<= ?p1 ?p2)&:(= (+ ?p1 ?p2) 35))
      (target ?zzz2)
      (llcs $llcs2)
      (rlcs $rlcs2)
      (csp-vars $?csps2)
      (last-rlc ?last-rlc2)
   )
   ?ret <- (candidate (context ?cont) (status cand) (label ?cand))
   (exists-link ?cont ?last-rlc1 ?cand)
   (exists-link ?cont ?last-rlc2 ?cand)
=>
   (retract ?ret)
   (if (or ?*print-actions* ?*print-L36* ?*print-forcing-gbraid* ?*print-forcing-gbraid-36*) then
      (print-forcing-gbraid-elim-candidate 
         ?type1 ?p1 ?zzz1 $llcs1 $rlcs1 $?csps1
         ?type2 ?p2 ?zzz2 $llcs2 $rlcs2 $?csps2
         ?cand
      )
   )
)



