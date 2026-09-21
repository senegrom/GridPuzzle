import subprocess
import sys
from itertools import permutations, product
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid_loading import create_from_file, create_from_str
from gridsolver.grid_classes.cage_loading import _parse_compact_dictionary
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce, SumRule
from gridsolver.solver.solver import solve


def test_killer_compact_dictionary_supports_numeric_labels():
    grid = KillerSudoku(None, 2, 2, 2, 2)

    grid.load("aaaabbbbcccc0000:a10b10c10010")

    cages = tuple(
        rule
        for rule in grid.rules
        if isinstance(rule, SumAndElementsAtMostOnce)
    )
    assert grid.has_been_filled
    assert len(cages) == 4
    assert {cage.sum for cage in cages} == {10}


def test_kenken_compact_dictionary_supports_numeric_labels():
    grid = Kenken(n=2)

    grid.load("aa00:a+30+3")

    cages = tuple(rule for rule in grid.rules if type(rule) is SumRule)
    assert grid.has_been_filled
    assert len(cages) == 2
    assert {cage.sum for cage in cages} == {3}


def test_hard_killer_corpus_keeps_its_original_zero_label():
    path = (
        Path(__file__).resolve().parents[1]
        / "Examples/KillerSudoku/20201001_hard290.pzl"
    )

    grid = create_from_file(path)

    cages = tuple(
        rule
        for rule in grid.rules
        if isinstance(rule, SumAndElementsAtMostOnce)
    )
    assert len(cages) == 27
    assert any(cage.sum == 16 for cage in cages)


def test_compact_dictionary_rejects_genuine_ambiguity():
    def parse_header(source, position):
        return position + 1, None

    def make_definition(_label, _metadata, target):
        return target

    with pytest.raises(ValueError, match="dictionary is ambiguous"):
        _parse_compact_dictionary(
            "a2112",
            ("a", "1"),
            description="Test",
            parse_header=parse_header,
            make_definition=make_definition,
        )


def test_failed_numeric_label_parse_is_transactional():
    grid = KillerSudoku(None, 2, 2, 2, 2)
    before_rules = grid.rules.copy()

    with pytest.raises(ValueError, match="string format invalid"):
        grid.load("aaaabbbbcccc0000:a10b10c10")

    assert not grid.has_been_filled
    assert grid.rules == before_rules


def test_importing_kenken_does_not_import_sudoku_or_killer_sudoku():
    output = subprocess.check_output(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "import gridsolver.grid_classes.kenken; "
                "print([name for name in "
                "('gridsolver.grid_classes.sudoku', "
                "'gridsolver.grid_classes.killer_sudoku') "
                "if name in sys.modules])"
            ),
        ],
        text=True,
    )
    assert output.strip() == "[]"


def test_cage_entry_factory_runs_once_per_distinct_label(monkeypatch):
    grid = Kenken(None, 2)
    original = grid._make_cage_entry
    calls = []

    def counted(definition):
        calls.append(definition)
        return original(definition)

    monkeypatch.setattr(grid, "_make_cage_entry", counted)
    grid.load_with_dic(
        "aabb",
        {"a": ("+", 3), "b": ("+", 3)},
    )

    assert calls == [("+", 3), ("+", 3)]


@pytest.mark.parametrize("family,side", [("Kenken", 32), ("KillerSudoku", 36)])
def test_large_compact_dictionary_loads_and_solves_without_recursion(family, side):
    # Distinct non-numeric single-character labels keep this long dictionary
    # unambiguous. Every singleton cage fixes one value of a valid Latin square
    # or 6x6-box Sudoku, so solving is small even though parsing has >1000 cages.
    labels = tuple(chr(0x4E00 + cell) for cell in range(side * side))
    expected = [
        ((row if family == "Kenken" else row * 6 + row // 6) + col) % side + 1
        for row in range(side)
        for col in range(side)
    ]
    operator = "+" if family == "Kenken" else ""
    dictionary = "".join(
        f"{label}{operator}{value}"
        for label, value in zip(labels, expected, strict=True)
    )

    grid = create_from_str(f"{family}::{''.join(labels)}:{dictionary}")
    solutions = solve(grid, max_sols=2, log_level=-1)

    assert len(solutions) == 1
    solution = next(iter(solutions))
    assert [solution[row, col] for row in range(side) for col in range(side)] == expected


@pytest.mark.parametrize("labels", [("a", "1"), ("1", "2"), ("a", "1", "2")])
def test_numeric_dictionary_parses_match_independent_serialization_oracle(labels):
    targets = (1, 2, 11, 12, 21, 22)
    encodings = {}
    # Enumerate complete definitions and serialize them, independently of the
    # parser's boundary search. Colliding strings must be rejected as ambiguous.
    for order in permutations(labels):
        for values in product(targets, repeat=len(labels)):
            definitions = tuple(zip(order, values, strict=True))
            text = "".join(f"{label}{value}" for label, value in definitions)
            encodings.setdefault(text, set()).add(definitions)

    options = {
        "description": "Oracle",
        "parse_header": lambda source, position: (position + 1, None),
        "make_definition": lambda label, metadata, target: target if target in targets else None,
    }
    ambiguous = 0
    for text, definitions in encodings.items():
        if len(definitions) > 1:
            ambiguous += 1
            with pytest.raises(ValueError, match="dictionary is ambiguous"):
                _parse_compact_dictionary(text, labels, **options)
        else:
            assert _parse_compact_dictionary(text, labels, **options) == dict(next(iter(definitions)))
    assert ambiguous > 0
