from pathlib import Path
from textwrap import dedent, indent


def block(source: str, spaces: int = 0) -> str:
    return indent(dedent(source).strip("\n") + "\n", " " * spaces)


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "gridsolver/abstract_grids/grid.py",
    block(
        '''
        def add_gtee_checked(self, guarantee: Guarantee) -> None:
            if (
                guarantee not in self.guarantees_ia
                and guarantee not in self.guarantees
            ):
                self.guarantees.add(guarantee)
                if self._trail_state.active:
                    self._trail_state.entries.append(("gt+", guarantee))
                self._invalidate_struct_cache()
                self._invalidate_guarantee_cache()
        ''',
        4,
    ),
    block(
        '''
        def _normalize_guarantee(self, guarantee: Guarantee) -> Guarantee:
            """Validate and canonicalise one guarantee before set membership.

            Guarantee is a lightweight NamedTuple and can therefore be
            constructed with mutable or malformed fields by extension code.
            Normalising first prevents unhashable values from reaching the
            live sets and keeps every downstream index inside the grid.
            """
            if not isinstance(guarantee, Guarantee):
                raise TypeError("Guarantees must be Guarantee instances")

            value = guarantee.val
            if isinstance(value, bool) or not isinstance(value, Integral):
                raise TypeError("Guarantee values must be integers")
            value = int(value)
            if not 1 <= value <= self.max_elem:
                raise ValueError(
                    f"Guarantee value {value} is outside 1..{self.max_elem}"
                )

            dimensions: list[int] = []
            for name, raw_dimension in (
                ("rows", guarantee.rows),
                ("cols", guarantee.cols),
            ):
                if (
                    isinstance(raw_dimension, bool)
                    or not isinstance(raw_dimension, Integral)
                ):
                    raise TypeError(f"Guarantee {name} must be an integer")
                dimensions.append(int(raw_dimension))
            rows, cols = dimensions
            if (rows, cols) != (self.rows, self.cols):
                raise ValueError(
                    f"Guarantee dimensions {(rows, cols)} do not match "
                    f"grid dimensions {(self.rows, self.cols)}"
                )

            if isinstance(guarantee.cells, (str, bytes, bytearray)):
                raise TypeError("Guarantee cells must be an iterable of integers")
            try:
                raw_cells = list(guarantee.cells)
            except TypeError as exc:
                raise TypeError(
                    "Guarantee cells must be an iterable of integers"
                ) from exc
            if not raw_cells:
                raise ValueError("Guarantee cells must not be empty")

            cells: set[int] = set()
            for raw_cell in raw_cells:
                if isinstance(raw_cell, bool) or not isinstance(raw_cell, Integral):
                    raise TypeError("Guarantee cells must be integers")
                cell = int(raw_cell)
                if not 0 <= cell < self.len:
                    raise ValueError(
                        f"Guarantee cell {cell} is outside 0..{self.len - 1}"
                    )
                cells.add(cell)

            return Guarantee(value, frozenset(cells), rows, cols)

        def add_gtee_checked(self, guarantee: Guarantee) -> None:
            guarantee = self._normalize_guarantee(guarantee)
            if (
                guarantee not in self.guarantees_ia
                and guarantee not in self.guarantees
            ):
                self.guarantees.add(guarantee)
                if self._trail_state.active:
                    self._trail_state.entries.append(("gt+", guarantee))
                self._invalidate_struct_cache()
                self._invalidate_guarantee_cache()
        ''',
        4,
    ),
)

replace_once(
    "gridsolver/abstract_grids/grid.py",
    block(
        '''
        for rule in new_rules:
            self.add_rule_checked(rule)
        ''',
        8,
    ),
    block(
        '''
        # Construct every rule before committing the first one. A bad later
        # constructor must not leave a partially extended grid.
        rules = list(new_rules)
        for rule in rules:
            self.add_rule_checked(rule)
        ''',
        8,
    ),
)

replace_once(
    "tests/test_hardening.py",
    '    with pytest.raises(ValueError, match="no cells inside"):\n'
    '        _NoOpRule(grid, cells=[(9, 9)])\n',
    '    with pytest.raises(ValueError, match="outside a 2x2 grid"):\n'
    '        _NoOpRule(grid, cells=[(9, 9)])\n',
)

replace_once(
    "tests/test_rule_inputs.py",
    "from gridsolver.rules.sumrules import SumRule\n",
    "from gridsolver.rules.rules import Guarantee\n"
    "from gridsolver.rules.sumrules import SumRule\n",
)

tests_path = Path("tests/test_rule_inputs.py")
tests = tests_path.read_text(encoding="utf-8")
marker = "def test_guarantee_inputs_are_validated_before_mutation():"
if marker in tests:
    raise SystemExit("Grid mutation hardening tests already exist")
tests += dedent(
    '''


    def test_bulk_rule_extension_is_atomic_when_a_later_rule_is_invalid():
        grid = Grid(2)
        before_rules = grid.rules.copy()
        before_cache = grid._struct_cache

        with pytest.raises(ValueError, match="outside 0..3"):
            grid.ext_rules(
                ElementsAtMostOnce,
                kwargs_list=[
                    {"cells": [0, 1]},
                    {"cells": [2, 4]},
                ],
            )

        assert grid.rules == before_rules
        assert grid._struct_cache is before_cache


    @pytest.mark.parametrize(
        "guarantee, error, message",
        [
            ((1, frozenset({0}), 2, 2), TypeError, "Guarantee instances"),
            (Guarantee(True, frozenset({0}), 2, 2), TypeError, "values must be integers"),
            (Guarantee(0, frozenset({0}), 2, 2), ValueError, "outside 1..2"),
            (Guarantee(3, frozenset({0}), 2, 2), ValueError, "outside 1..2"),
            (Guarantee(1, frozenset({0}), True, 2), TypeError, "rows must be an integer"),
            (Guarantee(1, frozenset({0}), 2, 3), ValueError, "do not match"),
            (Guarantee(1, frozenset(), 2, 2), ValueError, "must not be empty"),
            (Guarantee(1, frozenset({True}), 2, 2), TypeError, "cells must be integers"),
            (Guarantee(1, frozenset({4}), 2, 2), ValueError, "outside 0..3"),
        ],
    )
    def test_guarantee_inputs_are_validated_before_mutation(
        guarantee,
        error,
        message,
    ):
        grid = Grid(2)
        struct_cache = grid.cached_struct("sentinel", object)
        guarantee_cache = grid.cached_guarantee_struct("sentinel", object)
        struct_mapping = grid._struct_cache
        guarantee_mapping = grid._guarantee_cache
        mark = grid.trail_mark()

        with pytest.raises(error, match=message):
            grid.add_gtee_checked(guarantee)

        assert not grid.guarantees
        assert not grid.guarantees_ia
        assert not grid._trail_state.entries
        assert grid._struct_cache is struct_mapping
        assert grid._guarantee_cache is guarantee_mapping
        assert grid._struct_cache["sentinel"] is struct_cache
        assert grid._guarantee_cache["sentinel"] is guarantee_cache
        grid.trail_undo(mark)


    def test_guarantee_is_canonicalised_and_rolls_back_transactionally():
        grid = Grid(2)
        source = Guarantee(1, [0, 1, 1], 2, 2)
        expected = Guarantee(1, frozenset({0, 1}), 2, 2)
        mark = grid.trail_mark()

        grid.add_gtee_checked(source)

        assert grid.guarantees == {expected}
        assert grid._trail_state.entries[-1] == ("gt+", expected)

        grid.trail_undo(mark)
        assert not grid.guarantees
        assert not grid.guarantees_ia
        assert not grid._trail_state.entries
    '''
)
tests_path.write_text(tests, encoding="utf-8")
