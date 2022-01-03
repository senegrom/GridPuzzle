from array import ArrayType
from typing import Tuple, Set, Sequence, List, Optional, Callable

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import RuleAlwaysSatisfied, InvalidGrid, Guarantee
from gridsolver.solver.logger import MAX_LVL as _MAX_LVL
from gridsolver.solver.solve_fish import apply_fish
from gridsolver.solver.solve_guarantees import remove_hidden_pairs, filter_guarantees
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
class AtomicSolver:
    def __init__(self, grid: Grid, upsteps: List[int],
                 solve_iter_hooks: Sequence[Callable[[Grid], bool]],
                 hidden_pair_checked_gts: Set[Guarantee]):
        self.grid = grid
        self.upsteps = upsteps
        self.solve_iter_hooks = solve_iter_hooks if solve_iter_hooks is not None else []
        self.hidden_pair_checked_gts = hidden_pair_checked_gts

    def solve_atomic(self) -> SolveStatus:
        _lg.logs(_MAX_LVL, f"Solving rule-based")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
        steps: int = 0
        old: Optional[Grid] = None

        def hooks():
            with _lg.time_ctxt("solve_iter_hooks"):
                do_refresh = False
                for hook in self.solve_iter_hooks or []:
                    do_refresh |= hook(self.grid)
                if do_refresh:
                    _update_candidates_from_known(self.grid._candidates, self.grid._known)

        while self.grid.is_valid:
            all_but_rule_equal = self.grid.all_but_rule_equal(old)
            step_type = "Normal"

            if all_but_rule_equal:
                power_actions = [(hooks, "Hook"), (self._fast_actions, "Fast"), (self._slow_actions, "Slow")]
                pa_idx = 0
                break_outer = False
                while self.grid == old:
                    if pa_idx >= len(power_actions):
                        break_outer = True
                        break
                    pa, step_type = power_actions[pa_idx]
                    pa()
                    pa_idx += 1
                if break_outer:
                    break

            _lg.logstep(_MAX_LVL, self.upsteps, f"{steps} ({step_type})")
            if not all_but_rule_equal:
                _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
            else:
                # noinspection PyProtectedMember
                _lg.logs(_MAX_LVL, self.grid._str_header(detailed=True))
            steps = steps + 1
            if step_type == "Normal":
                old = self.grid.deepcopy()
                self._update_step()

        status: SolveStatus
        if not self.grid.is_valid:
            status = SolveStatus.INVALID
        elif self.grid.is_solved:
            status = SolveStatus.SOLVED
        else:
            status = SolveStatus.NONE

        _lg.logs(_MAX_LVL, f"Done after {steps} steps: \t{status}")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
        return status

    def _update_step(self) -> None:
        _update_known_from_candidates(self.grid.__setitem__, self.grid._candidates, self.grid._known)
        try:
            with _lg.time_ctxt("update_from_rules"):
                self._update_from_rules()
            with _lg.time_ctxt("filter_guarantees"):
                filter_guarantees(self.grid)
        except InvalidGrid:
            pass

    # rule updates
    def _update_from_rules(self) -> None:
        for rule in self.grid.rules.copy():
            try:
                do_refresh, new_rules, new_gts = rule.apply(
                    self.grid._known, self.grid._candidates, self.grid.guarantees)
                if do_refresh:
                    _update_candidates_from_known(self.grid._candidates, self.grid._known)
            except RuleAlwaysSatisfied:
                new_rules = []
                new_gts = None
                _update_candidates_from_known(self.grid._candidates, self.grid._known)
            if new_rules is not None:
                self.grid.deactivate_rule(rule)
                for new_rule in new_rules:
                    self.grid.add_rule_checked(new_rule)
            if new_gts is not None:
                for gt in new_gts:
                    self.grid.add_gtee_checked(gt)

    def _fast_actions(self):
        with _lg.time_ctxt("fish3"):
            apply_fish(self.grid, 2)

    def _slow_actions(self):
        with _lg.time_ctxt("fish"):
            apply_fish(self.grid, 3)
        with _lg.time_ctxt("hidden_tuples"):
            if self.hidden_pair_checked_gts:
                remove_hidden_pairs(self.grid,
                                    [gt for gt in self.grid.guarantees if gt not in self.hidden_pair_checked_gts])
            else:
                remove_hidden_pairs(self.grid, None)
            self.hidden_pair_checked_gts = self.grid.guarantees


def _update_known_from_candidates(setitem: Callable[[int, int], None], possible: Tuple[Set[int]],
                                  known: ArrayType) -> None:
    for i, p in enumerate(possible):
        if len(p) == 1 and known[i] == 0:
            setitem(i, next(iter(p)))


def _update_candidates_from_known(possible: Tuple[Set[int]], known: ArrayType) -> None:
    for p, k in zip(possible, known):
        if k > 0 and len(p) > 1:
            p &= {k}
