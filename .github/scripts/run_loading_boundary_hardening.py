"""Run the loading hardening patch with an exact colon-split marker."""

from pathlib import Path
from textwrap import dedent


path = Path(".github/scripts/apply_loading_boundary_hardening.py")
script = path.read_text(encoding="utf-8")
start = script.index("colon_old = dedent('''\n")
end = script.index("if killer.count(colon_old) != 1:\n", start)
replacement = dedent('''
    colon_old = lines(
        "        elif isinstance(sum_cells_and_dic, Iterable):",
        "            # Materialise once so one-shot iterables are not consumed by a",
        "            # separate membership check. Newlines are stripped later by the",
        "            # normal puzzle preprocessors.",
        "            text = \\\"\\\\n\\\".join(str(part) for part in sum_cells_and_dic)",
    )
    colon_new = lines(
        "        elif isinstance(sum_cells_and_dic, (bytes, bytearray)):",
        "            raise TypeError(\\\"Cage input bytes must be decoded to str first\\\")",
        "        elif isinstance(sum_cells_and_dic, Iterable):",
        "            # Materialise once so one-shot iterables remain supported, but do",
        "            # not silently stringify malformed tokens.",
        "            parts = list(sum_cells_and_dic)",
        "            if any(not isinstance(part, str) for part in parts):",
        "                raise TypeError(\\\"Cage input iterables must contain only strings\\\")",
        "            text = \\\"\\\\n\\\".join(parts)",
    )
''').lstrip()
script = script[:start] + replacement + script[end:]
exec(compile(script, str(path), "exec"), {})
