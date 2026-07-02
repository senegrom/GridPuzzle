from array import ArrayType
from collections import Counter
from typing import Tuple, Set, List, Optional, Callable

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import RuleAlwaysSatisfied, InvalidGrid, Guarantee
from gridsolver.solver.logger import MAX_LVL as _MAX_LVL
from gridsolver.solver.rulehelpers import rulehelper_atmostonce, rulehelper_house_sums, rulehelper_sum_atmostonce
from gridsolver.solver.solve_chain import w_wing, x_chain, xy_chain
from gridsolver.solver.solve_aic import alternating_inference_chain
from gridsolver.solver.solve_als import als_xy_wing, als_xz
from gridsolver.solver.solve_fish import fish, finned_fish
from gridsolver.solver.solve_nishio import nishio
from gridsolver.solver import solve_forcing_chain as _solve_fc
from gridsolver.solver.solve_forcing_chain import forcing_chain
from gridsolver.solver.solve_forcing_net import forcing_net
from gridsolver.solver.solve_guarantees import remove_hidden_tuples, filter_guarantees
from gridsolver.solver.solve_empty_rectangle import empty_rectangle
from gridsolver.solver.solve_ineq_bounds import ineq_bounds
from gridsolver.solver.solve_locked_candidate import locked_candidate
from gridsolver.solver.solve_naked_tuples import remove_naked_tuples
from gridsolver.solver.solve_skyscraper import skyscraper
from gridsolver.solver.solve_sue_de_coq import sue_de_coq
from gridsolver.solver.solve_wing import xy_wing, xyz_wing
from gridsolver.solver.solver_log import lg as _lg


# Technique statistics, aggregated process-wide (including the inner solvers
# of forcing-chain branches). A "try" is one execution of a power action; a
# "hit" is an execution after which the grid state changed; "elims" counts the
# candidates removed by hits; "rulechg" counts hits that changed the
# rule/guarantee sets (e.g. the rulehelpers, which eliminate nothing directly).
POWER_TRIES: Counter = Counter()
POWER_HITS: Counter = Counter()
POWER_ELIMS: Counter = Counter()
POWER_RULE_CHANGES: Counter = Counter()


# Adaptive gating of expensive techniques inside forcing-chain inner solvers.
# Static exclusion is wrong for AIC (June 2026 experiment: t-hard 43% faster
# without inner AIC, pandiagonal-11x11 4.5x slower — there inner AIC hits 65%
# and carries the branches). The discriminating signal is the inner hit rate
# itself, accumulated per solve lineage in grid._adaptive_stats (a dict shared
# across deepcopy clones): once a technique has _ADAPTIVE_MIN_TRIES inner
# executions and its hit rate sits below _ADAPTIVE_MIN_HITRATE, it is skipped
# inside FC for the rest of the solve (t-hard measures 36%, pandiagonal 65%).
_ADAPTIVE_GATED = ("aic",)
_ADAPTIVE_MIN_TRIES = 30
_ADAPTIVE_MIN_HITRATE = 0.5


def reset_power_stats() -> None:
    POWER_TRIES.clear()
    POWER_HITS.clear()
    POWER_ELIMS.clear()
    POWER_RULE_CHANGES.clear()
    _lg.time_stats.clear()


def power_stats_table() -> str:
    """Aligned per-technique table: tries, hits, hit rate, eliminations,
    rule-changing hits, cumulative seconds."""
    labels = sorted(set(POWER_TRIES) | set(_lg.time_stats), key=lambda x: -_lg.time_stats.get(x, 0.0))
    lines = [f"{'technique':24} {'tries':>9} {'hits':>6} {'hit%':>7} {'elims':>7} {'rulechg':>8} {'time[s]':>9}"]
    for label in labels:
        tries = POWER_TRIES.get(label, 0)
        hits = POWER_HITS.get(label, 0)
        rate = f"{100 * hits / tries:.2f}" if tries else "-"
        lines.append(f"{label:24} {tries:>9} {hits:>6} {rate:>7} {POWER_ELIMS.get(label, 0):>7}"
                     f" {POWER_RULE_CHANGES.get(label, 0):>8} {_lg.time_stats.get(label, 0.0):>9.1f}")
    return "\n".join(lines)


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
        old: Optional[Tuple[bytes, int, int, int]] = None

        while self.grid.is_valid:
            do_step = True
            step_type = "basic"

            break_outer = True
            if old is not None and old == self._state_snapshot():
                try:
                    for step_type in self._solve_power_actions():
                        POWER_TRIES[step_type] += 1
                        ast = None
                        if step_type in _ADAPTIVE_GATED and _solve_fc._in_forcing_chain:
                            ast = self.grid._adaptive_stats.setdefault(step_type, [0, 0])
                            ast[0] += 1
                        new_snap = self._state_snapshot()
                        if old != new_snap:
                            POWER_HITS[step_type] += 1
                            if ast is not None:
                                ast[1] += 1
                            POWER_ELIMS[step_type] += max(0, old[1] - new_snap[1])
                            if old[2:] != new_snap[2:]:
                                POWER_RULE_CHANGES[step_type] += 1
                            break_outer = False
                            do_step = False
                            _update_known_from_candidates(self.grid.__setitem__, self.grid._candidates,
                                                          self.grid._known)
                            break
                except InvalidGrid:
                    break
                if break_outer:
                    break

            with _lg.time_ctxt("update_step"):
                if do_step:
                    if old is None:
                        self._update_step()
                    old = self._state_snapshot()
                    self._update_step()

            _lg.logstep(_MAX_LVL, self.upsteps, f"{steps} ({step_type})")
            _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
            steps = steps + 1

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

    def _state_snapshot(self) -> Tuple[bytes, int, int, int]:
        # Knowns only get set and candidates only shrink (monotone), so the
        # first two fields change iff cell state changed. The rule/guarantee
        # set sizes make rule-only progress (rulehelpers deriving new rules)
        # count as progress too, so the new rules get another propagation round
        # instead of falling through to backtracking; any mutation is visible
        # because the inactive sets only ever grow (a deactivate+add pair that
        # keeps the active count equal still bumps field four). Termination:
        # rule versions per original rule are bounded by its cell count.
        g = self.grid
        return (bytes(g._known), sum(len(s) for s in g._candidates),
                len(g.rules) + len(g.guarantees), len(g.rules_ia) + len(g.guarantees_ia))

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
        for rule in list(self.grid.rules):
            try:
                do_refresh, new_rules, new_gts = rule.apply(
                    self.grid._known, self.grid._candidates, _relevant_gts(self.grid, rule))
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

    def _act(self, label: str, fn) -> str:
        """Run one power action under its timer. A raised InvalidGrid kills the
        generator before the consumer can count the execution, yet a proven
        contradiction is the most decisive kind of hit — count it here."""
        with _lg.time_ctxt(label):
            try:
                fn()
            except InvalidGrid:
                POWER_TRIES[label] += 1
                POWER_HITS[label] += 1
                if label in _ADAPTIVE_GATED and _solve_fc._in_forcing_chain:
                    st = self.grid._adaptive_stats.setdefault(label, [0, 0])
                    st[0] += 1
                    st[1] += 1
                raise
        return label

    def _adaptive_allows(self, label: str) -> bool:
        stats = self.grid._adaptive_stats.get(label)
        return (stats is None or stats[0] < _ADAPTIVE_MIN_TRIES
                or stats[1] >= _ADAPTIVE_MIN_HITRATE * stats[0])

    def _hidden_tuples(self, n: int) -> None:
        if self.hidden_pair_checked_gts:
            remove_hidden_tuples(self.grid, n,
                                 [gt for gt in self.grid.guarantees if gt not in self.hidden_pair_checked_gts])
        else:
            remove_hidden_tuples(self.grid, n, None)

    def _hidden_tuples_max(self) -> None:
        self._hidden_tuples(_MAX_HIDDEN_TUPLE)
        self.hidden_pair_checked_gts = set(self.grid.guarantees)

    def _solve_power_actions(self):
        g = self.grid
        # Tiers guarded by `not in_fc` cost the bulk of solve time with ~zero
        # hit rates outside house-rich grids (tests/technique_stats_harness.py)
        # and ~90% of their executions happen inside forcing-chain branches;
        # they are skipped there, mirroring the nishio/forcing_net exclusion,
        # and still run at the outer level for full deductive power.
        in_fc = _solve_fc._in_forcing_chain
        yield self._act("locked_candidate", lambda: locked_candidate(g))
        yield self._act("skyscraper", lambda: skyscraper(g))
        yield self._act("empty_rectangle", lambda: empty_rectangle(g))
        yield self._act("ineq_bounds", lambda: ineq_bounds(g))
        yield self._act("rulehelper_atmostonce", lambda: rulehelper_atmostonce(g))
        yield self._act("rulehelper_sum_atmostonce", lambda: rulehelper_sum_atmostonce(g))
        yield self._act("rulehelper_house_sums", lambda: rulehelper_house_sums(g))
        yield self._act("naked_tuples5", lambda: remove_naked_tuples(g, 5))
        yield self._act("xy_wing", lambda: xy_wing(g))
        yield self._act("xyz_wing", lambda: xyz_wing(g))
        yield self._act("w_wing", lambda: w_wing(g))
        yield self._act("x_chain", lambda: x_chain(g))
        yield self._act("xy_chain", lambda: xy_chain(g))
        yield self._act("als_xz", lambda: als_xz(g))
        yield self._act("als_xy_wing", lambda: als_xy_wing(g))
        yield self._act("sue_de_coq", lambda: sue_de_coq(g))
        yield self._act("forcing_chain", lambda: forcing_chain(g))
        yield self._act("hidden_tuples3", lambda: self._hidden_tuples(3))
        yield self._act("fish2", lambda: fish(g, 2))
        yield self._act("naked_tuples10", lambda: remove_naked_tuples(g, 10))
        yield self._act("hidden_tuples4", lambda: self._hidden_tuples(4))
        if not in_fc:
            yield self._act("fish3", lambda: fish(g, 3))
        yield self._act("finned-fish2", lambda: finned_fish(g, 2))
        yield self._act("naked_tuples", lambda: remove_naked_tuples(g))
        if not in_fc:
            yield self._act("hidden_tuples", self._hidden_tuples_max)
        if not in_fc or self._adaptive_allows("aic"):
            yield self._act("aic", lambda: alternating_inference_chain(g))
        yield self._act("nishio", lambda: nishio(g))
        if not in_fc:
            yield self._act("fish", lambda: fish(g, _MAX_FISH))
            yield self._act("finned-fish", lambda: finned_fish(g, _MAX_FISH - 1))
        yield self._act("forcing_net", lambda: forcing_net(g))


_MAX_HIDDEN_TUPLE = 7
_MAX_FISH = 4


def _relevant_gts(grid: Grid, rule) -> list:
    """Guarantees possibly relevant to `rule`: every consumer filters on
    gt.cells being a subset of the rule's (unknown) cells, which implies the
    guarantee's minimum cell lies in rule.cells — so bucketing by min cell
    yields an exact superset at a fraction of iterating all live guarantees
    (the dominant per-round cost on large grids). The index lives in the
    struct cache and is rebuilt only when guarantees actually change."""
    index = grid.cached_struct(
        "gts_by_min_cell",
        lambda: _build_gt_index(grid))
    return [gt for cell in rule.cells for gt in index.get(cell, ())]


def _build_gt_index(grid: Grid) -> dict:
    idx: dict = {}
    for gt in grid.guarantees:
        idx.setdefault(min(gt.cells), []).append(gt)
    return idx


def _update_known_from_candidates(setitem: Callable[[int, int], None], possible: Tuple[Set[int]],
                                  known: ArrayType) -> None:
    for i, p in enumerate(possible):
        if len(p) == 1 and known[i] == 0:
            setitem(i, next(iter(p)))


def _update_candidates_from_known(possible: Tuple[Set[int]], known: ArrayType) -> None:
    for p, k in zip(possible, known):
        if k > 0 and len(p) > 1:
            p.intersection_update((k,))
