"""The executor benchmark the free-threaded workflow runs on demand."""

import json

import pytest

from gridsolver.solver import solver
from scripts import benchmark_thread_executor as bench


def test_it_times_both_backends_and_checks_they_agree(monkeypatch, tmp_path):
    # As in test_thread_executor: a GIL build runs the thread backend when told
    # the runtime is free-threaded, serialised but with the same results.
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)
    monkeypatch.setattr(bench, "free_threaded", lambda: True)
    output = tmp_path / "report.json"
    assert bench.main(["--rounds", "2", "--warmup", "0", "--cases", "loaded4_all", "--output", str(output)]) == 0
    report = json.loads(output.read_text(encoding="utf-8"))
    case = report["cases"]["loaded4_all"]
    assert case["count"] == 4
    assert len(case["process_seconds"]) == len(case["thread_seconds"]) == 2
    assert case["thread_over_process"] == case["thread_median"] / case["process_median"]
    assert report["summary"]["geomean_ratio"] == pytest.approx(case["thread_over_process"])
    assert report["summary"]["positive_cap_geomean_ratio"] is None
    assert report["workers"] == 2


def test_backends_that_disagree_invalidate_the_run(monkeypatch):
    monkeypatch.setattr(bench, "measure", lambda name, backend, workers: (1.0, 1, backend))
    with pytest.raises(AssertionError, match="different solutions"):
        bench.run(["loaded4_all"], 2, 1, 0)


def test_it_refuses_to_measure_threads_under_the_gil(monkeypatch, capsys):
    monkeypatch.setattr(bench, "free_threaded", lambda: False)
    with pytest.raises(SystemExit) as exit_:
        bench.main(["--rounds", "1"])
    assert exit_.value.code == 2
    assert "free-threaded build with the GIL disabled" in capsys.readouterr().err
