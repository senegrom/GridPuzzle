"""Make CSP-Rules detection depend on the first meaningful input line."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


CSP = Path("gridsolver/abstract_grids/csp_rules_loading.py")
replace_once(
    CSP,
    '''def is_csp_rules_text(text: object) -> bool:
    """Return whether text contains a supported CSP-Rules solve form."""
    return isinstance(text, str) and _SOLVE_START.search(text) is not None
''',
    '''def is_csp_rules_text(text: object) -> bool:
    """Return whether the input starts with a supported CSP-Rules form.

    Historical class-prefixed puzzle files often retain solver transcripts that
    contain later ``(solve ...)`` text. Detection must therefore inspect the
    first meaningful input line rather than searching the entire file or relying
    on a ``.clp`` suffix.
    """
    if not isinstance(text, str):
        return False
    for line in text.splitlines():
        stripped = line.strip().lstrip("\\ufeff")
        if not stripped or stripped.startswith((";", "#")):
            continue
        return _SOLVE_START.match(stripped) is not None
    return False
''',
    "CSP detector",
)

LOADING = Path("gridsolver/abstract_grids/grid_loading.py")
replace_once(
    LOADING,
    '''    if path.suffix.lower() == ".clp" or is_csp_rules_text(text):
        return create_from_csp_rules(text)
''',
    '''    if is_csp_rules_text(text):
        return create_from_csp_rules(text)
''',
    "file routing",
)

TEST = Path("tests/test_cli_and_loading.py")
with TEST.open("a", encoding="utf-8") as handle:
    handle.write('''


def test_csp_detection_uses_first_meaningful_line_not_suffix_or_transcript(
    tmp_path,
):
    legacy = tmp_path / "legacy.clp"
    legacy.write_text(
        "# retained comment\\n"
        "LatinSquare::\\n"
        ". .\\n"
        ". .\\n"
        "# later solver transcript\\n"
        "# (solve 1 1 4)\\n",
        encoding="utf-8",
    )

    grid = create_from_file(legacy, space_sep=True)

    assert isinstance(grid, LatinSquare)
    assert grid.rows == grid.cols == 2


def test_csp_detection_accepts_leading_comments_without_clp_suffix(tmp_path):
    puzzle = tmp_path / "slitherlink.txt"
    puzzle.write_text(
        "; retained source comment\\n"
        "# another comment\\n"
        "\\n"
        "(solve 1 1 4)\\n",
        encoding="utf-8",
    )

    grid = create_from_file(puzzle)

    from gridsolver.grid_classes.slitherlink import Slitherlink

    assert isinstance(grid, Slitherlink)
    assert grid.clues == ((4,),)


def test_class_prefixed_string_wins_over_later_solve_transcript():
    grid = create_from_str(
        "LatinSquare::\\n. .\\n. .\\n# (solve 1 1 4)",
        space_sep=True,
    )

    assert isinstance(grid, LatinSquare)
    assert grid.rows == grid.cols == 2
''')
