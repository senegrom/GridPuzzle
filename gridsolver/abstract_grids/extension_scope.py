"""Context-local rollback scopes for caller grids captured by extension hooks.

These scopes protect Grid-managed state accessed through its transactional APIs.
They are not a Python security sandbox for arbitrary object or external effects.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from gridsolver.abstract_grids.grid import Grid


_PROTECTED_SOURCES: ContextVar[tuple[Grid, ...]] = ContextVar(
    "gridpuzzle_protected_sources", default=(),
)


@contextmanager
def sandbox_sources(*, exclude: Grid | None = None) -> Iterator[None]:
    """Rollback incidental captured-source changes from one extension operation.

    Clear the registry while entering these scopes to prevent recursion through
    Grid._extension_sandbox. The enclosing scopes already protect those sources
    for nested hook operations, and the context token is restored on every exit.
    """
    sources = _PROTECTED_SOURCES.get()
    if not sources:
        yield
        return
    token = _PROTECTED_SOURCES.set(())
    try:
        with ExitStack() as stack:
            for source in sources:
                if source is not exclude:
                    stack.enter_context(source._extension_sandbox())
            yield
    finally:
        _PROTECTED_SOURCES.reset(token)


@contextmanager
def protect_source(source: Grid) -> Iterator[None]:
    """Protect one caller throughout an API call and register it for hook scopes."""
    previous = _PROTECTED_SOURCES.get()
    with source._extension_sandbox():
        token = _PROTECTED_SOURCES.set(
            tuple(item for item in previous if item is not source) + (source,)
        )
        try:
            yield
        finally:
            _PROTECTED_SOURCES.reset(token)
