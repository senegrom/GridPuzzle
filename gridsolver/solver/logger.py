import logging
import sys
import time
from collections.abc import Iterable, Set
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from enum import Enum
from numbers import Integral
from typing import Any

from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs


class Colouring(Enum):
    No = 0
    Colorama = 1
    Rich = 2


_C_NO = dict.fromkeys(("X", "R", "G", "B", "Y", "RR", "GG", "BB", "YY"), "")
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


def _configure_output_encoding():
    """Keep Unicode grid borders writable in every Windows output mode.

    Redirected stdout can otherwise use cp1252, which cannot encode the box
    drawing characters even with colour disabled. Reconfigure the existing
    stream, never wrap its buffer: discarded wrappers can close stdout when
    switching modes. This runs only during explicit output configuration.
    """
    output = sys.stdout
    if sys.platform == "win32" and hasattr(output, "reconfigure"):
        with suppress(AttributeError, OSError, ValueError):
            output.reconfigure(encoding="utf-8", errors="replace")
    return output


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
        output = _configure_output_encoding()
        logging.basicConfig(format=_FORMAT, stream=output, level=0, force=True)
        C = _C_NO
        return

    if colouring is Colouring.Colorama:
        from colorama import just_fix_windows_console

        _configure_output_encoding()
        just_fix_windows_console()
        logging.basicConfig(format=_FORMAT, stream=sys.stdout, level=0, force=True)
        C = _C_ANSI
        return

    if colouring is Colouring.Rich:
        from rich.console import Console
        from rich.highlighter import NullHighlighter
        from rich.logging import RichHandler

        _restore_colorama_streams()
        output = _configure_output_encoding()

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


# Logging contract. Every solver logger lives under the "gridsolver"
# namespace and keeps the level the application gives it (none is forced).
# A message's detail level d decides whether a solve renders it at all
# (d <= the solve's log_level); its standard logging level decides whether
# the application's configuration lets it through: d == 0 (solutions,
# timings) is INFO and every deeper detail is DEBUG. An application that
# configures WARNING or above therefore sees nothing, and pays nothing for
# rendering. Negative log levels count down from MAX_LVL, so -1 keeps its
# historical meaning of maximum detail; QUIET, just below that range,
# disables every solver message whatever handlers and levels exist.
MAX_LVL = 1000
QUIET = -(MAX_LVL + 2)
_MUTED = -1  # normalized detail level below every message


def _lvl(level: int) -> int:
    return logging.INFO if level <= 0 else logging.DEBUG


TIME_DELTA_LOG_MIN = 0.5


class CoordToString:
    def __init__(self, rows: int) -> None:
        self.rows = rows

    def __call__(self, index: int | Iterable[int]) -> str:
        return self.coord(index)

    def coord(self, index: int | Iterable[int]) -> str:
        if isinstance(index, Iterable):
            if isinstance(index, Set):
                return "{" + ", ".join(
                    self._coord_prim(value) for value in sorted(index)
                ) + "}"
            return "[" + ", ".join(self._coord_prim(value) for value in index) + "]"
        return self._coord_prim(index)

    def _coord_prim(self, index: int) -> str:
        return f"({index % self.rows}, {index // self.rows})"


class GridLogger:
    def __init__(self, logger: logging.Logger, level: int) -> None:
        self.lg = logger
        self._detail_level: ContextVar[int] = ContextVar(
            f"gridpuzzle_log_level_{logger.name}_{id(self)}",
            default=self._normalize_level(level),
        )
        self._grid_buf: ContextVar[str | None] = ContextVar(
            f"gridpuzzle_grid_buffer_{logger.name}_{id(self)}",
            default=None,
        )
        # None means uncached; -1 means no non-null handler.
        self._output_threshold: ContextVar[int | None] = ContextVar(
            f"gridpuzzle_output_threshold_{logger.name}_{id(self)}",
            default=None,
        )

    @staticmethod
    def _normalize_level(level: int) -> int:
        if isinstance(level, bool) or not isinstance(level, Integral):
            raise TypeError("log level must be an integer")
        level = int(level)
        if level < 0:
            # -1 is MAX_LVL and -(MAX_LVL + 1) is 0; QUIET and below mute.
            return max(MAX_LVL + level + 1, _MUTED)
        return level

    @property
    def detail_level(self) -> int:
        return self._detail_level.get()

    def _configured_output_threshold(self) -> int:
        """Lowest handler level reachable from this logger, or -1."""
        current: logging.Logger | None = self.lg
        threshold: int | None = None
        while current is not None:
            for handler in current.handlers:
                if isinstance(handler, logging.NullHandler):
                    continue
                if threshold is None or handler.level < threshold:
                    threshold = handler.level
            if not current.propagate:
                break
            current = current.parent
        return -1 if threshold is None else threshold

    def is_enabled(self, level: int) -> bool:
        # The detail check comes first: it is the whole cost of the hot-path
        # `lg.on` guards in an ordinary solve.
        if level > self._detail_level.get():
            return False
        log_level = _lvl(level)
        if not self.lg.isEnabledFor(log_level):
            return False
        threshold = self._output_threshold.get()
        if threshold is None:
            threshold = self._configured_output_threshold()
        return threshold >= 0 and log_level >= threshold

    @contextmanager
    def solve_context(self, level: int | None):
        """Isolate one solve's verbosity and changed-grid rendering buffer."""
        level_token = None
        if level is not None:
            level_token = self._detail_level.set(self._normalize_level(level))
        buffer_token = self._grid_buf.set(None)
        output_token = self._output_threshold.set(
            self._configured_output_threshold()
        )
        try:
            yield
        finally:
            self._output_threshold.reset(output_token)
            self._grid_buf.reset(buffer_token)
            if level_token is not None:
                self._detail_level.reset(level_token)

    def logs(self, level: int, message: str, header: bool = False) -> None:
        if not self.is_enabled(level):
            return
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
            if delta > TIME_DELTA_LOG_MIN:
                self.logd(f"{label} took {delta}s.")

    def logd(self, message: str) -> None:
        self.logs(11, f"    {C['Y']}{message}{C['X']}")

    @property
    def on(self) -> bool:
        return self.is_enabled(1)

    def logr(self, rule_name: str, message: str, item: Any) -> None:
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
        if not self.is_enabled(level):
            return
        if format_args is None:
            format_args = PrettyPrintArgs(args=grid.format_args, **kwargs)
        header, rendered = grid.to_str(format_args, rules=rules)
        self.logs(level, header)
        original = rendered

        previous = self._grid_buf.get()
        # The change overlay re-emits removed candidates wrapped in colour
        # codes; without colours that would print a factually stale grid.
        if previous and len(previous) == len(rendered) and C is not _C_NO:
            changed: list[str] = []
            for current, old in zip(rendered, previous):
                if current == old:
                    changed.append(current)
                elif current == " ":
                    changed.extend((C["RR"], old, C["X"]))
                elif current == "=":
                    changed.extend((C["GG"], current, C["X"]))
                else:
                    changed.extend((C["BB"], current, C["X"]))
            rendered = "".join(changed)

        self.logs(level, rendered)
        self._grid_buf.set(original)

    def set_lvl(self, level: int) -> None:
        self._detail_level.set(self._normalize_level(level))


_NAMESPACE = "gridsolver"


def get_log(class_: type | str, level: int) -> GridLogger:
    """Wrap the logger for ``class_``, placed under the "gridsolver" namespace."""
    name = class_.__name__ if isinstance(class_, type) else class_
    if name != _NAMESPACE and not name.startswith(f"{_NAMESPACE}."):
        name = f"{_NAMESPACE}.{name}"
    logger = logging.getLogger(name)
    # Avoid logging.lastResort output before an application explicitly configures
    # logging. The NullHandler does not block propagation once the root logger is
    # configured by set_colouring or the embedding application.
    if not logger.handlers:
        logger.addHandler(logging.NullHandler())
    return GridLogger(logger, level)
