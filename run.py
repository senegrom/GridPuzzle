"""Run the gridpuzzle command line from a checkout: ``python run.py ...``.

The CLI lives in gridsolver.cli; the installed ``gridpuzzle`` command runs
the same main().
"""
from gridsolver.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
