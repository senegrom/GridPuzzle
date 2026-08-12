import json
import subprocess
from pathlib import Path

import pytest

from scripts import run_new_family_corpus as corpus


def test_mabane_nonstandard_variants_are_classified_explicitly():
    standard = Path("Examples/Slitherlink/Mebane/#I.4-10x10.clp")
    variant = Path("Examples/Slitherlink/Mebane/#II.1-10x10.clp")

    assert corpus.classify_unsupported_variant(standard) is None
    assert "extra constraints" in corpus.classify_unsupported_variant(variant)


def test_corpus_paths_are_stably_sharded(tmp_path):
    directory = tmp_path / "Examples" / "Hidato"
    directory.mkdir(parents=True)
    for name in ("c.clp", "a.clp", "d.clp", "b.clp"):
        (directory / name).write_text("", encoding="utf-8")

    first = corpus.corpus_paths(
        tmp_path,
        "hidato",
        shard_index=0,
        shard_count=2,
    )
    second = corpus.corpus_paths(
        tmp_path,
        "hidato",
        shard_index=1,
        shard_count=2,
    )

    assert [path.name for path in first] == ["a.clp", "c.clp"]
    assert [path.name for path in second] == ["b.clp", "d.clp"]
    assert set(first).isdisjoint(second)


def test_single_case_solves_in_process(tmp_path):
    path = tmp_path / "one.clp"
    path.write_text("(solve 1 1 4)\n", encoding="utf-8")

    result = corpus.solve_case(path)

    assert result["status"] == "unique"
    assert result["grid_type"] == "Slitherlink"
    assert result["solutions_observed"] == 1


def test_isolated_timeout_is_recorded(monkeypatch, tmp_path):
    path = tmp_path / "case.clp"
    path.write_text("(solve 1 1 4)\n", encoding="utf-8")

    def time_out(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])

    monkeypatch.setattr(corpus.subprocess, "run", time_out)
    result = corpus.run_isolated_case(path, timeout_seconds=0.1)

    assert result["status"] == "timeout"
    assert result["timeout_seconds"] == 0.1


def test_main_writes_report_and_fails_for_regressions(
    monkeypatch,
    tmp_path,
    capsys,
):
    report = {
        "family": "hidato",
        "status_counts": {"unique": 1, "timeout": 1, "unsupported_variant": 1},
        "cases": [],
    }
    monkeypatch.setattr(corpus, "run_corpus", lambda **kwargs: report)
    output = tmp_path / "report.json"

    assert corpus.main(("--family", "hidato", "--output", str(output))) == 0
    assert json.loads(output.read_text(encoding="utf-8")) == report
    assert json.loads(capsys.readouterr().out) == report

    # errors and solution-count regressions each fail the run on their own
    for failing_status in ("error", "unsatisfiable", "multiple"):
        report["status_counts"] = {"unique": 1, failing_status: 1}
        assert corpus.main(("--family", "hidato")) == 1


def test_corpus_paths_reject_missing_and_empty_corpora(tmp_path):
    with pytest.raises(FileNotFoundError, match="does not exist"):
        corpus.corpus_paths(tmp_path, "hidato")

    directory = tmp_path / "Examples" / "Hidato"
    directory.mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="No .clp cases"):
        corpus.corpus_paths(tmp_path, "hidato")
