"""Pack guarantees sharing one cell set into one watcher family."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


grid = Path("gridsolver/abstract_grids/grid.py")
replace_once(
    grid,
    '''        dirty.guarantee_rule_cells.update(
            min(guarantee.cells) for guarantee in additions
        )
''',
    '''        # A guarantee family often shares one cell set across every domain
        # value (for example a Hidato/Numbrix permutation). Compute the rule
        # wake-up representative once per distinct set rather than rescanning
        # the same N cells for all N values.
        unique_cell_sets = {guarantee.cells for guarantee in additions}
        dirty.guarantee_rule_cells.update(
            min(cells) for cells in unique_cell_sets
        )
''',
)
replace_once(
    grid,
    '''                def build_guarantee_watchers(
                ) -> tuple[tuple[Guarantee, ...], ...]:
                    watchers: list[list[Guarantee]] = [
                        [] for _ in range(self.len)
                    ]
                    for guarantee in self.guarantees:
                        for cell in guarantee.cells:
                            watchers[cell].append(guarantee)
                    return tuple(tuple(items) for items in watchers)

                by_cell = self.cached_guarantee_struct(
                    "propagation_guarantees_by_cell",
                    build_guarantee_watchers,
                )
                for cell in dirty.guarantee_cells:
                    selected.update(by_cell[cell])
''',
    '''                def build_guarantee_watchers(
                ) -> tuple[tuple[tuple[Guarantee, ...], ...], ...]:
                    # Store one packed guarantee family per distinct cell set.
                    # Global value-presence guarantees then require O(N)
                    # watcher references rather than O(N²) references.
                    groups: dict[
                        frozenset[int],
                        list[Guarantee],
                    ] = {}
                    for guarantee in self.guarantees:
                        groups.setdefault(guarantee.cells, []).append(
                            guarantee
                        )

                    watchers: list[list[tuple[Guarantee, ...]]] = [
                        [] for _ in range(self.len)
                    ]
                    for cells, guarantees in groups.items():
                        packed = tuple(guarantees)
                        for cell in cells:
                            watchers[cell].append(packed)
                    return tuple(tuple(items) for items in watchers)

                by_cell = self.cached_guarantee_struct(
                    "propagation_guarantees_by_cell",
                    build_guarantee_watchers,
                )
                for cell in dirty.guarantee_cells:
                    for guarantee_group in by_cell[cell]:
                        selected.update(guarantee_group)
''',
)

tests = Path("tests/test_path_guarantees.py")
text = tests.read_text(encoding="utf-8")
addition = '''


def test_shared_cell_guarantees_use_one_packed_watcher_family():
    grid = Grid(2)
    guarantees = value_presence_guarantees(
        range(grid.len),
        max_elem=grid.max_elem,
        rows=grid.rows,
        cols=grid.cols,
    )
    grid.add_gtees_checked(guarantees)

    assert set(grid.take_dirty_guarantees()) == set(guarantees)
    grid._candidates[0].discard(grid.max_elem)
    assert set(grid.take_dirty_guarantees()) == set(guarantees)

    watchers = grid._guarantee_cache["propagation_guarantees_by_cell"]
    assert all(len(cell_watchers) == 1 for cell_watchers in watchers)
    packed = watchers[0][0]
    assert set(packed) == set(guarantees)
    assert all(cell_watchers[0] is packed for cell_watchers in watchers)
'''
if "test_shared_cell_guarantees_use_one_packed_watcher_family" in text:
    raise SystemExit("watcher regression test already exists")
tests.write_text(text.rstrip() + addition + "\n", encoding="utf-8")
