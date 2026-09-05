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
                text=True, encoding="utf-8", capture_output=True, timeout=180,
            )
            # Diagnostics use ASCII escapes so this harness can itself run on
            # a legacy Windows stdout. The captured CLI output is still UTF-8.
            print(result.stdout.encode("ascii", "backslashreplace").decode(), end="")
            print(result.stderr.encode("ascii", "backslashreplace").decode(), end="")
            result.check_returncode()
            output = result.stdout + result.stderr
            if "--- Logging error ---" in output or "Traceback (most recent call last)" in output:
                raise AssertionError("Installed CLI reported an output/logging error")
            if solution and not all(marker in output for marker in ("Solution 0", "┏", "┗")):
                raise AssertionError("Installed CLI did not render a complete solution grid")

        run([python, "-I", "-X", "utf8", "-m", "pip", "install", wheels[0]])
        run([python, "-I", "-X", "utf8", "-c", "\n".join((
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
