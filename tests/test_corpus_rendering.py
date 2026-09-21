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
