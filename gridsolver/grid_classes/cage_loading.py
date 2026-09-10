"""Shared parsing helpers for compact Killer Sudoku and KenKen cages."""

from collections import Counter
from collections.abc import Callable, Iterable, Iterator, Mapping
from functools import lru_cache
from typing import TypeVar

from gridsolver.abstract_grids.grid import _boolean_option


HeaderT = TypeVar("HeaderT")
DefinitionT = TypeVar("DefinitionT")
EntryT = TypeVar("EntryT")


def load_cage_layout(
    grid,
    sum_cells,
    dic,
    row_wise,
    *,
    family: str,
    make_entry: Callable[[object], EntryT],
    commit: Callable[[Iterable[EntryT]], None],
) -> None:
    """Shared single-character cage-layout loader for the dictionary APIs.

    Walks the layout in the requested orientation, groups cells by label into
    entries created from the label's dictionary definition (each entry exposes
    a mutable ``cells`` list), rejects unused definitions, and only then
    commits the complete cage set.
    """
    row_wise = _boolean_option("row_wise", row_wise)
    if grid.has_been_filled:
        raise RuntimeError("Grid can only be filled once; or be used in individual access mode")

    labels = grid._load_preprocess_sequence(sum_cells)
    if not isinstance(dic, Mapping):
        dic = dict(dic)

    final_dic: dict[str, EntryT] = {}
    label_iter = iter(labels)
    for first in range(grid.rows if row_wise else grid.cols):
        for second in range(grid.cols if row_wise else grid.rows):
            label = next(label_iter)
            try:
                definition = dic[label]
            except KeyError as exc:
                raise ValueError(
                    f"Missing {family} cage definition for {label!r}"
                ) from exc
            entry = final_dic.get(label)
            if entry is None:
                entry = make_entry(definition)
                final_dic[label] = entry
            entry.cells.append(
                (first, second) if row_wise else (second, first)
            )

    unused_labels = set(dic).difference(final_dic)
    if unused_labels:
        rendered = ", ".join(sorted(repr(label) for label in unused_labels))
        raise ValueError(f"Unused {family} cage definitions: {rendered}")

    # Build every rule before changing the grid, then commit the complete set.
    commit(final_dic.values())
    grid.has_been_filled = True


def split_cage_input(
    cage_input: str | Iterable[str],
) -> tuple[str, str]:
    """Split a cage layout from its compact dictionary exactly once."""
    if isinstance(cage_input, str):
        text = cage_input
    elif isinstance(cage_input, (bytes, bytearray)):
        raise TypeError("Cage input bytes must be decoded to str first")
    elif isinstance(cage_input, Iterable):
        parts = list(cage_input)
        if any(not isinstance(part, str) for part in parts):
            raise TypeError("Cage input iterables must contain only strings")
        text = "\n".join(parts)
    else:
        raise TypeError(
            f"Input type {type(cage_input).__name__} is not supported"
        )

    if ":" not in text:
        raise ValueError("Puzzle string contains no : separator")
    # Split only the layout separator. KenKen also permits ':' as a
    # division operator in the dictionary section.
    layout, dictionary_text = text.split(":", 1)
    return layout, dictionary_text


def _parse_compact_dictionary(
    text: str,
    expected_labels: Iterable[str],
    *,
    description: str,
    parse_header: Callable[[str, int], tuple[int, HeaderT] | None],
    make_definition: Callable[[str, HeaderT, int], DefinitionT | None],
) -> dict[str, DefinitionT]:
    """Parse a delimiter-free dictionary using its expected layout labels.

    Targets and numeric labels share the same character class, so a greedy
    digit scan is not sufficient. Explore only boundaries that start a still
    unused expected label, prune candidates through puzzle-specific target
    feasibility, and require one unique complete segmentation.
    """
    if not isinstance(text, str):
        raise TypeError(f"{description} dictionary must be text")

    labels = tuple(dict.fromkeys(expected_labels))
    if not labels:
        raise ValueError(f"{description} layout must contain at least one cage")
    if any(not isinstance(label, str) or len(label) != 1 for label in labels):
        raise ValueError(
            f"{description} compact dictionaries require single-character labels"
        )

    label_bits = {label: 1 << index for index, label in enumerate(labels)}
    all_labels = (1 << len(labels)) - 1

    def alternatives(
        position: int,
        remaining_labels: int,
    ) -> Iterator[tuple[str, DefinitionT, tuple[int, int]]]:
        if position == len(text):
            return

        label = text[position]
        label_bit = label_bits.get(label, 0)
        if not label_bit or not remaining_labels & label_bit:
            return

        header = parse_header(text, position)
        if header is None:
            return
        target_start, metadata = header
        target_end = target_start
        while (
            target_end < len(text)
            and "0" <= text[target_end] <= "9"
        ):
            target_end += 1
        if target_end == target_start:
            return

        remaining_after_label = remaining_labels ^ label_bit
        for boundary in range(target_start + 1, target_end + 1):
            if boundary < len(text):
                next_bit = label_bits.get(text[boundary], 0)
                if not next_bit or not remaining_after_label & next_bit:
                    continue

            target = int(text[target_start:boundary])
            definition = make_definition(label, metadata, target)
            if definition is None:
                continue
            yield label, definition, (boundary, remaining_after_label)

    # Explicit DFS retains the old boundary order and stops each state after
    # two complete parses prove ambiguity. Cache counts and the first successful
    # transition, rather than copying a growing suffix at every cage depth.
    start = (0, all_labels)
    complete = (len(text), 0)
    counts = {complete: 1}
    first_choices: dict[
        tuple[int, int], tuple[str, DefinitionT, tuple[int, int]]
    ] = {}
    work = [(start, alternatives(*start), 0, None)]
    while work:
        state, choices, total, pending = work[-1]
        choice = next(choices, None) if pending is None else pending
        if choice is None:
            counts[state] = total
            work.pop()
            continue

        child = choice[2]
        if child not in counts:
            # Resume this transition after its suffix has been evaluated.
            # Every child advances in the text, so the state graph is acyclic.
            work[-1] = (state, choices, total, choice)
            work.append((child, alternatives(*child), 0, None))
            continue

        if counts[child]:
            first_choices.setdefault(state, choice)
            total = min(2, total + counts[child])
        if total == 2:
            counts[state] = total
            work.pop()
        else:
            work[-1] = (state, choices, total, None)

    if not counts[start]:
        raise ValueError(f"{description} string format invalid")
    if counts[start] > 1:
        raise ValueError(
            f"{description} dictionary is ambiguous; use load_with_dic() "
            "or non-numeric cage labels"
        )
    definitions: dict[str, DefinitionT] = {}
    state = start
    while state != complete:
        label, definition, state = first_choices[state]
        definitions[label] = definition
    return definitions


def _raise_for_missing_unambiguous_label(
    text: str,
    layout: Iterable[str],
    description: str,
) -> None:
    # A non-digit layout label cannot occur inside a numeric target, so its
    # absence is unambiguous and deserves the established, specific error.
    for label in dict.fromkeys(layout):
        if not label.isdigit() and label not in text:
            raise ValueError(
                f"Missing {description} cage definition for {label!r}"
            )


def parse_killer_dictionary(
    text: str,
    layout: Iterable[str],
    max_elem: int,
) -> dict[str, int]:
    """Parse exact Killer Sudoku cage sums, including numeric labels."""
    layout = tuple(layout)
    cage_sizes = Counter(layout)
    _raise_for_missing_unambiguous_label(text, layout, "Killer Sudoku")

    def parse_header(source: str, position: int) -> tuple[int, None]:
        return position + 1, None

    def make_definition(label: str, _metadata: None, target: int) -> int | None:
        cage_size = cage_sizes[label]
        if cage_size > max_elem:
            return None
        minimum = cage_size * (cage_size + 1) // 2
        maximum = cage_size * (2 * max_elem - cage_size + 1) // 2
        return target if minimum <= target <= maximum else None

    return _parse_compact_dictionary(
        text,
        layout,
        description="KillerSudoku",
        parse_header=parse_header,
        make_definition=make_definition,
    )


@lru_cache(maxsize=65535)
def _product_target_is_possible(
    cage_size: int,
    max_elem: int,
    target: int,
) -> bool:
    """Exactly decide bounded factorisation, with ones filling unused cells.

    A greedy decomposition is only a positive witness. If it needs too many
    factors, the complete iterative search still runs; greedy failure must
    never reject a feasible cage (e.g. 216 = 6*6*6 with domain 1..8).
    """
    if cage_size < 0 or target <= 0:
        return False
    if target == 1:
        return True
    if cage_size == 0 or max_elem < 2 or target > max_elem ** cage_size:
        return False
    if target <= max_elem:
        return True

    factors = tuple(value for value in range(max_elem, 1, -1) if target % value == 0)
    remaining = target
    used = 0
    for value in factors:
        while remaining % value == 0:
            remaining //= value
            used += 1
    # Every allowable prime was included in factors. A non-unit residue has
    # an out-of-domain prime factor, so no bounded factorisation can exist.
    if remaining != 1:
        return False
    if used <= cage_size:
        return True

    # No recursion and no branches through factor 1: each edge strictly
    # reduces the product. More remaining slots dominates fewer for the same
    # residue, since surplus slots can always be filled with ones.
    work = [(target, cage_size)]
    seen: dict[int, int] = {}
    while work:
        remaining, slots = work.pop()
        if remaining == 1:
            return True
        if slots == 0 or remaining > max_elem ** slots:
            continue
        if remaining <= max_elem:
            return True
        if seen.get(remaining, -1) >= slots:
            continue
        seen[remaining] = slots
        for value in reversed(factors):
            if remaining % value == 0:
                work.append((remaining // value, slots - 1))
    return False


def parse_kenken_dictionary(
    text: str,
    layout: Iterable[str],
    max_elem: int,
) -> dict[str, tuple[str, int]]:
    """Parse exact KenKen operator/target entries, including numeric labels."""
    layout = tuple(layout)
    cage_sizes = Counter(layout)
    supported_operators = frozenset(("+", "-", "*", "/", ":"))
    _raise_for_missing_unambiguous_label(text, layout, "KenKen")

    # Non-digit labels cannot be confused with target digits, so preserve the
    # historical operator diagnostic wherever the entry boundary is certain.
    for position, label in enumerate(text):
        if label not in cage_sizes or label.isdigit():
            continue
        operator_index = position + 1
        operator = text[operator_index] if operator_index < len(text) else ""
        if operator not in supported_operators:
            raise ValueError(f"Not supported operator {operator!r}")

    def parse_header(source: str, position: int) -> tuple[int, str] | None:
        operator_index = position + 1
        if operator_index >= len(source):
            return None
        operator = source[operator_index]
        if operator not in supported_operators:
            return None
        return operator_index + 1, operator

    def make_definition(
        label: str,
        operator: str,
        target: int,
    ) -> tuple[str, int] | None:
        cage_size = cage_sizes[label]
        if operator == "+":
            possible = cage_size <= target <= cage_size * max_elem
        elif operator == "*":
            possible = _product_target_is_possible(
                cage_size,
                max_elem,
                target,
            )
        elif operator == "-":
            possible = cage_size == 2 and 0 <= target < max_elem
        else:
            possible = (
                cage_size == 2
                and 1 <= target <= max_elem
                # (target, 1) witnesses every ratio in this range.
            )
        return (operator, target) if possible else None

    return _parse_compact_dictionary(
        text,
        layout,
        description="KenKen",
        parse_header=parse_header,
        make_definition=make_definition,
    )
