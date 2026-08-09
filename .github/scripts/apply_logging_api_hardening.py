"""Validate public log levels and make set-coordinate rendering deterministic."""

from pathlib import Path


logger_path = Path("gridsolver/solver/logger.py")
text = logger_path.read_text(encoding="utf-8")
if "from numbers import Integral\n" not in text:
    text = text.replace(
        "from enum import Enum\n",
        "from enum import Enum\nfrom numbers import Integral\n",
        1,
    )
old_set = '''            if isinstance(index, Set):
                return "{" + ", ".join(self._coord_prim(value) for value in index) + "}"
'''
new_set = '''            if isinstance(index, Set):
                return "{" + ", ".join(
                    self._coord_prim(value) for value in sorted(index)
                ) + "}"
'''
if text.count(old_set) != 1:
    raise SystemExit("set-coordinate rendering block changed")
text = text.replace(old_set, new_set, 1)
old_level = '''    @staticmethod
    def _normalize_level(level: int) -> int:
        if level < 0:
            return MAX_LVL + level + 1
        return level
'''
new_level = '''    @staticmethod
    def _normalize_level(level: int) -> int:
        if isinstance(level, bool) or not isinstance(level, Integral):
            raise TypeError("log level must be an integer")
        level = int(level)
        if level < 0:
            return MAX_LVL + level + 1
        return level
'''
if text.count(old_level) != 1:
    raise SystemExit("log-level normalization block changed")
logger_path.write_text(
    text.replace(old_level, new_level, 1),
    encoding="utf-8",
)


tests_path = Path("tests/test_handler_aware_logging.py")
test_text = tests_path.read_text(encoding="utf-8")
if "import pytest\n" not in test_text:
    test_text = test_text.replace(
        "import logging\n",
        "import logging\n\nimport pytest\n",
        1,
    )
test_text = test_text.replace(
    "from gridsolver.solver.logger import GridLogger\n",
    "from gridsolver.solver.logger import CoordToString, GridLogger, MAX_LVL\n",
    1,
)
appendix = '''


@pytest.mark.parametrize("bad_level", (True, False, 1.5, "1", object()))
def test_public_log_levels_reject_coercive_values(bad_level):
    raw = logging.getLogger(f"gridpuzzle-invalid-level-{id(bad_level)}")
    with pytest.raises(TypeError, match="log level must be an integer"):
        GridLogger(raw, bad_level)

    logger = GridLogger(raw, 0)
    with pytest.raises(TypeError, match="log level must be an integer"):
        logger.set_lvl(bad_level)
    with pytest.raises(TypeError, match="log level must be an integer"):
        with logger.solve_context(bad_level):
            pass
    with pytest.raises(TypeError, match="log level must be an integer"):
        solver.solve(Sudoku(1, 1, 1, 1), log_level=bad_level)


def test_negative_log_level_shorthand_is_preserved():
    raw = logging.getLogger("gridpuzzle-negative-level")
    logger = GridLogger(raw, -1)
    assert logger.detail_level == MAX_LVL


def test_coordinate_sets_render_in_stable_numeric_order():
    render = CoordToString(3)
    assert render({8, 0, 4}) == "{(0, 0), (1, 1), (2, 2)}"
'''
if "test_public_log_levels_reject_coercive_values" in test_text:
    raise SystemExit("logging API hardening tests already exist")
tests_path.write_text(
    test_text.rstrip() + appendix,
    encoding="utf-8",
)
