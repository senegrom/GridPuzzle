# PR 11 correctness and debloat review — 2026-08-13

This review was performed against the current `master` tree and was accepted only after the complete bounded Python 3.14 suite, package build, installed CLI smoke, source compilation, Ruff checks, and interleaved default-solver benchmarks passed.

## Correctness scope

- scalar and compact-grid indexing rejects negative and out-of-range values consistently;
- CSP-Rules scanning ignores comments and quoted strings and accepts a UTF-8 BOM;
- nested one-shot iterable loading uses the same flattened token stream for inference and mutation;
- path-rule identity canonicalizes cells together with their adjacency rows;
- rule and guarantee extension hooks execute inside reversible transactional sandboxes;
- custom iterators, metadata, hashes, equality, freeze hooks, and replacement generators cannot leak unrelated grid state;
- multi-rule and replacement batches are prepared completely before live mutation or source deactivation;
- live propagation and final validation expose the same validated candidate-view boundary;
- frozen rules reject semantic assignment and deletion while remaining pickle-compatible;
- compact-grid equality includes puzzle-domain keys and family geometry;
- derived endpoint and inverse-key mappings exposed by puzzle/rule objects are immutable;
- malformed extension diagnostics remain safe even when `repr()` fails.

## Debloat scope

- legacy puzzle classes are imported lazily;
- CLI example modules load only for `--example`;
- KenKen no longer imports Sudoku indirectly;
- the raw-candidate mutation counter and its pickle compatibility path were removed after candidate views closed the bypass;
- cage dictionary entries are built once per distinct label rather than once per cell.

All solver benchmark cases used `the complete technique hierarchy` and exact deterministic solution fingerprints. Temporary export, patch, promotion, and finalization files were removed before review.
