"""Correct the exact-count handling in the temporary promotion script."""

from pathlib import Path


path = Path(".github/scripts/apply_candidate_domain_hardening.py")
text = path.read_text(encoding="utf-8")
old = '''for label, old, new in (
    (
        "sum singleton",
        "                candidates[last_cell].clear()\\n                candidates[last_cell].add(k)\\n",
        "                candidates[last_cell].intersection_update((k,))\\n",
    ),
    (
        "product singleton",
        "                candidates[last_cell].clear()\\n                candidates[last_cell].add(k)\\n",
        "                candidates[last_cell].intersection_update((k,))\\n",
    ),
    (
        "distinct-sum singleton",
        "                np0.clear()\\n                np0.add(k)\\n",
        "                np0.intersection_update((k,))\\n",
    ),
):
    replace_once(SUMRULES, old, new, label)
'''
new = '''sumrules_text = SUMRULES.read_text(encoding="utf-8")
singleton_old = (
    "                candidates[last_cell].clear()\\n"
    "                candidates[last_cell].add(k)\\n"
)
if sumrules_text.count(singleton_old) != 2:
    raise SystemExit(
        "sum/product singleton: expected two markers, found "
        f"{sumrules_text.count(singleton_old)}"
    )
sumrules_text = sumrules_text.replace(
    singleton_old,
    "                candidates[last_cell].intersection_update((k,))\\n",
)
distinct_old = "                np0.clear()\\n                np0.add(k)\\n"
if sumrules_text.count(distinct_old) != 1:
    raise SystemExit(
        "distinct-sum singleton: expected one marker, found "
        f"{sumrules_text.count(distinct_old)}"
    )
sumrules_text = sumrules_text.replace(
    distinct_old,
    "                np0.intersection_update((k,))\\n",
    1,
)
SUMRULES.write_text(sumrules_text, encoding="utf-8")
'''
if text.count(old) != 1:
    raise SystemExit("temporary promotion loop marker changed")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
