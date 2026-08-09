"""Correct current one-line function markers, then run the depth-gate patch."""

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
