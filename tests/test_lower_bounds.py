"""CI's lower-bounds job installs exactly what pyproject.toml's minimums say."""

from pathlib import Path

import pytest

from scripts import lower_bounds

_PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def test_the_dependencies_and_dev_extra_become_exact_pins(capsys):
    assert lower_bounds.main(["dev", "--pyproject", str(_PYPROJECT)]) == 0
    pins = capsys.readouterr().out.split()
    names = [pin.split("==")[0].lower() for pin in pins]
    assert {"colorama", "rich", "pytest", "ruff"} <= set(names)
    assert all("==" in pin and ">" not in pin for pin in pins)


def test_extras_are_optional_and_combine():
    project = {"project": {"dependencies": ["a>=1.0"], "optional-dependencies": {"x": ["b>=2"], "y": ["c >= 3.1.4"]}}}
    assert lower_bounds.lower_bounds(project, []) == ["a==1.0"]
    assert lower_bounds.lower_bounds(project, ["x", "y"]) == ["a==1.0", "b==2", "c==3.1.4"]


@pytest.mark.parametrize("requirement", ["a", "a~=1.0", "a>=1,<2", "a==1.0", "a>=1; python_version<'3.15'", "a[b]>=1"])
def test_a_minimum_that_would_be_a_guess_is_refused(requirement):
    with pytest.raises(ValueError, match="lower bound"):
        lower_bounds.lower_bounds({"project": {"dependencies": [requirement]}}, [])


def test_an_unknown_extra_is_refused():
    with pytest.raises(ValueError, match="no extra"):
        lower_bounds.lower_bounds({"project": {"dependencies": []}}, ["nope"])
