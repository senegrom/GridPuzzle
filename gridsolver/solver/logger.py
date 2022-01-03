import logging
import sys
import time
from contextlib import contextmanager
from typing import Optional, List, Union, Any

from colorama import Style, init, Fore

from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs

init()

MAX_LVL = 1000
logging.basicConfig(format="%(message)s", stream=sys.stdout, level=0)


def _lvl(lvl):
    return MAX_LVL - lvl + 1


_RULE_LOG_FILTER = {"TooManyNakedTuple", "HiddenTuple", "Fish"}
TIME_DELTA_LOG_MIN = 0.5


class GridLogger:
    def __init__(self, lg: logging.Logger, lvl: int):
        self.lg: logging.Logger = lg
        self.grid_buffer: Optional[ImmutableGrid] = None
        self.set_lvl(lvl)
        self.grid_buf = None

    def logs(self, lvl, s: str, header=False):
        if header:
            s = Fore.BLUE + s + Style.RESET_ALL
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

    def logd(self, s: str):
        s = "    " + Fore.YELLOW + s + Style.RESET_ALL
        self.lg.log(_lvl(11), s)

    def logr(self, rule_name: str, message: str, item: Any):
        if not any(rule_name.startswith(rf) for rf in _RULE_LOG_FILTER):
            return
        message = ": " + message if message else ""
        s = f"{Fore.GREEN}{rule_name} - {item}{message}{Style.RESET_ALL}"
        self.lg.log(_lvl(1), s)

    def logstep(self, lvl, steps: List[int], descr: str):
        self.logs(lvl, f"Step {steps} - {descr}", header=True)

    def logg(self, lvl, g: ImmutableGrid, rules=None, format_args=None, **kwargs):
        if not format_args:
            format_args = PrettyPrintArgs(args=g.format_args, **kwargs)
        g2s = g.to_str(format_args, rules=rules)
        self.logs(lvl, g2s)
        self.grid_buf = g2s

    def set_lvl(self, lvl):
        if lvl < 0:
            lvl = MAX_LVL + lvl + 1
        self.lg.setLevel(_lvl(lvl))


def get_log(class_: Union[type, str], lvl: int) -> GridLogger:
    if isinstance(class_, type):
        class_ = class_.__name__
    return GridLogger(logging.getLogger(class_), lvl)
