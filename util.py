from collections import deque
from itertools import chain
from typing import *

import numpy as np


class PrettyPrintArgs:
    def __init__(self, sep_up: int = None, print_possible: bool = None, sep_lo: int = None, sep_ri: int = None,
                 sep_le: int = None, inner_grid_row: int = None, inner_grid_col: int = None, sep_in_ve: int = None,
                 sep_in_ho: int = None, detail_rule: bool = False, args: 'PrettyPrintArgs' = None):
        self.sep_up: int = (2 if args is None or args.sep_up is None else args.sep_up) if sep_up is None else sep_up
        self.sep_lo: int = (2 if args is None or args.sep_lo is None else args.sep_lo) if sep_lo is None else sep_lo
        self.sep_le: int = (2 if args is None or args.sep_le is None else args.sep_le) if sep_le is None else sep_le
        self.sep_ri: int = (2 if args is None or args.sep_ri is None else args.sep_ri) if sep_ri is None else sep_ri
        self.sep_in_ve: int = (
            3 if args is None or args.sep_in_ve is None else args.sep_in_ve) if sep_in_ve is None else sep_in_ve
        self.sep_in_ho: int = (
            0 if args is None or args.sep_in_ho is None else args.sep_in_ho) if sep_in_ho is None else sep_in_ho
        self.print_possible: bool = (
            False if args is None or args.print_possible is None else args.print_possible) \
            if print_possible is None else print_possible
        self.detail_rule: bool = (
            False if args is None or args.detail_rule is None else args.detail_rule) \
            if detail_rule is None else detail_rule
        self.inner_grid_row: int = (
            0 if args is None or args.inner_grid_row is None else args.inner_grid_row) \
            if inner_grid_row is None else inner_grid_row
        self.inner_grid_col: int = (
            0 if args is None or args.inner_grid_col is None else args.inner_grid_col) \
            if inner_grid_col is None else inner_grid_col

    def __copy__(self):
        return PrettyPrintArgs(args=self)

    def __deepcopy__(self):
        return PrettyPrintArgs(args=self)

    @classmethod
    def blank(cls) -> 'PrettyPrintArgs':
        return PrettyPrintArgs(sep_up=0, sep_lo=0, sep_le=0, sep_ri=0, sep_in_ve=0, sep_in_ho=0, print_possible=False,
                               inner_grid_col=0, inner_grid_row=0, detail_rule=False)


def pretty_print(rows: int, cols: int, max_elem: int, known: Sequence[int], possible: Tuple[Set[int]] = None,
                 args: PrettyPrintArgs = None) -> str:
    max_dgt = np.int(np.floor(np.log10(max_elem))) + 1
    if args is None:
        args = PrettyPrintArgs()
    if possible is not None and args.print_possible:
        return __show_possible_square(rows, cols, max_dgt, max_elem, possible, args)
    else:
        if args.sep_in_ve == 3 and max_dgt == 1:
            args = PrettyPrintArgs(args=args, sep_in_ve=0)
        return __simple_square(rows, cols, max_dgt, known, args)


def __simple_square(rows: int, cols: int, max_dgt: int, content: Iterable[int],
                    args: PrettyPrintArgs) -> str:
    data: List[Tuple[str]] = [(f"{x:{max_dgt}d}" if x > 0 else " " * max_dgt,) for x in content]
    mybox = __box_str(data, rows, cols, args)
    __fix_crossings(mybox)
    mybox.append("")
    return "\n".join(mybox)


def __show_possible_square(rows: int, cols: int, max_dgt: int, max_elem: int, possible: Iterable[Set[int]],
                           args: PrettyPrintArgs) -> str:
    pb_w = int(np.ceil(np.sqrt(max_elem)))
    pb_h = int(np.ceil(max_elem / pb_w))
    pb_wh = pb_w * pb_h
    blank_args = PrettyPrintArgs.blank()
    args = PrettyPrintArgs(args=args, inner_grid_row=1, inner_grid_col=1, sep_in_ve=1, sep_in_ho=1)

    def show_possible_str(p: Set[int]) -> List[Tuple[str]]:
        ll = len(p)
        if ll == 0:
            return [("╳" * max_dgt,) for _ in range(pb_wh)]
        if ll == 1 and pb_wh > 2:
            bdry = pb_w // 2 * pb_h + ((pb_h - 1) // 2)
            return [(" " * max_dgt,) for _ in range(bdry)] + \
                   [(f"{x:{max_dgt}d}",) for x in p] + [("=" * max_dgt,)] + \
                   [(" " * max_dgt,) for _ in range(bdry + 2, pb_wh)]
        return [(f"{x:{max_dgt}d}",) if x in p else (" " * max_dgt,) for x in range(1, pb_wh + 1)]

    myl: List[Deque[str]] = [__box_str(show_possible_str(p), pb_h, pb_w, blank_args) for p in possible]
    mybox = __box_str(myl, rows, cols, args)
    __fix_crossings(mybox)
    mybox.append("")
    return "\n".join(mybox)


CORNER_MARKER = "#"


def __box_str(data: List[Iterable[str]], rows: int, cols: int, args: PrettyPrintArgs) -> Deque[str]:
    result: Deque[str] = deque()
    iv = ["", "│", "┃", " "][args.sep_in_ve]
    ih = ["", "─", "━", " "][args.sep_in_ho]
    le = ["", "│", "┃"][args.sep_le]
    ri = ["", "│", "┃"][args.sep_ri]
    up = ["", "─", "━"][args.sep_up]
    lo = ["", "─", "━"][args.sep_lo]

    def splice(str_iter: Tuple[str]) -> Deque[str]:
        sp_result: Deque[str] = deque()
        n = len(str_iter)
        for i, d in enumerate(str_iter):
            sp_result.append(d)
            if (i + 1) % args.inner_grid_col == 0 and i < n - 1:
                sp_result.append(iv)

        return sp_result

    def build_row(r: int) -> Iterator[Tuple[str]]:
        full_row: Iterator[Iterable[str]] = (data[r + c * rows] for c in range(cols))
        zipped_row: Iterator[Tuple[str]] = zip(*full_row)
        if args.inner_grid_col == 0:
            return zipped_row
        return (tuple(splice(rowling)) for rowling in zipped_row)

    first, *new_rows = map(build_row, range(rows))
    ffirst, *first = first
    ffirst = list(ffirst)
    mylen = [len(s) if s != iv else -1 for s in ffirst]
    first = chain([ffirst], first)
    new_rows = chain([first], new_rows)

    def sep_row(sep: str):
        return CORNER_MARKER + "".join(sep * ll if ll != -1 else CORNER_MARKER for ll in mylen) + CORNER_MARKER

    for r_idx, row_tuple in enumerate(new_rows):
        for row in row_tuple:
            result.append(le + "".join(row) + ri)
        if args.sep_in_ho > 0 and r_idx < rows - 1 and (r_idx + 1) % args.inner_grid_row == 0:
            result.append(sep_row(ih))

    if args.sep_up:
        result.appendleft(sep_row(up))

    if args.sep_lo:
        result.append(sep_row(lo))

    return result


__BOX_DRAW_DIC = {
    (None, None, "│", "─"): "┌", (None, None, "┃", "━"): "┏", (None, None, "│", "━"): "┍", (None, None, "┃", "─"): "┎",
    ("│", "─", None, None): "┘", ("┃", "━", None, None): "┛", ("│", "━", None, None): "┙", ("┃", "─", None, None): "┚",
    ("│", None, None, "─"): "└", ("┃", None, None, "━"): "┗", ("│", None, None, "━"): "┕", ("┃", None, None, "─"): "┖",
    (None, "─", "│", None): "┐", (None, "━", "┃", None): "┓", (None, "━", "│", None): "┑", (None, "─", "┃", None): "┒",
    ("│", None, "│", "─"): "├", ("│", None, "┃", "━"): "┢", ("│", None, "│", "━"): "┝", ("│", None, "┃", "─"): "┟",
    ("┃", None, "│", "─"): "┞", ("┃", None, "┃", "━"): "┣", ("┃", None, "│", "━"): "┡", ("┃", None, "┃", "─"): "┠",
    ("│", "─", "│", None): "┤", ("│", "━", "┃", None): "┪", ("│", "━", "│", None): "┥", ("│", "─", "┃", None): "┧",
    ("┃", "─", "│", None): "┦", ("┃", "━", "┃", None): "┫", ("┃", "━", "│", None): "┩", ("┃", "─", "┃", None): "┨",
    (None, "─", "│", "─"): "┬", (None, "━", "┃", "─"): "┱", (None, "━", "│", "─"): "┭", (None, "─", "┃", "─"): "┰",
    (None, "─", "│", "━"): "┮", (None, "━", "┃", "━"): "┳", (None, "━", "│", "━"): "┯", (None, "─", "┃", "━"): "┲",
    ("│", "─", None, "─"): "┴", ("┃", "━", None, "─"): "┹", ("│", "━", None, "─"): "┵", ("┃", "─", None, "─"): "┸",
    ("│", "─", None, "━"): "┶", ("┃", "━", None, "━"): "┻", ("│", "━", None, "━"): "┷", ("┃", "─", None, "━"): "┺",
    ("│", "─", "│", "─"): "┼", ("┃", "━", "│", "─"): "╃", ("│", "━", "│", "─"): "┽", ("┃", "─", "│", "─"): "╀",
    ("│", "─", "│", "━"): "┾", ("┃", "━", "│", "━"): "╇", ("│", "━", "│", "━"): "┿", ("┃", "─", "│", "━"): "╄",
    ("│", "─", "┃", "─"): "╁", ("┃", "━", "┃", "─"): "╉", ("│", "━", "┃", "─"): "╅", ("┃", "─", "┃", "─"): "╂",
    ("│", "─", "┃", "━"): "╆", ("┃", "━", "┃", "━"): "╋", ("│", "━", "┃", "━"): "╈", ("┃", "─", "┃", "━"): "╊"
}


def __fix_crossings(data: MutableSequence[str]) -> None:
    data_s = [[char for char in row] for row in data]
    last_row = len(data_s) - 1
    for i, row in enumerate(data_s):
        if CORNER_MARKER not in row:
            continue
        last_col = len(row) - 1
        for j, char in enumerate(row):
            if char == CORNER_MARKER:
                top = None
                bot = None
                lef = None
                rig = None
                if i < last_row:
                    bot = data_s[i + 1][j]
                if i > 0:
                    top = data_s[i - 1][j]
                if j < last_col:
                    rig = data_s[i][j + 1]
                if j > 0:
                    lef = data_s[i][j - 1]
                search = (top, lef, bot, rig)
                data_s[i][j] = __BOX_DRAW_DIC.get(search, CORNER_MARKER)

    for i, row in enumerate(data_s):
        data[i] = "".join(row)


def flatten(lst, ltypes=(list, tuple)):
    ltype = type(lst)
    lst = list(lst)
    i = 0
    while i < len(lst):
        while isinstance(lst[i], ltypes):
            if not lst[i]:
                lst.pop(i)
                i -= 1
                break
            else:
                lst[i:i + 1] = lst[i]
        i += 1
    return ltype(lst)


__T = TypeVar("T")


def peek(it: Iterable[__T]) -> (__T, Iterable[__T]):
    first, *it = it
    return first, chain([first], it)


class GridSizeContainer:
    def __init__(self, rows: int, cols: Optional[int] = None, max_elem: Optional[int] = None):
        if cols is None:
            cols = rows
        if max_elem is None:
            max_elem = min(rows, cols)
        assert rows > 0, "x should be > 0"
        assert cols > 0, "y should be > 0"
        assert max_elem > 0, "max_elem should be > 0"

        self.__rows: int = rows
        self.__cols: int = cols
        self.__max_elem: int = max_elem
        self.__len: int = rows * cols

    def __len__(self) -> int:
        return self.__len

    @property
    def rows(self) -> int:
        return self.__rows

    @property
    def cols(self) -> int:
        return self.__cols

    @property
    def max_elem(self) -> int:
        return self.__max_elem

    @property
    def len(self) -> int:
        return self.__len
