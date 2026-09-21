"""Regressions for the September 2026 input, branching and pool review."""

import multiprocessing
import os
from pathlib import Path
import pickle
import random
import subprocess
import sys

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import (
    create_from_file, create_from_str, create_from_str_and_class,
)
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.rules.topology import AllowedValueCountRule
from gridsolver.solver import solve_parallel as parallel


def _cage_fixture(family):
    if family == "kenken":
        return Kenken(None, 2), "aaaa", "a+0.6", "a+6"
    return (
        KillerSudoku(None, 2, 2, 2, 2),
        "aaaabbbbccccdddd", "a0.10b10c10d10", "a10b10c10d10",
    )


@pytest.mark.parametrize("family", ("kenken", "killersudoku"))
@pytest.mark.parametrize("space_sep", (False, True))
@pytest.mark.parametrize("row_wise", (False, True))
@pytest.mark.parametrize("route", ("direct", "explicit", "prefixed", "file", "iterable"))
def test_malformed_cage_targets_are_never_rewritten(
    family, space_sep, row_wise, route, tmp_path,
):
    grid, layout, bad_dictionary, good_dictionary = _cage_fixture(family)
    source = grid.deepcopy()
    separator = "\u2003" if space_sep else ""
    rendered_layout = separator.join(layout)
    options = {"space_sep": space_sep, "row_wise": row_wise}

    def load(dictionary):
        text = f"{rendered_layout}:{dictionary}"
        if route == "direct":
            grid.load(text, **options)
            return grid
        if route == "explicit":
            return create_from_str_and_class(text, family, **options)
        if route == "prefixed":
            return create_from_str(f"{family}::{text}", **options)
        if route == "file":
            path = tmp_path / "puzzle.pzl"
            path.write_text(f"{family}::{text}", encoding="utf-8")
            return create_from_file(path, **options)
        tokens = (part for part in (*layout, ":", dictionary))
        return create_from_str_and_class(tokens, family, **options)

    with pytest.raises(ValueError):
        load(bad_dictionary)
    assert grid == source
    assert not grid.has_been_filled
    result = load(good_dictionary)
    assert result.has_been_filled
    expected = [6] if family == "kenken" else [10] * 4
    assert sorted(rule.sum for rule in result.rules if hasattr(rule, "sum")) == expected


@pytest.mark.parametrize("family", ("kenken", "killersudoku"))
def test_cage_dictionary_whitespace_is_removed_without_blank_conversion(family):
    grid, layout, _, dictionary = _cage_fixture(family)
    grid.load(f"{layout}:" + "\t\u2003\n".join(dictionary))
    assert grid.has_been_filled


def _reference_branch_choice(grid):
    """Direct pairwise definition; deliberately independent of cached peers."""
    choices = []
    for cell, possible in enumerate(grid._candidates):
        if len(possible) <= 1:
            continue
        peers = set()
        for rule in grid.rules:
            if cell in rule.cells:
                peers.update(rule.cells)
        peers.discard(cell)
        pressure = sum(
            len(possible & grid._candidates[peer])
            for peer in peers if grid._known[peer] == 0
        )
        choices.append(((len(possible), -pressure, cell), cell))
    if not choices:
        raise ValueError("No cell has more than one candidate")
    return min(choices)[1]


def _assert_branch_choice(grid):
    expected = _reference_branch_choice(grid)
    actual, possible = grid.get_smallest_candidate_set_gt1()
    assert actual == expected
    assert possible is grid._candidates[actual]


def _global_count_rule(grid):
    return AllowedValueCountRule(
        grid, range(grid.len), 1, range(grid.len + 1),
    )


@pytest.mark.parametrize("seed", range(16))
def test_implicit_global_peers_preserve_exact_branch_order(seed):
    rng = random.Random(seed)
    grid = Grid(1, 12, max_elem=5)
    grid.add_rule_checked(_global_count_rule(grid))
    for cell in range(grid.len):
        possible = set(rng.sample(range(1, 6), rng.randint(1, 5)))
        grid.get_candidates(cell).intersection_update(possible)
        if len(possible) == 1 and rng.randrange(2):
            grid[cell] = next(iter(possible))
    _assert_branch_choice(grid)
    assert grid._rule_cache["branch_peers"] is None
    mark = grid.trail_mark()
    try:
        grid[0] = min(grid.get_candidates(0))
        grid.get_candidates(1).intersection_update({1, 2})
        _assert_branch_choice(grid)
    finally:
        grid.trail_undo(mark)
    _assert_branch_choice(grid)
    for clone in (grid.deepcopy(), pickle.loads(pickle.dumps(grid))):
        _assert_branch_choice(clone)


def test_implicit_global_peers_follow_rule_changes_and_rollback():
    grid = Grid(1, 5, max_elem=3)
    local = AllowedValueCountRule(grid, (0, 1), 1, (0, 1, 2))
    grid.add_rule_checked(local)
    _assert_branch_choice(grid)
    local_cache = grid._rule_cache["branch_peers"]
    mark = grid.trail_mark()
    try:
        global_rule = _global_count_rule(grid)
        grid.add_rule_checked(global_rule)
        _assert_branch_choice(grid)
        assert grid._rule_cache["branch_peers"] is None
        grid.deactivate_rule(global_rule)
        _assert_branch_choice(grid)
        assert grid._rule_cache["branch_peers"] == local_cache
    finally:
        grid.trail_undo(mark)
    assert grid._rule_cache["branch_peers"] is local_cache
    _assert_branch_choice(grid)


def test_large_slitherlink_branching_does_not_materialize_a_clique():
    grid = Slitherlink([[None] * 30 for _ in range(30)])
    cell, possible = grid.get_smallest_candidate_set_gt1()
    assert (cell, possible) == (0, {1, 2})
    assert grid._rule_cache["branch_peers"] is None


def test_global_peer_branching_preserves_no_choice_error():
    grid = Grid(1, 2, max_elem=2)
    grid.add_rule_checked(_global_count_rule(grid))
    grid[0] = 1
    grid[1] = 2
    with pytest.raises(ValueError, match="No cell"):
        grid.get_smallest_candidate_set_gt1()


@pytest.mark.parametrize("phase", ("initial_submit", "refill_submit", "result", "stats", "interrupt"))
def test_parallel_errors_terminate_before_context_exit(monkeypatch, phase):
    monkeypatch.setattr(parallel, "_wait_for_uncapped_result", lambda *args: None)
    failure = KeyboardInterrupt() if phase == "interrupt" else RuntimeError("original failure")
    events = []

    class Future:
        def result(self):
            if phase in {"result", "interrupt"}:
                raise failure
            return (set(), object()) if phase == "stats" else set()

        def cancel(self):
            events.append("cancel")
            return True

    class Pool:
        submitted = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            events.append("exit")
            assert "terminate" in events

        def submit(self, *args):
            self.submitted += 1
            if (phase == "initial_submit" and self.submitted == 2) or (
                phase == "refill_submit" and self.submitted == 3
            ):
                raise failure
            return Future()

        def terminate_workers(self):
            events.append("terminate")

    class Stats:
        def merge(self, other):
            raise failure

    monkeypatch.setattr(parallel.concurrent.futures, "ProcessPoolExecutor", lambda **kwargs: Pool())
    monkeypatch.setattr(parallel, "current_power_stats", lambda: Stats() if phase == "stats" else None)
    with pytest.raises(type(failure)) as caught:
        parallel.solve_parallel_trials(Grid(1, 1, 3), [(0, 1), (0, 2), (0, 3)], -1, 2)
    assert caught.value is failure
    assert events == ["cancel", "terminate", "exit"]


def test_parallel_cleanup_does_not_mask_original_error(monkeypatch):
    monkeypatch.setattr(parallel, "_wait_for_uncapped_result", lambda *args: None)
    failure = RuntimeError("branch failed")

    class Future:
        def result(self):
            raise failure

        def cancel(self):
            raise OSError("cancel failed")

    class Pool:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def submit(self, *args):
            return Future()

        def terminate_workers(self):
            raise OSError("terminate failed")

    monkeypatch.setattr(parallel.concurrent.futures, "ProcessPoolExecutor", lambda **kwargs: Pool())
    with pytest.raises(RuntimeError) as caught:
        parallel.solve_parallel_trials(Grid(1, 1, 2), [(0, 1), (0, 2)], -1, 2)
    assert caught.value is failure
    assert len(failure.__notes__) == 2


@pytest.mark.parametrize(
    "start_method",
    [method for method in ("spawn", "forkserver") if method in multiprocessing.get_all_start_methods()],
)
def test_real_parallel_error_stops_running_sibling(start_method, tmp_path):
    script = Path(__file__).with_name("review_parallel_probe.py")
    env = os.environ.copy()
    env["GRIDPUZZLE_FAILURE_PROBE"] = str(tmp_path)
    process = subprocess.Popen(
        [sys.executable, str(script), start_method],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    try:
        try:
            stdout, stderr = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            (tmp_path / "release").touch()
            process.kill()
            stdout, stderr = process.communicate(timeout=10)
            pytest.fail(f"Parallel error waited for its sibling: {stdout}\n{stderr}")
        assert process.returncode == 0, stdout + stderr
        assert "original error preserved; no live workers" in stdout
    finally:
        (tmp_path / "release").touch()
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)
