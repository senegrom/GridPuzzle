# Solver benchmark baselines

Benchmarks are correctness-gated: every policy must return exactly the same deterministic solution set as the full technique hierarchy or the run fails.

The workflow uses Python 3.14 on `ubuntu-latest`, a fixed `PYTHONHASHSEED=0`, disabled solver rendering, and one warm-up solve. Raw JSON is uploaded as a workflow artifact. Timings are environment-sensitive; compare trends and solution equivalence rather than treating one hosted-run number as a permanent threshold.

## Depth-gate baseline — 8 August 2026

| Case | Gate | Solutions | Seconds | Speed-up vs full |
|---|---:|---:|---:|---:|
| Blank 4×4 Sudoku | full | 288 | 70.908 | 1.00× |
| Blank 4×4 Sudoku | 0 | 288 | 0.821 | 86.33× |
| Blank 4×4 Sudoku | 1 | 288 | 2.328 | 30.46× |
| Blank 4×4 Sudoku | 2 | 288 | 9.441 | 7.51× |
| Non-square 6×6 Sudoku, capped at 20 | full | 20 | 22.283 | 1.00× |
| Non-square 6×6 Sudoku, capped at 20 | 0 | 20 | 0.093 | 238.88× |
| Non-square 6×6 Sudoku, capped at 20 | 1 | 20 | 0.227 | 98.20× |
| Non-square 6×6 Sudoku, capped at 20 | 2 | 20 | 0.813 | 27.41× |
| Hard 9×9 Sudoku, first solution | full | 1 | 233.548 | 1.00× |
| Hard 9×9 Sudoku, first solution | 1 | 1 | 234.788 | 0.99× |
| Killer Sudoku A, first solution | full | 1 | 0.064 | 1.00× |
| Killer Sudoku A, first solution | 1 | 1 | 0.063 | 1.02× |

Gate `0` is extremely effective for enumeration-heavy cases because the root receives the full deduction hierarchy while recursive nodes use only the cheap tier. The two single-solution cases above were solved at the root, so the gate was never reached and timings were effectively unchanged.

Depth gating remains opt-in. Before changing the default, extend the benchmark to a broader set of genuinely backtracking-heavy Sudoku, Killer, KenKen, Futoshiki, and Latin-square cases and preserve exact solution-set checks.
