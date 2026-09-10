"""Authoritative boundary for corrected black readings and optional operators."""
import pytest

from gridsolver.web_api import build_grid, solve_payload


def test_numbered_black_clue_changes_the_solution_count():
    puzzle = {
        "version": 1, "type": "str8ts", "rows": 3, "cols": 3,
        "cells": [1, None, None, None, 3, None, None, None, None],
        "black": [4],
    }
    assert solve_payload(puzzle)["status"] == "unique"
    puzzle["cells"][4] = "#"
    assert solve_payload(puzzle)["status"] == "multiple"


@pytest.mark.parametrize("operator", [None, "", False, {}, 1])
def test_explicit_invalid_operator_is_not_the_omitted_sum_default(operator):
    puzzle = {
        "type": "kenken", "rows": 2, "cols": 2,
        "cells": [1, 2, 2, 1],
        "cages": [{"cells": [i], "target": v, "op": operator}
                  for i, v in enumerate([1, 2, 2, 1])],
    }
    with pytest.raises(ValueError, match="operator"):
        build_grid(puzzle)


@pytest.mark.parametrize("explicit", [False, True])
def test_sum_default_and_explicit_sum_have_identical_solutions(explicit):
    puzzle = {
        "type": "kenken", "rows": 2, "cols": 2,
        "cells": [1, 2, 2, 1],
        "cages": [{"cells": [i], "target": v, **({"op": "+"} if explicit else {})}
                  for i, v in enumerate([1, 2, 2, 1])],
    }
    assert solve_payload(puzzle)["status"] == "unique"
