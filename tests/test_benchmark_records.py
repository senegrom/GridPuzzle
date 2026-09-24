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
