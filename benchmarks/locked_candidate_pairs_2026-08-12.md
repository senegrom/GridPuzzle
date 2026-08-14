# Locked-candidate pair cache + fish elimination dedup — 2026-08-12

Two audit follow-ups measured together, interleaved in one window against
the b883e83 baseline (three rounds, medians, fresh interpreter per run,
silent logging, identical solution-set content keys):

- `locked_candidate` builds its intersecting-pair partition from
  `full_houses` only, so it moved into the rule-lifecycle cache
  (`"locked_candidate_pairs"`) instead of being rebuilt on every call.
- `solve_fish`'s four cannibal blocks and four outside-elimination loops
  collapsed into `_eliminate_outside`/`_eliminate_cannibals` with labels
  precomputed per fish size.

| Case | Baseline | Candidate | Change |
|---|---:|---:|---:|
| blank 4x4 all-288 enumeration | 23.5s | 23.4s | -0.4% |
| non-square 6x6 cap-20 | 9.9s | 9.8s | -1.1% |

Decision: **promote** (dedup with neutral-to-positive cost; the pair
cache removes per-call rebuild work that grows with house count).
