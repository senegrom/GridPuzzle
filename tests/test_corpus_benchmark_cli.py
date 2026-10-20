"""corpus/benchmark.cjs's command line, run through Node.

The CLI stays out of the deployment's inputs (see tests/test_workflows.py), so
its option checks are tested here rather than among the browser unit tests. A
typo must not turn a targeted measurement into an hours-long run over the whole
corpus in Chromium, or measure another engine or corner mode.
"""
import json
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
