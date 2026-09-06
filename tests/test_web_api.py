"""Native tests for the same adapter shipped inside the browser archive."""
import json
import pytest
from gridsolver.web_api import build_grid, solve_payload, solve_json


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
        extra['cages'] = [dict(cells=[i], target=n, op='+') for i, n in enumerate(SQUARE)]
    if kind == 'futoshiki':
        extra['inequalities'] = [dict(less=0, greater=1)]
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
        dict(cell=1, down=4), dict(cell=2, down=6),
        dict(cell=3, across=3), dict(cell=6, across=7)])
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
    {'inequalities': [dict(less=0, greater=1)]},
    {'cells': ['#'] * 16}, {'boxRows': 3},
    {'cages': [dict(cells=[0], target=1)]},
])
def test_reject_silently_ignored_or_malformed_data(change):
    with pytest.raises(ValueError):
        build_grid(puzzle() | change)


def test_missing_and_overlapping_cages():
    for cages in ([], [dict(cells=[0], target=1)],
                  [dict(cells=[0,0], target=3)]):
        with pytest.raises(ValueError):
            build_grid(puzzle('killersudoku', cages=cages))


def test_invalid_json_and_executable_text():
    assert json.loads(solve_json('import os'))['status'] == 'invalid'
    assert json.loads(solve_json('[]'))['status'] == 'invalid'
    assert json.loads(solve_json('x' * 200001))['status'] == 'invalid'
