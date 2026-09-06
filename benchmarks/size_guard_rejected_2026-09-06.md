# Rejected whole-object size guard — 2026-09-06

The first size-immutability fix used `GridSizeContainer.__setattr__` and
`__delattr__`, allowing an initial assignment of rows/cols/max_elem/len but
rejecting subsequent mutation or deletion. It preserved all tested deductions,
solutions and branch counts, and passed 598 bounded tests on Python 3.14.7.

However, the setter also intercepted every unrelated Grid/cache mutation.
Three alternating before/after runs of complete blank-4x4 Sudoku enumeration
measured median 32.637060141 s before versus 34.089272615 s after (+4.45%).
Do not reintroduce this broad interception as a supposedly cost-free guard.

The replacement uses write-once descriptors only for the four size fields.
They intentionally have no Python getter and preserve the instance-dictionary
storage/pickle layout; other assignments still use object.__setattr__.
Final before/after measurements are in `exact_cages_2026-09-06.json`.

Original attempted implementation and raw results: commit
`d4e185d779c317540e62e322a2ed2f60da8e31f9`. Initial validation run:
`34046183354`. The benchmark's root-deduction preflight happens before timing,
so some immutable rule caches may already be warm. Comparisons use the same
protocol in both modes and do not claim cold-start or universal speedups.
