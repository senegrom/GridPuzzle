"""The weekly comparison of the browser runtime's npm pins with the registry."""

import re
from pathlib import Path

import pytest

from scripts import check_runtime_pins as pins

_ROOT = Path(__file__).resolve().parent.parent


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
    assert pins.main([]) == 0
    monkeypatch.setattr(pins, "latest", lambda name: "999.0.0" if name == "playwright" else current[name])
    assert pins.main([]) == 1
    assert "::error::playwright is pinned at" in capsys.readouterr().out
