"""The Rich colouring mode is how the Jupyter notebooks print: keep it rendering
coloured grids and solving steps through the solver's logging.

The notebooks call set_colouring("Rich"), load with create_from_str_and_class
and solve with solver.solve(g, -1). These tests use the same calls. They take
the handler set_colouring builds without installing it on the root logger, so
they leave the test run's own logging untouched.
"""

import io
import logging
import re
from types import SimpleNamespace

import pytest

pytest.importorskip("rich")
from rich.console import Console  # noqa: E402
from rich.logging import RichHandler  # noqa: E402

from gridsolver.abstract_grids.grid_loading import create_from_str_and_class  # noqa: E402
from gridsolver.solver import logger, solver  # noqa: E402

EASY = "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79"


class NotebookStream(io.StringIO):
    """Text output with no binary buffer, as Jupyter's stdout."""


def rich_handler(monkeypatch, stdout):
    configured = []
    monkeypatch.setattr(logger, "sys", SimpleNamespace(platform="linux", stdout=stdout))
    monkeypatch.setattr(logger, "C", logger.C)
    monkeypatch.setattr(logger, "_restore_colorama_streams", lambda: None)
    monkeypatch.setattr(logger.logging, "basicConfig", lambda **kwargs: configured.append(kwargs))
    logger.set_colouring("Rich")
    (handler,) = configured[-1]["handlers"]
    assert isinstance(handler, RichHandler)
    return handler


def test_rich_mode_renders_through_jupyter_in_a_notebook(monkeypatch):
    handler = rich_handler(monkeypatch, NotebookStream())
    assert handler.console.is_jupyter
    assert logger.C is logger._C_RICH


def test_rich_mode_prints_coloured_grids_steps_and_the_solution(monkeypatch):
    handler = rich_handler(monkeypatch, io.TextIOWrapper(io.BytesIO(), encoding="utf-8"))
    # Record what the handler renders instead of writing to a terminal.
    recorder = Console(record=True, file=io.StringIO(), force_terminal=True, color_system="truecolor",
                       markup=True, highlight=False, width=120)
    monkeypatch.setattr(handler, "console", recorder)
    package = logging.getLogger("gridsolver")
    monkeypatch.setattr(package, "propagate", False)
    package.addHandler(handler)
    previous = package.level
    package.setLevel(1)  # an application choosing to see every detail
    try:
        grid = create_from_str_and_class(EASY, "Sudoku")
        solutions = solver.solve(grid, -1)
    finally:
        package.setLevel(previous)
        package.removeHandler(handler)
    assert len(solutions) == 1
    text = recorder.export_text()
    assert "┏" in text and "┗" in text, "grids are drawn"
    assert "Solution" in text
    assert "[color(" not in text and "[/]" not in text, "markup is rendered, not printed"
    html = recorder.export_html(inline_styles=True)
    assert len(set(re.findall(r"color: #[0-9a-f]{6}", html))) >= 2, "changes and steps are coloured"
