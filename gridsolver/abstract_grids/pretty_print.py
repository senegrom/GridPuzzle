import math
from numbers import Integral
from collections import deque
from itertools import chain
from typing import Sequence, Tuple, Set, Iterable, List, Deque, Iterator, MutableSequence, Union


class PrettyPrintArgs:

    @staticmethod
    def _none_alternate(arg1, arg2, default):
        return (default if arg2 is None else arg2) if arg1 is None else arg1

    @staticmethod
    def _separator(name: str, value: object, maximum: int) -> int:
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(f"{name} must be an integer")
        value = int(value)
        if not 0 <= value <= maximum:
            raise ValueError(
                f"{name} must be between 0 and {maximum}"
            )
        return value

    @staticmethod
    def _inner_dimension(name: str, value: object) -> int | str:
        if value == "sqrt":
            return value
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(
                f"{name} must be a non-negative integer or 'sqrt'"
            )
        value = int(value)
        if value < 0:
            raise ValueError(
                f"{name} must be non-negative or 'sqrt'"
            )
        return value

    def __init__(
        self,
        sep_up: int | None = None,
        print_candidates: bool | None = None,
        sep_lo: int | None = None,
        sep_ri: int | None = None,
        sep_le: int | None = None,
        inner_grid_row: int | str | None = None,
        inner_grid_col: int | str | None = None,
        sep_in_ve: int | None = None,
        sep_in_ho: int | None = None,
        args: 'PrettyPrintArgs | None' = None,
    ) -> None:
        if args is not None and not isinstance(args, PrettyPrintArgs):
            raise TypeError("args must be a PrettyPrintArgs instance")

        inherited = args
        self.sep_up = self._separator(
            "sep_up",
            self._none_alternate(
                sep_up,
                inherited.sep_up if inherited else None,
                2,
            ),
            2,
        )
        self.sep_lo = self._separator(
            "sep_lo",
            self._none_alternate(
                sep_lo,
                inherited.sep_lo if inherited else None,
                2,
            ),
            2,
        )
        self.sep_le = self._separator(
            "sep_le",
            self._none_alternate(
                sep_le,
                inherited.sep_le if inherited else None,
                2,
            ),
            2,
        )
        self.sep_ri = self._separator(
            "sep_ri",
            self._none_alternate(
                sep_ri,
                inherited.sep_ri if inherited else None,
                2,
            ),
            2,
        )
        self.sep_in_ve = self._separator(
            "sep_in_ve",
            self._none_alternate(
                sep_in_ve,
                inherited.sep_in_ve if inherited else None,
                0,
            ),
            4,
        )
        self.sep_in_ho = self._separator(
            "sep_in_ho",
            self._none_alternate(
                sep_in_ho,
                inherited.sep_in_ho if inherited else None,
                0,
            ),
            4,
        )

        raw_print_candidates = self._none_alternate(
            print_candidates,
            inherited.print_candidates if inherited else None,
            False,
        )
        if not isinstance(raw_print_candidates, bool):
            raise TypeError("print_candidates must be a boolean")
        self.print_candidates = raw_print_candidates

        self.inner_grid_row = self._inner_dimension(
            "inner_grid_row",
            self._none_alternate(
                inner_grid_row,
                inherited.inner_grid_row if inherited else None,
                0,
            ),
        )
        self.inner_grid_col = self._inner_dimension(
            "inner_grid_col",
            self._none_alternate(
                inner_grid_col,
                inherited.inner_grid_col if inherited else None,
                0,
            ),
        )

        if not self.print_candidates:
            if self.sep_in_ve and self.inner_grid_col == 0:
                raise ValueError(
                    "inner_grid_col must be positive when sep_in_ve is enabled"
                )
            if self.sep_in_ho and self.inner_grid_row == 0:
                raise ValueError(
                    "inner_grid_row must be positive when sep_in_ho is enabled"
                )

    def __copy__(self):
        return PrettyPrintArgs(args=self)

    def __deepcopy__(self, memodict=None):
        return PrettyPrintArgs(args=self)

    @staticmethod
    def blank() -> 'PrettyPrintArgs':
        return PrettyPrintArgs(
            sep_up=0,
            sep_lo=0,
            sep_le=0,
            sep_ri=0,
            sep_in_ve=0,
            sep_in_ho=0,
            print_candidates=False,
            inner_grid_col=0,
            inner_grid_row=0,
        )


def _positive_integer(name: str, value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise TypeError(f"{name} must be an integer")
    value = int(value)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _grid_value(name: str, value: object, maximum: int, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise TypeError(f"{name} must contain integers")
    value = int(value)
    if not minimum <= value <= maximum:
        raise ValueError(
            f"{name} value {value} is outside {minimum}..{maximum}"
        )
    return value


def _known_values(
    known: Iterable[int],
    expected: int,
    max_elem: int,
) -> tuple[int, ...]:
    if isinstance(known, (str, bytes, bytearray)):
        raise TypeError("known must be a sequence or iterable of grid values")
    try:
        values = tuple(known)
    except TypeError as exc:
        raise TypeError("known must be a sequence or iterable of grid values") from exc
    if len(values) != expected:
        raise ValueError(
            f"Expected {expected} known values, got {len(values)}"
        )
    return tuple(
        _grid_value("known", value, max_elem, 0)
        for value in values
    )


def _candidate_values(
    candidates: Iterable[Iterable[int]],
    expected: int,
    max_elem: int,
) -> tuple[frozenset[int], ...]:
    if isinstance(candidates, (str, bytes, bytearray)):
        raise TypeError("candidates must be an iterable of candidate sets")
    try:
        raw_candidates = tuple(candidates)
    except TypeError as exc:
        raise TypeError(
            "candidates must be an iterable of candidate sets"
        ) from exc
    if len(raw_candidates) != expected:
        raise ValueError(
            f"Expected {expected} candidate sets, got "
            f"{len(raw_candidates)}"
        )

    normalized: list[frozenset[int]] = []
    for cell, raw_values in enumerate(raw_candidates):
        if isinstance(raw_values, (str, bytes, bytearray)):
            raise TypeError(
                f"candidates[{cell}] must be an iterable of integers"
            )
        try:
            values = tuple(raw_values)
        except TypeError as exc:
            raise TypeError(
                f"candidates[{cell}] must be an iterable of integers"
            ) from exc
        normalized.append(
            frozenset(
                _grid_value(
                    f"candidates[{cell}]",
                    value,
                    max_elem,
                    1,
                )
                for value in values
            )
        )
    return tuple(normalized)


def _inequality_pairs(
    ineqs: Iterable[Sequence[int]] | None,
    rows: int,
    expected: int,
) -> set[tuple[int, int]]:
    if ineqs is None:
        return set()
    if isinstance(ineqs, (str, bytes, bytearray)):
        raise TypeError("ineqs must be an iterable of directed cell pairs")
    try:
        raw_pairs = tuple(ineqs)
    except TypeError as exc:
        raise TypeError(
            "ineqs must be an iterable of directed cell pairs"
        ) from exc

    normalized: set[tuple[int, int]] = set()
    for raw_pair in raw_pairs:
        if isinstance(raw_pair, (str, bytes, bytearray)):
            raise TypeError("Each inequality must be a two-cell sequence")
        try:
            pair = tuple(raw_pair)
        except TypeError as exc:
            raise TypeError(
                "Each inequality must be a two-cell sequence"
            ) from exc
        if len(pair) != 2:
            raise ValueError("Each inequality must contain exactly two cells")
        first = _grid_value("inequality cell", pair[0], expected - 1, 0)
        second = _grid_value("inequality cell", pair[1], expected - 1, 0)
        if first == second:
            raise ValueError("Inequality cells must be distinct")

        vertical = (
            abs(first - second) == 1
            and first // rows == second // rows
        )
        horizontal = (
            abs(first - second) == rows
            and first % rows == second % rows
        )
        if not vertical and not horizontal:
            raise ValueError(
                f"Inequality cells {(first, second)} are not adjacent"
            )
        normalized.add((first, second))
    return normalized


def pretty_print(
    rows: int,
    cols: int,
    max_elem: int,
    known: Iterable[int],
    candidates: Iterable[Iterable[int]] | None = None,
    args: PrettyPrintArgs | None = None,
    ineqs: Iterable[Sequence[int]] | None = None,
) -> str:
    rows = _positive_integer("rows", rows)
    cols = _positive_integer("cols", cols)
    max_elem = _positive_integer("max_elem", max_elem)
    expected = rows * cols
    known_values = _known_values(known, expected, max_elem)

    if args is None:
        args = PrettyPrintArgs()
    elif not isinstance(args, PrettyPrintArgs):
        raise TypeError("args must be a PrettyPrintArgs instance")
    else:
        # Snapshot and revalidate mutable public attributes.
        args = PrettyPrintArgs(args=args)
    inequality_pairs = _inequality_pairs(ineqs, rows, expected)

    max_dgt = math.floor(math.log10(max_elem)) + 1
    if not args.print_candidates:
        return _simple_square(
            rows,
            cols,
            max_dgt,
            args=args,
            ineqs=inequality_pairs,
            content=known_values,
        )

    if candidates is None:
        raise ValueError(
            "candidates are required when print_candidates is enabled"
        )
    candidate_values = _candidate_values(
        candidates,
        expected,
        max_elem,
    )
    return _show_candidate_square(
        rows,
        cols,
        max_dgt,
        max_elem,
        args=args,
        ineqs=inequality_pairs,
        candidates=candidate_values,
    )


def _simple_square(rows: int, cols: int, max_dgt: int, content: Iterable[int],
                   args: PrettyPrintArgs, ineqs: Set[Tuple[int, int]]) -> str:
    format_str = "{" + "0:{0}d".format(max_dgt) + "}"
    data: List[Tuple[str]] = [(format_str.format(x) if x > 0 else " " * max_dgt,) for x in content]
    box_maker_outer = _BoxStringMaker(rows, cols, args, ineqs)
    mybox = box_maker_outer.make(data)
    _fix_crossings(mybox)
    mybox.append("")
    return "\n".join(mybox)


def _show_candidate_square(rows: int, cols: int, max_dgt: int, max_elem: int, candidates: Iterable[Set[int]],
                           args: PrettyPrintArgs, ineqs: Set[Tuple[int, int]]) -> str:
    pb_w = math.ceil(math.sqrt(max_elem))
    pb_h = math.ceil(max_elem / pb_w)
    pb_wh = pb_w * pb_h
    blank_args = PrettyPrintArgs.blank()
    sep_in_ve = args.sep_in_ve if args.sep_in_ve else 1
    sep_in_ho = args.sep_in_ho if args.sep_in_ho else 1
    args = PrettyPrintArgs(args=args, inner_grid_row=1, inner_grid_col=1, sep_in_ve=sep_in_ve, sep_in_ho=sep_in_ho)

    def show_candidate_str(p: Set[int]) -> List[Tuple[str]]:
        ll = len(p)
        if ll == 0:
            return [("╳" * max_dgt,) for _ in range(pb_wh)]
        format_str = "{" + "0:{0}".format(max_dgt) + "}"
        if ll == 1 and pb_wh > 2:
            bdry = pb_w // 2 * pb_h + ((pb_h - 1) // 2)
            return [(" " * max_dgt,) for _ in range(bdry)] + \
                [(format_str.format(x),) for x in p] + [("=" * max_dgt,)] + \
                [(" " * max_dgt,) for _ in range(bdry + 2, pb_wh)]
        return [(format_str.format(x),) if x in p else (" " * max_dgt,) for x in range(1, pb_wh + 1)]

    box_maker_inner = _BoxStringMaker(pb_h, pb_w, blank_args, set())
    myl: List[Deque[str]] = [box_maker_inner.make(show_candidate_str(p)) for p in candidates]
    box_maker_outer = _BoxStringMaker(rows, cols, args, ineqs)
    mybox = box_maker_outer.make(myl)
    _fix_crossings(mybox)
    mybox.append("")
    return "\n".join(mybox)


CORNER_MARKER = "#"


class _BoxStringMaker:
    def __init__(self, rows: int, cols: int, args: PrettyPrintArgs, ineqs: Set[Tuple[int, int]]):
        self.iv = ["", "│", "┃", " ", "I"][args.sep_in_ve]
        self.ih = ["", "─", "━", " ", "I"][args.sep_in_ho]
        self.le = ["", "│", "┃"][args.sep_le]
        self.ri = ["", "│", "┃"][args.sep_ri]
        self.up = ["", "─", "━"][args.sep_up]
        self.lo = ["", "─", "━"][args.sep_lo]

        if args.inner_grid_col == "sqrt":
            self.inner_grid_col = int(math.sqrt(cols))
        else:
            self.inner_grid_col = args.inner_grid_col
        if args.inner_grid_row == "sqrt":
            self.inner_grid_row = int(math.sqrt(rows))
        else:
            self.inner_grid_row = args.inner_grid_row
        self.rows = rows
        self.cols = cols
        self.ineqs = ineqs

    def splice(self, str_iter: Tuple[str], row_idx) -> Deque[str]:
        sp_result: Deque[str] = deque()
        n = len(str_iter)
        for i, d in enumerate(str_iter):
            sp_result.append(d)
            if (i + 1) % self.inner_grid_col == 0 and i < n - 1:
                if self.iv == "I":
                    if (row_idx + i * self.rows, row_idx + (i + 1) * self.rows) in self.ineqs:
                        this_sep = "<"
                    elif (row_idx + (i + 1) * self.rows, row_idx + i * self.rows) in self.ineqs:
                        this_sep = ">"
                    else:
                        this_sep = " "
                else:
                    this_sep = self.iv

                sp_result.append(this_sep)

        return sp_result

    def build_row(self, r: int, data) -> Iterable[Tuple[str]]:
        full_row: Iterator[Iterable[str]] = (data[r + c * self.rows] for c in range(self.cols))
        zipped_row: Iterator[Tuple[str]] = zip(*full_row)
        if self.inner_grid_col == 0:
            return zipped_row
        return (tuple(self.splice(rowling, r)) for rowling in zipped_row)

    def sep_row(self, sep: str, mylen: Iterable[int], row_idx=None):
        string_builder = [CORNER_MARKER]
        if sep == "I" and row_idx is None:
            raise ValueError("row_idx is required for inequality separators")
        element = row_idx
        is_sep_col = False
        for ll in mylen:
            if ll == -1:
                string_builder.append(CORNER_MARKER)
                continue
            if sep == "I" and not is_sep_col:
                if (element, element + 1) in self.ineqs:
                    this_sep = "^"
                elif (element + 1, element) in self.ineqs:
                    this_sep = "v"
                else:
                    this_sep = " "
                element += self.rows
                is_sep_col = self.iv != ""
            elif is_sep_col:
                string_builder.append(CORNER_MARKER)
                is_sep_col = False
                continue
            else:
                this_sep = sep
            string_builder.append(this_sep * ll)
        string_builder.append(CORNER_MARKER)
        return "".join(string_builder)

    def make(self, data: List[Iterable[str]]) -> Deque[str]:
        result: Deque[str] = deque()

        def build_row(r: int):
            return self.build_row(r, data=data)

        first, *new_rows = map(build_row, range(self.rows))
        ffirst, *first = first
        ffirst = list(ffirst)
        mylen = [len(s) if s != self.iv else -1 for s in ffirst]
        first = chain([ffirst], first)
        new_rows = chain([first], new_rows)

        for r_idx, row_tuple in enumerate(new_rows):
            for row in row_tuple:
                result.append(self.le + "".join(row) + self.ri)
            if self.ih != "" and r_idx < self.rows - 1 and (r_idx + 1) % self.inner_grid_row == 0:
                result.append(self.sep_row(self.ih, mylen, row_idx=r_idx))

        if self.up != "":
            result.appendleft(self.sep_row(self.up, mylen))

        if self.lo != "":
            result.append(self.sep_row(self.lo, mylen))

        return result


_BOX_DRAW_DIC = {
    (" ", " ", "│", "─"): "┌", (" ", " ", "┃", "━"): "┏", (" ", " ", "│", "━"): "┍", (" ", " ", "┃", "─"): "┎",
    (" ", "─", " ", "─"): "─", (" ", "─", " ", "━"): "╼", (" ", "━", " ", "━"): "━", (" ", "━", " ", "─"): "╾",
    (" ", " ", " ", " "): " ",
    ("│", " ", "│", " "): "│", ("│", " ", "┃", " "): "╽", ("┃", " ", "│", " "): "╿", ("┃", " ", "┃", " "): "┃",
    ("│", "─", " ", " "): "┘", ("┃", "━", " ", " "): "┛", ("│", "━", " ", " "): "┙", ("┃", "─", " ", " "): "┚",
    ("│", " ", " ", "─"): "└", ("┃", " ", " ", "━"): "┗", ("│", " ", " ", "━"): "┕", ("┃", " ", " ", "─"): "┖",
    (" ", "─", "│", " "): "┐", (" ", "━", "┃", " "): "┓", (" ", "━", "│", " "): "┑", (" ", "─", "┃", " "): "┒",
    ("│", " ", "│", "─"): "├", ("│", " ", "┃", "━"): "┢", ("│", " ", "│", "━"): "┝", ("│", " ", "┃", "─"): "┟",
    ("┃", " ", "│", "─"): "┞", ("┃", " ", "┃", "━"): "┣", ("┃", " ", "│", "━"): "┡", ("┃", " ", "┃", "─"): "┠",
    ("│", "─", "│", " "): "┤", ("│", "━", "┃", " "): "┪", ("│", "━", "│", " "): "┥", ("│", "─", "┃", " "): "┧",
    ("┃", "─", "│", " "): "┦", ("┃", "━", "┃", " "): "┫", ("┃", "━", "│", " "): "┩", ("┃", "─", "┃", " "): "┨",
    (" ", "─", "│", "─"): "┬", (" ", "━", "┃", "─"): "┱", (" ", "━", "│", "─"): "┭", (" ", "─", "┃", "─"): "┰",
    (" ", "─", "│", "━"): "┮", (" ", "━", "┃", "━"): "┳", (" ", "━", "│", "━"): "┯", (" ", "─", "┃", "━"): "┲",
    ("│", "─", " ", "─"): "┴", ("┃", "━", " ", "─"): "┹", ("│", "━", " ", "─"): "┵", ("┃", "─", " ", "─"): "┸",
    ("│", "─", " ", "━"): "┶", ("┃", "━", " ", "━"): "┻", ("│", "━", " ", "━"): "┷", ("┃", "─", " ", "━"): "┺",
    ("│", "─", "│", "─"): "┼", ("┃", "━", "│", "─"): "╃", ("│", "━", "│", "─"): "┽", ("┃", "─", "│", "─"): "╀",
    ("│", "─", "│", "━"): "┾", ("┃", "━", "│", "━"): "╇", ("│", "━", "│", "━"): "┿", ("┃", "─", "│", "━"): "╄",
    ("│", "─", "┃", "─"): "╁", ("┃", "━", "┃", "─"): "╉", ("│", "━", "┃", "─"): "╅", ("┃", "─", "┃", "─"): "╂",
    ("│", "─", "┃", "━"): "╆", ("┃", "━", "┃", "━"): "╋", ("│", "━", "┃", "━"): "╈", ("┃", "─", "┃", "━"): "╊"
}

_BOX_DRAW_CHARS = {"│", "─", "┃", "━"}


def _fix_crossings(data: MutableSequence[str]) -> None:
    # Skip the 2D char conversion if there are no crossings to fix
    if not any(CORNER_MARKER in row for row in data):
        return
    data_s = [[char for char in row] for row in data]
    last_row = len(data_s) - 1
    for i, row in enumerate(data_s):
        if CORNER_MARKER not in row:
            continue
        last_col = len(row) - 1
        for j, char in enumerate(row):
            if char == CORNER_MARKER:
                top = " "
                bot = " "
                lef = " "
                rig = " "
                if i < last_row:
                    bot = data_s[i + 1][j]
                if i > 0:
                    top = data_s[i - 1][j]
                if j < last_col:
                    rig = data_s[i][j + 1]
                if j > 0:
                    lef = data_s[i][j - 1]
                search = (top, lef, bot, rig)
                search = tuple(x if x in _BOX_DRAW_CHARS else " " for x in search)
                data_s[i][j] = _BOX_DRAW_DIC.get(search, CORNER_MARKER)

    for i, row in enumerate(data_s):
        data[i] = "".join(row)
