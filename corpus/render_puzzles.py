"""Render puzzle payloads into images with exact targets.

No public photograph corpus exists for Kakuro, Str8ts, KenKen, Futoshiki,
Hidato, Numbrix or Slitherlink, so those families are drawn here from real
puzzle data (janko.at) and from generated puzzles. Every image therefore has a
target that is correct by construction, including the grid corners, which no
downloaded source provides for these families.

Three variants per puzzle:

``clean``  the drawing itself, PNG
``print``  newsprint tint, ink bleed, grain, JPEG
``photo``  the print variant seen at an angle, with a lighting gradient - the
           case that matters for a camera scanner, and the only one with
           non-trivial corner ground truth

Usage::

    python corpus/render_puzzles.py                    # janko data + generated
    python corpus/render_puzzles.py --per-family 10
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from corpus.build_corpus import CORPUS, INDEX, jpeg_png_size, prune, rule_conflicts  # noqa: E402
from corpus.generate_puzzles import FAMILIES  # noqa: E402
from corpus.parse_janko import JANKO_CACHE, parse_janko  # noqa: E402

FONTS = ["arial.ttf", "times.ttf", "calibri.ttf", "verdana.ttf", "georgia.ttf"]
INK = (26, 26, 26)
PAPER = (252, 251, 248)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(name, size)


def centred(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], text: str,
            face: ImageFont.FreeTypeFont, fill=INK) -> None:
    x0, y0, x1, y1 = box
    left, top, right, bottom = draw.textbbox((0, 0), text, font=face)
    draw.text((x0 + (x1 - x0 - (right - left)) / 2 - left,
               y0 + (y1 - y0 - (bottom - top)) / 2 - top), text, font=face, fill=fill)


def chevron(draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float, direction: str, width: int) -> None:
    """A printed inequality sign drawn as two strokes, so no glyph is needed.
    ``direction`` names the side the smaller value sits on."""
    half = size / 2
    tips = {"w": [(cx + half, cy - half), (cx - half, cy), (cx + half, cy + half)],
            "e": [(cx - half, cy - half), (cx + half, cy), (cx - half, cy + half)],
            "n": [(cx - half, cy + half), (cx, cy - half), (cx + half, cy + half)],
            "s": [(cx - half, cy - half), (cx, cy + half), (cx + half, cy - half)]}[direction]
    draw.line(tips, fill=INK, width=width, joint="curve")


def dashed(draw: ImageDraw.ImageDraw, start: tuple[float, float], end: tuple[float, float],
           width: int, dash: int = 7) -> None:
    x0, y0 = start
    x1, y1 = end
    length = math.hypot(x1 - x0, y1 - y0)
    if not length:
        return
    steps = max(1, int(length // dash))
    for step in range(steps):
        if step % 2:
            continue
        a, b = step / steps, min(1.0, (step + 1) / steps)
        draw.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a),
                   (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=INK, width=width)


def draw_puzzle(puzzle: dict, rng: random.Random) -> tuple[Image.Image, list]:
    """Draw one puzzle; return the image and its grid corners in pixels."""
    rows, cols = puzzle["rows"], puzzle["cols"]
    kind = puzzle["type"]
    cell = rng.choice([52, 60, 68, 76])
    margin = rng.choice([28, 40, 56])
    face = rng.choice(FONTS)
    thin, thick = 2, 4
    width, height = cols * cell + 2 * margin, rows * cell + 2 * margin
    image = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(image)
    digit = font(face, int(cell * 0.62))
    small = font(face, int(cell * 0.30))
    corners = [[margin, margin], [margin + cols * cell, margin],
               [margin + cols * cell, margin + rows * cell], [margin, margin + rows * cell]]

    def box(index: int) -> tuple[float, float, float, float]:
        r, c = divmod(index, cols)
        return (margin + c * cell, margin + r * cell, margin + (c + 1) * cell, margin + (r + 1) * cell)

    cells = puzzle["cells"]
    black = set(puzzle.get("black", []))
    clues = {clue["cell"]: clue for clue in puzzle.get("clues", [])}

    # Solid cells first, so the grid lines stay on top of them.
    for index, value in enumerate(cells):
        if index in black or (value == "#" and kind in ("kakuro", "hidato")):
            x0, y0, x1, y1 = box(index)
            draw.rectangle([x0, y0, x1, y1], fill=INK if kind != "hidato" else (205, 205, 200))

    if kind != "slitherlink":
        for r in range(rows + 1):
            y = margin + r * cell
            draw.line([(margin, y), (margin + cols * cell, y)], fill=INK, width=thin)
        for c in range(cols + 1):
            x = margin + c * cell
            draw.line([(x, margin), (x, margin + rows * cell)], fill=INK, width=thin)
        draw.rectangle([margin, margin, margin + cols * cell, margin + rows * cell], outline=INK, width=thick)
        if kind in ("sudoku", "killersudoku"):
            for r in range(0, rows + 1, puzzle.get("boxRows", 3)):
                draw.line([(margin, margin + r * cell), (margin + cols * cell, margin + r * cell)],
                          fill=INK, width=thick)
            for c in range(0, cols + 1, puzzle.get("boxCols", 3)):
                draw.line([(margin + c * cell, margin), (margin + c * cell, margin + rows * cell)],
                          fill=INK, width=thick)

    if kind == "slitherlink":
        radius = max(2, cell // 22)
        for r in range(rows + 1):
            for c in range(cols + 1):
                x, y = margin + c * cell, margin + r * cell
                draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=INK)

    for index, value in enumerate(cells):
        if value is None or value == "#":
            continue
        colour = PAPER if index in black else INK
        centred(draw, box(index), str(value), digit, fill=colour)

    if kind == "kakuro":
        for index, clue in clues.items():
            x0, y0, x1, y1 = box(index)
            draw.line([(x0, y0), (x1, y1)], fill=PAPER, width=thin)
            if clue.get("across"):
                centred(draw, (x0 + (x1 - x0) * 0.45, y0 + 2, x1 - 3, y0 + (y1 - y0) * 0.5),
                        str(clue["across"]), small, fill=PAPER)
            if clue.get("down"):
                centred(draw, (x0 + 3, y0 + (y1 - y0) * 0.5, x0 + (x1 - x0) * 0.55, y1 - 2),
                        str(clue["down"]), small, fill=PAPER)

    if kind in ("killersudoku", "kenken"):
        signs = {"+": "+", "-": "−", "*": "×", "/": "÷", "=": ""}
        for cage in puzzle.get("cages", []):
            members = set(cage["cells"])
            for index in members:
                r, c = divmod(index, cols)
                x0, y0, x1, y1 = box(index)
                inset = max(4, cell // 12)
                if index - cols not in members:
                    dashed(draw, (x0 + inset, y0 + inset), (x1 - inset, y0 + inset), 2)
                if index + cols not in members:
                    dashed(draw, (x0 + inset, y1 - inset), (x1 - inset, y1 - inset), 2)
                if c == 0 or index - 1 not in members:
                    dashed(draw, (x0 + inset, y0 + inset), (x0 + inset, y1 - inset), 2)
                if c == cols - 1 or index + 1 not in members:
                    dashed(draw, (x1 - inset, y0 + inset), (x1 - inset, y1 - inset), 2)
            head = min(members)
            if cage.get("target") is not None:
                x0, y0, _, _ = box(head)
                label = f"{cage['target']}{signs.get(cage.get('op', '+'), '')}"
                draw.text((x0 + max(6, cell // 9), y0 + max(4, cell // 12)), label, font=small, fill=INK)

    if kind == "futoshiki":
        size = cell * 0.34
        for pair in puzzle.get("inequalities", []):
            less, greater = pair["less"], pair["greater"]
            lr, lc = divmod(less, cols)
            gr, gc = divmod(greater, cols)
            x = margin + (min(lc, gc) + 1) * cell if lc != gc else margin + (lc + 0.5) * cell
            y = margin + (min(lr, gr) + 1) * cell if lr != gr else margin + (lr + 0.5) * cell
            if lr == gr:
                chevron(draw, x, y, size, "w" if lc < gc else "e", 3)
            else:
                chevron(draw, x, y, size, "n" if lr < gr else "s", 3)

    return image, corners


# --------------------------------------------------------------------------
# Variants
# --------------------------------------------------------------------------
def grain(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    data = np.asarray(image).astype(np.int16)
    noise = np.random.default_rng(rng.randrange(1 << 30)).normal(0, strength, data.shape)
    return Image.fromarray(np.clip(data + noise, 0, 255).astype(np.uint8))


def newsprint(image: Image.Image, rng: random.Random) -> Image.Image:
    tint = np.asarray(image).astype(np.float32)
    shade = np.array(rng.choice([(0.96, 0.95, 0.90), (0.93, 0.93, 0.92), (1.0, 0.99, 0.97)]), np.float32)
    image = Image.fromarray(np.clip(tint * shade, 0, 255).astype(np.uint8))
    image = image.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.8)))
    return grain(image, rng, rng.uniform(2.0, 6.0))


def perspective(image: Image.Image, corners: list, rng: random.Random) -> tuple[Image.Image, list]:
    """Photograph-like view: the sheet on a larger surface, seen at an angle."""
    pad = int(max(image.size) * rng.uniform(0.10, 0.22))
    surface = Image.new("RGB", (image.width + 2 * pad, image.height + 2 * pad),
                        tuple(rng.randrange(105, 210) for _ in range(3)))
    surface.paste(image, (pad, pad))
    moved = [[x + pad, y + pad] for x, y in corners]
    w, h = surface.size
    shift = min(w, h) * rng.uniform(0.02, 0.09)
    source = [(0, 0), (w, 0), (w, h), (0, h)]
    target = [(x + rng.uniform(-shift, shift), y + rng.uniform(-shift, shift)) for x, y in source]
    matrix = []
    for (tx, ty), (sx, sy) in zip(target, source):
        matrix.append([tx, ty, 1, 0, 0, 0, -sx * tx, -sx * ty])
        matrix.append([0, 0, 0, tx, ty, 1, -sy * tx, -sy * ty])
    coefficients = np.linalg.solve(np.array(matrix, np.float64),
                                      np.array(source, np.float64).reshape(8))
    warped = surface.transform((w, h), Image.PERSPECTIVE, coefficients, Image.BICUBIC,
                               fillcolor=(90, 90, 95))

    # The same map, applied forward, says where the grid corners ended up.
    a, b, c, d, e, f, g, hh = coefficients
    forward = np.array([[a, b, c], [d, e, f], [g, hh, 1.0]], np.float64)
    inverse = np.linalg.inv(forward)
    placed = []
    for x, y in moved:
        vector = inverse @ np.array([x, y, 1.0])
        placed.append([int(round(vector[0] / vector[2])), int(round(vector[1] / vector[2]))])

    # Uneven light across the sheet, as a phone would see it.
    gradient = np.linspace(rng.uniform(0.72, 0.9), rng.uniform(1.0, 1.12), w, dtype=np.float32)
    if rng.random() < 0.5:
        gradient = gradient[::-1]
    vertical = np.linspace(rng.uniform(0.8, 1.0), rng.uniform(0.9, 1.1), h, dtype=np.float32)
    field = np.outer(vertical, gradient)[:, :, None]
    lit = np.clip(np.asarray(warped).astype(np.float32) * field, 0, 255).astype(np.uint8)
    result = Image.fromarray(lit).filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.0)))
    return grain(result, rng, rng.uniform(2.0, 7.0)), placed


def variants(image: Image.Image, corners: list, rng: random.Random):
    yield "clean", image, corners, "png", {}
    printed = newsprint(image, rng)
    yield "print", printed, corners, "jpg", {"quality": rng.choice([70, 80, 88])}
    photo, moved = perspective(printed, corners, rng)
    scale = rng.choice([0.55, 0.7, 0.85, 1.0])
    if scale != 1.0:
        photo = photo.resize((int(photo.width * scale), int(photo.height * scale)), Image.LANCZOS)
        moved = [[int(round(x * scale)), int(round(y * scale))] for x, y in moved]
    yield "photo", photo, moved, "jpg", {"quality": rng.choice([55, 65, 75])}


# --------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------
def sources(per_family: int, rng: random.Random):
    """(slug, family, origin, licence, url, note, [(name, payload, solution)])."""
    janko = parse_janko(JANKO_CACHE, per_family)
    for (collection, family), puzzles in sorted(janko.items()):
        yield (f"janko-{collection}", family,
               f"janko.at {collection} archive, rendered here (the site serves no images)",
               "CC BY-NC-SA 3.0 (Otto Janko) - private research use, not republished",
               "https://www.janko.at/Raetsel/", puzzles,
               "Real published puzzles; clues and solution come from the page's data block.")
    for family in ("numbrix", "latinsquare", "sudoku", "killersudoku"):
        puzzles = []
        for index in range(per_family):
            try:
                puzzle, solution = FAMILIES[family](rng)
            except Exception:  # noqa: BLE001 - a generator may give up on a layout
                continue
            puzzles.append((f"{family}-{index:03d}", puzzle, solution))
        if puzzles:
            yield ("generated-render", family, "generated by corpus/generate_puzzles.py",
                   "none required (produced locally)", "", puzzles,
                   "Carved out of a solved grid, so the printed clues are consistent by construction.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-family", type=int, default=40)
    parser.add_argument("--seed", type=int, default=20260913)
    parser.add_argument("--only", action="append", default=[], help="limit to these families")
    args = parser.parse_args()

    from corpus.validate_target import validate_target

    rng = random.Random(args.seed)
    entries, described = [], {}
    for slug, family, origin, licence, url, puzzles, note in sources(args.per_family, rng):
        if args.only and family not in args.only:
            continue
        folder = CORPUS / family / slug
        folder.mkdir(parents=True, exist_ok=True)
        # A shorter run of the same set must leave no images behind that the
        # index no longer knows about.
        stale = {path.name for path in folder.iterdir()}
        described[(family, slug)] = {"slug": slug, "family": family, "kind": "render", "origin": origin,
                                     "licence": licence, "url": url, "note": note}
        made = 0
        for name, puzzle, solution in puzzles:
            try:
                validate_target(puzzle, solution)
            except Exception as error:  # noqa: BLE001
                print(f"  {family}/{name}: rejected by target validation: {error}")
                continue
            image, corners = draw_puzzle(puzzle, rng)
            for variant, picture, placed, suffix, options in variants(image, corners, rng):
                stem = f"{name}-{variant}"
                path = folder / f"{stem}.{suffix}"
                picture.save(path, **options)
                target = {"puzzle": puzzle, "corners": placed}
                if solution:
                    target["solution"] = solution
                path.with_suffix(".json").write_text(json.dumps(target, separators=(",", ":")) + "\n",
                                                     encoding="utf-8")
                size = jpeg_png_size(path)
                entries.append({"path": f"{family}/{slug}/{path.name}", "family": family, "set": slug,
                                "kind": "render", "variant": variant, "bytes": path.stat().st_size,
                                "width": size[0] if size else None, "height": size[1] if size else None,
                                "clues": sum(1 for v in puzzle["cells"] if isinstance(v, int)),
                                "conflicts": rule_conflicts(puzzle), "corners": True,
                                "solution": bool(solution)})
                stale.discard(path.name)
                stale.discard(path.with_suffix(".json").name)
                made += 1
        for name in stale:
            (folder / name).unlink()
        print(f"  {family}/{slug}: {made} images from {len(puzzles)} puzzles")

    index = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {"sources": [], "entries": []}
    slugs = {(entry["family"], entry["set"]) for entry in entries}
    index["entries"] = sorted([e for e in index["entries"] if (e["family"], e["set"]) not in slugs] + entries,
                              key=lambda e: e["path"])
    known = {(s["family"], s["slug"]): s for s in index["sources"]}
    known.update(described)
    index["sources"] = sorted(known.values(), key=lambda s: (s["family"], s["slug"]))
    INDEX.write_text(json.dumps(prune(index), indent=1) + "\n", encoding="utf-8")
    total = sum(e["bytes"] for e in index["entries"])
    print(f"\n{index['images']} images, {total / 1048576:.0f} MiB in {CORPUS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
