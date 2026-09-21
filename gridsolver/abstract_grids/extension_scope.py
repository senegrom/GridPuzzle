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


_WORKER_SERIALIZATION: ContextVar[bool] = ContextVar("gridpuzzle_worker_serialization", default=False)


_PROTECTED_SOURCES: ContextVar[tuple[Grid, ...]] = ContextVar(
    "gridpuzzle_protected_sources", default=(),
)


@contextmanager
def sandbox_sources(
    *, exclude: Grid | None = None, extra: tuple[Grid, ...] = (),
) -> Iterator[None]:
    """Rollback captured-source changes, including in nested hook operations.

    Enter local scopes directly rather than recursively entering the public
    sandbox. Keep the registry live during the operation: a nested operation
    needs its own rollback boundary before the outer operation resumes.
    """
    sources = _PROTECTED_SOURCES.get()
    if extra:
        # Grid equality invokes rule equality and cannot be used for identity
        # deduplication. Preserve ancestor-first order for nested clones.
        seen = {id(source) for source in sources}
        additions = []
        for source in extra:
            if id(source) not in seen:
                seen.add(id(source))
                additions.append(source)
        sources += tuple(additions)
    if not sources:
        yield
        return
    token = _PROTECTED_SOURCES.set(sources)
    try:
        with ExitStack() as stack:
            for source in sources:
                if source is not exclude:
                    stack.enter_context(source._local_extension_sandbox())
            yield
    finally:
        _PROTECTED_SOURCES.reset(token)


@contextmanager
def protect_source(source: Grid) -> Iterator[None]:
    """Protect the API caller and the source owners of its shared rules."""
    owners = getattr(source, "_extension_sources", ())
    with sandbox_sources(extra=(*owners, source)):
        yield


@contextmanager
def worker_serialization() -> Iterator[None]:
    """Send puzzle state, not live caller trails or derived caches, to workers."""
    token = _WORKER_SERIALIZATION.set(True)
    try:
        yield
    finally:
        _WORKER_SERIALIZATION.reset(token)
