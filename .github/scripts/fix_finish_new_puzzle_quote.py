"""Keep the generated CLI fixture's newline escaped in source."""

from pathlib import Path

path = Path(".github/scripts/finish_new_puzzle_core.py")
text = path.read_text(encoding="utf-8")
old = r'path.write_text("(solve 1 1 4)\n", encoding="utf-8")'
new = r'path.write_text("(solve 1 1 4)\\n", encoding="utf-8")'
if text.count(old) != 1:
    raise SystemExit(f"Expected one CLI fixture marker, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
