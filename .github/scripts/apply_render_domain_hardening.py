"""Validate direct pretty-print values, candidates, and inequalities."""

from pathlib import Path
from textwrap import dedent


def lines(*parts: str) -> str:
    return "".join(part + "\n" for part in parts)


path = Path("gridsolver/abstract_grids/pretty_print.py")
text = path.read_text(encoding="utf-8")

constructor_tail = lines(
    "        self.inner_grid_col = self._inner_dimension(",
    "            \"inner_grid_col\",",
    "            self._none_alternate(",
    "                inner_grid_col,",
    "                inherited.inner_grid_col if inherited else None,",
    "                0,",
    "            ),",
    "        )",
)
constructor_new = constructor_tail + lines(
    "",
    "        if not self.print_candidates:",
    "            if self.sep_in_ve and self.inner_grid_col == 0:",
    "                raise ValueError(",
    "                    \"inner_grid_col must be positive when sep_in_ve is enabled\"",
    "                )",
    "            if self.sep_in_ho and self.inner_grid_row == 0:",
    "                raise ValueError(",
    "                    \"inner_grid_row must be positive when sep_in_ho is enabled\"",
    "                )",
)
if text.count(constructor_tail) != 1:
    raise SystemExit("PrettyPrintArgs constructor tail changed")
text = text.replace(constructor_tail, constructor_new, 1)

start = text.index("def _positive_integer(")
end = text.index("def _simple_square(", start)
replacement = dedent('''
    def _positive_integer(name: str, value: int) -> int:
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(f"{name} must be an integer")
        value = int(value)
        if value <= 0:
            raise ValueError(f"{name} must be positive")
        return value


    def _grid_value(name: str, value: object, maximum: int, minimum: int) -> int:
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError(f"{name} must contain integers")
        value = int(value)
        if not minimum <= value <= maximum:
            raise ValueError(
                f"{name} value {value} is outside {minimum}..{maximum}"
            )
        return value


    def _known_values(
        known: Iterable[int],
        expected: int,
        max_elem: int,
    ) -> tuple[int, ...]:
        if isinstance(known, (str, bytes, bytearray)):
            raise TypeError("known must be an iterable of grid values")
        try:
            values = tuple(known)
        except TypeError as exc:
            raise TypeError("known must be an iterable of grid values") from exc
        if len(values) != expected:
            raise ValueError(
                f"Expected {expected} known values, got {len(values)}"
            )
        return tuple(
            _grid_value("known", value, max_elem, 0)
            for value in values
        )


    def _candidate_values(
        candidates: Iterable[Iterable[int]],
        expected: int,
        max_elem: int,
    ) -> tuple[frozenset[int], ...]:
        if isinstance(candidates, (str, bytes, bytearray)):
            raise TypeError("candidates must be an iterable of candidate sets")
        try:
            raw_candidates = tuple(candidates)
        except TypeError as exc:
            raise TypeError(
                "candidates must be an iterable of candidate sets"
            ) from exc
        if len(raw_candidates) != expected:
            raise ValueError(
                f"Expected {expected} candidate sets, got "
                f"{len(raw_candidates)}"
            )

        normalized: list[frozenset[int]] = []
        for cell, raw_values in enumerate(raw_candidates):
            if isinstance(raw_values, (str, bytes, bytearray)):
                raise TypeError(
                    f"candidates[{cell}] must be an iterable of integers"
                )
            try:
                values = tuple(raw_values)
            except TypeError as exc:
                raise TypeError(
                    f"candidates[{cell}] must be an iterable of integers"
                ) from exc
            normalized.append(
                frozenset(
                    _grid_value(
                        f"candidates[{cell}]",
                        value,
                        max_elem,
                        1,
                    )
                    for value in values
                )
            )
        return tuple(normalized)


    def _inequality_pairs(
        ineqs: Iterable[Sequence[int]] | None,
        rows: int,
        expected: int,
    ) -> set[tuple[int, int]]:
        if ineqs is None:
            return set()
        if isinstance(ineqs, (str, bytes, bytearray)):
            raise TypeError("ineqs must be an iterable of directed cell pairs")
        try:
            raw_pairs = tuple(ineqs)
        except TypeError as exc:
            raise TypeError(
                "ineqs must be an iterable of directed cell pairs"
            ) from exc

        normalized: set[tuple[int, int]] = set()
        for raw_pair in raw_pairs:
            if isinstance(raw_pair, (str, bytes, bytearray)):
                raise TypeError("Each inequality must be a two-cell sequence")
            try:
                pair = tuple(raw_pair)
            except TypeError as exc:
                raise TypeError(
                    "Each inequality must be a two-cell sequence"
                ) from exc
            if len(pair) != 2:
                raise ValueError("Each inequality must contain exactly two cells")
            first = _grid_value("inequality cell", pair[0], expected - 1, 0)
            second = _grid_value("inequality cell", pair[1], expected - 1, 0)
            if first == second:
                raise ValueError("Inequality cells must be distinct")

            vertical = (
                abs(first - second) == 1
                and first // rows == second // rows
            )
            horizontal = (
                abs(first - second) == rows
                and first % rows == second % rows
            )
            if not vertical and not horizontal:
                raise ValueError(
                    f"Inequality cells {(first, second)} are not adjacent"
                )
            normalized.add((first, second))
        return normalized


    def pretty_print(
        rows: int,
        cols: int,
        max_elem: int,
        known: Iterable[int],
        candidates: Iterable[Iterable[int]] | None = None,
        args: PrettyPrintArgs | None = None,
        ineqs: Iterable[Sequence[int]] | None = None,
    ) -> str:
        rows = _positive_integer("rows", rows)
        cols = _positive_integer("cols", cols)
        max_elem = _positive_integer("max_elem", max_elem)
        expected = rows * cols
        known_values = _known_values(known, expected, max_elem)

        if args is None:
            args = PrettyPrintArgs()
        elif not isinstance(args, PrettyPrintArgs):
            raise TypeError("args must be a PrettyPrintArgs instance")
        else:
            # Snapshot and revalidate mutable public attributes.
            args = PrettyPrintArgs(args=args)
        inequality_pairs = _inequality_pairs(ineqs, rows, expected)

        max_dgt = math.floor(math.log10(max_elem)) + 1
        if not args.print_candidates:
            return _simple_square(
                rows,
                cols,
                max_dgt,
                args=args,
                ineqs=inequality_pairs,
                content=known_values,
            )

        if candidates is None:
            raise ValueError(
                "candidates are required when print_candidates is enabled"
            )
        candidate_values = _candidate_values(
            candidates,
            expected,
            max_elem,
        )
        return _show_candidate_square(
            rows,
            cols,
            max_dgt,
            max_elem,
            args=args,
            ineqs=inequality_pairs,
            candidates=candidate_values,
        )


''').lstrip()
path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


tests = Path("tests/test_hardening.py")
test_text = tests.read_text(encoding="utf-8")
appendix = '''


@pytest.mark.parametrize("bad", (True, 1.5, -1, 3))
def test_pretty_print_rejects_invalid_known_values(bad):
    error = TypeError if isinstance(bad, (bool, float)) else ValueError
    with pytest.raises(error):
        pretty_print(1, 1, 2, [bad])


def test_pretty_print_validates_candidate_domains_and_shapes():
    args = PrettyPrintArgs(print_candidates=True)

    with pytest.raises(TypeError, match=r"candidates\[0\]"):
        pretty_print(1, 1, 2, [0], candidates=[1], args=args)
    with pytest.raises(TypeError, match="must contain integers"):
        pretty_print(1, 1, 2, [0], candidates=[{True}], args=args)
    with pytest.raises(ValueError, match="outside 1..2"):
        pretty_print(1, 1, 2, [0], candidates=[{0}], args=args)
    with pytest.raises(ValueError, match="outside 1..2"):
        pretty_print(1, 1, 2, [0], candidates=[{3}], args=args)


def test_pretty_print_validates_directed_adjacent_inequalities():
    args = PrettyPrintArgs(
        sep_in_ve=4,
        sep_in_ho=4,
        inner_grid_row=1,
        inner_grid_col=1,
    )

    rendered = pretty_print(2, 2, 2, [0, 0, 0, 0], args=args, ineqs={(0, 2)})
    assert "<" in rendered

    with pytest.raises(ValueError, match="exactly two cells"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 1, 2)})
    with pytest.raises(TypeError, match="must contain integers"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(False, 1)})
    with pytest.raises(ValueError, match="outside 0..3"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 4)})
    with pytest.raises(ValueError, match="must be distinct"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 0)})
    with pytest.raises(ValueError, match="not adjacent"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 3)})


def test_pretty_print_args_reject_zero_inner_dimensions_with_separators():
    with pytest.raises(ValueError, match="inner_grid_col must be positive"):
        PrettyPrintArgs(sep_in_ve=1)
    with pytest.raises(ValueError, match="inner_grid_row must be positive"):
        PrettyPrintArgs(sep_in_ho=1)

    # Candidate rendering supplies its own one-cell inner grid.
    args = PrettyPrintArgs(print_candidates=True, sep_in_ve=1, sep_in_ho=1)
    rendered = pretty_print(1, 1, 2, [0], candidates=[{1, 2}], args=args)
    assert "1" in rendered and "2" in rendered


def test_pretty_print_revalidates_mutated_args_snapshot():
    args = PrettyPrintArgs()
    args.sep_in_ve = 1
    with pytest.raises(ValueError, match="inner_grid_col must be positive"):
        pretty_print(1, 1, 1, [0], args=args)
'''
if "test_pretty_print_validates_candidate_domains_and_shapes" in test_text:
    raise SystemExit("render-domain hardening tests already exist")
tests.write_text(test_text.rstrip() + appendix, encoding="utf-8")
