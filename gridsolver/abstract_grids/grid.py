import itertools
from array import array
from collections.abc import Callable, Iterable, Iterator, MutableMapping, MutableSequence
from enum import Enum
from functools import partial
from numbers import Integral
from typing import Any, TypeVar, overload

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.rule_container import RuleContainer
from gridsolver.abstract_grids.trail import TrailFrame, TrailState, TrailedSet
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
    """Split whitespace-delimited tokens without rewriting token contents."""
    if isinstance(values, str):
        parts = (values,)
    else:
        try:
            parts = tuple(values)
        except TypeError as exc:
            raise TypeError(
                "Space-separated input must be str or an iterable of strings"
            ) from exc
        if any(not isinstance(part, str) for part in parts):
            raise TypeError(
                "Space-separated input iterables must contain only strings"
            )

    fields = (field for part in parts for field in part.split())
    return ["0" if field == "." else field for field in fields]


def _parse_load_value(raw_value: object, max_elem: int) -> int:
    """Parse one load token without permissive numeric coercion.

    Compact puzzle strings translate ``.`` to zero before this function.
    Iterable token routes must accept the same blank marker explicitly so
    string, nested-list, generator, bytes, and bytearray inputs agree.
    """
    if isinstance(raw_value, bool):
        raise TypeError(
            f"Grid values must be integers or strings, got {raw_value!r}"
        )

    if isinstance(raw_value, Integral):
        value = int(raw_value)
    elif isinstance(raw_value, (str, bytes, bytearray)):
        token = (
            bytes(raw_value)
            if isinstance(raw_value, bytearray)
            else raw_value
        )
        token = token.strip()
        blank = b"." if isinstance(token, bytes) else "."
        if token == blank:
            value = 0
        else:
            try:
                value = int(token)
            except ValueError:
                try:
                    value = int(token, base=36)
                except ValueError as exc:
                    raise ValueError(
                        f"Cannot parse grid value {raw_value!r}"
                    ) from exc
    else:
        raise TypeError(
            f"Grid values must be integers or strings, got {raw_value!r}"
        )

    if not 0 <= value <= max_elem:
        raise ValueError(f"Grid value {value} is outside 0..{max_elem}")
    return value

def _boolean_option(name: str, value: object) -> bool:
    if not isinstance(value, bool):
        raise TypeError(f"{name} must be a boolean")
    return value


def _validate_load_options(
    row_wise: object,
    space_sep: object,
) -> tuple[bool, bool]:
    return (
        _boolean_option("row_wise", row_wise),
        _boolean_option("space_sep", space_sep),
    )


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
            TrailedSet(
                range(1, self.max_elem + 1),
                self._trail_state,
                cell=cell,
            )
            for cell in range(self.len)
        )
        self.has_been_filled = False
        self._struct_cache: dict[str, Any] = {}
        # Rule-only structures survive guarantee churn. This matters during
        # speculative propagation, where guarantees narrow and deactivate far
        # more frequently than the active rule graph changes.
        self._rule_cache: dict[str, Any] = {}
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
        if current != value:
            self._trail_state.dirty.mark_cell(index)
        self._known[index] = value
        # An assignment outside the current candidate set intentionally empties
        # the set, making the trial branch invalid without corrupting the value
        # domain stored in _known. Avoid journaling a no-op when a singleton
        # candidate is merely promoted to a known value.
        possible = self._candidates[index]
        if len(possible) != 1 or value not in possible:
            possible.intersection_update((value,))

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

    def _copy_extra_state_to(self, result: "Grid") -> None:
        """Copy subclass-owned instance state into ``result``.

        The base implementation owns all state required by the built-in
        grid classes. Extension classes that add mutable instance fields
        should override this hook and detach those fields explicitly.
        Solver caches and trail journals must never be copied here.
        """

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
            TrailedSet(possible, result._trail_state, cell=cell)
            for cell, possible in enumerate(self._candidates)
        )
        result.rules = self.rules.copy()
        result.rules_ia = self.rules_ia.copy()
        result.guarantees = self.guarantees.copy()
        result.guarantees_ia = self.guarantees_ia.copy()
        result.has_been_filled = self.has_been_filled
        result.name = self.name
        result._struct_cache = {}
        result._rule_cache = {}
        result._guarantee_cache = {}
        self._copy_extra_state_to(result)
        return result

    def trail_mark(self) -> int:
        """Start a reversible mutation scope and return its LIFO token."""
        state = self._trail_state
        state.next_token += 1
        token = state.next_token
        state.marks.append(
            TrailFrame(
                token=token,
                start=len(state.entries),
                filled=self.has_been_filled,
                struct_cache=self._struct_cache,
                rule_cache=self._rule_cache,
                guarantee_cache=self._guarantee_cache,
                dirty_state=state.dirty.copy(),
            )
        )
        return token

    def trail_undo(self, mark: int) -> None:
        """Undo every grid mutation in the matching innermost scope."""
        if isinstance(mark, bool) or not isinstance(mark, int):
            raise TypeError(
                "Trail mark must be an integer returned by trail_mark()"
            )

        state = self._trail_state
        if not state.marks or state.marks[-1].token != mark:
            raise ValueError("Trail marks must be undone in LIFO order")
        frame = state.marks.pop()

        for entry in reversed(state.entries[frame.start:]):
            tag = entry[0]
            if tag == "cand":
                _, possible, original, previous_token = entry
                set.clear(possible)
                set.update(possible, original)
                possible._snapshot_token = previous_token
            elif tag == "map":
                _, mapping, original, previous_token = entry
                dict.clear(mapping)
                dict.update(mapping, original)
                mapping._snapshot_token = previous_token
            elif tag == "known":
                _, index, old_value = entry
                self._known[index] = old_value
            elif tag == "rule+":
                _, rule = entry
                self.rules.discard(rule)
            elif tag == "rule-":
                _, rule = entry
                self.rules_ia.discard(rule)
                self.rules.add(rule)
            elif tag == "gt+":
                _, guarantee = entry
                self.guarantees.discard(guarantee)
            elif tag == "gt-":
                _, guarantee = entry
                self.guarantees_ia.discard(guarantee)
                self.guarantees.add(guarantee)
            else:
                raise RuntimeError(f"Unknown trail entry {tag!r}")

        del state.entries[frame.start:]
        self.has_been_filled = frame.filled
        self._struct_cache = frame.struct_cache
        self._rule_cache = frame.rule_cache
        self._guarantee_cache = frame.guarantee_cache
        state.dirty = frame.dirty_state



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
        def build_branch_peers() -> tuple[frozenset[int], ...]:
            peers = [set() for _ in range(self.len)]
            for rule in self.rules:
                rule_cells = set(rule.cells)
                for cell in rule.cells:
                    peers[cell].update(rule_cells - {cell})
            return tuple(frozenset(items) for items in peers)

        branch_peers = self.cached_rule_struct(
            "branch_peers",
            build_branch_peers,
        )
        best: tuple[tuple[int, int, int], int, set[int]] | None = None
        for cell, possible in enumerate(self._candidates):
            if len(possible) <= 1:
                continue
            pressure = sum(
                len(possible & self._candidates[peer])
                for peer in branch_peers[cell]
                if self._known[peer] == 0
            )
            key = (len(possible), -pressure, cell)
            if best is None or key < best[0]:
                best = key, cell, possible

        if best is None:
            raise ValueError("No cell has more than one candidate")
        return best[1], best[2]

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


    def _invalidate_struct_cache(self) -> None:
        # A trail frame owns the parent cache object. Branch invalidation
        # swaps in a new dictionary instead of destroying that object.
        if self._trail_state.active:
            self._struct_cache = {}
        else:
            self._struct_cache.clear()

    def _invalidate_rule_cache(self) -> None:
        if self._trail_state.active:
            self._rule_cache = {}
        else:
            self._rule_cache.clear()

    def _invalidate_guarantee_cache(self) -> None:
        if self._trail_state.active:
            self._guarantee_cache = {}
        else:
            self._guarantee_cache.clear()

    def _validate_rule(self, rule: Rule) -> tuple[Rule, tuple[int, ...]]:
        """Validate one rule without hashing, freezing, or changing it."""
        if not isinstance(rule, Rule):
            raise TypeError("Rules must be Rule instances")
        if (rule._rows, rule._cols) != (self.rows, self.cols):
            raise ValueError(
                f"Rule dimensions {(rule._rows, rule._cols)} do not match "
                f"grid dimensions {(self.rows, self.cols)}"
            )
        if rule._max_elem != self.max_elem:
            raise ValueError(
                f"Rule value domain 1..{rule._max_elem} does not match "
                f"grid value domain 1..{self.max_elem}"
            )

        try:
            raw_cells = tuple(rule.cells)
        except TypeError as exc:
            raise TypeError("Rule cells must be an iterable of integers") from exc
        if not raw_cells:
            raise ValueError("Rule cells must not be empty")

        cells: list[int] = []
        for raw_cell in raw_cells:
            if isinstance(raw_cell, bool) or not isinstance(raw_cell, Integral):
                raise TypeError("Rule cells must be integers")
            cell = int(raw_cell)
            if not 0 <= cell < self.len:
                raise ValueError(f"Rule cell {cell} is outside 0..{self.len - 1}")
            cells.append(cell)
        if len(cells) != len(set(cells)):
            raise ValueError("Rule cells must be unique")
        if rule.len_cells != len(cells):
            raise ValueError(
                f"Rule len_cells={rule.len_cells!r} does not match "
                f"its {len(cells)} cells"
            )
        return rule, tuple(cells)

    def add_rules_checked(self, rules: Iterable[Rule]) -> None:
        """Validate a complete rule batch, then commit it in one mutation.

        Validation deliberately finishes before canonicalising or hashing any
        rule. Hashing freezes Rule objects, so a malformed later item must not
        make a valid caller-owned prefix immutable when the batch is rejected.
        """
        staged = [self._validate_rule(rule) for rule in rules]

        # Canonicalisation is safe only after every item has validated. The
        # following membership checks hash (and therefore freeze) the rules.
        for rule, canonical_cells in staged:
            if rule.cells != canonical_cells:
                rule.cells = canonical_cells

        additions: list[Rule] = []
        seen: set[Rule] = set()
        for rule, _ in staged:
            if (
                rule in seen
                or rule in self.rules_ia
                or rule in self.rules
            ):
                continue
            seen.add(rule)
            additions.append(rule)

        if not additions:
            return
        self.rules.update(additions)
        self._trail_state.dirty.rules.update(additions)
        if self._trail_state.active:
            self._trail_state.entries.extend(
                ("rule+", rule) for rule in additions
            )
        self._invalidate_rule_cache()
        self._invalidate_struct_cache()

    def add_rule_checked(self, rule: Rule) -> None:
        self.add_rules_checked((rule,))

    def deactivate_rule(self, rule: Rule) -> None:
        self.rules.remove(rule)
        self.rules_ia.add(rule)
        self._trail_state.dirty.rules.discard(rule)
        if self._trail_state.active:
            self._trail_state.entries.append(("rule-", rule))
        self._invalidate_rule_cache()
        self._invalidate_struct_cache()

    def _normalize_guarantee(self, guarantee: Guarantee) -> Guarantee:
        """Validate and canonicalise one guarantee before set membership.

        Guarantee is a lightweight NamedTuple and can therefore be
        constructed with mutable or malformed fields by extension code.
        Normalising first prevents unhashable values from reaching the
        live sets and keeps every downstream index inside the grid.

        Rule-emitted guarantees are always exactly typed, and most are
        duplicates dropped right after this call, so the exact-type fast
        path skips the ABC checks and the list/set/frozenset rebuild
        (12% of a killer solve profile). Anything not exactly typed --
        including bools, floats equal to ints, and Guarantee subclasses --
        still takes the full validation path below.
        """
        if type(guarantee) is Guarantee:
            value = guarantee.val
            cells = guarantee.cells
            if (
                type(value) is int
                and type(cells) is frozenset
                and type(guarantee.rows) is int
                and type(guarantee.cols) is int
                and 1 <= value <= self.max_elem
                and guarantee.rows == self.rows
                and guarantee.cols == self.cols
                and cells
                and all(type(cell) is int and 0 <= cell < self.len for cell in cells)
            ):
                return guarantee
        if not isinstance(guarantee, Guarantee):
            raise TypeError("Guarantees must be Guarantee instances")

        value = guarantee.val
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError("Guarantee values must be integers")
        value = int(value)
        if not 1 <= value <= self.max_elem:
            raise ValueError(
                f"Guarantee value {value} is outside 1..{self.max_elem}"
            )

        dimensions: list[int] = []
        for name, raw_dimension in (
            ("rows", guarantee.rows),
            ("cols", guarantee.cols),
        ):
            if (
                isinstance(raw_dimension, bool)
                or not isinstance(raw_dimension, Integral)
            ):
                raise TypeError(f"Guarantee {name} must be an integer")
            dimensions.append(int(raw_dimension))
        rows, cols = dimensions
        if (rows, cols) != (self.rows, self.cols):
            raise ValueError(
                f"Guarantee dimensions {(rows, cols)} do not match "
                f"grid dimensions {(self.rows, self.cols)}"
            )

        if isinstance(guarantee.cells, (str, bytes, bytearray)):
            raise TypeError("Guarantee cells must be an iterable of integers")
        try:
            raw_cells = list(guarantee.cells)
        except TypeError as exc:
            raise TypeError(
                "Guarantee cells must be an iterable of integers"
            ) from exc
        if not raw_cells:
            raise ValueError("Guarantee cells must not be empty")

        cells: set[int] = set()
        for raw_cell in raw_cells:
            if isinstance(raw_cell, bool) or not isinstance(raw_cell, Integral):
                raise TypeError("Guarantee cells must be integers")
            cell = int(raw_cell)
            if not 0 <= cell < self.len:
                raise ValueError(
                    f"Guarantee cell {cell} is outside 0..{self.len - 1}"
                )
            cells.add(cell)

        return Guarantee(value, frozenset(cells), rows, cols)

    def add_gtees_checked(self, guarantees: Iterable[Guarantee]) -> None:
        """Validate a complete guarantee batch, then commit it atomically."""
        additions: list[Guarantee] = []
        seen: set[Guarantee] = set()
        for guarantee in guarantees:
            guarantee = self._normalize_guarantee(guarantee)
            if (
                guarantee in seen
                or guarantee in self.guarantees_ia
                or guarantee in self.guarantees
            ):
                continue
            seen.add(guarantee)
            additions.append(guarantee)

        if not additions:
            return
        self.guarantees.update(additions)
        dirty = self._trail_state.dirty
        dirty.guarantees.update(additions)
        dirty.guarantee_rule_cells.update(
            min(guarantee.cells) for guarantee in additions
        )
        dirty.guarantee_relations = True
        if self._trail_state.active:
            self._trail_state.entries.extend(
                ("gt+", guarantee) for guarantee in additions
            )
        self._invalidate_struct_cache()
        self._invalidate_guarantee_cache()

    def add_gtee_checked(self, guarantee: Guarantee) -> None:
        self.add_gtees_checked((guarantee,))

    def deactivate_gtee(self, guarantee: Guarantee) -> None:
        self.guarantees.remove(guarantee)
        self.guarantees_ia.add(guarantee)
        self._trail_state.dirty.guarantees.discard(guarantee)
        if self._trail_state.active:
            self._trail_state.entries.append(("gt-", guarantee))
        self._invalidate_struct_cache()
        self._invalidate_guarantee_cache()

    def cached_struct(self, key: str, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected by rules or guarantees."""
        try:
            return self._struct_cache[key]
        except KeyError:
            value = factory()
            self._struct_cache[key] = value
            return value

    def cached_rule_struct(self, key: Any, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected only by the live rule set."""
        try:
            return self._rule_cache[key]
        except KeyError:
            value = factory()
            self._rule_cache[key] = value
            return value

    def cached_guarantee_struct(self, key: Any, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected only by the live guarantee set."""
        try:
            return self._guarantee_cache[key]
        except KeyError:
            value = factory()
            self._guarantee_cache[key] = value
            return value

    def take_dirty_rules(self) -> tuple[Rule, ...]:
        """Consume the active rules affected since the previous rule pass."""
        dirty = self._trail_state.dirty
        if dirty.all_rules:
            selected = set(self.rules)
        else:
            selected = dirty.rules & self.rules
            watched_cells = dirty.rule_cells | dirty.guarantee_rule_cells
            if watched_cells:
                def build_rule_watchers() -> tuple[tuple[Rule, ...], ...]:
                    watchers: list[list[Rule]] = [
                        [] for _ in range(self.len)
                    ]
                    for rule in self.rules:
                        for cell in rule.cells:
                            watchers[cell].append(rule)
                    return tuple(tuple(items) for items in watchers)

                by_cell = self.cached_rule_struct(
                    "propagation_rules_by_cell",
                    build_rule_watchers,
                )
                for cell in dirty.rule_cells:
                    selected.update(by_cell[cell])
                for cell in dirty.guarantee_rule_cells:
                    selected.update(
                        rule
                        for rule in by_cell[cell]
                        if rule.uses_guarantees
                    )

        dirty.all_rules = False
        dirty.rules.clear()
        dirty.rule_cells.clear()
        dirty.guarantee_rule_cells.clear()
        return tuple(rule for rule in self.rules if rule in selected)

    def take_dirty_guarantees(self) -> tuple[Guarantee, ...]:
        """Consume live guarantees affected by candidate or known changes."""
        dirty = self._trail_state.dirty
        if dirty.all_guarantees:
            selected = set(self.guarantees)
        else:
            selected = dirty.guarantees & self.guarantees
            if dirty.guarantee_cells:
                def build_guarantee_watchers(
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

        dirty.all_guarantees = False
        dirty.guarantees.clear()
        dirty.guarantee_cells.clear()
        return tuple(
            guarantee
            for guarantee in self.guarantees
            if guarantee in selected
        )

    def take_dirty_guarantee_relations(self) -> bool:
        """Return whether guarantee subset relationships need recomputing."""
        dirty = self._trail_state.dirty
        result = dirty.guarantee_relations
        dirty.guarantee_relations = False
        return result

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
        row_wise, space_sep = _validate_load_options(row_wise, space_sep)
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

        # add_rules_checked materialises and validates the entire generator before
        # changing the live rule set.
        self.add_rules_checked(new_rules)

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
        return self.cached_rule_struct(
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

        return self.cached_rule_struct("weak_links", build)

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
