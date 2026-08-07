from collections.abc import Iterable, Sequence
from itertools import chain
from typing import TypeVar


def flatten(values: Iterable, ltypes=(Sequence,)) -> list:
    """Return a flat list while treating strings and bytes as scalar values.

    The previous implementation rebuilt the original outer container type.
    That fails for one-shot iterables such as generators and is unnecessary for
    every current caller, which needs a concrete sequence with ``len``.
    """

    def iter_flat(items):
        for item in items:
            if isinstance(item, ltypes) and not isinstance(item, (str, bytes, bytearray)):
                yield from iter_flat(item)
            else:
                yield item

    return list(iter_flat(values))


__T = TypeVar("__T")


def peek(it: Iterable[__T]) -> tuple[__T, Iterable[__T]]:
    """Return the first item and an iterator that still yields that item.

    Only the first item is consumed eagerly.  The old starred-unpack version
    materialised the complete iterable, which was surprisingly expensive for
    generators used to construct large rule sets.
    """
    iterator = iter(it)
    try:
        first = next(iterator)
    except StopIteration as exc:
        raise ValueError("Cannot peek an empty iterable") from exc
    return first, chain((first,), iterator)
