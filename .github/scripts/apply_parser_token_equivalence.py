"""Make iterable grid tokens use the same blank syntax as compact strings."""

from pathlib import Path
from textwrap import dedent


grid_path = Path("gridsolver/abstract_grids/grid.py")
grid_text = grid_path.read_text(encoding="utf-8")
start = grid_text.index("def _parse_load_value(")
end = grid_text.index("\n\ndef _boolean_option(", start)
replacement = dedent('''
    def _parse_load_value(raw_value: object, max_elem: int) -> int:
        """Parse one load token without permissive numeric coercion.

        Compact puzzle strings translate ``.`` to zero before this function.
        Iterable token routes must accept the same blank marker explicitly so
        string, nested-list, generator, bytes, and bytearray inputs agree.
        """
        if isinstance(raw_value, bool):
            raise TypeError(
                f"Grid values must be integers or strings, got {raw_value!r}"
            )

        if isinstance(raw_value, Integral):
            value = int(raw_value)
        elif isinstance(raw_value, (str, bytes, bytearray)):
            token = (
                bytes(raw_value)
                if isinstance(raw_value, bytearray)
                else raw_value
            )
            token = token.strip()
            blank = b"." if isinstance(token, bytes) else "."
            if token == blank:
                value = 0
            else:
                try:
                    value = int(token)
                except ValueError:
                    try:
                        value = int(token, base=36)
                    except ValueError as exc:
                        raise ValueError(
                            f"Cannot parse grid value {raw_value!r}"
                        ) from exc
        else:
            raise TypeError(
                f"Grid values must be integers or strings, got {raw_value!r}"
            )

        if not 0 <= value <= max_elem:
            raise ValueError(f"Grid value {value} is outside 0..{max_elem}")
        return value
''').strip("\n")
grid_path.write_text(
    grid_text[:start] + replacement + grid_text[end:],
    encoding="utf-8",
)


tests_path = Path("tests/test_iterable_loading.py")
test_text = tests_path.read_text(encoding="utf-8")
if "from gridsolver.abstract_grids.grid_loading import" not in test_text:
    test_text = test_text.replace(
        "from gridsolver.abstract_grids.grid import Grid\n",
        "from gridsolver.abstract_grids.grid import Grid\n"
        "from gridsolver.abstract_grids.grid_loading import "
        "create_from_str_and_class\n"
        "from gridsolver.grid_classes.latins_square import LatinSquare\n",
        1,
    )
appendix = '''


def test_dot_blank_tokens_match_compact_nested_and_generator_routes():
    compact = create_from_str_and_class("1..2", "latinsquare")
    tokens = create_from_str_and_class(
        (token for token in ("1", ".", ".", "2")),
        "latinsquare",
    )
    nested = LatinSquare(2)
    nested.load((("1", " . "), (".", "2")))

    assert tokens == compact
    assert nested == compact
    assert compact.known == (1, 0, 0, 2)


def test_dot_blank_tokens_accept_bytes_and_bytearray():
    byte_grid = Grid(1)
    bytearray_grid = Grid(1)

    byte_grid.load([b" . "])
    bytearray_grid.load([bytearray(b" . ")])

    assert byte_grid.known == (0,)
    assert bytearray_grid.known == (0,)
    assert byte_grid.has_been_filled
    assert bytearray_grid.has_been_filled
'''
if "test_dot_blank_tokens_match_compact_nested_and_generator_routes" in test_text:
    raise SystemExit("parser token-equivalence tests already exist")
tests_path.write_text(
    test_text.rstrip() + appendix,
    encoding="utf-8",
)
