# Worker payloads without cached cage partitions: rejected, 2026-09-24

Proposal, from the third full review: under `worker_serialization()`, leave
each sum cage's cached `_partition_masks` array out of the worker root, the
way `Grid.__getstate__` already leaves out the grid-level caches. A 25x25
Killer root with 12- and 13-cell row cages pickles to 6.7 MB for every worker.

Method: branch `fix/solver-review-0924`, whose solver code on this path is
master `2003465`; CPython 3.14.5 (GIL build) on Windows, idle priority on a
loaded host; CPU by `time.process_time()`, whose resolution here is 15.6 ms.
The probe materialises every cage's partitions, as the root pass does, and
serialises the root through `solve_parallel._serialize_worker_root` with and
without them. Then, three times per variant, a fresh interpreter unpickles
the payload and reads every cage's partitions, which is what a worker's first
propagation does.

| Root | Cages | Payload with arrays | Payload without | Worker CPU with arrays: unpickle and read | Worker CPU without: unpickle and rebuild |
|---|---:|---:|---:|---:|---:|
| 25x25 Killer, 12/13-cell row cages, half the givens | 50 | 6,723,401 B | 54,238 B | < 16 ms (3 of 3) | 1.98 / 2.05 / 2.17 s |
| Killer example `b`, 9x9 | 27 | 11,008 B | 10,013 B | < 16 ms | at most 16 ms |
| Kakuro ATK `14x14-H53902-W7` | 72 | 17,558 B | 15,686 B | < 16 ms | < 16 ms |

Pickling in the parent took 15.6 ms with the arrays and less than the
resolution without them.

Decision: **rejected.** A worker unpickles the arrays in less time than the
timer resolves, and it would spend about two seconds of CPU rebuilding them
on the one kind of board where the payload is large. Once its first
propagation has touched every cage, the worker holds the same arrays either
way, so the only saving is one transient 6.7 MB payload in the parent and
the pipe. Rules keep their partitions in worker payloads.
