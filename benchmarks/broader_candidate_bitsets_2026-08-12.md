# Broader candidate bitsets — 2026-08-12

All macro comparisons used `depth_gate=None` and exact deterministic solution fingerprints. Runs were interleaved to reduce host drift.

| Case | Master seconds | Candidate seconds | Improvement |
|---|---:|---:|---:|
| power_action_micro | 0.427678 | 0.393283 | +8.04% |
| loaded4_all | 0.091437 | 0.089238 | +2.40% |
| blank4_cap20 | 3.444889 | 3.474340 | -0.85% |
| blank4_all | 23.634986 | 23.525980 | +0.46% |
| nonsquare6_cap20 | 9.409892 | 9.407988 | +0.02% |
| example9_first | 0.042029 | 0.041766 | +0.63% |

- Micro ratio: `0.919577` (must be <= 0.95)
- Macro geometric-mean ratio: `0.994627` (must be <= 1.0075)
- Worst macro ratio: `1.008549` (must be <= 1.03)
- Verdict: **accepted**
