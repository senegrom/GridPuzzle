
;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;
;;;                              CSP-RULES / FUTORULES
;;;                              HIDDEN TRIPLETS
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





(defrule activate-hidden-triplets
	(declare (salience ?*hidden-triplets-salience*))
	(logical (play) (context (name ?cont)))
    (not (deactivate ?cont triplet))
=>
	(assert (technique ?cont hidden-triplets))
	(bind ?*technique* HT)
)





(defrule L3-hidden-triplets-in-a-row
	(declare (salience ?*hidden-triplets-salience*))
	(technique ?cont hidden-triplets)
	;;; if, in a context, there is a row ?row
	;;; and there are three cells in this row (defined by ?col1, ?col2 and ?col3),
	;;; and there are three numbers ?nb1 < ?nb2 < ?nb3,
	;;; such that, in this row, these three numbers are confined exactly to ?col1, ?col2 and ?col3
	
	(candidate (context ?cont) (status cand) (row ?row) (number ?nb1) (column ?col1) )
	(candidate (context ?cont) (status cand) (row ?row) (number ?nb1) (column ?col2&~?col1))

	(candidate (context ?cont) (status cand) (row ?row) (column ?col2) (number ?nb2&:(< ?nb1 ?nb2)))
	(candidate (context ?cont) (status cand) (row ?row) (number ?nb2) (column ?col3&~?col1&~?col2))

	(not (candidate (context ?cont) (status cand) (row ?row) (number ?nb1) (column ?colx&~?col1&~?col2&~?col3)))
	(not (candidate (context ?cont) (status cand) (row ?row) (number ?nb2) (column ?colx&~?col1&~?col2&~?col3)))

	(candidate (context ?cont) (status cand) (row ?row) (column ?col3) (number ?nb3&:(< ?nb2 ?nb3)))
	(candidate (context ?cont) (status cand) (row ?row) (number ?nb3) (column ?col1))
	(not (candidate (context ?cont) (status cand) (row ?row) (number ?nb3) (column ?colx&~?col1&~?col2&~?col3)))
		
	;;; then any other number should be eliminated from the candidates for these three cells
	?cand <- (candidate (context ?cont) (status cand) (row ?row)
						(column ?colz&:(or (eq ?colz ?col1) (eq ?colz ?col2) (eq ?colz ?col3)))
						(number ?nbz&~?nb1&~?nb2&~?nb3))
=>
	(retract ?cand)
	(if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
	(if (or ?*print-actions* ?*print-L3* ?*print-hidden-triplets*) then
			(printout t "hidden-triplets-in-a-row: "
				(row-name ?row)
				?*starting-cell-symbol* (number-name ?nb1) ?*separation-sign-in-cell* (number-name ?nb2) 
				?*separation-sign-in-cell* (number-name ?nb3) ?*ending-cell-symbol*
				?*starting-cell-symbol* (column-name ?col1) ?*separation-sign-in-cell* (column-name ?col2) 
				?*separation-sign-in-cell* (column-name ?col3) ?*ending-cell-symbol*
				?*implication-sign* (row-name ?row) (column-name ?colz) ?*non-equal-sign* (numeral-name ?nbz) crlf
			)
	)
)



(defrule L3-hidden-triplets-in-a-column
	(declare (salience ?*hidden-triplets-salience*))
	(technique ?cont hidden-triplets)

	;;; if, in a context, there is a column ?col
	;;; and there are three cells in this column (defined by ?row1, ?row2 and ?row3),
	;;; and there are three numbers ?nb1 < ?nb2 < ?nb3,
	;;; such that, in this column, these three numbers are confined exactly to ?row1, ?row2 and ?row3
	
	(candidate (context ?cont) (status cand) (column ?col) (number ?nb1) (row ?row1) )
	(candidate (context ?cont) (status cand) (column ?col) (number ?nb1) (row ?row2&~?row1))

	(candidate (context ?cont) (status cand) (column ?col) (row ?row2) (number ?nb2&:(< ?nb1 ?nb2)))
	(candidate (context ?cont) (status cand) (column ?col) (number ?nb2) (row ?row3&~?row1&~?row2))

	(not (candidate (context ?cont) (status cand) (column ?col) (number ?nb1) (row ?rowx&~?row1&~?row2&~?row3)))
	(not (candidate (context ?cont) (status cand) (column ?col) (number ?nb2) (row ?rowx&~?row1&~?row2&~?row3)))

	(candidate (context ?cont) (status cand) (column ?col) (row ?row3) (number ?nb3&:(< ?nb2 ?nb3)))
	(candidate (context ?cont) (status cand) (column ?col) (number ?nb3) (row ?row1))
	(not (candidate (context ?cont) (status cand) (column ?col) (number ?nb3) (row ?rowx&~?row1&~?row2&~?row3)))

	;;; then any other number should be eliminated from the candidates for these three cells
	?cand <- (candidate (context ?cont) (status cand) (column ?col)
						(row ?rowz&:(or (eq ?rowz ?row1) (eq ?rowz ?row2) (eq ?rowz ?row3)))
						(number ?nbz&~?nb1&~?nb2&~?nb3))
=>
	(retract ?cand)
	(if (eq ?cont 0) then (bind ?*nb-candidates* (- ?*nb-candidates* 1)))
	(if (or ?*print-actions* ?*print-L3* ?*print-hidden-triplets*) then
			(printout t "hidden-triplets-in-a-column: "
				(column-name ?col)
				?*starting-cell-symbol* (number-name ?nb1) ?*separation-sign-in-cell* (number-name ?nb2) 
				?*separation-sign-in-cell* (number-name ?nb3) ?*ending-cell-symbol*
				?*starting-cell-symbol* (row-name ?row1) ?*separation-sign-in-cell* (row-name ?row2) 
				?*separation-sign-in-cell* (row-name ?row3) ?*ending-cell-symbol*
				?*implication-sign* (row-name ?rowz) (column-name ?col) ?*non-equal-sign* (numeral-name ?nbz) crlf
			)
	)
)



