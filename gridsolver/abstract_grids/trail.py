from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any


type TrailEntry = tuple[Any, ...]


@dataclass(slots=True)
class TrailState:
    """Shared journal state for one grid and all of its candidate sets."""

    entries: list[TrailEntry] = field(default_factory=list)
    marks: list[int] = field(default_factory=list)

    @property
    def active(self) -> bool:
        return bool(self.marks)


class TrailedSet(set[int]):
    """A set that journals mutations while its owning grid has a trail mark."""

    __slots__ = ("_trail_state",)

    def __init__(
        self,
        values: Iterable[int] = (),
        trail_state: TrailState | None = None,
    ) -> None:
        super().__init__(values)
        self._trail_state = TrailState() if trail_state is None else trail_state

    def __reduce__(self):
        # Preserve the shared TrailState when a Grid is pickled for a
        # process-pool worker. Pickle's memo keeps the state shared by
        # every candidate set and by the Grid itself.
        return type(self), (tuple(self), self._trail_state)

    def __repr__(self) -> str:
        # Keep logging and diagnostics identical to ordinary sets.
        return repr(set(self))

    def copy(self) -> set[int]:
        # Algorithmic scratch copies should not journal back to the grid.
        return set(self)

    def _record_change(self, before: frozenset[int]) -> None:
        after = frozenset(self)
        removed = before - after
        added = after - before
        if removed or added:
            self._trail_state.entries.append(("cand", self, removed, added))

    def _mutate(self, operation: Callable[..., Any], /, *args: Any) -> None:
        if not self._trail_state.active:
            operation(self, *args)
            return
        before = frozenset(self)
        operation(self, *args)
        self._record_change(before)

    def add(self, element: int) -> None:
        self._mutate(set.add, element)

    def clear(self) -> None:
        self._mutate(set.clear)

    def difference_update(self, *others: Iterable[int]) -> None:
        self._mutate(set.difference_update, *others)

    def discard(self, element: int) -> None:
        self._mutate(set.discard, element)

    def intersection_update(self, *others: Iterable[int]) -> None:
        self._mutate(set.intersection_update, *others)

    def pop(self) -> int:
        if not self._trail_state.active:
            return set.pop(self)
        before = frozenset(self)
        value = set.pop(self)
        self._record_change(before)
        return value

    def remove(self, element: int) -> None:
        self._mutate(set.remove, element)

    def symmetric_difference_update(self, other: Iterable[int]) -> None:
        self._mutate(set.symmetric_difference_update, other)

    def update(self, *others: Iterable[int]) -> None:
        self._mutate(set.update, *others)

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
