from itertools import permutations, product
from pathlib import Path

import pytest

from gridsolver.abstract_grids.csp_rules_loading import (
    create_from_csp_rules,
    create_from_csp_rules_file,
    is_csp_rules_text,
)
from gridsolver.abstract_grids.grid import Grid, TechniqueProfile
from gridsolver.abstract_grids.grid_loading import create_from_file, create_from_str
from gridsolver.grid_classes.kakuro import Kakuro
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.rules.rules import InvalidGrid
from gridsolver.rules.topology import (
    ConsecutiveAdjacencyRule,
    SingleLoopRule,
)
from gridsolver.solver import atomic_solver, solver
import run as run_cli


_REPO_ROOT = Path(__file__).resolve().parents[1]


def _path_oracle(
    rows: int,
    cols: int,
    *,
    diagonal: bool,
    givens: dict[tuple[int, int], int],
    blocked: frozenset[tuple[int, int]] = frozenset(),
) -> set[tuple[int, ...]]:
    keys = tuple(
        (row, col)
        for row in range(rows)
        for col in range(cols)
        if (row, col) not in blocked
    )
    result: set[tuple[int, ...]] = set()
    for values in permutations(range(1, len(keys) + 1)):
        by_cell = dict(zip(keys, values))
        if any(by_cell[cell] != value for cell, value in givens.items()):
            continue
        positions = {value: cell for cell, value in by_cell.items()}
        valid = True
        for value in range(1, len(keys)):
            first = positions[value]
            second = positions[value + 1]
            row_distance = abs(first[0] - second[0])
            col_distance = abs(first[1] - second[1])
            adjacent = (
                max(row_distance, col_distance) == 1
                if diagonal
                else row_distance + col_distance == 1
            )
            if not adjacent:
                valid = False
                break
        if valid:
            result.add(values)
    return result


def _kakuro_2x2() -> Kakuro:
    white = tuple(product(range(2), repeat=2))
    runs = (
        (3, ((0, 0), (0, 1))),
        (3, ((1, 0), (1, 1))),
        (3, ((0, 0), (1, 0))),
        (3, ((0, 1), (1, 1))),
    )
    grid = Kakuro(2, 2, white, runs)
    grid.load_key_values({(0, 0): 1})
    return grid


def _kakuro_oracle(grid: Kakuro) -> set[tuple[int, ...]]:
    result: set[tuple[int, ...]] = set()
    for values in product(range(1, 10), repeat=grid.len):
        keyed = grid.values_by_key(values)
        if keyed[(0, 0)] != 1:
            continue
        if all(
            sum(keyed[cell] for cell in run.cells) == run.target
            and len({keyed[cell] for cell in run.cells}) == len(run.cells)
            for run in grid.runs
        ):
            result.add(values)
    return result


def _slitherlink_oracle(grid: Slitherlink) -> set[tuple[int, ...]]:
    result: set[tuple[int, ...]] = set()
    for values in product((grid.OFF, grid.ON), repeat=grid.len):
        keyed = grid.values_by_key(values)
        selected_cells = {
            cell
            for cell, value in enumerate(values)
            if value == grid.ON
        }
        if not selected_cells:
            continue

        clue_ok = True
        for row in range(grid.board_rows):
            for col in range(grid.board_cols):
                clue = grid.clues[row][col]
                if clue is None:
                    continue
                edges = (
                    ("H", row, col),
                    ("H", row + 1, col),
                    ("V", row, col),
                    ("V", row, col + 1),
                )
                if sum(keyed[edge] == grid.ON for edge in edges) != clue:
                    clue_ok = False
                    break
            if not clue_ok:
                break
        if not clue_ok:
            continue

        edges_by_vertex: dict[int, list[int]] = {}
        for cell in selected_cells:
            for vertex in grid.edge_endpoints[cell]:
                edges_by_vertex.setdefault(vertex, []).append(cell)
        if any(len(edges) != 2 for edges in edges_by_vertex.values()):
            continue

        remaining = set(selected_cells)
        stack = [remaining.pop()]
        seen = set(stack)
        while stack:
            cell = stack.pop()
            for vertex in grid.edge_endpoints[cell]:
                for neighbour in edges_by_vertex[vertex]:
                    if neighbour not in seen:
                        seen.add(neighbour)
                        remaining.discard(neighbour)
                        stack.append(neighbour)
        if not remaining:
            result.add(values)
    return result


def test_numbrix_matches_independent_2x2_oracle():
    grid = Numbrix.from_board(((1, 0), (4, 0)))

    expected = _path_oracle(
        2,
        2,
        diagonal=False,
        givens={(0, 0): 1, (1, 0): 4},
    )
    actual = {tuple(solution) for solution in solver.solve(grid)}

    assert expected == {(1, 2, 4, 3)}
    assert actual == expected


def test_hidato_uses_diagonal_adjacency_but_numbrix_does_not():
    board = ((1, 0), (0, 2))

    assert solver.solve(Hidato.from_board(board))
    assert not solver.solve(Numbrix.from_board(board))


def test_path_inputs_reject_duplicates_non_integral_and_disconnected_boards():
    with pytest.raises(ValueError, match="Duplicate path clue"):
        Hidato.from_board(((1, 1), (0, 0)))
    with pytest.raises(TypeError, match="integer"):
        Hidato.from_board(((1.5,),))
    with pytest.raises(ValueError, match="connected"):
        Hidato.from_board(
            (
                (1, "B", "B"),
                ("B", "B", "B"),
                ("B", "B", 2),
            )
        )


def test_numbrix_distance_parity_rejects_impossible_fixed_clues():
    grid = Numbrix.from_board(
        (
            (1, 0, 0),
            (0, 0, 0),
            (4, 0, 0),
        )
    )
    rule = next(
        rule
        for rule in grid.rules
        if isinstance(rule, ConsecutiveAdjacencyRule)
    )

    with pytest.raises(InvalidGrid):
        rule.apply(grid._known, grid._candidates)


def test_kakuro_matches_independent_small_oracle():
    grid = _kakuro_2x2()

    expected = _kakuro_oracle(grid)
    actual = {tuple(solution) for solution in solver.solve(grid)}

    assert expected == {(1, 2, 2, 1)}
    assert actual == expected


@pytest.mark.parametrize(
    ("runs", "message"),
    (
        (
            (
                (3, ((0, 0), (1, 1))),
                (3, ((0, 0), (1, 0))),
                (3, ((0, 1), (1, 1))),
            ),
            "straight",
        ),
        (
            (
                (2, ((0, 0), (0, 1))),
                (3, ((1, 0), (1, 1))),
                (3, ((0, 0), (1, 0))),
                (3, ((0, 1), (1, 1))),
            ),
            "impossible",
        ),
    ),
)
def test_kakuro_rejects_invalid_run_geometry_and_targets(runs, message):
    with pytest.raises(ValueError, match=message):
        Kakuro(
            2,
            2,
            tuple(product(range(2), repeat=2)),
            runs,
        )


def test_kakuro_requires_one_run_of_each_orientation_per_cell():
    white = tuple(product(range(2), range(3)))
    runs = (
        (6, ((0, 0), (0, 1), (0, 2))),
        (6, ((1, 0), (1, 1), (1, 2))),
        (3, ((0, 0), (1, 0))),
        (4, ((0, 1), (1, 1))),
    )

    with pytest.raises(ValueError, match="exactly one horizontal"):
        Kakuro(2, 3, white, runs)


def test_slitherlink_matches_independent_1x2_oracle():
    grid = Slitherlink(((None, None),))

    expected = _slitherlink_oracle(grid)
    actual = {tuple(solution) for solution in solver.solve(grid)}

    assert len(expected) == 3
    assert actual == expected


def test_slitherlink_clue_four_has_the_perimeter_loop():
    grid = Slitherlink(((4,),))

    solutions = solver.solve(grid)

    assert len(solutions) == 1
    solution = next(iter(solutions))
    assert grid.selected_edges(solution) == frozenset(grid.cell_to_key)


def test_slitherlink_strict_clue_parsing_and_tatham_decoding():
    with pytest.raises(TypeError, match="must be an integer"):
        Slitherlink(((2.5,),))
    decoded = Slitherlink.from_tatham(1, 3, "1a2")
    assert decoded.clues == ((1, None, 2),)


def test_single_loop_removes_edges_that_cannot_belong_to_any_cycle():
    grid = Grid(1, 4, max_elem=2)
    rule = SingleLoopRule(
        grid,
        cells=range(4),
        endpoints=((0, 1), (1, 2), (2, 0), (2, 3)),
    )

    rule.apply(grid._known, grid._candidates)

    assert grid._candidates[3] == {1}
    assert all(2 in grid._candidates[cell] for cell in range(3))


def test_single_loop_rejects_two_selected_cycles():
    grid = Grid(1, 6, max_elem=2)
    for candidates in grid._candidates:
        candidates.intersection_update((2,))
    rule = SingleLoopRule(
        grid,
        cells=range(6),
        endpoints=(
            (0, 1),
            (1, 2),
            (2, 0),
            (3, 4),
            (4, 5),
            (5, 3),
        ),
    )

    with pytest.raises(InvalidGrid):
        rule.apply(grid._known, grid._candidates)


def test_compact_grids_do_not_enter_sudoku_power_techniques(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Sudoku-only technique ran on a compact grid")

    monkeypatch.setattr(atomic_solver, "locked_candidate", unexpected)
    grid = Numbrix.from_board(((0, 0), (0, 0)))

    assert solver.solve(grid, max_sols=1)


def test_compact_solution_logging_uses_the_puzzle_renderer(monkeypatch):
    grid = Numbrix.from_board(((1, 0), (4, 0)))
    solution = next(iter(solver.solve(grid)))
    messages: list[str] = []

    monkeypatch.setattr(
        solver._lg,
        "logs",
        lambda level, message, **kwargs: messages.append(message),
    )
    monkeypatch.setattr(
        solver._lg,
        "logg",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("rectangular logger should not render CompactGrid")
        ),
    )

    solver._log_solution(grid, solution)

    assert messages == [grid.format_solution(solution)]


def test_normal_file_loader_detects_csp_rules_clp(tmp_path):
    path = tmp_path / "one.clp"
    path.write_text(
        "(solve\n1 1\n4\n)\n",
        encoding="utf-8",
    )

    grid = create_from_file(path)

    assert isinstance(grid, Slitherlink)
    assert grid.clues == ((4,),)


def test_normal_string_loader_detects_csp_rules_form():
    text = "(solve Numbrix topological 2 4 1 . 4 .)"

    assert is_csp_rules_text(text)
    grid = create_from_str(text)

    assert isinstance(grid, Numbrix)


@pytest.mark.parametrize(
    ("relative_path", "expected_type"),
    (
        (
            "Examples/Hidato/Mebane/Mebane-III.1-S.clp",
            Hidato,
        ),
        (
            "Examples/Numbrix/Parade/2012-10-21-Expert-S2.clp",
            Numbrix,
        ),
        (
            "Examples/Kakuro/ATK/10x10-E81712.clp",
            Kakuro,
        ),
        (
            "Examples/Slitherlink/Tatham/H7x7-L10-W5.clp",
            Slitherlink,
        ),
    ),
)
def test_representative_retained_corpora_parse(relative_path, expected_type):
    grid = create_from_csp_rules_file(_REPO_ROOT / relative_path)

    assert isinstance(grid, expected_type)


def test_csp_rules_parser_rejects_malformed_forms():
    with pytest.raises(ValueError, match="no solve form"):
        create_from_csp_rules("not a puzzle")
    with pytest.raises(ValueError, match="not closed"):
        create_from_csp_rules("(solve 1 1 .")



def test_kakuro_rejects_adjacent_nonmaximal_runs():
    white = tuple(product(range(2), range(4)))
    runs = (
        (3, ((0, 0), (0, 1))),
        (7, ((0, 2), (0, 3))),
        (10, ((1, 0), (1, 1), (1, 2), (1, 3))),
        (3, ((0, 0), (1, 0))),
        (4, ((0, 1), (1, 1))),
        (5, ((0, 2), (1, 2))),
        (6, ((0, 3), (1, 3))),
    )

    with pytest.raises(ValueError, match="maximal"):
        Kakuro(2, 4, white, runs)


def test_layered_path_pruning_preserves_every_oracle_completion():
    grid = Numbrix.from_board(((0, 0, 0), (0, 0, 0)))
    completions = sorted(
        _path_oracle(2, 3, diagonal=False, givens={})
    )[:4]
    assert completions
    for cell, possible in enumerate(grid._candidates):
        possible.intersection_update(
            {completion[cell] for completion in completions}
        )

    rule = next(
        rule
        for rule in grid.rules
        if isinstance(rule, ConsecutiveAdjacencyRule)
    )
    rule.apply(grid._known, grid._candidates)

    for completion in completions:
        assert all(
            value in grid._candidates[cell]
            for cell, value in enumerate(completion)
        )


def test_single_loop_rejects_selected_edges_in_distinct_cycle_blocks():
    grid = Grid(1, 6, max_elem=2)
    grid._candidates[0].intersection_update((2,))
    grid._candidates[3].intersection_update((2,))
    rule = SingleLoopRule(
        grid,
        cells=range(6),
        endpoints=(
            (0, 1),
            (1, 2),
            (2, 0),
            (0, 3),
            (3, 4),
            (4, 0),
        ),
    )

    with pytest.raises(InvalidGrid):
        rule.apply(grid._known, grid._candidates)


def test_compact_profiles_keep_generic_actions_but_exclude_sudoku_patterns(
    monkeypatch,
):
    calls: list[str] = []

    def generic(grid):
        calls.append("generic")

    def sudoku_only(*args, **kwargs):
        raise AssertionError("Sudoku-only action ran under a generic profile")

    monkeypatch.setattr(atomic_solver, "rulehelper_atmostonce", generic)
    monkeypatch.setattr(atomic_solver, "locked_candidate", sudoku_only)
    kakuro = _kakuro_2x2()
    actions = atomic_solver.AtomicSolver(kakuro, [0], set())._solve_power_actions()

    assert next(actions) == "rulehelper_atmostonce"
    assert calls == ["generic"]
    assert kakuro.technique_profile is TechniqueProfile.GENERIC

    hidato = Hidato.from_board(((0, 0), (0, 0)))
    numbrix = Numbrix.from_board(((0, 0), (0, 0)))
    slitherlink = Slitherlink(((None,),))
    for grid in (hidato, numbrix, slitherlink):
        assert grid.technique_profile is TechniqueProfile.RULES_ONLY
        assert list(
            atomic_solver.AtomicSolver(grid, [0], set())._solve_power_actions()
        ) == []


def test_cli_file_route_renders_compact_solution(tmp_path, capsys):
    path = tmp_path / "one.clp"
    path.write_text("(solve 1 1 4)\n", encoding="utf-8")

    assert run_cli.main(
        (
            "--file",
            str(path),
            "--colour",
            "No",
            "--max-solutions",
            "1",
        )
    ) == 0

    output = capsys.readouterr().out
    assert "+---+" in output
    assert "Took" in output
