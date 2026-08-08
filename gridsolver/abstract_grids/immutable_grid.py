import zlib
from array import ArrayType, array
from collections.abc import Collection, Iterator, Sequence
from numbers import Integral
from typing import overload

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs, pretty_print
from gridsolver.abstract_grids.rule_container import RuleContainer
from gridsolver.rules.rules import IdxTypeSlice, Rule
from gridsolver.rules.uneq import IneqRule


class ImmutableGrid(GridSizeContainer, Sequence[int]):
    format_args = PrettyPrintArgs()

    def __init__(
        self,
        known: Sequence[int],
        rows: int,
        cols: int | None = None,
        max_elem: int | None = None,
        name: str | None = None,
    ) -> None:
        GridSizeContainer.__init__(self, rows, cols, max_elem)

        values = list(known)
        if len(values) != self.len:
            raise ValueError(f"Expected {self.len} grid values, got {len(values)}")

        normalized: list[int] = []
        for value in values:
            if isinstance(value, bool) or not isinstance(value, Integral):
                raise TypeError(f"Grid values must be integers, got {value!r}")
            value = int(value)
            if value < 0:
                raise ValueError(f"Grid values must be non-negative, got {value}")
            if value > self.max_elem:
                raise ValueError(f"Grid value {value} is outside 0..{self.max_elem}")
            normalized.append(value)

        self._known: ArrayType = array("I", normalized)
        # Process-independent content hash: tuple hashes containing only ints are
        # stable, while hash(bytes) is salted per process. crc32 keeps this eager
        # cache compact for solution sets exchanged between worker processes.
        self.__hash = hash((zlib.crc32(bytes(self._known)), self.rows, self.cols, self.max_elem))
        self.name = name

    def __eq__(self, other: object) -> bool:
        if type(other) is not type(self):
            return False
        return (
            self.rows == other.rows
            and self.cols == other.cols
            and self.max_elem == other.max_elem
            and self._known == other._known
        )

    def __ne__(self, other: object) -> bool:
        return not self == other

    def __hash__(self) -> int:
        return self.__hash

    @property
    def known(self) -> tuple[int, ...]:
        """Return an immutable snapshot rather than the hash-bearing backing array."""
        return tuple(self._known)

    def _get_index_from_key(self, key: IdxTypeSlice) -> int | slice:
        if isinstance(key, bool):
            raise TypeError("Boolean grid indexes are not supported")
        if isinstance(key, Integral):
            return int(key)
        if isinstance(key, slice):
            return key
        if isinstance(key, (str, bytes, bytearray)) or not isinstance(key, Sequence):
            raise TypeError(f"Index {key!r} must be integral or an integral tuple")

        if len(key) == 1 and isinstance(key[0], Integral) and not isinstance(key[0], bool):
            return int(key[0])
        if len(key) == 2 and all(isinstance(value, Integral) and not isinstance(value, bool) for value in key):
            row, col = map(int, key)
            if not 0 <= row < self.rows or not 0 <= col < self.cols:
                raise IndexError(
                    f"Grid coordinate {(row, col)} is outside "
                    f"0..{self.rows - 1} x 0..{self.cols - 1}"
                )
            return row + col * self.rows
        raise TypeError(f"Index {key!r} must be integral or an integral tuple of length 1 or 2")

    @overload
    def __getitem__(self, key: int) -> int:
        ...

    @overload
    def __getitem__(self, key: slice) -> ArrayType:
        ...

    @overload
    def __getitem__(self, key: tuple[int, int]) -> int:
        ...

    def __getitem__(self, key: IdxTypeSlice) -> int | ArrayType:
        return self._known[self._get_index_from_key(key)]

    def __iter__(self) -> Iterator[int]:
        return iter(self._known)

    def _str_header(self, detailed: bool = False) -> str:
        return f"{self.name or self.__class__.__name__}({self.rows},{self.cols})"

    def to_str(
        self,
        args: PrettyPrintArgs | None = None,
        rules: Collection[Rule] | None = None,
    ) -> tuple[str, str]:
        if args is None:
            args = PrettyPrintArgs(args=self.format_args)

        candidates: tuple[set[int], ...] = ()
        ineqs: set[tuple[int, int]] = set()
        if hasattr(self, "_candidates"):
            candidates = self._candidates

        if args.sep_in_ve == 4 or args.sep_in_ho == 4:
            if rules is None:
                if not isinstance(self, RuleContainer):
                    raise ValueError("Rules are required to display inequalities")
                rules = self.rules
            ineqs = {
                (rule.lt_cell, rule.gt_cell)
                for rule in rules
                if isinstance(rule, IneqRule)
            }

        return (
            self._str_header(False),
            pretty_print(
                self.rows,
                self.cols,
                self.max_elem,
                self._known,
                candidates=candidates,
                args=args,
                ineqs=ineqs,
            ),
        )
