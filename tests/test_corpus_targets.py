"""Generated image targets must carry real solution witnesses, not just valid JSON."""
import copy
import random

import pytest

from corpus.generate_puzzles import gen_killersudoku, gen_kenken, gen_path, payload
from corpus.validate_target import validate_target
from gridsolver.solver.validation import InvalidSolutionError


@pytest.mark.parametrize("size", [4, 6, 9])
@pytest.mark.parametrize("seed", range(50))
def test_killer_witness_satisfies_every_rule(size, seed):
    puzzle, solution = gen_killersudoku(random.Random(seed), size)
    before = copy.deepcopy(puzzle)
    covered = []
    for cage in puzzle["cages"]:
        values = [solution[i] for i in cage["cells"]]
        assert len(set(values)) == len(values)
        assert sum(values) == cage["target"]
        covered.extend(cage["cells"])
    assert sorted(covered) == list(range(size * size))
    validate_target(puzzle, solution)
    assert puzzle == before


def test_old_seed_one_impossible_cage_is_rejected():
    # Old gen_killersudoku(Random(1), 4) put [2,4,4,1] in this four-cell cage.
    # A sum of 11 is impossible for four distinct digits from 1..4.
    impossible = [6, 7, 10, 11]
    # Use the actual witness from a valid Sudoku; the impossible cage is enough
    # to reject it regardless of the singleton targets elsewhere.
    _, solution = gen_killersudoku(random.Random(1), 4)
    cages = [{"cells": impossible, "target": 11, "op": "+"}]
    cages += [{"cells": [i], "target": v, "op": "+"}
              for i, v in enumerate(solution) if i not in impossible]
    puzzle = payload("killersudoku", 4, 4, [None] * 16, boxRows=2, boxCols=2, cages=cages)
    with pytest.raises(InvalidSolutionError):
        validate_target(puzzle, solution)


def test_dense_witness_is_row_major_and_cannot_replace_givens():
    puzzle = payload("latinsquare", 3, 3, [1] + [None] * 8)
    solution = [1, 2, 3, 3, 1, 2, 2, 3, 1]
    validate_target(puzzle, solution)
    puzzle["cells"][1] = 3
    with pytest.raises(InvalidSolutionError):
        validate_target(puzzle, solution)


@pytest.mark.parametrize("kind", ["hidato", "numbrix"])
def test_compact_witness_uses_board_keys(kind):
    puzzle, solution = gen_path(kind, random.Random(1), 3, 4)
    validate_target(puzzle, solution)


def test_compact_witness_preserves_blocks():
    puzzle = payload("hidato", 2, 2, [1, None, None, "#"])
    validate_target(puzzle, [1, 2, 3, "#"])
    with pytest.raises(ValueError, match="blocked"):
        validate_target(puzzle, [1, 2, 3, 4])


def test_kenken_remains_valid_with_its_existing_cage_semantics():
    for seed in range(15):
        puzzle, solution = gen_kenken(random.Random(seed), 5)
        validate_target(puzzle, solution)


@pytest.mark.parametrize("solution", [[], [1, 2, 2], [True, 2, 2, 1], [None, 2, 2, 1]])
def test_bad_solution_shape_or_values_are_rejected(solution):
    with pytest.raises((ValueError, TypeError)):
        validate_target(payload("latinsquare", 2, 2, [None] * 4), solution)


def test_no_witness_only_checks_payload_shape():
    assert validate_target(payload("slitherlink", 1, 1, [None]), None) is not None
    with pytest.raises(ValueError, match="edge assignments"):
        validate_target(payload("slitherlink", 1, 1, [None]), [4])
