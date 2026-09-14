"""Shared corpus locations. Overrides are read once, at process startup."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Retain the existing defaults; every command honours the same overrides.
CORPUS = Path(os.environ.get("PUZZLE_CORPUS", "E:/OneDrive/Coding/PuzzleCorpus")).expanduser()
CACHE = Path(os.environ.get("PUZZLE_CORPUS_CACHE", "E:/tmp-claude/corpus-cache")).expanduser()
INDEX = Path(os.environ.get("PUZZLE_CORPUS_INDEX", ROOT / "corpus/index.json")).expanduser()
JANKO_CACHE = CACHE / "janko"
