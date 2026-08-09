import random
import string

import pytest

from gridsolver.abstract_grids.grid import (
    Grid,
    _load_preprocess_str_space_sep,
)
from gridsolver.abstract_grids.grid_loading import (
    create_from_file,
    create_from_str,
    create_from_str_and_class,
)
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.latins_square import (
    DiagonalLatinSquare,
    LatinSquare,
    PandiagonalLatinSquare,
)
from gridsolver.grid_classes.sudoku import Sudoku


_DIGITS = string.digits + string.ascii_uppercase
_WHITESPACE = (" ", "  ", "\t", "\n", "\r\n", "\v", "\f", "\u2003")


def _compact(values: list[int], rng: random.Random) -> str:
    return "".join(
        "." if value == 0 and rng.randrange(2) else _DIGITS[value]
        for value in values
    )


def _spaced(tokens: list[object], rng: random.Random) -> str:
    rendered: list[str] = []
    for token in tokens:
        if token == 0:
            rendered.append("." if rng.randrange(2) else "0")
        elif isinstance(token, int):
            rendered.append(
                _DIGITS[token] if token >= 10 and rng.randrange(2) else str(token)
            )
        else:
            rendered.append(str(token))
    return "".join(
        token + (rng.choice(_WHITESPACE) if index + 1 < len(rendered) else "")
        for index, token in enumerate(rendered)
    )


def _nested(values: list[int], width: int):
    rows = (values[index : index + width] for index in range(0, len(values), width))
    return ((value for value in row) for row in rows)


def _assert_equivalent(reference: Grid, *others: Grid) -> None:
    for other in others:
        assert type(other) is type(reference)
        assert other == reference
        assert other.has_been_filled == reference.has_been_filled


@pytest.mark.parametrize(
    ("class_name", "factory", "side"),
    (
        ("sudoku", lambda: Sudoku(2, 2, 2, 2), 4),
        ("latinsquare", lambda: LatinSquare(4), 4),
        ("diagonallatinsquare", lambda: DiagonalLatinSquare(4), 4),
        ("pandiagonallatinsquare", lambda: PandiagonalLatinSquare(4), 4),
    ),
)
@pytest.mark.parametrize("row_wise", (True, False))
def test_deterministic_simple_parser_fuzz(class_name, factory, side, row_wise):
    for seed in range(12):
        rng = random.Random(sum(map(ord, class_name)) * 100 + seed)
        values = [rng.randrange(side + 1) for _ in range(side * side)]
        compact = _compact(values, rng)
        spaced = _spaced(values, rng)

        direct = factory()
        direct.load(compact, row_wise=row_wise)

        from_factory = create_from_str_and_class(
            compact,
            class_name,
            row_wise=row_wise,
        )
        from_prefixed = create_from_str(
            f"{class_name}::{compact}",
            row_wise=row_wise,
        )
        from_spaced = create_from_str_and_class(
            spaced,
            class_name,
            row_wise=row_wise,
            space_sep=True,
        )
        from_nested = factory()
        from_nested.load(_nested(values, side), row_wise=row_wise)

        _assert_equivalent(
            direct,
            from_factory,
            from_prefixed,
            from_spaced,
            from_nested,
        )


@pytest.mark.parametrize("row_wise", (True, False))
def test_deterministic_futoshiki_parser_fuzz(row_wise):
    for seed in range(16):
        rng = random.Random(0xF070 + seed)
        side = 1 + seed % 4
        values = [rng.randrange(side + 1) for _ in range(side * side)]
        edge_count = side * (side - 1)
        horizontal = [rng.choice("-<>") for _ in range(edge_count)]
        vertical = [rng.choice("-<>") for _ in range(edge_count)]
        tokens: list[object] = [*values, *horizontal, *vertical]
        compact = _compact(values, rng) + "".join(horizontal + vertical)
        spaced = _spaced(tokens, rng)

        direct = Futoshiki(side)
        direct.load(compact, row_wise=row_wise)
        from_factory = create_from_str_and_class(
            compact,
            "futoshiki",
            row_wise=row_wise,
        )
        from_prefixed = create_from_str(
            f"Futoshiki::{compact}",
            row_wise=row_wise,
        )
        from_spaced = create_from_str_and_class(
            spaced,
            "futoshiki",
            row_wise=row_wise,
            space_sep=True,
        )
        from_iterable = Futoshiki(side)
        from_iterable.load((token for token in tokens), row_wise=row_wise)

        _assert_equivalent(
            direct,
            from_factory,
            from_prefixed,
            from_spaced,
            from_iterable,
        )


def _killer_fixture(seed: int) -> tuple[str, dict[str, int], str]:
    rng = random.Random(0xCACE + seed)
    labels = list(string.ascii_lowercase[:16])
    rng.shuffle(labels)
    values = {label: rng.randrange(1, 5) for label in labels}
    layout = "".join(labels)
    definitions = "".join(f"{label}{values[label]}" for label in reversed(labels))
    return layout, values, f"{layout}:{definitions}"


@pytest.mark.parametrize("row_wise", (True, False))
def test_deterministic_killer_parser_fuzz(row_wise):
    for seed in range(8):
        layout, definitions, compact = _killer_fixture(seed)
        rng = random.Random(0xCA6E + seed)
        dictionary_tokens: list[object] = []
        for label in reversed(layout):
            dictionary_tokens.extend((label, definitions[label]))
        spaced = _spaced([*layout, ":", *dictionary_tokens], rng)

        direct = KillerSudoku(None, 2, 2, 2, 2)
        direct.load(compact, row_wise=row_wise)
        from_factory = create_from_str_and_class(
            compact,
            "killersudoku",
            row_wise=row_wise,
        )
        from_prefixed = create_from_str(
            f"KillerSudoku::{compact}",
            row_wise=row_wise,
        )
        from_spaced = create_from_str_and_class(
            spaced,
            "killersudoku",
            row_wise=row_wise,
            space_sep=True,
        )
        from_mapping = KillerSudoku(None, 2, 2, 2, 2)
        from_mapping.load_with_dic(
            layout,
            definitions,
            row_wise=row_wise,
        )

        _assert_equivalent(
            direct,
            from_factory,
            from_prefixed,
            from_spaced,
            from_mapping,
        )


def _kenken_fixture(seed: int) -> tuple[str, dict[str, tuple[str, int]], str]:
    rng = random.Random(0x6E6 + seed)
    labels = list(string.ascii_lowercase[:16])
    rng.shuffle(labels)
    definitions = {
        label: ("+", rng.randrange(1, 5))
        for label in labels
    }
    layout = "".join(labels)
    dictionary = "".join(
        f"{label}{definitions[label][0]}{definitions[label][1]}"
        for label in reversed(labels)
    )
    return layout, definitions, f"{layout}:{dictionary}"


@pytest.mark.parametrize("row_wise", (True, False))
def test_deterministic_kenken_parser_fuzz(row_wise):
    for seed in range(8):
        layout, definitions, compact = _kenken_fixture(seed)
        rng = random.Random(0x6E60 + seed)
        dictionary_tokens: list[object] = []
        for label in reversed(layout):
            operator, target = definitions[label]
            dictionary_tokens.extend((label, operator, target))
        spaced = _spaced([*layout, ":", *dictionary_tokens], rng)

        direct = Kenken(None, 4)
        direct.load(compact, row_wise=row_wise)
        from_factory = create_from_str_and_class(
            compact,
            "kenken",
            row_wise=row_wise,
        )
        from_prefixed = create_from_str(
            f"Kenken::{compact}",
            row_wise=row_wise,
        )
        from_spaced = create_from_str_and_class(
            spaced,
            "kenken",
            row_wise=row_wise,
            space_sep=True,
        )
        from_mapping = Kenken(None, 4)
        from_mapping.load_with_dic(
            layout,
            definitions,
            row_wise=row_wise,
        )

        _assert_equivalent(
            direct,
            from_factory,
            from_prefixed,
            from_spaced,
            from_mapping,
        )


@pytest.mark.parametrize("operator", ("+", "-", "*", "/", ":"))
def test_kenken_dictionary_round_trip_covers_every_operator(operator):
    target = 0 if operator == "-" else 2
    payload = f"aabb:{'a'}{operator}{target}b+3"
    direct = Kenken(None, 2)
    direct.load(payload)

    mapping = Kenken(None, 2)
    mapping.load_with_dic(
        "aabb",
        {
            "a": (operator, target),
            "b": ("+", 3),
        },
    )
    _assert_equivalent(direct, mapping)


def test_file_round_trip_preserves_space_separated_payload(tmp_path):
    values = [1, 0, 0, 2]
    payload = _spaced(values, random.Random(41))
    path = tmp_path / "latin.pzl"
    path.write_text(
        "# deterministic parser round-trip\n"
        "LatinSquare::\n"
        f"{payload}\n",
        encoding="utf-8",
    )

    from_file = create_from_file(path, space_sep=True)
    direct = create_from_str_and_class(
        payload,
        "latinsquare",
        space_sep=True,
    )
    _assert_equivalent(direct, from_file)


def test_space_separated_blank_is_exact_not_a_decimal_rewrite():
    blank = Grid(1)
    blank.load(".", space_sep=True)
    assert blank.known == (0,)

    grid = Grid(1, 1, max_elem=200)
    with pytest.raises(ValueError, match="Cannot parse grid value"):
        grid.load("1.2", space_sep=True)
    assert not grid.has_been_filled


def test_space_separated_preprocessor_accepts_all_whitespace_and_rejects_bad_parts():
    assert _load_preprocess_str_space_sep("1\u20032\v.\f3") == ["1", "2", "0", "3"]
    with pytest.raises(TypeError, match="only strings"):
        _load_preprocess_str_space_sep(("1", 2, "3"))


def test_malformed_futoshiki_fuzz_is_transactional_and_retryable():
    for seed in range(12):
        rng = random.Random(0xBAD + seed)
        side = 2 + seed % 3
        edge_count = side * (side - 1)
        values = [rng.randrange(side + 1) for _ in range(side * side)]
        symbols = [rng.choice("-<>") for _ in range(2 * edge_count)]
        corrupted = _compact(values, rng) + "".join(symbols)
        position = side * side + rng.randrange(len(symbols))
        corrupted = corrupted[:position] + "?" + corrupted[position + 1 :]

        grid = Futoshiki(side)
        before_rules = grid.rules.copy()
        with pytest.raises(ValueError, match="Cannot parse inequality symbol"):
            grid.load(corrupted)
        assert grid.known == (0,) * (side * side)
        assert grid.rules == before_rules
        assert not grid.has_been_filled

        valid = _compact(values, rng) + "-" * (2 * edge_count)
        grid.load(valid)
        assert grid.has_been_filled
