"""Replace per-technique lambda allocations with direct calls."""

from pathlib import Path
from textwrap import dedent, indent


def replace_between(
    path: Path,
    start_marker: str,
    end_marker: str,
    replacement: str,
) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


path = Path("gridsolver/solver/atomic_solver.py")
replace_between(
    path,
    "    def _act(",
    "    def _hidden_tuples(",
    indent(
        dedent('''
            def _act(
                self,
                label: str,
                action: Callable[..., None],
                *args: object,
            ) -> str:
                """Run one power action without allocating an adapter closure."""
                try:
                    if self.stats is not None:
                        with self.stats.time(label):
                            action(*args)
                    elif self.collect_timing:
                        with _lg.time_ctxt(label):
                            action(*args)
                    else:
                        action(*args)
                except InvalidGrid:
                    if self.stats is not None:
                        self.stats.tries[label] += 1
                        self.stats.hits[label] += 1
                    raise
                return label

        ''').lstrip(),
        "    ",
    ),
)
replace_between(
    path,
    "    def _solve_power_actions(",
    "\n_MAX_HIDDEN_TUPLE = 7\n",
    indent(
        dedent('''
            def _solve_power_actions(self) -> Iterator[str]:
                grid = self.grid
                # Expensive zero-hit tiers are skipped inside forcing-chain branches but
                # retained at the outer level for full deductive power.
                in_forcing_chain = bool(_solve_fc._in_forcing_chain)

                yield self._act("locked_candidate", locked_candidate, grid)
                yield self._act("skyscraper", skyscraper, grid)
                yield self._act("empty_rectangle", empty_rectangle, grid)
                yield self._act("ineq_bounds", ineq_bounds, grid)
                yield self._act(
                    "rulehelper_atmostonce",
                    rulehelper_atmostonce,
                    grid,
                )
                yield self._act(
                    "rulehelper_sum_atmostonce",
                    rulehelper_sum_atmostonce,
                    grid,
                )
                yield self._act(
                    "rulehelper_house_sums",
                    rulehelper_house_sums,
                    grid,
                )
                yield self._act(
                    "naked_tuples5",
                    remove_naked_tuples,
                    grid,
                    5,
                )

                # Search depth is zero-based although the recursion bookkeeping list
                # contains one root entry. The gate never changes forcing-chain inner
                # propagation, which continues to use the full non-recursive hierarchy.
                search_depth = max(0, len(self.upsteps) - 1)
                if (
                    self.depth_gate is not None
                    and not in_forcing_chain
                    and search_depth > self.depth_gate
                ):
                    return

                yield self._act("xy_wing", xy_wing, grid)
                yield self._act("xyz_wing", xyz_wing, grid)
                yield self._act("w_wing", w_wing, grid)
                yield self._act("x_chain", x_chain, grid)
                yield self._act("xy_chain", xy_chain, grid)
                topology = CandidateTopology.build(grid)
                als_analysis = ALSAnalysis.build(grid, topology)
                yield self._act("als_xz", als_xz, grid, als_analysis)
                yield self._act(
                    "als_xy_wing",
                    als_xy_wing,
                    grid,
                    als_analysis,
                )
                yield self._act("sue_de_coq", sue_de_coq, grid)
                yield self._act("forcing_chain", forcing_chain, grid)
                yield self._act("hidden_tuples3", self._hidden_tuples, 3)
                yield self._act("fish2", fish, grid, 2)
                yield self._act(
                    "naked_tuples10",
                    remove_naked_tuples,
                    grid,
                    10,
                )
                yield self._act("hidden_tuples4", self._hidden_tuples, 4)
                if not in_forcing_chain:
                    yield self._act("fish3", fish, grid, 3)
                    yield self._act("finned-fish2", finned_fish, grid, 2)
                yield self._act("naked_tuples", remove_naked_tuples, grid)
                if not in_forcing_chain:
                    yield self._act("hidden_tuples", self._hidden_tuples_max)
                yield self._act(
                    "aic",
                    alternating_inference_chain,
                    grid,
                    topology,
                )
                yield self._act("nishio", nishio, grid)
                if not in_forcing_chain:
                    yield self._act("fish", fish, grid, _MAX_FISH)
                    yield self._act(
                        "finned-fish",
                        finned_fish,
                        grid,
                        _MAX_FISH - 1,
                    )
                yield self._act("forcing_net", forcing_net, grid)
        ''').lstrip(),
        "    ",
    ).rstrip(),
)

Path("tests/test_action_dispatch.py").write_text(
    dedent('''
        import ast
        from pathlib import Path

        from gridsolver.abstract_grids.grid import Grid
        from gridsolver.solver.atomic_solver import AtomicSolver


        def test_power_action_pipeline_does_not_allocate_lambdas():
            path = (
                Path(__file__).resolve().parents[1]
                / "gridsolver/solver/atomic_solver.py"
            )
            tree = ast.parse(path.read_text(encoding="utf-8"))
            method = next(
                node
                for node in ast.walk(tree)
                if isinstance(node, ast.FunctionDef)
                and node.name == "_solve_power_actions"
            )
            assert not any(
                isinstance(node, ast.Lambda)
                for node in ast.walk(method)
            )


        def test_action_dispatch_forwards_positional_arguments():
            solver = AtomicSolver(Grid(1), [], set())
            seen = []

            def action(first, second):
                seen.append((first, second))

            assert solver._act("test", action, 1, "two") == "test"
            assert seen == [(1, "two")]
    ''').lstrip(),
    encoding="utf-8",
)
