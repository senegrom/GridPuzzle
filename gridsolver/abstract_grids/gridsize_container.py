from numbers import Integral


class _SizeField:
    """Write-once metadata without intercepting unrelated Grid mutations."""

    __slots__ = ("name",)

    def __set_name__(self, owner: type, name: str) -> None:
        self.name = name

    # Deliberately no __get__: reads use the existing instance dictionary,
    # without a Python getter. Keeping the storage layout also preserves
    # ordinary copies, existing pickles and Grid's field-copying clone path.
    def __set__(self, instance: "GridSizeContainer", value: int) -> None:
        if self.name in instance.__dict__:
            raise AttributeError(f"{self.name} is read-only after construction")
        instance.__dict__[self.name] = value

    def __delete__(self, instance: "GridSizeContainer") -> None:
        raise AttributeError(f"{self.name} is read-only after construction")


class GridSizeContainer:
    rows = _SizeField()
    cols = _SizeField()
    max_elem = _SizeField()
    len = _SizeField()

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
