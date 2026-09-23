"""Bounded, reproducible CC0 test slice; never download a user's photographs.

Every file comes from one commit of the dataset, fetched by its full
revision, and must match a pinned SHA-256: the metadata that selects the
slice and each selected image. The dataset's current HEAD is never
consulted, so a later upstream commit can neither change the slice nor
block a run.
"""
from __future__ import annotations
import base64
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from urllib.request import Request, urlopen

SOURCE = "https://huggingface.co/datasets/Lexski/sudoku-image-recognition"
REVISION = "733559bafd65b5bdb953e07e5c7e06df0b03008d"
LIMIT = 12
MAX_FILE = 6 * 1024 * 1024
METADATA_SHA256 = "ab9bdb19b7379e6d31b09b91ea8ac139b313df26a8f320949fe2cffc2d8903a2"
# The first LIMIT records of the pinned metadata by SHA-256 of their file
# name, in that order, each with the SHA-256 of its image at REVISION.
IMAGE_SHA256 = {
    "images/6afxp9u0ke0d1.webp": "930df0cc75870e6fde8d8015e53c50e4f3ed790a78a75ec9d80737ccf8d0a9a9",
    "images/mqec6cb3dm0d1.webp": "8b67de88afded20e196722183257c57af0b47d04d4580ec26aaba4ffc27bbadd",
    "images/zhudyie50d0d1.webp": "1681f73cdaaf0557d47eedf572cf5539a5f8507f8d4a926310b081c8dacb198d",
    "images/hj6j2663utzc1.webp": "5051e588be9d1bd7155b59a2d63786de9787fc235f6a5a79a90e2cae233e3ef9",
    "images/84mr1atn7z0d1.webp": "5068d60cdd207165b3d5cbe7abe5539d0f87a0c0a8e94e1017088360ad38495d",
    "images/p792glj7xlac1.webp": "dd641f5861211dc5cb198e4024fed3b46a883a70787c08f3e4e13e328dc7144b",
    "images/w3jfhxir63dc1.webp": "67d7304e412d719d8a53484e9ba334bac62947a4231529e3ccd24f4489210053",
    "images/pjlx823hg31d1.webp": "cbb0e6acd9fe13e3606502859546f873cdb42901e6c3cdb7254db3385133f99f",
    "images/66p4e9ysqe0d1.webp": "75869fc1ff9431ad7378496a87cfdcaae9a1eff55a3c410a459925d4353c525e",
    "images/q83r4vueaifc1.webp": "41ecc2c20b06f3f4020b6bcc384179fe6e47698d5aa3383b4e0ccecb53be2129",
    "images/64580592jqzc1.webp": "1a063da69a663c80af5304232b4089bb7f6cda6acf6d5434035078c15b5e7147",
    "images/r4k4memgy6ac1.webp": "e774200ec2795618af85f017c910c6ec626adde3d8807ed58896492bc21f3b76",
}

def download(url: str, limit: int) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "GridPuzzle-regression-tests/1"}), timeout=45) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"Bounded download exceeded {limit} bytes: {url}")
    return data

def verified(data: bytes, expected: str, name: str) -> bytes:
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError(f"{name} has SHA-256 {actual}, not the pinned {expected}")
    return data

def run() -> None:
    base = f"{SOURCE}/resolve/{REVISION}/data/test"
    metadata = verified(download(f"{base}/metadata.jsonl", 4 * 1024 * 1024), METADATA_SHA256, "metadata.jsonl")
    records = [json.loads(line) for line in metadata.decode("utf-8").splitlines() if line.strip()]
    # Pick before running ANY recognizer; do not filter difficult/pencil cells.
    records.sort(key=lambda r: hashlib.sha256(r["file_name"].encode()).hexdigest())
    fixtures = []
    for record in records[:LIMIT]:
        relative = PurePosixPath(record["file_name"].replace("\\", "/"))
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Unsafe dataset image path")
        if str(relative) not in IMAGE_SHA256:
            raise ValueError(f"The metadata selected {relative}, which has no pinned SHA-256")
        keypoints = record["keypoints"]
        if len(keypoints) != 8 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in keypoints):
            raise ValueError("Invalid dataset quadrilateral")
        points = list(zip(keypoints[::2], keypoints[1::2]))
        cx, cy = sum(p[0] for p in points) / 4, sum(p[1] for p in points) / 4
        points.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
        first = min(range(4), key=lambda i: sum(points[i]))
        points = points[first:] + points[:first]
        data = verified(download(f"{base}/{quote(str(relative), safe='/')}", MAX_FILE),
                        IMAGE_SHA256[str(relative)], str(relative))
        suffix = relative.suffix.lower()
        mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(suffix)
        if mime is None:
            raise ValueError("Unexpected dataset image format")
        fixtures.append({"name": str(relative), "corners": points, "cells": record["cells"],
                         "sha256": hashlib.sha256(data).hexdigest(),
                         "data": f"data:{mime};base64," + base64.b64encode(data).decode("ascii")})
    if [fixture["name"] for fixture in fixtures] != list(IMAGE_SHA256):
        raise ValueError("Incomplete external test slice")
    out = Path("live-fixtures")
    out.mkdir(exist_ok=True)
    report = {"source": SOURCE, "revision": REVISION, "license": "CC0-1.0", "selection": "first 12 SHA256(file_name)-sorted records of test split, without performance filtering",
              "metadata_sha256": METADATA_SHA256, "fixtures": fixtures}
    (out / "fixtures.json").write_text(json.dumps(report), encoding="utf-8")
    print(f"Fetched {len(fixtures)} fixed test images from {SOURCE}@{REVISION}")

if __name__ == "__main__":
    run()
