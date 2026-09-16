"""Exercise real rebuild/index operations without network or external datasets."""
import hashlib
import json
import shutil
import sys

import pytest

from corpus import build_corpus as builder

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010802000000")
PUZZLE = {"version": 1, "type": "sudoku", "rows": 4, "cols": 4,
          "boxRows": 2, "boxCols": 2, "cells": [None] * 16}


@pytest.fixture
def corpus(tmp_path, monkeypatch):
    root, cache, index = tmp_path / "images", tmp_path / "cache", tmp_path / "index.json"
    monkeypatch.setattr(builder, "CORPUS", root)
    monkeypatch.setattr(builder, "CACHE", cache)
    monkeypatch.setattr(builder, "INDEX", index)
    sources = []
    for name in ("first", "second", "third"):
        directory = cache / name
        directory.mkdir(parents=True)
        (directory / "picture.png").write_bytes(PNG if name != "third" else PNG + b"different")
        source = builder.Source(name, "sudoku", "printed-photo", f"origin {name}", "test", f"https://example.test/{name}",
            lambda folder: (builder.Item(p, p.name, PUZZLE) for p in sorted(folder.glob("*.png"))))
        sources.append(source)
    monkeypatch.setattr(builder, "SOURCES", sources)

    def run(*names):
        monkeypatch.setattr(sys, "argv", ["build_corpus.py", "--no-fetch"] +
                            [arg for name in names for arg in ("--only", name)])
        return builder.main()

    def inventory():
        return json.loads(index.read_text())

    return root, cache, index, run, inventory, sources


def test_full_partial_full_has_stable_membership(corpus):
    root, _, _, run, inventory, _ = corpus
    assert run() == 0
    original = inventory()
    for selected in [("second",), ("first",), ("third",), ()]:
        assert run(*selected) == 0
        assert inventory() == original
        images = sorted(root.glob("*/*/*.png"))
        hashes = [hashlib.md5(p.read_bytes()).hexdigest() for p in images]
        assert len(hashes) == len(set(hashes)) == 2


def test_canonical_source_reclaims_duplicate_from_lower_priority(corpus):
    root, _, _, run, inventory, _ = corpus
    assert run("second") == 0
    assert run("first") == 0
    assert [e["set"] for e in inventory()["entries"]] == ["first"]
    assert not (root / "sudoku/second/picture.png").exists()
    assert not (root / "sudoku/second/picture.json").exists()
    assert run("second") == 0
    assert [e["set"] for e in inventory()["entries"]] == ["first"]


def test_missing_cache_preserves_images_targets_and_provenance(corpus):
    root, cache, _, run, inventory, _ = corpus
    run()
    before = inventory()
    files = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
    shutil.rmtree(cache / "first")
    assert run("first") == 1
    assert inventory() == before
    assert {p: p.read_bytes() for p in files} == files
    assert run("second") == 0  # skipped/retained first still owns its bytes
    assert inventory() == before


def test_successful_empty_rebuild_is_not_a_skipped_source(corpus):
    root, cache, _, run, inventory, _ = corpus
    run()
    (cache / "first/picture.png").unlink()
    (root / "sudoku/first/notes.md").write_text("user notes")
    assert run("first") == 0
    assert [e["set"] for e in inventory()["entries"]] == ["third"]
    assert (root / "sudoku/first/notes.md").read_text() == "user notes"
    assert run("second") == 0
    assert [e["set"] for e in inventory()["entries"]] == ["second", "third"]


def test_collector_failure_does_not_mutate_existing_outputs(corpus):
    root, _, index, run, _, sources = corpus
    run()
    before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
    before[index] = index.read_bytes()

    def broken(_):
        raise OSError("source unavailable")

    sources[1].collect = broken
    with pytest.raises(OSError, match="source unavailable"):
        run()
    assert {p: p.read_bytes() for p in before} == before


def test_retained_hashes_come_from_actual_files_not_stale_index(corpus):
    root, cache, _, run, inventory, _ = corpus
    run("first")
    changed = PNG + b"new image bytes"
    (root / "sudoku/first/picture.png").write_bytes(changed)
    (cache / "second/picture.png").write_bytes(changed)
    run("second")
    assert len(inventory()["entries"]) == 1
    assert not (root / "sudoku/second/picture.png").exists()


def test_removed_owner_does_not_reserve_obsolete_hash(corpus):
    _, cache, _, run, inventory, _ = corpus
    run()
    (cache / "first/picture.png").write_bytes(PNG + b"replacement")
    run("first", "second")
    assert {e["set"] for e in inventory()["entries"]} == {"first", "second", "third"}


def test_registered_order_not_caller_order_determines_ownership(corpus):
    _, _, _, _, _, sources = corpus
    result = builder.build(list(reversed(sources)), False, True)
    assert {e["set"] for e in result.entries} == {"first", "third"}


def test_outside_inventory_path_is_rejected_before_output_deletion(corpus, tmp_path):
    outside = tmp_path / "outside.png"
    outside.write_bytes(PNG)
    with pytest.raises(ValueError, match="escapes"):
        builder.build([], False, True, [{"path": "../outside.png", "family": "x", "set": "y"}])
    assert outside.read_bytes() == PNG


def test_atomic_index_failure_preserves_old_file(tmp_path, monkeypatch):
    index = tmp_path / "index.json"
    index.write_text('{"old":true}')
    before = index.read_bytes()

    def failed(*_):
        raise OSError("disk failure")

    monkeypatch.setattr(builder.os, "replace", failed)
    with pytest.raises(OSError, match="disk failure"):
        builder.write_json(index, {"new": True})
    assert index.read_bytes() == before
    assert list(tmp_path.iterdir()) == [index]
