"""Harden public loading flags, class selection, and cage dictionaries."""

from pathlib import Path
from textwrap import dedent


def lines(*parts: str) -> str:
    return "".join(part + "\n" for part in parts)


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected one marker, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


grid_path = Path("gridsolver/abstract_grids/grid.py")
grid = grid_path.read_text(encoding="utf-8")
parse_end = lines(
    "    if not 0 <= value <= max_elem:",
    "        raise ValueError(f\"Grid value {value} is outside 0..{max_elem}\")",
    "    return value",
    "",
    "",
)
parse_new = parse_end + lines(
    "def _boolean_option(name: str, value: object) -> bool:",
    "    if not isinstance(value, bool):",
    "        raise TypeError(f\"{name} must be a boolean\")",
    "    return value",
    "",
    "",
    "def _validate_load_options(",
    "    row_wise: object,",
    "    space_sep: object,",
    ") -> tuple[bool, bool]:",
    "    return (",
    "        _boolean_option(\"row_wise\", row_wise),",
    "        _boolean_option(\"space_sep\", space_sep),",
    "    )",
    "",
    "",
)
if grid.count(parse_end) != 1:
    raise SystemExit("grid load-option helper marker changed")
grid = grid.replace(parse_end, parse_new, 1)
load_marker = lines(
    "    ) -> None:",
    "        if self.has_been_filled:",
    "            raise RuntimeError(\"Grid can only be filled once; or be used in individual access mode\")",
    "",
    "        raw_values = self._load_preprocess_sequence(values, space_sep=space_sep)",
)
load_new = lines(
    "    ) -> None:",
    "        row_wise, space_sep = _validate_load_options(row_wise, space_sep)",
    "        if self.has_been_filled:",
    "            raise RuntimeError(\"Grid can only be filled once; or be used in individual access mode\")",
    "",
    "        raw_values = self._load_preprocess_sequence(values, space_sep=space_sep)",
)
if grid.count(load_marker) != 1:
    raise SystemExit("Grid.load marker changed")
grid_path.write_text(grid.replace(load_marker, load_new, 1), encoding="utf-8")


loading_path = Path("gridsolver/abstract_grids/grid_loading.py")
loading = loading_path.read_text(encoding="utf-8")
loading = loading.replace(
    "from gridsolver.abstract_grids.grid import Grid, _load_preprocess_str, _load_preprocess_str_space_sep\n",
    "from gridsolver.abstract_grids.grid import (\n"
    "    Grid,\n"
    "    _load_preprocess_str,\n"
    "    _load_preprocess_str_space_sep,\n"
    "    _validate_load_options,\n"
    ")\n",
    1,
)
for signature in (
    "    \"\"\"Load ``<Class>::<PuzzleString>`` from a UTF-8 text file.\"\"\"\n",
    "    \"\"\"Load a puzzle encoded as ``<Class>::<PuzzleString>``.\"\"\"\n",
    "    \"\"\"Load a puzzle string when its concrete grid class is known separately.\"\"\"\n",
):
    if loading.count(signature) != 1:
        raise SystemExit(f"grid-loading docstring marker changed: {signature!r}")
    loading = loading.replace(
        signature,
        signature + "    row_wise, space_sep = _validate_load_options(row_wise, space_sep)\n",
        1,
    )
loading = loading.replace(
    "    elif isinstance(values, Iterable):\n        normalized = list(values)\n",
    "    elif isinstance(values, (bytes, bytearray)):\n"
    "        raise TypeError(\"Puzzle input bytes must be decoded to str first\")\n"
    "    elif isinstance(values, Iterable):\n"
    "        normalized = list(values)\n",
    1,
)
class_check = lines(
    "    elif not isinstance(class_, type) or not issubclass(class_, Grid):",
    "        raise TypeError(\"class_ must be a supported Grid subclass or class name\")",
    "",
    "    try:",
)
class_new = lines(
    "    elif not isinstance(class_, type) or not issubclass(class_, Grid):",
    "        raise TypeError(\"class_ must be a supported Grid subclass or class name\")",
    "    elif class_ not in _PUZZLE_CLASSES.values():",
    "        supported = \", \".join(sorted(_PUZZLE_CLASSES))",
    "        raise ValueError(",
    "            f\"Puzzle class {class_.__name__!r} is not supported; \"",
    "            f\"choose one of {supported}\"",
    "        )",
    "",
    "    try:",
)
if loading.count(class_check) != 1:
    raise SystemExit("supported class marker changed")
loading_path.write_text(loading.replace(class_check, class_new, 1), encoding="utf-8")


futoshiki_path = Path("gridsolver/grid_classes/futoshiki.py")
futoshiki = futoshiki_path.read_text(encoding="utf-8")
futoshiki = futoshiki.replace(
    "from gridsolver.abstract_grids.grid import _load_preprocess_str, _load_preprocess_str_space_sep\n",
    "from gridsolver.abstract_grids.grid import (\n"
    "    _load_preprocess_str,\n"
    "    _load_preprocess_str_space_sep,\n"
    "    _validate_load_options,\n"
    ")\n",
    1,
)
futo_load = lines(
    "    ) -> None:",
    "        # Validate logical tokens rather than raw string length. Direct",
)
futo_new = lines(
    "    ) -> None:",
    "        row_wise, space_sep = _validate_load_options(row_wise, space_sep)",
    "        # Validate logical tokens rather than raw string length. Direct",
)
if futoshiki.count(futo_load) != 1:
    raise SystemExit("Futoshiki.load marker changed")
futoshiki = futoshiki.replace(futo_load, futo_new, 1)
futoshiki = futoshiki.replace(
    "        for rule in new_rules:\n            self.add_rule_checked(rule)\n",
    "        self.add_rules_checked(new_rules)\n",
    1,
)
futoshiki_path.write_text(futoshiki, encoding="utf-8")


killer_path = Path("gridsolver/grid_classes/killer_sudoku.py")
killer = killer_path.read_text(encoding="utf-8")
killer = killer.replace(
    "from gridsolver.abstract_grids.grid import _load_preprocess_str, _load_preprocess_str_space_sep, pairs\n",
    "from gridsolver.abstract_grids.grid import (\n"
    "    _boolean_option,\n"
    "    _load_preprocess_str,\n"
    "    _load_preprocess_str_space_sep,\n"
    "    _validate_load_options,\n"
    "    pairs,\n"
    ")\n",
    1,
)
colon_old = dedent('''
        elif isinstance(sum_cells_and_dic, Iterable):
            # Materialise once so one-shot iterables are not consumed by a
            # separate membership check. Newlines are stripped later by the
            # normal puzzle preprocessors.
            text = "\n".join(str(part) for part in sum_cells_and_dic)
''')
colon_new = dedent('''
        elif isinstance(sum_cells_and_dic, (bytes, bytearray)):
            raise TypeError("Cage input bytes must be decoded to str first")
        elif isinstance(sum_cells_and_dic, Iterable):
            # Materialise once so one-shot iterables remain supported, but do
            # not silently stringify malformed tokens.
            parts = list(sum_cells_and_dic)
            if any(not isinstance(part, str) for part in parts):
                raise TypeError("Cage input iterables must contain only strings")
            text = "\n".join(parts)
''')
if killer.count(colon_old) != 1:
    raise SystemExit("colon-split iterable marker changed")
killer = killer.replace(colon_old, colon_new, 1)
killer_load = lines(
    "    ) -> None:",
    "        \"\"\"Load a cage layout followed by a single-character sum dictionary.\"\"\"",
    "        sum_cells, dictionary_text = self._load_preprocess_colon_split(",
)
killer_new = lines(
    "    ) -> None:",
    "        \"\"\"Load a cage layout followed by a single-character sum dictionary.\"\"\"",
    "        row_wise, space_sep = _validate_load_options(row_wise, space_sep)",
    "        sum_cells, dictionary_text = self._load_preprocess_colon_split(",
)
if killer.count(killer_load) != 1:
    raise SystemExit("KillerSudoku.load marker changed")
killer = killer.replace(killer_load, killer_new, 1)
killer = killer.replace(
    "            while index < len(dictionary_text) and dictionary_text[index].isnumeric():\n",
    "            while (\n"
    "                index < len(dictionary_text)\n"
    "                and \"0\" <= dictionary_text[index] <= \"9\"\n"
    "            ):\n",
    1,
)
killer_with_dic = lines(
    "    ) -> None:",
    "        \"\"\"Load a single-character cage layout plus a mapping of cage sums.\"\"\"",
    "        if self.has_been_filled:",
)
killer_with_new = lines(
    "    ) -> None:",
    "        \"\"\"Load a single-character cage layout plus a mapping of cage sums.\"\"\"",
    "        row_wise = _boolean_option(\"row_wise\", row_wise)",
    "        if self.has_been_filled:",
)
if killer.count(killer_with_dic) != 1:
    raise SystemExit("KillerSudoku.load_with_dic marker changed")
killer_path.write_text(killer.replace(killer_with_dic, killer_with_new, 1), encoding="utf-8")


kenken_path = Path("gridsolver/grid_classes/kenken.py")
kenken = kenken_path.read_text(encoding="utf-8")
kenken = kenken.replace(
    "from gridsolver.abstract_grids.grid import _load_preprocess_str, _load_preprocess_str_space_sep, pairs\n",
    "from gridsolver.abstract_grids.grid import (\n"
    "    _boolean_option,\n"
    "    _load_preprocess_str,\n"
    "    _load_preprocess_str_space_sep,\n"
    "    _validate_load_options,\n"
    "    pairs,\n"
    ")\n",
    1,
)
kenken_load = lines(
    "    ) -> None:",
    "        \"\"\"Load a cage layout followed by a compact operator/target dictionary.\"\"\"",
    "        target_cells, dictionary_text = KillerSudoku._load_preprocess_colon_split(",
)
kenken_new = lines(
    "    ) -> None:",
    "        \"\"\"Load a cage layout followed by a compact operator/target dictionary.\"\"\"",
    "        row_wise, space_sep = _validate_load_options(row_wise, space_sep)",
    "        target_cells, dictionary_text = KillerSudoku._load_preprocess_colon_split(",
)
if kenken.count(kenken_load) != 1:
    raise SystemExit("Kenken.load marker changed")
kenken = kenken.replace(kenken_load, kenken_new, 1)
kenken = kenken.replace(
    "            while index < len(dictionary_text) and dictionary_text[index].isnumeric():\n",
    "            while (\n"
    "                index < len(dictionary_text)\n"
    "                and \"0\" <= dictionary_text[index] <= \"9\"\n"
    "            ):\n",
    1,
)
kenken_with_dic = lines(
    "    ) -> None:",
    "        \"\"\"Load a single-character cage layout plus target/operator mappings.\"\"\"",
    "        if self.has_been_filled:",
)
kenken_with_new = lines(
    "    ) -> None:",
    "        \"\"\"Load a single-character cage layout plus target/operator mappings.\"\"\"",
    "        row_wise = _boolean_option(\"row_wise\", row_wise)",
    "        if self.has_been_filled:",
)
if kenken.count(kenken_with_dic) != 1:
    raise SystemExit("Kenken.load_with_dic marker changed")
kenken_path.write_text(kenken.replace(kenken_with_dic, kenken_with_new, 1), encoding="utf-8")


tests = Path("tests/test_cli_and_loading.py")
test_text = tests.read_text(encoding="utf-8")
imports = (
    "from gridsolver.abstract_grids.grid_loading import (\n"
    "    create_from_file,\n"
    "    create_from_str,\n"
    ")\n"
)
new_imports = (
    "from gridsolver.abstract_grids.grid_loading import (\n"
    "    create_from_file,\n"
    "    create_from_str,\n"
    "    create_from_str_and_class,\n"
    ")\n"
)
if test_text.count(imports) != 1:
    raise SystemExit("loading test import marker changed")
test_text = test_text.replace(imports, new_imports, 1)
appendix = '''


@pytest.mark.parametrize("name", ("row_wise", "space_sep"))
def test_grid_load_rejects_non_boolean_options_and_remains_retryable(name):
    grid = Grid(1)
    kwargs = {name: 1}

    with pytest.raises(TypeError, match=rf"{name} must be a boolean"):
        grid.load("0", **kwargs)

    assert not grid.has_been_filled
    grid.load("1")
    assert grid.known == (1,)


@pytest.mark.parametrize("factory", (create_from_str,))
@pytest.mark.parametrize("name", ("row_wise", "space_sep"))
def test_loader_factories_reject_non_boolean_options(factory, name):
    with pytest.raises(TypeError, match=rf"{name} must be a boolean"):
        factory("Sudoku::1", **{name: "yes"})


def test_file_loader_validates_options_before_reading(tmp_path):
    missing = tmp_path / "missing.txt"
    with pytest.raises(TypeError, match="row_wise must be a boolean"):
        create_from_file(missing, row_wise=1)


class _UnsupportedGrid(Grid):
    pass


def test_loader_rejects_unsupported_grid_subclasses_early():
    with pytest.raises(ValueError, match="is not supported"):
        create_from_str_and_class("0", _UnsupportedGrid)


def test_loader_rejects_ambiguous_top_level_bytes():
    with pytest.raises(TypeError, match="decoded to str"):
        create_from_str_and_class(b"1", Sudoku)


def test_cage_split_rejects_bytes_and_non_string_iterable_parts():
    with pytest.raises(TypeError, match="decoded to str"):
        KillerSudoku._load_preprocess_colon_split(b"a:a1")
    with pytest.raises(TypeError, match="only strings"):
        KillerSudoku._load_preprocess_colon_split(iter(("a", 1, ":a1")))


@pytest.mark.parametrize(
    "grid, payload",
    (
        (KillerSudoku(None, 1, 1, 1, 1), "a:a²"),
        (Kenken(None, 1), "a:a+²"),
    ),
)
def test_cage_dictionary_numbers_are_ascii_digits(grid, payload):
    with pytest.raises(ValueError, match="string format invalid"):
        grid.load(payload)
    assert not grid.has_been_filled


def test_specialized_loaders_validate_flags_before_mutation():
    futoshiki = Futoshiki(1)
    killer = KillerSudoku(None, 1, 1, 1, 1)
    kenken = Kenken(None, 1)

    with pytest.raises(TypeError, match="space_sep must be a boolean"):
        futoshiki.load("0", space_sep=1)
    with pytest.raises(TypeError, match="row_wise must be a boolean"):
        killer.load("a:a1", row_wise=1)
    with pytest.raises(TypeError, match="row_wise must be a boolean"):
        kenken.load_with_dic("a", {"a": ("+", 1)}, row_wise="yes")

    for grid in (futoshiki, killer, kenken):
        assert not grid.has_been_filled
        assert not grid.rules_ia
'''
if "test_grid_load_rejects_non_boolean_options_and_remains_retryable" in test_text:
    raise SystemExit("loading boundary tests already exist")
tests.write_text(test_text.rstrip() + appendix, encoding="utf-8")
