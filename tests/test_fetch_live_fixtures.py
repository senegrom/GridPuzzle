"""The external picture slice comes from one pinned, hash-checked revision."""

import hashlib
import json
import re

import pytest

from scripts import fetch_live_fixtures as fetch


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def dataset(monkeypatch, tmp_path):
    """A stand-in dataset of LIMIT images served by URL, pins to match."""
    monkeypatch.chdir(tmp_path)
    names = [f"images/{index:02d}.webp" for index in range(fetch.LIMIT)]
    names.sort(key=lambda name: _sha(name.encode()))
    images = {name: f"image {name}".encode() for name in names}
    records = [{"file_name": name, "keypoints": [0, 0, 10, 0, 10, 10, 0, 10], "cells": []} for name in names]
    metadata = "".join(json.dumps(record) + "\n" for record in records).encode()
    base = f"{fetch.SOURCE}/resolve/{fetch.REVISION}/data/test"
    served = {f"{base}/metadata.jsonl": metadata, **{f"{base}/{name}": data for name, data in images.items()}}
    requested = []

    def download(url, limit):
        requested.append(url)
        return served[url]

    monkeypatch.setattr(fetch, "download", download)
    monkeypatch.setattr(fetch, "METADATA_SHA256", _sha(metadata))
    monkeypatch.setattr(fetch, "IMAGE_SHA256", {name: _sha(data) for name, data in images.items()})
    return served, requested, tmp_path / "live-fixtures" / "fixtures.json"


def test_the_pins_name_a_full_revision_and_every_selected_file():
    assert re.fullmatch(r"[0-9a-f]{40}", fetch.REVISION)
    assert re.fullmatch(r"[0-9a-f]{64}", fetch.METADATA_SHA256)
    assert len(fetch.IMAGE_SHA256) == fetch.LIMIT
    assert all(re.fullmatch(r"[0-9a-f]{64}", digest) for digest in fetch.IMAGE_SHA256.values())
    # in the order the metadata selects them, which spells the paths with
    # backslashes
    order = sorted(fetch.IMAGE_SHA256, key=lambda name: _sha(name.replace("/", "\\").encode()))
    assert list(fetch.IMAGE_SHA256) == order


def test_every_file_comes_from_the_pinned_revision_without_asking_for_head(dataset):
    _, requested, report = dataset
    fetch.run()
    assert len(requested) == 1 + fetch.LIMIT
    assert all(url.startswith(f"{fetch.SOURCE}/resolve/{fetch.REVISION}/") for url in requested)
    written = json.loads(report.read_text(encoding="utf-8"))
    assert written["revision"] == fetch.REVISION
    assert [fixture["name"] for fixture in written["fixtures"]] == list(fetch.IMAGE_SHA256)


def test_a_changed_image_is_refused(dataset):
    served, _, report = dataset
    name = list(fetch.IMAGE_SHA256)[5]
    served[f"{fetch.SOURCE}/resolve/{fetch.REVISION}/data/test/{name}"] += b" altered"
    with pytest.raises(ValueError, match=f"{name} has SHA-256"):
        fetch.run()
    assert not report.exists()


def test_changed_metadata_is_refused_before_any_image_is_fetched(dataset):
    served, requested, report = dataset
    served[f"{fetch.SOURCE}/resolve/{fetch.REVISION}/data/test/metadata.jsonl"] += b"\n"
    with pytest.raises(ValueError, match="metadata.jsonl has SHA-256"):
        fetch.run()
    assert len(requested) == 1
    assert not report.exists()
