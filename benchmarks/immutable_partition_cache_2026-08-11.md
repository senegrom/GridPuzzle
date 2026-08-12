# Immutable cage-partition cache — 2026-08-11

The mutable process-global list/deque cache was replaced by bounded
`lru_cache` entries containing only tuples. Every solver comparison used
`depth_gate=None` and matched exact deterministic result fingerprints.
The cached representation is private; the historical public `partition2()`
API still returns a fresh `list[deque]`, so external callers can mutate their
result without corrupting shared solver state.

| Case | Baseline | Candidate | Change |
|---|---:|---:|---:|
| 250,000 cached partition lookups | 0.071743s | 0.047853s | -33.30% |
| 24 representative Kakuro solves | 0.181896s | 0.180994s | -0.50% |

Decision: **promote**.
