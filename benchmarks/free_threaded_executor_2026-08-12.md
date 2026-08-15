# Free-threaded search executor — 2026-08-12

All solver runs used `depth_gate=None` and exact deterministic solution fingerprints. Measurement order alternated by round.

| Case | Process seconds | Thread seconds | Thread improvement |
|---|---:|---:|---:|
| synthetic500 | 0.254849 | 0.049993 | +80.38% |
| loaded4_all | 0.253057 | 0.117824 | +53.44% |
| blank4_cap1 | 3.526334 | 3.422707 | +2.94% |
| blank4_all | 17.025946 | 17.257364 | -1.36% |
| nonsquare6_cap20 | 13.706386 | 13.734410 | -0.20% |

- real_geomean_ratio: `0.8231002455713955`
- real_geomean_max_ratio: `1.0`
- real_worst_ratio: `1.0135920824493805`
- real_worst_max_ratio: `1.03`
- positive_cap_ratio: `0.9706132535604408`
- positive_cap_max_ratio: `1.03`
- synthetic_ratio: `0.19616616872064108`
- Verdict: **accepted**
