import subprocess
from pathlib import Path

from scripts import benchmark_exact_cages as bench

ROOT = Path(__file__).resolve().parents[1]


def test_records_name_the_trees_actually_measured(tmp_path):
    head = subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert bench.tree_commit(ROOT).startswith(head)
    # A tree that is not a git checkout is recorded as unknown, not guessed.
    assert bench.tree_commit(tmp_path) is None
    # The old fixed constant claimed one historical commit for every record.
    assert not hasattr(bench, "BASELINE")


def test_a_tree_with_changes_is_not_recorded_as_its_commit(tmp_path):
    tree = tmp_path / "tree"
    tree.mkdir()

    def git(*args):
        return subprocess.run(
            ["git", "-c", "user.name=test", "-c", "user.email=test@example.com",
             "-c", "core.autocrlf=false", "-C", str(tree), *args],
            capture_output=True, text=True, check=True,
        ).stdout.strip()

    git("init", "-q")
    (tree / ".gitignore").write_text("*.log\n", encoding="utf-8")
    (tree / "solver.py").write_text("RESULT = 1\n", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "measured")
    head = git("rev-parse", "HEAD")
    assert bench.tree_commit(tree) == head
    # an ignored file is not part of the measured tree
    (tree / "run.log").write_text("timings\n", encoding="utf-8")
    assert bench.tree_commit(tree) == head
    # a new module the change would import, not yet added
    (tree / "helper.py").write_text("HELP = 2\n", encoding="utf-8")
    assert bench.tree_commit(tree) == head + "+uncommitted"
    (tree / "helper.py").unlink()
    # an edited tracked file
    (tree / "solver.py").write_text("RESULT = 2\n", encoding="utf-8")
    assert bench.tree_commit(tree) == head + "+uncommitted"


def test_a_run_without_output_cannot_overwrite_a_dated_record():
    default = bench.build_parser().parse_args(["--baseline-root", "."]).output
    # benchmarks/ holds the committed evidence; the default lands in an
    # ignored scratch directory instead.
    assert default.parts[0] != "benchmarks"
    ignored = subprocess.run(
        ["git", "-C", str(ROOT), "check-ignore", "-q", default.as_posix()],
        capture_output=True,
    )
    assert ignored.returncode == 0, f"{default} is not ignored"
