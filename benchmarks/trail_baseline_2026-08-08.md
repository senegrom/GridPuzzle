# Trail engine vs pre-trail baseline — 8 August 2026

Closes the open measurement gate from TRAIL_DESIGN.md / TODO.md: the trail
migration itself was benchmarked against the last pre-trail commit.

Method: local Windows 11 machine, Python 3.14.5, single warmed run per case,
`git worktree` of pre-trail `d38f9c9` vs trail tree `bb8d7d4`, identical
solution sets verified for every case (byte-identical content keys).

| Case | Pre-trail d38f9c9 | Trail bb8d7d4 | Delta |
|---|---:|---:|---:|
| Blank 4x4 Sudoku, all 288 solutions | 41.0 s | 41.9 s | +2% |
| Non-square 6x6 Sudoku, capped at 20 | 22.2 s | 21.2 s | -5% |

Interpretation: the trail rework on its own is performance-neutral on
enumeration workloads — the journaling overhead roughly cancels the saved
deepcopies at these grid sizes — and the subsequent hot-path series (see
default_hotpath_2026-08-08.md) repaid the overhead. The trail engine's value
is structural: reversible propagation lets recursive search, Nishio, and
forcing techniques explore speculative branches without per-branch grid
copies.

Numbers are single-run and environment-sensitive; treat the equivalence
result as the hard fact and the timings as trend-level.
