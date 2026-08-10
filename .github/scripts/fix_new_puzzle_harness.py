"""Correct raw-string quoting in the one-shot hardening generator."""

from pathlib import Path

path = Path(".github/scripts/harden_new_puzzle_families.py")
text = path.read_text(encoding="utf-8")
marker = "write_text('''"
if text.count(marker) != 5:
    raise SystemExit(
        f"Expected five generated source literals, found {text.count(marker)}"
    )
path.write_text(text.replace(marker, "write_text(r'''"), encoding="utf-8")
