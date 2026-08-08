import ast
import inspect
import textwrap

from gridsolver.rules import rules as rules_module
from gridsolver.rules import sumrules, uneq, unique
from gridsolver.rules.rules import Rule


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
    modules = (rules_module, sumrules, uneq, unique)
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
