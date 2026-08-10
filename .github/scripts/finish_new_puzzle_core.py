"""Finish solver profiles and graph deductions for the new puzzle families."""

from pathlib import Path
from textwrap import dedent


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(
    path: Path,
    start_marker: str,
    end_marker: str,
    replacement: str,
    label: str,
) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(start_marker) != 1:
        raise SystemExit(f"{label}: start marker count changed")
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


GRID = Path("gridsolver/abstract_grids/grid.py")
replace_once(
    GRID,
    dedent(
        '''
        class SolveStatus(Enum):
            NONE = 0
            SOLVED = 1
            INVALID = -1
        '''
    ).lstrip(),
    dedent(
        '''
        class SolveStatus(Enum):
            NONE = 0
            SOLVED = 1
            INVALID = -1


        class TechniqueProfile(Enum):
            """Deduction families that are sound and useful for one grid model."""

            FULL = "full"
            GENERIC = "generic"
            RULES_ONLY = "rules_only"
        '''
    ).lstrip(),
    "technique profile enum",
)
replace_once(
    GRID,
    dedent(
        '''
        class Grid(ImmutableGrid, RuleContainer, MutableSequence[int]):
            __hash__ = None
        '''
    ).lstrip(),
    dedent(
        '''
        class Grid(ImmutableGrid, RuleContainer, MutableSequence[int]):
            __hash__ = None
            technique_profile = TechniqueProfile.FULL
        '''
    ).lstrip(),
    "base grid profile",
)

COMPACT = Path("gridsolver/grid_classes/compact_grid.py")
replace_once(
    COMPACT,
    "from gridsolver.abstract_grids.grid import Grid\n",
    "from gridsolver.abstract_grids.grid import Grid, TechniqueProfile\n",
    "compact profile import",
)
replace_once(
    COMPACT,
    dedent(
        '''
            The specialised puzzle rules provide all useful propagation, so Sudoku-only
            advanced techniques are deliberately disabled for these grids.
            """

            supports_advanced_techniques = False
        '''
    ),
    dedent(
        '''
            The specialised puzzle rules provide the primary propagation. Generic
            all-different, tuple, forcing, and trial deductions remain available,
            while geometry-specific Sudoku patterns are excluded.
            """

            technique_profile = TechniqueProfile.GENERIC
        '''
    ),
    "compact grid profile",
)

SLITHER = Path("gridsolver/grid_classes/slitherlink.py")
replace_once(
    SLITHER,
    "from gridsolver.abstract_grids.grid import Grid\n",
    "from gridsolver.abstract_grids.grid import Grid, TechniqueProfile\n",
    "slither profile import",
)
replace_once(
    SLITHER,
    dedent(
        '''
        class Slitherlink(CompactGrid):
            """Binary edge puzzle whose selected edges form one loop.
        '''
    ).lstrip(),
    dedent(
        '''
        class Slitherlink(CompactGrid):
            """Binary edge puzzle whose selected edges form one loop.
        '''
    ).lstrip(),
    "slither class marker",
)
replace_once(
    SLITHER,
    dedent(
        '''
            OFF = 1
            ON = 2
        '''
    ),
    dedent(
        '''
            OFF = 1
            ON = 2
            technique_profile = TechniqueProfile.RULES_ONLY
        '''
    ),
    "slither rules-only profile",
)

ATOMIC = Path("gridsolver/solver/atomic_solver.py")
replace_once(
    ATOMIC,
    "from gridsolver.abstract_grids.grid import Grid, SolveStatus\n",
    (
        "from gridsolver.abstract_grids.grid import "
        "Grid, SolveStatus, TechniqueProfile\n"
    ),
    "atomic profile import",
)
new_actions = dedent(
    '''
        def _generic_power_actions(self) -> Iterator[str]:
            """Run deductions that depend only on declared rules/guarantees."""
            grid = self.grid
            in_forcing_chain = bool(_solve_fc._in_forcing_chain)

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

            search_depth = max(0, len(self.upsteps) - 1)
            if (
                self.depth_gate is not None
                and not in_forcing_chain
                and search_depth > self.depth_gate
            ):
                return

            yield self._act("forcing_chain", forcing_chain, grid)
            yield self._act("hidden_tuples3", self._hidden_tuples, 3)
            yield self._act(
                "naked_tuples10",
                remove_naked_tuples,
                grid,
                10,
            )
            yield self._act("hidden_tuples4", self._hidden_tuples, 4)
            yield self._act("naked_tuples", remove_naked_tuples, grid)
            if not in_forcing_chain:
                yield self._act("hidden_tuples", self._hidden_tuples_max)
            yield self._act("nishio", nishio, grid)
            yield self._act("forcing_net", forcing_net, grid)

        def _solve_power_actions(self) -> Iterator[str]:
            grid = self.grid
            profile = getattr(grid, "technique_profile", TechniqueProfile.FULL)
            if profile is TechniqueProfile.RULES_ONLY:
                return
            if profile is TechniqueProfile.GENERIC:
                yield from self._generic_power_actions()
                return
            if profile is not TechniqueProfile.FULL:
                raise ValueError(f"Unknown technique profile {profile!r}")

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
    '''
).lstrip()
replace_between(
    ATOMIC,
    "    def _solve_power_actions(self) -> Iterator[str]:\n",
    "_MAX_HIDDEN_TUPLE = 7\n",
    new_actions,
    "profile-aware power actions",
)

TOPOLOGY = Path("gridsolver/rules/topology.py")
interval_method = dedent(
    '''
        def _prune_layered_intervals(
            self,
            candidates: tuple[set[int], ...],
            fixed: dict[int, int],
        ) -> None:
            """Enforce forward/backward support through the value-layer chain.

            The layered graph is a relaxation of the Hamiltonian path because it
            does not require non-consecutive layers to use distinct cells. Any
            candidate removed here therefore cannot occur in a real solution.
            """
            maximum = self._max_elem
            positions = {
                value: {
                    cell
                    for cell in self.cells
                    if value in candidates[cell]
                }
                for value in range(1, maximum + 1)
            }
            if any(not cells for cells in positions.values()):
                raise InvalidGrid()

            anchors: dict[int, set[int]] = {
                1: set(positions[1]),
                maximum: set(positions[maximum]),
            }
            anchors.update({value: {cell} for value, cell in fixed.items()})
            ordered = sorted(anchors.items())

            for (lower, lower_cells), (upper, upper_cells) in zip(
                ordered,
                ordered[1:],
            ):
                if upper <= lower:
                    continue

                forward: dict[int, set[int]] = {lower: set(lower_cells)}
                for value in range(lower + 1, upper + 1):
                    previous = forward[value - 1]
                    reachable = {
                        cell
                        for cell in positions[value]
                        if any(
                            neighbour in previous
                            for neighbour in self._adjacency_by_cell[cell]
                        )
                    }
                    if value == upper:
                        reachable &= upper_cells
                    if not reachable:
                        raise InvalidGrid()
                    forward[value] = reachable

                supported = forward[upper]
                for cell in positions[upper] - supported:
                    candidates[cell].discard(upper)
                    if not candidates[cell]:
                        raise InvalidGrid()
                positions[upper] = supported

                for value in range(upper - 1, lower - 1, -1):
                    next_supported = supported
                    supported = {
                        cell
                        for cell in forward[value]
                        if any(
                            neighbour in next_supported
                            for neighbour in self._adjacency_by_cell[cell]
                        )
                    }
                    if not supported:
                        raise InvalidGrid()
                    for cell in positions[value] - supported:
                        candidates[cell].discard(value)
                        if not candidates[cell]:
                            raise InvalidGrid()
                    positions[value] = supported
    '''
)
replace_once(
    TOPOLOGY,
    "    def apply(\n        self,\n        known: MutableSequence[int],\n        candidates: tuple[set[int], ...],\n        guarantees: Iterable[Guarantee] | None = None,\n    ) -> tuple[bool, None, None]:\n        fixed: dict[int, int] = {}\n",
    interval_method
    + "\n    def apply(\n        self,\n        known: MutableSequence[int],\n        candidates: tuple[set[int], ...],\n        guarantees: Iterable[Guarantee] | None = None,\n    ) -> tuple[bool, None, None]:\n        fixed: dict[int, int] = {}\n",
    "layered path method",
)
replace_once(
    TOPOLOGY,
    dedent(
        '''
                if remove:
                    possible.difference_update(remove)
                    if not possible:
                        raise InvalidGrid()

            if len(fixed) == maximum:
        '''
    ),
    dedent(
        '''
                if remove:
                    possible.difference_update(remove)
                    if not possible:
                        raise InvalidGrid()

            self._prune_layered_intervals(candidates, fixed)

            if len(fixed) == maximum:
        '''
    ),
    "layered path call",
)

cyclic_blocks_method = dedent(
    '''
        def _cyclic_blocks(self, possible: set[int]) -> tuple[frozenset[int], ...]:
            """Return vertex-biconnected edge blocks that contain a cycle."""
            adjacency: dict[int, list[tuple[int, int]]] = {}
            for cell in possible:
                first, second = self._endpoints_by_cell[cell]
                adjacency.setdefault(first, []).append((second, cell))
                adjacency.setdefault(second, []).append((first, cell))

            discovery: dict[int, int] = {}
            low: dict[int, int] = {}
            edge_stack: list[int] = []
            blocks: list[frozenset[int]] = []
            time = 0

            def finish_block(stop_edge: int) -> None:
                block: set[int] = set()
                while edge_stack:
                    edge = edge_stack.pop()
                    block.add(edge)
                    if edge == stop_edge:
                        break
                if not block:
                    return
                vertices = {
                    vertex
                    for edge in block
                    for vertex in self._endpoints_by_cell[edge]
                }
                if len(block) >= len(vertices):
                    blocks.append(frozenset(block))

            def visit(vertex: int, parent_edge: int | None) -> None:
                nonlocal time
                time += 1
                discovery[vertex] = time
                low[vertex] = time
                for neighbour, edge in adjacency.get(vertex, ()):
                    if edge == parent_edge:
                        continue
                    if neighbour not in discovery:
                        edge_stack.append(edge)
                        visit(neighbour, edge)
                        low[vertex] = min(low[vertex], low[neighbour])
                        if low[neighbour] >= discovery[vertex]:
                            finish_block(edge)
                    elif discovery[neighbour] < discovery[vertex]:
                        edge_stack.append(edge)
                        low[vertex] = min(low[vertex], discovery[neighbour])

            for vertex in adjacency:
                if vertex not in discovery:
                    visit(vertex, None)
                    if edge_stack:
                        finish_block(edge_stack[0])
            return tuple(blocks)
    '''
)
replace_once(
    TOPOLOGY,
    "    def _remove_selected_value(\n",
    cyclic_blocks_method + "\n    def _remove_selected_value(\n",
    "cyclic block method",
)
replace_once(
    TOPOLOGY,
    dedent(
        '''
            bridges = self._bridge_edges(possible)
            if selected & bridges:
                raise InvalidGrid()
            self._remove_selected_value(candidates, bridges - selected)

            membership_decided = all(
        '''
    ),
    dedent(
        '''
            bridges = self._bridge_edges(possible)
            if selected & bridges:
                raise InvalidGrid()
            self._remove_selected_value(candidates, bridges - selected)

            possible = {
                cell
                for cell in self.cells
                if self.selected_value in candidates[cell]
            }
            blocks = self._cyclic_blocks(possible)
            viable_blocks = (
                tuple(block for block in blocks if selected <= block)
                if selected
                else blocks
            )
            if not viable_blocks:
                raise InvalidGrid()
            viable_edges = set().union(*viable_blocks)
            self._remove_selected_value(
                candidates,
                possible - viable_edges,
            )

            membership_decided = all(
        '''
    ),
    "biconnected loop pruning",
)

KAKURO = Path("gridsolver/grid_classes/kakuro.py")
replace_once(
    KAKURO,
    dedent(
        '''
                run_key = orientation, cells
                if run_key in seen_runs:
                    raise ValueError("Duplicate Kakuro run")
                seen_runs.add(run_key)
                for cell in cells:
                    coverage[cell][orientation] += 1
        '''
    ),
    dedent(
        '''
                run_key = orientation, cells
                if run_key in seen_runs:
                    raise ValueError("Duplicate Kakuro run")
                seen_runs.add(run_key)

                if orientation == "H":
                    before = (cells[0][0], cells[0][1] - 1)
                    after = (cells[-1][0], cells[-1][1] + 1)
                else:
                    before = (cells[0][0] - 1, cells[0][1])
                    after = (cells[-1][0] + 1, cells[-1][1])
                if before in self.white_cells or after in self.white_cells:
                    raise ValueError(
                        "Kakuro runs must be maximal between black cells or board edges"
                    )

                for cell in cells:
                    coverage[cell][orientation] += 1
        '''
    ),
    "maximal Kakuro runs",
)

TEST = Path("tests/test_new_puzzle_families.py")
text = TEST.read_text(encoding="utf-8")
text = text.replace(
    "from gridsolver.abstract_grids.grid import Grid\n",
    "from gridsolver.abstract_grids.grid import Grid, TechniqueProfile\n",
    1,
)
text = text.replace(
    "from gridsolver.solver import atomic_solver, solver\n",
    "from gridsolver.solver import atomic_solver, solver\nimport run as run_cli\n",
    1,
)
text += dedent(
    '''


    def test_kakuro_rejects_adjacent_nonmaximal_runs():
        white = tuple(product(range(2), range(4)))
        runs = (
            (3, ((0, 0), (0, 1))),
            (7, ((0, 2), (0, 3))),
            (10, ((1, 0), (1, 1), (1, 2), (1, 3))),
            (3, ((0, 0), (1, 0))),
            (4, ((0, 1), (1, 1))),
            (5, ((0, 2), (1, 2))),
            (6, ((0, 3), (1, 3))),
        )

        with pytest.raises(ValueError, match="maximal"):
            Kakuro(2, 4, white, runs)


    def test_layered_path_pruning_preserves_every_oracle_completion():
        grid = Numbrix.from_board(((0, 0, 0), (0, 0, 0)))
        completions = sorted(
            _path_oracle(
                2,
                3,
                diagonal=False,
                givens={},
            )
        )[:4]
        assert completions
        for cell, possible in enumerate(grid._candidates):
            possible.intersection_update(
                {completion[cell] for completion in completions}
            )

        rule = next(
            rule
            for rule in grid.rules
            if isinstance(rule, ConsecutiveAdjacencyRule)
        )
        rule.apply(grid._known, grid._candidates)

        for completion in completions:
            assert all(
                value in grid._candidates[cell]
                for cell, value in enumerate(completion)
            )


    def test_single_loop_rejects_selected_edges_in_distinct_cycle_blocks():
        grid = Grid(1, 6, max_elem=2)
        grid._candidates[0].intersection_update((2,))
        grid._candidates[3].intersection_update((2,))
        rule = SingleLoopRule(
            grid,
            cells=range(6),
            endpoints=(
                (0, 1),
                (1, 2),
                (2, 0),
                (0, 3),
                (3, 4),
                (4, 0),
            ),
        )

        with pytest.raises(InvalidGrid):
            rule.apply(grid._known, grid._candidates)


    def test_compact_profiles_keep_generic_actions_but_exclude_sudoku_patterns(
        monkeypatch,
    ):
        calls: list[str] = []

        def generic(grid):
            calls.append("generic")

        def sudoku_only(*args, **kwargs):
            raise AssertionError("Sudoku-only action ran under a generic profile")

        monkeypatch.setattr(atomic_solver, "rulehelper_atmostonce", generic)
        monkeypatch.setattr(atomic_solver, "locked_candidate", sudoku_only)
        grid = Numbrix.from_board(((0, 0), (0, 0)))
        actions = atomic_solver.AtomicSolver(grid, [0], set())._solve_power_actions()

        assert next(actions) == "rulehelper_atmostonce"
        assert calls == ["generic"]
        assert grid.technique_profile is TechniqueProfile.GENERIC

        slitherlink = Slitherlink(((None,),))
        assert slitherlink.technique_profile is TechniqueProfile.RULES_ONLY
        assert list(
            atomic_solver.AtomicSolver(
                slitherlink,
                [0],
                set(),
            )._solve_power_actions()
        ) == []


    def test_cli_file_route_renders_compact_solution(tmp_path, capsys):
        path = tmp_path / "one.clp"
        path.write_text("(solve 1 1 4)\n", encoding="utf-8")

        assert run_cli.main(
            (
                "--file",
                str(path),
                "--colour",
                "No",
                "--max-solutions",
                "1",
            )
        ) == 0

        output = capsys.readouterr().out
        assert "+---+" in output
        assert "Took" in output
    '''
)
TEST.write_text(text, encoding="utf-8")
