"""Generate valid puzzles for several browser-supported families as payloads.

Str8ts is missing on purpose: carving a Latin square almost never leaves valid
consecutive compartments, and janko.at supplies real Str8ts puzzles instead.

Each generator returns ``(payload, solution)`` where ``payload`` is exactly the
dictionary ``gridsolver.web_api.build_grid`` accepts and ``solution`` is the
complete grid the puzzle was cut from, or ``None`` when the family has no
per-cell solution (Slitherlink). The puzzles are correct by construction: they
are carved out of a solved grid, never searched for.
"""
from __future__ import annotations

import random


def payload(kind: str, rows: int, cols: int, cells: list, **extra) -> dict:
    base = {"version": 1, "type": kind, "rows": rows, "cols": cols, "cells": list(cells),
            "cages": [], "inequalities": [], "clues": []}
    base.update(extra)
    return base


def latin_square(rng: random.Random, n: int, box: tuple[int, int] | None = None) -> list[list[int]]:
    """Randomised backtracking; with ``box`` the boxes hold distinct values too."""
    square = [[0] * n for _ in range(n)]
    box_rows, box_cols = box or (0, 0)

    def allowed(r: int, c: int, value: int) -> bool:
        if any(square[r][x] == value for x in range(n)):
            return False
        if any(square[y][c] == value for y in range(n)):
            return False
        if box:
            r0, c0 = r - r % box_rows, c - c % box_cols
            for y in range(r0, r0 + box_rows):
                for x in range(c0, c0 + box_cols):
                    if square[y][x] == value:
                        return False
        return True

    def fill(index: int) -> bool:
        if index == n * n:
            return True
        r, c = divmod(index, n)
        values = list(range(1, n + 1))
        rng.shuffle(values)
        for value in values:
            if allowed(r, c, value):
                square[r][c] = value
                if fill(index + 1):
                    return True
                square[r][c] = 0
        return False

    if not fill(0):
        raise RuntimeError(f"no Latin square of size {n}")
    return square


def carve(rng: random.Random, solution: list[list[int]], keep: float) -> list:
    """Flatten a solved grid, keeping a share of the values as printed clues."""
    n = len(solution)
    cells = [value for row in solution for value in row]
    order = list(range(len(cells)))
    rng.shuffle(order)
    for index in order[: int(len(cells) * (1 - keep))]:
        cells[index] = None
    del n
    return cells


def neighbours(cell: int, rows: int, cols: int, diagonal: bool = False):
    r, c = divmod(cell, cols)
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if diagonal:
        steps += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    for dr, dc in steps:
        y, x = r + dr, c + dc
        if 0 <= y < rows and 0 <= x < cols:
            yield y * cols + x


def partition(rng: random.Random, rows: int, cols: int, largest: int,
              *, distinct_values: list[int] | None = None) -> list[list[int]]:
    """Grow connected cages, optionally keeping witness values distinct.

    Killer cages require distinct digits even across different Sudoku houses.
    KenKen does not: keep its unrestricted partitioning when no values are given.
    """
    free = set(range(rows * cols))
    cages = []
    while free:
        seed = rng.choice(sorted(free))
        cage = [seed]
        free.discard(seed)
        while len(cage) < rng.randint(1, largest):
            used = {distinct_values[i] for i in cage} if distinct_values is not None else set()
            options = [n for cell in cage for n in neighbours(cell, rows, cols)
                       if n in free and (distinct_values is None or distinct_values[n] not in used)]
            if not options:
                break
            chosen = rng.choice(options)
            cage.append(chosen)
            free.discard(chosen)
        cages.append(sorted(cage))
    return cages


# --------------------------------------------------------------------------
# Families
# --------------------------------------------------------------------------
def gen_sudoku(rng: random.Random, size: int = 9) -> tuple[dict, list]:
    box = {4: (2, 2), 6: (2, 3), 9: (3, 3), 12: (3, 4), 16: (4, 4)}[size]
    solution = latin_square(rng, size, box)
    cells = carve(rng, solution, keep=rng.uniform(0.3, 0.45))
    return (payload("sudoku", size, size, cells, boxRows=box[0], boxCols=box[1]),
            [v for row in solution for v in row])


def gen_latinsquare(rng: random.Random, size: int = 6) -> tuple[dict, list]:
    solution = latin_square(rng, size)
    return (payload("latinsquare", size, size, carve(rng, solution, keep=rng.uniform(0.35, 0.5))),
            [v for row in solution for v in row])


def gen_killersudoku(rng: random.Random, size: int = 9) -> tuple[dict, list]:
    box = {4: (2, 2), 6: (2, 3), 9: (3, 3)}[size]
    solution = latin_square(rng, size, box)
    flat = [v for row in solution for v in row]
    cages = [{"cells": cage, "target": sum(flat[i] for i in cage), "op": "+"}
             for cage in partition(rng, size, size, largest=4, distinct_values=flat)]
    return (payload("killersudoku", size, size, [None] * (size * size),
                    boxRows=box[0], boxCols=box[1], cages=cages), flat)


def gen_kenken(rng: random.Random, size: int = 5) -> tuple[dict, list]:
    solution = latin_square(rng, size)
    flat = [v for row in solution for v in row]
    cages = []
    for cage in partition(rng, size, size, largest=3):
        values = [flat[i] for i in cage]
        if len(cage) == 1:
            cages.append({"cells": cage, "target": values[0], "op": "="})
            continue
        if len(cage) == 2:
            a, b = sorted(values, reverse=True)
            choices = [("+", a + b), ("*", a * b), ("-", a - b)]
            if b and a % b == 0:
                choices.append(("/", a // b))
            op, target = rng.choice(choices)
        else:
            op = rng.choice(["+", "*"])
            target = sum(values) if op == "+" else eval("*".join(map(str, values)))  # noqa: S307
        cages.append({"cells": cage, "target": target, "op": op})
    return payload("kenken", size, size, [None] * (size * size), cages=cages), flat


def gen_futoshiki(rng: random.Random, size: int = 5) -> tuple[dict, list]:
    solution = latin_square(rng, size)
    flat = [v for row in solution for v in row]
    pairs = []
    for cell in range(size * size):
        r, c = divmod(cell, size)
        for other in ((cell + 1) if c + 1 < size else None, (cell + size) if r + 1 < size else None):
            if other is not None and rng.random() < 0.28:
                a, b = (cell, other) if flat[cell] < flat[other] else (other, cell)
                pairs.append({"less": a, "greater": b})
    cells = carve(rng, solution, keep=rng.uniform(0.1, 0.25))
    return payload("futoshiki", size, size, cells, inequalities=pairs), flat


def gen_kakuro(rng: random.Random, size: int = 7) -> tuple[dict, list]:
    """Black first row and column, then a few interior blocks; every white run
    holds distinct digits, which is what the printed clue sums describe."""
    for _ in range(200):
        black = {cell for cell in range(size * size) if cell < size or cell % size == 0}
        for cell in range(size * size):
            if cell not in black and rng.random() < 0.12:
                black.add(cell)

        def runs(horizontal: bool) -> list[list[int]]:
            found, current = [], []
            outer, inner = (size, size) if horizontal else (size, size)
            for a in range(outer):
                current = []
                for b in range(inner):
                    cell = a * size + b if horizontal else b * size + a
                    if cell in black:
                        if len(current) > 1:
                            found.append(current)
                        elif current:
                            return []          # a run of one has no valid clue
                        current = []
                    else:
                        current.append(cell)
                if len(current) > 1:
                    found.append(current)
                elif current:
                    return []
            return found

        across, down = runs(True), runs(False)
        if not across or not down:
            continue
        white = sorted(set(range(size * size)) - black)
        values: dict[int, int] = {}
        groups = {cell: [run for run in across + down if cell in run] for cell in white}

        def place(index: int) -> bool:
            if index == len(white):
                return True
            cell = white[index]
            digits = list(range(1, 10))
            rng.shuffle(digits)
            for digit in digits:
                if all(values.get(other) != digit for run in groups[cell] for other in run if other != cell):
                    values[cell] = digit
                    if place(index + 1):
                        return True
                    del values[cell]
            return False

        if not place(0):
            continue
        clues = []
        for run in across:
            clues.append({"cell": run[0] - 1, "across": sum(values[c] for c in run)})
        for run in down:
            clue = next((c for c in clues if c["cell"] == run[0] - size), None)
            if clue is None:
                clues.append({"cell": run[0] - size, "down": sum(values[c] for c in run)})
            else:
                clue["down"] = sum(values[c] for c in run)
        cells = ["#" if cell in black else None for cell in range(size * size)]
        solution = [values.get(cell, "#") for cell in range(size * size)]
        return payload("kakuro", size, size, cells, clues=clues), solution
    raise RuntimeError("no Kakuro layout found")


def snake(rng: random.Random, rows: int, cols: int) -> list[int]:
    """Boustrophedon path, randomly oriented: always exists, always fast."""
    order = []
    for r in range(rows):
        row = [r * cols + c for c in range(cols)]
        order.extend(row if r % 2 == 0 else row[::-1])
    if rng.random() < 0.5:                       # start from the far end
        order.reverse()
    if rng.random() < 0.5 and rows == cols:      # walk the columns instead
        order = [(cell % cols) * cols + cell // cols for cell in order]
    return order


def hamiltonian(rng: random.Random, rows: int, cols: int, diagonal: bool,
                blocked: set[int], budget: int = 60000) -> list[int] | None:
    """A path through every open cell by bounded randomised depth-first search.

    The search is capped, because a random walk on a grid graph can spend a
    very long time backtracking; callers fall back to a snake path."""
    cells = [cell for cell in range(rows * cols) if cell not in blocked]
    options = {cell: [n for n in neighbours(cell, rows, cols, diagonal) if n not in blocked]
               for cell in cells}
    steps = 0
    for _ in range(12):
        start = rng.choice(cells)
        path, seen = [start], {start}
        stack = [iter(rng.sample(options[start], len(options[start])))]
        while stack:
            if len(path) == len(cells):
                return path
            steps += 1
            if steps > budget:
                return None
            try:
                nxt = next(stack[-1])
            except StopIteration:
                stack.pop()
                seen.discard(path.pop())
                continue
            if nxt in seen:
                continue
            path.append(nxt)
            seen.add(nxt)
            stack.append(iter(rng.sample(options[nxt], len(options[nxt]))))
    return None


def gen_path(kind: str, rng: random.Random, rows: int = 6, cols: int = 6) -> tuple[dict, list]:
    diagonal = kind == "hidato"
    blocked: set[int] = set()
    if diagonal and rng.random() < 0.5:
        blocked = {rng.choice([0, cols - 1, (rows - 1) * cols, rows * cols - 1])}
    path = hamiltonian(rng, rows, cols, diagonal, blocked)
    if path is None:
        blocked = set()
        path = hamiltonian(rng, rows, cols, diagonal, blocked) or snake(rng, rows, cols)
    if len(path) != rows * cols:
        blocked = set(range(rows * cols)) - set(path)
    solution: list = ["#" if cell in blocked else 0 for cell in range(rows * cols)]
    for step, cell in enumerate(path, start=1):
        solution[cell] = step
    cells: list = list(solution)
    keep = {path[0], path[-1]}
    for cell in path[1:-1]:
        if rng.random() > 0.3:
            cells[cell] = None
        else:
            keep.add(cell)
    return payload(kind, rows, cols, cells), solution


def gen_hidato(rng: random.Random, size: int = 6) -> tuple[dict, list]:
    return gen_path("hidato", rng, size, size)


def gen_numbrix(rng: random.Random, size: int = 6) -> tuple[dict, list]:
    return gen_path("numbrix", rng, size, size)


def gen_slitherlink(rng: random.Random, rows: int = 7, cols: int = 7) -> tuple[dict, None]:
    """Clues come from the boundary of a random simply connected blob, which is
    a valid single loop, so every printed number is consistent by construction."""
    for _ in range(200):
        inside = {rng.randrange(rows * cols)}
        while len(inside) < rng.randint(rows * cols // 3, rows * cols * 2 // 3):
            options = [n for cell in inside for n in neighbours(cell, rows, cols) if n not in inside]
            if not options:
                break
            inside.add(rng.choice(options))
        outside = {cell for cell in range(rows * cols) if cell not in inside}
        if not outside:
            continue
        # Reject blobs with a hole: every outside cell must reach the border.
        reached, queue = set(), [c for c in outside if c < cols or c >= (rows - 1) * cols or c % cols in (0, cols - 1)]
        reached.update(queue)
        while queue:
            for n in neighbours(queue.pop(), rows, cols):
                if n in outside and n not in reached:
                    reached.add(n)
                    queue.append(n)
        if reached != outside:
            continue
        cells: list = []
        for cell in range(rows * cols):
            r, c = divmod(cell, cols)
            count = 0
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                y, x = r + dr, c + dc
                other = y * cols + x if 0 <= y < rows and 0 <= x < cols else None
                if (cell in inside) != (other in inside if other is not None else False):
                    count += 1
            cells.append(count if rng.random() < 0.55 else None)
        if not any(isinstance(v, int) for v in cells):
            continue
        return payload("slitherlink", rows, cols, cells), None
    raise RuntimeError("no Slitherlink loop found")


FAMILIES = {
    "sudoku": lambda rng: gen_sudoku(rng, rng.choice([9, 9, 9, 6, 4])),
    "latinsquare": lambda rng: gen_latinsquare(rng, rng.choice([4, 5, 6, 7])),
    "killersudoku": lambda rng: gen_killersudoku(rng, rng.choice([9, 6, 4])),
    "kenken": lambda rng: gen_kenken(rng, rng.choice([4, 5, 6])),
    "futoshiki": lambda rng: gen_futoshiki(rng, rng.choice([4, 5, 6])),
    "kakuro": lambda rng: gen_kakuro(rng, rng.choice([6, 7, 8])),
    "hidato": lambda rng: gen_hidato(rng, rng.choice([5, 6, 7])),
    "numbrix": lambda rng: gen_numbrix(rng, rng.choice([5, 6, 7])),
    "slitherlink": lambda rng: gen_slitherlink(rng, rng.choice([5, 6, 7]), rng.choice([5, 6, 7])),
}
