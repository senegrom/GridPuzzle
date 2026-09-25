"""Native tests for the same adapter shipped inside the browser archive."""
import json
from pathlib import Path
import pytest
from gridsolver.web_api import build_grid, solve_payload, solve_json

# Payloads shared with the browser's own contract tests (input-safety.test.js).
FIXTURES = json.loads(
    (Path(__file__).parents[1] / "web/tests/fixtures/payloads.json").read_text(encoding="utf-8")
)


def puzzle(kind='sudoku', rows=4, cols=None, cells=None, **extra):
    cols = rows if cols is None else cols
    return dict(version=1, type=kind, rows=rows, cols=cols,
                boxRows=2, boxCols=2,
                cells=[None] * (rows * cols) if cells is None else cells, **extra)


SQUARE = [1,2,3,4, 3,4,1,2, 2,1,4,3, 4,3,2,1]


def test_row_major_and_unchanged_input():
    p = puzzle(cells=SQUARE.copy())
    p['cells'][6] = None
    before = json.dumps(p)
    result = solve_payload(p)
    assert result['status'] == 'unique'
    assert result['solutions'][0]['cells'] == SQUARE
    assert json.dumps(p) == before


def test_multiple_and_no_solution():
    assert solve_payload(puzzle())['status'] == 'multiple'
    p = puzzle(cells=SQUARE.copy())
    p['cells'][1] = 1
    assert solve_payload(p)['status'] == 'no-solution'


@pytest.mark.parametrize('kind', ['latinsquare', 'futoshiki', 'killersudoku', 'kenken'])
def test_dense_families(kind):
    extra = {}
    if kind in ('killersudoku', 'kenken'):
        extra['cages'] = [{'cells': [i], 'target': n, 'op': '+'} for i, n in enumerate(SQUARE)]
    if kind == 'futoshiki':
        extra['inequalities'] = [{'less': 0, 'greater': 1}]
    p = puzzle(kind, cells=SQUARE.copy(), **extra)
    p['cells'][0] = None
    assert solve_payload(p)['solutions'][0]['cells'] == SQUARE


def test_path_blocked_and_rectangular():
    p = puzzle('hidato', 2, 3, [1, '#', 5, 2, None, 4])
    result = solve_payload(p)
    assert result['status'] == 'unique'
    assert result['solutions'][0]['cells'] == [1, '#', 5, 2, 3, 4]
    p = puzzle('numbrix', 2, 3, [1, 2, 3, 6, None, 4])
    assert solve_payload(p)['solutions'][0]['cells'] == [1, 2, 3, 6, 5, 4]


def test_slitherlink_zero_and_edge_encoding():
    assert solve_payload(puzzle('slitherlink', 1, cells=[0]))['status'] == 'no-solution'
    result = solve_payload(puzzle('slitherlink', 1, cells=[4]))
    assert result['status'] == 'unique'
    assert result['solutions'][0]['edges'] == [['H', 0, 0], ['H', 1, 0], ['V', 0, 0], ['V', 0, 1]]


def test_kakuro():
    p = puzzle('kakuro', 3, cells=['#','#','#', '#',1,None, '#',None,None], clues=[
        {'cell': 1, 'down': 4}, {'cell': 2, 'down': 6},
        {'cell': 3, 'across': 3}, {'cell': 6, 'across': 7}])
    result = solve_payload(p)
    assert result['status'] == 'unique'
    assert result['solutions'][0]['cells'] == ['#','#','#', '#',1,2, '#',3,4]


@pytest.mark.parametrize('bad', [True, -1, 0, 26, 3.5, '4', None])
def test_bad_dimensions(bad):
    with pytest.raises(ValueError):
        build_grid(puzzle(rows=4) | {'rows': bad})


@pytest.mark.parametrize('change', [
    {'type': 'auto'}, {'cells': [True] * 16}, {'cells': [0] * 16},
    {'rows': 3}, {'version': 2}, {'diagonal': True},
    {'inequalities': [{'less': 0, 'greater': 1}]},
    {'cells': ['#'] * 16}, {'boxRows': 3},
    {'cages': [{'cells': [0], 'target': 1}]},
])
def test_reject_silently_ignored_or_malformed_data(change):
    with pytest.raises(ValueError):
        build_grid(puzzle() | change)


def test_missing_and_overlapping_cages():
    for cages in ([], [{'cells': [0], 'target': 1}],
                  [{'cells': [0,0], 'target': 3}]):
        with pytest.raises(ValueError):
            build_grid(puzzle('killersudoku', cages=cages))


def test_invalid_json_and_executable_text():
    assert json.loads(solve_json('import os'))['status'] == 'invalid'
    assert json.loads(solve_json('[]'))['status'] == 'invalid'
    assert json.loads(solve_json('x' * 200001))['status'] == 'invalid'


def test_browser_str8ts_numbered_black_cell():
    from gridsolver.web_api import solve_payload
    p = {
        "version": 1, "type": "str8ts", "rows": 3, "cols": 3,
        "black": [4],
        "cells": [1, 2, 3, 2, 3, 1, 3, 1, None],
        "cages": [], "inequalities": [], "clues": [],
    }
    result = solve_payload(p)
    assert result["status"] == "unique"
    assert result["solutions"][0]["cells"] == [1,2,3,2,3,1,3,1,2]


def test_unexpected_solver_exception_is_reported_not_raised(monkeypatch):
    import gridsolver.web_api as web_api

    def explode(payload):
        raise RuntimeError('unexpected solver state')

    monkeypatch.setattr(web_api, 'build_grid', explode)
    result = json.loads(solve_json('{"type": "sudoku", "rows": 4, "cols": 4, "cells": ' + json.dumps([None] * 16) + '}'))
    assert result['status'] == 'error'
    assert 'RuntimeError' in result['message']


def test_json_nested_too_deeply_is_invalid_data_not_a_solver_error(monkeypatch):
    # json.loads recurses per level. Where the stack runs out first (Windows
    # here, Pyodide in the browser) it raised RecursionError, which the
    # adapter reported as a solver error; where the text parses (Linux), the
    # payload checks reject it. Either way it is invalid data.
    for text in ('[' * 100_000 + ']' * 100_000, '{"a":' * 30_000 + '1' + '}' * 30_000):
        assert json.loads(solve_json(text))['status'] == 'invalid'

    import types
    import gridsolver.web_api as web_api

    def exhausted(text):
        raise RecursionError('maximum recursion depth exceeded while decoding a JSON array')

    monkeypatch.setattr(web_api, 'json', types.SimpleNamespace(loads=exhausted, dumps=json.dumps))
    assert json.loads(solve_json('[[]]')) == {'status': 'invalid', 'message': 'Puzzle data is nested too deeply'}


def test_a_failed_solve_still_releases_the_partition_cache(monkeypatch):
    import gridsolver.web_api as web_api
    from gridsolver.rules import sumrules

    def fill_then_fail(grid, **options):
        sumrules._PARTITION_MASKS.get(6, 30, 9)
        raise RuntimeError('solver failed after filling the cache')

    monkeypatch.setattr(web_api, 'solve', fill_then_fail)
    result = json.loads(solve_json(json.dumps(puzzle())))
    assert result['status'] == 'error'
    assert sumrules._PARTITION_MASKS.info() == (0, 0)


def test_escaped_key_error_is_a_solver_error_not_invalid_data(monkeypatch):
    # Every payload check raises ValueError or TypeError. A KeyError can only
    # be a bug, and reporting it as invalid data sent users to recheck clues.
    import gridsolver.web_api as web_api

    def lookup_bug(payload):
        return {}['missing']

    monkeypatch.setattr(web_api, 'build_grid', lookup_bug)
    result = json.loads(solve_json('{"type": "sudoku", "rows": 4, "cols": 4, "cells": ' + json.dumps([None] * 16) + '}'))
    assert result == {'status': 'error', 'message': "KeyError: 'missing'"}


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f["name"])
def test_shared_payload_contract(fixture):
    if fixture["solver"]:
        build_grid(fixture["payload"])
    else:
        with pytest.raises(ValueError):
            build_grid(fixture["payload"])


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
