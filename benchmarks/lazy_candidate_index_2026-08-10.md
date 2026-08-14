# Lazy dirty-cell per-value candidate masks — 2026-08-10

The index remains absent until a candidate-topology consumer first
requests it. Once active, candidate mutations mark changed cells and
the next topology request updates only those cells. Speculative branches
copy the index on their first synchronization; trail rollback restores
the parent references exactly. All solver comparisons use
`the complete technique hierarchy` and matched deterministic solution fingerprints.

| Case | Baseline | Candidate | Change |
|---|---:|---:|---:|
| 25,000 unchanged topology builds | 1.980445s | 0.964862s | -51.28% |
| 600 trail rounds before index activation | 0.050466s | 0.050657s | +0.38% |
| 600 dirty-cell topology/rollback rounds | 0.077046s | 0.027270s | -64.61% |
| Loaded 4×4 Sudoku, 12 complete solves | 1.044501s | 1.051850s | +0.70% |
| Non-square 6×6 Sudoku, first 20 solutions | 11.053108s | 11.062333s | +0.08% |
| Hard 9×9 Sudoku, first solution | 60.706206s | 61.690635s | +1.62% |
| Blank 4×4 Sudoku, all 288 solutions | 27.287694s | 27.233786s | -0.20% |
| Hidato representative, three solves | 0.007700s | 0.007784s | +1.09% |
| Numbrix representative, three solves | 0.205266s | 0.204427s | -0.41% |
| Kakuro representative, three solves | 0.023231s | 0.023371s | +0.60% |
| Slitherlink representative, three solves | 0.057006s | 0.056661s | -0.61% |

Macro solver geomean: **+0.36%**.
Worst individual solver case: **+1.62%**.

## Gates

- [x] `macro_solver_change_lte_0_75`
- [x] `worst_solver_change_lte_4`
- [x] `cold_mutation_change_lte_3`
- [x] `static_topology_change_lte_minus_40`
- [x] `topology_churn_change_lte_minus_10`

Decision: **promote**.
