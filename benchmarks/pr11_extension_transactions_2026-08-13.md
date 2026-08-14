# PR 11 extension transactions — 2026-08-13

All comparisons used `the complete technique hierarchy`, interleaved run order, and exact deterministic solution fingerprints.

| Case | Master seconds | Candidate seconds | Improvement |
|---|---:|---:|---:|
| loaded4_all | 0.086740 | 0.087159 | -0.48% |
| blank4_all | 27.106298 | 27.080785 | +0.09% |
| nonsquare6_cap20 | 10.919224 | 10.975044 | -0.51% |
| example9_first | 0.029670 | 0.029566 | +0.35% |

- Geometric-mean ratio: `1.001364` (must be <= 1.015)
- Worst ratio: `1.005112` (must be <= 1.05)
- Verdict: **accepted**
