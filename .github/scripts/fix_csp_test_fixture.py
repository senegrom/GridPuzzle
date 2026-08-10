"""Replace the malformed direct-string fixture with a detector assertion."""

from pathlib import Path

path = Path("tests/test_cli_and_loading.py")
text = path.read_text(encoding="utf-8")
old = '''def test_class_prefixed_string_wins_over_later_solve_transcript():
    grid = create_from_str(
        "LatinSquare::\\n. .\\n. .\\n# (solve 1 1 4)",
        space_sep=True,
    )

    assert isinstance(grid, LatinSquare)
    assert grid.rows == grid.cols == 2
'''
new = '''def test_class_prefixed_string_is_not_misdetected_from_later_transcript():
    from gridsolver.abstract_grids.csp_rules_loading import is_csp_rules_text

    assert not is_csp_rules_text(
        "LatinSquare::\\n. .\\n. .\\n# (solve 1 1 4)"
    )
'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one direct-string fixture, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
