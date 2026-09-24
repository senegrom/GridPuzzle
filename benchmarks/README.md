# Solver benchmark baselines

Benchmarks are correctness-gated: every candidate must return exactly the same
deterministic solution set as the current solver or the run fails.

Use Python 3.14, a fixed `PYTHONHASHSEED`, disabled solver rendering, and a
warm-up solve. Timings are environment-sensitive; compare repeated runs and
solution fingerprints rather than treating one machine's result as a permanent
threshold. Dated reports in this directory record the environment and method
used for each accepted or rejected optimization.

## Verdict index

| Date | Record | Verdict | Headline |
|---|---|---|---|
| 08-08 | trail_baseline | measured | trail engine perf-neutral vs pre-trail, identical solutions |
| 08-08 | default_hotpath | accepted | blank-4x4 −11.4%, nonsq −14.5% over three stages |
| 08-08 | (depth gate) | opt-in, retired 2026-08-14 | 86x at gate 0 on blank enumeration; never adopted, removed from all surfaces |
| 08-09 | silent_logging | accepted (one sub-item superseded) | −1.89% silent API use; lambda-removal later accepted via direct_action_dispatch |
| 08-09 | direct_action_dispatch | accepted | closure-free dispatch, −0.57%; supersedes silent_logging's rejection of the same idea |
| 08-09 | event_driven_solver | accepted | wake-list propagation; fixpoint-equivalent by fuzz |
| 08-09 | rule_hash_cache | accepted | 7.97M/2.10M profiled hash calls eliminated |
| 08-09 | rule_only_cache | accepted | 42,469 watcher rebuilds eliminated on blank-4x4 |
| 08-09 | atmostonce_memo | accepted | helper microcase −99.94%, macro −0.31% |
| 08-09 | aic_extra_peer_edges | accepted | missing non-house weak edges added, GM −1.28% |
| 08-09 | aic_peer_edges | rejected | full peer-edge rebuild, +3.35% worst case |
| 08-09 | chain_lazy_logging | rejected | GM −0.19%, below the acceptance bar |
| 08-09 | bounded_parallel_submission | accepted | cap-1 queue cases −11.48%/−57.26% |
| 08-09 | parallel_cap_termination | accepted | terminate_workers on met caps, −1.80% |
| 08-09 | worker_root_clone | accepted | one root per worker, −20.06% at 1,000 branches |
| 08-09 | worker_trail_reuse_rejected | rejected | mutating the worker root regressed 1-3% |
| 08-09 | free_threaded_threads_rejected | rejected | 3.14t threads −4-5% on real workloads |
| 08-10 | lazy_candidate_index (.md/.json) | accepted tradeoff | topology builds −51/−65% micro, +0.36% GM macro |
| 08-10 | new_family_corpus_audit | measured | 93/102 unique, 9 timeouts, 0 errors |
| 08-11 | immutable_partition_cache | accepted | lru tuple cache, lookups −33.30%; public partition2 keeps list[deque] |
| 08-11 | candidate_view | accepted | validated public view off the hot path, GM +0.09% |
| 08-12 | locked_candidate_pairs | accepted | pair cache + fish elimination dedup, −0.4/−1.1% |
| 08-12 | fish_prologue_dedup | accepted | shared prologue + disjoint-union, noise-neutral |
| 08-12 | broader_candidate_bitsets | accepted | locked_candidate/skyscraper/ER on bitsets, micro −8.04%, GM −0.54% |
| 08-12 | default_executor_overhead | accepted | opt-in thread-backend plumbing leaves the default path neutral, GM 0.9996 |
| 08-12 | free_threaded_executor | accepted (opt-in) | 3.14t threads: short workloads −53/−80%, heavy enumeration neutral (worst +1.4%) |
| 08-13 | pr11_correctness_review | measured | extension-hook transactions + lazy imports review record |
| 08-13 | pr11_extension_transactions | accepted | reversible extension sandboxes, GM +0.14% (neutral) |
| 08-14 | capped_branches_extension_sandbox | accepted | capped undercount fix + detached extension state, noise-neutral |
| 09-05 | global_branch_pressure (.json) | accepted | implicit whole-grid peer scope: 30x30 Slitherlink peer cache 116.6 MiB to none, cold branch pick 686 ms to 1.7 ms, identical solutions |
| 09-06 | size_guard_rejected | rejected | whole-object __setattr__ size guard, blank-4x4 +4.45%; replaced by four write-once descriptors |
| 09-06 | exact_cages (.json) | accepted as correctness repair | staircase cage partitions + write-once sizes; record shows blank-4x4 +2.53%, a local interleaved CPU-time re-measure on 09-07 showed −5.7% (neutral); Slitherlink 2x2/3x3 −21/−17% |
| 09-06 | review3_native (.md/.json) | measured | iterative partition DFS + uncapped parallel failure observer; five baseline cases match 5010564 |
| 09-06 | review3_browser (.md/.json), review3_recognition (.json) | measured | browser safety and lifecycle fixes; generated OCR scans 30/30 in both engines |
| 09-10 | four_review_fixes (.md/.json) | accepted as correctness repair | given-excluding candidates rejected, hook isolation, atomic replacement, recursion-free deep validation; noise-level timing |
| 09-10 | stack_safe_search | accepted | explicit DFS stack and side-effect-free guarantee normalization; identical fingerprints, blank-4x4 21.5 s to 20.0 s |
| 09-10 | extension_boundaries | accepted as correctness repair | twelve regressions fail on the baseline; native timing within +2.24% on three smoke cases |
| 09-11 | extension_workers | accepted as correctness repair | seven of nine worker/metadata regressions fail on the baseline; no timing claim |
| 09-21 | thread_driver_default_path (.md/.json) | accepted | thread executor rewritten onto the explicit-stack driver; default path byte-identical, sudoku4 33.54 s to 33.12 s with identical fingerprints |
| 09-23 | logging_levels (.md/.json) | accepted | solver logs at INFO/DEBUG under `gridsolver`, plus QUIET; wall GM −5.59%/+1.71% over two noisy runs, sudoku4 CPU +1.1% within sample overlap, `lg.on` guard −43% |
| 09-23 | solver_memory_pruning (.md/.json) | accepted | sum-cage partitions as byte-bounded bitmask arrays (12-cell 25x25 cage 93.8 MiB to 0.43 MiB, 25x25 Killer peak RSS 1579 MiB to 68 MiB); Kakuro total mismatches and path-puzzle pigeonholes refuted without search (empty 6x6 Hidato 1,846 to 20 nodes); identical fingerprints, Killer CPU −2.6%/−4.8% |
| 09-24 | thread_executor_314t (.md/.json) | measured | 3.14t thread/process 0.967x, the same as the pre-#68 tree in the same window (0.966x); the 08-12 lead of 0.823x went before the rewrite |
| 09-24 | worker_partition_payload_rejected | rejected | leaving cached cage partitions out of worker payloads: 25x25 Killer root 6.7 MB to 54 KB, but each worker then spends about 2 s of CPU rebuilding what it unpickles in under 16 ms |
