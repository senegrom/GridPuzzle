"""Align profile tests with measured family defaults."""

from pathlib import Path

path = Path("tests/test_new_puzzle_families.py")
text = path.read_text(encoding="utf-8")
old = '''    grid = Numbrix.from_board(((0, 0), (0, 0)))
    actions = atomic_solver.AtomicSolver(grid, [0], set())._solve_power_actions()

    assert next(actions) == "rulehelper_atmostonce"
    assert calls == ["generic"]
    assert grid.technique_profile is TechniqueProfile.GENERIC

    slitherlink = Slitherlink(((None,),))
    assert slitherlink.technique_profile is TechniqueProfile.RULES_ONLY
    assert list(
        atomic_solver.AtomicSolver(slitherlink, [0], set())._solve_power_actions()
    ) == []
'''
new = '''    hidato = Hidato.from_board(((0, 0), (0, 0)))
    actions = atomic_solver.AtomicSolver(hidato, [0], set())._solve_power_actions()

    assert next(actions) == "rulehelper_atmostonce"
    assert calls == ["generic"]
    assert hidato.technique_profile is TechniqueProfile.GENERIC

    numbrix = Numbrix.from_board(((0, 0), (0, 0)))
    slitherlink = Slitherlink(((None,),))
    for grid in (numbrix, slitherlink):
        assert grid.technique_profile is TechniqueProfile.RULES_ONLY
        assert list(
            atomic_solver.AtomicSolver(grid, [0], set())._solve_power_actions()
        ) == []
'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one profile test block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
