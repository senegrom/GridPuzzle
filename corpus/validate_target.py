"""Validate a rendered target and its optional solution without searching.

The browser payload is row-major; dense engine storage is column-major, while
compact families store only active board keys. Validate against the ORIGINAL
puzzle so a completed witness cannot overwrite givens or bypass cage rules.
"""
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.solver.validation import validate_solution
from gridsolver.web_api import build_grid


def validate_target(puzzle: dict, solution: list | None):
    grid = build_grid(puzzle)
    if solution is None:
        # A transcription with no witness has a checked shape, not a proved
        # solution or uniqueness. Slitherlink currently supplies no edge witness.
        return grid
    if isinstance(grid, Slitherlink):
        raise ValueError("Slitherlink solutions must be edge assignments, not cell values")
    rows, cols = puzzle["rows"], puzzle["cols"]
    if not isinstance(solution, list) or len(solution) != rows * cols:
        raise ValueError("A stored solution must contain exactly one entry per board cell")
    if isinstance(grid, CompactGrid):
        active = set(grid.cell_to_key)
        for i, value in enumerate(solution):
            if divmod(i, cols) not in active and value != "#":
                raise ValueError("A stored solution must preserve blocked cells")
        known = [solution[r * cols + c] for r, c in grid.cell_to_key]
    else:
        known = [solution[r * cols + c] for c in range(cols) for r in range(rows)]
    witness = ImmutableGrid(known, grid.rows, grid.cols, grid.max_elem)
    validate_solution(grid, witness)
    return grid
