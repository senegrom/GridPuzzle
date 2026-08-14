# Lazy chain diagnostics benchmark — 2026-08-09

The candidate defers coordinate formatting and reconstructed chain paths
until a configured logger can emit rule-level diagnostics. Deduction order,
candidate mutations, the full ungated technique hierarchy, and solution limits
are unchanged.

Decision: **reject**.
Geometric-mean change: **-0.19%**.

Promotion required at least a 0.25% geometric-mean improvement, no case
worse than 2.5%, and at least one case improving by 1%.

| Case | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| blank4_all | 28.756s | 28.968s | +0.74% |
| nonsquare6_cap20 | 12.214s | 12.112s | -0.83% |
| loaded4 | 0.801s | 0.797s | -0.47% |

Runs alternated baseline/candidate order on the same Python 3.14 runner.
Each benchmark command was an existing correctness test; the candidate
also passed differential and per-technique soundness checks before timing.
