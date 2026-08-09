"""Batch relation-rule eliminations and avoid redundant known-state scans."""

from pathlib import Path
from textwrap import dedent


path = Path("gridsolver/rules/uneq.py")
text = path.read_text(encoding="utf-8")

uneq_class = text.index("class UneqRule(")
uneq_start = text.index("    def apply(", uneq_class)
uneq_end = text.index("\n\nclass IneqRule", uneq_start)
uneq_method = dedent('''
        def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]],
                  guarantees: Set[Guarantee] = None) -> \\
                Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:
            origin_value = known[self.origin_cell]
            if origin_value > 0:
                all_related_known = True
                for cell in self.rel_cells:
                    if known[cell] == 0:
                        all_related_known = False
                    candidates[cell].discard(origin_value)
                if all_related_known:
                    raise RuleAlwaysSatisfied()
                return False, None, None

            origin_candidates = candidates[self.origin_cell]
            if origin_candidates:
                forbidden = {
                    known[cell]
                    for cell in self.rel_cells
                    if known[cell] > 0
                }
                for guarantee in guarantees or ():
                    if len(guarantee.cells) != 1:
                        continue
                    guaranteed_cell = next(iter(guarantee.cells))
                    if guaranteed_cell in self.rel_cells:
                        forbidden.add(guarantee.val)
                if forbidden:
                    origin_candidates.difference_update(forbidden)

            return False, None, None
''').lstrip()
text = text[:uneq_start] + "    " + uneq_method.replace("\n", "\n    ").rstrip() + text[uneq_end:]

diff_class = text.index("class DiffGe2Rule(")
diff_start = text.index("    def apply(", diff_class)
diff_method = dedent('''
        def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]],
                  guarantees: Set[Guarantee] = None) -> \\
                Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:
            origin_value = known[self.origin_cell]
            if origin_value > 0:
                forbidden = {origin_value - 1, origin_value, origin_value + 1}
                all_related_known = True
                for cell in self.rel_cells:
                    if known[cell] == 0:
                        all_related_known = False
                    candidates[cell].difference_update(forbidden)
                if all_related_known:
                    raise RuleAlwaysSatisfied()
                return False, None, None

            origin_candidates = candidates[self.origin_cell]
            if origin_candidates:
                forbidden: set[int] = set()
                for cell in self.rel_cells:
                    related_value = known[cell]
                    if related_value > 0:
                        forbidden.update(
                            (
                                related_value - 1,
                                related_value,
                                related_value + 1,
                            )
                        )
                if forbidden:
                    origin_candidates.difference_update(forbidden)

            return False, None, None
''').lstrip()
text = text[:diff_start] + "    " + diff_method.replace("\n", "\n    ").rstrip() + "\n"
path.write_text(text, encoding="utf-8")

Path("tests/test_relation_hotpath.py").write_text(
    dedent('''
        import random

        import pytest

        from gridsolver.abstract_grids.grid import Grid
        from gridsolver.rules.rules import Guarantee, RuleAlwaysSatisfied
        from gridsolver.rules.uneq import DiffGe2Rule, UneqRule


        def _legacy_uneq(rule, known, candidates, guarantees):
            if known[rule.origin_cell] > 0:
                for cell in rule.rel_cells:
                    candidates[cell].discard(known[rule.origin_cell])
            elif candidates[rule.origin_cell]:
                for value in (known[cell] for cell in rule.rel_cells):
                    if value > 0:
                        candidates[rule.origin_cell].discard(value)

                for guarantee in (
                    guarantee
                    for guarantee in guarantees
                    if guarantee.cells <= rule.rel_cells
                    and len(guarantee.cells) == 1
                ):
                    candidates[rule.origin_cell].discard(guarantee.val)

            if all(known[cell] > 0 for cell in rule.cells):
                raise RuleAlwaysSatisfied()
            return False, None, None


        def _legacy_diff_ge2(rule, known, candidates, guarantees):
            if known[rule.origin_cell] > 0:
                origin = known[rule.origin_cell]
                forbidden = {origin - 1, origin, origin + 1}
                for cell in rule.rel_cells:
                    candidates[cell].difference_update(forbidden)
            elif candidates[rule.origin_cell]:
                forbidden = set()
                for cell in rule.rel_cells:
                    value = known[cell]
                    if value > 0:
                        forbidden.update((value - 1, value, value + 1))
                candidates[rule.origin_cell].difference_update(forbidden)

            if all(known[cell] > 0 for cell in rule.cells):
                raise RuleAlwaysSatisfied()
            return False, None, None


        def _outcome(function, rule, known, candidates, guarantees):
            copied = tuple(set(possible) for possible in candidates)
            try:
                result = function(rule, list(known), copied, guarantees)
            except RuleAlwaysSatisfied:
                result = "satisfied"
            return result, copied


        def _random_state(seed):
            rng = random.Random(seed)
            max_elem = 5
            known = []
            candidates = []
            for _ in range(5):
                if rng.random() < 0.4:
                    value = rng.randrange(1, max_elem + 1)
                    known.append(value)
                    candidates.append({value})
                else:
                    known.append(0)
                    possible = {
                        value
                        for value in range(1, max_elem + 1)
                        if rng.random() < 0.55
                    }
                    candidates.append(possible)

            guarantees = []
            for _ in range(rng.randrange(5)):
                cell_count = 1 if rng.random() < 0.7 else 2
                cells = frozenset(rng.sample(range(5), cell_count))
                guarantees.append(
                    Guarantee(
                        rng.randrange(1, max_elem + 1),
                        cells,
                        1,
                        5,
                    )
                )
            return known, tuple(candidates), tuple(guarantees)


        @pytest.mark.parametrize(
            ("rule_type", "legacy"),
            ((UneqRule, _legacy_uneq), (DiffGe2Rule, _legacy_diff_ge2)),
        )
        def test_relation_hotpath_matches_legacy_for_deterministic_random_states(
            rule_type,
            legacy,
        ):
            grid = Grid(1, 5, max_elem=5)
            rule = rule_type(
                grid,
                origin_cell=0,
                rel_cells=[1, 2, 3, 4],
            )

            for seed in range(500):
                known, candidates, guarantees = _random_state(seed)
                expected = _outcome(
                    legacy,
                    rule,
                    known,
                    candidates,
                    guarantees,
                )
                actual = _outcome(
                    type(rule).apply,
                    rule,
                    known,
                    candidates,
                    guarantees,
                )
                assert actual == expected, seed


        def test_uneq_accepts_no_guarantee_iterable_on_direct_use():
            grid = Grid(1, 3, max_elem=3)
            rule = UneqRule(grid, origin_cell=0, rel_cells=[1, 2])
            known = [0, 1, 2]
            candidates = ({1, 2, 3}, {1}, {2})

            rule.apply(known, candidates, None)

            assert candidates[0] == {3}


        def test_uneq_batches_multiple_origin_eliminations_in_one_trail_snapshot():
            grid = Grid(1, 4, max_elem=4)
            grid[1] = 1
            grid[2] = 2
            grid[3] = 3
            rule = UneqRule(grid, origin_cell=0, rel_cells=[1, 2, 3])
            mark = grid.trail_mark()

            rule.apply(grid._known, grid._candidates, ())

            candidate_entries = [
                entry
                for entry in grid._trail_state.entries
                if entry[0] == "cand"
            ]
            assert grid.get_candidates(0) == {4}
            assert len(candidate_entries) == 1
            grid.trail_undo(mark)
            assert grid.get_candidates(0) == {1, 2, 3, 4}
    ''').lstrip(),
    encoding="utf-8",
)
