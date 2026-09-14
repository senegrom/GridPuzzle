"""janko.at page parsing: doubled blocks and unsupported variants must not become targets."""
from corpus.parse_janko import READERS, consistent, sections

HIDOKU_TWICE = """\
[begin]
puzzle hidoku
size 2
[problem]
1 -
- 4
[solution]
1 2
3 4
[solution]
1 2
3 4
[end]
"""

KENDOKU = """\
[begin]
puzzle kendoku
size 2
[problem]
{row1}
{row2}
[areas]
{areas1}
{areas2}
[solution]
1 2
2 1
[end]
"""


def test_repeated_block_keeps_the_first_copy_only():
    # Hidoku page 001 prints its solution twice; the grid must not be doubled.
    meta, blocks = sections(HIDOKU_TWICE)
    assert meta["size"] == "2"
    assert blocks["solution"] == [["1", "2"], ["3", "4"]]
    puzzle, solution = READERS["hidato"](meta, blocks)
    assert solution == [1, 2, 3, 4]
    assert consistent(puzzle, solution)


def test_solution_of_the_wrong_length_is_inconsistent():
    puzzle, _ = READERS["hidato"](*sections(HIDOKU_TWICE))
    assert not consistent(puzzle, [1, 2, 3, 4, 1, 2, 3, 4])


def test_operator_less_multi_cell_cage_is_an_unsupported_variant():
    # Some Kendoku pages print bare numbers and leave the operation to be
    # deduced; assuming addition produced targets the solution contradicts.
    page = KENDOKU.format(row1="3 .", row2="3+ .", areas1="1 1", areas2="2 2")
    assert READERS["kenken"](*sections(page)) is None


def test_operators_and_singletons_still_parse():
    page = KENDOKU.format(row1="1 2", row2="3+ .", areas1="1 2", areas2="3 3")
    puzzle, solution = READERS["kenken"](*sections(page))
    assert [(c["cells"], c["target"], c["op"]) for c in puzzle["cages"]] == [
        ([0], 1, "="), ([1], 2, "="), ([2, 3], 3, "+")]
    assert solution == [1, 2, 2, 1]
