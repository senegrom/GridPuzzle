# Thread executor on free-threaded Python 3.14, re-measured — 2026-09-24

`FREE_THREADED.md` quoted the 2026-08-12 measurement of the thread executor,
and PR #68 has since rewritten that executor onto the explicit-stack driver
with the process executor's isolation scopes. This re-measures it with
`scripts/benchmark_thread_executor.py`, through the manual "Thread executor
benchmark" workflow: GitHub's `ubuntu-latest` runner, CPython 3.14.7
free-threaded with the GIL disabled, two workers, backends alternating which
goes first in each round, and solution digests identical between the
backends in every case.

A ratio is the thread median over the process median, so below 1 means the
thread executor was faster.

| Run | Tree | Rounds | loaded4_all | blank4_cap1 | blank4_all | nonsquare6_cap20 | Geometric mean | Capped cases |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| A | pre-#68 `55d4f18` | 9 | 0.844 | 1.001 | 1.011 | 1.019 | 0.966 | 1.010 |
| B | master `a283015` | 9 | 0.842 | 1.005 | 1.020 | 1.012 | 0.967 | 1.009 |
| C | master `03681aa` | 5 | 0.839 | 1.031 | 1.052 | 1.049 | 0.988 | 1.040 |
| D | master `03681aa` | 9 | 0.847 | 1.030 | 1.038 | 1.036 | 0.984 | 1.033 |

Runs A and B ran at the same time on the same runner type, so they are the
comparison that counts: the tree before PR #68 and current master measure
the same, 0.966 against 0.967. The rewrite did not cost the thread executor
anything. Runs C and D, a few hours earlier, show how much a single run
drifts on shared runners, about three points on the long cases.

Against the 2026-08-12 record (`free_threaded_executor_2026-08-12.md`), the
thread executor no longer leads on real workloads. Its geometric mean moved
from 0.823 to about 0.97, mostly because the thread executor now takes 16%
less time on the short loaded 4x4 case instead of 53% less, while the three
long cases went from between 3% faster and 1.4% slower to 0 to 2% slower.
The pre-#68 tree shows the same, so the change came before the rewrite. The
August record does not name its machine, so solver changes since then and a
different runner are both possible causes. The 2026-08-12 acceptance limits, at most 1.03x for the
worst case and for the capped cases, hold in the same-window runs and are
exceeded by up to two points in the noisier ones; every run stays below the
4.2 to 4.8% regressions that got the 2026-08-09 thread design rejected.

Verdict: measured. The thread executor stays opt-in at rough parity with the
process pool; the process pool stays the default.

Raw results: `thread_executor_314t_2026-09-24_pre68_55d4f18.json` (A),
`thread_executor_314t_2026-09-24_master_a283015.json` (B),
`thread_executor_314t_2026-09-24_master_03681aa_a.json` (C) and
`thread_executor_314t_2026-09-24_master_03681aa_b.json` (D).
