"""Correct current markers, apply the gate, then preserve the default hot path."""

from pathlib import Path


path = Path(".github/scripts/apply_restore_depth_gate.py")
source = path.read_text(encoding="utf-8")
replacements = {
    '    "    def solve_atomic(\\n",\n': '    "    def solve_atomic(",\n',
    '    "    def _solve_power_actions(\\n",\n': '    "    def _solve_power_actions(",\n',
    '    "def _init_worker(\\n",\n': '    "def _init_worker(",\n',
    '    "def _fresh_worker_grid(\\n",\n': '    "def _fresh_worker_grid(",\n',
    '    "def build_parser(\\n",\n': '    "def build_parser(",\n',
    '    "def _load_grid(\\n",\n': '    "def _load_grid(",\n',
    '    "def main(\\n",\n': '    "def main(",\n',
}
for old, new in replacements.items():
    if source.count(old) != 1:
        raise SystemExit(
            f"Expected one depth-gate wrapper marker, found {source.count(old)}"
        )
    source = source.replace(old, new, 1)

exec(compile(source, str(path), "exec"), {})


def replace_once(file_path: Path, old: str, new: str) -> None:
    text = file_path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(
            f"{file_path}: expected one post-patch marker, found {text.count(old)}"
        )
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    Path("gridsolver/solver/solver.py"),
    '''    return solve_parallel_trials(
        worker_seed,
        branches,
        max_sols,
        processes,
        depth_gate=depth_gate,
    )
''',
    '''    if depth_gate is None:
        # Preserve the pre-gate call shape and hot path exactly when the
        # experiment switch is unused.
        return solve_parallel_trials(
            worker_seed,
            branches,
            max_sols,
            processes,
        )
    return solve_parallel_trials(
        worker_seed,
        branches,
        max_sols,
        processes,
        depth_gate=depth_gate,
    )
''',
)

replace_once(
    Path("gridsolver/solver/solve_parallel.py"),
    '''    worker_payload = pickle.dumps(
        (grid, depth_gate),
        protocol=pickle.HIGHEST_PROTOCOL,
    )
''',
    '''    worker_root = grid if depth_gate is None else (grid, depth_gate)
    worker_payload = pickle.dumps(
        worker_root,
        protocol=pickle.HIGHEST_PROTOCOL,
    )
''',
)
