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
            "import importlib, importlib.metadata, importlib.util, pathlib, sys",
            "prefix = pathlib.Path(sys.prefix).resolve()",
            "for name in ('gridsolver', 'gridsolver.cli', 'gridsolver.examples.sudoku'):",
            "    module = importlib.import_module(name)",
            "    assert pathlib.Path(module.__file__).resolve().is_relative_to(prefix), name",
            # Only the gridsolver package may install. A top-level run.py
            # shadowed, or was shadowed by, other distributions' run.py
            # (win_unicode_console ships one), breaking the console script.
            "for name in ('run', 'examples2', 'Examples'):",
            "    assert importlib.util.find_spec(name) is None, name",
            "tops = {pathlib.PurePosixPath(file.as_posix()).parts[0]",
            "        for file in importlib.metadata.files('gridpuzzle-solver')}",
            "stray = {top for top in tops if top not in ('gridsolver', '..') and not top.endswith('.dist-info')}",
            "assert not stray, sorted(stray)",
        ))])
        run([console, "--help"])
        run([console, "--str", "Sudoku::123434122143432.", "--max-solutions", "1", "--colour", "No"], solution=True)
        run([console, "--example", "s", "--max-solutions", "1", "--colour", "No"], solution=True)
        run([console, "--module", "gridsolver.examples.futoshiki", "--colour", "No"], solution=True)
    print("Clean-wheel imports, package contents and the installed CLI solves passed.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel-dir", type=Path, default=Path("dist"))
    smoke_wheel(parser.parse_args().wheel_dir)


if __name__ == "__main__":
    main()
