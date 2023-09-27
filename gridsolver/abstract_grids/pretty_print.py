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
        self.sep_in_ve: int = PrettyPrintArgs._none_alternate(sep_in_ve, args.sep_in_ve if args else None, 0)
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
                 args: PrettyPrintArgs = None, ineqs: Set[Tuple[int, int]] = None) -> str:
    max_dgt = math.floor(math.log10(max_elem)) + 1
    if args is None:
        args = PrettyPrintArgs()
    assert candidates is not None
    assert ineqs is not None

    if args.print_candidates:
        return _show_candidate_square(rows, cols, max_dgt, max_elem, args=args, ineqs=ineqs, candidates=candidates)
    else:
        return _simple_square(rows, cols, max_dgt, args=args, ineqs=ineqs, content=known)


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

    def build_row(self, r: int, data) -> Iterator[Tuple[str]]:
        full_row: Iterator[Iterable[str]] = (data[r + c * self.rows] for c in range(self.cols))
        zipped_row: Iterator[Tuple[str]] = zip(*full_row)
        if self.inner_grid_col == 0:
            return zipped_row
        return (tuple(self.splice(rowling, r)) for rowling in zipped_row)

    def sep_row(self, sep: str, mylen: Iterable[int], row_idx=None):
        string_builder = [CORNER_MARKER]
        assert row_idx is not None or sep != "I", 'row_idx is None and sep == "I"'
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
