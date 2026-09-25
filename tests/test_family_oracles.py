"""Seeded differential tests against independent brute-force oracles.

Ported from the 2026-09-22 fuzz pass (about 14,500 instances, all clean):
Hidato and Numbrix against Hamiltonian-path enumeration, Kakuro against a
plain depth-first search over digits, Killer Sudoku against the 288 4x4
Sudokus. Each instance compares the complete solution set, capped solves
(1 and 2), and, as a soundness canary, the complete set under the GENERIC
and FULL profiles. The oracles share no code with the solver.

The 2026-09-24 fuzz pass added a shape these seeds did not reach: path
boards with sparse clues (the two endpoints and at most three interior
values), where the path rule's matching carries the search.
"""
import random
from contextlib import suppress
from functools import cache
from itertools import permutations

from gridsolver.abstract_grids.grid import TechniqueProfile
from gridsolver.grid_classes.kakuro import Kakuro
from gridsolver.grid_classes.killer_sudoku import KillerSudoku, SumCellPair
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.rules.rules import RuleAlwaysSatisfied
from gridsolver.rules.topology import ConsecutiveAdjacencyRule
from gridsolver.solver import solver

_PROFILED: dict = {}
_SEEN: list[int] = []  # solution counts checked by the current test


def _profiled(cls, profile):
    """A module-level subclass of ``cls`` forcing ``profile``."""
    if cls.technique_profile is profile:
        return cls
    key = cls, profile
    if key not in _PROFILED:
        name = f"{cls.__name__}{profile.name.title().replace('_', '')}"
        _PROFILED[key] = type(name, (cls,), {"technique_profile": profile, "__module__": __name__})
    return _PROFILED[key]


def _check(make, decode, expected, base_cls,
           profiles=(TechniqueProfile.GENERIC, TechniqueProfile.FULL)):
    """Complete set, caps 1 and 2, then the complete set under ``profiles``."""
    _SEEN.append(len(expected))
    grid = make(base_cls)
    solutions = [decode(grid, solution) for solution in solver.solve(grid)]
    assert len(solutions) == len(set(solutions))
    assert set(solutions) == expected
    for cap in (1, 2):
        grid = make(base_cls)
        capped = {decode(grid, solution) for solution in solver.solve(grid, max_sols=cap)}
        assert len(capped) == min(cap, len(expected))
        assert capped <= expected
    for profile in profiles:
        grid = make(_profiled(base_cls, profile))
        assert {decode(grid, solution) for solution in solver.solve(grid)} == expected


# --- Hidato and Numbrix: every directed Hamiltonian path of the active cells


@cache
def _numberings(rows, cols, blocked, diagonal):
    active = [(r, c) for r in range(rows) for c in range(cols) if (r, c) not in blocked]
    active_set = set(active)
    steps = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1)
             if (dr, dc) != (0, 0) and (diagonal or dr == 0 or dc == 0)]
    neighbours = {cell: [(cell[0] + dr, cell[1] + dc) for dr, dc in steps
                         if (cell[0] + dr, cell[1] + dc) in active_set] for cell in active}
    found = []
    for start in active:
        path, seen = [start], {start}
        stack = [iter(neighbours[start])]
        while stack:
            if len(path) == len(active):
                found.append(tuple(sorted((cell, index + 1) for index, cell in enumerate(path))))
            advanced = False
            for cell in stack[-1]:
                if cell not in seen and len(path) < len(active):
                    path.append(cell)
                    seen.add(cell)
                    stack.append(iter(neighbours[cell]))
                    advanced = True
                    break
            if not advanced:
                stack.pop()
                seen.discard(path.pop())
    return tuple(found)


def _decode_keyed(grid, solution):
    return tuple(sorted(grid.values_by_key(solution).items()))


def _path_instances(seed, count):
    rng = random.Random(seed)
    shapes = ((1, 1), (1, 2), (1, 4), (2, 2), (2, 3), (3, 2), (3, 3), (2, 4), (3, 4), (4, 3), (4, 4))
    produced = 0
    while produced < count:
        hidato = rng.random() < 0.5
        rows, cols = rng.choice(shapes)
        cells = [(r, c) for r in range(rows) for c in range(cols)]
        blocked = frozenset()
        if hidato and rows * cols > 9:
            blocked = frozenset(rng.sample(cells, rows * cols - 9))
        elif hidato and rows * cols > 2 and rng.random() < 0.4:
            blocked = frozenset(rng.sample(cells, rng.randint(1, 2)))
        cls = Hidato if hidato else Numbrix
        board = [["#" if (r, c) in blocked else None for c in range(cols)] for r in range(rows)]
        # Blocked cells can disconnect the board: no numbering, no solution.
        numberings = _numberings(rows, cols, blocked, hidato)
        active = [cell for cell in cells if cell not in blocked]
        if numberings and rng.random() < 0.9:
            source = dict(rng.choice(numberings))
        else:
            values = list(range(1, len(active) + 1))
            rng.shuffle(values)
            source = dict(zip(active, values))
        givens = {cell: source[cell] for cell in rng.sample(active, rng.randint(len(active) // 3, len(active)))}
        if givens and rng.random() < 0.15:
            moved = rng.choice(sorted(givens))
            target = rng.choice(active)
            givens[moved], givens[target] = givens.get(target), givens[moved]
            if givens[moved] is None:
                del givens[moved]
        expected = frozenset(n for n in numberings if all(dict(n)[cell] == v for cell, v in givens.items()))
        if len(expected) > 40:
            continue
        for (r, c), value in givens.items():
            board[r][c] = value
        produced += 1
        yield cls, board, expected


def _assert_mixed_batch():
    """The batch held unsatisfiable, unique and multi-solution puzzles."""
    counts = _SEEN[:]
    _SEEN.clear()
    assert 0 in counts and 1 in counts and max(counts) >= 2, counts


def test_path_puzzles_match_hamiltonian_path_enumeration():
    families = set()
    for seed in (20260923, 7):
        for cls, board, expected in _path_instances(seed, 10):
            families.add(cls)
            _check(lambda variant, board=board: variant.from_board(board), _decode_keyed, expected, cls)
    assert families == {Hidato, Numbrix}
    _assert_mixed_batch()


def test_path_oracle_counts_known_boards():
    # The oracle itself: 2x2 king moves allow every ordering (4! paths),
    # a 1x3 strip two, and a 2x3 orthogonal grid 8 paths in 2 directions.
    assert len(_numberings(2, 2, frozenset(), True)) == 24
    assert len(_numberings(1, 3, frozenset(), False)) == 2
    assert len(_numberings(2, 3, frozenset(), False)) == 16



def test_path_rule_pruning_keeps_every_consistent_completion():
    # One application of the path rule on its own: whatever domains are
    # given, every Hamiltonian path those domains still allow must survive
    # (local support, layered walks and the all-different matching alike),
    # and the rule must not report a contradiction.
    rng = random.Random(20260923)
    checked = 0
    while checked < 80:
        hidato = rng.random() < 0.5
        rows, cols = rng.choice(((2, 3), (3, 2), (3, 3), (2, 4), (3, 4), (4, 3)))
        blocked = frozenset()
        if hidato and rng.random() < 0.4:
            blocked = frozenset(rng.sample([(r, c) for r in range(rows) for c in range(cols)], rng.randint(1, 2)))
        cls = Hidato if hidato else Numbrix
        grid = cls.from_board([["#" if (r, c) in blocked else None for c in range(cols)] for r in range(rows)])
        numberings = _numberings(rows, cols, blocked, hidato)
        if not numberings:
            continue  # includes disconnected boards, which get no path rule
        kept = [dict(numbering) for numbering in rng.sample(numberings, min(len(numberings), rng.randint(1, 3)))]
        known = [0] * grid.len
        candidates = []
        for cell in range(grid.len):
            key = grid.cell_to_key[cell]
            values = {numbering[key] for numbering in kept}
            if len(values) == 1 and rng.random() < 0.3:
                known[cell] = next(iter(values))
            else:
                values |= {v for v in range(1, grid.max_elem + 1) if rng.random() < 0.3}
            candidates.append(values)
        candidates = tuple(candidates)
        rule = next(rule for rule in grid.rules if isinstance(rule, ConsecutiveAdjacencyRule))
        with suppress(RuleAlwaysSatisfied):
            rule.apply(known, candidates)
        for numbering in kept:
            assert all(value in candidates[grid.key_to_cell[key]] for key, value in numbering.items())
        checked += 1


# --- Sparse path clues: the endpoints and at most three interior values


class _TooMany(Exception):
    pass


def _neighbour_map(active, diagonal):
    cells = set(active)
    steps = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1)
             if (dr, dc) != (0, 0) and (diagonal or dr == 0 or dc == 0)]
    return {cell: [(cell[0] + dr, cell[1] + dc) for dr, dc in steps if (cell[0] + dr, cell[1] + dc) in cells]
            for cell in active}


def _walk_numberings(active, neighbours, diagonal, givens, limit, budget, rng=None):
    """Numberings consistent with ``givens``, as sorted ((cell), value) tuples.

    A walk from value 1 with two necessary conditions that share nothing with
    the solver: the next given value stays within reach of the walk's head,
    and every unvisited cell stays reachable from it. With ``rng`` the
    neighbour order is shuffled and the first numbering found is returned.
    Raises _TooMany past ``limit`` numberings or ``budget`` steps.
    """
    at_value = {value: cell for cell, value in givens.items()}
    given_values = sorted(at_value)
    path, unvisited, found, steps = [], set(active), [], [0]

    def reach(first, second):
        rows, cols = abs(first[0] - second[0]), abs(first[1] - second[1])
        return max(rows, cols) if diagonal else rows + cols

    def allowed(cell, value):
        if givens.get(cell, value) != value or at_value.get(value, cell) != cell:
            return False
        following = next((v for v in given_values if v > value), None)
        return following is None or reach(cell, at_value[following]) <= following - value

    def head_reaches_the_rest(head):
        seen, stack = set(), [head]
        while stack:
            for other in neighbours[stack.pop()]:
                if other in unvisited and other not in seen:
                    seen.add(other)
                    stack.append(other)
        return len(seen) == len(unvisited)

    def extend():
        steps[0] += 1
        if steps[0] > budget:
            raise _TooMany
        if not unvisited:
            found.append(tuple(sorted((cell, index + 1) for index, cell in enumerate(path))))
            if len(found) > limit:
                raise _TooMany
            return rng is not None
        options = list(neighbours[path[-1]] if path else active)
        if rng is not None:
            rng.shuffle(options)
        for cell in options:
            if cell in unvisited and allowed(cell, len(path) + 1):
                path.append(cell)
                unvisited.discard(cell)
                done = head_reaches_the_rest(cell) and extend()
                path.pop()
                unvisited.add(cell)
                if done:
                    return True
        return False

    extend()
    return found


def _sparse_path_instances(seed, count):
    rng = random.Random(seed)
    produced = 0
    while produced < count:
        hidato = rng.random() < 0.7
        rows, cols = rng.randint(3, 5), rng.randint(3, 5)
        cells = [(r, c) for r in range(rows) for c in range(cols)]
        blocked = frozenset()
        if hidato and rng.random() < 0.6:
            blocked = frozenset(rng.sample(cells, rng.randint(1, rows * cols // 4)))
        active = [cell for cell in cells if cell not in blocked]
        neighbours = _neighbour_map(active, hidato)
        try:
            source = _walk_numberings(active, neighbours, hidato, {}, 1, 20_000, rng)
        except _TooMany:
            continue
        if not source:
            continue  # no path at all; the disconnected boards are covered above
        at_value = {value: cell for cell, value in source[0]}
        last = len(active)
        interior = rng.sample(range(2, last), min(rng.randint(0, 3), last - 2))
        givens = {at_value[value]: value for value in (1, last, *interior)}
        roll = rng.random()
        free = [cell for cell in active if cell not in givens]
        if roll < 0.2:
            moved = rng.choice(sorted(givens))
            givens[rng.choice(free)] = givens.pop(moved)  # usually no solution
        elif roll < 0.4:
            # 2 out of reach of 1: no solution, and a proof the walk finds at once.
            start = at_value[1]
            far = [cell for cell in free if max(abs(cell[0] - start[0]), abs(cell[1] - start[1])) > 1]
            if far:
                givens = {cell: value for cell, value in givens.items() if value != 2}
                givens[rng.choice(far)] = 2
        try:
            expected = frozenset(_walk_numberings(active, neighbours, hidato, givens, 40, 60_000))
        except _TooMany:
            continue
        board = [["#" if (r, c) in blocked else givens.get((r, c)) for c in range(cols)] for r in range(rows)]
        produced += 1
        yield (Hidato if hidato else Numbrix), board, expected


def test_sparse_path_clues_match_the_constrained_walk():
    # Forcing GENERIC or FULL onto these boards takes seconds to minutes per
    # solve, and neither the command line nor the browser can, so this checks
    # the path families' own profile with complete sets and caps.
    families = set()
    for cls, board, expected in _sparse_path_instances(20260924, 12):
        families.add(cls)
        _check(lambda variant, board=board: variant.from_board(board), _decode_keyed, expected, cls, profiles=())
    assert families == {Hidato, Numbrix}
    _assert_mixed_batch()


def test_constrained_walk_counts_known_boards():
    # The same numbering counts as the unconstrained enumeration above.
    for rows, cols, diagonal in ((2, 2, True), (1, 3, False), (2, 3, False), (3, 3, True)):
        active = [(r, c) for r in range(rows) for c in range(cols)]
        walked = _walk_numberings(active, _neighbour_map(active, diagonal), diagonal, {}, 10**6, 10**6)
        assert set(walked) == set(_numberings(rows, cols, frozenset(), diagonal))


# --- Kakuro: plain DFS over digits 1..9, distinct within runs, exact sums


def _runs_of(white, rows, cols):
    runs = []
    for r in range(rows):
        run = []
        for c in range(cols + 1):
            if c < cols and (r, c) in white:
                run.append((r, c))
            else:
                if run:
                    runs.append(("H", tuple(run)))
                run = []
    for c in range(cols):
        run = []
        for r in range(rows + 1):
            if r < rows and (r, c) in white:
                run.append((r, c))
            else:
                if run:
                    runs.append(("V", tuple(run)))
                run = []
    return runs


def _kakuro_fillings(order, runs, targets, rng=None):
    """All digit fillings (or one random one when rng is given)."""
    cell_runs = {cell: [i for i, (_, cells) in enumerate(runs) if cell in cells] for cell in order}
    used = [set() for _ in runs]
    partial = [0] * len(runs)
    left = [len(cells) for _, cells in runs]
    assign, found = {}, []

    def search(index):
        if index == len(order):
            found.append(tuple(sorted(assign.items())))
            return rng is not None
        cell = order[index]
        digits = list(range(1, 10))
        if rng is not None:
            rng.shuffle(digits)
        for digit in digits:
            if any(digit in used[i] for i in cell_runs[cell]):
                continue
            if targets is not None and any(
                partial[i] + digit + (left[i] - 1) > targets[i]
                or partial[i] + digit + 9 * (left[i] - 1) < targets[i]
                for i in cell_runs[cell]
            ):
                continue
            assign[cell] = digit
            for i in cell_runs[cell]:
                used[i].add(digit)
                partial[i] += digit
                left[i] -= 1
            stop = search(index + 1)
            for i in cell_runs[cell]:
                used[i].discard(digit)
                partial[i] -= digit
                left[i] += 1
            del assign[cell]
            if stop:
                return True
        return False

    search(0)
    return found


def _kakuro_instances(seed, count):
    """(make, expected, whether the totals were made unequal) per board."""
    rng = random.Random(seed)
    produced = 0
    while produced < count:
        rows, cols = rng.choice(((2, 2), (2, 3), (3, 2), (3, 3)))
        density = rng.choice((0.0, 0.15, 0.3))
        white = {(r, c) for r in range(rows) for c in range(cols) if rng.random() >= density}
        runs = _runs_of(white, rows, cols)
        if not white or any(len(cells) < 2 for _, cells in runs):
            continue
        order = sorted(white)
        fill = dict(_kakuro_fillings(order, runs, None, rng)[0])
        targets = [sum(fill[cell] for cell in cells) for _, cells in runs]
        roll = rng.random()
        mismatched = roll < 0.15
        if mismatched:
            # Unequal across and down totals: no solution, found without search.
            targets[rng.randrange(len(targets))] += rng.choice((-1, 1))
        elif roll < 0.3:
            same = [i for i, (orientation, _) in enumerate(runs) if orientation == runs[0][0]]
            if len(same) >= 2:
                first, second = rng.sample(same, 2)
                targets[first] += 1
                targets[second] -= 1
        expected = frozenset(_kakuro_fillings(order, runs, targets))
        if len(expected) > 8:
            continue
        definitions = [(target, list(cells)) for target, (_, cells) in zip(targets, runs)]
        produced += 1
        yield (lambda variant, rows=rows, cols=cols, white=white, definitions=definitions:
               variant(rows, cols, sorted(white), definitions)), expected, mismatched


def test_kakuro_matches_depth_first_oracle():
    mismatched_totals = 0
    for make, expected, mismatched in _kakuro_instances(20260923, 6):
        mismatched_totals += mismatched
        _check(make, _decode_keyed, expected, Kakuro)
    assert mismatched_totals
    _assert_mixed_batch()


# --- Killer Sudoku 4x4: filter the 288 Sudokus by cage sums and distinctness


@cache
def _sudokus_4x4():
    rows = list(permutations(range(1, 5)))
    found = []

    def search(prefix):
        if len(prefix) == 4:
            found.append(tuple(prefix))
            return
        for row in rows:
            if any(row[c] == other[c] for other in prefix for c in range(4)):
                continue
            if len(prefix) % 2 == 1:
                top = prefix[-1]
                if any({top[c], top[c + 1], row[c], row[c + 1]} != {1, 2, 3, 4} for c in (0, 2)):
                    continue
            search(prefix + [row])

    search([])
    return found


def _connected_cages(rng, max_size):
    free = {(r, c) for r in range(4) for c in range(4)}
    order = sorted(free)
    rng.shuffle(order)
    cages = []
    for start in order:
        if start not in free:
            continue
        cage, size = [start], rng.randint(1, max_size)
        free.discard(start)
        while len(cage) < size:
            frontier = sorted({(r + dr, c + dc) for r, c in cage for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))}
                              & free)
            if not frontier:
                break
            cell = rng.choice(frontier)
            cage.append(cell)
            free.discard(cell)
        cages.append(cage)
    return cages


def _decode_4x4(grid, solution):
    return tuple(solution[r, c] for r in range(4) for c in range(4))


def _killer_instances(seed, count):
    """(make, expected) per 4x4 Killer board with at most two solutions."""
    sudokus = _sudokus_4x4()
    rng = random.Random(seed)
    produced = 0
    while produced < count:
        cages = _connected_cages(rng, rng.choice((2, 3, 4)))
        pool = [s for s in sudokus if all(len({s[r][c] for r, c in cage}) == len(cage) for cage in cages)]
        source = rng.choice(pool or sudokus)
        definitions = []
        for cage in cages:
            target = sum(source[r][c] for r, c in cage)
            if rng.random() < 0.03:
                target += rng.choice((-1, 1))
            definitions.append((target, cage))
        givens = {cell: source[cell[0]][cell[1]]
                  for cell in rng.sample([(r, c) for r in range(4) for c in range(4)], rng.randint(0, 3))}
        expected = frozenset(
            tuple(value for row in sudoku for value in row)
            for sudoku in sudokus
            if all(sudoku[r][c] == v for (r, c), v in givens.items())
            and all(len({sudoku[r][c] for r, c in cage}) == len(cage)
                    and sum(sudoku[r][c] for r, c in cage) == target for target, cage in definitions)
        )
        if len(expected) > 2:
            continue
        produced += 1

        def make(variant, definitions=definitions, givens=givens):
            grid = variant([SumCellPair(target, list(cage)) for target, cage in definitions], 2, 2, 2, 2)
            for cell, value in givens.items():
                grid[cell] = value
            return grid

        yield make, expected


def test_killer_matches_filtered_sudoku_table():
    assert len(_sudokus_4x4()) == 288
    for make, expected in _killer_instances(20260923, 10):
        _check(make, _decode_4x4, expected, KillerSudoku)
    _assert_mixed_batch()
