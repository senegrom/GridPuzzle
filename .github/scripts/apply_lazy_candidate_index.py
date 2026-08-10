"""Apply a lazy, dirty-cell incremental per-value candidate index."""

from pathlib import Path


TRAIL = Path("gridsolver/abstract_grids/trail.py")
GRID = Path("gridsolver/abstract_grids/grid.py")
TOPOLOGY = Path("gridsolver/solver/candidate_topology.py")
TEST = Path("tests/test_candidate_mask_index.py")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    TRAIL,
    '''    guarantee_cache: dict[str, Any]
    dirty_state: PropagationDirtyState
''',
    '''    guarantee_cache: dict[str, Any]
    dirty_state: PropagationDirtyState
    candidate_masks: list[int] | None
    candidate_value_masks: list[int] | None
    candidate_mask_dirty: int
    candidate_index_token: int
''',
    "trail frame candidate index",
)
replace_once(
    TRAIL,
    '''    next_token: int = 0
    dirty: PropagationDirtyState = field(default_factory=PropagationDirtyState)
''',
    '''    next_token: int = 0
    dirty: PropagationDirtyState = field(default_factory=PropagationDirtyState)
    # The derived index is absent until CandidateTopology first requests it.
    # Once active, mutators only mark changed cells; one later sync updates the
    # per-value masks from those cells. Branch syncs use copy-on-write and trail
    # rollback restores the parent references exactly.
    candidate_masks: list[int] | None = None
    candidate_value_masks: list[int] | None = None
    candidate_mask_dirty: int = 0
    candidate_index_token: int = 0
''',
    "trail state candidate index",
)
replace_once(
    TRAIL,
    '''    def _mark_changed(self) -> None:
        if self._cell >= 0:
            self._trail_state.dirty.mark_cell(self._cell)
''',
    '''    def _mark_changed(self) -> None:
        if self._cell < 0:
            return
        state = self._trail_state
        state.dirty.mark_cell(self._cell)
        if state.candidate_masks is not None:
            state.candidate_mask_dirty |= 1 << self._cell
''',
    "candidate dirty marker",
)

candidate_api = '''    @staticmethod
    def _candidate_values_mask(possible: set[int]) -> int:
        mask = 0
        for value in possible:
            mask |= 1 << value
        return mask

    def _activate_candidate_index(self) -> None:
        state = self._trail_state
        per_value = [0] * (self.max_elem + 1)
        per_cell: list[int] = []
        for cell, possible in enumerate(self._candidates):
            value_mask = self._candidate_values_mask(possible)
            per_cell.append(value_mask)
            cell_bit = 1 << cell
            remaining = value_mask
            while remaining:
                bit = remaining & -remaining
                per_value[bit.bit_length() - 1] |= cell_bit
                remaining ^= bit
        state.candidate_masks = per_value
        state.candidate_value_masks = per_cell
        state.candidate_mask_dirty = 0
        state.candidate_index_token = (
            state.marks[-1].token if state.marks else 0
        )

    def _sync_candidate_index(self) -> tuple[int, ...]:
        """Return exact per-value candidate-cell masks.

        The index is built only for a real consumer. Candidate mutations after
        activation merely set one dirty-cell bit; repeated changes to the same
        cell are coalesced. A speculative branch copies the index only when it
        first needs to synchronize, so branches that never build a topology pay
        no index-copy or per-value maintenance cost.
        """
        state = self._trail_state
        if state.candidate_masks is None:
            self._activate_candidate_index()
        elif state.candidate_mask_dirty:
            if state.candidate_value_masks is None:
                raise RuntimeError("Candidate index metadata is incomplete")
            if (
                state.marks
                and state.candidate_index_token != state.marks[-1].token
            ):
                state.candidate_masks = state.candidate_masks.copy()
                state.candidate_value_masks = state.candidate_value_masks.copy()
                state.candidate_index_token = state.marks[-1].token

            masks = state.candidate_masks
            cell_masks = state.candidate_value_masks
            dirty = state.candidate_mask_dirty
            while dirty:
                cell_bit = dirty & -dirty
                cell = cell_bit.bit_length() - 1
                old_values = cell_masks[cell]
                new_values = self._candidate_values_mask(
                    self._candidates[cell]
                )
                removed = old_values & ~new_values
                while removed:
                    value_bit = removed & -removed
                    value = value_bit.bit_length() - 1
                    masks[value] &= ~cell_bit
                    removed ^= value_bit
                added = new_values & ~old_values
                while added:
                    value_bit = added & -added
                    value = value_bit.bit_length() - 1
                    masks[value] |= cell_bit
                    added ^= value_bit
                cell_masks[cell] = new_values
                dirty ^= cell_bit
            state.candidate_mask_dirty = 0

        if state.candidate_masks is None:
            raise RuntimeError("Candidate index activation failed")
        return tuple(state.candidate_masks)

    @property
    def candidate_masks(self) -> tuple[int, ...]:
        """Exact per-value candidate locations; index zero is unused."""
        return self._sync_candidate_index()

'''
replace_once(
    GRID,
    '''    @overload
    def __setitem__(self, key: int, value: int) -> None:
''',
    candidate_api
    + '''    @overload
    def __setitem__(self, key: int, value: int) -> None:
''',
    "grid candidate index API",
)
replace_once(
    GRID,
    '''                guarantee_cache=self._guarantee_cache,
                dirty_state=state.dirty.copy(),
            )
''',
    '''                guarantee_cache=self._guarantee_cache,
                dirty_state=state.dirty.copy(),
                candidate_masks=state.candidate_masks,
                candidate_value_masks=state.candidate_value_masks,
                candidate_mask_dirty=state.candidate_mask_dirty,
                candidate_index_token=state.candidate_index_token,
            )
''',
    "trail frame index snapshot",
)
replace_once(
    GRID,
    '''        self._guarantee_cache = frame.guarantee_cache
        state.dirty = frame.dirty_state
''',
    '''        self._guarantee_cache = frame.guarantee_cache
        state.dirty = frame.dirty_state
        state.candidate_masks = frame.candidate_masks
        state.candidate_value_masks = frame.candidate_value_masks
        state.candidate_mask_dirty = frame.candidate_mask_dirty
        state.candidate_index_token = frame.candidate_index_token
''',
    "trail index restore",
)

replace_once(
    TOPOLOGY,
    '''        per_value = [0] * (grid.max_elem + 1)
        unsolved_mask = 0
        for cell, possible in enumerate(grid._candidates):
            if grid._known[cell] > 0:
                continue
            bit = 1 << cell
            unsolved_mask |= bit
            for value in possible:
                per_value[value] |= bit

        return cls(
''',
    '''        all_cells_mask = (1 << grid.len) - 1
        known_mask = 0
        for cell, value in enumerate(grid._known):
            if value > 0:
                known_mask |= 1 << cell
        unsolved_mask = all_cells_mask & ~known_mask
        per_value = tuple(
            mask & unsolved_mask
            for mask in grid.candidate_masks
        )

        return cls(
''',
    "topology indexed candidates",
)
replace_once(
    TOPOLOGY,
    '''            candidate_masks=tuple(per_value),
            unsolved_mask=unsolved_mask,
            all_cells_mask=(1 << grid.len) - 1,
''',
    '''            candidate_masks=per_value,
            unsolved_mask=unsolved_mask,
            all_cells_mask=all_cells_mask,
''',
    "topology indexed constructor",
)

TEST.write_text(
    '''import copy
import pickle

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.path_puzzles import Numbrix
from gridsolver.solver import atomic_solver
from gridsolver.solver.candidate_topology import CandidateTopology


def _recomputed_masks(grid: Grid) -> tuple[int, ...]:
    masks = [0] * (grid.max_elem + 1)
    for cell, possible in enumerate(grid._candidates):
        cell_bit = 1 << cell
        for value in possible:
            masks[value] |= cell_bit
    return tuple(masks)


def _assert_exact(grid: Grid) -> None:
    assert grid.candidate_masks == _recomputed_masks(grid)
    assert grid._trail_state.candidate_mask_dirty == 0


def test_index_is_absent_until_requested():
    grid = Grid(9, max_elem=9)
    grid._candidates[0].discard(1)
    grid._candidates[1].intersection_update({2, 3})

    assert grid._trail_state.candidate_masks is None
    assert grid._trail_state.candidate_value_masks is None
    assert grid._trail_state.candidate_mask_dirty == 0

    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is not None


def test_changed_cells_are_coalesced_until_next_consumer():
    grid = Grid(2, max_elem=4)
    _assert_exact(grid)
    original_masks = grid._trail_state.candidate_masks

    grid._candidates[0].discard(1)
    grid._candidates[0].discard(2)
    grid._candidates[0].add(1)
    grid._candidates[3].intersection_update({2, 4})

    assert grid._trail_state.candidate_masks is original_masks
    assert grid._trail_state.candidate_mask_dirty == (1 << 0) | (1 << 3)
    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is original_masks


def test_every_trailed_set_mutator_synchronizes_exactly():
    operations = (
        lambda values: values.discard(5),
        lambda values: values.remove(4),
        lambda values: values.difference_update({2, 3}),
        lambda values: values.intersection_update({1, 5}),
        lambda values: values.update({2, 4}),
        lambda values: values.symmetric_difference_update({1, 3}),
        lambda values: values.add(5),
        lambda values: values.pop(),
        lambda values: values.clear(),
    )
    grid = Grid(1, 1, max_elem=5)
    _assert_exact(grid)
    for operation in operations:
        operation(grid._candidates[0])
        _assert_exact(grid)
        grid._candidates[0].update(range(1, 6))
        _assert_exact(grid)


def test_nested_trails_copy_on_first_sync_and_restore_parent_references():
    grid = Grid(2, max_elem=4)
    root_masks = grid.candidate_masks
    root_mask_object = grid._trail_state.candidate_masks
    root_cells_object = grid._trail_state.candidate_value_masks

    outer = grid.trail_mark()
    grid._candidates[0].difference_update({1, 2})
    assert grid._trail_state.candidate_masks is root_mask_object
    _assert_exact(grid)
    outer_mask_object = grid._trail_state.candidate_masks
    assert outer_mask_object is not root_mask_object

    inner = grid.trail_mark()
    grid._candidates[1].intersection_update({2, 3})
    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is not outer_mask_object

    grid.trail_undo(inner)
    assert grid._trail_state.candidate_masks is outer_mask_object
    _assert_exact(grid)

    grid.trail_undo(outer)
    assert grid._trail_state.candidate_masks is root_mask_object
    assert grid._trail_state.candidate_value_masks is root_cells_object
    assert grid.candidate_masks == root_masks
    _assert_exact(grid)


def test_activation_inside_trail_is_discarded_on_undo():
    grid = Grid(1, 2, max_elem=2)
    mark = grid.trail_mark()
    grid._candidates[0].discard(2)
    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is not None

    grid.trail_undo(mark)
    assert grid._trail_state.candidate_masks is None
    assert grid._trail_state.candidate_value_masks is None
    assert grid._trail_state.candidate_mask_dirty == 0


def test_deepcopy_starts_with_a_detached_inactive_derived_index():
    grid = Grid(2, max_elem=4)
    grid._candidates[0].difference_update({1, 4})
    expected = grid.candidate_masks

    for clone in (grid.deepcopy(), copy.deepcopy(grid)):
        assert clone._trail_state is not grid._trail_state
        assert clone._trail_state.candidate_masks is None
        assert clone.candidate_masks == expected
        clone._candidates[0].add(1)
        _assert_exact(clone)
        assert clone.candidate_masks != grid.candidate_masks


def test_pickle_preserves_an_exact_detached_index():
    grid = Grid(2, max_elem=4)
    grid._candidates[0].difference_update({1, 4})
    expected = grid.candidate_masks

    clone = pickle.loads(pickle.dumps(grid))
    assert clone._trail_state is not grid._trail_state
    assert clone.candidate_masks == expected
    clone._candidates[0].add(1)
    _assert_exact(clone)
    assert clone.candidate_masks != grid.candidate_masks


def test_topology_masks_known_cells_without_mutating_index():
    grid = Grid(1, 2, max_elem=2)
    grid._candidates[0].intersection_update({2})
    before = grid.candidate_masks
    grid[0] = 2

    topology = CandidateTopology.build(grid)

    assert grid.candidate_masks == before
    assert topology.unsolved_mask == 1 << 1
    assert not topology.candidate_masks[2] & 1


def test_rules_only_profile_does_not_activate_candidate_index():
    grid = Numbrix.from_board(((0, 0), (0, 0)))

    assert list(
        atomic_solver.AtomicSolver(grid, [0], set())._solve_power_actions()
    ) == []
    assert grid._trail_state.candidate_masks is None
''',
    encoding="utf-8",
)
