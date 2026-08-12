import ast
import inspect
import textwrap
from pathlib import Path

from gridsolver.rules import rules as rules_module
from gridsolver.rules import sumrules, topology, uneq, unique
from gridsolver.rules.rules import Rule

_TESTS_DIR = Path(__file__).resolve().parent


def _apply_reads_guarantees(method) -> bool:
    """Return whether an apply body loads its ``guarantees`` argument.

    Parsing the AST avoids false positives from annotations, comments, and the
    parameter declaration itself. Nested statements are included because a
    closure that reads the argument still makes the rule a guarantee consumer.
    """
    source = textwrap.dedent(inspect.getsource(method))
    tree = ast.parse(source)
    function = next(
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    )
    return any(
        isinstance(node, ast.Name)
        and isinstance(node.ctx, ast.Load)
        and node.id == "guarantees"
        for statement in function.body
        for node in ast.walk(statement)
    )


def test_uses_guarantees_flag_matches_apply_bodies():
    modules = (rules_module, sumrules, topology, uneq, unique)
    classes: set[type[Rule]] = set()

    for module in modules:
        for _, rule_class in inspect.getmembers(module, inspect.isclass):
            if (
                rule_class.__module__ == module.__name__
                and issubclass(rule_class, Rule)
                and "apply" in rule_class.__dict__
            ):
                classes.add(rule_class)

    assert len(classes) >= 8
    for rule_class in classes:
        reads_guarantees = _apply_reads_guarantees(rule_class.__dict__["apply"])
        assert not reads_guarantees or rule_class.uses_guarantees, (
            f"{rule_class.__name__}.apply reads guarantees but "
            "uses_guarantees is False"
        )


# Per-push CI runs `pytest tests -m "not slow"`, so a slow-marked test runs
# ONLY where an extended-CI job selects it explicitly. These allowlists mirror
# .github/workflows/extended.yml: module-marked files run in supported-corpus,
# and each function-marked node has a dedicated job. Adding a slow marker
# without wiring an extended job would silently drop the test from all CI —
# extend the workflow first, then update the expected sets here.
_EXPECTED_MODULE_SLOW_FILES = {
    "test_examples_1.py",
    "test_examples_futoshiki.py",
    "test_examples_kenken.py",
    "test_examples_killer.py",
    "test_examples_sudoku1.py",
    "test_examples_sudoku2.py",
}
_EXPECTED_FUNCTION_SLOW_NODES = {
    ("test_basic.py", "test_parallel_trials_match_sequential"),
    ("test_examples_lsq.py", "test_ex_diag_latin_squares"),
}


def _mentions_slow_marker(expression: ast.expr) -> bool:
    return any(
        isinstance(node, ast.Attribute) and node.attr == "slow"
        for node in ast.walk(expression)
    )


def _assigns_slow_pytestmark(node: ast.AST) -> bool:
    """Match every legal pytestmark spelling: =, :=-style AnnAssign, +=."""
    if isinstance(node, ast.Assign):
        targets = node.targets
        value = node.value
    elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        targets = [node.target]
        value = node.value
    else:
        return False
    if value is None:
        return False
    return any(
        isinstance(target, ast.Name) and target.id == "pytestmark"
        for target in targets
    ) and _mentions_slow_marker(value)


def test_every_slow_marker_is_covered_by_an_extended_ci_job():
    module_marked: set[str] = set()
    function_marked: set[tuple[str, str]] = set()

    # rglob: pytest collects tests/ recursively, so the guard must too
    for path in sorted(_TESTS_DIR.rglob("test_*.py")):
        name = path.relative_to(_TESTS_DIR).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"))
        # ast.walk also catches class-level pytestmark assignments
        for node in ast.walk(tree):
            if _assigns_slow_pytestmark(node):
                module_marked.add(name)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if any(
                    _mentions_slow_marker(decorator)
                    for decorator in node.decorator_list
                ):
                    function_marked.add((name, node.name))

    assert module_marked == _EXPECTED_MODULE_SLOW_FILES, (
        "Module-level slow markers changed; wire the file into an extended-CI "
        f"job and update the allowlist. Found: {sorted(module_marked)}"
    )
    assert function_marked == _EXPECTED_FUNCTION_SLOW_NODES, (
        "Function-level slow markers changed; wire the node into an "
        "extended-CI job and update the allowlist. Found: "
        f"{sorted(function_marked)}"
    )
