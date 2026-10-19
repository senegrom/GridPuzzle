"""Real rendering and CLI resource tests, run with the optional corpus extra."""
import json
import os
from pathlib import Path
import random
import subprocess
import sys

import pytest

pytest.importorskip("PIL")
pytest.importorskip("numpy")
from PIL import Image, ImageFont  # noqa: E402
from corpus import fonts, render_puzzles as renderer  # noqa: E402
from corpus.generate_puzzles import gen_sudoku  # noqa: E402
from corpus.validate_target import validate_target  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def test_bundled_scalable_font_renders_without_system_fonts(monkeypatch):
    monkeypatch.setattr(fonts, "CANDIDATES", ("no-such-system-font.ttf",))
    assert fonts.resolve_fonts() == (None,)
    assert fonts.font(None, 40).getbbox("9")[3] > fonts.font(None, 12).getbbox("9")[3]
    puzzle, solution = gen_sudoku(random.Random(1), 4)
    validate_target(puzzle, solution)
    image, corners = renderer.draw_puzzle(puzzle, random.Random(2))
    assert image.width > 200 and image.height > 200
    assert len(corners) == 4
    assert len(image.getcolors(image.width * image.height)) > 2


def test_explicit_font_file_and_directory_are_validated(tmp_path):
    # A temporary copy of Pillow's own bundled font, never retained in artifacts.
    path = tmp_path / "font.ttf"
    path.write_bytes(ImageFont.load_default(size=12).path.getvalue())
    assert fonts.resolve_fonts([str(path)]) == (str(path),)
    assert fonts.resolve_fonts(directories=[str(tmp_path)]) == (str(path),)
    with pytest.raises(ValueError, match="Cannot use font"):
        fonts.resolve_fonts([str(tmp_path / "absent.ttf")])
    with pytest.raises(ValueError, match="does not exist"):
        fonts.resolve_fonts(directories=[str(tmp_path / "absent")])
    path.unlink()
    with pytest.raises(ValueError, match="No font files"):
        fonts.resolve_fonts(directories=[str(tmp_path)])


def isolated_env(tmp_path):
    return {**os.environ, "PUZZLE_CORPUS": str(tmp_path / "images"),
            "PUZZLE_CORPUS_CACHE": str(tmp_path / "custom-cache"),
            "PUZZLE_CORPUS_INDEX": str(tmp_path / "inventory.json")}


def test_thick_cage_style_draws_heavy_edges_between_cages_and_no_inset_dashes():
    # Two cages, top row and bottom row: the horizontal edge between them is a cage border.
    puzzle = {"version": 1, "type": "kenken", "rows": 2, "cols": 2, "cells": [None] * 4,
              "cages": [{"cells": [0, 1], "target": 3, "op": "+"}, {"cells": [2, 3], "target": 7, "op": "+"}],
              "inequalities": [], "clues": []}
    stream = random.Random(5)
    cell, margin = stream.choice([52, 60, 68, 76]), stream.choice([28, 40, 56])  # draw_puzzle's first draws
    images = {style: renderer.draw_puzzle(puzzle, random.Random(5), faces=(None,), cage_style=style)[0].convert("L")
              for style in ("thick", "dashed")}
    def dark_run(image, x, y0, y1):
        return sum(1 for y in range(y0, y1) if image.getpixel((x, y)) < 128)
    x = margin + cell // 2 + cell  # middle of the right column, clear of the clue
    border = margin + cell
    assert dark_run(images["thick"], x, border - 6, border + 7) >= 5
    assert dark_run(images["dashed"], x, border - 3, border + 4) <= 3, "dashed style keeps a thin grid line there"
    inset = max(4, cell // 12)
    column = margin + cell + inset  # where the dashed style draws a cage's inset outline
    assert dark_run(images["dashed"], column, margin + inset, margin + cell - inset) > 0
    assert dark_run(images["thick"], column, margin + inset, margin + cell - inset) == 0


def test_renderer_cli_writes_three_valid_variants_with_no_system_fonts(tmp_path):
    env = isolated_env(tmp_path)
    result = subprocess.run([sys.executable, "-c",
        "from corpus import fonts; fonts.CANDIDATES=(); from corpus.render_puzzles import main; raise SystemExit(main())",
        "--only", "sudoku", "--per-family", "1"], cwd=ROOT, env=env, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    index = json.loads(Path(env["PUZZLE_CORPUS_INDEX"]).read_text())
    assert index["images"] == 3
    for entry in index["entries"]:
        path = Path(env["PUZZLE_CORPUS"]) / entry["path"]
        with Image.open(path) as image:
            image.verify()
        target = json.loads(path.with_suffix(".json").read_text())
        validate_target(target["puzzle"], target["solution"])
        assert len(target["corners"]) == 4


def test_invalid_explicit_font_fails_before_changing_outputs(tmp_path):
    env = isolated_env(tmp_path)
    root = Path(env["PUZZLE_CORPUS"])
    root.mkdir()
    sentinel = root / "existing.png"
    sentinel.write_bytes(b"unchanged")
    index = Path(env["PUZZLE_CORPUS_INDEX"])
    index.write_text('{"entries":[]}')
    result = subprocess.run([sys.executable, "corpus/render_puzzles.py", "--font", str(tmp_path / "absent.ttf"),
                             "--only", "sudoku", "--per-family", "1"], cwd=ROOT, env=env,
                            text=True, capture_output=True, timeout=30)
    assert result.returncode == 2
    assert "Cannot use font" in result.stderr
    assert sentinel.read_bytes() == b"unchanged"
    assert index.read_text() == '{"entries":[]}'
    assert list(root.iterdir()) == [sentinel]


def test_nondefault_cache_is_shared_by_fetch_parse_and_render(tmp_path):
    env = isolated_env(tmp_path)
    cache = Path(env["PUZZLE_CORPUS_CACHE"]) / "janko/sudoku"
    cache.mkdir(parents=True)
    raw = """[begin]
size 4
[problem]
1 - - -
- - - -
- - - -
- - - -
[solution]
1 2 3 4
3 4 1 2
2 1 4 3
4 3 2 1
[end]
"""
    (cache / "0001.txt").write_text(raw)
    script = '''import os
from pathlib import Path
from corpus import build_corpus as b, fetch_janko as f, parse_janko as p, render_puzzles as r
expected = Path(os.environ['PUZZLE_CORPUS_CACHE'])
assert b.CACHE == expected
assert f.CACHE == p.JANKO_CACHE == r.JANKO_CACHE == expected / 'janko'
def no_network(*a, **kw): raise AssertionError('cached fetch made a network call')
f.urllib.request.urlopen = no_network
assert '[solution]' in f.fetch('sudoku', 1, 0)
assert len(p.parse_janko(p.JANKO_CACHE)[('sudoku', 'sudoku')]) == 1
assert any(source[0] == 'janko-sudoku' for source in r.sources(0, r.random.Random(1)))
'''
    result = subprocess.run([sys.executable, "-c", script], cwd=ROOT, env=env,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    result = subprocess.run([sys.executable, "corpus/fetch_janko.py", "--count", "1", "--only", "sudoku"],
                            cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0 and "1/1" in result.stdout, result.stdout + result.stderr


def test_sum_only_cage_labels_drop_only_the_plus():
    assert renderer.cage_label({"target": 15, "op": "+"}) == "15+"
    assert renderer.cage_label({"target": 15, "op": "+"}, sum_only=True) == "15"
    assert renderer.cage_label({"target": 15}, sum_only=True) == "15"
    # KenKen operators stay, sum-only or not; a one-cell "=" cage prints none.
    for op, sign in (("-", "-"), ("*", "x"), ("/", "/"), ("=", "")):
        assert renderer.cage_label({"target": 2, "op": op}, sum_only=True) == f"2{sign}"


def test_a_sum_only_killer_drawing_differs_from_the_plus_one_only_in_cage_heads():
    from corpus.generate_puzzles import gen_killersudoku
    puzzle, solution = gen_killersudoku(random.Random(3), 6)
    validate_target(puzzle, solution)
    drawn = {only: renderer.draw_puzzle(puzzle, random.Random(7), faces=(None,), sum_only=only) for only in (False, True)}
    (plus, corners), (alone, alone_corners) = drawn[False], drawn[True]
    assert corners == alone_corners and plus.size == alone.size
    a, b = plus.convert("L"), alone.convert("L")
    cell = (corners[1][0] - corners[0][0]) / puzzle["cols"]
    heads = {min(cage["cells"]) for cage in puzzle["cages"]}
    changed = [(x, y) for y in range(a.height) for x in range(a.width) if a.getpixel((x, y)) != b.getpixel((x, y))]
    assert changed, "the '+' signs are gone"
    for x, y in changed:
        r, c = int((y - corners[0][1]) // cell), int((x - corners[0][0]) // cell)
        assert r * puzzle["cols"] + c in heads and (y - corners[0][1]) - r * cell < cell / 2, (x, y)


def test_the_sum_only_killer_set_comes_last_from_its_own_stream(monkeypatch):
    monkeypatch.setattr(renderer, "parse_janko", lambda *args, **kwargs: {})
    whole, shared = random.Random(1), random.Random(1)
    slugs = [(slug, family, style) for slug, family, *_, style in renderer.sources(2, whole)]
    assert slugs[-1] == ("generated-render-sum-only", "killersudoku", "sum-only")
    assert all(style is None for *_, style in slugs[:-1])
    # The shared stream is left exactly where the earlier sets leave it.
    for slug, family, *_ in renderer.sources(2, shared):
        if (slug, family) == ("generated-render", "killersudoku"):
            break
    assert whole.getstate() == shared.getstate()
    (_, _, _, _, _, puzzles, _, _), = [s for s in renderer.sources(2, random.Random(5)) if s[0] == "generated-render-sum-only"]
    again = [s for s in renderer.sources(2, random.Random(6)) if s[0] == "generated-render-sum-only"][0][5]
    assert puzzles == again, "its puzzles do not depend on the shared stream"
    assert len(puzzles) == 2 and all(p["type"] == "killersudoku" for _, p, _ in puzzles)
    assert all(cage["op"] == "+" for _, p, _ in puzzles for cage in p["cages"])


def test_the_sum_only_killer_set_renders_the_same_alone_as_in_a_full_run(tmp_path):
    rendered = {}
    for run, extra in (("alone", ["--set", "generated-render-sum-only"]), ("full", [])):
        env = isolated_env(tmp_path / run)
        result = subprocess.run([sys.executable, "-c",
            "from corpus import fonts; fonts.CANDIDATES=(); from corpus.render_puzzles import main; raise SystemExit(main())",
            "--per-family", "1", *extra], cwd=ROOT, env=env, text=True, capture_output=True, timeout=120)
        assert result.returncode == 0, result.stdout + result.stderr
        folder = Path(env["PUZZLE_CORPUS"]) / "killersudoku" / "generated-render-sum-only"
        rendered[run] = {path.name: path.read_bytes() for path in sorted(folder.iterdir())}
    assert len(rendered["alone"]) == 6 and rendered["alone"] == rendered["full"]
    target = json.loads(rendered["alone"]["killersudoku-000-clean.json"])
    validate_target(target["puzzle"], target["solution"])
