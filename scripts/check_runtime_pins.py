"""Compare the browser runtime's npm pins with the npm registry.

The pins are read where the build and the browser suites use them: the
PACKAGES versions in scripts/build_web.py and the Playwright version in
.github/actions/setup-scanner/action.yml. Dependabot reads neither. Each pin
is compared with its package's `latest` dist-tag. A pin behind it fails,
unless scripts/runtime_pin_deferrals.toml acknowledges that exact release
with a reason; then the reason is printed as a notice. A release newer than
the acknowledged one fails again, so every new version gets considered.

Standard library only; run from the repository root by the weekly
"Runtime pins" workflow:

    python scripts/check_runtime_pins.py
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
import tomllib
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

BUILD = Path("scripts/build_web.py")
SETUP_SCANNER = Path(".github/actions/setup-scanner/action.yml")
DEFERRALS = Path("scripts/runtime_pin_deferrals.toml")
REGISTRY = "https://registry.npmjs.org/-/package/{}/dist-tags"


def build_pins(source: str) -> dict[str, str]:
    """The versions in build_web.py's PACKAGES literal, without importing it."""
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "PACKAGES" for target in node.targets
        ):
            packages = ast.literal_eval(node.value)
            return {name: version for name, (version, _integrity) in packages.items()}
    raise ValueError(f"{BUILD} defines no PACKAGES literal")


def playwright_pin(source: str) -> str:
    """The one `playwright@x.y.z` the setup action installs."""
    versions = set(re.findall(r"\bplaywright@(\d+\.\d+\.\d+)\b", source))
    if len(versions) != 1:
        raise ValueError(f"{SETUP_SCANNER} pins {sorted(versions) or 'no'} Playwright versions, not one")
    return versions.pop()


def read_pins() -> dict[str, str]:
    pins = build_pins(BUILD.read_text(encoding="utf-8"))
    pins["playwright"] = playwright_pin(SETUP_SCANNER.read_text(encoding="utf-8"))
    return pins


def read_deferrals(text: str) -> dict[str, dict[str, str]]:
    """The acknowledged releases by package: {name: {version, reason}}."""
    entries = tomllib.loads(text).get("deferred", [])
    deferrals = {}
    for entry in entries:
        if set(entry) != {"package", "version", "reason"} or not all(
            isinstance(value, str) and value.strip() for value in entry.values()
        ):
            raise ValueError(f"a deferral needs a package, a version and a reason: {entry}")
        if entry["package"] in deferrals:
            raise ValueError(f"{entry['package']} is deferred twice")
        release(entry["version"])
        deferrals[entry["package"]] = {"version": entry["version"], "reason": entry["reason"]}
    return deferrals


def release(version: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if not match:
        raise ValueError(f"{version!r} is not a plain x.y.z release")
    major, minor, patch = map(int, match.groups())
    return major, minor, patch


def latest(name: str) -> str:
    """The package's `latest` dist-tag on the npm registry."""
    request = Request(
        REGISTRY.format(quote(name, safe="@")),
        headers={"Accept": "application/json", "User-Agent": "GridPuzzle-runtime-pins/1"},
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)["latest"]


def assess(
    pins: dict[str, str], newest: dict[str, str], deferrals: dict[str, dict[str, str]]
) -> list[tuple[str, str]]:
    """(level, message) findings; any "error" fails the check."""
    findings = []
    for name in sorted(set(deferrals) - set(pins)):
        findings.append(("error", f"{DEFERRALS} defers {name}, which nothing pins"))
    for name, pinned in sorted(pins.items()):
        available, deferral = newest[name], deferrals.get(name)
        if release(available) > release(pinned):
            if deferral and deferral["version"] == available:
                findings.append(("notice", f"{name} {pinned} stays behind {available}: {deferral['reason']}"))
            elif deferral:
                findings.append((
                    "error",
                    f"{name} {available} is out; the pin is {pinned} and {DEFERRALS} "
                    f"acknowledges only {deferral['version']}",
                ))
            else:
                findings.append(("error", f"{name} is pinned at {pinned}; npm's latest is {available}"))
        elif release(available) < release(pinned):
            findings.append(("warning", f"{name} is pinned at {pinned}, ahead of npm's latest {available}"))
        if deferral and release(deferral["version"]) <= release(pinned):
            findings.append((
                "warning",
                f"{DEFERRALS} still defers {name} {deferral['version']}, but the pin is {pinned}; remove it",
            ))
    return findings


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args(argv)
    pins = read_pins()
    deferrals = read_deferrals(DEFERRALS.read_text(encoding="utf-8"))
    newest = {name: latest(name) for name in pins}
    for name, pinned in sorted(pins.items()):
        print(f"{name:26} pinned {pinned:10} latest {newest[name]}")
    findings = assess(pins, newest, deferrals)
    for level, message in findings:
        # GitHub turns these lines into annotations on the run.
        print(f"::{level}::{message}")
    return 1 if any(level == "error" for level, _ in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
