"""Print the oldest versions pyproject.toml allows, as pip constraints.

Every ``name>=version`` in [project.dependencies] and in the named extras
becomes ``name==version``, so that installing the project against the output
tests the declared lower bounds rather than whatever is newest. Any other
requirement form is an error: its minimum would be a guess. Run from the
repository root, extras as in pip's brackets:

    python scripts/lower_bounds.py dev > lower-bounds.txt
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib

_LOWER_BOUND = re.compile(r"([A-Za-z0-9][A-Za-z0-9._-]*)\s*>=\s*([0-9][0-9A-Za-z.]*)")


def lower_bounds(pyproject: dict, extras: list[str]) -> list[str]:
    """The pins for the dependencies and `extras` of a parsed pyproject.toml."""
    project = pyproject["project"]
    requirements = list(project.get("dependencies", []))
    optional = project.get("optional-dependencies", {})
    for extra in extras:
        if extra not in optional:
            raise ValueError(f"pyproject.toml has no extra {extra!r}")
        requirements += optional[extra]
    pins = []
    for requirement in requirements:
        match = _LOWER_BOUND.fullmatch(requirement.strip())
        if not match:
            raise ValueError(f"{requirement!r} is not a plain 'name>=version' lower bound")
        pins.append(f"{match[1]}=={match[2]}")
    return pins


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("extras", nargs="?", default="", help="comma-separated extras, e.g. dev,corpus")
    parser.add_argument("--pyproject", default="pyproject.toml")
    args = parser.parse_args(argv)
    with open(args.pyproject, "rb") as file:
        pyproject = tomllib.load(file)
    extras = [extra.strip() for extra in args.extras.split(",") if extra.strip()]
    for pin in lower_bounds(pyproject, extras):
        print(pin)
    return 0


if __name__ == "__main__":
    sys.exit(main())
