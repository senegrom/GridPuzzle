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
| 08-08 | (depth gate, see README section below) | accepted, opt-in | 86x at gate 0 on blank enumeration; default off |
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
