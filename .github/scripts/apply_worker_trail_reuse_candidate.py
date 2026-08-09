"""Apply the temporary guarded worker-root trail-reuse experiment."""

from pathlib import Path
from textwrap import dedent


path = Path("gridsolver/solver/solve_parallel.py")
text = path.read_text(encoding="utf-8")
start = text.index("def _solve_branch(\n")
end = text.index("def _solve_branch_with_stats(\n", start)
replacement = dedent('''
    def _worker_root_is_trail_safe(root: Grid) -> bool:
        """Return whether branch solving can mutate and roll back this root."""
        cls = type(root)
        return (
            cls.__setitem__ is Grid.__setitem__
            and cls.trail_mark is Grid.trail_mark
            and cls.trail_undo is Grid.trail_undo
            and cls.add_rules_checked is Grid.add_rules_checked
            and cls.deactivate_rule is Grid.deactivate_rule
            and cls.add_gtees_checked is Grid.add_gtees_checked
            and cls.deactivate_gtee is Grid.deactivate_gtee
            and cls._copy_extra_state_to is Grid._copy_extra_state_to
        )


    def _solve_branch(
        payload: tuple[int, int, int, int | None],
    ) -> set[ImmutableGrid]:
        cell, value, max_sols, depth_gate = payload
        root = _WORKER_ROOT_GRID
        if root is None:
            raise RuntimeError("Parallel worker root grid was not initialised")

        from gridsolver.solver import solver as _solver
        from gridsolver.solver.solver_log import lg as _lg

        _lg.set_lvl(0)
        if not _worker_root_is_trail_safe(root):
            grid = root.deepcopy()
            grid[cell] = value
            return _solver._solve_full(grid, [0], max_sols, set(), depth_gate)

        original_attributes = frozenset(vars(root))
        mark = root.trail_mark()
        try:
            root[cell] = value
            return _solver._solve_full(
                root,
                [0],
                max_sols,
                set(),
                depth_gate,
            )
        finally:
            root.trail_undo(mark)
            # Optional solver memos may be created lazily inside a branch. Their
            # contents are trailed, but remove newly introduced attributes too.
            for name in vars(root).keys() - original_attributes:
                delattr(root, name)


''').lstrip()
path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
