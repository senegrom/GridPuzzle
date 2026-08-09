"""Apply the lazy chain-diagnostic candidate and add its regression guard."""

from pathlib import Path


SOURCE = Path("gridsolver/solver/solve_chain.py")
TEST = Path("tests/test_chain_logging_overhead.py")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    return text.replace(old, new, 1)


text = SOURCE.read_text(encoding="utf-8")
coord_marker = "    cs = CoordToString(grid.rows)\n"
if text.count(coord_marker) != 3:
    raise SystemExit(
        f"coordinate formatter marker: expected 3, found {text.count(coord_marker)}"
    )
text = text.replace(
    coord_marker,
    "    log_enabled = _lg.on\n"
    "    cs = CoordToString(grid.rows) if log_enabled else None\n",
)

text = replace_once(
    text,
    '''                    if le == cell and val in cands[cell]:
                        chain = _compute_chain(le, weak_dic, strg_dic, True)
                        _lg.on and _lg.logr("LoopW",
                                 f"{val} removed from {set(key)} w/ loop {cs(chain)} ", cs(cell))
                        cands[cell].discard(val)
''',
    '''                    if le == cell and val in cands[cell]:
                        if log_enabled:
                            chain = _compute_chain(le, weak_dic, strg_dic, True)
                            _lg.logr(
                                "LoopW",
                                f"{val} removed from {set(key)} "
                                f"w/ loop {cs(chain)} ",
                                cs(cell),
                            )
                        cands[cell].discard(val)
''',
    "W-loop logging",
)
text = replace_once(
    text,
    '''                        if other_val in cands[nb]:
                            chain = _compute_chain(le, weak_dic, strg_dic, True)
                            _lg.on and _lg.logr("WingW",
                                     f"{other_val} removed from {set(key)} w/ wing {cs(chain)}", cs(nb))
                            cands[nb].remove(other_val)
''',
    '''                        if other_val in cands[nb]:
                            if log_enabled:
                                chain = _compute_chain(
                                    le, weak_dic, strg_dic, True
                                )
                                _lg.logr(
                                    "WingW",
                                    f"{other_val} removed from {set(key)} "
                                    f"w/ wing {cs(chain)}",
                                    cs(nb),
                                )
                            cands[nb].remove(other_val)
''',
    "W-wing logging",
)
text = replace_once(
    text,
    '''                if le == cell:
                    chain = _compute_chain(le, weak_dic, strg_dic, False)
                    _lg.on and _lg.logr("LoopX",
                             f"all but {val} removed from {set(cd)} w/ loop {cs(chain)}", cs(cell))
                    cd.intersection_update((val,))
''',
    '''                if le == cell:
                    if log_enabled:
                        chain = _compute_chain(le, weak_dic, strg_dic, False)
                        _lg.logr(
                            "LoopX",
                            f"all but {val} removed from {set(cd)} "
                            f"w/ loop {cs(chain)}",
                            cs(cell),
                        )
                    cd.intersection_update((val,))
''',
    "X-loop logging",
)
text = replace_once(
    text,
    '''                    if val in cands[nb]:
                        chain = _compute_chain(le, weak_dic, strg_dic, False)
                        _lg.on and _lg.logr("ChainX",
                                 f"{val} removed from {set(cands[nb])} w/ chain {cs(chain)}", cs(nb))
                        cands[nb].remove(val)
''',
    '''                    if val in cands[nb]:
                        if log_enabled:
                            chain = _compute_chain(
                                le, weak_dic, strg_dic, False
                            )
                            _lg.logr(
                                "ChainX",
                                f"{val} removed from {set(cands[nb])} "
                                f"w/ chain {cs(chain)}",
                                cs(nb),
                            )
                        cands[nb].remove(val)
''',
    "X-chain logging",
)
text = replace_once(
    text,
    '''                if le == start_cell:
                    _lg.on and _lg.logr("LoopXY",
                             f"all but {val} removed from {set(cd)} w/ loop {cs(start_cell)}", cs(start_cell))
                    cd.intersection_update((val,))
''',
    '''                if le == start_cell:
                    if log_enabled:
                        _lg.logr(
                            "LoopXY",
                            f"all but {val} removed from {set(cd)} "
                            f"w/ loop {cs(start_cell)}",
                            cs(start_cell),
                        )
                    cd.intersection_update((val,))
''',
    "XY-loop logging",
)
text = replace_once(
    text,
    '''                    if val in cands[nb]:
                        _lg.on and _lg.logr("ChainXY",
                                 f"{val} removed from {cands[nb]} w/ chain {cs(start_cell)}..{cs(le)}", cs(nb))
                        cands[nb].remove(val)
''',
    '''                    if val in cands[nb]:
                        if log_enabled:
                            _lg.logr(
                                "ChainXY",
                                f"{val} removed from {cands[nb]} "
                                f"w/ chain {cs(start_cell)}..{cs(le)}",
                                cs(nb),
                            )
                        cands[nb].remove(val)
''',
    "XY-chain logging",
)
SOURCE.write_text(text, encoding="utf-8")

TEST.write_text(
    '''import ast
from pathlib import Path


def test_chain_diagnostic_reconstruction_is_guarded_by_visible_logging():
    path = (
        Path(__file__).resolve().parents[1]
        / "gridsolver/solver/solve_chain.py"
    )
    tree = ast.parse(path.read_text(encoding="utf-8"))
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent

    formatter_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"CoordToString", "_compute_chain"}
    ]
    assert formatter_calls

    for call in formatter_calls:
        if isinstance(call.func, ast.Name) and call.func.id == "CoordToString":
            parent = parents[call]
            assert isinstance(parent, ast.IfExp)
            assert isinstance(parent.test, ast.Name)
            assert parent.test.id == "log_enabled"
            continue

        node: ast.AST | None = call
        while node is not None and not isinstance(node, ast.FunctionDef):
            node = parents.get(node)
            if (
                isinstance(node, ast.If)
                and isinstance(node.test, ast.Name)
                and node.test.id == "log_enabled"
            ):
                break
        else:
            raise AssertionError(
                f"unguarded diagnostic chain reconstruction at line {call.lineno}"
            )


def test_each_chain_technique_samples_logging_once():
    path = (
        Path(__file__).resolve().parents[1]
        / "gridsolver/solver/solve_chain.py"
    )
    tree = ast.parse(path.read_text(encoding="utf-8"))
    functions = {
        node.name: node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
    }
    for name in ("w_wing", "x_chain", "xy_chain"):
        function = functions[name]
        assignments = [
            node
            for node in ast.walk(function)
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "log_enabled"
                for target in node.targets
            )
        ]
        assert len(assignments) == 1
''',
    encoding="utf-8",
)
