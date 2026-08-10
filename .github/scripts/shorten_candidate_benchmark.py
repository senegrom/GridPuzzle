"""Keep the exact hard-Sudoku comparison within the evaluation budget."""

from pathlib import Path

path = Path(".github/scripts/benchmark_lazy_candidate_index.py")
text = path.read_text(encoding="utf-8")
replacements = {
    "    for _ in range(4):\n        grid = Sudoku()\n": (
        "    for _ in range(1):\n        grid = Sudoku()\n"
    ),
    '    "hard9": 5,\n': '    "hard9": 1,\n',
    '    "hard9": "Hard 9×9 Sudoku, four first-solution solves",\n': (
        '    "hard9": "Hard 9×9 Sudoku, first solution",\n'
    ),
}
for old, new in replacements.items():
    if text.count(old) != 1:
        raise SystemExit(f"Expected one benchmark marker, found {text.count(old)}")
    text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
