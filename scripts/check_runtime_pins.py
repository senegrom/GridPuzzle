"""Compare the runtime pins that Dependabot does not track with their releases.

Two checks, which the weekly "Runtime pins" workflow runs as separate jobs:

npm: the browser runtime's npm pins, read where the build and the browser
suites use them: the PACKAGES versions in scripts/build_web.py and the
Playwright version in .github/actions/setup-scanner/action.yml. Dependabot
reads neither. Each pin is compared with its package's `latest` dist-tag. A
pin behind it fails, unless scripts/runtime_pin_deferrals.toml acknowledges
that exact release with a reason; then the reason is printed as a notice. A
release newer than the acknowledged one fails again, so every new version
gets considered.

python: the forward-compatibility legs in
.github/workflows/forward-compatibility.yml, and FINAL_RELEASES below,
against actions/python-versions' versions-manifest.json, the list of CPython
builds setup-python installs. A leg that allows prereleases fails once its
version has a final release, which setup-python installs instead; a CPython
newer than every leg fails, since a new leg is due; and FINAL_RELEASES fails
where it disagrees with the manifest.

A source that cannot be read fails its check with an error naming it.
Standard library only; run from the repository root, with no argument for
both checks:

    python scripts/check_runtime_pins.py [npm | python]
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
import tomllib
from http.client import HTTPException
from pathlib import Path
from typing import NamedTuple
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BUILD = Path("scripts/build_web.py")
SETUP_SCANNER = Path(".github/actions/setup-scanner/action.yml")
DEFERRALS = Path("scripts/runtime_pin_deferrals.toml")
FORWARD_COMPATIBILITY = Path(".github/workflows/forward-compatibility.yml")
REGISTRY = "https://registry.npmjs.org/-/package/{}/dist-tags"
# setup-python reads this file through the GitHub API, and from this URL
# when the API fails.
PYTHON_VERSIONS = "https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json"

# The CPython feature releases that have a final release, among them every
# one a forward-compatibility leg tests. setup-python installs a final
# release even for a leg that allows prereleases: actions/python-versions
# published 3.15.0 on 2026-10-10, and weekly run 38544326268 then set up
# "CPython (3.15.0)" for the leg still labelled "Python 3.15 prerelease". So
# a leg allows prereleases exactly when its version is not here, which
# tests/test_workflows.py checks on every pull request. The weekly python
# check holds this record to the manifest: it fails while a version here has
# no final release, or a version a leg tests has one and is not here.
FINAL_RELEASES = frozenset({"3.14", "3.15"})
_RECORD = "FINAL_RELEASES in scripts/check_runtime_pins.py"


class SourceError(Exception):
    """A source that a check reads could not be read or understood."""


def fetch_json(url: str) -> object:
    """The JSON document at `url`."""
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "GridPuzzle-runtime-pins/1"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except (OSError, HTTPException, ValueError) as error:
        # URLError, HTTPError and timeouts are OSErrors; a cut-off or garbled
        # body is an HTTPException or a ValueError.
        if isinstance(error, HTTPError):
            error.close()  # it holds the error response
        raise SourceError(f"could not read {url}: {error}") from error


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
    url = REGISTRY.format(quote(name, safe="@"))
    tags = fetch_json(url)
    if not isinstance(tags, dict) or not isinstance(tags.get("latest"), str):
        raise SourceError(f"{url} names no latest release")
    return tags["latest"]


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


def check_npm() -> list[tuple[str, str]]:
    pins = read_pins()
    deferrals = read_deferrals(DEFERRALS.read_text(encoding="utf-8"))
    newest = {name: latest(name) for name in pins}
    for name, pinned in sorted(pins.items()):
        print(f"{name:26} pinned {pinned:10} latest {newest[name]}")
    return assess(pins, newest, deferrals)


class Leg(NamedTuple):
    """One leg of the forward-compatibility matrix."""

    label: str
    version: str
    freethreaded: bool
    prereleases: bool


_LEG = re.compile(
    r'^          - label: (.+)\n            python-version: "(\d+\.\d+)"\n'
    r"            freethreaded: (true|false)\n            allow-prereleases: (true|false)\n",
    re.M,
)


def compatibility_legs(source: str) -> list[Leg]:
    """The legs that forward-compatibility.yml's matrix lists, in its order."""
    legs = [
        Leg(label, version, freethreaded == "true", prereleases == "true")
        for label, version, freethreaded, prereleases in _LEG.findall(source)
    ]
    if not legs or len(legs) != source.count("- label: "):
        raise ValueError(
            f"{FORWARD_COMPATIBILITY.as_posix()}: every leg must list its label, python-version (a quoted x.y), "
            "freethreaded and allow-prereleases, in that order"
        )
    return legs


def feature(version: str) -> tuple[int, int]:
    """A feature release, such as "3.15", as numbers."""
    match = re.fullmatch(r"(\d+)\.(\d+)", version)
    if not match:
        raise ValueError(f"{version!r} is not a feature release such as 3.15")
    return int(match[1]), int(match[2])


_CPYTHON = re.compile(r"(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?")
_STAGES = {"alpha": 0, "beta": 1, "rc": 2, None: 3}


def cpython_releases(manifest: object) -> dict[tuple[int, int], list[str]]:
    """The manifest's CPython versions by feature release, newest first:
    3.15.0, then 3.15.0-rc.3, ..., 3.15.0-alpha.1. setup-python installs the
    newest one the leg accepts."""
    if not isinstance(manifest, list) or not manifest:
        raise SourceError(f"{PYTHON_VERSIONS} is not a list of releases")
    found: dict[tuple[int, int], list[tuple[tuple[int, int, int], str]]] = {}
    for entry in manifest:
        version = entry.get("version") if isinstance(entry, dict) else None
        match = _CPYTHON.fullmatch(version) if isinstance(version, str) else None
        if not match:
            raise SourceError(
                f"{PYTHON_VERSIONS} lists the version {version!r}, which is not x.y.z or "
                "x.y.z-alpha.n, -beta.n or -rc.n; teach scripts/check_runtime_pins.py to read it"
            )
        major, minor, patch, stage, number = match.groups()
        order = (int(patch), _STAGES[stage], int(number or 0))
        found.setdefault((int(major), int(minor)), []).append((order, version))
    return {key: [version for _, version in sorted(versions, reverse=True)] for key, versions in found.items()}


def assess_python(
    legs: list[Leg], releases: dict[tuple[int, int], list[str]], record: frozenset[str]
) -> list[tuple[str, str]]:
    """(level, message) findings, as assess() reports them."""

    def final(version: str) -> str | None:
        """The newest final release of a feature release, if it has one."""
        return next((found for found in releases.get(feature(version), []) if "-" not in found), None)

    findings = []
    for leg in legs:
        released = final(leg.version)
        if leg.prereleases and released:
            findings.append((
                "error",
                f"{leg.label} allows prereleases, but CPython {released} is out and setup-python installs "
                f"it instead: in {FORWARD_COMPATIBILITY.as_posix()}, set the leg's allow-prereleases to false and "
                'drop "prerelease" from its label',
            ))
    newest = max(releases)
    if newest > max(feature(leg.version) for leg in legs):
        version, name = releases[newest][0], "{}.{}".format(*newest)
        if "-" in version:
            due = (
                f'add a leg "Python {name} prerelease" to {FORWARD_COMPATIBILITY.as_posix()} '
                f'with python-version "{name}" and allow-prereleases: true'
            )
        else:
            due = (
                f'add a leg "Python {name}" to {FORWARD_COMPATIBILITY.as_posix()} with python-version "{name}" '
                f"and allow-prereleases: false, and add {name} to {_RECORD}"
            )
        findings.append(("error", f"CPython {version} is newer than every forward-compatibility leg: {due}"))
    for version in sorted(record | {leg.version for leg in legs}, key=feature):
        released = final(version)
        if version in record and not released:
            findings.append((
                "error",
                f"{_RECORD} lists {version}, but actions/python-versions has no final CPython {version}: remove it",
            ))
        elif version not in record and released:
            findings.append(("error", f"CPython {released} is out, but {_RECORD} lacks {version}: add it"))
    return findings


def accepted(leg: Leg, version: str) -> bool:
    """Whether setup-python may install `version`, a release of the leg's
    feature release, for the leg: any final release, and a prerelease of its
    x.y.0 when the leg allows prereleases (it then asks for ~x.y.0-0, which
    takes no patch release's candidate, such as 3.15.1-rc.1)."""
    return "-" not in version or (leg.prereleases and version.startswith(f"{leg.version}.0-"))


def check_python() -> list[tuple[str, str]]:
    legs = compatibility_legs(FORWARD_COMPATIBILITY.read_text(encoding="utf-8"))
    releases = cpython_releases(fetch_json(PYTHON_VERSIONS))
    for leg in legs:
        accepts = "prereleases" if leg.prereleases else "final only"
        newest = next((found for found in releases.get(feature(leg.version), []) if accepted(leg, found)), "none")
        print(f"{leg.label:26} {leg.version:6} {accepts:11} newest {newest}")
    print(f"{'actions/python-versions':26} newest {releases[max(releases)][0]}")
    print(f"{'FINAL_RELEASES':26} {', '.join(sorted(FINAL_RELEASES, key=feature))}")
    return assess_python(legs, releases, FINAL_RELEASES)


CHECKS = {"npm": check_npm, "python": check_python}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("check", nargs="?", choices=list(CHECKS), help="run only this check (default: both)")
    chosen = parser.parse_args(argv).check
    findings = []
    for name, check in CHECKS.items():
        if chosen in (None, name):
            try:
                findings += check()
            except SourceError as error:
                findings.append(("error", str(error)))
    for level, message in findings:
        # GitHub turns these lines into annotations on the run.
        print(f"::{level}::{message}")
    return 1 if any(level == "error" for level, _ in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
