from collections.abc import Iterable
from itertools import chain
from typing import TypeVar


def flatten(values: Iterable) -> list:
    """Return a flat list and support one-shot iterables at every depth.

    Text and byte strings remain scalar once encountered inside the outer
    iterable. The loader API accepts general iterables, so nested generators
    must be flattened just like nested lists and tuples.
    """

    def iter_flat(items):
        for item in items:
            if isinstance(item, (str, bytes, bytearray)):
                yield item
            elif isinstance(item, Iterable):
                yield from iter_flat(item)
            else:
                yield item

    return list(iter_flat(values))


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
