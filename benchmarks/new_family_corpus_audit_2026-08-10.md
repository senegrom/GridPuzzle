# New-family retained corpus audit — 2026-08-10

GitHub Actions run **31420971794** executed every retained CSP-Rules `.clp` file for Hidato, Numbrix, Kakuro, and standard Slitherlink. The run used CPython 3.14, one fresh interpreter per file, `max_sols=2`, `depth_gate=None`, four deterministic shards per family, and a hard **60-second timeout per file**.

All 16 matrix jobs completed successfully. A timeout is a reported performance outcome rather than a correctness failure; any unexpected parser, validation, or solver exception would have failed its shard.

| Family | Files | Unique | Timed out | Multiple | Unsatisfiable | Errors |
|---|---:|---:|---:|---:|---:|---:|
| Hidato | 7 | 5 | 2 | 0 | 0 | 0 |
| Numbrix | 6 | 6 | 0 | 0 | 0 | 0 |
| Kakuro | 8 | 8 | 0 | 0 | 0 | 0 |
| Slitherlink | 81 | 74 | 7 | 0 | 0 | 0 |
| **Total** | **102** | **93** | **9** | **0** | **0** | **0** |

Median solve time among cases that completed uniquely:

| Family | Median | Slowest completed case |
|---|---:|---:|
| Hidato | 0.185 s | 1.246 s |
| Numbrix | 0.140 s | 0.298 s |
| Kakuro | 0.106 s | 2.034 s |
| Slitherlink | 0.499 s | 23.029 s |

## Cases reaching the 60-second limit

### Hidato

- `Examples/Hidato/Mebane/Mebane-III.10-W3.clp`
- `Examples/Hidato/Mebane/Mebane-III.7-W4.clp`

### Slitherlink

- `Examples/Slitherlink/Kakuro-online/15x15-Gen-M#1-L208.clp`
- `Examples/Slitherlink/Kakuro-online/15x15-Gen-M#2-L206.clp`
- `Examples/Slitherlink/Puzzle-loop/H15x15/1,098,496-L212.clp`
- `Examples/Slitherlink/Puzzle-loop/H15x15/1,460,363-L242.clp`
- `Examples/Slitherlink/Puzzle-loop/H15x15/4,364,030-L250.clp`
- `Examples/Slitherlink/Puzzle-loop/H15x15/4,407,009-L240.clp`
- `Examples/Slitherlink/Puzzle-loop/H15x15/9,050,649-L242.clp`

The scheduled `Extended CI` workflow repeats this audit and uploads one JSON report per family/shard. This document is the initial merge baseline; later optimizations should compare both the timeout set and completed-case timings without enabling the depth-gate experiment.
