"""Fetch puzzle data for the non-Sudoku families from janko.at.

Each puzzle page embeds a plain-text block with the printed clues and the
solution. The pages carry no images, so this only collects the puzzle data;
``render_puzzles.py`` turns it into images with exact targets.

The site is fetched slowly and identifies this client. Pages are cached, so a
second run costs nothing. Licence: CC BY-NC-SA 3.0 (Otto Janko) - private
research use only, the corpus is not published.

Usage::

    python corpus/fetch_janko.py                # 40 puzzles per family
    python corpus/fetch_janko.py --count 80 --delay 3
"""
from __future__ import annotations

import argparse
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

CACHE = Path("E:/tmp-claude/corpus-cache/janko")
AGENT = "GridPuzzle corpus (private research, not republished; github.com/senegrom/GridPuzzle)"

# family -> (url segment, highest index seen, zero padding)
COLLECTIONS = {
    "kakuro": ("Kakuro", 1010, 4),
    "str8ts": ("Straights", 570, 3),
    "hidato": ("Hidoku", 530, 3),
    "kenken": ("Kendoku", 430, 3),
    "futoshiki": ("Futoshiki", 430, 3),
    "killersudoku": ("Sumdoku", 110, 3),
    "slitherlink": ("Slitherlink", 1230, 4),
    "sudoku": ("Sudoku", 1280, 4),
}


def spread(count: int, highest: int) -> list[int]:
    """Indices spaced across the collection, so sizes and setters vary."""
    if count >= highest:
        return list(range(1, highest + 1))
    step = highest / count
    return sorted({max(1, min(highest, int(round(1 + index * step)))) for index in range(count)})


def fetch(family: str, index: int, delay: float) -> str | None:
    segment, _, padding = COLLECTIONS[family]
    target = CACHE / family / f"{index:0{padding}d}.txt"
    if target.exists():
        return target.read_text(encoding="utf-8")
    url = f"https://www.janko.at/Raetsel/{segment}/{index:0{padding}d}.a.htm"
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            html = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    finally:
        time.sleep(delay)
    match = re.search(r'<script[^>]*id="data"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(match.group(1).strip() + "\n", encoding="utf-8")
    return target.read_text(encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=40, help="puzzles per family")
    parser.add_argument("--delay", type=float, default=3.0, help="seconds between requests")
    parser.add_argument("--only", action="append", default=[], help="limit to these families")
    args = parser.parse_args()

    families = [f for f in COLLECTIONS if not args.only or f in args.only]
    for family in families:
        _, highest, _ = COLLECTIONS[family]
        wanted = spread(args.count, highest)
        got = 0
        for index in wanted:
            try:
                if fetch(family, index, args.delay):
                    got += 1
            except Exception as error:  # noqa: BLE001 - one bad page must not stop the run
                print(f"  {family} {index}: {error}")
        print(f"{family}: {got}/{len(wanted)} pages cached in {CACHE / family}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
