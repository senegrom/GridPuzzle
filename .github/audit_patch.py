from __future__ import annotations

import ast
from pathlib import Path

REPO = Path.cwd()


def line_offsets(text: str) -> list[int]:
    offsets = [0]
    for line in text.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    return offsets


def node_start(text: str, node: ast.AST) -> int:
    return line_offsets(text)[node.lineno - 1] + node.col_offset


def node_end(text: str, node: ast.AST) -> int:
    return line_offsets(text)[node.end_lineno - 1] + node.end_col_offset


def ensure_field_import(text: str) -> str:
    if "from dataclasses import dataclass, field" in text:
        return text
    if "from dataclasses import dataclass\n" in text:
        return text.replace(
            "from dataclasses import dataclass\n",
            "from dataclasses import dataclass, field\n",
            1,
        )
    raise SystemExit("expected dataclass import")


def add_owner_to_analysis(path: Path, class_name: str) -> None:
    text = path.read_text(encoding="utf-8")
    if "_source_grid:" in text and "def validate_for(" in text:
        return
    text = ensure_field_import(text)
    tree = ast.parse(text)
    cls = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == class_name
    )
    methods = [
        node
        for node in cls.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    first_method = min(
        methods,
        key=lambda node: min(
            [node.lineno, *[decorator.lineno for decorator in node.decorator_list]]
        ),
    )
    insert_line = min(
        [
            first_method.lineno,
            *[decorator.lineno for decorator in first_method.decorator_list],
        ]
    )
    block = (
        "    _source_grid: Grid = field(\n"
        "        repr=False,\n"
        "        compare=False,\n"
        "        kw_only=True,\n"
        "    )\n\n"
        "    def validate_for(self, grid: Grid) -> None:\n"
        "        \"\"\"Reject a snapshot built from a different mutable grid.\"\"\"\n"
        "        if self._source_grid is not grid:\n"
        "            raise ValueError(\n"
        f"                \"{class_name} was built for a different grid\"\n"
        "            )\n\n"
    )
    lines = text.splitlines(keepends=True)
    lines.insert(insert_line - 1, block)
    text = "".join(lines)

    tree = ast.parse(text)
    cls = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == class_name
    )
    build = next(
        node
        for node in cls.body
        if isinstance(node, ast.FunctionDef) and node.name == "build"
    )
    calls = [
        node
        for node in ast.walk(build)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"cls", class_name}
    ]
    if len(calls) != 1:
        raise SystemExit(
            f"{path}: expected one {class_name} constructor in build, got {len(calls)}"
        )
    call = calls[0]
    close = line_offsets(text)[call.end_lineno - 1] + call.end_col_offset - 1
    if text[close] != ")":
        raise SystemExit(f"{path}: unexpected constructor closing token")
    if call.lineno == call.end_lineno:
        insertion = ", _source_grid=grid"
    else:
        close_line = text.splitlines()[call.end_lineno - 1]
        close_indent = close_line[: len(close_line) - len(close_line.lstrip())]
        insertion = "    _source_grid=grid,\n" + close_indent
    text = text[:close] + insertion + text[close:]
    path.write_text(text, encoding="utf-8")


def add_validation_calls(class_name: str) -> None:
    for path in (REPO / "gridsolver").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if class_name not in text or "def " not in text:
            continue
        tree = ast.parse(text)
        insertions: list[tuple[int, str]] = []
        for function in [
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ]:
            args = [
                *function.args.posonlyargs,
                *function.args.args,
                *function.args.kwonlyargs,
            ]
            matches = [
                argument.arg
                for argument in args
                if argument.annotation is not None
                and class_name in ast.unparse(argument.annotation)
            ]
            if not matches or not any(argument.arg == "grid" for argument in args):
                continue
            source = ast.get_source_segment(text, function) or ""
            if ".validate_for(grid)" in source or function.name == "validate_for":
                continue
            body_index = 0
            if (
                function.body
                and isinstance(function.body[0], ast.Expr)
                and isinstance(function.body[0].value, ast.Constant)
                and isinstance(function.body[0].value.value, str)
            ):
                body_index = 1
            line = (
                function.body[body_index].lineno
                if body_index < len(function.body)
                else function.end_lineno
            )
            line_text = text.splitlines()[line - 1]
            indent = line_text[: len(line_text) - len(line_text.lstrip())]
            block = "".join(
                f"{indent}if {name} is not None:\n"
                f"{indent}    {name}.validate_for(grid)\n"
                for name in matches
            )
            insertions.append((line_offsets(text)[line - 1], block))
        for offset, block in sorted(insertions, reverse=True):
            text = text[:offset] + block + text[offset:]
        if insertions:
            path.write_text(text, encoding="utf-8")


def patch_capped_branching() -> None:
    path = REPO / "gridsolver/solver/solver.py"
    text = path.read_text(encoding="utf-8")
    old_signature = """def _atomic_pass_or_branches(
    grid: Grid,
    steps: list[int],
    hidden_pair_checked_gts: set[Guarantee],
) -> tuple[set[ImmutableGrid] | None, list[tuple[int, int]], bool]:
"""
    new_signature = """def _atomic_pass_or_branches(
    grid: Grid,
    steps: list[int],
    hidden_pair_checked_gts: set[Guarantee],
    *,
    allow_overlapping_guarantee_branches: bool = True,
) -> tuple[set[ImmutableGrid] | None, list[tuple[int, int]], bool]:
"""
    if text.count(old_signature) != 1:
        raise SystemExit("unexpected _atomic_pass_or_branches signature")
    text = text.replace(old_signature, new_signature, 1)

    old_condition = "    if guarantee is not None and len(guarantee.cells) < len(values):\n"
    new_condition = """    # At-least-one guarantee branches overlap when the value can occur in
    # several cells. A positive cap must use disjoint cell-value branches so
    # branch-local limits cannot be consumed by duplicate solutions.
    if (
        allow_overlapping_guarantee_branches
        and guarantee is not None
        and len(guarantee.cells) < len(values)
    ):
"""
    if text.count(old_condition) != 1:
        raise SystemExit("unexpected guarantee branch condition")
    text = text.replace(old_condition, new_condition, 1)

    for marker, needle in (
        ("def _solve_top_parallel(", "        set(),\n"),
        ("def _solve_full(", "        hidden_pair_checked_gts,\n"),
    ):
        start = text.index(marker)
        call = text.index("    settled, branches, ", start)
        end = text.index("\n    )", call) + len("\n    )")
        block = text[call:end]
        if "allow_overlapping_guarantee_branches" not in block:
            if needle not in block:
                raise SystemExit(f"call-site anchor missing in {marker}")
            block = block.replace(
                needle,
                needle
                + "        allow_overlapping_guarantee_branches=max_sols == -1,\n",
                1,
            )
            text = text[:call] + block + text[end:]
    path.write_text(text, encoding="utf-8")


def patch_extension_transactions() -> None:
    path = REPO / "gridsolver/solver/propagation.py"
    text = path.read_text(encoding="utf-8")
    if "_validated_extension_rule_state" in text:
        return
    if "from gridsolver.rules.rules import (\n" in text:
        text = text.replace(
            "from gridsolver.rules.rules import (\n",
            "from gridsolver.rules.rules import (\n    InvalidGrid,\n    Rule,\n",
            1,
        )
    else:
        text = "from gridsolver.rules.rules import InvalidGrid, Rule\n" + text

    tree = ast.parse(text)
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "apply_rules"
    )
    start = node_start(text, function)
    end = node_end(text, function)
    helpers = '''def _validated_extension_rule_state(
    grid: Grid,
    known_view: list[int],
    candidate_views: tuple[set[int], ...],
) -> tuple[tuple[int, ...], tuple[frozenset[int], ...]]:
    """Validate detached extension mutations without touching the live grid."""
    if len(known_view) != grid.len or len(candidate_views) != grid.len:
        raise ValueError("rule extension changed the grid state length")

    normalized_candidates: list[frozenset[int]] = []
    for cell, values in enumerate(candidate_views):
        try:
            normalized = frozenset(values)
        except TypeError as exc:
            raise TypeError(
                f"rule extension candidates for cell {cell} must be iterable"
            ) from exc
        if any(type(value) is not int for value in normalized):
            raise TypeError("rule extension candidates must be integers")
        if any(value < 1 or value > grid.max_elem for value in normalized):
            raise ValueError("rule extension candidate outside the grid domain")
        if not normalized:
            raise InvalidGrid(f"rule extension emptied cell {cell}")
        if not normalized.issubset(grid._candidates[cell]):
            raise ValueError("rule extensions may only remove candidates")
        normalized_candidates.append(normalized)

    normalized_known: list[int] = []
    for cell, value in enumerate(known_view):
        if type(value) is not int:
            raise TypeError("rule extension known values must be integers")
        if value < 0 or value > grid.max_elem:
            raise ValueError("rule extension known value outside the grid domain")
        current = grid._known[cell]
        if current and value != current:
            raise ValueError("rule extension changed an existing known value")
        if value and value not in normalized_candidates[cell]:
            raise InvalidGrid(
                f"rule extension removed its known value from cell {cell}"
            )
        normalized_known.append(value)

    return tuple(normalized_known), tuple(normalized_candidates)


def _commit_extension_rule_state(
    grid: Grid,
    state: tuple[tuple[int, ...], tuple[frozenset[int], ...]],
) -> None:
    """Publish a fully validated detached extension result."""
    known, candidates = state
    for current, narrowed in zip(grid._candidates, candidates, strict=True):
        current.intersection_update(narrowed)
    for cell, value in enumerate(known):
        if value and not grid._known[cell]:
            grid[cell] = value


'''
    replacement = '''def apply_rules(grid: Grid) -> None:
    known = grid._known
    candidates = grid._candidates

    for rule in grid.take_dirty_rules():
        try:
            extension_known: list[int] | None = None
            extension_candidates: tuple[set[int], ...] | None = None
            rule_known = known
            rule_candidates = candidates
            if not type(rule).__module__.startswith("gridsolver."):
                extension_known = list(known)
                extension_candidates = tuple(set(values) for values in candidates)
                rule_known = extension_known
                rule_candidates = extension_candidates

            try:
                refresh, new_rules, new_guarantees = rule.apply(
                    rule_known,
                    rule_candidates,
                    relevant_guarantees(grid, rule),
                )
            except RuleAlwaysSatisfied:
                refresh = True
                new_rules = []
                new_guarantees = None

            prepared_rules = (
                None
                if new_rules is None
                else tuple(
                    grid._validate_rule(new_rule)[0]
                    for new_rule in new_rules
                )
            )
            prepared_guarantees = (
                None
                if new_guarantees is None
                else grid._normalize_guarantees(new_guarantees)
            )
            extension_state = (
                None
                if extension_known is None or extension_candidates is None
                else _validated_extension_rule_state(
                    grid,
                    extension_known,
                    extension_candidates,
                )
            )

            # Structural transitions are already atomic. Publish them before
            # detached candidate changes so a custom hash/equality failure
            # cannot leak candidate reductions.
            if prepared_rules is not None:
                grid.add_rules_checked(prepared_rules)
            if prepared_guarantees is not None:
                grid._add_normalized_gtees(prepared_guarantees)
            if prepared_rules is not None:
                grid.deactivate_rule(rule)

            if extension_state is not None:
                _commit_extension_rule_state(grid, extension_state)
            if refresh:
                update_candidates_from_known(candidates, known)
        except Exception:
            grid._trail_state.dirty.all_rules = True
            raise
'''
    path.write_text(text[:start] + helpers + replacement + text[end:], encoding="utf-8")


def add_tests() -> None:
    ownership = REPO / "tests/test_analysis_ownership.py"
    ownership.write_text(
        '''import pytest

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.solve_aic import alternating_inference_chain
from gridsolver.solver.solve_als import ALSAnalysis, als_xy_wing, als_xz
from gridsolver.solver.solve_empty_rectangle import empty_rectangle
from gridsolver.solver.solve_locked_candidate import locked_candidate
from gridsolver.solver.solve_skyscraper import skyscraper


@pytest.mark.parametrize(
    "consumer",
    (
        locked_candidate,
        skyscraper,
        empty_rectangle,
        alternating_inference_chain,
    ),
)
def test_candidate_topology_rejects_a_different_grid(consumer):
    source = Sudoku(4)
    other = Sudoku(4)
    topology = CandidateTopology.build(source)

    with pytest.raises(ValueError, match="different grid"):
        consumer(other, topology)


def test_als_analysis_rejects_a_different_grid():
    source = Sudoku(4)
    other = Sudoku(4)
    topology = CandidateTopology.build(source)
    analysis = ALSAnalysis.build(source, topology)

    for consumer in (als_xz, als_xy_wing):
        with pytest.raises(ValueError, match="different grid"):
            consumer(other, analysis)
''',
        encoding="utf-8",
    )

    solver_test = REPO / "tests/test_solver_api.py"
    text = solver_test.read_text(encoding="utf-8")
    if "from gridsolver.rules.rules import Guarantee" not in text:
        anchor = "from gridsolver.abstract_grids.immutable_grid import ImmutableGrid\n"
        if anchor not in text:
            raise SystemExit("solver API import anchor missing")
        text = text.replace(
            anchor,
            anchor + "from gridsolver.rules.rules import Guarantee\n",
            1,
        )
    if "test_capped_search_does_not_undercount_overlapping_guarantee_branches" not in text:
        text += '''

def test_capped_search_does_not_undercount_overlapping_guarantee_branches():
    grid = Grid(1, 3, max_elem=3)
    grid.add_gtee_checked(
        Guarantee(1, frozenset({0, 1}), grid.rows, grid.cols)
    )

    exhaustive = solver.solve(grid, max_sols=-1, log_level=-1)
    capped = solver.solve(grid, max_sols=10, log_level=-1)

    assert len(exhaustive) == 15
    assert len(capped) == 10
    assert capped <= exhaustive
'''
    solver_test.write_text(text, encoding="utf-8")

    rule_test = REPO / "tests/test_rule_inputs.py"
    text = rule_test.read_text(encoding="utf-8")
    if "test_failing_extension_rule_does_not_leak_candidate_mutations" not in text:
        text += '''

class _MutateThenFailRule(Rule):
    __slots__ = ()

    def apply(self, known, candidates, guarantees=None):
        candidates[0].discard(1)
        known[1] = 2
        raise RuntimeError("extension failed after mutation")


def test_failing_extension_rule_does_not_leak_candidate_mutations():
    grid = Grid(2)
    rule = _MutateThenFailRule(grid, cells=(0, 1))
    grid.add_rule_checked(rule)
    candidates_before = tuple(frozenset(values) for values in grid._candidates)
    known_before = tuple(grid._known)

    with pytest.raises(RuntimeError, match="failed after mutation"):
        apply_rules(grid)

    assert tuple(frozenset(values) for values in grid._candidates) == candidates_before
    assert tuple(grid._known) == known_before
    assert rule in grid.rules
    assert grid._trail_state.dirty.all_rules


class _MutateThenEmitInvalidRule(Rule):
    __slots__ = ()

    def apply(self, known, candidates, guarantees=None):
        candidates[0].discard(1)
        return False, (object(),), None


def test_invalid_extension_output_does_not_publish_candidate_mutations():
    grid = Grid(2)
    rule = _MutateThenEmitInvalidRule(grid, cells=(0,))
    grid.add_rule_checked(rule)
    before = tuple(frozenset(values) for values in grid._candidates)

    with pytest.raises(TypeError):
        apply_rules(grid)

    assert tuple(frozenset(values) for values in grid._candidates) == before
    assert rule in grid.rules
    assert grid._trail_state.dirty.all_rules
'''
    rule_test.write_text(text, encoding="utf-8")


patch_capped_branching()
add_owner_to_analysis(
    REPO / "gridsolver/solver/candidate_topology.py",
    "CandidateTopology",
)
add_owner_to_analysis(REPO / "gridsolver/solver/solve_als.py", "ALSAnalysis")
add_validation_calls("CandidateTopology")
add_validation_calls("ALSAnalysis")
patch_extension_transactions()
add_tests()
