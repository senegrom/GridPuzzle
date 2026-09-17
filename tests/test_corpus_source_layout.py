"""Missing source assets must not look like a successful empty rebuild."""
import json
import sys

import pytest

from corpus import build_corpus as builder

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010802000000")
DAT = ("0 0 0 0 0 0 0 0 0\n") * 9
OUTLINES = "filepath,p1_x,p1_y,p2_x,p2_y,p3_x,p3_y,p4_x,p4_y\n"


@pytest.fixture
def registered_corpus(tmp_path, monkeypatch):
    root, cache, index = tmp_path / "output", tmp_path / "cache", tmp_path / "index.json"
    monkeypatch.setattr(builder, "CORPUS", root)
    monkeypatch.setattr(builder, "CACHE", cache)
    monkeypatch.setattr(builder, "INDEX", index)

    def run(slug):
        monkeypatch.setattr(sys, "argv", ["build_corpus.py", "--no-fetch", "--only", slug])
        return builder.main()

    def snapshot():
        return (index.read_bytes(), {str(p.relative_to(root)): p.read_bytes()
                                   for p in root.rglob("*") if p.is_file()})

    return cache, run, snapshot


def pair(folder, name="grid.png"):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(PNG)
    (folder / name).with_suffix(".dat").write_text(DAT, encoding="utf-8")


def newspaper(cache):
    repo = cache / "sudoku_dataset"
    pair(repo / "images")
    (repo / "original").mkdir()
    (repo / "README.md").write_text("Other source assets remain", encoding="utf-8")
    (repo / "outlines_sorted.csv").write_text(OUTLINES, encoding="utf-8")
    return repo


def test_missing_selected_subfolder_preserves_registered_source(registered_corpus):
    cache, run, snapshot = registered_corpus
    repo = newspaper(cache)
    assert run("wichtounet-newspaper") == 0
    before = snapshot()
    (repo / "images").rename(repo / "images-offline")
    assert run("wichtounet-newspaper") == 1
    assert snapshot() == before
    assert (repo / "original").is_dir()


def test_missing_required_outline_metadata_preserves_source(registered_corpus):
    cache, run, snapshot = registered_corpus
    repo = newspaper(cache)
    assert run("wichtounet-newspaper") == 0
    before = snapshot()
    (repo / "outlines_sorted.csv").unlink()
    assert run("wichtounet-newspaper") == 1
    assert snapshot() == before


def test_existing_empty_directory_is_a_completed_rebuild(registered_corpus):
    cache, run, snapshot = registered_corpus
    repo = newspaper(cache)
    assert run("wichtounet-newspaper") == 0
    for path in (repo / "images").iterdir():
        path.unlink()
    assert run("wichtounet-newspaper") == 0
    index, files = snapshot()
    assert json.loads(index)["images"] == 0
    assert files == {}


@pytest.mark.parametrize("missing", ["original", "images"])
def test_originals_require_both_images_and_annotation_directory(registered_corpus, missing):
    cache, run, snapshot = registered_corpus
    repo = newspaper(cache)
    (repo / "original/grid.original.jpg").write_bytes(PNG)
    assert run("wichtounet-originals") == 0
    before = snapshot()
    (repo / missing).rename(repo / (missing + "-offline"))
    assert run("wichtounet-originals") == 1
    assert snapshot() == before


def test_multi_folder_source_is_not_partially_replaced(registered_corpus):
    cache, run, snapshot = registered_corpus
    repo = cache / "sudoku_dataset"
    pair(repo / "mixed_incomplete", "first.png")
    pair(repo / "mixed_natural", "second.png")
    (repo / "mixed_natural/second.png").write_bytes(PNG + b"different")
    assert run("wichtounet-solved-extra") == 0
    before = snapshot()
    (repo / "mixed_natural").rename(repo / "mixed_natural-offline")
    assert run("wichtounet-solved-extra") == 1
    assert snapshot() == before  # discard the first folder's collected items too


@pytest.mark.parametrize("folder,slug", [
    ("filled", "rozet-solved"), ("empty", "rozet-newspaper"),
    ("handwritten", "rozet-handwritten"), ("generated", "rozet-render"),
])
def test_rozet_selected_folder_is_required(registered_corpus, folder, slug):
    cache, run, snapshot = registered_corpus
    images = cache / "sudoku/resources/images"
    pair(images / folder)
    assert run(slug) == 0
    before = snapshot()
    (images / folder).rename(images / (folder + "-offline"))
    assert run(slug) == 1
    assert snapshot() == before


@pytest.mark.parametrize("missing", ["metadata.jsonl", "grid.png"])
def test_lexski_requires_each_split_metadata_and_referenced_image(registered_corpus, missing):
    cache, run, snapshot = registered_corpus
    repo = cache / "sudoku-image-recognition/data"
    record = {"file_name": "grid.png", "cells": [[[0] * 10 for _ in range(9)] for _ in range(9)]}
    for split in ("train", "val", "test"):
        folder = repo / split
        folder.mkdir(parents=True)
        (folder / "grid.png").write_bytes(PNG + split.encode())
        (folder / "metadata.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
    assert run("lexski-mixed") == 0
    before = snapshot()
    (repo / "test" / missing).unlink()
    assert run("lexski-mixed") == 1
    assert snapshot() == before


def test_single_photo_is_required_even_when_shared_cache_exists(registered_corpus):
    cache, run, snapshot = registered_corpus
    cache.mkdir()
    photo = cache / "futoshiki-photo.jpg"
    photo.write_bytes(PNG)
    assert run("newspaper-photo") == 0
    before = snapshot()
    photo.unlink()
    assert run("newspaper-photo") == 1
    assert snapshot() == before


@pytest.mark.parametrize("missing", ["data.npy", "labels.npy"])
def test_kuleuven_missing_extracted_arrays_preserve_source(registered_corpus, missing):
    np = pytest.importorskip("numpy")
    pytest.importorskip("PIL")
    cache, run, snapshot = registered_corpus
    folder = cache / "kuleuven/extracted/dataset"
    folder.mkdir(parents=True)
    np.save(folder / "data.npy", np.full((1, 30, 30), 255, dtype="uint8"))
    np.save(folder / "labels.npy", np.zeros((1, 9, 9), dtype="uint8"))
    assert run("kuleuven-assistant") == 0
    before = snapshot()
    (folder / missing).unlink()
    assert run("kuleuven-assistant") == 1
    assert snapshot() == before


def test_required_folder_replaced_by_file_is_not_empty_source(registered_corpus):
    cache, run, snapshot = registered_corpus
    repo = newspaper(cache)
    assert run("wichtounet-newspaper") == 0
    before = snapshot()
    (repo / "images").rename(repo / "images-offline")
    (repo / "images").write_text("not a directory", encoding="utf-8")
    assert run("wichtounet-newspaper") == 1
    assert snapshot() == before


def test_unreadable_source_folder_preserves_outputs(registered_corpus, monkeypatch):
    from pathlib import Path

    cache, run, snapshot = registered_corpus
    repo = newspaper(cache)
    assert run("wichtounet-newspaper") == 0
    before = snapshot()
    original = Path.iterdir

    def unreadable(path):
        if path == repo / "images":
            raise PermissionError("source not mounted")
        return original(path)

    monkeypatch.setattr(Path, "iterdir", unreadable)
    assert run("wichtounet-newspaper") == 1
    assert snapshot() == before


def test_missing_outline_columns_do_not_strip_prior_ground_truth(registered_corpus):
    cache, run, snapshot = registered_corpus
    repo = newspaper(cache)
    outlines = repo / "outlines_sorted.csv"
    outlines.write_text(OUTLINES + "grid.png,0,0,1,0,1,1,0,1\n", encoding="utf-8")
    assert run("wichtounet-newspaper") == 0
    before = snapshot()
    outlines.write_text("wrong,header\n", encoding="utf-8")
    assert run("wichtounet-newspaper") == 1
    assert snapshot() == before
