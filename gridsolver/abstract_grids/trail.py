from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any


type TrailEntry = tuple[Any, ...]


@dataclass(slots=True)
class TrailFrame:
    """One reversible scope, including first-touch candidate snapshots."""

    token: int
    start: int
    filled: bool
    touched_candidates: set[int] = field(default_factory=set)


@dataclass(slots=True)
class TrailState:
    """Shared journal state for one grid and all of its candidate sets."""

    entries: list[TrailEntry] = field(default_factory=list)
    marks: list[TrailFrame] = field(default_factory=list)
    next_token: int = 0

    @property
    def active(self) -> bool:
        return bool(self.marks)


class TrailedSet(set[int]):
    """A set that snapshots itself on first mutation in each trail scope."""

    __slots__ = ("_trail_state",)

    def __init__(
        self,
        values: Iterable[int] = (),
        trail_state: TrailState | None = None,
    ) -> None:
        super().__init__(values)
        self._trail_state = (
            TrailState() if trail_state is None else trail_state
        )

    def __reduce__(self):
        # Pickle memoization preserves the one shared TrailState across
        # the Grid and all candidate sets in process-pool payloads.
        return type(self), (tuple(self), self._trail_state)

    def __repr__(self) -> str:
        return repr(set(self))

    def copy(self) -> set[int]:
        # Scratch copies must never journal back to the owning grid.
        return set(self)

    def _journal_snapshot(self) -> None:
        state = self._trail_state
        frame = state.marks[-1]
        identity = id(self)
        if identity in frame.touched_candidates:
            return
        frame.touched_candidates.add(identity)
        state.entries.append(("cand", self, tuple(self)))

    def add(self, element: int) -> None:
        state = self._trail_state
        if not state.marks:
            set.add(self, element)
            return
        if element in self:
            return
        self._journal_snapshot()
        set.add(self, element)

    def clear(self) -> None:
        if not self:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.clear(self)

    def difference_update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.difference_update(self, *others)

    def discard(self, element: int) -> None:
        state = self._trail_state
        if not state.marks:
            set.discard(self, element)
            return
        if element not in self:
            return
        self._journal_snapshot()
        set.discard(self, element)

    def intersection_update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.intersection_update(self, *others)

    def pop(self) -> int:
        state = self._trail_state
        if not state.marks:
            return set.pop(self)
        if not self:
            return set.pop(self)
        self._journal_snapshot()
        return set.pop(self)

    def remove(self, element: int) -> None:
        state = self._trail_state
        if not state.marks:
            set.remove(self, element)
            return
        if element not in self:
            set.remove(self, element)
            return
        self._journal_snapshot()
        set.remove(self, element)

    def symmetric_difference_update(self, other: Iterable[int]) -> None:
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.symmetric_difference_update(self, other)

    def update(self, *others: Iterable[int]) -> None:
        if not others:
            return
        state = self._trail_state
        if state.marks:
            self._journal_snapshot()
        set.update(self, *others)

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
