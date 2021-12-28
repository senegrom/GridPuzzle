from pathlib import Path

from gridsolver.abstract_grids import solver
from gridsolver.abstract_grids.grid_loading import create_from_file

example_path = Path("../Examples/Sudoku/")


def test_ex_sudoku_cbg000():
    path = example_path / "cbg-000"
    for file in path.iterdir():
        if not file.is_file():
            continue
        print(f"\nLoading {file}")
        g = create_from_file(file)
        print(f"\nSolving {file}")
        sol = solver.solve(g, 100)
        assert len(sol) == 1
