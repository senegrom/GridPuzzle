"""Make cached weak links reflect the symmetric UneqRule relation."""

from pathlib import Path


grid_path = Path("gridsolver/abstract_grids/grid.py")
grid = grid_path.read_text(encoding="utf-8")
old = '''            for rule in self.rules:
                if isinstance(rule, UneqRule):
                    result[rule.origin_cell].update(rule.rel_cells)
            return result
'''
new = '''            for rule in self.rules:
                if not isinstance(rule, UneqRule):
                    continue
                origin = rule.origin_cell
                result[origin].update(rule.rel_cells)
                for related in rule.rel_cells:
                    result[related].add(origin)
            return result
'''
if grid.count(old) != 1:
    raise SystemExit("weak-links builder marker changed")
grid_path.write_text(grid.replace(old, new, 1), encoding="utf-8")


test_path = Path("tests/test_rule_only_cache.py")
tests = test_path.read_text(encoding="utf-8")
appendix = '''


def test_weak_links_are_symmetric_for_a_single_directional_rule():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(
        UneqRule(grid, origin_cell=0, rel_cells=[1, 2])
    )

    links = grid.weak_links

    assert links[0] == {1, 2}
    assert links[1] == {0}
    assert links[2] == {0}


def test_weak_link_symmetry_survives_cache_and_trail_lifecycles():
    grid = Grid(1, 3, max_elem=3)
    root_rule = UneqRule(grid, origin_cell=0, rel_cells=[1])
    grid.add_rule_checked(root_rule)
    root_links = grid.weak_links
    mark = grid.trail_mark()

    branch_rule = UneqRule(grid, origin_cell=1, rel_cells=[2])
    grid.add_rule_checked(branch_rule)
    branch_links = grid.weak_links
    assert branch_links[1] == {0, 2}
    assert branch_links[2] == {1}

    grid.trail_undo(mark)

    assert grid.weak_links is root_links
    assert grid.weak_links[0] == {1}
    assert grid.weak_links[1] == {0}
    assert not grid.weak_links[2]
'''
if "test_weak_links_are_symmetric_for_a_single_directional_rule" in tests:
    raise SystemExit("symmetric weak-link tests already exist")
test_path.write_text(tests.rstrip() + appendix, encoding="utf-8")
