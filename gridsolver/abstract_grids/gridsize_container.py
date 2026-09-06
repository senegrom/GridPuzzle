from numbers import Integral


_SIZE_FIELDS = frozenset(("rows", "cols", "max_elem", "len"))


class GridSizeContainer:
    # Keep the existing dictionary layout (including pickle/clone format) and
    # direct attribute reads on solver hot paths. Only initial assignment of
    # size metadata is allowed; mutable Grid values do not imply mutable shape.
    def __setattr__(self, name: str, value: object) -> None:
        if name in _SIZE_FIELDS and name in self.__dict__:
            raise AttributeError(f"{name} is read-only after construction")
        object.__setattr__(self, name, value)

    def __delattr__(self, name: str) -> None:
        if name in _SIZE_FIELDS:
            raise AttributeError(f"{name} is read-only after construction")
        object.__delattr__(self, name)

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
