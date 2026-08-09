# Trail-based propagation — design and implementation record

## Status

Implemented in August 2026. Nishio, forcing chains, forcing nets, and recursive
backtracking use reversible trail scopes instead of a complete
`Grid.deepcopy()` for every speculative branch. `Grid.deepcopy()` remains for
the public non-mutating solve boundary and for each independent process-pool
task. A process receives one serialized root grid through its initializer, then
creates each task locally through the purpose-built copy path.

The implementation is correctness-gated. No performance claim should be made
without a repeatable corpus benchmark, because Python-level journaling also
adds overhead to every candidate mutation.

## Problem

A speculative branch typically changes a small fraction of the grid before it
is discarded. Copying known values, every candidate set, rule and guarantee
sets, and cache containers at each branch made the cost proportional to the
whole state rather than to the changes made by that branch.

## Implemented architecture

### Shared trail state

Each grid owns one `TrailState`, shared by the grid and all trailed containers.
It contains:

- a stack of `TrailFrame` objects;
- an append-only entry journal for the active nested scopes;
- monotonically increasing frame tokens.

A frame records its token, the journal start position, `has_been_filled`, and
the parent structural and guarantee-cache dictionaries. Marks must be undone
in strict LIFO order.

### Candidate sets

Candidate sets are `TrailedSet` instances. On the first actual mutation within
a frame, a set records one complete snapshot and the previous snapshot token.
Further mutations in the same frame do not add duplicate snapshots. Undo uses
base `set` methods so restoration itself is not journalled.

All mutating operations used by the solver are covered: `add`, `clear`,
`difference_update`, `discard`, `intersection_update`, `pop`, `remove`,
`symmetric_difference_update`, `update`, and the in-place operators.
Algorithmic `copy()` deliberately returns a plain set.

### Known values, rules, and guarantees

Known assignments are journalled in `Grid.__setitem__`. Rule and guarantee
changes already pass through four central methods, which journal additions and
deactivations:

- `add_rule_checked`;
- `deactivate_rule`;
- `add_gtee_checked`;
- `deactivate_gtee`.

Undo replays those entries in reverse and restores the exact active/inactive
sets.

### Structural caches

A branch never clears a cache object owned by its parent frame. Structural
invalidation inside a trail scope swaps in a fresh dictionary. Undo restores
the parent dictionary references recorded by the frame. The guarantee-only
cache follows the same rule.

### Fish memoisation

Fish and finned-fish dirty fingerprints live in a `TrailedDict` tied to the
grid's `TrailState`. It snapshots once per frame, just like `TrailedSet`.
Parent fingerprints therefore survive sibling trials, while branch-only writes
and overwrites disappear on rollback. This avoids both unsafe stale skips and
the previous conservative clearing of all memo state after every trial.

`TrailedDict` covers item assignment/deletion, `clear`, `pop`, `popitem`,
`setdefault`, `update`, and `|=`. Its `copy()` returns a plain dict.

## Branch boundaries

The hot speculative paths use the same pattern:

```python
mark = grid.trail_mark()
try:
    # assign or restrict candidates, then propagate
    ...
finally:
    grid.trail_undo(mark)
```

The `finally` is mandatory: contradiction exceptions are a normal control path
in Nishio, forcing methods, and search.

Where a branch result must survive rollback, it is first converted to immutable
or detached data: an `ImmutableGrid`, a candidate intersection, a known-value
consensus, or a copied guarantee snapshot.

### Process-pool boundary

The process pool intentionally keeps a stronger isolation boundary than nested
in-process speculation:

1. the parent serializes one cache-free root grid;
2. each worker unpickles that root once in its initializer;
3. every submitted task calls `Grid.deepcopy()` on the worker root;
4. only the compact branch tuple crosses the executor queue.

This avoids repeatedly transmitting the complete puzzle while preserving
subclass copy hooks, fresh trails, empty derived caches, and complete task
isolation. Directly mutating the worker root under an outer trail was tested
with a conservative base-class guard and passed success, contradiction,
exception, optional-memo, differential, and extension-fallback checks on Linux
and Windows. It was nevertheless rejected because it regressed full blank-4x4
enumeration by 1.98%, non-square 6x6 cap-20 by 0.76%, and a 1,000-branch case by
3.11%; see `benchmarks/worker_trail_reuse_rejected_2026-08-09.md`.

## Correctness invariants

1. Trail marks are integer tokens and are undone in LIFO order only.
2. Every mutable object attached to the grid shares the same `TrailState`.
3. Restoration uses base-container methods and cannot create new journal
   entries.
4. A nested rollback restores the exact outer-branch snapshot token, allowing
   further outer mutations to remain journalled correctly.
5. Parent cache objects and fish fingerprints are restored, not merely cleared.
6. A `deepcopy` or pickle round trip creates or preserves a coherent shared
   trail state for its candidate sets and memo mapping.
7. Caller-owned grids remain unmodified by `solve()`.
8. Process-pool tasks never solve the worker initializer root in place.

## Test coverage

`tests/test_trail.py` covers:

- every candidate and mapping mutator;
- nested marks and invalid mark ordering;
- known, rule, and guarantee rollback;
- cache identity and cache lifecycle restoration;
- propagation and exception rollback;
- deepcopy and pickle coherence;
- Nishio without branch deep copies;
- forcing-chain and forcing-net consensus;
- recursive backtracking without per-node deep copies;
- deterministic sequential/parallel equivalence;
- transactional fish memo rollback.

`tests/test_solver_api.py` covers process-pool root initialisation, isolated
per-task clones, compact task payloads, bounded submission, capped worker
termination, and unlimited replenishment.

`tests/test_differential.py` independently enumerates the complete 4x4 Sudoku
solution space and checks both complete returned solution sets and candidate
soundness after an atomic deduction pass.

## Measurement record

The original trail implementation was approximately performance-neutral on the
selected enumeration cases: blank 4x4 all-288 moved from 41.0s to 41.9s, while
non-square 6x6 cap-20 moved from 22.2s to 21.2s, with identical solution sets.
See `benchmarks/trail_baseline_2026-08-08.md`.

The trail representation is therefore considered closed unless a replacement
is validated against complete solution sets and a broader corpus. The rejected
worker-root reuse experiment confirms that removing a copy can still lose once
Python-level journaling and cleanup are included.
