"""Convert local SmartDoc CSV or MIDV-500 quad annotations to common motion traces.

No document portraits/identity fields are copied. The output contains only frame
references, coordinates and provenance. These traces are not Sudoku OCR labels.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import json
import math
from pathlib import Path


def quad(points: list) -> list[list[float]]:
    if len(points) != 4 or any(len(p) != 2 for p in points):
        raise ValueError("A frame needs four ordered 2D corners")
    out = [[float(x), float(y)] for x, y in points]
    if not all(math.isfinite(v) for p in out for v in p):
        raise ValueError("Non-finite corner")
    signs = []
    for i, a in enumerate(out):
        b, c = out[(i + 1) % 4], out[(i + 2) % 4]
        signs.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    if all(v < 0 for v in signs):
        out = [out[0], out[3], out[2], out[1]]
    elif not all(v > 0 for v in signs):
        raise ValueError("Degenerate or crossed quadrilateral")
    return out


def smartdoc(path: Path) -> list[dict]:
    opener = gzip.open if path.suffix == ".gz" else open
    clips: dict[str, list] = {}
    with opener(path, "rt", encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            key = f'{row["bg_name"]}/{row["model_name"]}'
            points = quad([[row[f"{corner}_x"], row[f"{corner}_y"]] for corner in ("tl", "tr", "br", "bl")])
            clips.setdefault(key, []).append({"index": int(row["frame_index"]), "frame": row["image_path"], "corners": points})
    return [{"clip": key, "frames": sorted(frames, key=lambda f: f["index"])} for key, frames in sorted(clips.items())]


def midv(path: Path) -> list[dict]:
    # Pass the downloaded dataset's ground_truth directory, not field metadata.
    clips: dict[str, list] = {}
    for file in sorted(path.rglob("*.json")):
        record = json.loads(file.read_text(encoding="utf-8"))
        if "quad" not in record:
            raise ValueError(f"Not a MIDV frame-quad annotation: {file}")
        relative = file.relative_to(path)
        clips.setdefault(str(relative.parent), []).append({"index": len(clips.get(str(relative.parent), [])),
            "frame": str(relative.with_suffix(".tif")), "corners": quad(record["quad"])})
    return [{"clip": key, "frames": frames} for key, frames in sorted(clips.items())]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("format", choices=("smartdoc", "midv"))
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    clips = (smartdoc if args.format == "smartdoc" else midv)(args.input)
    if not clips:
        raise ValueError("No annotated frames found; refusing an empty successful report")
    files = [args.input] if args.input.is_file() else sorted(args.input.rglob("*.json"))
    report = {"formatVersion": 1, "source": args.format, "purpose": "motion/registration only, not Sudoku OCR ground truth",
              "inputs": [{"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files], "clips": clips}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
