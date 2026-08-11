import subprocess
import sys
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid_loading import create_from_file
from gridsolver.grid_classes.cage_loading import _parse_compact_dictionary
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce, SumRule


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


def test_importing_kenken_does_not_import_killer_sudoku():
    output = subprocess.check_output(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "import gridsolver.grid_classes.kenken; "
                "print('gridsolver.grid_classes.killer_sudoku' in sys.modules)"
            ),
        ],
        text=True,
    )
    assert output.strip() == "False"
