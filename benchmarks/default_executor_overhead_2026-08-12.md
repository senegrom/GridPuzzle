# Default executor overhead — 2026-08-12

All solver runs used `depth_gate=None` and exact deterministic solution fingerprints. Measurement order alternated by round.

| Case | Master seconds | Candidate seconds | Candidate improvement |
|---|---:|---:|---:|
| loaded4_all | 0.114343 | 0.113870 | +0.41% |
| blank4_cap20 | 4.527219 | 4.409733 | +2.60% |
| nonsquare6_cap20 | 12.295939 | 12.625758 | -2.68% |
| example9_first | 0.055528 | 0.055662 | -0.24% |

- macro_geomean_ratio: `0.9996080890069506`
- macro_geomean_max_ratio: `1.01`
- macro_worst_ratio: `1.0268233742984167`
- macro_worst_max_ratio: `1.03`
- Verdict: **accepted**
