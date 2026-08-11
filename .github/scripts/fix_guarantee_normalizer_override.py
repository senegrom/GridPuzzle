"""Preserve the one-argument guarantee-normalizer extension contract."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one marker, found {count}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


grid = Path("gridsolver/abstract_grids/grid.py")
replace_once(
    grid,
    '''    def _normalize_guarantee(
        self,
        guarantee: Guarantee,
        validated_cell_sets: dict[int, frozenset[int]] | None = None,
    ) -> Guarantee:
''',
    '''    def _normalize_guarantee_base(
        self,
        guarantee: Guarantee,
        validated_cell_sets: dict[int, frozenset[int]] | None,
    ) -> Guarantee:
''',
)
replace_once(
    grid,
    '''    def _normalize_guarantees(
        self,
        guarantees: Iterable[Guarantee],
    ) -> tuple[Guarantee, ...]:
        validated_cell_sets: dict[int, frozenset[int]] = {}
        return tuple(
            self._normalize_guarantee(guarantee, validated_cell_sets)
            for guarantee in guarantees
        )

''',
    '''    def _normalize_guarantee(self, guarantee: Guarantee) -> Guarantee:
        """Validate one guarantee through the stable extension hook."""
        return self._normalize_guarantee_base(guarantee, None)

    def _normalize_guarantees(
        self,
        guarantees: Iterable[Guarantee],
    ) -> tuple[Guarantee, ...]:
        # Preserve the historical one-argument override contract. Built-in
        # grids can share exact-frozenset validation across a batch; extension
        # grids still receive exactly one call per guarantee through their
        # custom normalizer.
        if type(self)._normalize_guarantee is not Grid._normalize_guarantee:
            return tuple(
                self._normalize_guarantee(guarantee)
                for guarantee in guarantees
            )

        validated_cell_sets: dict[int, frozenset[int]] = {}
        return tuple(
            self._normalize_guarantee_base(
                guarantee,
                validated_cell_sets,
            )
            for guarantee in guarantees
        )

''',
)

tests = Path("tests/test_path_guarantees.py")
replace_once(
    tests,
    '''    def _normalize_guarantee(
        self,
        guarantee,
        validated_cell_sets=None,
    ):
        self.guarantee_normalizations += 1
        return super()._normalize_guarantee(
            guarantee,
            validated_cell_sets,
        )
''',
    '''    def _normalize_guarantee(self, guarantee):
        self.guarantee_normalizations += 1
        return super()._normalize_guarantee(guarantee)
''',
)
