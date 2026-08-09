"""Replace optimization-sensitive production assertions with real checks."""

from pathlib import Path


def lines(*parts: str) -> str:
    return "".join(part + "\n" for part in parts)


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected one marker, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


fish_path = Path("gridsolver/solver/solve_fish.py")
text = fish_path.read_text(encoding="utf-8")
text = text.replace(
    "import itertools\n",
    "import itertools\nfrom numbers import Integral\n",
    1,
)
helper_marker = "# todo endo fins\n\n\n"
helper = lines(
    "# todo endo fins",
    "",
    "",
    "def _fish_size(max_fish: object) -> int:",
    "    if isinstance(max_fish, bool) or not isinstance(max_fish, Integral):",
    "        raise TypeError(\"max_fish must be an integer\")",
    "    max_fish = int(max_fish)",
    "    if max_fish < 2:",
    "        raise ValueError(\"max_fish must be at least 2\")",
    "    return max_fish",
    "",
    "",
)
if text.count(helper_marker) != 1:
    raise SystemExit("solve_fish helper marker changed")
text = text.replace(helper_marker, helper, 1)
assertion = "    assert max_fish >= 2\n"
if text.count(assertion) != 2:
    raise SystemExit(f"fish assertion count: {text.count(assertion)}")
text = text.replace(assertion, "    max_fish = _fish_size(max_fish)\n")
fish_path.write_text(text, encoding="utf-8")

replace_once(
    Path("gridsolver/solver/solve_chain.py"),
    "        assert len(key_l) == 2\n",
    lines(
        "        if len(key_l) != 2:",
        "            raise RuntimeError(",
        "                \"Bivalue candidate group did not contain two values\"",
        "            )",
    ),
)

replace_once(
    Path("gridsolver/rules/sumrules.py"),
    "    assert len(vals) == k, (values, k)\n",
    lines(
        "    if len(vals) != k:",
        "        raise ValueError(",
        "            \"Expected one candidate set for every assignment value\"",
        "        )",
    ),
)


tests = Path("tests/test_hardening.py")
test_text = tests.read_text(encoding="utf-8")
if not test_text.startswith("from itertools import permutations, product\n"):
    raise SystemExit("test_hardening import header changed")
test_text = test_text.replace(
    "from itertools import permutations, product\n",
    "import ast\nfrom itertools import permutations, product\nfrom pathlib import Path\n",
    1,
)
fish_import = "from gridsolver.solver.solve_fish import finned_fish, fish\n"
solver_import = "from gridsolver.solver import solver\n"
if fish_import not in test_text:
    if test_text.count(solver_import) != 1:
        raise SystemExit("test_hardening solver import marker changed")
    test_text = test_text.replace(solver_import, solver_import + fish_import, 1)

appendix = '''


@pytest.mark.parametrize("action", (fish, finned_fish))
def test_fish_size_is_validated_without_assertions(action):
    grid = Grid(1)

    with pytest.raises(TypeError, match="max_fish must be an integer"):
        action(grid, True)
    with pytest.raises(TypeError, match="max_fish must be an integer"):
        action(grid, 2.5)
    with pytest.raises(ValueError, match="max_fish must be at least 2"):
        action(grid, 1)


def test_production_sources_do_not_use_optimization_sensitive_assertions():
    root = Path(__file__).resolve().parents[1] / "gridsolver"
    violations = []

    for path in root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        violations.extend(
            f"{path.relative_to(root.parent)}:{node.lineno}"
            for node in ast.walk(tree)
            if isinstance(node, ast.Assert)
        )

    assert not violations, (
        "Production correctness checks must not disappear under python -O; "
        f"replace assertions with explicit exceptions: {violations}"
    )
'''
if "test_production_sources_do_not_use_optimization_sensitive_assertions" in test_text:
    raise SystemExit("production assertion guard already exists")
tests.write_text(test_text.rstrip() + appendix, encoding="utf-8")
