
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / FUTORULES
;;;                              HIDDEN SINGLES
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
               ;;;                                                    ;;;
               ;;;              copyright Denis Berthier              ;;;
               ;;;     https://denis-berthier.pagesperso-orange.fr    ;;;
               ;;;            January 2006 - August 2020              ;;;
               ;;;                                                    ;;;
               ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



; -*- clips -*-





(defrule activate-hidden-single
	(declare (salience ?*hidden-single-salience*))
	(logical (technique ?cont BRT))
=>
	(assert (technique ?cont hidden-single))
	(bind ?*technique* HS)
)



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;; ASSERT VALUE WHEN HIDDEN SINGLE CANDIDATE 
;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


(defrule hidden-single-in-a-row
	"if there is a number whose instance in a row has been confined to a unique cell, then assert the c-value"
	(declare (salience ?*hidden-single-salience*))
	(technique ?cont hidden-single)
	?mod <- (candidate (context ?cont) (status cand) (label ?xxx) (number ?nb) (row ?row) (column ?col))
	(not (candidate (context ?cont) (status cand) (number ?nb) (row ?row) (column ?colx&~?col)))
=>
	(modify ?mod (status c-value))
	(if (eq ?cont 0) then (bind ?*nb-csp-variables-solved* (+ ?*nb-csp-variables-solved* 1)))
	(if (or ?*print-actions* ?*print-L1* ?*print-hidden-single*) then
		(printout t "hidden-single-in-a-row" ?*implication-sign* (row-name ?row) (column-name ?col) ?*equal-sign* (numeral-name ?nb) crlf)
	)
)


(defrule hidden-single-in-a-column
	"if there is a number whose instance in a column has been confined to a unique cell, then assert the c-value"
	(declare (salience ?*hidden-single-salience*))
	(technique ?cont hidden-single)
	?mod <- (candidate (context ?cont) (status cand) (label ?xxx) (number ?nb) (row ?row) (column ?col))
	(not (candidate (context ?cont) (status cand) (number ?nb) (column ?col) (row ?rowx&~?row)))
=>
	(modify ?mod (status c-value))
	(if (eq ?cont 0) then (bind ?*nb-csp-variables-solved* (+ ?*nb-csp-variables-solved* 1)))
	(if (or ?*print-actions* ?*print-L1* ?*print-hidden-single*) then
		(printout t "hidden-single-in-a-column" ?*implication-sign* (row-name ?row) (column-name ?col) ?*equal-sign* (numeral-name ?nb) crlf)
	)
)


