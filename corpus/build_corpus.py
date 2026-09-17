"""Assemble the local grid-puzzle image corpus from public sources.

The corpus directory holds only raw images and, where a source supplies one,
a per-image target file; every script, index and note stays in this repository.

A target is ``<image stem>.json``::

    {"puzzle": {...},          # exactly the payload gridsolver.web_api accepts
     "corners": [[x, y] x 4],  # grid outline in image pixels, when known
     "solution": [...]}        # complete grid, when the source supplies one

Only ``puzzle`` is always present. Every payload is built through
``gridsolver.web_api.build_grid`` so a target can never disagree with the
solver's own contract.

Usage::

    python corpus/build_corpus.py                 # fetch, build, index
    python corpus/build_corpus.py --only wichtounet-printed
    python corpus/build_corpus.py --no-fetch      # rebuild from the cache
    python corpus/build_corpus.py --list          # show the registry
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import struct
import subprocess
import tempfile
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from corpus.config import CACHE, CORPUS, INDEX  # noqa: E402


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------
@dataclass
class Item:
    """One corpus entry: an image plus what is known about it."""

    image: Path
    name: str
    puzzle: dict
    corners: list | None = None
    solution: list | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class Source:
    slug: str            # corpus folder name under <family>/
    family: str          # sudoku, kakuro, ...
    kind: str            # printed-photo, solved-photo, blank-photo, handwritten-photo, render
    origin: str          # human-readable provenance
    licence: str         # as stated by the source
    url: str
    collect: Callable[[Path], Iterator[Item]]
    fetch: Callable[[Path], None] | None = None
    note: str = ""
    cache: str = ""            # download folder when it is not the URL's last segment


def git_clone(url: str):
    def fetch(target: Path) -> None:
        if (target / ".git").exists():
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", "--depth", "1", url, str(target)], check=True)

    return fetch


def sudoku_payload(cells: list) -> dict:
    return {"version": 1, "type": "sudoku", "rows": 9, "cols": 9, "boxRows": 3, "boxCols": 3,
            "cells": list(cells), "cages": [], "inequalities": [], "clues": []}


def read_dat(path: Path) -> tuple[list, str]:
    """The .dat format of wichtounet/sudoku_dataset: optional device and format
    header lines, then nine rows of nine digits with 0 for an empty cell."""
    lines = [line.strip() for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
    device = lines[0] if lines and not lines[0][0].isdigit() else ""
    rows = [line.split() for line in lines[-9:]]
    if len(rows) != 9 or any(len(row) != 9 for row in rows):
        raise ValueError(f"{path}: expected nine rows of nine values")
    cells = []
    for row in rows:
        for value in row:
            number = int(value)
            if not 0 <= number <= 9:
                raise ValueError(f"{path}: value {number} out of range")
            cells.append(number or None)
    return cells, device


class SourceUnavailableError(OSError):
    """Required source assets are unavailable, not an intentionally empty set."""


def source_files(folder: Path) -> list[Path]:
    """Enumerate explicitly: glob can silently treat a missing folder as empty."""
    try:
        return sorted(folder.iterdir())
    except OSError as error:
        raise SourceUnavailableError(f"Required source directory unavailable: {folder}") from error


def source_file(path: Path) -> Path:
    if not path.is_file():
        raise SourceUnavailableError(f"Required source file unavailable: {path}")
    return path


def paired_dat_images(folder: Path, corners: dict | None = None) -> Iterator[Item]:
    files = source_files(folder)
    for image in (p for suffix in (".jpg", ".png") for p in files if p.suffix == suffix):
        dat = image.with_suffix(".dat")
        if not dat.exists():
            continue
        try:
            cells, device = read_dat(dat)
        except ValueError:
            continue
        complete = all(value is not None for value in cells)
        yield Item(
            image=image,
            name=image.name,
            # A fully filled photograph is a legal puzzle payload as well; the
            # grid it shows is recorded as the solution too.
            puzzle=sudoku_payload(cells),
            corners=(corners or {}).get(image.name),
            solution=list(cells) if complete else None,
            extra={"device": device} if device else {},
        )


def wichtounet_outlines(repo: Path) -> dict:
    outlines: dict = {}
    path = source_file(repo / "outlines_sorted.csv")
    with path.open(encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {"filepath", *(f"p{i}_{axis}" for i in range(1, 5) for axis in ("x", "y"))}
        if not required.issubset(reader.fieldnames or []):
            raise SourceUnavailableError(f"Required outline columns unavailable: {path}")
        for row in reader:
            name = Path(row["filepath"]).name
            try:
                outlines[name] = [[int(row[f"p{i}_x"]), int(row[f"p{i}_y"])] for i in (1, 2, 3, 4)]
            except (KeyError, ValueError):
                continue
    return outlines


def wichtounet(folder: str, with_corners: bool = False):
    def collect(repo: Path) -> Iterator[Item]:
        corners = wichtounet_outlines(repo) if with_corners else None
        yield from paired_dat_images(repo / folder, corners)

    return collect


def wichtounet_originals(repo: Path) -> Iterator[Item]:
    """Full-resolution phone photographs; their grids live beside the small copies."""
    originals = source_files(repo / "original")
    source_files(repo / "images")  # annotations live in the downscaled sibling set
    for image in (p for p in originals if p.name.endswith(".original.jpg")):
        dat = repo / "images" / f"{image.name.removesuffix('.original.jpg')}.dat"
        if not dat.exists():
            continue
        try:
            cells, device = read_dat(dat)
        except ValueError:
            continue
        yield Item(image=image, name=image.name, puzzle=sudoku_payload(cells),
                   extra={"device": device} if device else {})


def rozet(folder: str):
    def collect(repo: Path) -> Iterator[Item]:
        yield from paired_dat_images(repo / "resources" / "images" / folder)

    return collect


def clockwise_corners(points: list) -> list:
    """Order four grid corners the way the app expects: top-left first, then
    clockwise. Sources document different orders, so derive it from geometry."""
    if len(points) != 4:
        raise ValueError("a grid outline needs four points")
    cx = sum(x for x, _ in points) / 4
    cy = sum(y for _, y in points) / 4
    import math
    ordered = sorted(points, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    start = min(range(4), key=lambda i: ordered[i][0] + ordered[i][1])
    return [[int(round(x)), int(round(y))] for x, y in ordered[start:] + ordered[:start]]


def lexski(repo: Path) -> Iterator[Item]:
    """Hugging Face Lexski/sudoku-image-recognition: photographs, screenshots
    and hand-drawn grids. Each record carries a 9x9x10 flag block (entry 0 marks
    a definite value, entries 1-9 the digit) and four corner keypoints."""
    for split in ("train", "val", "test"):
        metadata = source_file(repo / "data" / split / "metadata.jsonl")
        for line in metadata.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            image = repo / "data" / split / Path(record["file_name"].replace("\\", "/"))
            source_file(image)
            cells, pencil = [], 0
            for row in record["cells"]:
                for flags in row:
                    digits = [d for d in range(1, 10) if flags[d]]
                    if flags[0] and len(digits) == 1:
                        cells.append(digits[0])
                    else:
                        cells.append(None)
                        pencil += bool(digits)
            keypoints = record.get("keypoints") or []
            corners = None
            if len(keypoints) == 8:
                corners = clockwise_corners([[keypoints[i], keypoints[i + 1]] for i in range(0, 8, 2)])
            yield Item(image=image, name=f"{split}-{image.name}", puzzle=sudoku_payload(cells),
                       corners=corners, extra={"split": split, "pencilCells": pencil} if pencil else {"split": split})


def kuleuven_app(cache: Path) -> Iterator[Item]:
    """KU Leuven Sudoku Assistant photographs: 300x300 perspective-corrected
    crops in one numpy array, with a printed/handwritten flag per cell."""
    import numpy as np
    from PIL import Image

    archive = cache / "data_assistant.tar.gz"
    root = cache / "extracted"
    if not root.exists() and archive.exists():
        import tarfile
        with tarfile.open(archive) as tar:
            tar.extractall(root, filter="data")
    folder = next((p.parent for p in root.rglob("data.npy")), None) if root.exists() else None
    if folder is None:
        raise SourceUnavailableError(f"Required extracted data.npy unavailable under {root}")
    images = np.load(source_file(folder / "data.npy"))
    labels = np.load(source_file(folder / "labels.npy"))
    handwritten = np.load(folder / "labels_hw.npy") if (folder / "labels_hw.npy").exists() else None
    staging = cache / "png"
    staging.mkdir(exist_ok=True)
    for index in range(len(images)):
        name = f"assistant_{index:03d}.png"
        path = staging / name
        if not path.exists():
            Image.fromarray(images[index].astype("uint8")).save(path)
        cells = [int(v) or None for v in labels[index].reshape(-1)]
        extra = {}
        if handwritten is not None:
            written = int((handwritten[index].reshape(-1) > 0).sum())
            if written:
                extra["handwrittenCells"] = written
        yield Item(image=path, name=name, puzzle=sudoku_payload(cells), extra=extra)


# The one photograph of a printed non-Sudoku puzzle found anywhere public. Its
# clues and inequality signs were read off the image by hand; the transcription
# is confirmed by the solver returning exactly one solution.
FUTOSHIKI_PHOTO = {
    "givens": {3: 3, 6: 2, 18: 2},
    "pairs": [(3, 4), (6, 5), (6, 7), (10, 11), (17, 16), (24, 23),
              (0, 5), (5, 10), (12, 7), (12, 17), (22, 17), (18, 23)],
    "solution": [2, 1, 5, 3, 4, 3, 2, 4, 5, 1, 4, 5, 2, 1, 3, 1, 4, 3, 2, 5, 5, 3, 1, 4, 2],
}


def futoshiki_photo(cache: Path) -> Iterator[Item]:
    image = source_file(cache / "futoshiki-photo.jpg")
    cells = [FUTOSHIKI_PHOTO["givens"].get(index) for index in range(25)]
    puzzle = {"version": 1, "type": "futoshiki", "rows": 5, "cols": 5, "cells": cells,
              "cages": [], "clues": [],
              "inequalities": [{"less": a, "greater": b} for a, b in FUTOSHIKI_PHOTO["pairs"]]}
    yield Item(image=image, name="newspaper-futoshiki.jpg", puzzle=puzzle,
               solution=FUTOSHIKI_PHOTO["solution"])


SOURCES: list[Source] = [
    Source(
        slug="wichtounet-newspaper", family="sudoku", kind="printed-photo",
        origin="wichtounet/sudoku_dataset, images/ (newspaper Sudokus photographed with phone cameras)",
        licence="CC BY 4.0 (images and grids); code MIT",
        url="https://github.com/wichtounet/sudoku_dataset",
        fetch=git_clone("https://github.com/wichtounet/sudoku_dataset"),
        collect=wichtounet("images", with_corners=True),
        note="640x480. Targets are the printed clues; grid corners come from outlines_sorted.csv.",
    ),
    Source(
        slug="wichtounet-originals", family="sudoku", kind="printed-photo",
        origin="wichtounet/sudoku_dataset, original/ (full-resolution copies of the same photographs)",
        licence="CC BY 4.0 (images and grids); code MIT",
        url="https://github.com/wichtounet/sudoku_dataset",
        collect=wichtounet_originals,
        note="Up to 2448x3264. Only the copies whose downscaled twin carries a grid are included.",
    ),
    Source(
        slug="wichtounet-solved", family="sudoku", kind="solved-photo",
        origin="wichtounet/sudoku_dataset, mixed/ (the same puzzles photographed after being solved by hand)",
        licence="CC BY 4.0 (images and grids); code MIT",
        url="https://github.com/wichtounet/sudoku_dataset",
        collect=wichtounet("mixed"),
        note="Printed clues plus handwritten answers; the target holds all 81 digits.",
    ),
    Source(
        slug="wichtounet-solved-extra", family="sudoku", kind="solved-photo",
        origin="wichtounet/sudoku_dataset, mixed_incomplete/ and mixed_natural/",
        licence="CC BY 4.0 (images and grids); code MIT",
        url="https://github.com/wichtounet/sudoku_dataset",
        collect=lambda repo: (item for folder in ("mixed_incomplete", "mixed_natural")
                              for item in paired_dat_images(repo / folder)),
        note="Partly solved and naturally lit variants of the same puzzles.",
    ),
    Source(
        slug="rozet-solved", family="sudoku", kind="solved-photo",
        origin="francois-rozet/sudoku, resources/images/filled/",
        licence="not stated in the repository",
        url="https://github.com/francois-rozet/sudoku",
        fetch=git_clone("https://github.com/francois-rozet/sudoku"),
        collect=rozet("filled"),
        note="Newspaper Sudokus completed in pen, 640x480 up to 1280x1280.",
    ),
    Source(
        slug="rozet-newspaper", family="sudoku", kind="printed-photo",
        origin="francois-rozet/sudoku, resources/images/empty/ (unsolved grids)",
        licence="not stated in the repository",
        url="https://github.com/francois-rozet/sudoku",
        collect=rozet("empty"),
        note="Newspaper pages photographed before any answer was entered, up to 1280x1280; "
             "several frames include neighbouring puzzles, which makes grid detection harder.",
    ),
    Source(
        slug="rozet-handwritten", family="sudoku", kind="handwritten-photo",
        origin="francois-rozet/sudoku, resources/images/handwritten/",
        licence="not stated in the repository",
        url="https://github.com/francois-rozet/sudoku",
        collect=rozet("handwritten"),
        note="Hand-drawn grids with handwritten digits; outside the app's printed-clue scope.",
    ),
    Source(
        slug="rozet-render", family="sudoku", kind="render",
        origin="francois-rozet/sudoku, resources/images/generated/",
        licence="not stated in the repository",
        url="https://github.com/francois-rozet/sudoku",
        collect=rozet("generated"),
        note="Programmatically rendered grids, 1024x1024.",
    ),
    Source(
        slug="lexski-mixed", family="sudoku", kind="printed-photo",
        origin="Hugging Face Lexski/sudoku-image-recognition (photographs, app screenshots and hand-drawn grids)",
        licence="CC0 1.0",
        url="https://huggingface.co/datasets/Lexski/sudoku-image-recognition",
        fetch=git_clone("https://huggingface.co/datasets/Lexski/sudoku-image-recognition"),
        collect=lexski,
        note="1400 images with per-cell values and four corner keypoints; pencil-mark cells are "
             "recorded as empty and counted in the index. Mostly WebP.",
    ),
    Source(
        slug="kuleuven-assistant", family="sudoku", kind="printed-photo",
        origin="KU Leuven RDR 10.48804/3SUHHR, Sudoku Assistant app photographs",
        licence="CC BY 4.0",
        url="https://rdr.kuleuven.be/citation?persistentId=doi:10.48804/3SUHHR",
        cache="kuleuven",
        fetch=None,
        collect=kuleuven_app,
        note="103 photographs already perspective-corrected to the grid, 300x300. Targets hold every "
             "visible digit; the index counts the handwritten ones.",
    ),
    Source(
        slug="newspaper-photo", family="futoshiki", kind="printed-photo",
        origin="sam-watts/futoshiki-solver, screens/input_puzzle.jpg (webcam photograph of a newspaper page)",
        licence="not stated in the repository",
        url="https://github.com/sam-watts/futoshiki-solver",
        cache=".",
        collect=futoshiki_photo,
        note="Transcribed by hand from the image; the solver confirms a unique solution. "
             "Download with: curl -L -o <cache>/futoshiki-photo.jpg "
             "https://raw.githubusercontent.com/sam-watts/futoshiki-solver/master/screens/input_puzzle.jpg",
    ),
]


# --------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------
def jpeg_png_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:400_000]
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:2] != b"\xff\xd8":
        return None
    frames = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    at = 2
    while at < len(data) - 9:
        if data[at] != 0xFF:
            at += 1
            continue
        marker = data[at + 1]
        if marker in frames:
            height, width = struct.unpack(">HH", data[at + 5:at + 9])
            return width, height
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            at += 2
            continue
        at += 2 + struct.unpack(">H", data[at + 2:at + 4])[0]
    return None


def rule_conflicts(puzzle: dict) -> int:
    """Repeated values in a row, column or box of a filled Sudoku target."""
    if puzzle["type"] != "sudoku":
        return 0
    cells, rows, cols = puzzle["cells"], puzzle["rows"], puzzle["cols"]
    box_rows, box_cols = puzzle.get("boxRows", 3), puzzle.get("boxCols", 3)
    groups: list[list[int]] = []
    for r in range(rows):
        groups.append([cells[r * cols + c] for c in range(cols)])
    for c in range(cols):
        groups.append([cells[r * cols + c] for r in range(rows)])
    for br in range(0, rows, box_rows):
        for bc in range(0, cols, box_cols):
            groups.append([cells[(br + r) * cols + bc + c] for r in range(box_rows) for c in range(box_cols)])
    conflicts = 0
    for group in groups:
        values = [v for v in group if isinstance(v, int)]
        conflicts += len(values) - len(set(values))
    return conflicts


@dataclass
class BuildResult:
    entries: list[dict] = field(default_factory=list)
    completed: set[tuple[str, str]] = field(default_factory=set)
    skipped: set[tuple[str, str]] = field(default_factory=set)
    removed: set[str] = field(default_factory=set)


def write_json(path: Path, value: dict) -> None:
    """Replace an index/target atomically; never leave a truncated JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, mode="w",
                                     encoding="utf-8", newline="\n") as handle:
        temporary = Path(handle.name)
        try:
            json.dump(value, handle, indent=1)
            handle.write("\n")
        except BaseException:
            handle.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def build(sources: list[Source], fetch: bool, verify: bool,
          previous: list[dict] | None = None) -> BuildResult:
    from gridsolver.web_api import build_grid

    result = BuildResult()
    pending = []
    # Collect before changing outputs. An inaccessible cache is not an empty
    # rebuild, and a failing collector must not delete the old set.
    for source in sources:
        key = (source.family, source.slug)
        cache = CACHE / (source.cache or source.url.rstrip("/").split("/")[-1])
        if source.fetch and fetch:
            source.fetch(cache)
        if not cache.exists():
            print(f"  {source.slug}: cache missing ({cache}); previous inventory retained")
            result.skipped.add(key)
            continue
        items = []
        targets = set()
        try:
            for item in source.collect(cache):
                if Path(item.name).name != item.name or item.name in ("", ".", ".."):
                    raise ValueError(f"Invalid corpus image name: {item.name!r}")
                if verify:
                    try:
                        build_grid(item.puzzle)
                    except Exception as error:  # noqa: BLE001 - report rejected input
                        print(f"  {source.slug}/{item.name}: rejected by the solver contract: {error}")
                        continue
                target_name = Path(item.name).with_suffix(".json").name
                if target_name in targets:
                    raise ValueError(f"Duplicate target name in {source.slug}: {target_name}")
                targets.add(target_name)
                digest = hashlib.md5(item.image.read_bytes()).hexdigest()
                relative = f"{source.family}/{source.slug}/{item.name}"
                items.append((relative, digest, item))
        except SourceUnavailableError as error:
            # Discard even a partially collected source. Other valid sources may
            # still rebuild; this source's files and provenance remain retained.
            print(f"  {source.slug}: {error}; previous inventory retained")
            result.skipped.add(key)
            continue
        pending.append((source, items))
        result.completed.add(key)

    # Canonical ownership is registry order, then filename, never invocation
    # order. Retained/skipped sets participate using their actual image bytes.
    ranks = {(s.family, s.slug): n for n, s in enumerate(SOURCES)}

    def priority(relative):
        family, slug, _ = relative.split("/", 2)
        return ranks.get((family, slug), len(ranks)), relative

    candidates = []
    for entry in previous or []:
        if (entry["family"], entry["set"]) in result.completed:
            continue
        relative = entry["path"]
        image = CORPUS / relative
        if not image.resolve().is_relative_to(CORPUS.resolve()):
            raise ValueError(f"Inventory path escapes the corpus: {relative}")
        if image.is_file():
            candidates.append((relative, hashlib.md5(image.read_bytes()).hexdigest()))
    retained = {relative for relative, _ in candidates}
    candidates += [(relative, digest) for _, items in pending for relative, digest, _ in items]
    winners = {}
    for relative, digest in sorted(candidates, key=lambda pair: priority(pair[0])):
        winners.setdefault(digest, relative)
    accepted = set(winners.values())
    result.removed = retained - accepted
    CORPUS.mkdir(parents=True, exist_ok=True)
    for source, items in pending:
        target_dir = CORPUS / source.family / source.slug
        target_dir.mkdir(parents=True, exist_ok=True)
        # Only image/target outputs belong to the builder, not arbitrary notes.
        existing = {p.name for p in target_dir.iterdir()
                    if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".json")}
        kept = 0
        for relative, digest, item in items:
            if relative not in accepted:
                continue
            destination = CORPUS / relative
            if not destination.exists() or hashlib.md5(destination.read_bytes()).hexdigest() != digest:
                shutil.copy2(item.image, destination)
            target = {"puzzle": item.puzzle}
            if item.corners:
                target["corners"] = item.corners
            if item.solution:
                target["solution"] = item.solution
            write_json(destination.with_suffix(".json"), target)
            size = jpeg_png_size(item.image)
            result.entries.append({
                "path": relative, "family": source.family, "set": source.slug, "kind": source.kind,
                "bytes": destination.stat().st_size,
                "width": size[0] if size else None, "height": size[1] if size else None,
                "clues": sum(1 for value in item.puzzle["cells"] if isinstance(value, int)),
                "conflicts": rule_conflicts(item.puzzle),
                "corners": bool(item.corners), "solution": bool(item.solution),
                "md5": digest, **item.extra,
            })
            existing.discard(destination.name)
            existing.discard(destination.with_suffix(".json").name)
            kept += 1
        for stale in existing:
            (target_dir / stale).unlink()
        if not any(target_dir.iterdir()):
            target_dir.rmdir()
        print(f"  {source.slug}: {kept} images, {len(items) - kept} duplicates skipped")
    # Reclaim only known duplicate pairs, after the canonical copies exist.
    for relative in sorted(result.removed):
        image = CORPUS / relative
        image.unlink(missing_ok=True)
        image.with_suffix(".json").unlink(missing_ok=True)
    return result


def prune(index: dict) -> dict:
    """Drop index rows whose image is no longer in the corpus, and sets that
    have lost every image, so a renamed or removed source cannot linger."""
    kept = [entry for entry in index.get("entries", []) if (CORPUS / entry["path"]).exists()]
    live = {(entry["family"], entry["set"]) for entry in kept}
    index["entries"] = sorted(kept, key=lambda entry: entry["path"])
    index["sources"] = [source for source in index.get("sources", [])
                        if (source.get("family"), source["slug"]) in live]
    index["images"] = len(kept)
    return index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", action="append", default=[], help="build just these source slugs")
    parser.add_argument("--no-fetch", action="store_true", help="use the download cache as it is")
    parser.add_argument("--no-verify", action="store_true", help="skip the solver-contract check")
    parser.add_argument("--list", action="store_true", help="print the source registry and exit")
    args = parser.parse_args()

    if args.list:
        for source in SOURCES:
            print(f"{source.slug:26} {source.family:10} {source.kind:18} {source.licence}")
            print(f"{'':26} {source.url}")
        return 0

    sources = [s for s in SOURCES if not args.only or s.slug in args.only]
    if not sources:
        print("no matching sources; --list shows the registry")
        return 2
    print(f"corpus: {CORPUS}\ncache:  {CACHE}")

    # Merge into whatever the other builders contributed; a run of one source,
    # or of the renderer alone, must never drop the rest of the corpus.
    index = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {"sources": [], "entries": []}
    result = build(sources, fetch=not args.no_fetch, verify=not args.no_verify, previous=index.get("entries", []))
    index["corpus"] = str(CORPUS)
    described = [{"slug": s.slug, "family": s.family, "kind": s.kind, "origin": s.origin,
                  "licence": s.licence, "url": s.url, "note": s.note}
                 for s in sources if (s.family, s.slug) in result.completed]
    rebuilt = result.completed
    index["entries"] = sorted([e for e in index.get("entries", []) if (e["family"], e["set"]) not in rebuilt and e["path"] not in result.removed]
                              + result.entries, key=lambda e: e["path"])
    known = {(s.get("family"), s["slug"]): s for s in index.get("sources", [])}
    known.update({(s["family"], s["slug"]): s for s in described})
    index["sources"] = sorted(known.values(), key=lambda s: (s.get("family", ""), s["slug"]))
    write_json(INDEX, prune(index))

    total = sum(e["bytes"] for e in index["entries"])
    print(f"\n{index['images']} images, {total / 1048576:.0f} MiB in {CORPUS}")
    print(f"index: {INDEX}")
    return 1 if result.skipped else 0


if __name__ == "__main__":
    raise SystemExit(main())
