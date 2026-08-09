# Event-driven solver optimizations — 2026-08-09

This benchmark covers four general, semantics-preserving changes:

- single-pass guarantee updates and dirty-cell rule/guarantee worklists;
- shared candidate/peer bitmasks for ALS-XZ, ALS-XY-Wing, and AIC;
- deterministic MRV tie-breaking by neighbouring candidate pressure;
- the complete technique hierarchy at every search node.

Measurements used CPython 3.14.5 on Windows 11, sequential solving, silent
logging, and two timed repetitions per microbenchmark case. Baseline `084437e`
is sequentially equivalent to the fetched master used for integration; the
intervening accepted source changes affect only process-pool execution. Every
repetition checked solution cardinality and a SHA-256 fingerprint of the
deterministic returned solution set.

| Case | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Blank 4x4 Sudoku, all 288 solutions | 49.900 s | 39.704 s | -20.4% |
| Non-square 6x6 Sudoku, first 20 solutions | 22.739 s | 15.415 s | -32.2% |

Fingerprints matched exactly:

- blank 4x4: `5aa8608840428b800a8f6d7376bff20f9cf7a37934b15de803fd55cd45edae05`;
- non-square 6x6: `9b75bededa18d5a75747022f1cc3120367906ffc0d3c0d624778419d2a4e801f`.

The final rebased source passed the complete suite: 217 tests in 1970.56 s
(32:50), including the slow pandiagonal corpus, 49x49 through 100x100 scales,
broader advanced-technique oracle states, and full 288-solution
sequential/parallel equivalence. The longest cases were pandiagonal Latin
squares at 660.89 s and the 25x25+/36x36 Sudoku group at 651.19 s; the
deterministic 100x100 scale test completed in 9.46 s.

The individual mechanisms were developed and checked in sequence. In the
same-tree non-square benchmark, adding the MRV pressure tie-break changed the
median from 19.684 s to 18.272 s with the same fingerprint, so its dynamic
scoring cost was repaid on that branch-heavy case rather than being hidden by
the combined result.
