"""The GitHub workflows' structure: what every pull request reports and why.

These read the workflow files as text, since the project has no YAML parser;
the helpers below rely on the two-space indentation the files use.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parent.parent
_GITHUB = _ROOT / ".github"
# The workflows a pull request runs. Each must report on every pull request,
# because a required check that never reports stays pending forever.
_PULL_REQUEST_WORKFLOWS = (
    "ci.yml",
    "browser-tests.yml",
    "browser-pages.yml",
    "scan-input.yml",
    "forward-compatibility.yml",
)
# Those whose first job decides whether the others need to run.
_GATED_WORKFLOWS = (
    "ci.yml",
    "browser-pages.yml",
    "scan-input.yml",
    "forward-compatibility.yml",
)
_MASTER_ONLY = "if: github.ref == 'refs/heads/master'"


def _workflow(name: str) -> str:
    return (_GITHUB / "workflows" / name).read_text(encoding="utf-8")


def _event_settings(text: str, event: str) -> list[str] | None:
    """The non-comment lines nested under `event` in `on:`, or None."""
    on = re.search(r"^on:\n((?:[ \t]+.*\n|[ \t]*\n)*)", text, re.M)
    assert on, "no on: block"
    lines = on.group(1).splitlines()
    for index, line in enumerate(lines):
        if re.fullmatch(rf"  {event}:[ \t]*(#.*)?", line):
            settings = []
            for nested in lines[index + 1:]:
                if not nested.strip() or nested.strip().startswith("#"):
                    continue
                if not nested.startswith("    "):
                    break
                settings.append(nested.strip())
            return settings
    return None


def _jobs(text: str) -> dict[str, str]:
    """Each job's id and the text of its definition."""
    body = text.split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([A-Za-z0-9_-]+):[ \t]*$", body, flags=re.M)
    return dict(zip(parts[1::2], parts[2::2], strict=True))


def _needs(job: str) -> list[str]:
    match = re.search(r"^    needs: (.+)$", job, re.M)
    if not match:
        return []
    return [name.strip() for name in match.group(1).strip("[]").split(",")]


def _changes_paths(text: str) -> list[str]:
    """The patterns a workflow's changes job passes to changed-paths."""
    match = re.search(
        r"uses: \./\.github/actions/changed-paths\n\s+with:\n(?:\s+#.*\n)*"
        r"(\s+)paths: \|\n((?:\1  .*\n)+)",
        text,
    )
    assert match, "no changed-paths step with a paths block"
    return [line.strip() for line in match.group(2).splitlines()]


def _filter_selects(patterns: list[str], path: str) -> bool:
    """Whether a workflow paths filter with these patterns selects `path`.

    GitHub's rules: `*` stops at a slash, `**` crosses directories, and the
    last pattern that matches decides, a `!` pattern excluding.
    """
    selected = False
    for pattern in patterns:
        negated = pattern.startswith("!")
        expression = glob.translate(
            pattern.removeprefix("!"), recursive=True, include_hidden=True, seps="/"
        )
        if re.fullmatch(expression, path):
            selected = not negated
    return selected


@pytest.mark.parametrize("name", _PULL_REQUEST_WORKFLOWS)
def test_every_pull_request_runs_the_workflow(name):
    settings = _event_settings(_workflow(name), "pull_request")
    assert settings is not None, f"{name} no longer runs on pull requests"
    # A filtered-out workflow never reports its checks, so a required one
    # would stay pending; a changes job decides what runs instead.
    assert settings == [], f"{name} filters its pull requests: {settings}"


@pytest.mark.parametrize("name", _GATED_WORKFLOWS)
def test_the_changes_job_gates_every_job_and_the_result_job_checks_them(name):
    jobs = _jobs(_workflow(name))
    assert {"changes", "result"} <= jobs.keys()
    gated = []
    for job, body in jobs.items():
        if job in ("changes", "result") or _MASTER_ONLY in body:
            continue
        needs = _needs(body)
        if "changes" in needs:
            assert "    if: needs.changes.outputs.relevant == 'true'\n" in body, job
        else:
            # skipped along with the gated job it needs
            assert needs and set(needs) <= set(gated), f"{job} is not gated"
        gated.append(job)
    assert gated, f"{name} gates nothing"
    result = jobs["result"]
    assert "    if: always()\n" in result
    assert _needs(result) == ["changes", *gated]
    assert "CHANGES: ${{ needs.changes.result }}" in result
    assert "RELEVANT: ${{ needs.changes.outputs.relevant }}" in result
    checked = re.search(r"RESULTS: (.*)", result).group(1)
    assert checked == " ".join(f"${{{{ needs.{job}.result }}}}" for job in gated)
    changes = jobs["changes"]
    assert "fetch-depth: 2" in changes
    assert (
        "relevant: ${{ github.event_name != 'pull_request' || "
        "steps.diff.outputs.relevant == 'true' }}"
    ) in changes


def test_result_jobs_hold_one_policy():
    """The four result jobs differ only in the jobs they check."""
    steps = set()
    for name in _GATED_WORKFLOWS:
        result = _jobs(_workflow(name))["result"]
        steps.add(re.sub(r"RESULTS: .*", "RESULTS:", result.split("steps:", 1)[1]))
    assert len(steps) == 1


def test_ci_pull_requests_skip_what_its_pushes_skip():
    text = _workflow("ci.yml")
    ignored = re.search(r"^    paths-ignore: \[(.*)\]$", text, re.M).group(1)
    ignored = [item.strip().strip('"') for item in ignored.split(",")]
    assert _changes_paths(text) == ["**", *(f"!{item}" for item in ignored)]


# Paths that probe every pattern's boundaries: documents at any depth, a
# nested LICENSE, suites beside other scripts, the three corpus files the
# scanner-settings suite loads, and the composite actions.
_SAMPLE_PATHS = (
    "README.md",
    "LICENSE",
    "Examples/LatinSquares/LICENSE",
    "Examples/README.txt",
    "Examples/Sudoku/a.clp",
    "Examples/BrowserScanner/Newspaper/ground-truth.json",
    "Examples/BrowserScanner/Newspaper/README.md",
    "web/app.js",
    "web/README.md",
    "web/tests/model.test.js",
    "scripts/harness.cjs",
    "scripts/live_camera_regressions.cjs",
    "scripts/nested/deep.cjs",
    "scripts/build_web.py",
    "scripts/fetch_live_fixtures.py",
    "scripts/smoke_wheel.py",
    "corpus/score.cjs",
    "corpus/benchmark-runner.cjs",
    "corpus/detect_benchmark.cjs",
    "corpus/benchmark.cjs",
    "corpus/build_corpus.py",
    "gridsolver/solver/solver.py",
    "tests/test_basic.py",
    "tests/test_data/sudoku2x2.pzl",
    "pyproject.toml",
    "run.py",
    "examples2.py",
    "benchmarks/record.json",
    "experiments/tiny-digit-cnn/infer.mjs",
    ".github/workflows/ci.yml",
    ".github/workflows/browser-pages.yml",
    ".github/workflows/scan-input.yml",
    ".github/workflows/forward-compatibility.yml",
    ".github/actions/setup-scanner/action.yml",
    ".github/actions/setup-project/action.yml",
)


def _action_script() -> str:
    text = (_GITHUB / "actions" / "changed-paths" / "action.yml").read_text(encoding="utf-8")
    assert 'GIT_GLOB_PATHSPECS: "1"' in text
    block = re.search(r"^      run: \|\n((?:        .*\n|[ \t]*\n)+)", text, re.M)
    return textwrap.dedent(block.group(1))


_DOCUMENTS = ("README.md", "web/README.md", "benchmarks/record.md")


@pytest.mark.skipif(
    sys.platform == "win32" or not shutil.which("bash") or not shutil.which("git"),
    reason="runs the action's bash script with git, as the Linux runners do",
)
@pytest.mark.parametrize("changed", [_SAMPLE_PATHS, _DOCUMENTS], ids=["everything", "documents"])
@pytest.mark.parametrize("name", _GATED_WORKFLOWS)
def test_changed_paths_selects_what_a_paths_filter_would(name, changed, tmp_path):
    patterns = _changes_paths(_workflow(name))
    # Git applies `:!` exclusions wherever they stand; a paths filter applies
    # them in order. They agree while every exclusion comes last.
    firsts = [not pattern.startswith("!") for pattern in patterns]
    assert firsts == sorted(firsts, reverse=True), patterns
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*args):
        subprocess.run(
            ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", *args],
            cwd=repo, check=True, capture_output=True,
        )

    git("init", "-q")
    git("commit", "-q", "--allow-empty", "-m", "base")
    for path in changed:
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        (repo / path).write_text("changed\n", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "change")
    output, temporary = tmp_path / "output", tmp_path / "temporary"
    temporary.mkdir()
    subprocess.run(
        ["bash", "-eo", "pipefail", "-c", _action_script()],
        cwd=repo, check=True, capture_output=True,
        env={**os.environ, "PATHS": "\n".join(patterns), "GIT_GLOB_PATHSPECS": "1",
             "GITHUB_OUTPUT": str(output), "RUNNER_TEMP": str(temporary)},
    )
    selected = set((temporary / "selected").read_text(encoding="utf-8").split())
    expected = {path for path in changed if _filter_selects(patterns, path)}
    assert selected == expected
    assert output.read_text(encoding="utf-8") == f"relevant={str(bool(expected)).lower()}\n"


def test_parse_checks_fail_when_node_fails():
    r"""`find -exec cmd {} \;` exits 0 whatever cmd reports; xargs does not."""
    checks = []
    for path in sorted((_GITHUB / "workflows").glob("*.yml")):
        checks += re.findall(r"^.*node --check.*$", path.read_text(encoding="utf-8"), re.M)
    assert len(checks) == 2
    for check in checks:
        assert check.strip().endswith("-print0 | xargs -0 -n1 node --check"), check
