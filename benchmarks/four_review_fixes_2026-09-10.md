# Four review fixes — 2026-09-10

Baseline: `d771eec03312d17638bed2374450506a986154f4`. Runtime: Python 3.14.7, Linux.
Raw measurements, including the rejected implementations, are in
[four_review_fixes_2026-09-10.json](four_review_fixes_2026-09-10.json).

The fixes reject candidates that exclude a given, isolate rule registration
hooks, prepare replacement additions and source removal atomically, and validate
deep extension output chains without Python recursion. Extension preparation
restores constraint sets by reference so a failing hash or equality method is
never invoked again during cleanup. Native speculative trails and technique
profiles are unchanged.

Thirty regression cases cover contradictory and expanded given candidates under
all three profiles, iterator/metadata/freeze/hash side effects, failed source
hashing and inactive-set equality, interruptions, retries, nested rollback,
1100-deep validation, budget exhaustion, and sibling guarantee contexts.

Independent brute-force comparisons cover 450 arithmetic cases (4050 solves),
250 relation cases (2250 solves), and 150 path cases (450 solves).
The initial broad local run passed 627 tests; one process-worker test hit the
environment's AF_UNIX socket restriction. Process coverage and the large
Slitherlink regression are also exercised by the normal Linux/Windows CI suite.

## Full-solver measurements

Each sample ran `scripts/benchmark_exact_cages.py --root <worktree> --case <case>`
in a fresh interpreter, with `PYTHONHASHSEED=0` and `PYTHONPATH` removed.
The complete default technique profile, uncapped solution enumeration, root
deduction fingerprint, and real branch count were retained. Baseline and fixed
runs were interleaved, reversing their order every other pair.

There were three pairs for Sudoku enumeration. The four short cases were
remeasured with nine pairs because their initial timings fluctuated substantially.
Times below are medians in seconds. Every sample matched the baseline's exact
solution fingerprint, root deduction fingerprint, and branch count.

| Case | Baseline seconds | Fixed seconds | Change | Solutions | Branches |
|---|---:|---:|---:|---:|---:|
| killer-deadly | 0.099610 | 0.096894 | -2.73% | 1 | 0 |
| killer-hard | 0.060147 | 0.059553 | -0.99% | 1 | 0 |
| slitherlink2 | 0.005860 | 0.006327 | +7.96% | 13 | 13 |
| slitherlink3 | 0.142422 | 0.144836 | +1.70% | 213 | 213 |
| sudoku4 | 21.153417 | 21.678473 | +2.48% | 288 | 269 |

The initial implementation slowed Sudoku enumeration by 9.69%; an intermediate
revision measured +8.70%. Both were revised. The final version keeps built-in rule
application inline and enforces given/candidate agreement in the existing singles
pass, avoiding a second Python scan at every propagation-loop guard. The public
`is_valid` property still checks both nonempty candidates and agreement with givens.

The remaining small-case overhead is explicit: the 2x2 Slitherlink median adds
about 0.47 ms (+7.96%). The other medians remain within 2.73% of the baseline.
These measurements cover the five listed cases; they are not a general claim
about performance for every puzzle or third-party extension.

