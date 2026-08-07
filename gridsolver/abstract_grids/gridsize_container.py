from typing import Optional


class GridSizeContainer:
    def __init__(self, rows: int, cols: Optional[int] = None, max_elem: Optional[int] = None):
        if cols is None:
            cols = rows
        if max_elem is None:
            max_elem = min(rows, cols)
        if rows <= 0:
            raise ValueError("rows must be positive")
        if cols <= 0:
            raise ValueError("cols must be positive")
        if max_elem <= 0:
            raise ValueError("max_elem must be positive")

        self.rows: int = rows
        self.cols: int = cols
        self.max_elem: int = max_elem
        self.len: int = rows * cols

    def __len__(self) -> int:
        return self.len
