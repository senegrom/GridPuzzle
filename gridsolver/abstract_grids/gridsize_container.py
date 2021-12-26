from typing import Optional


class GridSizeContainer:
    def __init__(self, rows: int, cols: Optional[int] = None, max_elem: Optional[int] = None):
        if cols is None:
            cols = rows
        if max_elem is None:
            max_elem = min(rows, cols)
        assert rows > 0, "x should be > 0"
        assert cols > 0, "y should be > 0"
        assert max_elem > 0, "max_elem should be > 0"

        self.__rows: int = rows
        self.__cols: int = cols
        self.__max_elem: int = max_elem
        self.__len: int = rows * cols

    def __len__(self) -> int:
        return self.__len

    @property
    def rows(self) -> int:
        return self.__rows

    @property
    def cols(self) -> int:
        return self.__cols

    @property
    def max_elem(self) -> int:
        return self.__max_elem

    @property
    def len(self) -> int:
        return self.__len
