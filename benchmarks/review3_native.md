# Native review-three fixes

Partition enumeration now uses an explicit lexicographic depth-first stack with a reused prefix. The staircase bijection, complete partition set and ordering, exact matching, guarantees, derived cages and solver action queue are unchanged. No approximate filter, truncation or additional puzzle branching is introduced. Large near-extreme cases of 1,000 and 2,500 cells have one exact result without Python recursion.

Unlimited process searches observe failures from every outstanding required branch, while still consuming successful results in deterministic branch order. Positive caps deliberately preserve the prior prefix semantics: exceptions in unneeded later branches remain irrelevant. Outstanding submissions and buffered results remain bounded by the worker count; no unbounded speculative queue was introduced.

The bootstrap validation workflow passed on Python 3.14 Linux and Windows, including new real spawn/forkserver tests where the later branch fails while the first runs, the existing cancellation/cleanup tests, exact small-domain partition oracles, prior no-branching Hall cases, and clean installed wheels. See GitHub Actions run 34060288371.

`review3_native.json` compares the five retained baseline cases against commit 5010564. Root deductions, complete solution sets and branch counts match. It is a one-sample regression check, not a statistical performance benchmark. The 32 slow tests and full retained corpora were not rerun in that workflow.
