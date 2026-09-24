"""Timeouts must not turn a failed corpus run into a green no-op."""

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from scripts import run_new_family_corpus as corpus


@pytest.fixture
def root(tmp_path):
    directory = tmp_path / "Examples" / "Slitherlink"
    directory.mkdir(parents=True)
    for name in ("a.clp", "b.clp"):
        (directory / name).write_text("(solve 1 1 4)", encoding="utf-8")
    return tmp_path


def _baseline(root, paths=("Examples/Slitherlink/a.clp",)):
    today = datetime.now(UTC).date()
    data = {
        "schema_version": 1,
        "case_timeout_seconds": 60,
        "reviewed_on": today.isoformat(),
        "expires_on": (today + timedelta(days=30)).isoformat(),
        "evidence": "Deterministic test fixture",
        "timeouts": [{"path": path, "reason": "Known test timeout"} for path in paths],
    }
    path = root / "baseline.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path, data


def _run(root, monkeypatch, statuses, baseline=None):
    def solve(path, **kwargs):
        return {"path": path.as_posix(), "status": statuses[path.name]}
    monkeypatch.setattr(corpus, "run_isolated_case", solve)
    return corpus.run_corpus(
        root=root, family="slitherlink", timeout_seconds=60,
        shard_index=0, shard_count=1, timeout_baseline=baseline,
    )


def test_unexpected_timeout_fails_and_identifies_the_case(root, monkeypatch):
    report = _run(root, monkeypatch, {"a.clp": "timeout", "b.clp": "unique"})
    assert corpus.report_exit_code(report) == 1
    assert report["unexpected_timeouts"] == ["Examples/Slitherlink/a.clp"]
    assert report["accepted_timeouts"] == []


def test_reviewed_timeout_is_accepted_only_with_a_completed_case(root, monkeypatch):
    baseline, _ = _baseline(root)
    report = _run(root, monkeypatch, {"a.clp": "timeout", "b.clp": "unique"}, baseline)
    assert corpus.report_exit_code(report) == 0
    assert report["accepted_timeouts"] == ["Examples/Slitherlink/a.clp"]
    assert report["unexpected_timeouts"] == []


def test_all_accepted_timeouts_still_fail(root, monkeypatch):
    baseline, _ = _baseline(root, ("Examples/Slitherlink/a.clp", "Examples/Slitherlink/b.clp"))
    report = _run(root, monkeypatch, {"a.clp": "timeout", "b.clp": "timeout"}, baseline)
    assert corpus.report_exit_code(report) == 1
    assert report["no_unique_cases"] is True
    assert len(report["accepted_timeouts"]) == 2


def test_resolved_timeout_is_reported_for_baseline_cleanup(root, monkeypatch):
    baseline, _ = _baseline(root)
    report = _run(root, monkeypatch, {"a.clp": "unique", "b.clp": "unique"}, baseline)
    assert corpus.report_exit_code(report) == 0
    assert report["resolved_timeouts"] == ["Examples/Slitherlink/a.clp"]


def test_child_cannot_claim_another_paths_exception(root, monkeypatch):
    baseline, _ = _baseline(root)
    def solve(path, **kwargs):
        return {"path": str(root / "Examples/Slitherlink/a.clp"),
                "status": "unique" if path.name == "a.clp" else "timeout"}
    monkeypatch.setattr(corpus, "run_isolated_case", solve)
    report = corpus.run_corpus(
        root=root, family="slitherlink", timeout_seconds=60,
        shard_index=0, shard_count=1, timeout_baseline=baseline,
    )
    assert report["unexpected_timeouts"] == ["Examples/Slitherlink/b.clp"]
    assert corpus.report_exit_code(report) == 1


@pytest.mark.parametrize("status", ["error", "unsatisfiable", "multiple", "unexpected_status"])
def test_other_regressions_remain_fatal(root, monkeypatch, status):
    report = _run(root, monkeypatch, {"a.clp": status, "b.clp": "unique"})
    assert corpus.report_exit_code(report) == 1


def test_all_unsupported_cases_fail(root, monkeypatch):
    report = _run(root, monkeypatch, {"a.clp": "unsupported_variant", "b.clp": "unsupported_variant"})
    assert corpus.report_exit_code(report) == 1


def test_main_writes_machine_readable_failure_before_exit(root, monkeypatch, capsys):
    def solve(path, **kwargs):
        return {"path": str(path), "status": "timeout"}
    monkeypatch.setattr(corpus, "run_isolated_case", solve)
    output = root / "reports" / "result.json"
    status = corpus.main(("--root", str(root), "--family", "slitherlink", "--output", str(output)))
    assert status == 1
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report == json.loads(capsys.readouterr().out)
    assert len(report["unexpected_timeouts"]) == 2
    assert report["no_unique_cases"]


@pytest.mark.parametrize("change", [
    "expired", "future", "permanent", "duplicate", "no_reason", "no_evidence",
    "missing_file", "traversal", "absolute", "backslash", "schema", "timeout", "nan",
])
def test_bad_baselines_fail_closed(root, change):
    path, data = _baseline(root)
    today = datetime.now(UTC).date()
    if change == "expired":
        data["reviewed_on"] = (today - timedelta(days=30)).isoformat()
        data["expires_on"] = today.isoformat()
    elif change == "future":
        data["reviewed_on"] = (today + timedelta(days=1)).isoformat()
    elif change == "permanent":
        data["expires_on"] = (today + timedelta(days=32)).isoformat()
    elif change == "duplicate":
        data["timeouts"] *= 2
    elif change == "no_reason":
        data["timeouts"][0]["reason"] = " "
    elif change == "no_evidence":
        data["evidence"] = " "
    elif change == "missing_file":
        data["timeouts"][0]["path"] = "Examples/Slitherlink/missing.clp"
    elif change == "traversal":
        data["timeouts"][0]["path"] = "Examples/Slitherlink/../Slitherlink/a.clp"
    elif change == "absolute":
        data["timeouts"][0]["path"] = "/Examples/Slitherlink/a.clp"
    elif change == "backslash":
        data["timeouts"][0]["path"] = "Examples\\Slitherlink\\a.clp"
    elif change == "schema":
        data["schema_version"] = True
    elif change == "timeout":
        data["case_timeout_seconds"] = 30
    elif change == "nan":
        data["case_timeout_seconds"] = float("nan")
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError):
        corpus.load_timeout_baseline(path, root=root, timeout_seconds=60, today=today)


def test_the_shipped_baseline_is_one_the_weekly_job_will_accept():
    """The weekly job loads benchmarks/corpus_timeout_baseline.json with the
    same rules as any other baseline, and only that job reads it, so a
    renewal that breaks them is invisible until Sunday. The exemption is
    deliberately short-lived: renewing it means reviewing the shard
    artifacts again and moving both dates, not pushing the expiry out."""
    path = Path("benchmarks/corpus_timeout_baseline.json")
    reviewed = date.fromisoformat(json.loads(path.read_text(encoding="utf-8"))["reviewed_on"])
    allowed = corpus.load_timeout_baseline(
        path, root=Path.cwd(), timeout_seconds=60, today=reviewed,
    )
    assert allowed, "a baseline with no accepted timeout should be deleted, not shipped empty"


@pytest.mark.parametrize("left", [8, 7, 1])
def test_a_baseline_in_its_last_week_says_so(root, left):
    path, data = _baseline(root)
    expires = date.fromisoformat(data["expires_on"])
    notice = corpus.expiry_notice(path, today=expires - timedelta(days=left))
    if left > corpus.EXPIRY_NOTICE_DAYS:
        assert notice is None
    else:
        assert f"expires on {expires.isoformat()}, in {left} day" in notice
    assert corpus.expiry_notice(None) is None


@pytest.mark.parametrize("left", [30, 5])
def test_main_warns_on_stderr_only_in_the_baselines_last_week(root, monkeypatch, capsys, left):
    """The weekly job's runs of the last week pass but say the baseline is
    about to expire; stdout keeps carrying nothing but the report."""
    path, data = _baseline(root)
    today = datetime.now(UTC).date()
    data["reviewed_on"] = (today - timedelta(days=30 - left)).isoformat()
    data["expires_on"] = (today + timedelta(days=left)).isoformat()
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(corpus, "run_isolated_case",
                        lambda path, **kwargs: {"path": path.as_posix(), "status": "unique"})
    status = corpus.main(("--root", str(root), "--family", "slitherlink", "--timeout-baseline", str(path)))
    captured = capsys.readouterr()
    assert status == 0
    assert json.loads(captured.out)["resolved_timeouts"] == ["Examples/Slitherlink/a.clp"]
    if left > corpus.EXPIRY_NOTICE_DAYS:
        assert captured.err == ""
        return
    annotation, plain = captured.err.splitlines()
    assert annotation.startswith("::warning title=Timeout baseline expires soon::")
    assert plain.startswith("warning: ")
    assert f"in {left} days" in annotation and f"in {left} days" in plain


@pytest.mark.parametrize("raw", ["nan", "inf", "-inf", "0", "-1"])
def test_cli_rejects_non_finite_or_non_positive_deadlines(raw):
    with pytest.raises(SystemExit) as caught:
        corpus.build_parser().parse_args(["--family", "slitherlink", f"--case-timeout={raw}"])
    assert caught.value.code == 2


def test_zero_max_cases_cannot_make_a_green_noop(root):
    with pytest.raises(ValueError, match="max_cases"):
        corpus.run_corpus(
            root=root, family="slitherlink", timeout_seconds=60,
            shard_index=0, shard_count=1, max_cases=0,
        )


def test_legacy_report_without_exception_metadata_fails():
    assert corpus.report_exit_code({"status_counts": {"unique": 1, "timeout": 1}}) == 1
