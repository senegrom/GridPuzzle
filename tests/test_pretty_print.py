"""Pretty printing: argument validation and rendered layout.

Separators, inner grids, candidate mode, directed inequalities and blank
cells render aligned, and invalid arguments or grid states are rejected
before anything is drawn.
"""

import pytest

from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs, pretty_print
from gridsolver.grid_classes.sudoku import Sudoku


def test_pretty_print_defaults_render_without_optional_structures():
    rendered = pretty_print(2, 2, 2, [1, 0, 0, 2])

    assert "1" in rendered
    assert "2" in rendered
    assert rendered.endswith("\n")


def test_pretty_print_candidate_mode_requires_complete_candidates():
    args = PrettyPrintArgs(print_candidates=True)

    with pytest.raises(ValueError, match="candidates are required"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], args=args)
    with pytest.raises(ValueError, match="Expected 4 candidate sets"):
        pretty_print(
            2,
            2,
            2,
            [0, 0, 0, 0],
            candidates=[{1, 2}],
            args=args,
        )


def test_pretty_print_rejects_invalid_shape_before_rendering():
    with pytest.raises(TypeError, match="rows must be an integer"):
        pretty_print(True, 2, 2, [0, 0, 0, 0])
    with pytest.raises(ValueError, match="max_elem must be positive"):
        pretty_print(2, 2, 0, [0, 0, 0, 0])
    with pytest.raises(ValueError, match="Expected 4 known values"):
        pretty_print(2, 2, 2, [0])
    with pytest.raises(TypeError, match="known must be a sequence"):
        pretty_print(1, 1, 1, "0")


def test_pretty_print_args_validate_separator_domains():
    with pytest.raises(TypeError, match="sep_up must be an integer"):
        PrettyPrintArgs(sep_up=True)
    with pytest.raises(ValueError, match="sep_up must be between 0 and 2"):
        PrettyPrintArgs(sep_up=3)
    with pytest.raises(ValueError, match="sep_in_ve must be between 0 and 4"):
        PrettyPrintArgs(sep_in_ve=-1)
    with pytest.raises(TypeError, match="print_candidates must be a boolean"):
        PrettyPrintArgs(print_candidates=1)


def test_pretty_print_args_validate_inner_grid_dimensions_and_parent():
    with pytest.raises(TypeError, match="inner_grid_row"):
        PrettyPrintArgs(inner_grid_row="square")
    with pytest.raises(ValueError, match="inner_grid_col"):
        PrettyPrintArgs(inner_grid_col=-1)
    with pytest.raises(TypeError, match="args must be a PrettyPrintArgs"):
        PrettyPrintArgs(args=object())

    parent = PrettyPrintArgs(inner_grid_row="sqrt", sep_in_ho=4)
    child = PrettyPrintArgs(args=parent, sep_in_ho=1)
    assert child.inner_grid_row == "sqrt"
    assert child.sep_in_ho == 1


@pytest.mark.parametrize("bad", (True, 1.5, -1, 3))
def test_pretty_print_rejects_invalid_known_values(bad):
    error = TypeError if isinstance(bad, (bool, float)) else ValueError
    with pytest.raises(error):
        pretty_print(1, 1, 2, [bad])


def test_pretty_print_validates_candidate_domains_and_shapes():
    args = PrettyPrintArgs(print_candidates=True)

    with pytest.raises(TypeError, match=r"candidates\[0\]"):
        pretty_print(1, 1, 2, [0], candidates=[1], args=args)
    with pytest.raises(TypeError, match="must contain integers"):
        pretty_print(1, 1, 2, [0], candidates=[{True}], args=args)
    with pytest.raises(ValueError, match="outside 1..2"):
        pretty_print(1, 1, 2, [0], candidates=[{0}], args=args)
    with pytest.raises(ValueError, match="outside 1..2"):
        pretty_print(1, 1, 2, [0], candidates=[{3}], args=args)


def test_pretty_print_validates_directed_adjacent_inequalities():
    args = PrettyPrintArgs(
        sep_in_ve=4,
        sep_in_ho=4,
        inner_grid_row=1,
        inner_grid_col=1,
    )

    rendered = pretty_print(2, 2, 2, [0, 0, 0, 0], args=args, ineqs={(0, 2)})
    assert "<" in rendered

    with pytest.raises(ValueError, match="exactly two cells"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 1, 2)})
    with pytest.raises(TypeError, match="must contain integers"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(False, 1)})
    with pytest.raises(ValueError, match="outside 0..3"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 4)})
    with pytest.raises(ValueError, match="must be distinct"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 0)})
    with pytest.raises(ValueError, match="not adjacent"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 3)})


def test_pretty_print_args_reject_zero_inner_dimensions_with_separators():
    with pytest.raises(ValueError, match="inner_grid_col must be positive"):
        PrettyPrintArgs(sep_in_ve=1)
    with pytest.raises(ValueError, match="inner_grid_row must be positive"):
        PrettyPrintArgs(sep_in_ho=1)

    # Candidate rendering supplies its own one-cell inner grid.
    args = PrettyPrintArgs(print_candidates=True, sep_in_ve=1, sep_in_ho=1)
    rendered = pretty_print(1, 1, 2, [0], candidates=[{1, 2}], args=args)
    assert "1" in rendered and "2" in rendered


def test_pretty_print_revalidates_mutated_args_snapshot():
    args = PrettyPrintArgs()
    args.sep_in_ve = 1
    with pytest.raises(ValueError, match="inner_grid_col must be positive"):
        pretty_print(1, 1, 1, [0], args=args)


def test_pretty_print_edge_configs_render_aligned():
    # regression: borders without left/right edges, and zero-width
    # separators with an inner grid, produced ragged rows and crashed
    # the crossing fixer with IndexError
    for args in (
        PrettyPrintArgs(sep_up=2, sep_lo=2, sep_le=0, sep_ri=0),
        PrettyPrintArgs(
            sep_in_ve=0, inner_grid_col=2, inner_grid_row=1, sep_in_ho=1
        ),
    ):
        rendered = pretty_print(2, 4, 4, [1, 2, 3, 4, 4, 3, 2, 1], args=args)
        lines = [line for line in rendered.splitlines() if line]
        assert "#" not in rendered
        assert len({len(line) for line in lines}) == 1


def test_pretty_print_places_inequality_glyphs_with_drawn_separators():
    # regression: drawn vertical separators desynced the inequality-row
    # state machine, swallowing glyphs and leaking literal '#'
    rendered = pretty_print(
        3, 3, 3, [0] * 9,
        args=PrettyPrintArgs(
            sep_in_ve=1, sep_in_ho=4, inner_grid_row=1, inner_grid_col=1
        ),
        ineqs={(0, 1), (4, 5), (8, 7)},
    )
    lines = [line for line in rendered.splitlines() if line]
    gap_rows = [line for line in lines if "^" in line or "v" in line]
    assert "#" not in rendered
    assert len(gap_rows) == 2
    assert gap_rows[0].index("^") == 1 and "v" not in gap_rows[0]
    assert gap_rows[1].index("^") == 3 and gap_rows[1].index("v") == 5


def test_pretty_print_blank_cells_with_space_separators_keep_borders():
    # regression: a blank cell rendered as " " was misclassified as a
    # separator column when sep_in_ve=3, corrupting the border rows
    rendered = pretty_print(
        2, 3, 3, [0, 1, 2, 3, 0, 1],
        args=PrettyPrintArgs(
            sep_in_ve=3, sep_in_ho=1, inner_grid_row=1, inner_grid_col=1
        ),
    )
    lines = [line for line in rendered.splitlines() if line]
    assert "#" not in rendered
    assert len({len(line) for line in lines}) == 1


def test_nonsquare_box_sudoku_draws_true_box_separators():
    grid = Sudoku(2, 3, 3, 2)  # 6x6 with 2-row x 3-col boxes
    grid.load([column + 1 for _ in range(6) for column in range(6)])
    _header, rendered = grid.to_str()
    lines = [line for line in rendered.splitlines() if line]
    content = [line for line in lines if any(ch.isdigit() for ch in line)]

    assert len(content) == 6
    # two 3-wide box columns give exactly one inner vertical separator;
    # the former sqrt-based layout drew two
    assert all(line.count("│") == 1 for line in content)
    # three 2-row box bands give exactly two inner horizontal rules
    assert sum(1 for line in lines if "─" in line) == 2
