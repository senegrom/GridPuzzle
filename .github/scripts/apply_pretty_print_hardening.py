"""Apply and test the pretty-print public API hardening."""

from pathlib import Path


def lines(*parts: str) -> str:
    return "".join(part + "\n" for part in parts)


path = Path("gridsolver/abstract_grids/pretty_print.py")
text = path.read_text(encoding="utf-8")
text = text.replace(
    "import math\n",
    "import math\nfrom numbers import Integral\n",
    1,
)

old = lines(
    "def pretty_print(rows: int, cols: int, max_elem: int, known: Sequence[int], candidates: Tuple[Set[int]] = None,",
    "                 args: PrettyPrintArgs = None, ineqs: Set[Tuple[int, int]] = None) -> str:",
    "    max_dgt = math.floor(math.log10(max_elem)) + 1",
    "    if args is None:",
    "        args = PrettyPrintArgs()",
    "    assert candidates is not None",
    "    assert ineqs is not None",
    "",
    "    if args.print_candidates:",
    "        return _show_candidate_square(rows, cols, max_dgt, max_elem, args=args, ineqs=ineqs, candidates=candidates)",
    "    else:",
    "        return _simple_square(rows, cols, max_dgt, args=args, ineqs=ineqs, content=known)",
)
new = lines(
    "def _positive_integer(name: str, value: int) -> int:",
    "    if isinstance(value, bool) or not isinstance(value, Integral):",
    "        raise TypeError(f\"{name} must be an integer\")",
    "    value = int(value)",
    "    if value <= 0:",
    "        raise ValueError(f\"{name} must be positive\")",
    "    return value",
    "",
    "",
    "def pretty_print(",
    "    rows: int,",
    "    cols: int,",
    "    max_elem: int,",
    "    known: Sequence[int],",
    "    candidates: Sequence[Set[int]] | None = None,",
    "    args: PrettyPrintArgs | None = None,",
    "    ineqs: Set[Tuple[int, int]] | None = None,",
    ") -> str:",
    "    rows = _positive_integer(\"rows\", rows)",
    "    cols = _positive_integer(\"cols\", cols)",
    "    max_elem = _positive_integer(\"max_elem\", max_elem)",
    "    expected = rows * cols",
    "",
    "    if isinstance(known, (str, bytes, bytearray)):",
    "        raise TypeError(\"known must be a sequence of grid values\")",
    "    if len(known) != expected:",
    "        raise ValueError(f\"Expected {expected} known values, got {len(known)}\")",
    "",
    "    if args is None:",
    "        args = PrettyPrintArgs()",
    "    elif not isinstance(args, PrettyPrintArgs):",
    "        raise TypeError(\"args must be a PrettyPrintArgs instance\")",
    "    if ineqs is None:",
    "        ineqs = set()",
    "",
    "    max_dgt = math.floor(math.log10(max_elem)) + 1",
    "    if not args.print_candidates:",
    "        return _simple_square(",
    "            rows,",
    "            cols,",
    "            max_dgt,",
    "            args=args,",
    "            ineqs=ineqs,",
    "            content=known,",
    "        )",
    "",
    "    if candidates is None:",
    "        raise ValueError(",
    "            \"candidates are required when print_candidates is enabled\"",
    "        )",
    "    if len(candidates) != expected:",
    "        raise ValueError(",
    "            f\"Expected {expected} candidate sets, got {len(candidates)}\"",
    "        )",
    "    return _show_candidate_square(",
    "        rows,",
    "        cols,",
    "        max_dgt,",
    "        max_elem,",
    "        args=args,",
    "        ineqs=ineqs,",
    "        candidates=candidates,",
    "    )",
)
if text.count(old) != 1:
    raise SystemExit(f"pretty_print function marker count: {text.count(old)}")
text = text.replace(old, new, 1)

old_assert = "        assert row_idx is not None or sep != \"I\", 'row_idx is None and sep == \"I\"'\n"
new_assert = lines(
    "        if sep == \"I\" and row_idx is None:",
    "            raise ValueError(\"row_idx is required for inequality separators\")",
)
if text.count(old_assert) != 1:
    raise SystemExit(f"separator assertion marker count: {text.count(old_assert)}")
text = text.replace(old_assert, new_assert, 1)
path.write_text(text, encoding="utf-8")


tests = Path("tests/test_hardening.py")
test_text = tests.read_text(encoding="utf-8")
import_marker = (
    "from gridsolver.abstract_grids.immutable_grid import ImmutableGrid\n"
)
import_line = (
    "from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs, pretty_print\n"
)
if import_line not in test_text:
    if test_text.count(import_marker) != 1:
        raise SystemExit("pretty-print test import marker changed")
    test_text = test_text.replace(import_marker, import_marker + import_line, 1)

appendix = '''


def test_pretty_print_defaults_render_without_optional_structures():
    rendered = pretty_print(2, 2, 2, [1, 0, 0, 2])

    assert "1" in rendered
    assert "2" in rendered
    assert rendered.endswith("\\n")


def test_pretty_print_candidate_mode_requires_complete_candidates():
    args = PrettyPrintArgs(print_candidates=True)

    with pytest.raises(ValueError, match="candidates are required"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], args=args)
    with pytest.raises(ValueError, match="Expected 4 candidate sets"):
        pretty_print(
            2,
            2,
            2,
            [0, 0, 0, 0],
            candidates=[{1, 2}],
            args=args,
        )


def test_pretty_print_rejects_invalid_shape_before_rendering():
    with pytest.raises(TypeError, match="rows must be an integer"):
        pretty_print(True, 2, 2, [0, 0, 0, 0])
    with pytest.raises(ValueError, match="max_elem must be positive"):
        pretty_print(2, 2, 0, [0, 0, 0, 0])
    with pytest.raises(ValueError, match="Expected 4 known values"):
        pretty_print(2, 2, 2, [0])
    with pytest.raises(TypeError, match="known must be a sequence"):
        pretty_print(1, 1, 1, "0")
'''
if "test_pretty_print_defaults_render_without_optional_structures" in test_text:
    raise SystemExit("pretty-print hardening tests already exist")
tests.write_text(test_text.rstrip() + appendix, encoding="utf-8")
