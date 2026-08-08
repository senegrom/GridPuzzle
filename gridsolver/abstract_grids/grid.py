import itertools
from array import array
from collections.abc import Callable, Iterable, Iterator, MutableMapping, MutableSequence, Sequence
from enum import Enum
from functools import partial
from numbers import Integral
from typing import Any, TypeVar, overload

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.rule_container import RuleContainer
from gridsolver.abstract_grids.trail import TrailState, TrailedSet
from gridsolver.rules.rules import Guarantee, IdxType, Rule
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.util import flatten


class SolveStatus(Enum):
    NONE = 0
    SOLVED = 1
    INVALID = -1


def _load_preprocess_str(values: str) -> str:
    if not isinstance(values, str):
        raise TypeError(f"Expected str, got {type(values).__name__}")
    return (
        values.strip()
        .replace(" ", "")
        .replace("\n", "")
        .replace("\r", "")
        .replace("\t", "")
        .replace(".", "0")
    )


def _load_preprocess_str_space_sep(values: str | Iterable[str]) -> list[str]:
    if isinstance(values, str):
        values = values.strip().split("\n")
    lines = (line for value in values for line in value.split("\n"))
    fields = (field for line in lines for field in line.split(" "))
    fields = (field for value in fields for field in value.split("\t"))
    fields = (field.strip().replace(".", "0") for field in fields)
    return [field for field in fields if field]


def _parse_load_value(raw_value: object, max_elem: int) -> int:
    """Parse one load token without permissive numeric coercion."""
    if isinstance(raw_value, bool):
        raise TypeError(f"Grid values must be integers or strings, got {raw_value!r}")

    if isinstance(raw_value, Integral):
        value = int(raw_value)
    elif isinstance(raw_value, (str, bytes, bytearray)):
        token = bytes(raw_value) if isinstance(raw_value, bytearray) else raw_value
        try:
            value = int(token)
        except ValueError:
            try:
                value = int(token, base=36)
            except ValueError as exc:
                raise ValueError(f"Cannot parse grid value {raw_value!r}") from exc
    else:
        raise TypeError(f"Grid values must be integers or strings, got {raw_value!r}")

    if not 0 <= value <= max_elem:
        raise ValueError(f"Grid value {value} is outside 0..{max_elem}")
    return value


RuleT = TypeVar("RuleT", bound=Rule)


class Grid(ImmutableGrid, RuleContainer, MutableSequence[int]):
    __hash__ = None

    def __delitem__(self, index: int) -> None:
        raise TypeError("Grid.__delitem__ is not supported")

    def insert(self, index: int, value: int) -> None:
        raise TypeError("Grid.insert is not supported")

    def __init__(self, rows: int, cols: int | None = None, max_elem: int | None = None) -> None:
        size = GridSizeContainer(rows, cols, max_elem)
        ImmutableGrid.__init__(
            self,
            [0] * size.len,
            size.rows,
            size.cols,
            size.max_elem,
        )
        RuleContainer.__init__(self)
        self._trail_state = TrailState()
        self._candidates: tuple[TrailedSet, ...] = tuple(
            TrailedSet(range(1, self.max_elem + 1), self._trail_state)
            for _ in range(self.len)
        )
        self.has_been_filled = False
        self._struct_cache: dict[str, Any] = {}
        # Guarantee-only structures survive rule churn. This matters on
        # sum-heavy puzzles where rules deactivate frequently but guarantees do
        # not; rebuilding the guarantee index on every rule update was wasted.
        self._guarantee_cache: dict[str, Any] = {}

    @overload
    def __setitem__(self, key: int, value: int) -> None:
        ...

    @overload
    def __setitem__(self, key: tuple[int, int], value: int) -> None:
        ...

    def __setitem__(self, key: IdxType, value: int) -> None:
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(f"Grid values must be integers, got {value!r}")
        value = int(value)
        if not 0 <= value <= self.max_elem:
            raise ValueError(f"Grid value {value} is outside 0..{self.max_elem}")

        index = self._get_index_from_key(key)
        if isinstance(index, slice):
            raise TypeError("Index slices are not supported for assignment")

        current = self._known[index]
        if current > 0 and value != current:
            raise ValueError(
                f"Grid assignments are monotone: cell {key!r} is already {current}, "
                f"not {value}"
            )

        self.has_been_filled = True
        if value == 0:
            return

        if current != value and self._trail_state.active:
            self._trail_state.entries.append(("known", index, current))
        self._known[index] = value
        # An assignment outside the current candidate set intentionally empties
        # the set, making the trial branch invalid without corrupting the value
        # domain stored in _known.
        self._candidates[index].intersection_update((value,))

    def __eq__(self, other: object) -> bool:
        if type(other) is not type(self):
            return False
        return (
            self.rows == other.rows
            and self.cols == other.cols
            and self.max_elem == other.max_elem
            and self._known == other._known
            and self._candidates == other._candidates
            and RuleContainer.__eq__(self, other)
        )

    def __ne__(self, other: object) -> bool:
        return not self == other

    def __deepcopy__(self, memo: MutableMapping[int, Any] | None = None) -> "Grid":
        return self.deepcopy()

    def deepcopy(self) -> "Grid":
        cls = type(self)
        result = cls.__new__(cls)
        result.rows = self.rows
        result.cols = self.cols
        result.max_elem = self.max_elem
        result.len = self.len
        result._known = array("I", self._known)
        result._trail_state = TrailState()
        result._candidates = tuple(
            TrailedSet(possible, result._trail_state) for possible in self._candidates
        )
        result.rules = self.rules.copy()
        result.rules_ia = self.rules_ia.copy()
        result.guarantees = self.guarantees.copy()
        result.guarantees_ia = self.guarantees_ia.copy()
        result.has_been_filled = self.has_been_filled
        result.name = self.name
        result._struct_cache = {}
        result._guarantee_cache = {}
        return result

    def trail_mark(self) -> int:
        """Start a reversible mutation scope and return its LIFO mark."""
        state = self._trail_state
        mark = len(state.entries)
        state.marks.append(mark)
        # Restore API-visible fill state and make empty nested marks distinct.
        state.entries.append(("filled", self.has_been_filled))
        return mark

    def trail_undo(self, mark: int) -> None:
        """Undo every grid mutation since ``mark`` in reverse order."""
        if isinstance(mark, bool) or not isinstance(mark, int):
            raise TypeError("Trail mark must be an integer returned by trail_mark()")

        state = self._trail_state
        if not state.marks or state.marks[-1] != mark:
            raise ValueError("Trail marks must be undone in LIFO order")
        state.marks.pop()

        structure_changed = False
        guarantee_changed = False
        for entry in reversed(state.entries[mark:]):
            tag = entry[0]
            if tag == "cand":
                _, possible, removed, added = entry
                set.difference_update(possible, added)
                set.update(possible, removed)
            elif tag == "known":
                _, index, old_value = entry
                self._known[index] = old_value
            elif tag == "filled":
                _, old_value = entry
                self.has_been_filled = old_value
            elif tag == "rule+":
                _, rule = entry
                self.rules.discard(rule)
                structure_changed = True
            elif tag == "rule-":
                _, rule = entry
                self.rules_ia.discard(rule)
                self.rules.add(rule)
                structure_changed = True
            elif tag == "gt+":
                _, guarantee = entry
                self.guarantees.discard(guarantee)
                structure_changed = True
                guarantee_changed = True
            elif tag == "gt-":
                _, guarantee = entry
                self.guarantees_ia.discard(guarantee)
                self.guarantees.add(guarantee)
                structure_changed = True
                guarantee_changed = True
            else:
                raise RuntimeError(f"Unknown trail entry {tag!r}")

        del state.entries[mark:]
        if structure_changed:
            self._struct_cache.clear()
        if guarantee_changed:
            self._guarantee_cache.clear()

        # Branch-local candidate fingerprints are stale after rollback.
        for name, value in vars(self).items():
            if name.endswith("_memo") and hasattr(value, "clear"):
                value.clear()

    @property
    def is_solved(self) -> bool:
        for cell, value in enumerate(self._known):
            if value <= 0 or value not in self._candidates[cell]:
                return False
        return True

    @property
    def is_valid(self) -> bool:
        return all(self._candidates)

    def get_candidates(self, key: IdxType) -> set[int]:
        index = self._get_index_from_key(key)
        if isinstance(index, slice):
            raise TypeError("Candidate slices are not supported")
        return self._candidates[index]

    def get_smallest_candidate_set_gt1(self) -> tuple[int, set[int]]:
        return min(
            (
                (cell, possible)
                for cell, possible in enumerate(self._candidates)
                if len(possible) > 1
            ),
            key=lambda item: len(item[1]),
        )

    def get_smallest_guarantee(self) -> Guarantee | None:
        if not self.guarantees:
            return None
        return min(
            self.guarantees,
            key=lambda guarantee: (
                len(guarantee.cells),
                guarantee.val,
                tuple(sorted(guarantee.cells)),
                guarantee.rows,
                guarantee.cols,
            ),
        )

    def add_rule_checked(self, rule: Rule) -> None:
        if rule not in self.rules_ia and rule not in self.rules:
            self.rules.add(rule)
            if self._trail_state.active:
                self._trail_state.entries.append(("rule+", rule))
            self._struct_cache.clear()

    def deactivate_rule(self, rule: Rule) -> None:
        self.rules.remove(rule)
        self.rules_ia.add(rule)
        if self._trail_state.active:
            self._trail_state.entries.append(("rule-", rule))
        self._struct_cache.clear()

    def add_gtee_checked(self, guarantee: Guarantee) -> None:
        if guarantee not in self.guarantees_ia and guarantee not in self.guarantees:
            self.guarantees.add(guarantee)
            if self._trail_state.active:
                self._trail_state.entries.append(("gt+", guarantee))
            self._struct_cache.clear()
            self._guarantee_cache.clear()

    def deactivate_gtee(self, guarantee: Guarantee) -> None:
        self.guarantees.remove(guarantee)
        self.guarantees_ia.add(guarantee)
        if self._trail_state.active:
            self._trail_state.entries.append(("gt-", guarantee))
        self._struct_cache.clear()
        self._guarantee_cache.clear()

    def cached_struct(self, key: str, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected by rules or guarantees."""
        try:
            return self._struct_cache[key]
        except KeyError:
            value = factory()
            self._struct_cache[key] = value
            return value

    def cached_guarantee_struct(self, key: str, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected only by the live guarantee set."""
        try:
            return self._guarantee_cache[key]
        except KeyError:
            value = factory()
            self._guarantee_cache[key] = value
            return value

    def _load_preprocess_sequence(
        self,
        values: str | Iterable[int] | Iterable[Iterable[int]],
        /,
        space_sep: bool = False,
        assert_length: int | None = None,
    ) -> str | list:
        expected_length = self.len if assert_length is None else assert_length
        if not isinstance(values, str):
            values = flatten(values)

        if isinstance(values, str):
            values = (
                _load_preprocess_str_space_sep(values)
                if space_sep
                else _load_preprocess_str(values)
            )

        if len(values) != expected_length:
            raise ValueError(f"Expected {expected_length} values, got {len(values)}")
        return values

    def load(
        self,
        values: str | Iterable[int] | Iterable[Iterable[int]],
        /,
        row_wise: bool = True,
        space_sep: bool = False,
    ) -> None:
        if self.has_been_filled:
            raise RuntimeError("Grid can only be filled once; or be used in individual access mode")

        raw_values = self._load_preprocess_sequence(values, space_sep=space_sep)
        # Parse and range-check the complete payload before the first mutation.
        # A malformed input therefore leaves the grid blank and retryable.
        parsed_values = [
            _parse_load_value(raw_value, self.max_elem)
            for raw_value in raw_values
        ]

        if row_wise:
            for index, value in enumerate(parsed_values):
                row, col = divmod(index, self.cols)
                self[(row, col)] = value
        else:
            for index, value in enumerate(parsed_values):
                self[index] = value

    def _str_header(self, detailed: bool = False) -> str:
        header = (
            f"{self.__class__.__name__}({self.rows},{self.cols})"
            f" - [{len(self.rules)} rls, {len(self.rules_ia)} ria, "
            f"{len(self.guarantees)} gts, {len(self.guarantees_ia)} gia]"
        )

        if detailed:
            active_groups = {
                name: [set(rule.cells) for rule in group]
                for name, group in itertools.groupby(
                    sorted(self.rules, key=lambda rule: type(rule).__name__),
                    lambda rule: type(rule).__name__,
                )
            }
            inactive_groups = {
                name: [set(rule.cells) for rule in group]
                for name, group in itertools.groupby(
                    sorted(self.rules_ia, key=lambda rule: type(rule).__name__),
                    lambda rule: type(rule).__name__,
                )
            }
            active = "\n".join(
                f"  {len(group):6} \t {name}" for name, group in active_groups.items()
            )
            inactive = "\n".join(
                f"  {len(group):6} \t {name}" for name, group in inactive_groups.items()
            )
            header += f"\n{active}\n  ───────\n{inactive}"

        return header

    def ext_rules(
        self,
        rule_cls: type[Rule],
        kwargs_list: list[dict[str, Any]] | None = None,
        fun_it: Iterable[Callable[[Rule], Iterable]] | None = None,
    ) -> None:
        if kwargs_list is None and fun_it is None:
            new_rules = (rule_cls(self),)
        elif kwargs_list is not None and fun_it is None:
            new_rules = (rule_cls(self, **kwargs) for kwargs in kwargs_list)
        elif kwargs_list is None and fun_it is not None:
            new_rules = (rule_cls(self, cell_creator=cell_creator) for cell_creator in fun_it)
        else:
            cell_creators = list(fun_it)
            new_rules = (
                rule_cls(self, cell_creator=cell_creator, **kwargs)
                for kwargs in kwargs_list
                for cell_creator in cell_creators
            )

        for rule in new_rules:
            self.add_rule_checked(rule)

    @property
    def row_rule_applicators(self) -> Iterator[Callable[[Rule], Iterable]]:
        return (
            partial(Rule.cells_as_row_or_column, idx=index, row_wise=True)
            for index in range(self.rows)
        )

    @property
    def col_rule_applicators(self) -> Iterator[Callable[[Rule], Iterable]]:
        return (
            partial(Rule.cells_as_row_or_column, idx=index, row_wise=False)
            for index in range(self.cols)
        )

    def get_rule_cells_of_type(self, class_: type[Rule]) -> list[frozenset[int]]:
        return [frozenset(rule.cells) for rule in self.get_rules_of_type(class_)]

    def get_rules_of_type(self, class_: type[RuleT]) -> list[RuleT]:
        return [rule for rule in self.rules if isinstance(rule, class_)]

    @property
    def unique_rule_cells(self) -> list[frozenset[int]]:
        """Cached; callers must not mutate the returned structure."""
        return self.cached_struct(
            "unique_rule_cells",
            lambda: self.get_rule_cells_of_type(ElementsAtMostOnce),
        )

    @property
    def weak_links(self) -> list[set[int]]:
        """Cached weak links originating from each cell; do not mutate."""

        def build() -> list[set[int]]:
            result = [set() for _ in range(self.len)]
            for rule in self.rules:
                if isinstance(rule, UneqRule):
                    result[rule.origin_cell].update(rule.rel_cells)
            return result

        return self.cached_struct("weak_links", build)

    @property
    def semi_strong_links(self) -> dict[int, list[set[int]]]:
        """Cached same-value semi-strong links; do not mutate."""

        def build() -> dict[int, list[set[int]]]:
            links = {
                value: [set() for _ in range(self.len)]
                for value in range(1, self.max_elem + 1)
            }
            for guarantee in self.guarantees:
                if len(guarantee.cells) == 2:
                    first, second = guarantee.cells
                    links[guarantee.val][first].add(second)
                    links[guarantee.val][second].add(first)
            return links

        return self.cached_guarantee_struct("semi_strong_links", build)

    @property
    def semi_strong_links_all(self) -> dict[int, list[set[tuple[int, int]]]]:
        links = {value: list(per_cell) for value, per_cell in self.semi_strong_links.items()}
        bivalue_cells = self.get_cells_with_candidate_length(2)
        cells_by_value = {
            value: {cell for cell, possible in bivalue_cells if value in possible}
            for value in range(1, self.max_elem + 1)
        }

        for value in range(1, self.max_elem + 1):
            for cell in range(self.len):
                links[value][cell] = {(value, target) for target in links[value][cell]}
                if cell in cells_by_value[value]:
                    other = next(iter(self._candidates[cell] - {value}))
                    links[value][cell].add((other, cell))

        return links

    @property
    def guarantee_cells_by_value(self) -> dict[int, list[frozenset[int]]]:
        """Cached; callers must not mutate the returned structure."""
        return self.cached_guarantee_struct(
            "guarantee_cells_by_value",
            lambda: {
                value: [
                    guarantee.cells
                    for guarantee in self.guarantees
                    if guarantee.val == value
                ]
                for value in range(1, self.max_elem + 1)
            },
        )

    def get_guarantees_shorter_than(self, length: int) -> list[Guarantee]:
        return [guarantee for guarantee in self.guarantees if len(guarantee.cells) <= length]

    def get_cells_with_candidate_length(self, length: int) -> list[tuple[int, set[int]]]:
        return [
            (cell, self._candidates[cell])
            for cell, possible in enumerate(self._candidates)
            if len(possible) == length
        ]


def pairs[T](values: Iterable[T]) -> Iterator[tuple[T, T]]:
    iterator = iter(values)
    while True:
        try:
            first = next(iterator)
        except StopIteration:
            return
        try:
            second = next(iterator)
        except StopIteration as exc:
            raise ValueError("Expected complete pairs, got an unpaired final value") from exc
        yield first, second
