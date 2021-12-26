from itertools import chain
from typing import Sequence, Iterable, TypeVar


def flatten(lst, ltypes=(list, tuple, Sequence)):
    ltype = type(lst)
    lst = list(lst)
    i = 0
    while i < len(lst):
        while isinstance(lst[i], ltypes):
            if not lst[i]:
                lst.pop(i)
                i -= 1
                break
            else:
                lst[i:i + 1] = lst[i]
        i += 1
    return ltype(lst)


__T = TypeVar("__T")


def peek(it: Iterable[__T]) -> (__T, Iterable[__T]):
    first, *it = it
    return first, chain([first], it)


