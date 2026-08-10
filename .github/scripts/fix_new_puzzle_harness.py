"""Correct the one-shot hardening generator before execution."""

from pathlib import Path

path = Path(".github/scripts/harden_new_puzzle_families.py")
text = path.read_text(encoding="utf-8")
marker = "write_text('''"
if text.count(marker) != 5:
    raise SystemExit(
        f"Expected five generated source literals, found {text.count(marker)}"
    )
text = text.replace(marker, "write_text(r'''")
old_message = "Every cell in a multi-cell consecutive path needs a neighbour"
new_message = (
    "Consecutive-path adjacency graph must be connected; "
    "every path cell needs a neighbour"
)
if text.count(old_message) != 1:
    raise SystemExit(
        f"Expected one path-connectivity message, found {text.count(old_message)}"
    )
path.write_text(text.replace(old_message, new_message), encoding="utf-8")
