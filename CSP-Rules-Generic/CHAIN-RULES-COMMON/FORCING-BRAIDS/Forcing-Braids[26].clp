
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / GENERIC
;;;                              FORCING-BRAID[26]
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





(defrule activate-forcing-braid[26]
   (declare (salience ?*activate-forcing-braid[26]-salience*))
   (logical (play) (context (name ?cont)))
   (not (deactivate ?cont forcing-braid))
=>
   (if ?*print-levels* then (printout t Entering_level_FB26))
   (assert (technique ?cont forcing-braid[26]))
   (bind ?*technique* FB[26])
)



(defrule track-forcing-braid[26]
   (declare (salience ?*activate-forcing-braid[26]-salience*))
   ?level <- (technique ?cont forcing-braid[26])
=>
   (if ?*print-levels* then (printout t _with_ ?level crlf))
)



(defrule forcing-braid[26]-value
   (declare (salience ?*forcing-braid[26]-value-salience*))
   (bivalue ?cont ?zzz1 ?zzz2 ?ll)
   (technique ?cont forcing-braid[26])
   (chain
      (type ?type1&partial-whip|partial-braid)
      (context ?cont)
      (length ?p1&:(< ?p1 25))
      (target ?zzz1)
      (llcs $llcs1)
      (rlcs $rlcs1)
      (csp-vars $?csps1)
      (last-rlc ?cand)
   )
   (chain
      (type ?type2&partial-whip|partial-braid&:(not (and (eq ?type1 partial-whip) (and eq ?type2 partial-whip))))
      (context ?cont)
      (length ?p2&:(<= ?p1 ?p2)&:(= (+ ?p1 ?p2) 25))
      (target ?zzz2)
      (llcs $llcs2)
      (rlcs $rlcs2)
      (csp-vars $?csps2)
      (last-rlc ?cand)
   )
   ?mod <- (candidate (context ?cont) (status cand) (label ?cand))
=>
   (modify ?mod (status c-value))
   (if (or ?*print-actions* ?*print-L26* ?*print-forcing-braid* ?*print-forcing-braid-26*) then
      (print-forcing-braid-assert-value 
         ?type1 ?p1 ?zzz1 $llcs1 $rlcs1 $?csps1
         ?type2 ?p2 ?zzz2 $llcs2 $rlcs2 $?csps2
         ?cand
      )
   )
)



(defrule forcing-braid[26]-candidate
   (declare (salience ?*forcing-braid[26]-candidate-salience*))
   (bivalue ?cont ?zzz1 ?zzz2 ?ll)
   (technique ?cont forcing-braid[26])
   (chain
      (type ?type1&partial-whip|partial-braid)
      (context ?cont)
      (length ?p1&:(< ?p1 25))
      (target ?zzz1)
      (llcs $llcs1)
      (rlcs $rlcs1)
      (csp-vars $?csps1)
      (last-rlc ?last-rlc1)
   )
   (chain
      (type ?type2&partial-whip|partial-braid&:(not (and (eq ?type1 partial-whip) (and eq ?type2 partial-whip))))
      (context ?cont)
      (length ?p2&:(<= ?p1 ?p2)&:(= (+ ?p1 ?p2) 25))
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
   (if (or ?*print-actions* ?*print-L26* ?*print-forcing-braid* ?*print-forcing-braid-26*) then
      (print-forcing-braid-elim-candidate 
         ?type1 ?p1 ?zzz1 $llcs1 $rlcs1 $?csps1
         ?type2 ?p2 ?zzz2 $llcs2 $rlcs2 $?csps2
         ?cand
      )
   )
)



