# Additive non-house AIC visibility benchmark — 2026-08-09

The candidate keeps the established complete-house AIC edge builder and
adds only same-value peer edges not already supplied by a complete house.
Those extra edges come from explicit UneqRule constraints and partial
at-most-once groups. Standard Sudoku therefore takes an empty fast path.
Depth gating remained disabled.

Decision: **promote**.
Geometric-mean change: **-1.28%**.

Promotion permits at most 0.75% geometric-mean regression and no case
above 2.5%, with exact result fingerprints required.

| Case | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| blank4_all | 31.137s | 31.060s | -0.25% |
| nonsquare6_cap20 | 12.492s | 12.527s | +0.28% |
| loaded4_all | 0.109s | 0.105s | -3.81% |

Runs alternated baseline and candidate on one Python 3.14 runner.
Every sample checked exact deterministic solution fingerprints.
