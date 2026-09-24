from collections.abc import Iterable, Iterator
from itertools import chain
from numbers import Integral
from typing import TypeVar


def positive_int(name: str, value: object) -> int:
    """``value`` as an int; bools, non-integers and values below one raise."""
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise TypeError(f"{name} must be an integer")
    value = int(value)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def iter_bits(mask: int) -> Iterator[int]:
    """Indices of the set bits of ``mask``, ascending.

    The one implementation behind cell bitsets (bit c for cell c) and value
    bitsets (bit v for value v) alike.
    """
    while mask:
        lowest = mask & -mask
        yield lowest.bit_length() - 1
        mask ^= lowest


def flatten(values: Iterable) -> list:
    """Return a flat list and support one-shot iterables at every depth.

    Text and byte strings remain scalar once encountered inside the outer
    iterable. The loader API accepts general iterables, so nested generators
    must be flattened just like nested lists and tuples. Iterative with an
    open-container path check, so self-referential input raises ValueError
    instead of exhausting the recursion limit.
    """
    result: list = []
    stack: list = [iter(values)]
    # identity comparison against LIVE objects: holding the containers
    # themselves (not just their ids) rules out id-reuse false positives
    open_containers: list = [values]

    while stack:
        try:
            item = next(stack[-1])
        except StopIteration:
            stack.pop()
            open_containers.pop()
            continue
        if isinstance(item, (str, bytes, bytearray)) or not isinstance(
            item, Iterable
        ):
            result.append(item)
        elif any(item is container for container in open_containers):
            raise ValueError("Cannot flatten a self-referential iterable")
        else:
            stack.append(iter(item))
            open_containers.append(item)

    return result


__T = TypeVar("__T")


def peek(it: Iterable[__T]) -> tuple[__T, Iterable[__T]]:
    """Return the first item and an iterator that still yields that item.

    Only the first item is consumed eagerly. The old starred-unpack version
    materialised the complete iterable, which was surprisingly expensive for
    generators used to construct large rule sets.
    """
    iterator = iter(it)
    try:
        first = next(iterator)
    except StopIteration as exc:
        raise ValueError("Cannot peek an empty iterable") from exc
    return first, chain((first,), iterator)
