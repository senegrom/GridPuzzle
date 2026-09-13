"""Turn cached janko.at data blocks into puzzle payloads.

The blocks are plain text with ``[problem]``, sometimes ``[areas]``, and
``[solution]``. Each family has its own notation; the solution is used to check
the reading, so a misparsed puzzle is dropped rather than stored as a wrong
target.
"""
from __future__ import annotations

from pathlib import Path

JANKO_CACHE = Path("E:/tmp-claude/corpus-cache/janko")


def sections(text: str) -> tuple[dict, dict]:
    meta: dict = {}
    blocks: dict = {}
    current = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            name = stripped[1:-1]
            current = None if name in ("begin", "end") else name
            if current:
                blocks.setdefault(current, [])
            continue
        if current:
            blocks[current].append(stripped.split())
        else:
            key, _, value = stripped.partition(" ")
            meta[key] = value.strip()
    return meta, blocks


def shape(meta: dict, grid: list) -> tuple[int, int]:
    if "size" in meta:
        size = int(meta["size"])
        return size, size
    return int(meta.get("rows", len(grid))), int(meta.get("cols", len(grid[0]) if grid else 0))


def payload(kind: str, rows: int, cols: int, cells: list, **extra) -> dict:
    base = {"version": 1, "type": kind, "rows": rows, "cols": cols, "cells": list(cells),
            "cages": [], "inequalities": [], "clues": []}
    base.update(extra)
    return base


def digits(grid: list) -> list:
    return [None if token == "-" else int(token) for row in grid for token in row]


def runs(black: set, rows: int, cols: int, horizontal: bool) -> list[list[int]]:
    found = []
    for a in range(rows if horizontal else cols):
        current: list[int] = []
        for b in range(cols if horizontal else rows):
            cell = a * cols + b if horizontal else b * cols + a
            if cell in black:
                if current:
                    found.append(current)
                current = []
            else:
                current.append(cell)
        if current:
            found.append(current)
    return found


# --------------------------------------------------------------------------
# Families
# --------------------------------------------------------------------------
def read_sudoku(meta: dict, blocks: dict):
    grid = blocks.get("problem") or []
    rows, cols = shape(meta, grid)
    if rows != cols or rows not in (4, 6, 9, 12, 16):
        return None
    box = {4: (2, 2), 6: (2, 3), 9: (3, 3), 12: (3, 4), 16: (4, 4)}[rows]
    cells = digits(grid)
    solution = digits(blocks["solution"]) if "solution" in blocks else None
    return payload("sudoku", rows, cols, cells, boxRows=box[0], boxCols=box[1]), solution


def read_kakuro(meta: dict, blocks: dict):
    """Only the solution is published; the printed clue sums follow from it."""
    grid = blocks.get("solution") or []
    rows, cols = shape(meta, grid)
    flat = [row[index] for row in grid for index in range(len(row))]
    if len(flat) != rows * cols:
        return None
    black = {index for index, token in enumerate(flat) if token == "-"}
    values = {index: int(token) for index, token in enumerate(flat) if token != "-"}
    clues: dict = {}
    for horizontal in (True, False):
        for run in runs(black, rows, cols, horizontal):
            if len(run) < 2:
                return None                      # a one-cell run has no printable clue
            head = run[0] - (1 if horizontal else cols)
            if head < 0 or head not in black:
                return None
            total = sum(values[cell] for cell in run)
            if not 1 <= total <= 45:
                return None
            clues.setdefault(head, {"cell": head})["across" if horizontal else "down"] = total
    cells = ["#" if index in black else None for index in range(rows * cols)]
    solution = ["#" if index in black else values[index] for index in range(rows * cols)]
    return payload("kakuro", rows, cols, cells, clues=sorted(clues.values(), key=lambda c: c["cell"])), solution


def read_str8ts(meta: dict, blocks: dict):
    grid = blocks.get("problem") or []
    rows, cols = shape(meta, grid)
    if rows != cols or not 2 <= rows <= 9:
        return None
    cells: list = []
    black = []
    for index, token in enumerate(token for row in grid for token in row):
        if token.endswith("x"):
            black.append(index)
            head = token[:-1]
            cells.append(int(head) if head.isdigit() else "#")
        elif token == "-":
            cells.append(None)
        elif token.isdigit():
            cells.append(int(token))
        else:
            return None
    if len(cells) != rows * cols:
        return None
    solution = None
    if "solution" in blocks:
        raw = [token for row in blocks["solution"] for token in row]
        solution = ["#" if token == "-" else int(token) for token in raw]
    return payload("str8ts", rows, cols, cells, black=black), solution


def read_hidato(kind: str):
    def read(meta: dict, blocks: dict):
        grid = blocks.get("problem") or []
        rows, cols = shape(meta, grid)
        cells: list = []
        for token in (token for row in grid for token in row):
            if token in ("-", "."):
                cells.append(None)
            elif token.isdigit():
                cells.append(int(token))
            else:
                cells.append("#")
        if len(cells) != rows * cols:
            return None
        if kind == "numbrix" and any(value == "#" for value in cells):
            return None                          # the app's Numbrix has no blocked cells
        solution = None
        if "solution" in blocks:
            raw = [token for row in blocks["solution"] for token in row]
            solution = [int(token) if token.isdigit() else "#" for token in raw]
        return payload(kind, rows, cols, cells), solution

    return read


def read_kenken(meta: dict, blocks: dict):
    grid = blocks.get("problem") or []
    areas = blocks.get("areas") or []
    rows, cols = shape(meta, grid)
    if not areas or rows != cols:
        return None
    ids = [int(token) for row in areas for token in row]
    labels = [token for row in grid for token in row]
    if len(ids) != rows * cols or len(labels) != rows * cols:
        return None
    cages = []
    for area in sorted(set(ids)):
        members = [index for index, value in enumerate(ids) if value == area]
        text = next((labels[index] for index in members if labels[index] not in (".", "-")), None)
        if text is None:
            return None
        op = text[-1] if text[-1] in "+-*/x:" else ""
        number = text[:-1] if op else text
        if not number.isdigit():
            return None
        operator = {"+": "+", "-": "-", "*": "*", "x": "*", "/": "/", ":": "/"}.get(op, "")
        if not operator:
            operator = "=" if len(members) == 1 else "+"
        if operator in ("-", "/") and len(members) != 2:
            return None
        if operator == "=" and len(members) != 1:
            return None
        cages.append({"cells": members, "target": int(number), "op": operator})
    solution = digits(blocks["solution"]) if "solution" in blocks else None
    return payload("kenken", rows, cols, [None] * (rows * cols), cages=cages), solution


def read_sumdoku(meta: dict, blocks: dict):
    """Sums over a Latin square; with 9x9 boxes it is a Killer Sudoku."""
    grid = blocks.get("problem") or []
    areas = blocks.get("areas") or []
    rows, cols = shape(meta, grid)
    if not areas or rows != cols:
        return None
    ids = [int(token) for row in areas for token in row]
    labels = [token for row in grid for token in row]
    if len(ids) != rows * cols or len(labels) != rows * cols:
        return None
    cages = []
    for area in sorted(set(ids)):
        members = [index for index, value in enumerate(ids) if value == area]
        text = next((labels[index] for index in members if labels[index] not in (".", "-")), None)
        if text is None or not text.isdigit():
            return None
        cages.append({"cells": members, "target": int(text), "op": "+"})
    solution = digits(blocks["solution"]) if "solution" in blocks else None
    boxed = False
    if rows == 9 and solution and all(isinstance(v, int) for v in solution):
        boxed = all(len({solution[(br + r) * 9 + bc + c] for r in range(3) for c in range(3)}) == 9
                    for br in (0, 3, 6) for bc in (0, 3, 6))
    if boxed:
        return payload("killersudoku", rows, cols, [None] * (rows * cols),
                       boxRows=3, boxCols=3, cages=cages), solution
    return payload("kenken", rows, cols, [None] * (rows * cols), cages=cages), solution


def read_futoshiki(meta: dict, blocks: dict):
    """The block is a (2n-1) grid: cells on even rows and columns, and between
    them a compass letter naming the side that holds the smaller value."""
    grid = blocks.get("problem") or []
    size = int(meta.get("size", (len(grid) + 1) // 2))
    if len(grid) != 2 * size - 1 or any(len(row) != 2 * size - 1 for row in grid):
        return None
    cells: list = []
    for r in range(size):
        for c in range(size):
            token = grid[2 * r][2 * c]
            cells.append(int(token) if token.isdigit() else None)
    pairs = []
    for r in range(2 * size - 1):
        for c in range(2 * size - 1):
            token = grid[r][c]
            if token in ("w", "e") and r % 2 == 0 and c % 2 == 1:
                left = (r // 2) * size + (c - 1) // 2
                right = left + 1
                pairs.append({"less": left, "greater": right} if token == "w"
                             else {"less": right, "greater": left})
            elif token in ("n", "s") and r % 2 == 1 and c % 2 == 0:
                above = (r // 2) * size + c // 2
                below = above + size
                pairs.append({"less": above, "greater": below} if token == "n"
                             else {"less": below, "greater": above})
    solution = digits(blocks["solution"]) if "solution" in blocks else None
    if solution and any(solution[p["less"]] > solution[p["greater"]] for p in pairs):
        return None                              # the reading disagrees with the printed answer
    return payload("futoshiki", size, size, cells, inequalities=pairs), solution


def read_slitherlink(meta: dict, blocks: dict):
    grid = blocks.get("problem") or []
    rows, cols = shape(meta, grid)
    cells = [None if token == "-" else int(token) for row in grid for token in row]
    if len(cells) != rows * cols or any(isinstance(v, int) and not 0 <= v <= 3 for v in cells):
        return None
    return payload("slitherlink", rows, cols, cells), None


READERS = {
    "sudoku": read_sudoku,
    "kakuro": read_kakuro,
    "str8ts": read_str8ts,
    "hidato": read_hidato("hidato"),
    "numbrix": read_hidato("numbrix"),
    "kenken": read_kenken,
    "killersudoku": read_sumdoku,
    "futoshiki": read_futoshiki,
    "slitherlink": read_slitherlink,
}


def consistent(puzzle: dict, solution: list | None) -> bool:
    """Every printed clue must appear in the published solution."""
    if not solution or len(solution) != len(puzzle["cells"]):
        return True
    for index, value in enumerate(puzzle["cells"]):
        if value is None:
            continue
        if value == "#":
            if solution[index] != "#":
                return False
        elif solution[index] != value:
            return False
    return True


def parse_janko(cache: Path, limit: int | None = None) -> dict:
    """{(collection, family): [(name, payload, solution), ...]} from the cache.

    ``collection`` is the janko section the page came from and ``family`` the
    type the puzzle actually is: a Sumdoku page is a sum puzzle over a Latin
    square, which this app models as KenKen unless its 9x9 solution also
    satisfies boxes."""
    collected: dict = {}
    for folder in sorted(p for p in cache.glob("*") if p.is_dir()):
        collection = folder.name
        reader = READERS.get(collection)
        if reader is None:
            continue
        taken: dict = {}
        for path in sorted(folder.glob("*.txt")):
            meta, blocks = sections(path.read_text(encoding="utf-8"))
            try:
                parsed = reader(meta, blocks)
            except (ValueError, KeyError, IndexError):
                parsed = None
            if parsed is None:
                continue
            puzzle, solution = parsed
            if not consistent(puzzle, solution):
                continue
            key = (collection, puzzle["type"])
            if limit and len(taken.get(key, [])) >= limit:
                continue
            taken.setdefault(key, []).append((f"janko-{collection}-{path.stem}", puzzle, solution))
        collected.update(taken)
    return collected
