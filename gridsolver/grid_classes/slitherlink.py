"""Slitherlink edge-grid implementation."""

from collections.abc import Sequence
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.rules.topology import AllowedValueCountRule, SingleLoopRule


type EdgeKey = tuple[str, int, int]


class Slitherlink(CompactGrid):
    """Binary edge puzzle whose selected edges form one loop.

    Compact values use ``1`` for an absent edge and ``2`` for a selected edge,
    preserving the solver's positive-value invariant.
    """

    OFF = 1
    ON = 2

    def __init__(self, clues: Sequence[Sequence[object]]) -> None:
        rows = tuple(tuple(row) for row in clues)
        if not rows or not rows[0]:
            raise ValueError("Slitherlink clue grid must not be empty")
        board_cols = len(rows[0])
        if any(len(row) != board_cols for row in rows):
            raise ValueError("Slitherlink clue rows must have equal length")
        board_rows = len(rows)

        normalized_clues: list[tuple[int | None, ...]] = []
        for row_index, row in enumerate(rows):
            normalized_row: list[int | None] = []
            for col_index, raw_clue in enumerate(row):
                if raw_clue is None or raw_clue == ".":
                    normalized_row.append(None)
                    continue
                if isinstance(raw_clue, bool) or not isinstance(raw_clue, Integral):
                    try:
                        clue = int(raw_clue)
                    except (TypeError, ValueError) as exc:
                        raise ValueError(
                            f"Cannot parse Slitherlink clue {raw_clue!r} at "
                            f"{(row_index, col_index)}"
                        ) from exc
                else:
                    clue = int(raw_clue)
                if not 0 <= clue <= 4:
                    raise ValueError("Slitherlink clues must lie between 0 and 4")
                normalized_row.append(clue)
            normalized_clues.append(tuple(normalized_row))

        edge_keys: list[EdgeKey] = []
        endpoints: list[tuple[int, int]] = []
        vertex_cols = board_cols + 1
        for row in range(board_rows + 1):
            for col in range(board_cols):
                edge_keys.append(("H", row, col))
                endpoints.append(
                    (row * vertex_cols + col, row * vertex_cols + col + 1)
                )
        for row in range(board_rows):
            for col in range(board_cols + 1):
                edge_keys.append(("V", row, col))
                endpoints.append(
                    (
                        row * vertex_cols + col,
                        (row + 1) * vertex_cols + col,
                    )
                )

        super().__init__(edge_keys, max_elem=2)
        self.board_rows = board_rows
        self.board_cols = board_cols
        self.clues = tuple(normalized_clues)
        self.edge_endpoints = tuple(endpoints)

        rules: list[AllowedValueCountRule | SingleLoopRule] = []
        for row in range(board_rows):
            for col in range(board_cols):
                clue = self.clues[row][col]
                if clue is None:
                    continue
                face_edges = (
                    self.compact_cell(("H", row, col)),
                    self.compact_cell(("H", row + 1, col)),
                    self.compact_cell(("V", row, col)),
                    self.compact_cell(("V", row, col + 1)),
                )
                rules.append(
                    AllowedValueCountRule(
                        self,
                        cells=face_edges,
                        value=self.ON,
                        allowed_counts=(clue,),
                    )
                )

        incident: dict[int, list[int]] = {
            vertex: []
            for vertex in range((board_rows + 1) * (board_cols + 1))
        }
        for cell, (first, second) in enumerate(self.edge_endpoints):
            incident[first].append(cell)
            incident[second].append(cell)
        for edges in incident.values():
            rules.append(
                AllowedValueCountRule(
                    self,
                    cells=edges,
                    value=self.ON,
                    allowed_counts=(0, 2),
                )
            )
        rules.append(
            SingleLoopRule(
                self,
                cells=range(self.len),
                endpoints=self.edge_endpoints,
                selected_value=self.ON,
            )
        )
        self.add_rules_checked(rules)

    def _copy_extra_state_to(self, result: Grid) -> None:
        super()._copy_extra_state_to(result)
        result.board_rows = self.board_rows
        result.board_cols = self.board_cols
        result.clues = self.clues
        result.edge_endpoints = self.edge_endpoints

    @classmethod
    def from_tatham(
        cls,
        rows: int,
        cols: int,
        encoding: str,
    ) -> "Slitherlink":
        if any(
            isinstance(value, bool) or not isinstance(value, Integral)
            for value in (rows, cols)
        ):
            raise TypeError("Tatham dimensions must be integers")
        rows, cols = int(rows), int(cols)
        if rows <= 0 or cols <= 0:
            raise ValueError("Tatham dimensions must be positive")
        if not isinstance(encoding, str):
            raise TypeError("Tatham encoding must be text")

        decoded: list[int | None] = []
        for character in encoding:
            if "0" <= character <= "4":
                decoded.append(int(character))
            elif "a" <= character <= "z":
                decoded.extend([None] * (ord(character) - ord("a") + 1))
            elif "A" <= character <= "Z":
                decoded.extend([None] * (ord(character) - ord("A") + 27))
            else:
                raise ValueError(
                    f"Unsupported character {character!r} in Tatham encoding"
                )
        expected = rows * cols
        if len(decoded) != expected:
            raise ValueError(
                f"Tatham encoding expands to {len(decoded)} clues, expected {expected}"
            )
        return cls(
            tuple(
                tuple(decoded[index : index + cols])
                for index in range(0, expected, cols)
            )
        )

    def selected_edges(self, values: Sequence[int]) -> frozenset[EdgeKey]:
        keyed = self.values_by_key(values)
        return frozenset(
            edge for edge, value in keyed.items() if value == self.ON
        )

    def format_solution(self, values: Sequence[int]) -> str:
        keyed = self.values_by_key(values)

        def selected(edge: EdgeKey) -> bool:
            return keyed[edge] == self.ON

        lines: list[str] = []
        for row in range(self.board_rows + 1):
            horizontal = []
            for col in range(self.board_cols):
                horizontal.append("+")
                horizontal.append(
                    "---" if selected(("H", row, col)) else "   "
                )
            horizontal.append("+")
            lines.append("".join(horizontal))

            if row == self.board_rows:
                continue
            interior = []
            for col in range(self.board_cols):
                interior.append(
                    "|" if selected(("V", row, col)) else " "
                )
                clue = self.clues[row][col]
                interior.append(f" {clue if clue is not None else ' '} ")
            interior.append(
                "|" if selected(("V", row, self.board_cols)) else " "
            )
            lines.append("".join(interior))
        return "\n".join(lines)
