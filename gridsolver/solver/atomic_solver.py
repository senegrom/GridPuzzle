from array import ArrayType
from typing import Tuple, Set, List, Optional, Callable

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import RuleAlwaysSatisfied, InvalidGrid, Guarantee
from gridsolver.solver.logger import MAX_LVL as _MAX_LVL
from gridsolver.solver.rulehelpers import rulehelper_atmostonce, rulehelper_sum_atmostonce
from gridsolver.solver.solve_chain import w_wing, x_chain
from gridsolver.solver.solve_fish import fish, finned_fish
from gridsolver.solver.solve_guarantees import remove_hidden_tuples, filter_guarantees
from gridsolver.solver.solve_naked_tuples import remove_naked_tuples
from gridsolver.solver.solve_wing import xy_wing, xyz_wing
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
class AtomicSolver:
    def __init__(self, grid: Grid, upsteps: List[int],
                 hidden_pair_checked_gts: Set[Guarantee]):
        self.grid = grid
        self.upsteps = upsteps
        self.hidden_pair_checked_gts = hidden_pair_checked_gts

    def solve_atomic(self) -> SolveStatus:
        _lg.logs(_MAX_LVL, f"Solving rule-based")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
        steps: int = 0
        old: Optional[Grid] = None

        while self.grid.is_valid:
            do_step = True
            step_type = "basic"

            break_outer = True
            if old == self.grid:
                try:
                    for step_type in self._solve_power_actions():
                        if old != self.grid:
                            break_outer = False
                            do_step = False
                            _update_known_from_candidates(self.grid.__setitem__, self.grid._candidates,
                                                          self.grid._known)
                            break
                except InvalidGrid:
                    break
                if break_outer:
                    break

            _lg.logstep(_MAX_LVL, self.upsteps, f"{steps} ({step_type})")
            _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
            steps = steps + 1
            with _lg.time_ctxt("update_step"):
                if do_step:
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

    def _solve_power_actions(self):
        with _lg.time_ctxt("rulehelper_atmostonce"):
            rulehelper_atmostonce(self.grid)
        yield "rulehelper_atmostonce"
        with _lg.time_ctxt("rulehelper_sum_atmostonce"):
            rulehelper_sum_atmostonce(self.grid)
        yield "rulehelper_sum_atmostonce"
        with _lg.time_ctxt("naked_tuples5"):
            remove_naked_tuples(self.grid, 5)
        yield "naked_tuples5"
        with _lg.time_ctxt("xy_wing"):
            xy_wing(self.grid)
        yield "xy_wing"
        with _lg.time_ctxt("xyz_wing"):
            xyz_wing(self.grid)
        yield "xyz_wing"
        with _lg.time_ctxt("w_wing"):
            w_wing(self.grid)
        yield "w_wing"
        with _lg.time_ctxt("x_chain"):
            x_chain(self.grid)
        yield "x_chain"
        with _lg.time_ctxt("hidden_tuples3"):
            if self.hidden_pair_checked_gts:
                remove_hidden_tuples(self.grid, 3,
                                     [gt for gt in self.grid.guarantees if gt not in self.hidden_pair_checked_gts])
            else:
                remove_hidden_tuples(self.grid, 3, None)
        yield "hidden_tuples3"
        with _lg.time_ctxt("fish2"):
            fish(self.grid, 2)
        yield "fish2"
        with _lg.time_ctxt("naked_tuples10"):
            remove_naked_tuples(self.grid, 10)
        yield "naked_tuples10"
        with _lg.time_ctxt("hidden_tuples4"):
            if self.hidden_pair_checked_gts:
                remove_hidden_tuples(self.grid, 4,
                                     [gt for gt in self.grid.guarantees if gt not in self.hidden_pair_checked_gts])
            else:
                remove_hidden_tuples(self.grid, 4, None)
        yield "hidden_tuples4"
        with _lg.time_ctxt("fish3"):
            fish(self.grid, 3)
        yield "fish3"
        with _lg.time_ctxt("finned-fish2"):
            finned_fish(self.grid, 2)
        yield "finned-fish2"
        with _lg.time_ctxt("naked_tuples"):
            remove_naked_tuples(self.grid)
        yield "naked_tuples"
        with _lg.time_ctxt("hidden_tuples"):
            if self.hidden_pair_checked_gts:
                remove_hidden_tuples(self.grid, _MAX_HIDDEN_TUPLE,
                                     [gt for gt in self.grid.guarantees if gt not in self.hidden_pair_checked_gts])
            else:
                remove_hidden_tuples(self.grid, _MAX_HIDDEN_TUPLE, None)
            self.hidden_pair_checked_gts = self.grid.guarantees
        yield "hidden_tuples"
        with _lg.time_ctxt("fish"):
            fish(self.grid, _MAX_FISH)
        yield "fish"
        with _lg.time_ctxt("finned-fish"):
            finned_fish(self.grid, _MAX_FISH - 1)
        yield "finned-fish"


_MAX_HIDDEN_TUPLE = 7
_MAX_FISH = 4


def _update_known_from_candidates(setitem: Callable[[int, int], None], possible: Tuple[Set[int]],
                                  known: ArrayType) -> None:
    for i, p in enumerate(possible):
        if len(p) == 1 and known[i] == 0:
            setitem(i, next(iter(p)))


def _update_candidates_from_known(possible: Tuple[Set[int]], known: ArrayType) -> None:
    for p, k in zip(possible, known):
        if k > 0 and len(p) > 1:
            p &= {k}
