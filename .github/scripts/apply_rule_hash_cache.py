"""Cache immutable rule base hashes using a process-stable type tag."""

from pathlib import Path
from textwrap import dedent


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(
            f"{path}: expected one marker, found {text.count(old)}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(
    path: Path,
    start_marker: str,
    end_marker: str,
    replacement: str,
) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


path = Path("gridsolver/rules/rules.py")
replace_once(
    path,
    "import numbers\n",
    "import numbers\nimport zlib\n",
)
replace_once(
    path,
    "from collections.abc import Callable, Iterable, MutableSequence, Sequence\n",
    "from collections.abc import Callable, Iterable, MutableSequence, Sequence\nfrom functools import cache\n",
)
replace_once(
    path,
    "type TApplyResult = tuple[\n",
    dedent('''
        @cache
        def _stable_rule_type_tag(rule_type: type["Rule"]) -> int:
            """Return a deterministic integer tag for a concrete rule class."""
            identity = (
                f"{rule_type.__module__}\\0{rule_type.__qualname__}"
            ).encode("utf-8")
            return zlib.crc32(identity)


        type TApplyResult = tuple[
    ''').lstrip(),
)
replace_once(
    path,
    '    __slots__ = ("cells", "_rows", "_cols", "_max_elem", "len_cells", "_frozen")\n',
    '''    __slots__ = (
        "cells",
        "_rows",
        "_cols",
        "_max_elem",
        "len_cells",
        "_frozen",
        "_base_hash_cache",
    )
''',
)
replace_once(
    path,
    '        object.__setattr__(self, "_frozen", False)\n',
    '        object.__setattr__(self, "_frozen", False)\n        object.__setattr__(self, "_base_hash_cache", None)\n',
)
replace_between(
    path,
    "    def __hash__(self) -> int:\n",
    "    def __ne__(self, other: object) -> bool:\n",
    '''    def __hash__(self) -> int:
        cached = getattr(self, "_base_hash_cache", None)
        if cached is not None:
            return cached

        self.freeze()
        # The cache survives pickle round trips. Avoid type/string hashes,
        # which are process-local, by reducing the class identity to a
        # deterministic integer and hashing only integers/tuples of integers.
        cached = hash(
            (
                _stable_rule_type_tag(type(self)),
                self.cells,
                self._rows,
                self._cols,
                self._max_elem,
                self.len_cells,
            )
        )
        object.__setattr__(self, "_base_hash_cache", cached)
        return cached

''',
)

Path("tests/test_rule_hash_cache.py").write_text(
    dedent('''
        import base64
        import pickle
        import subprocess
        import sys

        import pytest

        from gridsolver.abstract_grids.grid import Grid
        from gridsolver.rules import rules as rules_module
        from gridsolver.rules.sumrules import (
            DiffRule,
            DivRule,
            ProdRule,
            SumAndElementsAtMostOnce,
            SumRule,
        )
        from gridsolver.rules.uneq import DiffGe2Rule, IneqRule, UneqRule
        from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


        def _rules():
            grid = Grid(2, max_elem=4)
            return (
                ElementsAtMostOnce(grid, cells=[0, 1]),
                ElementsAtLeastOnce(grid, cells=[0, 1, 2, 3]),
                IneqRule(grid, gt_cell=1, lt_cell=0),
                UneqRule(grid, origin_cell=0, rel_cells=[1, 2]),
                DiffGe2Rule(grid, origin_cell=0, rel_cells=[1, 2]),
                SumRule(grid, cells=[0, 1], mysum=3),
                DiffRule(grid, cells=[0, 1], target=1),
                ProdRule(grid, cells=[0, 1], target=2),
                DivRule(grid, cells=[0, 1], target=2),
                SumAndElementsAtMostOnce(grid, cells=[0, 1], mysum=3),
            )


        def _hash_in_fresh_interpreter(rule) -> int:
            payload = base64.b64encode(
                pickle.dumps(rule, protocol=pickle.HIGHEST_PROTOCOL)
            ).decode("ascii")
            code = (
                "import base64, pickle; "
                f"obj = pickle.loads(base64.b64decode({payload!r})); "
                "print(hash(obj))"
            )
            return int(
                subprocess.check_output(
                    [sys.executable, "-c", code],
                    text=True,
                ).strip()
            )


        def test_repeated_base_hash_uses_the_cached_value(monkeypatch):
            rule = ElementsAtMostOnce(Grid(2), cells=[0, 1])
            first = hash(rule)

            assert rule._base_hash_cache == first
            assert rule._frozen

            def fail(rule_type):
                raise AssertionError("cached hashes must not rebuild the type tag")

            monkeypatch.setattr(rules_module, "_stable_rule_type_tag", fail)
            assert hash(rule) == first


        @pytest.mark.parametrize("rule", _rules())
        def test_rule_hashes_are_stable_across_fresh_processes(rule):
            # Serialize before the first hash so the child must compute its own cache.
            child_hash = _hash_in_fresh_interpreter(rule)
            assert child_hash == hash(rule)


        @pytest.mark.parametrize("rule", _rules())
        def test_cached_rule_hash_survives_pickle_round_trip(rule):
            expected = hash(rule)
            restored = pickle.loads(
                pickle.dumps(rule, protocol=pickle.HIGHEST_PROTOCOL)
            )

            assert restored == rule
            assert restored._base_hash_cache == rule._base_hash_cache
            assert hash(restored) == expected
            with pytest.raises(AttributeError, match="immutable"):
                restored.cells = (0,)


        def test_pre_hash_mutation_is_reflected_then_frozen():
            grid = Grid(2)
            rule = SumRule(grid, cells=[0, 1], mysum=3)
            rule.sum = 4
            equivalent = SumRule(grid, cells=[0, 1], mysum=4)

            assert hash(rule) == hash(equivalent)
            assert rule == equivalent
            with pytest.raises(AttributeError, match="immutable"):
                rule.sum = 5
    ''').lstrip(),
    encoding="utf-8",
)
