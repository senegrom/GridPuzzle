# Solver benchmark baselines

Benchmarks are correctness-gated: every candidate must return exactly the same
deterministic solution set as the current solver or the run fails.

Use Python 3.14, a fixed `PYTHONHASHSEED`, disabled solver rendering, and a
warm-up solve. Timings are environment-sensitive; compare repeated runs and
solution fingerprints rather than treating one machine's result as a permanent
threshold. Dated reports in this directory record the environment and method
used for each accepted or rejected optimization.
