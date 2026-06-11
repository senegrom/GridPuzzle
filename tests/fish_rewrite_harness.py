"""Equivalence + benchmark harness for the fish rewrite (see FISH_REWRITE.md).

Not collected by pytest — run as a script from the project root:

    python tests/fish_rewrite_harness.py [--quick]

It captures realistic mid-solve grid states (by intercepting the solver's fish
calls on a few example puzzles), then checks that the current fish/finned_fish
produce byte-identical candidate eliminations to the vendored legacy reference
below, and reports timings for both.

The legacy functions are a frozen copy of the pre-rewrite implementation
(inline precompute, no grid-level caching) so the reference cannot drift when
solve_fish.py changes.
"""
import itertools
import sys
import time
from pathlib import Path
from typing import FrozenSet

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import create_from_file, create_from_str
from gridsolver.solver import solver
import gridsolver.solver.atomic_solver as _am
from gridsolver.solver.solve_fish import fish as current_fish, finned_fish as current_finned_fish


# --------------------------------------------------------------------------
# Frozen legacy reference (verbatim pre-rewrite logic, logging stripped)
# --------------------------------------------------------------------------

def _legacy_relevant_urs(grid: Grid, unique_rules, gt_dic):
    relevant_urs_by_val: dict[int, list[FrozenSet[int]]] = {}
    for i in range(1, grid.max_elem + 1):
        gts_for_val = gt_dic[i]
        if not gts_for_val:
            continue
        seen_ids = set()
        rel_list = []
        for ur in unique_rules:
            for gt in gts_for_val:
                if gt <= ur:
                    if id(ur) not in seen_ids:
                        seen_ids.add(id(ur))
                        rel_list.append(ur)
                    break
        if rel_list:
            relevant_urs_by_val[i] = rel_list
    return relevant_urs_by_val


# noinspection PyProtectedMember
def legacy_fish(grid: Grid, max_fish=2) -> None:
    # Semantic reference: the generic combinations branch only (the original
    # f==2 fast path is algorithmically identical, so equality checks are
    # unaffected; timings overstate the current implementation's win at f=2).
    assert max_fish >= 2
    unique_rules = grid.get_rule_cells_of_type(_amo_cls())
    if not unique_rules:
        return
    max_fish = min(max_fish, max(len(ur) for ur in unique_rules) - 1)
    gt_dic = {i: [gt.cells for gt in grid.guarantees if gt.val == i] for i in range(1, grid.max_elem + 1)}
    cands = grid._candidates
    relevant_urs_by_val = _legacy_relevant_urs(grid, unique_rules, gt_dic)

    for f in range(max_fish, 1, -1):
        for i in range(1, grid.max_elem + 1):
            gts_for_val = gt_dic[i]
            if len(gts_for_val) < f:
                continue
            relevant_ur_list = relevant_urs_by_val.get(i, [])
            if len(relevant_ur_list) < f:
                continue
            for urs in itertools.combinations(relevant_ur_list, f):
                all_urs = frozenset().union(*urs)
                my_gt_temp = [gt for gt in gts_for_val if gt <= all_urs]
                if len(my_gt_temp) < f:
                    continue
                for gts in itertools.combinations(my_gt_temp, f):
                    seen = set()
                    disjoint = True
                    for gt in gts:
                        if seen & gt:
                            disjoint = False
                            break
                        seen |= gt
                    if not disjoint:
                        continue
                    all_gts = frozenset(seen)
                    for ur in urs:
                        for cell in ur:
                            if cell not in all_gts:
                                cd = cands[cell]
                                if i in cd:
                                    cd.remove(i)
                    for cell in all_gts:
                        counter = 0
                        for ur in urs:
                            if cell in ur:
                                counter += 1
                            if counter == 2:
                                cd = cands[cell]
                                if i in cd:
                                    cd.remove(i)
                                break


# noinspection PyProtectedMember
def legacy_finned_fish(grid: Grid, max_fish=2) -> None:
    assert max_fish >= 2
    unique_rules = grid.get_rule_cells_of_type(_amo_cls())
    if not unique_rules:
        return
    max_fish = min(max_fish, max(len(ur) for ur in unique_rules) - 1)
    gt_dic = {i: [gt.cells for gt in grid.guarantees if gt.val == i] for i in range(1, grid.max_elem + 1)}
    cands = grid._candidates
    relevant_urs_by_val = _legacy_relevant_urs(grid, unique_rules, gt_dic)

    for f in range(max_fish, 1, -1):
        for i in range(1, grid.max_elem + 1):
            gts_for_val = gt_dic[i]
            if len(gts_for_val) < f:
                continue
            relevant_ur_list = relevant_urs_by_val.get(i, [])
            if len(relevant_ur_list) < f + 1:
                continue
            for urs in itertools.combinations(relevant_ur_list, f + 1):
                all_urs = frozenset().union(*urs)
                ur_intersections = []
                for u1, u2 in itertools.combinations(urs, 2):
                    isect = u1 & u2
                    if isect:
                        ur_intersections.append(isect)
                if not ur_intersections:
                    continue
                my_gt_temp = [gt for gt in gts_for_val if gt <= all_urs]
                if len(my_gt_temp) < f:
                    continue
                for gts in itertools.combinations(my_gt_temp, f):
                    seen = set()
                    disjoint = True
                    for gt in gts:
                        if seen & gt:
                            disjoint = False
                            break
                        seen |= gt
                    if not disjoint:
                        continue
                    all_gts = frozenset(seen)
                    for isect in ur_intersections:
                        for cell in isect:
                            if cell not in all_gts:
                                cd = cands[cell]
                                if i in cd:
                                    cd.remove(i)
                    for cell in all_gts:
                        counter = 0
                        for ur in urs:
                            if cell in ur:
                                counter += 1
                            if counter == 3:
                                cd = cands[cell]
                                if i in cd:
                                    cd.remove(i)
                                break


def _amo_cls():
    from gridsolver.rules.unique import ElementsAtMostOnce
    return ElementsAtMostOnce


# --------------------------------------------------------------------------
# State capture: intercept the solver's fish calls on real puzzles
# --------------------------------------------------------------------------

class _EnoughStates(Exception):
    pass


def capture_states(grid: Grid, max_states: int) -> list:
    """Solve `grid`, snapshotting the grid every time the solver reaches fish."""
    states = []
    real_fish, real_finned = _am.fish, _am.finned_fish

    # Patch the names atomic_solver actually calls (patching solve_fish.fish
    # would not affect the already-imported binding — see DEVELOPMENT.md).
    def cap_fish(g, max_fish=2):
        states.append(g.deepcopy())
        if len(states) >= max_states:
            raise _EnoughStates()
        return real_fish(g, max_fish)

    def cap_finned(g, max_fish=2):
        states.append(g.deepcopy())
        if len(states) >= max_states:
            raise _EnoughStates()
        return real_finned(g, max_fish)

    _am.fish, _am.finned_fish = cap_fish, cap_finned
    try:
        solver.solve(grid, log_level=-1, max_sols=1)
    except _EnoughStates:
        pass
    finally:
        _am.fish, _am.finned_fish = real_fish, real_finned
    return states


PUZZLES = [
    ("sudoku-mith", lambda: create_from_str(
        "Sudoku::...13.....1...45....2....6.1..3...7.2...5...8.4...6..9.5....7....67...9.....89...")),
    ("killer-c", lambda: create_from_str(
        "KillerSudoku::"
        "aaabbbccc defffgghi dejkkklhi dejjkllhi mennnoohp mqrrsttup mqqrstuup vvvwwwxxx yyywwwzzz"
        " : a6b24c15d12e24f19g3h20i6j15k16l23m23n17o10p18q22r9s4t18u11v12w33x18y10z17".replace(" ", "\n"))),
    ("pandiagonal-11x11", lambda: create_from_file(
        _PROJECT_ROOT / "Examples/LatinSquares/Pandiagonals/11x11-1to9only-W4.clp")),
]


# --------------------------------------------------------------------------
# Equivalence check + benchmark
# --------------------------------------------------------------------------

def run(quick: bool):
    max_states = 6 if quick else 20
    variants = [
        ("fish", legacy_fish, current_fish, (2, 3, 4)),
        ("finned", legacy_finned_fish, current_finned_fish, (2, 3)),
    ]
    total = {"legacy": 0.0, "current": 0.0}
    mismatches = 0
    for puzzle_name, loader in PUZZLES:
        print(f"capturing states from {puzzle_name} ...", flush=True)
        try:
            states = capture_states(loader(), max_states)
        except Exception as exc:
            print(f"  capture failed: {type(exc).__name__}: {exc}")
            continue
        print(f"  {len(states)} states")
        for si, state in enumerate(states):
            for name, legacy, current, sizes in variants:
                for f in sizes:
                    g1 = state.deepcopy()
                    t0 = time.perf_counter()
                    legacy(g1, f)
                    total["legacy"] += time.perf_counter() - t0

                    g2 = state.deepcopy()
                    t0 = time.perf_counter()
                    current(g2, f)
                    total["current"] += time.perf_counter() - t0

                    if g1._candidates != g2._candidates:
                        mismatches += 1
                        diff = [i for i, (a, b) in enumerate(zip(g1._candidates, g2._candidates)) if a != b]
                        print(f"  MISMATCH {puzzle_name} state {si} {name} f={f} cells {diff[:10]}")

    print()
    print(f"legacy  total: {total['legacy']:.2f}s")
    print(f"current total: {total['current']:.2f}s")
    if mismatches:
        sys.exit(f"{mismatches} MISMATCHES — current fish is NOT equivalent to the reference")
    print("all states equivalent")


if __name__ == "__main__":
    run(quick="--quick" in sys.argv)
