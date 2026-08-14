# Rule-only cache lifecycle — 2026-08-09

## Change

GridPuzzle previously used a mixed structural cache for both rule-derived and
rule-plus-guarantee structures. Adding, narrowing, or deactivating a guarantee
cleared that cache even when the cached value depended only on the active rule
set.

A dedicated reversible rule-only cache now owns:

- propagation rule watchers by cell;
- branch-peer relations;
- unique-rule cell collections;
- weak-link relations.

Rule addition or deactivation invalidates both the rule-only and mixed caches.
Guarantee churn leaves the rule-only cache intact. Trail frames preserve and
restore the exact rule-cache object at nested branch boundaries, while public
clones and process-worker payloads begin with empty detached caches.

## Profile evidence

After the immutable-rule hash optimization, `build_rule_watchers()` still ran
42,469 times during complete blank-4x4 enumeration and 9,620 times in the
non-square 6x6 cap-20 case. Guarantee churn was repeatedly discarding an index
whose inputs—the active rules—had not changed.

## Correctness gate

The candidate passed Python 3.14 suites on Linux and Windows covering:

- rule and guarantee additions/deactivations;
- nested trail rollback and cache identity restoration;
- deepcopy isolation;
- propagation watcher reuse across guarantee churn;
- solver, differential-oracle, hash-cache, and representative-example tests.

Every benchmark run returned the same deterministic solution cardinality and
SHA-256 fingerprint as the baseline.

## Timings

GitHub-hosted Ubuntu 24.04 runner, CPython 3.14.6, one process, full technique
hierarchy, and `the complete technique hierarchy`. Baseline and candidate runs were interleaved;
values are medians.

| Case | Baseline | Candidate | Change |
|---|---:|---:|---:|
| Blank 4x4 Sudoku, all 288 solutions | 22.5060 s | 22.1185 s | **1.72% faster** |
| Non-square 6x6 Sudoku, first 20 solutions | 9.2767 s | 9.2034 s | **0.79% faster** |
| Killer Sudoku example A, first solution | 0.01926 s | 0.01967 s | 0.00042 s slower |

The Killer measurement is a 19-millisecond microcase whose absolute movement
is below meaningful hosted-runner resolution. The change was accepted because
the larger workloads improved, no solution changed, and the cache lifecycle now
matches its dependencies.
