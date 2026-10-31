"""corpus/benchmark.cjs's command line, run through Node.

The CLI stays out of the deployment's inputs (see tests/test_workflows.py), so
its option checks, and how its process ends, are tested here rather than among
the browser unit tests. A typo must not turn a targeted measurement into an
hours-long run over the whole corpus in Chromium, or measure another engine or
corner mode.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "corpus" / "benchmark.cjs"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="needs Node.js")

# Parses each argument list with the CLI's own parseOptions: its options, or
# the message of the error it throws.
PARSE = """
const { parseOptions } = require(process.argv[1]);
process.stdout.write(JSON.stringify(JSON.parse(process.argv[2]).map((args) => {
  try { return { options: parseOptions(args, { PUZZLE_CORPUS: "corpus-root" }) }; }
  catch (error) { return { error: error.message }; }
})));
"""


def parse(*cases: list[str]) -> list[dict]:
    run = subprocess.run([NODE, "-e", PARSE, str(CLI), json.dumps(cases)],
                         capture_output=True, text=True, encoding="utf-8", check=True, timeout=60)
    return json.loads(run.stdout)


def test_benchmark_options_take_a_value_either_way_and_default_to_the_whole_corpus():
    default, chosen = parse([], [
        "--family", "kenken", "--set=janko-kenken", "--variant", "photo", "--limit", "5", "--engine=webkit",
        "--true-corners", "--site", "../other/_site", "--out", "a.json", "--list", "names.txt", "--corpus", "elsewhere"])
    assert default == {"options": {
        "corpus": "corpus-root", "family": None, "set": None, "variant": None, "list": None, "limit": 0,
        "engine": "chromium", "trueCorners": False, "site": "_site", "out": "browser-artifacts/corpus-benchmark.json"}}
    assert chosen == {"options": {
        "corpus": "elsewhere", "family": "kenken", "set": "janko-kenken", "variant": "photo", "list": "names.txt",
        "limit": 5, "engine": "webkit", "trueCorners": True, "site": "../other/_site", "out": "a.json"}}


REJECTED = [
    (["--familly", "sudoku"], "Unknown option: --familly"),
    (["--true-corner"], "Unknown option: --true-corner"),
    (["--trueCorners", "--family", "kakuro"], "Unknown option: --trueCorners"),
    (["--limit", "5", "--bogus"], "Unknown option: --bogus"),
    (["sudoku"], "Unknown option: sudoku"),
    (["--set"], "Missing value for --set"),
    (["--set", "--limit", "5"], "Missing value for --set"),
    (["--list="], "Missing value for --list"),
    (["--variant"], "Missing value for --variant"),
    (["--limit", "abc"], "Limit must be a nonnegative whole number"),
    (["--limit", "-5"], "Limit must be a nonnegative whole number"),
    (["--limit", "2.5"], "Limit must be a nonnegative whole number"),
    (["--engine", "firefox"], "Engine must be chromium or webkit"),
]


def test_unknown_options_and_missing_or_malformed_values_are_errors():
    results = parse(*(args for args, _ in REJECTED))
    assert [result.get("error") for result in results] == [message for _, message in REJECTED]


def test_a_bad_option_stops_the_benchmark_before_it_selects_images_or_starts_a_browser(tmp_path):
    run = subprocess.run([NODE, str(CLI), "--familly", "sudoku", "--corpus", str(tmp_path)], cwd=tmp_path,
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert run.returncode == 2
    assert run.stdout == ""
    assert run.stderr.strip() == (
        "Unknown option: --familly. See the header of corpus/benchmark.cjs for the options.")


def test_a_missing_list_or_corpus_stops_the_benchmark_with_a_message(tmp_path):
    for args, named in ((["--list", "absent.txt", "--corpus", str(tmp_path)], "absent.txt"),
                        (["--corpus", str(tmp_path / "absent")], "absent")):
        run = subprocess.run([NODE, str(CLI), *args], cwd=tmp_path,
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert run.returncode == 2, args
        assert run.stdout == "", args
        (line,) = run.stderr.strip().splitlines()
        assert line.startswith("Cannot select images: ENOENT: no such file or directory") and named in line, line


NOT_RUN = [{"family": "latinsquare", "set": "fixture", "name": "2.png"}]


def ending(tmp_path, **plan):
    """How the command's process ends in a tree of its own, under a plan for
    the stand-in for Playwright and the HTTP server, which the browser unit
    tests of corpus/detect_benchmark.cjs use too (web/tests/corpus-command.test.js
    has the cases): the finished process and the report on disk. A process that
    has to be ended fails here, with subprocess.TimeoutExpired."""
    for name in ("corpus/benchmark.cjs", "corpus/benchmark-runner.cjs", "corpus/score.cjs", "scripts/watch.cjs"):
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / name, tmp_path / name)
    stand_in = tmp_path / "node_modules" / "playwright" / "index.js"
    stand_in.parent.mkdir(parents=True)
    shutil.copy(ROOT / "web" / "tests" / "corpus-command-stand-in.cjs", stand_in)
    images = tmp_path / "images" / "latinsquare" / "fixture"
    images.mkdir(parents=True)
    target = {"puzzle": {"type": "latinsquare", "rows": 2, "cols": 2, "cells": [1, 2, 2, 1]},
              "corners": [[0, 0], [9, 0], [9, 9], [0, 9]]}
    for n in range(3):
        (images / f"{n}.png").write_bytes(b"image bytes")
        (images / f"{n}.json").write_text(json.dumps(target), encoding="utf-8")
    run = subprocess.run([NODE, "--require", str(stand_in), "corpus/benchmark.cjs", "--corpus", "images", "--out", "report.json"],
                         cwd=tmp_path, env={**os.environ, "COMMAND_PLAN": json.dumps(plan)},
                         capture_output=True, text=True, encoding="utf-8", timeout=30)
    return run, json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))


def test_a_run_ends_by_itself_with_exit_code_0_and_leaves_the_signals_to_the_command(tmp_path):
    run, saved = ending(tmp_path, left=True)
    assert run.returncode == 0, run.stderr
    assert saved["status"] == "complete"
    assert saved["completedImages"] == 3
    assert "what was left to do" in run.stdout, "a browser that closed cuts nothing short"
    launched = (tmp_path / "events.txt").read_text(encoding="utf-8").splitlines()[0]
    assert json.loads(launched.removeprefix("launched ")) == {
        "headless": True, "handleSIGINT": False, "handleSIGTERM": False, "handleSIGHUP": False}


@pytest.mark.parametrize("signal", ["SIGINT", "SIGTERM", "SIGHUP"])
def test_a_signal_stops_the_benchmark_with_its_report_saved_and_exit_code_1(tmp_path, signal):
    run, saved = ending(tmp_path, interrupt=signal)
    failure = f"Benchmark interrupted by {signal}"
    assert run.returncode == 1, run.stderr
    assert run.stderr.splitlines() == [failure]
    assert (saved["status"], saved["failure"]) == ("interrupted", failure)
    assert (saved["cleanupErrors"], saved["notRun"]) == ([], NOT_RUN)
    assert [row.get("error") for row in saved["results"]] == [None, failure]


def test_a_signal_before_the_first_image_stops_the_benchmark_with_exit_code_1_too(tmp_path):
    run, saved = ending(tmp_path, unanswered="SIGINT")
    assert run.returncode == 1, run.stderr
    assert (saved["status"], saved["completedImages"], len(saved["notRun"])) == ("interrupted", 0, 3)


def test_a_second_signal_ends_the_process_at_once_and_the_server_with_it(tmp_path):
    run, saved = ending(tmp_path, interrupt="SIGINT", second="SIGTERM")
    assert run.returncode == 143, run.stderr
    assert "exit handlers ran with 143" in run.stdout
    assert (saved["status"], saved["completedImages"]) == ("running", 2)
    assert (tmp_path / "events.txt").read_text(encoding="utf-8").splitlines()[1:] == ["context closed", "server killed"]


@pytest.mark.parametrize("plan, failed", [
    ({"close": "never"}, "browser: browser cleanup timed out"),
    ({"close": "reject"}, "browser: the pipe broke"),
])
def test_an_interrupted_benchmark_ends_by_itself_when_its_browser_will_not_close(tmp_path, plan, failed):
    run, saved = ending(tmp_path, interrupt="SIGINT", **plan)
    assert run.returncode == 1, run.stderr
    assert (saved["status"], saved["cleanupErrors"], saved["notRun"]) == ("interrupted", [failed], NOT_RUN)
    assert failed in run.stderr.splitlines()
    assert "exit handlers ran with 1" in run.stdout


def test_a_benchmark_nothing_interrupted_ends_by_itself_when_its_browser_will_not_close(tmp_path):
    run, saved = ending(tmp_path, close="reject")
    assert run.returncode == 1, run.stderr
    assert (saved["status"], saved["cleanupErrors"]) == ("failed", ["browser: the pipe broke"])
    assert saved["completedImages"] == 3


def test_a_final_save_that_fails_is_printed_when_the_process_is_ended_for_its_browser(tmp_path):
    run, saved = ending(tmp_path, close="reject", fullDisk=True)
    assert run.returncode == 1, run.stderr
    assert "Could not save benchmark report: no space left on the disk" in run.stderr
    assert saved["status"] == "running"
