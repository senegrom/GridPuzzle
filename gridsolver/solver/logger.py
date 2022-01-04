import logging
import sys
import time
from contextlib import contextmanager
from enum import Enum
from typing import Optional, List, Union, Any, Iterable, Set, FrozenSet, Callable

from colorama import init, Fore, Style
from rich.highlighter import NullHighlighter
from rich.logging import RichHandler

from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs

init()


class Colouring(Enum):
    No = 0,
    Colorama = 1
    Rich = 2


_C_NO = {
    "X": "",
    "R": "",
    "G": "",
    "B": "",
    "Y": "",
    "RR": "",
    "GG": "",
    "BB": "",
    "YY": "",
}

_C_COLORAMA = {
    "X": Style.RESET_ALL,
    "R": Fore.RED,
    "G": Fore.GREEN,
    "B": Fore.BLUE,
    "Y": Fore.YELLOW,
    "RR": Fore.LIGHTRED_EX,
    "GG": Fore.LIGHTGREEN_EX,
    "BB": Fore.LIGHTBLUE_EX,
    "YY": Fore.LIGHTYELLOW_EX,
}

_C_RICH = {
    "X": "[/]",
    "R": "[color(1)]",
    "G": "[color(2)]",
    "B": "[color(4)]",
    "Y": "[color(3)]",
    "RR": "[color(9)]",
    "GG": "[color(10)]",
    "BB": "[color(12)]",
    "YY": "[color(11)]",
}

C = _C_NO
_FORMAT = "%(message)s"


def set_colouring(c: Colouring):
    global C
    if not isinstance(c, Colouring):
        c = Colouring[c]
    if c == Colouring.No:
        logging.basicConfig(format=_FORMAT, stream=sys.stdout, level=0)
        C = _C_NO
    elif c == Colouring.Rich:
        logging.basicConfig(format=_FORMAT, level=0,
                            handlers=[
                                RichHandler(show_time=False, show_level=False, show_path=False,
                                            highlighter=NullHighlighter(),
                                            markup=True)])
        C = _C_RICH
    elif c == Colouring.Colorama:
        logging.basicConfig(format=_FORMAT, stream=sys.stdout, level=0)
        C = _C_COLORAMA
    else:
        raise ValueError(str(c))


MAX_LVL = 1000


def _lvl(lvl):
    return MAX_LVL - lvl + 1


# _RULE_LOG_FILTER = {"TooManyNakedTuple", "HiddenTuple", "Fish", "Wing", "NakedTuple"}
_RULE_LOG_FILTER = {"TooManyNakedTuple", "HiddenTuple", "Fish", "Wing"}
TIME_DELTA_LOG_MIN = 0.5


class CoordToString(Callable):
    def __init__(self, rows: int):
        self.rows = rows

    def __call__(self, i: Union[int, Iterable[int]]):
        return self.coord(i)

    def coord(self, i: Union[int, Iterable[int]]) -> str:
        if isinstance(i, Iterable):
            if isinstance(i, Set) or isinstance(i, FrozenSet):
                return "{" + ", ".join(self._coord_prim(x) for x in i) + "}"
            return "[" + ", ".join(self._coord_prim(x) for x in i) + "]"
        return self._coord_prim(i)

    def _coord_prim(self, i: int):
        return f"({i % self.rows}, {i // self.rows})"


class GridLogger:
    def __init__(self, lg: logging.Logger, lvl: int):
        self.lg: logging.Logger = lg
        self.grid_buffer: Optional[ImmutableGrid] = None
        self.set_lvl(lvl)
        self.grid_buf = None

    def logs(self, lvl, s: str, header=False):
        if header:
            s = f"{C['B']}{s}{C['X']}"
        self.lg.log(_lvl(lvl), s)

    @contextmanager
    def time_ctxt(self, s: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            delta = time.perf_counter() - start
            if delta > TIME_DELTA_LOG_MIN:
                s = f"{s} took {delta}s."
                self.logd(s)

    def logd(self, s: str, ):
        s = f"    {C['Y']}{s}{C['X']}"
        self.logs(11, s)

    def logr(self, rule_name: str, message: str, item: Any):
        if not any(rule_name.startswith(rf) for rf in _RULE_LOG_FILTER):
            return
        message = ": " + message if message else ""
        s = f"{C['G']}{rule_name} - {item}{message}{C['X']}"
        self.logs(1, s)

    def logstep(self, lvl, steps: List[int], descr: str):
        self.logs(lvl, f"Step {steps} - {descr}", header=True)

    def logg(self, lvl, g: ImmutableGrid, rules=None, format_args=None, **kwargs):
        if not format_args:
            format_args = PrettyPrintArgs(args=g.format_args, **kwargs)
        header, g2s = g.to_str(format_args, rules=rules)
        self.logs(lvl, header)
        g2so = g2s
        if self.grid_buf and len(self.grid_buf) == len(g2s):
            new_string = []
            for c1, c2 in zip(g2s, self.grid_buf):
                if c1 == c2:
                    new_string.append(c1)
                elif c1 == " ":
                    new_string.extend([C['RR'], c2, C['X']])
                elif c1 == "=":
                    new_string.extend([C['GG'], c1, C['X']])
                else:
                    new_string.extend([C['BB'], c1, C['X']])
            g2s = "".join(new_string)
        self.logs(lvl, g2s)
        self.grid_buf = g2so

    def set_lvl(self, lvl):
        if lvl < 0:
            lvl = MAX_LVL + lvl + 1
        self.lg.setLevel(_lvl(lvl))


def get_log(class_: Union[type, str], lvl: int) -> GridLogger:
    if isinstance(class_, type):
        class_ = class_.__name__
    return GridLogger(logging.getLogger(class_), lvl)
