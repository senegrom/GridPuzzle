"""Keep the Kakuro coverage test valid under maximal-run validation."""

from pathlib import Path

path = Path("tests/test_new_puzzle_families.py")
text = path.read_text(encoding="utf-8")
old = '''def test_kakuro_requires_one_run_of_each_orientation_per_cell():
    white = tuple(product(range(2), range(3)))
    runs = (
        (3, ((0, 0), (0, 1))),
        (5, ((0, 1), (0, 2))),
        (6, ((1, 0), (1, 1), (1, 2))),
        (3, ((0, 0), (1, 0))),
        (4, ((0, 1), (1, 1))),
        (5, ((0, 2), (1, 2))),
    )

    with pytest.raises(ValueError, match="exactly one horizontal"):
        Kakuro(2, 3, white, runs)
'''
new = '''def test_kakuro_requires_one_run_of_each_orientation_per_cell():
    white = tuple(product(range(2), range(3)))
    runs = (
        (6, ((0, 0), (0, 1), (0, 2))),
        (6, ((1, 0), (1, 1), (1, 2))),
        (3, ((0, 0), (1, 0))),
        (4, ((0, 1), (1, 1))),
    )

    with pytest.raises(ValueError, match="exactly one horizontal"):
        Kakuro(2, 3, white, runs)
'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one Kakuro coverage fixture, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
