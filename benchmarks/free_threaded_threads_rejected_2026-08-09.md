# Free-threaded thread-pool candidate — rejected

Measured on 9 August 2026 using the GitHub `ubuntu-latest` image, CPython
3.14.7t with the GIL disabled, and two workers. The candidate mirrored the
production top-level branch selection and branch-order consumption, but used a
`ThreadPoolExecutor` and a detached `Grid.deepcopy()` for each task.

The gate first ran the solver API and independent differential tests under the
free-threaded interpreter. It then alternated process-first and thread-first
measurement order. Every comparison required identical solution cardinality
and an identical SHA-256 digest of the sorted complete solution set.

| Case | Solutions | Process median | Thread median | Thread change |
|---|---:|---:|---:|---:|
| 1,000 trivial one-cell branches | 1,000 | 0.254884 s | 0.102925 s | **-59.62%** |
| Blank 4x4, `max_sols=1` | 1 | 3.550965 s | 3.700678 s | **+4.22%** |
| Blank 4x4, all solutions | 288 | 18.365646 s | 19.253516 s | **+4.83%** |
| Non-square 6x6, `max_sols=20` | 20 | 14.401535 s | 15.023382 s | **+4.32%** |

The synthetic fan-out confirms that threads can remove process startup and
serialization overhead when tasks are almost empty. That does not translate to
the real recursive solver workloads: every representative solve regressed by
roughly four to five percent. Threads also cannot forcibly terminate already
running siblings after a positive solution cap is reached, unlike the Python
3.14 process-pool path.

**Decision:** retain the process pool for production top-level parallelism. Do
not auto-select threads merely because the interpreter is free-threaded. A
future specialised high-fan-out API could revisit threads only with workloads
where task execution is demonstrably dominated by process transport overhead.
