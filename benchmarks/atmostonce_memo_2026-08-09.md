# At-most-once helper memo benchmark — 2026-08-09

The candidate records completion in the rule-only cache after pairwise
at-most-once relations are materialised. Candidate, known-value, and
guarantee churn reuse that marker; any rule addition or deactivation
invalidates it. Depth gating remained disabled.

Decision: **promote**.
Macro geometric-mean change: **-0.31%**.

Promotion required the stable-helper microcase to halve, macro geometric
mean no worse than +0.5%, no macro case above +2.5%, and exact result
fingerprints in every sample.

| Case | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| helper_repeat | 1.378s | 0.001s | -99.94% |
| blank4_all | 30.924s | 30.909s | -0.05% |
| nonsquare6_cap20 | 12.288s | 12.238s | -0.41% |
| loaded4_all | 0.100s | 0.099s | -0.88% |
| killer_example | 0.160s | 0.160s | +0.08% |

Runs alternated baseline and candidate on one Python 3.14 runner.
Every solver sample used the full default hierarchy and checked exact
deterministic solution fingerprints.
