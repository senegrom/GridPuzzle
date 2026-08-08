from collections import Counter
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from time import perf_counter

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import Guarantee, InvalidGrid
from gridsolver.solver import solve_forcing_chain as _solve_fc
from gridsolver.solver.logger import MAX_LVL as _MAX_LVL
from gridsolver.solver.propagation import (
    PropagationSnapshot,
    apply_rules as _apply_rules,
    propagation_snapshot,
    update_known_from_candidates as _update_known_from_candidates,
)
from gridsolver.solver.rulehelpers import rulehelper_atmostonce, rulehelper_house_sums, rulehelper_sum_atmostonce
from gridsolver.solver.solve_aic import alternating_inference_chain
from gridsolver.solver.solve_als import als_xy_wing, als_xz
from gridsolver.solver.solve_chain import w_wing, x_chain, xy_chain
from gridsolver.solver.solve_empty_rectangle import empty_rectangle
from gridsolver.solver.solve_fish import finned_fish, fish
from gridsolver.solver.solve_forcing_chain import forcing_chain
from gridsolver.solver.solve_forcing_net import forcing_net
from gridsolver.solver.solve_guarantees import filter_guarantees, remove_hidden_tuples
from gridsolver.solver.solve_ineq_bounds import ineq_bounds
from gridsolver.solver.solve_locked_candidate import locked_candidate
from gridsolver.solver.solve_naked_tuples import remove_naked_tuples
from gridsolver.solver.solve_nishio import nishio
from gridsolver.solver.solve_skyscraper import skyscraper
from gridsolver.solver.solve_sue_de_coq import sue_de_coq
from gridsolver.solver.solve_wing import xy_wing, xyz_wing
from gridsolver.solver.solver_log import lg as _lg


@dataclass(slots=True)
class PowerStats:
    """Optional per-solve technique diagnostics."""

    tries: Counter[str] = field(default_factory=Counter)
    hits: Counter[str] = field(default_factory=Counter)
    eliminations: Counter[str] = field(default_factory=Counter)
    rule_changes: Counter[str] = field(default_factory=Counter)
    timings: dict[str, float] = field(default_factory=dict)

    @contextmanager
    def time(self, label: str) -> Iterator[None]:
        started = perf_counter()
        try:
            yield
        finally:
            self.timings[label] = (
                self.timings.get(label, 0.0) + perf_counter() - started
            )

    def merge(self, other: "PowerStats") -> None:
        """Merge one independent worker or corpus result."""
        self.tries.update(other.tries)
        self.hits.update(other.hits)
        self.eliminations.update(other.eliminations)
        self.rule_changes.update(other.rule_changes)
        for label, elapsed in other.timings.items():
            self.timings[label] = self.timings.get(label, 0.0) + elapsed

    def table(self) -> str:
        """Return an aligned per-technique statistics table."""
        labels = sorted(
            set(self.tries) | set(self.timings),
            key=lambda label: (-self.timings.get(label, 0.0), label),
        )
        lines = [
            f"{'technique':24} {'tries':>9} {'hits':>6} {'hit%':>7} "
            f"{'elims':>7} {'rulechg':>8} {'time[s]':>9}"
        ]
        for label in labels:
            tries = self.tries.get(label, 0)
            hits = self.hits.get(label, 0)
            rate = f"{100 * hits / tries:.2f}" if tries else "-"
            lines.append(
                f"{label:24} {tries:>9} {hits:>6} {rate:>7} "
                f"{self.eliminations.get(label, 0):>7} "
                f"{self.rule_changes.get(label, 0):>8} "
                f"{self.timings.get(label, 0.0):>9.1f}"
            )
        return "\n".join(lines)


_POWER_STATS: ContextVar[PowerStats | None] = ContextVar(
    "gridpuzzle_power_stats",
    default=None,
)


def current_power_stats() -> PowerStats | None:
    return _POWER_STATS.get()


@contextmanager
def collect_power_stats() -> Iterator[PowerStats]:
    """Collect diagnostics in this solve context and its nested solvers."""
    stats = PowerStats()
    token = _POWER_STATS.set(stats)
    try:
        yield stats
    finally:
        _POWER_STATS.reset(token)


# noinspection PyProtectedMember
class AtomicSolver:
    def __init__(
        self,
        grid: Grid,
        upsteps: list[int],
        hidden_pair_checked_gts: set[Guarantee],
        depth_gate: int | None = None,
    ) -> None:
        self.grid = grid
        self.upsteps = upsteps
        self.hidden_pair_checked_gts = hidden_pair_checked_gts
        self.depth_gate = depth_gate
        self.stats = current_power_stats()
        self.collect_timing = self.stats is not None or _lg.on

    def solve_atomic(self) -> SolveStatus:
        _lg.logs(_MAX_LVL, "Solving rule-based")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
        steps = 0
        invalid = False

        while self.grid.is_valid:
            before = self._state_snapshot()
            try:
                if self.stats is not None:
                    with self.stats.time("update_step"):
                        self._update_step()
                elif self.collect_timing:
                    with _lg.time_ctxt("update_step"):
                        self._update_step()
                else:
                    self._update_step()
            except InvalidGrid:
                invalid = True
                break

            after_basic = self._state_snapshot()
            if after_basic != before:
                self._log_step(steps, "basic")
                steps += 1
                continue

            # Rules have had a final validation pass, so a solved grid can stop
            # before attempting every expensive power action.
            if self.grid.is_solved:
                break

            action_hit = False
            step_type = "basic"
            try:
                for step_type in self._solve_power_actions():
                    if self.stats is not None:
                        self.stats.tries[step_type] += 1
                    after_action = self._state_snapshot()
                    if after_action == after_basic:
                        continue

                    if self.stats is not None:
                        self.stats.hits[step_type] += 1
                        self.stats.eliminations[step_type] += max(
                            0,
                            after_basic[1] - after_action[1],
                        )
                        if after_basic[2:] != after_action[2:]:
                            self.stats.rule_changes[step_type] += 1
                    _update_known_from_candidates(
                        self.grid.__setitem__,
                        self.grid._candidates,
                        self.grid._known,
                    )
                    action_hit = True
                    break
            except InvalidGrid:
                invalid = True
                break

            if not action_hit:
                break

            self._log_step(steps, step_type)
            steps += 1

        if invalid or not self.grid.is_valid:
            status = SolveStatus.INVALID
        elif self.grid.is_solved:
            status = SolveStatus.SOLVED
        else:
            status = SolveStatus.NONE

        _lg.logs(_MAX_LVL, f"Done after {steps} steps: \t{status}")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
        return status

    def _log_step(self, steps: int, step_type: str) -> None:
        _lg.logstep(_MAX_LVL, self.upsteps, f"{steps} ({step_type})")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)

    def _state_snapshot(self) -> PropagationSnapshot:
        return propagation_snapshot(self.grid)

    def _update_step(self) -> None:
        _update_known_from_candidates(
            self.grid.__setitem__,
            self.grid._candidates,
            self.grid._known,
        )
        if self.stats is not None:
            with self.stats.time("update_from_rules"):
                self._update_from_rules()
            with self.stats.time("filter_guarantees"):
                filter_guarantees(self.grid)
        elif self.collect_timing:
            with _lg.time_ctxt("update_from_rules"):
                self._update_from_rules()
            with _lg.time_ctxt("filter_guarantees"):
                filter_guarantees(self.grid)
        else:
            self._update_from_rules()
            filter_guarantees(self.grid)

    def _update_from_rules(self) -> None:
        _apply_rules(self.grid)

    def _act(self, label: str, action: Callable[[], None]) -> str:
        """Run one power action and optionally account for diagnostics."""
        try:
            if self.stats is not None:
                with self.stats.time(label):
                    action()
            elif self.collect_timing:
                with _lg.time_ctxt(label):
                    action()
            else:
                action()
        except InvalidGrid:
            if self.stats is not None:
                self.stats.tries[label] += 1
                self.stats.hits[label] += 1
            raise
        return label

    def _hidden_tuples(self, n: int) -> None:
        if self.hidden_pair_checked_gts:
            remove_hidden_tuples(
                self.grid,
                n,
                [
                    guarantee
                    for guarantee in self.grid.guarantees
                    if guarantee not in self.hidden_pair_checked_gts
                ],
            )
        else:
            remove_hidden_tuples(self.grid, n, None)

    def _hidden_tuples_max(self) -> None:
        self._hidden_tuples(_MAX_HIDDEN_TUPLE)
        self.hidden_pair_checked_gts = set(self.grid.guarantees)

    def _solve_power_actions(self) -> Iterator[str]:
        grid = self.grid
        # Expensive zero-hit tiers are skipped inside forcing-chain branches but
        # retained at the outer level for full deductive power.
        in_forcing_chain = bool(_solve_fc._in_forcing_chain)

        yield self._act("locked_candidate", lambda: locked_candidate(grid))
        yield self._act("skyscraper", lambda: skyscraper(grid))
        yield self._act("empty_rectangle", lambda: empty_rectangle(grid))
        yield self._act("ineq_bounds", lambda: ineq_bounds(grid))
        yield self._act("rulehelper_atmostonce", lambda: rulehelper_atmostonce(grid))
        yield self._act("rulehelper_sum_atmostonce", lambda: rulehelper_sum_atmostonce(grid))
        yield self._act("rulehelper_house_sums", lambda: rulehelper_house_sums(grid))
        yield self._act("naked_tuples5", lambda: remove_naked_tuples(grid, 5))

        if (
            self.depth_gate is not None
            and not in_forcing_chain
            and len(self.upsteps) > self.depth_gate
        ):
            return

        yield self._act("xy_wing", lambda: xy_wing(grid))
        yield self._act("xyz_wing", lambda: xyz_wing(grid))
        yield self._act("w_wing", lambda: w_wing(grid))
        yield self._act("x_chain", lambda: x_chain(grid))
        yield self._act("xy_chain", lambda: xy_chain(grid))
        yield self._act("als_xz", lambda: als_xz(grid))
        yield self._act("als_xy_wing", lambda: als_xy_wing(grid))
        yield self._act("sue_de_coq", lambda: sue_de_coq(grid))
        yield self._act(
            "forcing_chain",
            lambda: forcing_chain(grid, self.depth_gate),
        )
        yield self._act("hidden_tuples3", lambda: self._hidden_tuples(3))
        yield self._act("fish2", lambda: fish(grid, 2))
        yield self._act("naked_tuples10", lambda: remove_naked_tuples(grid, 10))
        yield self._act("hidden_tuples4", lambda: self._hidden_tuples(4))
        if not in_forcing_chain:
            yield self._act("fish3", lambda: fish(grid, 3))
        yield self._act("finned-fish2", lambda: finned_fish(grid, 2))
        yield self._act("naked_tuples", lambda: remove_naked_tuples(grid))
        if not in_forcing_chain:
            yield self._act("hidden_tuples", self._hidden_tuples_max)
        yield self._act("aic", lambda: alternating_inference_chain(grid))
        yield self._act("nishio", lambda: nishio(grid))
        if not in_forcing_chain:
            yield self._act("fish", lambda: fish(grid, _MAX_FISH))
            yield self._act("finned-fish", lambda: finned_fish(grid, _MAX_FISH - 1))
        yield self._act("forcing_net", lambda: forcing_net(grid))


_MAX_HIDDEN_TUPLE = 7
_MAX_FISH = 4
