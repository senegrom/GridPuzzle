"""Update development notes for the accepted lazy candidate index."""

from pathlib import Path

path = Path("DEVELOPMENT.md")
text = path.read_text(encoding="utf-8")
old_topology = '''**AIC and ALS share one candidate topology snapshot.**
At a stalled `FULL` state, full houses, peer bitmasks, per-value candidate locations, ALS sets, and restricted-common links are built once for the adjacent ALS-XZ and ALS-XY-Wing actions. AIC reuses the same immutable topology if no intervening action changes the grid. Any action hit ends that power-action pass, so a changed state always rebuilds the snapshot.
'''
new_topology = '''**AIC and ALS share one candidate topology snapshot.**
At a stalled `FULL` state, full houses, peer bitmasks, per-value candidate locations, ALS sets, and restricted-common links are built once for the adjacent ALS-XZ and ALS-XY-Wing actions. AIC reuses the same immutable topology if no intervening action changes the grid. Any action hit ends that power-action pass, so a changed state always rebuilds the snapshot.

Per-value candidate locations come from a lazy dirty-cell index. The index is absent until a real topology consumer first requests it. Once active, candidate mutations mark only their cell; the next topology request updates masks for the changed cells and coalesces repeated mutations. A speculative branch copies the derived index only on its first synchronization, while trail rollback restores the exact parent references and dirty state. Explicit grid clones start with the index inactive because it is derived data.
'''
old_performance = '''The separate per-value candidate-mask PR follows this policy: eager maintenance made topology construction much faster but added approximately 2% geometric-mean cost to measured full solves. It remains experimental until a lazy or selective design clears the macro regression gate after rebasing on the new-family implementation.
'''
new_performance = '''The first eager-global per-value candidate-mask design was rejected: it made topology construction faster but added approximately 2% geometric-mean cost to measured full solves and roughly doubled mutation/rollback cost. The accepted lazy dirty-cell design is recorded in `benchmarks/lazy_candidate_index_2026-08-10.md`. It reduced unchanged topology builds by 51.28% and dirty-cell topology/rollback rounds by 64.61%. Cold pre-activation mutations changed by +0.38%; the full-solver geometric mean changed by +0.36%, with a worst measured case of +1.62%. Every comparison used `depth_gate=None` and exact deterministic solution fingerprints.
'''
for label, old, new in (
    ("candidate topology documentation", old_topology, new_topology),
    ("candidate index performance history", old_performance, new_performance),
):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
