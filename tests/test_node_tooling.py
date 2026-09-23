"""Rules for the Node-side tooling that CI's Node 22 does not enforce."""

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
