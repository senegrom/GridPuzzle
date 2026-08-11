from collections.abc import Iterable, MutableSet, Set
from dataclasses import dataclass, field
from numbers import Integral
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
    candidate_max_elem: int | None = None

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
        element = self._normalize_value(element)
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
        # Validate the complete input before mutation so a bad later value
        # cannot leave a partially updated candidate set.
        other = self._normalize_values(other)
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
        # Materialise and validate every iterable before the first mutation.
        # Candidate additions are rare; correctness at this public boundary is
        # more important than preserving permissive set coercion.
        others = tuple(self._normalize_values(other) for other in others)
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

    # Named set queries mirror the operator forms the MutableSet ABC already
    # provides, returning detached plain sets/bools — callers accustomed to
    # set's full API (issubset/union/...) would otherwise hit AttributeError.
    def issubset(self, other: Iterable[int]) -> bool:
        return self._target <= (
            other if isinstance(other, (set, frozenset)) else set(other)
        )

    def issuperset(self, other: Iterable[int]) -> bool:
        return self._target >= (
            other if isinstance(other, (set, frozenset)) else set(other)
        )

    def isdisjoint(self, other: Iterable[int]) -> bool:
        return self._target.isdisjoint(other)

    def union(self, *others: Iterable[int]) -> set[int]:
        return set(self._target).union(*others)

    def intersection(self, *others: Iterable[int]) -> set[int]:
        return set(self._target).intersection(*others)

    def difference(self, *others: Iterable[int]) -> set[int]:
        return set(self._target).difference(*others)

    def symmetric_difference(self, other: Iterable[int]) -> set[int]:
        return set(self._target).symmetric_difference(other)

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
