import math
from collections import deque
from itertools import chain
from typing import Sequence, Tuple, Set, Iterable, List, Deque, Iterator, MutableSequence, Union


class PrettyPrintArgs:

    @staticmethod
    def _none_alternate(arg1, arg2, default):
        return (default if arg2 is None else arg2) if arg1 is None else arg1

    def __init__(self, sep_up: int = None, print_candidates: bool = None, sep_lo: int = None, sep_ri: int = None,
                 sep_le: int = None, inner_grid_row: Union[int, str] = None, inner_grid_col: Union[int, str] = None,
                 sep_in_ve: int = None, sep_in_ho: int = None, args: 'PrettyPrintArgs' = None):
        self.sep_up: int = PrettyPrintArgs._none_alternate(sep_up, args.sep_up if args else None, 2)
        self.sep_lo: int = PrettyPrintArgs._none_alternate(sep_lo, args.sep_lo if args else None, 2)
        self.sep_le: int = PrettyPrintArgs._none_alternate(sep_le, args.sep_le if args else None, 2)
        self.sep_ri: int = PrettyPrintArgs._none_alternate(sep_ri, args.sep_ri if args else None, 2)
        self.sep_in_ve: int = PrettyPrintArgs._none_alternate(sep_in_ve, args.sep_in_ve if args else None, 3)
        self.sep_in_ho: int = PrettyPrintArgs._none_alternate(sep_in_ho, args.sep_in_ho if args else None, 0)
        self.print_candidates: bool = PrettyPrintArgs._none_alternate(print_candidates,
                                                                      args.print_candidates if args else None, False)
        self.inner_grid_row: Union[int, str] = PrettyPrintArgs._none_alternate(inner_grid_row,
                                                                               args.inner_grid_row if args else None, 0)
        self.inner_grid_col: Union[int, str] = PrettyPrintArgs._none_alternate(inner_grid_col,
                                                                               args.inner_grid_col if args else None, 0)

    def __copy__(self):
        return PrettyPrintArgs(args=self)

    def __deepcopy__(self, memodict=None):
        return PrettyPrintArgs(args=self)

    @staticmethod
    def blank() -> 'PrettyPrintArgs':
        return PrettyPrintArgs(sep_up=0, sep_lo=0, sep_le=0, sep_ri=0, sep_in_ve=0, sep_in_ho=0, print_candidates=False,
                               inner_grid_col=0, inner_grid_row=0)


def pretty_print(rows: int, cols: int, max_elem: int, known: Sequence[int], candidates: Tuple[Set[int]] = None,
                 args: PrettyPrintArgs = None) -> str:
    max_dgt = math.floor(math.log10(max_elem)) + 1
    if args is None:
        args = PrettyPrintArgs()
    if candidates is not None and args.print_candidates:
        return _show_candidate_square(rows, cols, max_dgt, max_elem, candidates, args)
    else:
        if args.sep_in_ve == 3 and max_dgt == 1:
            args = PrettyPrintArgs(args=args, sep_in_ve=0)
        return _simple_square(rows, cols, max_dgt, known, args)


def _simple_square(rows: int, cols: int, max_dgt: int, content: Iterable[int],
                   args: PrettyPrintArgs) -> str:
    format_str = "{" + "0:{0}d".format(max_dgt) + "}"
    data: List[Tuple[str]] = [(format_str.format(x) if x > 0 else " " * max_dgt,) for x in content]
    mybox = _box_str(data, rows, cols, args)
    _fix_crossings(mybox)
    mybox.append("")
    return "\n".join(mybox)


def _show_candidate_square(rows: int, cols: int, max_dgt: int, max_elem: int, candidates: Iterable[Set[int]],
                           args: PrettyPrintArgs) -> str:
    pb_w = math.ceil(math.sqrt(max_elem))
    pb_h = math.ceil(max_elem / pb_w)
    pb_wh = pb_w * pb_h
    blank_args = PrettyPrintArgs.blank()
    args = PrettyPrintArgs(args=args, inner_grid_row=1, inner_grid_col=1, sep_in_ve=1, sep_in_ho=1)

    def show_candidate_str(p: Set[int]) -> List[Tuple[str]]:
        ll = len(p)
        if ll == 0:
            return [("╳" * max_dgt,) for _ in range(pb_wh)]
        format_str = "{" + "0:{0}d".format(max_dgt) + "}"
        if ll == 1 and pb_wh > 2:
            bdry = pb_w // 2 * pb_h + ((pb_h - 1) // 2)
            return [(" " * max_dgt,) for _ in range(bdry)] + \
                   [(format_str.format(x),) for x in p] + [("=" * max_dgt,)] + \
                   [(" " * max_dgt,) for _ in range(bdry + 2, pb_wh)]
        return [(format_str.format(x),) if x in p else (" " * max_dgt,) for x in range(1, pb_wh + 1)]

    myl: List[Deque[str]] = [_box_str(show_candidate_str(p), pb_h, pb_w, blank_args) for p in candidates]
    mybox = _box_str(myl, rows, cols, args)
    _fix_crossings(mybox)
    mybox.append("")
    return "\n".join(mybox)


CORNER_MARKER = "#"


def _box_str(data: List[Iterable[str]], rows: int, cols: int, args: PrettyPrintArgs) -> Deque[str]:
    result: Deque[str] = deque()
    iv = ["", "│", "┃", " "][args.sep_in_ve]
    ih = ["", "─", "━", " "][args.sep_in_ho]
    le = ["", "│", "┃"][args.sep_le]
    ri = ["", "│", "┃"][args.sep_ri]
    up = ["", "─", "━"][args.sep_up]
    lo = ["", "─", "━"][args.sep_lo]

    if args.inner_grid_col == "sqrt":
        inner_grid_col = int(math.sqrt(cols))
    else:
        inner_grid_col = args.inner_grid_col
    if args.inner_grid_row == "sqrt":
        inner_grid_row = int(math.sqrt(rows))
    else:
        inner_grid_row = args.inner_grid_row

    def splice(str_iter: Tuple[str]) -> Deque[str]:
        sp_result: Deque[str] = deque()
        n = len(str_iter)
        for i, d in enumerate(str_iter):
            sp_result.append(d)
            if (i + 1) % inner_grid_col == 0 and i < n - 1:
                sp_result.append(iv)

        return sp_result

    def build_row(r: int) -> Iterator[Tuple[str]]:
        full_row: Iterator[Iterable[str]] = (data[r + c * rows] for c in range(cols))
        zipped_row: Iterator[Tuple[str]] = zip(*full_row)
        if inner_grid_col == 0:
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
        if args.sep_in_ho > 0 and r_idx < rows - 1 and (r_idx + 1) % inner_grid_row == 0:
            result.append(sep_row(ih))

    if args.sep_up:
        result.appendleft(sep_row(up))

    if args.sep_lo:
        result.append(sep_row(lo))

    return result


_BOX_DRAW_DIC = {
    (" ", " ", "│", "─"): "┌", (" ", " ", "┃", "━"): "┏", (" ", " ", "│", "━"): "┍", (" ", " ", "┃", "─"): "┎",
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


def _fix_crossings(data: MutableSequence[str]) -> None:
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
                data_s[i][j] = _BOX_DRAW_DIC.get(search, CORNER_MARKER)

    for i, row in enumerate(data_s):
        data[i] = "".join(row)
