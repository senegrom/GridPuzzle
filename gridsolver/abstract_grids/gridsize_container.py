from numbers import Integral


class GridSizeContainer:
    def __init__(self, rows: int, cols: int | None = None, max_elem: int | None = None) -> None:
        rows = self._positive_int("rows", rows)
        cols = rows if cols is None else self._positive_int("cols", cols)
        max_elem = min(rows, cols) if max_elem is None else self._positive_int("max_elem", max_elem)

        self.rows = rows
        self.cols = cols
        self.max_elem = max_elem
        self.len = rows * cols

    @staticmethod
    def _positive_int(name: str, value: int) -> int:
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(f"{name} must be an integer")
        value = int(value)
        if value <= 0:
            raise ValueError(f"{name} must be positive")
        return value

    def __len__(self) -> int:
        return self.len
