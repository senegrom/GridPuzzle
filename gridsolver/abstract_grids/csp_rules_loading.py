"""Load the retained CSP-Rules ``.clp`` puzzle formats."""

from __future__ import annotations

import json
import re
from pathlib import Path

from gridsolver.abstract_grids.grid import Grid


_TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|//|/|\(|\)|[^\s()/]+')
_SOLVE_START = re.compile(r"\((solve(?:-tatham)?)\b", re.IGNORECASE)


def _without_line_comments(text: str) -> str:
    """Blank CSP-Rules line comments while preserving offsets and strings.

    Retained CLP sources use ``;`` as the native line-comment marker and also
    contain whole-line ``#`` comments.  Keeping newlines and replacing comment
    text with spaces lets the form scanner use original offsets while ensuring
    fake ``(solve ...)`` text and parentheses in comments are inert.  Comment
    markers inside quoted Tatham encodings remain literal.
    """
    characters = list(text)
    in_string = False
    escaped = False
    in_comment = False
    line_has_code = False

    for index, character in enumerate(characters):
        if in_comment:
            if character in "\r\n":
                in_comment = False
                line_has_code = False
            else:
                characters[index] = " "
            continue

        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue

        if character == '"':
            in_string = True
            line_has_code = True
        elif character == ";" or (character == "#" and not line_has_code):
            characters[index] = " "
            in_comment = True
        elif character in "\r\n":
            line_has_code = False
        elif character == "\ufeff" and not line_has_code:
            # A UTF-8 BOM is metadata, not code before a leading # comment.
            continue
        elif not character.isspace():
            line_has_code = True

    return "".join(characters)


def _solve_start(text: str) -> re.Match[str] | None:
    """Find the first solve form outside quoted strings and comments."""
    in_string = False
    escaped = False
    for index, character in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "(":
            match = _SOLVE_START.match(text, index)
            if match is not None:
                return match
    return None


def is_csp_rules_text(text: object) -> bool:
    """Return whether the input starts with a supported CSP-Rules form.

    Historical class-prefixed puzzle files often retain solver transcripts that
    contain later ``(solve ...)`` text. Detection must therefore inspect the
    first meaningful input line rather than searching the entire file or relying
    on a ``.clp`` suffix.
    """
    if not isinstance(text, str):
        return False
    uncommented = _without_line_comments(text)
    for line in uncommented.splitlines():
        stripped = line.strip().lstrip("\ufeff")
        if not stripped:
            continue
        return _SOLVE_START.match(stripped) is not None
    return False


def _first_solve_form(text: str) -> str:
    if not isinstance(text, str):
        raise TypeError("CSP-Rules input must be text")
    uncommented = _without_line_comments(text)
    match = _solve_start(uncommented)
    if match is None:
        raise ValueError("CSP-Rules input contains no solve form")

    start = match.start()
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(uncommented)):
        character = uncommented[index]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return uncommented[start : index + 1]
    raise ValueError("CSP-Rules solve form is not closed")


def _tokens(text: str) -> tuple[str, ...]:
    form = _first_solve_form(text)
    tokens = tuple(_TOKEN.findall(form))
    if len(tokens) < 3 or tokens[0] != "(" or tokens[-1] != ")":
        raise ValueError("Malformed CSP-Rules solve form")
    return tokens


def _integer(token: str, description: str) -> int:
    if not token or any(character not in "0123456789" for character in token):
        raise ValueError(f"Expected {description}, got {token!r}")
    return int(token)


def _path_puzzle(payload: tuple[str, ...]) -> Grid:
    if len(payload) < 4:
        raise ValueError("Path solve form is missing its header")
    family = payload[0].lower()
    if payload[1].lower() != "topological":
        raise ValueError("Only the CSP-Rules topological path model is supported")
    side = _integer(payload[2], "path side length")
    expected_playable = _integer(payload[3], "playable-cell count")
    raw_board = payload[4:]
    if len(raw_board) != side * side:
        raise ValueError(
            f"Expected {side * side} path cells, got {len(raw_board)}"
        )

    board: list[list[object]] = []
    for row in range(side):
        parsed_row: list[object] = []
        for token in raw_board[row * side : (row + 1) * side]:
            if token == ".":
                parsed_row.append(0)
            elif token.upper() == "B":
                parsed_row.append("B")
            else:
                parsed_row.append(_integer(token, "path clue"))
        board.append(parsed_row)

    if family == "hidato":
        from gridsolver.grid_classes.path_puzzles import Hidato

        grid = Hidato.from_board(board)
    elif family == "numbrix":
        from gridsolver.grid_classes.path_puzzles import Numbrix

        grid = Numbrix.from_board(board)
    else:
        raise ValueError(f"Unsupported path family {payload[0]!r}")
    if grid.max_elem != expected_playable:
        raise ValueError(
            f"Header declares {expected_playable} playable cells, "
            f"board contains {grid.max_elem}"
        )
    return grid


def _split_kakuro_sections(
    payload: tuple[str, ...],
    size: int,
) -> tuple[tuple[tuple[str, ...], ...], tuple[tuple[str, ...], ...]]:
    sections: list[list[tuple[str, ...]]] = [[]]
    row: list[str] = []
    for token in payload:
        if token not in {"/", "//"}:
            row.append(token)
            continue
        if len(row) != size:
            raise ValueError(
                f"Expected {size} Kakuro tokens per row, got {len(row)}"
            )
        sections[-1].append(tuple(row))
        row = []
        if token == "//":
            sections.append([])
    if row:
        raise ValueError("Kakuro rows must end in / or //")
    while sections and not sections[-1]:
        sections.pop()
    if len(sections) != 2:
        raise ValueError("Kakuro input must contain horizontal and vertical sections")
    if any(len(section) != size - 1 for section in sections):
        raise ValueError(
            f"A size-{size} Kakuro needs {size - 1} rows in each section"
        )
    return tuple(map(tuple, sections))


def _kakuro(payload: tuple[str, ...]) -> Grid:
    if not payload:
        raise ValueError("Kakuro solve form is missing its size")
    size = _integer(payload[0], "Kakuro size")
    horizontal, vertical = _split_kakuro_sections(payload[1:], size)

    valid_token = lambda token: token in {".", "B", "b"} or token.isascii() and token.isdigit()
    if any(
        not valid_token(token)
        for section in (horizontal, vertical)
        for row in section
        for token in row
    ):
        raise ValueError("Kakuro sections may contain only B, ., and integer clues")

    from gridsolver.grid_classes.kakuro import Kakuro, KakuroRun

    horizontal_white: set[tuple[int, int]] = set()
    vertical_white: set[tuple[int, int]] = set()
    runs: list[KakuroRun] = []

    for board_row, row in enumerate(horizontal, start=1):
        for col, token in enumerate(row):
            if token == ".":
                horizontal_white.add((board_row, col))
                continue
            if token.upper() == "B":
                continue
            target = _integer(token, "horizontal Kakuro clue")
            cells: list[tuple[int, int]] = []
            next_col = col + 1
            while next_col < size and row[next_col] == ".":
                cells.append((board_row, next_col))
                next_col += 1
            if not cells:
                raise ValueError(
                    f"Horizontal Kakuro clue {target} at {(board_row, col)} "
                    "has no run"
                )
            runs.append(KakuroRun(target, tuple(cells)))

    # CSP-Rules stores the vertical section transposed: one line per board
    # column (excluding the all-black first column), with board rows as tokens.
    for board_col, column in enumerate(vertical, start=1):
        for row, token in enumerate(column):
            if token == ".":
                vertical_white.add((row, board_col))
                continue
            if token.upper() == "B":
                continue
            target = _integer(token, "vertical Kakuro clue")
            cells: list[tuple[int, int]] = []
            next_row = row + 1
            while next_row < size and column[next_row] == ".":
                cells.append((next_row, board_col))
                next_row += 1
            if not cells:
                raise ValueError(
                    f"Vertical Kakuro clue {target} at {(row, board_col)} "
                    "has no run"
                )
            runs.append(KakuroRun(target, tuple(cells)))

    if horizontal_white != vertical_white:
        raise ValueError(
            "Horizontal and vertical Kakuro sections disagree on white cells"
        )
    return Kakuro(size, size, horizontal_white, runs)


def _plain_slitherlink(payload: tuple[str, ...]) -> Grid:
    if len(payload) < 2:
        raise ValueError("Slitherlink solve form is missing its dimensions")
    rows = _integer(payload[0], "Slitherlink row count")
    cols = _integer(payload[1], "Slitherlink column count")
    raw_clues = payload[2:]
    if len(raw_clues) != rows * cols:
        raise ValueError(
            f"Expected {rows * cols} Slitherlink clues, got {len(raw_clues)}"
        )
    clues: list[list[int | None]] = []
    for row in range(rows):
        parsed_row: list[int | None] = []
        for token in raw_clues[row * cols : (row + 1) * cols]:
            parsed_row.append(
                None if token == "." else _integer(token, "Slitherlink clue")
            )
        clues.append(parsed_row)

    from gridsolver.grid_classes.slitherlink import Slitherlink

    return Slitherlink(clues)


def create_from_csp_rules(text: str) -> Grid:
    """Create a supported grid from the first CSP-Rules solve form in text."""
    tokens = _tokens(text)
    command = tokens[1].lower()
    payload = tokens[2:-1]

    if command == "solve-tatham":
        if len(payload) != 3:
            raise ValueError("Tatham solve form requires rows, columns, and encoding")
        rows = _integer(payload[0], "Tatham row count")
        cols = _integer(payload[1], "Tatham column count")
        try:
            encoding = json.loads(payload[2])
        except json.JSONDecodeError as exc:
            raise ValueError("Malformed quoted Tatham encoding") from exc
        from gridsolver.grid_classes.slitherlink import Slitherlink

        return Slitherlink.from_tatham(rows, cols, encoding)

    if command != "solve":
        raise ValueError(f"Unsupported CSP-Rules command {tokens[1]!r}")
    if not payload:
        raise ValueError("Empty CSP-Rules solve form")
    if payload[0].lower() in {"hidato", "numbrix"}:
        return _path_puzzle(payload)
    if "//" in payload:
        return _kakuro(payload)
    return _plain_slitherlink(payload)


def create_from_csp_rules_file(path: Path | str) -> Grid:
    path = path if isinstance(path, Path) else Path(path)
    return create_from_csp_rules(path.read_text(encoding="utf-8-sig"))
