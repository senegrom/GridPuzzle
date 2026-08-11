"""Apply candidate-domain validation and remove redundant singleton mutations."""

from pathlib import Path


TRAIL = Path("gridsolver/abstract_grids/trail.py")
GRID = Path("gridsolver/abstract_grids/grid.py")
SUMRULES = Path("gridsolver/rules/sumrules.py")
RULE_CONTAINER = Path("gridsolver/abstract_grids/rule_container.py")
TEST = Path("tests/test_candidate_domain.py")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    TRAIL,
    "from dataclasses import dataclass, field\nfrom typing import Any\n",
    "from dataclasses import dataclass, field\nfrom numbers import Integral\nfrom typing import Any\n",
    "Integral import",
)
replace_once(
    TRAIL,
    "    candidate_index_token: int = 0\n",
    "    candidate_index_token: int = 0\n    candidate_max_elem: int | None = None\n",
    "shared candidate domain",
)
replace_once(
    TRAIL,
    '''    ) -> None:
        super().__init__(values)
        self._trail_state = (
            TrailState() if trail_state is None else trail_state
        )
        self._snapshot_token = snapshot_token
        self._cell = cell

    def __reduce__(self):
        return type(self), (
            tuple(self),
            self._trail_state,
            self._snapshot_token,
            self._cell,
        )

    def __repr__(self) -> str:
''',
    '''    ) -> None:
        # Construction is internal and already domain-checked by Grid. Keep
        # initialization as cheap as a normal set; mutation boundaries below
        # enforce the public candidate-domain invariant.
        super().__init__(values)
        self._trail_state = (
            TrailState() if trail_state is None else trail_state
        )
        self._snapshot_token = snapshot_token
        self._cell = cell

    def __reduce__(self):
        return type(self), (
            tuple(self),
            self._trail_state,
            self._snapshot_token,
            self._cell,
        )

    def _normalize_value(self, value: object) -> int:
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(f"Candidate values must be integers, got {value!r}")
        normalized = int(value)
        max_elem = self._trail_state.candidate_max_elem
        if max_elem is not None and not 1 <= normalized <= max_elem:
            raise ValueError(
                f"Candidate value {normalized} is outside 1..{max_elem}"
            )
        return normalized

    def _normalize_values(self, values: Iterable[int]) -> set[int]:
        return {self._normalize_value(value) for value in values}

    def __repr__(self) -> str:
''',
    "candidate normalization helpers",
)
replace_once(
    TRAIL,
    '''    def add(self, element: int) -> None:
        state = self._trail_state
        if element in self:
''',
    '''    def add(self, element: int) -> None:
        element = self._normalize_value(element)
        state = self._trail_state
        if element in self:
''',
    "candidate add validation",
)
replace_once(
    TRAIL,
    '''    def symmetric_difference_update(self, other: Iterable[int]) -> None:
        # Toggling any element always changes the set, so the only no-op is an
        # empty (deduplicated) argument.
        other = other if isinstance(other, (set, frozenset)) else set(other)
        if not other:
''',
    '''    def symmetric_difference_update(self, other: Iterable[int]) -> None:
        # Validate the complete input before mutation so a bad later value
        # cannot leave a partially updated candidate set.
        other = self._normalize_values(other)
        if not other:
''',
    "candidate xor validation",
)
replace_once(
    TRAIL,
    '''    def update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        others = tuple(
            other if isinstance(other, (set, frozenset)) else set(other)
            for other in others
        )
        if all(self.issuperset(other) for other in others):
''',
    '''    def update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        # Materialise and validate every iterable before the first mutation.
        # Candidate additions are rare; correctness at this public boundary is
        # more important than preserving permissive set coercion.
        others = tuple(self._normalize_values(other) for other in others)
        if all(self.issuperset(other) for other in others):
''',
    "candidate update validation",
)

replace_once(
    GRID,
    "        self._trail_state = TrailState()\n",
    "        self._trail_state = TrailState(candidate_max_elem=self.max_elem)\n",
    "root candidate domain",
)
replace_once(
    GRID,
    "        result._trail_state = TrailState()\n",
    "        result._trail_state = TrailState(candidate_max_elem=self.max_elem)\n",
    "clone candidate domain",
)

for label, old, new in (
    (
        "sum singleton",
        "                candidates[last_cell].clear()\n                candidates[last_cell].add(k)\n",
        "                candidates[last_cell].intersection_update((k,))\n",
    ),
    (
        "product singleton",
        "                candidates[last_cell].clear()\n                candidates[last_cell].add(k)\n",
        "                candidates[last_cell].intersection_update((k,))\n",
    ),
    (
        "distinct-sum singleton",
        "                np0.clear()\n                np0.add(k)\n",
        "                np0.intersection_update((k,))\n",
    ),
):
    replace_once(SUMRULES, old, new, label)

replace_once(
    RULE_CONTAINER,
    "        if not isinstance(other, type(self)):\n",
    "        if type(other) is not type(self):\n",
    "symmetric container equality",
)

TEST.write_text(
    '''import copy
import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.rule_container import RuleContainer


def _assert_index_exact(grid: Grid) -> None:
    expected = [0] * (grid.max_elem + 1)
    for cell, possible in enumerate(grid._candidates):
        bit = 1 << cell
        for value in possible:
            expected[value] |= bit
    assert grid.candidate_masks == tuple(expected)


@pytest.mark.parametrize("value", (0, -1, 5))
def test_candidate_add_rejects_values_outside_the_grid_domain(value):
    grid = Grid(1, 1, max_elem=4)
    possible = grid.get_candidates(0)
    before = possible.copy()

    with pytest.raises(ValueError, match=r"outside 1\\.\\.4"):
        possible.add(value)

    assert possible == before


@pytest.mark.parametrize("value", (True, False, 1.5, "2", None))
def test_candidate_add_rejects_non_integer_values(value):
    grid = Grid(1, 1, max_elem=4)
    possible = grid.get_candidates(0)
    before = possible.copy()

    with pytest.raises(TypeError, match="Candidate values must be integers"):
        possible.add(value)

    assert possible == before


def test_bulk_candidate_additions_validate_atomically():
    grid = Grid(1, 1, max_elem=4)
    possible = grid.get_candidates(0)
    possible.intersection_update({1})

    with pytest.raises(ValueError, match=r"outside 1\\.\\.4"):
        possible.update((2, 5))
    assert possible == {1}

    with pytest.raises(TypeError, match="Candidate values must be integers"):
        possible.symmetric_difference_update((2, False))
    assert possible == {1}


def test_candidate_domain_survives_clone_deepcopy_and_pickle():
    grid = Grid(1, 1, max_elem=4)
    clones = (grid.deepcopy(), copy.deepcopy(grid), pickle.loads(pickle.dumps(grid)))
    for clone in clones:
        possible = clone.get_candidates(0)
        with pytest.raises(ValueError, match=r"outside 1\\.\\.4"):
            possible.add(5)
        with pytest.raises(TypeError, match="Candidate values must be integers"):
            possible.add(True)
        assert possible == {1, 2, 3, 4}


def test_rejected_candidate_mutation_preserves_active_index_and_trail():
    grid = Grid(1, 1, max_elem=4)
    _assert_index_exact(grid)
    masks = grid._trail_state.candidate_masks
    mark = grid.trail_mark()

    with pytest.raises(ValueError, match=r"outside 1\\.\\.4"):
        grid.get_candidates(0).update((2, 5))

    assert grid._trail_state.entries == []
    assert grid._trail_state.candidate_masks is masks
    assert grid._trail_state.candidate_mask_dirty == 0
    _assert_index_exact(grid)
    grid.trail_undo(mark)


def test_rule_container_equality_is_type_symmetric():
    class ExtendedRuleContainer(RuleContainer):
        pass

    base = RuleContainer()
    extended = ExtendedRuleContainer()

    assert (base == extended) is False
    assert (extended == base) is False
    assert (base != extended) is True
    assert (extended != base) is True
''',
    encoding="utf-8",
)
