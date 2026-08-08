import logging
import sys
import time
from collections.abc import Iterable, Set
from contextlib import contextmanager
from enum import Enum
from typing import Any

from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs


class Colouring(Enum):
    No = 0
    Colorama = 1
    Rich = 2


_C_NO = {key: "" for key in ("X", "R", "G", "B", "Y", "RR", "GG", "BB", "YY")}
_C_ANSI = {
    "X": "\x1b[0m",
    "R": "\x1b[31m",
    "G": "\x1b[32m",
    "B": "\x1b[34m",
    "Y": "\x1b[33m",
    "RR": "\x1b[91m",
    "GG": "\x1b[92m",
    "BB": "\x1b[94m",
    "YY": "\x1b[93m",
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


def _restore_colorama_streams() -> None:
    try:
        from colorama import deinit
    except ImportError:
        return
    deinit()


def set_colouring(colouring: Colouring | str) -> None:
    """Configure output explicitly without doing work at import time."""
    global C
    if not isinstance(colouring, Colouring):
        try:
            colouring = Colouring[colouring]
        except (KeyError, TypeError) as exc:
            raise ValueError(f"Unknown colouring mode {colouring!r}") from exc

    if colouring is Colouring.No:
        _restore_colorama_streams()
        logging.basicConfig(format=_FORMAT, stream=sys.stdout, level=0, force=True)
        C = _C_NO
        return

    if colouring is Colouring.Colorama:
        from colorama import just_fix_windows_console

        just_fix_windows_console()
        logging.basicConfig(format=_FORMAT, stream=sys.stdout, level=0, force=True)
        C = _C_ANSI
        return

    if colouring is Colouring.Rich:
        from rich.console import Console
        from rich.highlighter import NullHighlighter
        from rich.logging import RichHandler

        _restore_colorama_streams()
        output = sys.stdout
        # Reconfigure the existing stream instead of wrapping its buffer in a
        # second TextIOWrapper. A discarded wrapper can close stdout's buffer
        # when output modes are changed more than once.
        if sys.platform == "win32" and hasattr(output, "reconfigure"):
            try:
                output.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError, ValueError):
                pass

        if hasattr(output, "buffer"):
            console = Console(file=output, markup=True, highlight=False)
        else:
            console = Console(markup=True, highlight=False, force_jupyter=True)

        logging.basicConfig(
            format=_FORMAT,
            level=0,
            force=True,
            handlers=[
                RichHandler(
                    console=console,
                    show_time=False,
                    show_level=False,
                    show_path=False,
                    highlighter=NullHighlighter(),
                    markup=True,
                )
            ],
        )
        C = _C_RICH
        return

    raise ValueError(str(colouring))


MAX_LVL = 1000


def _lvl(level: int) -> int:
    return MAX_LVL - level + 1


_RULE_LOG_FILTER = {
    "TooManyNakedTuple",
    "HiddenTuple",
    "Fish",
    "Wing",
    "Chain",
    "Loop",
    "ForcingChain",
    "Skyscraper",
    "LockedCandidate",
    "ALS",
    "SueDeCoq",
    "AIC",
    "Nishio",
    "ForcingNet",
    "EmptyRectangle",
    "IneqBounds",
}
TIME_DELTA_LOG_MIN = 0.5


class CoordToString:
    def __init__(self, rows: int) -> None:
        self.rows = rows

    def __call__(self, index: int | Iterable[int]) -> str:
        return self.coord(index)

    def coord(self, index: int | Iterable[int]) -> str:
        if isinstance(index, Iterable):
            if isinstance(index, Set):
                return "{" + ", ".join(self._coord_prim(value) for value in index) + "}"
            return "[" + ", ".join(self._coord_prim(value) for value in index) + "]"
        return self._coord_prim(index)

    def _coord_prim(self, index: int) -> str:
        return f"({index % self.rows}, {index // self.rows})"


class GridLogger:
    def __init__(self, logger: logging.Logger, level: int) -> None:
        self.lg = logger
        self.set_lvl(level)
        self.grid_buf: str | None = None
        self.time_stats: dict[str, float] = {}

    def logs(self, level: int, message: str, header: bool = False) -> None:
        if header:
            message = f"{C['B']}{message}{C['X']}"
        self.lg.log(_lvl(level), message)

    @contextmanager
    def time_ctxt(self, label: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            delta = time.perf_counter() - start
            self.time_stats[label] = self.time_stats.get(label, 0.0) + delta
            if delta > TIME_DELTA_LOG_MIN:
                self.logd(f"{label} took {delta}s.")

    def logd(self, message: str) -> None:
        self.logs(11, f"    {C['Y']}{message}{C['X']}")

    @property
    def on(self) -> bool:
        return self.lg.isEnabledFor(_lvl(1))

    def logr(self, rule_name: str, message: str, item: Any) -> None:
        if not any(rule_name.startswith(prefix) for prefix in _RULE_LOG_FILTER):
            return
        suffix = f": {message}" if message else ""
        self.logs(1, f"{C['G']}{rule_name} - {item}{suffix}{C['X']}")

    def logstep(self, level: int, steps: list[int], description: str) -> None:
        self.logs(level, f"Step {steps} - {description}", header=True)

    def logg(
        self,
        level: int,
        grid: ImmutableGrid,
        rules=None,
        format_args=None,
        **kwargs,
    ) -> None:
        if not self.lg.isEnabledFor(_lvl(level)):
            return
        if format_args is None:
            format_args = PrettyPrintArgs(args=grid.format_args, **kwargs)
        header, rendered = grid.to_str(format_args, rules=rules)
        self.logs(level, header)
        original = rendered

        if self.grid_buf and len(self.grid_buf) == len(rendered):
            changed: list[str] = []
            for current, previous in zip(rendered, self.grid_buf):
                if current == previous:
                    changed.append(current)
                elif current == " ":
                    changed.extend((C["RR"], previous, C["X"]))
                elif current == "=":
                    changed.extend((C["GG"], current, C["X"]))
                else:
                    changed.extend((C["BB"], current, C["X"]))
            rendered = "".join(changed)

        self.logs(level, rendered)
        self.grid_buf = original

    def set_lvl(self, level: int) -> None:
        if level < 0:
            level = MAX_LVL + level + 1
        self.lg.setLevel(_lvl(level))


def get_log(class_: type | str, level: int) -> GridLogger:
    name = class_.__name__ if isinstance(class_, type) else class_
    logger = logging.getLogger(name)
    # Avoid logging.lastResort output before an application explicitly configures
    # logging. The NullHandler does not block propagation once the root logger is
    # configured by set_colouring or the embedding application.
    if not logger.handlers:
        logger.addHandler(logging.NullHandler())
    return GridLogger(logger, level)
