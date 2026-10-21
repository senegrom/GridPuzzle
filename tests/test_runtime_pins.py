"""The weekly comparison of the runtime pins with their releases: the browser
runtime's npm pins with the registry, and the forward-compatibility legs with
actions/python-versions. No test here reads the network."""

import io
import json
import re
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest

from scripts import check_runtime_pins as pins

_ROOT = Path(__file__).resolve().parent.parent
# actions/python-versions' versions-manifest.json as it was on 2026-10-21
# (last changed on 2026-10-10 by 49858b91, which added 3.15.0): its newest
# 42 entries, every 3.15 and 3.14 build and the newest 3.13 one, each with
# only its Ubuntu 24.04 x64 file.
_MANIFEST = _ROOT / "tests" / "test_data" / "python-versions-manifest.json"
_WORKFLOW = ".github/workflows/forward-compatibility.yml"
_RECORD = "FINAL_RELEASES in scripts/check_runtime_pins.py"


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """A test that reaches urlopen fails instead of reading the network."""

    def refuse(request, timeout=None):
        raise AssertionError(f"a unit test read {request.full_url}")

    monkeypatch.setattr(pins, "urlopen", refuse)


@pytest.fixture
def repository(monkeypatch):
    monkeypatch.chdir(_ROOT)


def test_the_pins_are_read_from_the_files_that_use_them(repository):
    found = pins.read_pins()
    assert set(found) == {"pyodide", "tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "playwright"}
    for version in found.values():
        pins.release(version)
    action = pins.SETUP_SCANNER.read_text(encoding="utf-8")
    assert f"playwright@{found['playwright']}" in action
    build = pins.BUILD.read_text(encoding="utf-8")
    assert re.search(rf'"pyodide": \(\s*"{re.escape(found["pyodide"])}"', build)


def test_the_checked_in_deferrals_are_well_formed(repository):
    deferrals = pins.read_deferrals(pins.DEFERRALS.read_text(encoding="utf-8"))
    assert set(deferrals) <= set(pins.read_pins())
    assert deferrals["tesseract.js"]["reason"]


def test_malformed_deferrals_are_rejected():
    with pytest.raises(ValueError, match="reason"):
        pins.read_deferrals('[[deferred]]\npackage = "a"\nversion = "1.0.0"\n')
    with pytest.raises(ValueError, match="twice"):
        entry = '[[deferred]]\npackage = "a"\nversion = "1.0.0"\nreason = "r"\n'
        pins.read_deferrals(entry * 2)
    with pytest.raises(ValueError, match="plain"):
        pins.read_deferrals('[[deferred]]\npackage = "a"\nversion = "1.0"\nreason = "r"\n')


_DEFERRED = {"b": {"version": "2.0.0", "reason": "baselines first"}}


@pytest.mark.parametrize(
    ("newest", "expected"),
    [
        # current pins pass silently
        ({"a": "1.2.3", "b": "1.0.0"}, []),
        # a newer release nobody acknowledged fails
        ({"a": "1.2.4", "b": "1.0.0"}, [("error", "a is pinned at 1.2.3; npm's latest is 1.2.4")]),
        # the acknowledged release only prints its reason
        ({"a": "1.2.3", "b": "2.0.0"}, [("notice", "b 1.0.0 stays behind 2.0.0: baselines first")]),
        # and a release after it fails again
        ({"a": "1.2.3", "b": "2.1.0"}, [("error", "acknowledges only 2.0.0")]),
        # numeric order, not text order
        ({"a": "1.10.0", "b": "1.0.0"}, [("error", "latest is 1.10.0")]),
    ],
)
def test_assess(newest, expected):
    findings = pins.assess({"a": "1.2.3", "b": "1.0.0"}, newest, _DEFERRED)
    assert [level for level, _ in findings] == [level for level, _ in expected]
    for (_, message), (_, fragment) in zip(findings, expected, strict=True):
        assert fragment in message


def test_stale_and_unknown_deferrals_are_reported():
    findings = pins.assess(
        {"b": "2.0.0"},
        {"b": "2.0.0"},
        {**_DEFERRED, "c": {"version": "1.0.0", "reason": "typo"}},
    )
    assert [level for level, _ in findings] == ["error", "warning"]
    assert "defers c, which nothing pins" in findings[0][1]
    assert "remove it" in findings[1][1]


def test_main_fails_only_on_unacknowledged_releases(repository, monkeypatch, capsys):
    current = pins.read_pins()
    monkeypatch.setattr(pins, "latest", lambda name: current[name])
    assert pins.main(["npm"]) == 0
    monkeypatch.setattr(pins, "latest", lambda name: "999.0.0" if name == "playwright" else current[name])
    assert pins.main(["npm"]) == 1
    assert "::error::playwright is pinned at" in capsys.readouterr().out


def test_the_registry_is_asked_for_the_package_s_dist_tags(monkeypatch):
    asked = []

    def urlopen(request, timeout=None):
        asked.append((request.full_url, request.get_header("Accept"), request.get_header("User-agent"), timeout))
        return io.BytesIO(b'{"latest": "1.0.0"}')

    monkeypatch.setattr(pins, "urlopen", urlopen)
    assert pins.latest("@tesseract.js-data/eng") == "1.0.0"
    assert asked == [(
        "https://registry.npmjs.org/-/package/@tesseract.js-data%2Feng/dist-tags",
        "application/json", "GridPuzzle-runtime-pins/1", 30,
    )]
    monkeypatch.setattr(pins, "urlopen", lambda request, timeout=None: io.BytesIO(b'{"next": "7.0.0"}'))
    with pytest.raises(pins.SourceError, match="names no latest release"):
        pins.latest("tesseract.js")


def _recorded() -> list[dict]:
    return json.loads(_MANIFEST.read_text(encoding="utf-8"))


def _entry(version: str) -> dict:
    """A manifest entry shaped like actions/python-versions' own."""
    return {"version": version, "stable": "-" not in version, "release_url": "", "files": []}


# The legs as #145 left them.
_LEGS = [pins.Leg("Python 3.14 free-threaded", "3.14", True, False), pins.Leg("Python 3.15", "3.15", False, False)]
_LEG_316 = pins.Leg("Python 3.16 prerelease", "3.16", False, True)
_FINAL_316 = pins.Leg("Python 3.16", "3.16", False, False)


@pytest.mark.parametrize(
    ("legs", "record", "published", "expected"),
    [
        # the recorded manifest agrees with the legs and the record
        (_LEGS, {"3.14", "3.15"}, [], []),
        # a version with a final release that no leg tests may stay recorded
        (_LEGS, {"3.13", "3.14", "3.15"}, [], []),
        # the leg before #145, and the record without 3.15: the leg allowed
        # prereleases after 3.15.0 was out
        (
            [_LEGS[0], pins.Leg("Python 3.15 prerelease", "3.15", False, True)], {"3.14"}, [],
            [
                "Python 3.15 prerelease allows prereleases, but CPython 3.15.0 is out and setup-python installs it "
                f"instead: in {_WORKFLOW}, set the leg's allow-prereleases to false and drop \"prerelease\" from "
                "its label",
                f"CPython 3.15.0 is out, but {_RECORD} lacks 3.15: add it",
            ],
        ),
        # the first 3.16 prerelease calls for a leg
        (
            _LEGS, {"3.14", "3.15"}, ["3.16.0-alpha.1"],
            [
                "CPython 3.16.0-alpha.1 is newer than every forward-compatibility leg: add a leg "
                f'"Python 3.16 prerelease" to {_WORKFLOW} with python-version "3.16" and allow-prereleases: true',
            ],
        ),
        # which then tests the 3.16 prereleases
        ([*_LEGS, _LEG_316], {"3.14", "3.15"}, ["3.16.0-beta.1", "3.16.0-alpha.1"], []),
        # until 3.16.0 is out
        (
            [*_LEGS, _LEG_316], {"3.14", "3.15"}, ["3.16.0", "3.16.0-rc.1"],
            [
                "Python 3.16 prerelease allows prereleases, but CPython 3.16.0 is out and setup-python installs it "
                f"instead: in {_WORKFLOW}, set the leg's allow-prereleases to false and drop \"prerelease\" from "
                "its label",
                f"CPython 3.16.0 is out, but {_RECORD} lacks 3.16: add it",
            ],
        ),
        # and the leg and the record follow it
        ([*_LEGS, _FINAL_316], {"3.14", "3.15", "3.16"}, ["3.16.0", "3.16.0-rc.1"], []),
        # a final release that came before any leg tested it
        (
            _LEGS, {"3.14", "3.15"}, ["3.16.0"],
            [
                "CPython 3.16.0 is newer than every forward-compatibility leg: add a leg "
                f'"Python 3.16" to {_WORKFLOW} with python-version "3.16" and allow-prereleases: false, '
                f"and add 3.16 to {_RECORD}",
            ],
        ),
        # a version recorded before its final release
        (
            [*_LEGS, _LEG_316], {"3.14", "3.15", "3.16"}, ["3.16.0-rc.1"],
            [f"{_RECORD} lists 3.16, but actions/python-versions has no final CPython 3.16: remove it"],
        ),
        # a patch release's candidate is no new feature release
        (_LEGS, {"3.14", "3.15"}, ["3.15.1-rc.1"], []),
    ],
    ids=[
        "as-recorded", "recorded-without-a-leg", "before-145", "first-3.16-prerelease", "3.16-leg",
        "3.16.0-out", "3.16-leg-final", "3.16.0-without-a-leg", "recorded-too-early", "patch-candidate",
    ],
)
def test_assess_python(legs, record, published, expected):
    manifest = [_entry(version) for version in published] + _recorded()
    findings = pins.assess_python(legs, pins.cpython_releases(manifest), frozenset(record))
    assert findings == [("error", message) for message in expected]


def test_the_manifest_is_read_in_the_order_setup_python_takes_its_versions():
    recorded = _recorded()
    releases = pins.cpython_releases(recorded)
    assert sorted(releases) == [(3, 13), (3, 14), (3, 15)]
    assert releases[(3, 15)][:3] == ["3.15.0", "3.15.0-rc.3", "3.15.0-rc.2"]
    assert releases[(3, 14)][:6] == ["3.14.8", "3.14.7", "3.14.6", "3.14.5", "3.14.5-rc.1", "3.14.4"]
    assert releases[(3, 14)][-1] == "3.14.0-alpha.0"
    # actions/python-versions lists its entries newest first as well
    ordered = [version for key in sorted(releases, reverse=True) for version in releases[key]]
    assert ordered == [entry["version"] for entry in recorded]
    # numbers, not text: 3.10 is newer than 3.9, alpha.10 than alpha.9
    releases = pins.cpython_releases([_entry(v) for v in ("3.9.0", "3.10.0-alpha.9", "3.10.0-alpha.10")])
    assert releases[(3, 10)] == ["3.10.0-alpha.10", "3.10.0-alpha.9"]
    findings = pins.assess_python([pins.Leg("Python 3.9", "3.9", False, False)], releases, frozenset({"3.9"}))
    assert [message.split(":")[0] for _, message in findings] == [
        "CPython 3.10.0-alpha.10 is newer than every forward-compatibility leg"
    ]


@pytest.mark.parametrize(
    ("manifest", "fragment"),
    [
        ({"version": "3.15.0"}, "is not a list of releases"),
        ([], "is not a list of releases"),
        (["3.15.0"], "lists the version None"),
        ([{"stable": True, "files": []}], "lists the version None"),
        # a format the check does not know fails rather than hiding a release
        ([_entry("3.15.0"), _entry("3.16.0a1")], "lists the version '3.16.0a1', which is not x.y.z"),
    ],
)
def test_a_manifest_the_check_cannot_read_fails_it(manifest, fragment):
    with pytest.raises(pins.SourceError, match=re.escape(fragment)):
        pins.cpython_releases(manifest)


def test_the_legs_are_read_from_the_forward_compatibility_workflow(repository):
    text = pins.FORWARD_COMPATIBILITY.read_text(encoding="utf-8")
    legs = pins.compatibility_legs(text)
    assert len(legs) == text.count("- label: ") > 0
    for leg in legs:
        assert leg.label.startswith(f"Python {leg.version}")
    # a leg the pattern does not read fails, rather than going unchecked
    unread = re.sub(r"^            allow-prereleases: \w+\n", "", text, count=1, flags=re.M)
    with pytest.raises(ValueError, match="every leg must list its label, python-version"):
        pins.compatibility_legs(unread)


def test_the_record_lists_feature_releases():
    assert pins.FINAL_RELEASES
    for version in pins.FINAL_RELEASES:
        pins.feature(version)
    with pytest.raises(ValueError, match="not a feature release"):
        pins.feature("3.16.0")


def _agreeing(legs: list, record: frozenset) -> list[dict]:
    """A manifest that agrees with these legs and this record: a final
    release of each recorded version, a prerelease of each other leg's."""
    versions = sorted({leg.version for leg in legs} | record, key=pins.feature, reverse=True)
    return [_entry(f"{version}.0" if version in record else f"{version}.0-rc.1") for version in versions]


def test_main_holds_the_legs_and_the_record_to_the_manifest(repository, monkeypatch, capsys):
    legs = pins.compatibility_legs(pins.FORWARD_COMPATIBILITY.read_text(encoding="utf-8"))
    manifest = _agreeing(legs, pins.FINAL_RELEASES)

    def fetch_json(url):
        assert url == pins.PYTHON_VERSIONS
        return manifest

    monkeypatch.setattr(pins, "fetch_json", fetch_json)
    assert pins.main(["python"]) == 0
    output = capsys.readouterr().out
    assert "::" not in output
    assert all(leg.label in output for leg in legs)
    major, minor = max(pins.feature(leg.version) for leg in legs)
    manifest.insert(0, _entry(f"{major}.{minor + 1}.0-alpha.1"))
    assert pins.main(["python"]) == 1
    assert f"::error::CPython {major}.{minor + 1}.0-alpha.1 is newer than every" in capsys.readouterr().out


def test_main_runs_both_checks_by_default(repository, monkeypatch, capsys):
    current = pins.read_pins()
    legs = pins.compatibility_legs(pins.FORWARD_COMPATIBILITY.read_text(encoding="utf-8"))
    monkeypatch.setattr(pins, "latest", lambda name: current[name])
    monkeypatch.setattr(pins, "fetch_json", lambda url: _agreeing(legs, pins.FINAL_RELEASES))
    assert pins.main([]) == 0
    output = capsys.readouterr().out
    assert "playwright" in output and legs[0].label in output


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        (lambda: URLError("[Errno -3] Temporary failure in name resolution"),
         "<urlopen error [Errno -3] Temporary failure in name resolution>"),
        (lambda: HTTPError(pins.PYTHON_VERSIONS, 503, "Service Unavailable", None, None),
         "HTTP Error 503: Service Unavailable"),
        (lambda: TimeoutError("The read operation timed out"), "The read operation timed out"),
    ],
    ids=["dns", "http", "timeout"],
)
def test_a_source_that_cannot_be_reached_fails_its_check_with_a_message(
    repository, monkeypatch, capsys, failure, reason
):
    def urlopen(request, timeout=None):
        raise failure()

    monkeypatch.setattr(pins, "urlopen", urlopen)
    assert pins.main(["python"]) == 1
    assert f"::error::could not read {pins.PYTHON_VERSIONS}: {reason}\n" in capsys.readouterr().out
    assert pins.main(["npm"]) == 1
    assert "::error::could not read https://registry.npmjs.org/-/package/" in capsys.readouterr().out


def test_an_error_response_is_closed(monkeypatch):
    """An HTTPError holds the response; left open, it warns when collected."""
    failure = HTTPError(pins.PYTHON_VERSIONS, 429, "Too Many Requests", None, io.BytesIO(b"slow down"))

    def urlopen(request, timeout=None):
        raise failure

    monkeypatch.setattr(pins, "urlopen", urlopen)
    with pytest.raises(pins.SourceError, match="HTTP Error 429: Too Many Requests"):
        pins.fetch_json(pins.PYTHON_VERSIONS)
    assert failure.file.closed


def test_a_source_that_is_not_json_fails_its_check_with_a_message(repository, monkeypatch, capsys):
    monkeypatch.setattr(pins, "urlopen", lambda request, timeout=None: io.BytesIO(b"<html>429</html>"))
    assert pins.main(["python"]) == 1
    output = capsys.readouterr().out
    assert f"::error::could not read {pins.PYTHON_VERSIONS}: Expecting value: line 1 column 1 (char 0)\n" in output


def test_the_weekly_workflow_runs_each_check_in_a_job_of_its_own():
    text = (_ROOT / ".github" / "workflows" / "runtime-pins.yml").read_text(encoding="utf-8")
    runs = re.findall(r"^        run: python scripts/check_runtime_pins\.py (\w+)$", text, re.M)
    assert sorted(runs) == sorted(pins.CHECKS)
    assert text.count("\n    runs-on: ") == len(pins.CHECKS)
