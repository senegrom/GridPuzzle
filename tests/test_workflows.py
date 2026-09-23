"""The GitHub workflows' structure: what every pull request reports and why.

These read the workflow files as text, since the project has no YAML parser;
the helpers below rely on the two-space indentation the files use.
"""

from __future__ import annotations

import fnmatch
import glob
import os
import re
import shutil
import subprocess
import sys
import textwrap
import tomllib
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


def _push_paths(text: str) -> list[str]:
    """The push trigger's `paths` list."""
    on_push = re.search(r"^  push:\n((?:    .*\n|[ \t]*\n)+)", text, re.M).group(1)
    block = re.search(r"^    paths:\n((?:      .*\n)+)", on_push, re.M).group(1)
    return [
        line.strip()[2:].strip('"')
        for line in block.splitlines()
        if line.strip().startswith("- ")
    ]


def _files(path: str) -> set[str]:
    """A file, or every file under a directory, relative to the root."""
    full = _ROOT / path
    if full.is_file():
        return {path}
    return {
        found.relative_to(_ROOT).as_posix()
        for found in full.rglob("*")
        if found.is_file() and "__pycache__" not in found.parts
    }


def _deployment_inputs() -> set[str]:
    """The repository files the deployment workflow's build and gate read.

    The build's `ROOT / "..."` inputs, the scripts the jobs run and every
    relative module those load, the browser unit tests (a push runs them)
    with theirs, and the fixture directories the suites name.
    """
    action = _GITHUB / "actions" / "setup-scanner" / "action.yml"
    text = _workflow("browser-pages.yml") + action.read_text(encoding="utf-8")
    inputs = _files(".github/workflows/browser-pages.yml")
    inputs |= _files(".github/actions/setup-scanner")
    build = (_ROOT / "scripts" / "build_web.py").read_text(encoding="utf-8")
    for name in re.findall(r'ROOT / "([^"]+)"', build):
        inputs |= _files(name)
    pending = re.findall(r"(?:node|python) (scripts/[\w.-]+)", text)
    pending += [f"web/tests/{test.name}" for test in (_ROOT / "web" / "tests").glob("*.test.js")]
    seen = set()
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        inputs.add(path)
        source = (_ROOT / path).read_text(encoding="utf-8")
        # Node's own loading, not the imports a page evaluates
        for target in re.findall(
            r"""(?:\brequire|createRequire\(import\.meta\.url\))\(["'](\.\.?/[^"']+)["']\)""", source
        ):
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            pending.append(Path(resolved).as_posix())
        for directory in re.findall(r"""["'](Examples/BrowserScanner/[^"']*)["']""", source):
            inputs |= _files(directory)
    return inputs


def test_the_deployment_gates_pull_requests_use_its_push_paths():
    text = _workflow("browser-pages.yml")
    assert _changes_paths(text) == _push_paths(text)


def test_the_deployment_redeploys_on_what_it_reads_and_nothing_else():
    paths = _push_paths(_workflow("browser-pages.yml"))
    inputs = {path for path in _deployment_inputs() if not path.endswith(".md")}
    # the pins, the corpus scoring the scanner-settings suite loads, and the
    # newspaper photographs three suites read
    for path in (
        ".github/actions/setup-scanner/action.yml",
        "corpus/benchmark-runner.cjs",
        "corpus/detect_benchmark.cjs",
        "corpus/score.cjs",
        "Examples/BrowserScanner/Newspaper/ground-truth.json",
        "LICENSE",
        "scripts/fetch_live_fixtures.py",
        "scripts/harness.cjs",
    ):
        assert path in inputs, path
    assert {path for path in inputs if not _filter_selects(paths, path)} == set()
    # Run 35640528376 redeployed, and asked every installed app to update,
    # for a push that changed two Examples README.txt files and documents.
    for path in (
        "Examples/README.txt",
        "Examples/LatinSquares/README.txt",
        "Examples/BrowserScanner/Newspaper/README.md",
        "README.md",
        "web/TESTING.md",
        "benchmarks/corpus_timeout_baseline.json",
        "pyproject.toml",
        "tests/test_basic.py",
        "scripts/smoke_wheel.py",
        "corpus/benchmark.cjs",
    ):
        assert not _filter_selects(paths, path), path


def test_every_change_that_runs_scanner_quality_runs_the_deployment_gate():
    quality = _changes_paths(_workflow("scan-input.yml"))
    gate = _push_paths(_workflow("browser-pages.yml"))
    probes = {*_SAMPLE_PATHS, *_files("web"), *_files("scripts"), *_files("Examples/BrowserScanner")}
    probes.discard(".github/workflows/scan-input.yml")
    assert {path for path in probes if _filter_selects(quality, path)} - {
        path for path in probes if _filter_selects(gate, path)
    } == set()


def test_a_documents_only_pull_request_runs_no_suites():
    for name in _GATED_WORKFLOWS:
        patterns = _changes_paths(_workflow(name))
        assert not any(_filter_selects(patterns, path) for path in _DOCUMENTS), name


def _extended_selections() -> list[list[str]]:
    """Each Extended CI corpus entry's pytest arguments."""
    text = _workflow("extended.yml")
    selections = []
    for match in re.finditer(r"^(\s+)selection: (>-\n((?:\1  .*\n)+)|.+\n)", text, re.M):
        selections.append((match.group(3) or match.group(2)).split())
    return selections


def test_extended_ci_runs_when_what_its_jobs_read_changes():
    paths = _push_paths(_workflow("extended.yml"))
    read = {
        argument.split("::")[0]
        for selection in _extended_selections()
        for argument in selection
    }
    read |= {
        "tests/helpers.py",
        "examples2.py",
        "Examples/Sudoku/16x16/Metcalf-16x16-NP.clp",
        "Examples/Slitherlink/Tatham/H7x7-L10-W5.clp",
        "scripts/run_new_family_corpus.py",
        "benchmarks/corpus_timeout_baseline.json",
        ".github/workflows/extended.yml",
    }
    assert len(read) > 10
    assert {path for path in read if not _filter_selects(paths, path)} == set()


_PINNED_ACTION = re.compile(r"^\s*(?:- )?uses: ([\w.-]+/[\w./-]+)@(\S+)(.*)$", re.M)


def _action_pins() -> dict[str, list[tuple[str, str, str]]]:
    """External `uses:` references by the directory Dependabot must scan."""
    found: dict[str, list[tuple[str, str, str]]] = {}
    for path in sorted((_GITHUB / "workflows").glob("*.yml")):
        found.setdefault("/", []).extend(_PINNED_ACTION.findall(path.read_text(encoding="utf-8")))
    for path in sorted((_GITHUB / "actions").glob("*/action.yml")):
        pins = _PINNED_ACTION.findall(path.read_text(encoding="utf-8"))
        if pins:
            found[f"/.github/actions/{path.parent.name}"] = pins
    return found


def _dependabot_entry(ecosystem: str) -> str:
    text = (_GITHUB / "dependabot.yml").read_text(encoding="utf-8")
    entries = re.split(r"^  - ", text, flags=re.M)[1:]
    (entry,) = [entry for entry in entries if entry.startswith(f"package-ecosystem: {ecosystem}\n")]
    return entry


def test_every_action_is_pinned_by_commit_with_its_version():
    for directory, pins in _action_pins().items():
        for action, ref, comment in pins:
            assert re.fullmatch(r"[0-9a-f]{40}", ref), f"{action}@{ref} in {directory}"
            assert re.fullmatch(r" # v\d+(\.\d+)*", comment), f"{action} in {directory}"


def test_dependabot_scans_every_directory_that_pins_an_action():
    entry = _dependabot_entry("github-actions")
    directories = re.findall(r'^      - "([^"]+)"$', entry, re.M)
    assert "/" in directories
    pinning = _action_pins()
    assert len(pinning) > 1, "no composite action pins an action"
    for directory in pinning:
        assert any(fnmatch.fnmatchcase(directory, pattern) for pattern in directories), directory


def _requirement_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _constraints() -> dict[str, str]:
    lines = (_GITHUB / "actions" / "setup-project" / "constraints.txt").read_text(encoding="utf-8")
    pins = {}
    for line in lines.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        # Dependabot's pip support treats a .txt file as a requirements file
        # when every line is blank, a comment or a requirement.
        match = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9._-]*)==(\d+(?:\.\d+)*)", line)
        assert match, line
        pins[_requirement_name(match[1])] = match[2]
    return pins


def test_ci_installs_the_pinned_versions_dependabot_keeps_current():
    entry = _dependabot_entry("pip")
    assert 'directory: "/.github/actions/setup-project"' in entry
    assert "versioning-strategy: increase" in entry
    action = (_GITHUB / "actions" / "setup-project" / "action.yml").read_text(encoding="utf-8")
    assert 'export PIP_CONSTRAINT="$GITHUB_ACTION_PATH/constraints.txt"' in action
    assert 'export PIP_BUILD_CONSTRAINT="$PIP_CONSTRAINT"' in action
    for name in ("PIP_CONSTRAINT", "PIP_BUILD_CONSTRAINT"):
        assert f'echo "{name}=${name}" >> "$GITHUB_ENV"' in action
    assert ".github/actions/setup-project/constraints.txt" in action, "the pip cache key"
    python = re.search(r'python-version: "([\d.]+)"', action).group(1)
    assert (_GITHUB / "actions" / "setup-project" / ".python-version").read_text().strip() == python
    pins = _constraints()
    project = tomllib.loads((_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    requirements = [*project["dependencies"]]
    for extra in project["optional-dependencies"].values():
        requirements += extra
    for requirement in requirements:
        name, minimum = re.fullmatch(r"([A-Za-z0-9._-]+)>=([\d.]+)", requirement).groups()
        pinned = pins[_requirement_name(name)]
        assert _release(pinned) >= _release(minimum), requirement
    assert {"pip", "setuptools"} <= pins.keys()


def _release(version: str) -> tuple[int, ...]:
    parts = [int(part) for part in version.split(".")]
    return tuple(parts + [0] * (3 - len(parts)))
