# Complete AIC peer-edge benchmark — 2026-08-09

The candidate builds same-value AIC weak edges from the shared peer-mask
topology. It emits each unordered edge once, includes explicit UneqRule
relations and partial at-most-once groups, and retains complete-house
strong-link semantics. Depth gating remained disabled.

Decision: **reject**.
Macro geometric-mean change: **-0.03%**.

Promotion permits at most 0.5% macro geometric-mean regression, no macro
case above 2.5%, and no dense-AIC regression above 5%.

| Case | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| aic_dense | 0.021s | 0.020s | -3.22% |
| blank4_all | 29.251s | 29.114s | -0.47% |
| nonsquare6_cap20 | 11.812s | 12.208s | +3.35% |
| loaded4_all | 0.090s | 0.088s | -2.88% |

Baseline and candidate runs alternated on one Python 3.14 runner.
Every paired run checked exact solution/candidate fingerprints.
