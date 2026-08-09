"""Correct current class boundary markers, then apply the relation candidate."""

from pathlib import Path


path = Path(".github/scripts/apply_relation_rule_hotpath.py")
source = path.read_text(encoding="utf-8")
replacements = {
    'uneq_end = text.index("\\n\\nclass IneqRule", uneq_start)\n': (
        'uneq_end = text.index("class IneqRule", uneq_start)\n'
    ),
    'text = text[:uneq_start] + "    " + uneq_method.replace("\\n", "\\n    ").rstrip() + text[uneq_end:]\n': (
        'text = (\n'
        '    text[:uneq_start]\n'
        '    + "    "\n'
        '    + uneq_method.replace("\\n", "\\n    ").rstrip()\n'
        '    + "\\n\\n"\n'
        '    + text[uneq_end:]\n'
        ')\n'
    ),
}
for old, new in replacements.items():
    if source.count(old) != 1:
        raise SystemExit(
            f"Expected one relation wrapper marker, found {source.count(old)}"
        )
    source = source.replace(old, new, 1)

exec(compile(source, str(path), "exec"), {})
