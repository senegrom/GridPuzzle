from pathlib import Path

from gridsolver.abstract_grids.grid_loading import create_from_file
from gridsolver.solver import solver, logger

logger.set_colouring(logger.Colouring.Colorama)

_MAX_LVL = logger.MAX_LVL
lg = logger.get_log("TEST", _MAX_LVL)
VERB = 100


def solve_path(file: Path, space_sep: bool):
    lg.logs(0, f"\nLoading {file}")
    g = create_from_file(file, space_sep=space_sep)
    lg.logs(0, f"\nSolving {file}")
    sol = solver.solve(g, VERB)
    assert len(sol) == 1


def solve_all_in_path(path: Path, space_sep: bool, max_count=0):
    counter = 0
    for file in path.iterdir():
        if not file.is_file():
            continue
        if max_count and counter >= max_count:
            break
        solve_path(file, space_sep=space_sep)
        counter += 1


def _make_comments():
    for d in Path("../Examples/Futoshiki/").iterdir():
        if not d.is_dir():
            continue
        print(d)
        for file in d.iterdir():
            if not file.is_file():
                continue
            lg.logs(0, f"\nLoading {file}")

            read_lines = file.read_text().splitlines(keepends=False)
            lines = [line.strip() for line in read_lines]
            # counter = 0
            # for i, line in enumerate(lines):
            #     if counter == 2 and line.startswith("#("):
            #         lines[i] = line[2:-1]
            #         counter += 1
            #     elif counter == 2 and line.startswith("#"):
            #         lines[i] = line[1:]
            #         counter += 1
            #     if line.startswith("#**************************"):
            #         counter += 1

            lines = ["#" + line for line in lines]
            file.write_text("LatinSquare::\n" + "\n".join(lines))
            # file.write_text("\n".join(lines))


if __name__ == "__main__":
    _make_comments()
