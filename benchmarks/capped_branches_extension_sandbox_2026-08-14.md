# Capped branch fix and extension sandbox — 2026-08-14

Two correctness changes from the second agent's audit payload, reviewed and
re-implemented by hand, measured with interleaved order-alternated runs on a
drifting host (minima compared across three sessions; deltas sign-flip, so
the batch is noise-neutral):

- Positive `max_sols` no longer uses overlapping at-least-once guarantee
  branches: one solution can satisfy several such branches, and per-branch
  remainders were consumed by duplicates (a capped solve returned 9 of 15
  existing solutions on the regression case). Capped searches now branch by
  disjoint cell-values; uncapped enumeration keeps guarantee branching and
  its exact solution sets (blank-4x4-288 content key identical). The capped
  non-square 6x6 subset legitimately changes (still exactly 20 solutions).
- Extension rules (defined outside `gridsolver`) receive detached
  known/candidate copies; mutations are validated as a whole (removals
  only, in-domain, known-consistent) and either fully published or fully
  discarded. Built-in rules keep the live containers; their only new cost
  is one class-attribute read per application (`Rule._is_extension`,
  computed once per subclass in `__init_subclass__` — an earlier
  `functools.cache` call showed ~+3% and was replaced).

| Session (blank-4x4 all-288, min of 4 alternated) | Baseline | Candidate |
|---|---:|---:|
| degraded host | 51.3s | 54.2s |
| quieting host | 27.6s | 28.4s |
| quiet host | 35.3s | 34.3s |

Decision: **promote** (two confirmed bug fixes; no consistent cost signal).
