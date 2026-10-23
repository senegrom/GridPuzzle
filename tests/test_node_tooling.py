"""Rules for the Node-side tooling that CI's runners do not enforce."""

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def test_node_fetches_with_a_deadline_leave_no_body_unread():
    """Node 24's fetch asserts, uncaught, when a timeout signal fires on a
    response whose body nobody read: every suite on it died within seconds
    until scripts/harness.cjs switched its readiness probe to HEAD, and
    corpus/benchmark-runner.cjs kept the GET. Node 22 on the runners
    tolerates it, so only this check catches a new one."""
    offenders = []
    for path in sorted([*(_ROOT / "scripts").glob("*.cjs"), *(_ROOT / "corpus").glob("*.cjs")]):
        for call in re.findall(r"fetch\([^;]*?AbortSignal\.timeout", path.read_text(encoding="utf-8")):
            if 'method: "HEAD"' not in call:
                offenders.append(f"{path.relative_to(_ROOT).as_posix()}: {call}")
    assert offenders == []


def test_suites_hand_the_page_files_as_bytes():
    """Given a path, Playwright lets WebKit open the file itself. WebKit on
    Windows (27.2) dates a file last modified on a whole second, as
    `git archive | tar -x` leaves every file, now and then a second early,
    and refuses a read whose date differs from the one its File took: "The
    object can not be found here.". The stale-build check chose its photo
    by path and stalled at that in every WebKit run from an export, while
    the runners' fresh checkouts never meet it, so only this check catches
    a new one: a suite hands the page a file as { name, mimeType, buffer }
    (web/TESTING.md, "Running the suites from an export")."""
    offenders = []
    for path in sorted([*(_ROOT / "scripts").glob("*.cjs"), *(_ROOT / "corpus").glob("*.cjs")]):
        text = path.read_text(encoding="utf-8")
        for call in re.finditer(r"\.(?:setInputFiles|setFiles)\(\s*(?:([\"'`])[^\"'`]*\1\s*,\s*)?", text):
            if not re.match(r"\[?\s*\{", text[call.end() :]):
                line = text.count("\n", 0, call.start()) + 1
                offenders.append(f"{path.relative_to(_ROOT).as_posix()}:{line}: {text[call.start() :].splitlines()[0]}")
    assert offenders == []
