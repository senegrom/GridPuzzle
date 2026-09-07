"""Data-only browser boundary. No eval, module loading, or weaker solver mode.

Coordinates at this boundary are zero-based, ROW-MAJOR flat indexes. The
existing engine remains column-major internally; never serialize it by list().
Null means an empty cell. '#' means blocked. Slitherlink zero is a real clue.
"""
from __future__ import annotations

import json
import time
from collections import namedtuple
from collections.abc import Mapping

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.latins_square import (
    LatinSquare, DiagonalLatinSquare, PandiagonalLatinSquare,
)
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.grid_classes.kakuro import Kakuro
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.grid_classes.str8ts import Str8ts
from gridsolver.solver.solver import solve

TYPES = (
    'sudoku', 'killersudoku', 'futoshiki', 'kenken', 'latinsquare',
    'diagonallatinsquare', 'pandiagonallatinsquare', 'hidato', 'numbrix',
    'kakuro', 'slitherlink', 'str8ts',
)
_ALLOWED = {'version', 'type', 'rows', 'cols', 'boxRows', 'boxCols',
            'cells', 'cages', 'inequalities', 'clues', 'black'}
_Cage = namedtuple('BrowserCage', 'mytarget cells operator')


def _integer(value, name, lo, hi):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f'{name} must be an integer')
    if not lo <= value <= hi:
        raise ValueError(f'{name} must be between {lo} and {hi}')
    return value


def _array(value, name, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f'{name} must be an array of at most {maximum} entries')
    return value


def _object(value, allowed, name):
    if not isinstance(value, Mapping):
        raise ValueError(f'{name} must be an object')
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f'Unsupported {name} fields: {sorted(unknown)}')
    return value


def build_grid(payload):
    """Validate JSON-shaped data and construct the existing puzzle classes."""
    p = _object(payload, _ALLOWED, 'puzzle')
    _integer(p.get('version', 1), 'version', 1, 1)
    kind = p.get('type')
    if kind not in TYPES:
        raise ValueError('Choose a supported puzzle type; Automatic is a scanner setting')
    rows = _integer(p.get('rows'), 'rows', 1, 25)
    cols = _integer(p.get('cols'), 'cols', 1, 25)
    count = rows * cols
    raw = _array(p.get('cells'), 'cells', count)
    if len(raw) != count:
        raise ValueError(f'Expected exactly {count} row-major cells')
    cages = _array(p.get('cages', []), 'cages', count)
    inequalities = _array(p.get('inequalities', []), 'inequalities', 2 * count)
    clues = _array(p.get('clues', []), 'clues', count)
    black_raw = _array(p.get('black', []), 'black', count)
    black_cells = {_integer(i, 'Black cell', 0, count - 1) for i in black_raw}
    if len(black_cells) != len(black_raw):
        raise ValueError('Black cells must be distinct')
    if black_cells and kind != 'str8ts':
        raise ValueError('Black-cell metadata is only supported for Str8ts')
    if cages and kind not in ('killersudoku', 'kenken'):
        raise ValueError('Cages are only supported for Killer Sudoku and KenKen')
    if inequalities and kind != 'futoshiki':
        raise ValueError('Inequalities require Futoshiki')
    if clues and kind != 'kakuro':
        raise ValueError('Across/down clues require Kakuro')
    dense = kind not in ('hidato', 'numbrix', 'kakuro', 'slitherlink', 'str8ts')
    if dense and rows != cols:
        raise ValueError('This puzzle type requires a square board')
    blocked = {i for i, v in enumerate(raw) if v == '#'}
    if blocked and kind not in ('hidato', 'kakuro', 'str8ts'):
        raise ValueError('Blocked cells are only supported in Hidato, Kakuro and Str8ts')
    if kind == 'str8ts':
        if rows != cols or rows > 9:
            raise ValueError('Str8ts requires a square board no larger than 9x9')
        if blocked - black_cells:
            raise ValueError('Every # Str8ts cell must be listed in black')
        if any(i in black_cells and raw[i] is None for i in range(count)):
            raise ValueError('A Str8ts black cell must contain # or a numbered clue')
    maximum = 4 if kind == 'slitherlink' else (
        count - len(blocked) if kind in ('hidato', 'numbrix') else
        9 if kind == 'kakuro' else rows
    )
    values = []
    for i, value in enumerate(raw):
        if value is None or value == '#':
            values.append(value)
        else:
            values.append(_integer(value, f'Cell {i + 1}',
                                   0 if kind == 'slitherlink' else 1, maximum))
    coord = lambda i: divmod(i, cols)
    if kind in ('sudoku', 'killersudoku'):
        br = _integer(p.get('boxRows', 3), 'boxRows', 1, rows)
        bc = _integer(p.get('boxCols', 3), 'boxCols', 1, cols)
        if br * bc != rows or rows % br or cols % bc:
            raise ValueError('Box dimensions must tile the board and contain one of each value')
        cls = Sudoku if kind == 'sudoku' else KillerSudoku
        grid = cls(rows_in_box=br, cols_in_box=bc, box_rows=rows // br, box_cols=cols // bc)
    elif kind == 'kenken':
        grid = Kenken(n=rows)
    elif kind == 'futoshiki':
        grid = Futoshiki(rows)
    elif kind in ('latinsquare', 'diagonallatinsquare', 'pandiagonallatinsquare'):
        grid = {'latinsquare': LatinSquare, 'diagonallatinsquare': DiagonalLatinSquare,
                'pandiagonallatinsquare': PandiagonalLatinSquare}[kind](rows)
    elif kind in ('hidato', 'numbrix'):
        cls = Hidato if kind == 'hidato' else Numbrix
        grid = cls.from_board([values[r * cols:(r + 1) * cols] for r in range(rows)])
    elif kind == 'slitherlink':
        grid = Slitherlink([values[r * cols:(r + 1) * cols] for r in range(rows)])
    elif kind == 'str8ts':
        numbered = {i for i in black_cells if isinstance(values[i], int)}
        grid = Str8ts(rows, cols, black=[coord(i) for i in black_cells],
                      numbered_black=[coord(i) for i in numbered])
        grid.load_key_values({coord(i): value for i, value in enumerate(values)
                              if isinstance(value, int)})
    else:
        white = set(range(count)) - blocked
        runs, seen = [], set()
        for clue in clues:
            _object(clue, {'cell', 'across', 'down'}, 'Kakuro clue')
            at = _integer(clue.get('cell'), 'Clue cell', 0, count - 1)
            if at not in blocked or at in seen:
                raise ValueError('Each Kakuro clue must occupy a distinct blocked cell')
            seen.add(at)
            if clue.get('across') is None and clue.get('down') is None:
                raise ValueError('A clue needs an across or down target')
            r, c = coord(at)
            for direction, dr, dc in (('across', 0, 1), ('down', 1, 0)):
                target = clue.get(direction)
                if target is None:
                    continue
                target = _integer(target, f'{direction} target', 1, 45)
                cells = []
                rr, cc = r + dr, c + dc
                while 0 <= rr < rows and 0 <= cc < cols and rr * cols + cc in white:
                    cells.append((rr, cc))
                    rr, cc = rr + dr, cc + dc
                runs.append((target, cells))
        grid = Kakuro(rows, cols, [coord(i) for i in white], runs)
        grid.load_key_values({coord(i): v for i, v in enumerate(values)
                              if v is not None and v != '#'})
    if kind in ('killersudoku', 'kenken'):
        covered, entries = set(), []
        for cage in cages:
            _object(cage, {'cells', 'target', 'op'}, 'cage')
            indices = _array(cage.get('cells'), 'cage cells', count)
            if not indices:
                raise ValueError('Cages must not be empty')
            indices = [_integer(i, 'Cage cell', 0, count - 1) for i in indices]
            area = set(indices)
            if len(area) != len(indices) or covered & area:
                raise ValueError('Cages may not overlap or repeat cells')
            reached, pending = {indices[0]}, [indices[0]]
            while pending:
                r, c = coord(pending.pop())
                for rr, cc in ((r-1, c), (r+1, c), (r, c-1), (r, c+1)):
                    nxt = rr * cols + cc
                    if 0 <= rr < rows and 0 <= cc < cols and nxt in area - reached:
                        reached.add(nxt)
                        pending.append(nxt)
            if reached != area:
                raise ValueError('Cage cells must be orthogonally connected')
            covered |= area
            target = _integer(cage.get('target'), 'Cage target', 1, 10**12)
            op = cage.get('op', '+')
            if op == '=' and len(area) == 1:
                op = '+'
            if op not in ('+', '-', '*', '/') or (kind == 'killersudoku' and op != '+'):
                raise ValueError('Unsupported cage operator')
            if op in ('-', '/') and len(area) != 2:
                raise ValueError('Difference and division cages require exactly two cells')
            cells = [coord(i) for i in indices]
            entries.append((target, cells) if kind == 'killersudoku' else _Cage(target, cells, op))
        if covered != set(range(count)):
            raise ValueError(f'Cages must cover every cell; {count - len(covered)} cells need a cage')
        if kind == 'killersudoku':
            grid.ext_sum_cells(entries)
        else:
            grid.ext_target_cells(entries)
    if kind == 'futoshiki':
        pairs = []
        for item in inequalities:
            _object(item, {'less', 'greater'}, 'inequality')
            a = _integer(item.get('less'), 'Smaller cell', 0, count - 1)
            b = _integer(item.get('greater'), 'Larger cell', 0, count - 1)
            pairs.append((coord(a), coord(b)))
        grid.ext_ineqs(pairs)
    if dense:
        # Bypass family-specific text/cage loaders, NOT the constraint engine.
        Grid.load(grid, [0 if value is None else value for value in values], row_wise=True)
    return grid


def solve_payload(payload):
    """Finish a search capped at two; unfinished searches never imply uniqueness.

    The worker owns deadlines and cancellation by terminating its interpreter.
    Both results are independently validated by the existing solver.solve().
    """
    started = time.perf_counter()
    grid = build_grid(payload)
    solutions = solve(grid, processes=0, max_sols=2, log_level=-1)
    rendered = []
    rows, cols = payload['rows'], payload['cols']
    for solution in sorted(solutions, key=lambda s: tuple(s)):
        if isinstance(grid, Slitherlink):
            rendered.append({'cells': list(payload['cells']),
                             'edges': [list(edge) for edge in sorted(grid.selected_edges(solution))]})
        elif hasattr(grid, 'values_by_key'):
            keyed = grid.values_by_key(solution)
            rendered.append({'cells': [keyed.get((r, c), '#') for r in range(rows) for c in range(cols)],
                             'edges': []})
        else:
            rendered.append({'cells': [solution[r, c] for r in range(rows) for c in range(cols)],
                             'edges': []})
    return {'status': ('no-solution', 'unique', 'multiple')[len(rendered)],
            'solutions': rendered, 'elapsed': time.perf_counter() - started,
            'complete': True, 'countIsLowerBound': len(rendered) == 2}


def solve_json(text):
    if not isinstance(text, str) or len(text) > 200_000:
        return json.dumps({'status': 'invalid', 'message': 'Puzzle data is too large'})
    try:
        payload = json.loads(text)
        result = solve_payload(payload)
    except (TypeError, ValueError, KeyError) as exc:
        result = {'status': 'invalid', 'message': str(exc)}
    return json.dumps(result)
