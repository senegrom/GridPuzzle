# Path presence guarantees and permutation-rule debloat — 2026-08-11

Hidato and Numbrix have one variable for every value in `1..N`. Their models
now install the `N` whole-path presence guarantees during construction rather
than relying on a one-shot `ElementsAtLeastOnce` rule to emit them during the
first propagation pass.

The first direct implementation was rejected: merely pre-seeding guarantees
while retaining separate whole-grid at-most-once and path rules changed the
initial rule order and made the measured Numbrix expert solve about 14% slower.
The accepted design folds the whole-grid at-most-once invariant into
`ConsecutiveAdjacencyRule`, keeps guarantee filtering independent so guarantee
shrinks do not wake the expensive graph rule unnecessarily, and removes direct
final-solution checks for presence guarantees already implied by a complete
all-different constraint. Every solve used `depth_gate=None`.

Measurements used CPython 3.13.5 locally because the development container did
not include 3.14. GitHub CI remains the Python 3.14 authority. Each comparison
used alternating baseline/candidate order and exact deterministic solution
fingerprints.

| Case | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| Construct ten 10x10 Numbrix grids | 0.002459 s | 0.003024 s | +22.97% |
| Propagate ten blank 6x6 Numbrix grids | 0.002007 s | 0.001750 s | -12.79% |
| Solve ten small retained Hidato instances | 0.001448 s | 0.001310 s | -9.51% |
| Solve retained Numbrix expert instance | 0.058721 s | 0.055376 s | -5.70% |
| Solve loaded 4x4 Sudoku four times | 0.059516 s | 0.058841 s | -1.13% |

The construction percentage is an intentional shift of work from the first
propagation pass to model creation and is roughly 0.0006 seconds in absolute
terms for a 100-cell path. The subsequent propagation and solve measurements
recover more than that cost. The retained Hidato and Numbrix solution hashes
matched exactly; the loaded Sudoku hash was
`484be136bb2b590f81c4b23096dc1af609324b9280fa83b61969618fc785a89c` in
both trees.

Correctness coverage includes immediate guarantee availability, guarantee-only
propagation before a rule pass, the integrated permutation invariant,
independent path solution oracles, malformed-source validation, clone/pickle
behavior inherited from the existing guarantee suite, and the permanent
rule-metadata guard.

## Hidato technique-profile debloat

Hidato now uses `RULES_ONLY`, matching Numbrix. The complete path/permutation
constraint is already represented by `ConsecutiveAdjacencyRule` plus the seeded
presence guarantees, so the generic tier's whole-grid relation materialization,
tuple scans, and contradiction techniques duplicate expensive work.

All seven retained Hidato files proved unique with `depth_gate=None`; the slowest
finished in about 0.131 seconds on the local comparison machine. For the five
cases where `GENERIC` completed within the comparison limit, exact solution
fingerprints matched and `RULES_ONLY` was approximately 3x to 59x faster. The
other two generic-profile cases exceeded 30 seconds, while `RULES_ONLY` solved
them in about 0.102 and 0.131 seconds.

The retained solution fingerprints were:

- Mebane III.1: `c501eb4cd96b809e8aaeb35aaa124128bc2c3ce16c918df20e27e9af238ea859`
- Mebane III.10: `fd179ee672f7f4cbf5fbb8e8f99718257d57e2af5cfdd5e06645a3868c88033b`
- Mebane III.4: `54b9b5a41f02861868fc32853aee43f6dfd597b31178f3d43ef0921e551fb2cf`
- Mebane III.7: `c56b23d7798c916505ca66f10378f9579c8ea7b16eee5686fcb056a8995a2ae3`
- Smithsonian 3 stars: `f878549a50fac74d9361d30e979550651233d45fd226046520e0ff418afac18a`
- Smithsonian 4 stars: `aaa30897ca925b1faf8291432b02b419fb46eab1bb6aa857c4938b7cb15f7bc2`
- Smithsonian 5 stars: `b8bb783056d159285552fae1807184b01e658fd18b2fd810c7290e46f96505cf`

## Python 3.14 hosted validation

GitHub Actions run `31475013604` applied the visible source patch under CPython
3.14.6 and ran the complete bounded suite: **442 passed, 9 deselected**. The
same run checked exact deterministic solution fingerprints and measured:

| Case | Baseline | Candidate | Change |
|---|---:|---:|---:|
| Numbrix expert, unique proof | 0.082672 s | 0.082869 s | +0.24% |
| Hidato Mebane III.4, unique proof | 1.200210 s | 0.024171 s | -97.99% |
| Loaded 4x4 Sudoku, all solutions | 0.096927 s | 0.091441 s | -5.66% |
| Blank 6x6 Numbrix propagation | 0.003818 s | 0.003815 s | -0.08% |

All seven retained Hidato files also proved unique with `max_sols=2` and
`depth_gate=None`, matching their recorded SHA-256 solution fingerprints.

The production promotion run `31492361217` then applied the same visible patch
to the PR branch, installed the project under Python 3.14, passed the complete
bounded suite, and rechecked all 13 retained Hidato and Numbrix solution
fingerprints before committing the source. A final independent 2x3 blank
Numbrix oracle enumerates all 16 valid paths and requires the solver to return
that exact complete solution set.
