"""Add a strict public candidate facade without touching solver hot mutations."""

from pathlib import Path


TRAIL = Path("gridsolver/abstract_grids/trail.py")
GRID = Path("gridsolver/abstract_grids/grid.py")
WING = Path("gridsolver/solver/solve_wing.py")
TEST = Path("tests/test_candidate_view.py")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    TRAIL,
    "from collections.abc import Iterable\n",
    "from collections.abc import Iterable, MutableSet, Set\n",
    "candidate-view collection imports",
)
marker = "\n\n_MISSING = object()\n"
text = TRAIL.read_text(encoding="utf-8")
if text.count(marker) != 1:
    raise SystemExit(f"candidate-view insertion marker: found {text.count(marker)}")
view_source = r'''

class CandidateView(MutableSet[int]):
    """Validated public view over one live candidate set.

    Solver internals mutate :class:`TrailedSet` directly. This facade keeps
    ``Grid.get_candidates`` live while rejecting Python's bool aliases,
    non-integers, and values outside the grid domain before state, journal, or
    candidate-index mutation occurs.
    """

    __slots__ = ("_target",)

    def __init__(self, target: TrailedSet) -> None:
        self._target = target

    def __contains__(self, value: object) -> bool:
        if isinstance(value, bool) or not isinstance(value, Integral):
            return False
        normalized = int(value)
        max_elem = self._target._trail_state.candidate_max_elem
        if max_elem is not None and not 1 <= normalized <= max_elem:
            return False
        return normalized in self._target

    def __iter__(self):
        return iter(self._target)

    def __len__(self) -> int:
        return len(self._target)

    def __repr__(self) -> str:
        return repr(self._target)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, CandidateView):
            return self._target == other._target
        if not isinstance(other, Set):
            return False
        try:
            normalized = self._target._normalize_values(other)
        except (TypeError, ValueError):
            return False
        return self._target == normalized

    def __ne__(self, other: object) -> bool:
        return not self == other

    def copy(self) -> set[int]:
        return self._target.copy()

    def add(self, value: int) -> None:
        self._target.add(value)

    def discard(self, value: int) -> None:
        self._target.discard(self._target._normalize_value(value))

    def remove(self, value: int) -> None:
        self._target.remove(self._target._normalize_value(value))

    def clear(self) -> None:
        self._target.clear()

    def pop(self) -> int:
        return self._target.pop()

    def update(self, *others: Iterable[int]) -> None:
        self._target.update(*others)

    def difference_update(self, *others: Iterable[int]) -> None:
        normalized = tuple(
            self._target._normalize_values(other) for other in others
        )
        self._target.difference_update(*normalized)

    def intersection_update(self, *others: Iterable[int]) -> None:
        normalized = tuple(
            self._target._normalize_values(other) for other in others
        )
        self._target.intersection_update(*normalized)

    def symmetric_difference_update(self, other: Iterable[int]) -> None:
        self._target.symmetric_difference_update(other)

    def __and__(self, other: Set[object]) -> set[int]:
        return self._target & set(other)

    def __or__(self, other: Set[int]) -> set[int]:
        return self._target | set(other)

    def __sub__(self, other: Set[object]) -> set[int]:
        return self._target - set(other)

    def __xor__(self, other: Set[int]) -> set[int]:
        return self._target ^ set(other)

    def __rand__(self, other: Set[object]) -> set[int]:
        return set(other) & self._target

    def __ror__(self, other: Set[int]) -> set[int]:
        return set(other) | self._target

    def __rsub__(self, other: Set[object]) -> set[int]:
        return set(other) - self._target

    def __rxor__(self, other: Set[int]) -> set[int]:
        return set(other) ^ self._target

    def __iand__(self, other: Iterable[int]):
        self.intersection_update(other)
        return self

    def __ior__(self, other: Iterable[int]):
        self.update(other)
        return self

    def __isub__(self, other: Iterable[int]):
        self.difference_update(other)
        return self

    def __ixor__(self, other: Iterable[int]):
        self.symmetric_difference_update(other)
        return self
'''
TRAIL.write_text(text.replace(marker, view_source + marker, 1), encoding="utf-8")

replace_once(
    GRID,
    "from collections.abc import Callable, Iterable, Iterator, MutableMapping, MutableSequence\n",
    "from collections.abc import Callable, Iterable, Iterator, MutableMapping, MutableSequence, MutableSet\n",
    "grid MutableSet import",
)
replace_once(
    GRID,
    "from gridsolver.abstract_grids.trail import TrailFrame, TrailState, TrailedSet\n",
    "from gridsolver.abstract_grids.trail import CandidateView, TrailFrame, TrailState, TrailedSet\n",
    "CandidateView import",
)
replace_once(
    GRID,
    '''    def get_candidates(self, key: IdxType) -> set[int]:
        index = self._get_index_from_key(key)
        if isinstance(index, slice):
            raise TypeError("Candidate slices are not supported")
        return self._candidates[index]
''',
    '''    def get_candidates(self, key: IdxType) -> MutableSet[int]:
        """Return a live, domain-validated view of one candidate set."""
        index = self._get_index_from_key(key)
        if isinstance(index, slice):
            raise TypeError("Candidate slices are not supported")
        return CandidateView(self._candidates[index])
''',
    "public candidate accessor",
)

wing_text = WING.read_text(encoding="utf-8")
if wing_text.count("grid.get_candidates(x)") != 2:
    raise SystemExit(
        "wing internal candidate marker: expected two, found "
        f"{wing_text.count('grid.get_candidates(x)')}"
    )
WING.write_text(
    wing_text.replace("grid.get_candidates(x)", "grid._candidates[x]"),
    encoding="utf-8",
)

TEST.write_text(
    '''import ast
from collections.abc import MutableSet
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid import Grid


INVALID_VALUES = (True, False, 0, -1, 5, 1.5, "2", None)


def _assert_untouched(grid, mark, before, masks, dirty, token):
    assert grid.get_candidates(0) == before
    assert grid._trail_state.entries == []
    assert grid._trail_state.candidate_masks is masks
    assert grid._trail_state.candidate_mask_dirty == dirty
    assert grid._trail_state.candidate_index_token == token
    grid.trail_undo(mark)


@pytest.mark.parametrize("method", ("add", "discard", "remove"))
@pytest.mark.parametrize("value", INVALID_VALUES)
def test_public_candidate_single_value_mutators_reject_invalid_inputs(
    method, value
):
    grid = Grid(1, 1, max_elem=4)
    grid.candidate_masks
    view = grid.get_candidates(0)
    before = view.copy()
    masks = grid._trail_state.candidate_masks
    dirty = grid._trail_state.candidate_mask_dirty
    token = grid._trail_state.candidate_index_token
    mark = grid.trail_mark()

    with pytest.raises((TypeError, ValueError)):
        getattr(view, method)(value)

    _assert_untouched(grid, mark, before, masks, dirty, token)


@pytest.mark.parametrize(
    "method, args",
    (
        ("update", ((2, 5),)),
        ("difference_update", ((2, False),)),
        ("intersection_update", ((1, "2"),)),
        ("symmetric_difference_update", ((2, 0),)),
    ),
)
def test_public_candidate_bulk_mutators_validate_atomically(method, args):
    grid = Grid(1, 1, max_elem=4)
    grid.candidate_masks
    view = grid.get_candidates(0)
    before = view.copy()
    masks = grid._trail_state.candidate_masks
    dirty = grid._trail_state.candidate_mask_dirty
    token = grid._trail_state.candidate_index_token
    mark = grid.trail_mark()

    with pytest.raises((TypeError, ValueError)):
        getattr(view, method)(*args)

    _assert_untouched(grid, mark, before, masks, dirty, token)


def test_public_candidate_view_preserves_live_set_operations():
    grid = Grid(1, 1, max_elem=4)
    view = grid.get_candidates(0)

    assert isinstance(view, MutableSet)
    assert view == {1, 2, 3, 4}
    assert view != {True, 2, 3, 4}
    assert view.copy() == {1, 2, 3, 4}
    assert view & {2, 5} == {2}
    assert {2, 5} & view == {2}
    assert view | {4} == {1, 2, 3, 4}
    assert view - {1, 3} == {2, 4}
    assert {1, 5} - view == {5}
    assert view ^ {3, 4} == {1, 2}
    assert True not in view
    assert 0 not in view

    view &= {1, 2, 3}
    view -= {3}
    view |= {4}
    view ^= {2, 3}
    assert view == {1, 3, 4}
    assert grid._candidates[0] == {1, 3, 4}


def test_public_candidate_view_remains_live_across_trail_rollback():
    grid = Grid(1, 1, max_elem=4)
    view = grid.get_candidates(0)
    mark = grid.trail_mark()
    view.discard(4)
    assert view == {1, 2, 3}
    grid.trail_undo(mark)
    assert view == {1, 2, 3, 4}


def test_solver_sources_do_not_use_public_candidate_view_in_hot_paths():
    solver_root = Path(__file__).resolve().parents[1] / "gridsolver" / "solver"
    offenders = []
    for path in solver_root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        if any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get_candidates"
            for node in ast.walk(tree)
        ):
            offenders.append(path.name)
    assert offenders == []
''',
    encoding="utf-8",
)
