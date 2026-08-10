from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any


type TrailEntry = tuple[Any, ...]


@dataclass(slots=True)
class PropagationDirtyState:
    """Pending rule and guarantee work for one reversible grid state."""

    rule_cells: set[int] = field(default_factory=set)
    guarantee_cells: set[int] = field(default_factory=set)
    rules: set[Any] = field(default_factory=set)
    guarantees: set[Any] = field(default_factory=set)
    guarantee_rule_cells: set[int] = field(default_factory=set)
    all_rules: bool = True
    all_guarantees: bool = True
    guarantee_relations: bool = True

    def copy(self) -> "PropagationDirtyState":
        return type(self)(
            rule_cells=self.rule_cells.copy(),
            guarantee_cells=self.guarantee_cells.copy(),
            rules=self.rules.copy(),
            guarantees=self.guarantees.copy(),
            guarantee_rule_cells=self.guarantee_rule_cells.copy(),
            all_rules=self.all_rules,
            all_guarantees=self.all_guarantees,
            guarantee_relations=self.guarantee_relations,
        )

    def mark_cell(self, cell: int) -> None:
        self.rule_cells.add(cell)
        self.guarantee_cells.add(cell)


@dataclass(slots=True)
class TrailFrame:
    """One reversible scope and the parent caches it must restore."""

    token: int
    start: int
    filled: bool
    struct_cache: dict[str, Any]
    rule_cache: dict[str, Any]
    guarantee_cache: dict[str, Any]
    dirty_state: PropagationDirtyState
    candidate_masks: list[int] | None
    candidate_value_masks: list[int] | None
    candidate_mask_dirty: int
    candidate_index_token: int


@dataclass(slots=True)
class TrailState:
    """Shared journal state for one grid and all of its candidate sets."""

    entries: list[TrailEntry] = field(default_factory=list)
    marks: list[TrailFrame] = field(default_factory=list)
    next_token: int = 0
    dirty: PropagationDirtyState = field(default_factory=PropagationDirtyState)
    # The derived index is absent until CandidateTopology first requests it.
    # Once active, mutators only mark changed cells; one later sync updates the
    # per-value masks from those cells. Branch syncs use copy-on-write and trail
    # rollback restores the parent references exactly.
    candidate_masks: list[int] | None = None
    candidate_value_masks: list[int] | None = None
    candidate_mask_dirty: int = 0
    candidate_index_token: int = 0

    @property
    def active(self) -> bool:
        return bool(self.marks)


class TrailedSet(set[int]):
    """A set that snapshots itself once per active trail token."""

    __slots__ = ("_trail_state", "_snapshot_token", "_cell")

    def __init__(
        self,
        values: Iterable[int] = (),
        trail_state: TrailState | None = None,
        snapshot_token: int = 0,
        cell: int = -1,
    ) -> None:
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
        return repr(set(self))

    def copy(self) -> set[int]:
        return set(self)

    def _journal_snapshot(self) -> None:
        state = self._trail_state
        frame = state.marks[-1]
        if self._snapshot_token == frame.token:
            return
        previous_token = self._snapshot_token
        state.entries.append(
            ("cand", self, tuple(self), previous_token)
        )
        self._snapshot_token = frame.token

    def _mark_changed(self) -> None:
        if self._cell < 0:
            return
        state = self._trail_state
        state.dirty.mark_cell(self._cell)
        if state.candidate_masks is not None:
            state.candidate_mask_dirty |= 1 << self._cell

    def add(self, element: int) -> None:
        state = self._trail_state
        if element in self:
            return
        if state.marks:
            self._journal_snapshot()
        set.add(self, element)
        self._mark_changed()

    def clear(self) -> None:
        if not self:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.clear(self)
        self._mark_changed()

    def difference_update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        # Materialise non-set arguments once so the no-op pre-check cannot
        # consume a generator the real operation still needs. Detecting the
        # no-op BEFORE journaling avoids appending a dead full snapshot —
        # measured at >90% of these calls on enumeration workloads.
        others = tuple(
            other if isinstance(other, (set, frozenset)) else set(other)
            for other in others
        )
        if all(self.isdisjoint(other) for other in others):
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.difference_update(self, *others)
        self._mark_changed()

    def discard(self, element: int) -> None:
        state = self._trail_state
        if element not in self:
            return
        if state.marks:
            self._journal_snapshot()
        set.discard(self, element)
        self._mark_changed()

    def intersection_update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        others = tuple(
            other if isinstance(other, (set, frozenset)) else set(other)
            for other in others
        )
        if all(self.issubset(other) for other in others):
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.intersection_update(self, *others)
        self._mark_changed()

    def pop(self) -> int:
        state = self._trail_state
        if not self:
            return set.pop(self)
        if state.marks:
            self._journal_snapshot()
        result = set.pop(self)
        self._mark_changed()
        return result

    def remove(self, element: int) -> None:
        state = self._trail_state
        if element not in self:
            set.remove(self, element)
            return
        if state.marks:
            self._journal_snapshot()
        set.remove(self, element)
        self._mark_changed()

    def symmetric_difference_update(self, other: Iterable[int]) -> None:
        # Toggling any element always changes the set, so the only no-op is an
        # empty (deduplicated) argument.
        other = other if isinstance(other, (set, frozenset)) else set(other)
        if not other:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.symmetric_difference_update(self, other)
        self._mark_changed()

    def update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        others = tuple(
            other if isinstance(other, (set, frozenset)) else set(other)
            for other in others
        )
        if all(self.issuperset(other) for other in others):
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.update(self, *others)
        self._mark_changed()

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



_MISSING = object()


class TrailedDict(dict[Any, Any]):
    """A mapping that snapshots itself once per active trail token."""

    __slots__ = ("_trail_state", "_snapshot_token")

    def __init__(
        self,
        values: Any = (),
        trail_state: TrailState | None = None,
        snapshot_token: int = 0,
        **kwargs: Any,
    ) -> None:
        self._trail_state = (
            TrailState() if trail_state is None else trail_state
        )
        self._snapshot_token = snapshot_token
        dict.__init__(self)
        dict.update(self, values, **kwargs)

    def __reduce__(self):
        return type(self), (
            tuple(self.items()),
            self._trail_state,
            self._snapshot_token,
        )

    def copy(self) -> dict[Any, Any]:
        return dict(self)

    def _journal_snapshot(self) -> None:
        state = self._trail_state
        frame = state.marks[-1]
        if self._snapshot_token == frame.token:
            return
        previous_token = self._snapshot_token
        state.entries.append(
            ("map", self, tuple(self.items()), previous_token)
        )
        self._snapshot_token = frame.token

    def __setitem__(self, key: Any, value: Any) -> None:
        state = self._trail_state
        if not state.marks:
            dict.__setitem__(self, key, value)
            return
        if key in self and dict.__getitem__(self, key) == value:
            return
        self._journal_snapshot()
        dict.__setitem__(self, key, value)

    def __delitem__(self, key: Any) -> None:
        state = self._trail_state
        if not state.marks:
            dict.__delitem__(self, key)
            return
        if key not in self:
            dict.__delitem__(self, key)
            return
        self._journal_snapshot()
        dict.__delitem__(self, key)

    def clear(self) -> None:
        if not self:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        dict.clear(self)

    def pop(self, key: Any, default: Any = _MISSING) -> Any:
        state = self._trail_state
        if key not in self:
            if default is _MISSING:
                raise KeyError(key)
            return default
        if state.marks:
            self._journal_snapshot()
        return dict.pop(self, key)

    def popitem(self) -> tuple[Any, Any]:
        state = self._trail_state
        if not self:
            return dict.popitem(self)
        if state.marks:
            self._journal_snapshot()
        return dict.popitem(self)

    def setdefault(self, key: Any, default: Any = None) -> Any:
        if key in self:
            return dict.__getitem__(self, key)
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        return dict.setdefault(self, key, default)

    def update(self, *args: Any, **kwargs: Any) -> None:
        if not args and not kwargs:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        dict.update(self, *args, **kwargs)

    def __ior__(self, other: Any):
        self.update(other)
        return self
