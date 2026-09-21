"""Bounded, reproducible CC0 test slice; never download a user's photographs."""
from __future__ import annotations
import base64
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from urllib.request import Request, urlopen

SOURCE = "https://huggingface.co/datasets/Lexski/sudoku-image-recognition"
REVISION = "733559b"
LIMIT = 12
MAX_FILE = 6 * 1024 * 1024

def download(url: str, limit: int) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "GridPuzzle-regression-tests/1"}), timeout=45) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"Bounded download exceeded {limit} bytes: {url}")
    return data

def run() -> None:
    info = json.loads(download("https://huggingface.co/api/datasets/Lexski/sudoku-image-recognition", 512 * 1024))
    revision = info["sha"]
    if len(revision) != 40 or not revision.startswith(REVISION) or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Dataset revision changed; review before updating the pinned slice")
    metadata = download(f"{SOURCE}/resolve/{revision}/data/test/metadata.jsonl", 4 * 1024 * 1024)
    records = [json.loads(line) for line in metadata.decode("utf-8").splitlines() if line.strip()]
    # Pick before running ANY recognizer; do not filter difficult/pencil cells.
    records.sort(key=lambda r: hashlib.sha256(r["file_name"].encode()).hexdigest())
    fixtures = []
    for record in records[:LIMIT]:
        relative = PurePosixPath(record["file_name"].replace("\\", "/"))
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Unsafe dataset image path")
        keypoints = record["keypoints"]
        if len(keypoints) != 8 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in keypoints):
            raise ValueError("Invalid dataset quadrilateral")
        points = list(zip(keypoints[::2], keypoints[1::2]))
        cx, cy = sum(p[0] for p in points) / 4, sum(p[1] for p in points) / 4
        points.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
        first = min(range(4), key=lambda i: sum(points[i]))
        points = points[first:] + points[:first]
        data = download(f"{SOURCE}/resolve/{revision}/data/test/{quote(str(relative), safe='/')}", MAX_FILE)
        suffix = relative.suffix.lower()
        mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(suffix)
        if mime is None:
            raise ValueError("Unexpected dataset image format")
        fixtures.append({"name": str(relative), "corners": points, "cells": record["cells"],
                         "sha256": hashlib.sha256(data).hexdigest(),
                         "data": f"data:{mime};base64," + base64.b64encode(data).decode("ascii")})
    if len(fixtures) != LIMIT:
        raise ValueError("Incomplete external test slice")
    out = Path("live-fixtures")
    out.mkdir(exist_ok=True)
    report = {"source": SOURCE, "revision": revision, "license": "CC0-1.0", "selection": "first 12 SHA256(file_name)-sorted records of test split, without performance filtering",
              "metadata_sha256": hashlib.sha256(metadata).hexdigest(), "fixtures": fixtures}
    (out / "fixtures.json").write_text(json.dumps(report), encoding="utf-8")
    print(f"Fetched {len(fixtures)} fixed test images from {SOURCE}@{REVISION}")

if __name__ == "__main__":
    run()
