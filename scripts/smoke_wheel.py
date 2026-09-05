"""Install and exercise the built wheel without access to the source checkout."""

import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import venv


def smoke_wheel(wheel_dir: Path) -> None:
    wheels = sorted(wheel_dir.resolve().glob("gridpuzzle_solver-*.whl"))
    if len(wheels) != 1:
        raise ValueError(f"Expected exactly one GridPuzzle wheel, found {len(wheels)}")
    environment = os.environ.copy()
    for name in ("PYTHONPATH", "PYTHONHOME"):
        environment.pop(name, None)
    environment["PYTHONNOUSERSITE"] = "1"

    with tempfile.TemporaryDirectory(prefix="gridpuzzle-wheel-") as directory:
        root = Path(directory)
        install = root / "venv"
        venv.EnvBuilder(with_pip=True).create(install)
        scripts = install / ("Scripts" if os.name == "nt" else "bin")
        python = scripts / ("python.exe" if os.name == "nt" else "python")
        console = scripts / ("gridpuzzle.exe" if os.name == "nt" else "gridpuzzle")

        def run(arguments, *, solution=False):
            result = subprocess.run(
                list(map(str, arguments)), cwd=root, env=environment,
                text=True, capture_output=True, timeout=180,
            )
            print(result.stdout, end="")
            print(result.stderr, end="")
            result.check_returncode()
            if solution and "Solution 0" not in result.stdout + result.stderr:
                raise AssertionError("Installed CLI did not report a solution")

        run([python, "-I", "-m", "pip", "install", wheels[0]])
        run([python, "-I", "-c", "\n".join((
            "import importlib, pathlib, sys",
            "prefix = pathlib.Path(sys.prefix).resolve()",
            "for name in ('gridsolver', 'run', 'examples2', 'Examples.exampleSudoku'):",
            "    module = importlib.import_module(name)",
            "    assert pathlib.Path(module.__file__).resolve().is_relative_to(prefix), name",
        ))])
        run([console, "--help"])
        run([console, "--str", "Sudoku::123434122143432.", "--max-solutions", "1", "--colour", "No"], solution=True)
        run([console, "--example", "s", "--max-solutions", "1", "--colour", "No"], solution=True)
    print("Clean-wheel imports and both installed CLI solves passed.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel-dir", type=Path, default=Path("dist"))
    smoke_wheel(parser.parse_args().wheel_dir)


if __name__ == "__main__":
    main()
