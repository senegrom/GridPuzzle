"""The external picture slice comes from one pinned, hash-checked revision."""

import email.message
import hashlib
import json
import re
from urllib.error import HTTPError, URLError

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


_URL = f"{fetch.SOURCE}/resolve/{fetch.REVISION}/data/test/metadata.jsonl"


class _Response:
    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self, size):
        return self.data[:size]


def _opener(outcomes):
    """An opener that raises or answers with each outcome in turn."""
    calls = []

    def opener(request, timeout):
        calls.append(request.full_url)
        outcome = outcomes[len(calls) - 1]
        if isinstance(outcome, BaseException):
            raise outcome
        return _Response(outcome)

    return opener, calls


def _http_error(code, retry_after=None):
    headers = email.message.Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return HTTPError(_URL, code, "error", headers, None)


def test_transient_failures_are_retried_with_doubling_pauses():
    opener, calls = _opener([URLError("reset"), _http_error(503), TimeoutError("read"), b"data"])
    pauses = []
    assert fetch.download(_URL, 100, opener=opener, sleep=pauses.append) == b"data"
    assert calls == [_URL] * 4
    assert pauses == [2.0, 4.0, 8.0]


def test_retries_are_bounded():
    opener, calls = _opener([URLError("down")] * fetch.ATTEMPTS)
    pauses = []
    with pytest.raises(URLError):
        fetch.download(_URL, 100, opener=opener, sleep=pauses.append)
    assert len(calls) == fetch.ATTEMPTS
    assert len(pauses) == fetch.ATTEMPTS - 1


@pytest.mark.parametrize("code", [403, 404])
def test_a_missing_or_forbidden_file_is_not_retried(code):
    opener, calls = _opener([_http_error(code), b"never"])
    pauses = []
    with pytest.raises(HTTPError):
        fetch.download(_URL, 100, opener=opener, sleep=pauses.append)
    assert len(calls) == 1
    assert pauses == []


def test_a_rate_limit_waits_as_asked_within_a_bound():
    opener, _ = _opener([_http_error(429, "12"), _http_error(429, "600"), b"data"])
    pauses = []
    assert fetch.download(_URL, 100, opener=opener, sleep=pauses.append) == b"data"
    assert pauses == [12.0, fetch.MAX_PAUSE]


def test_an_oversized_file_is_refused_without_retrying():
    opener, calls = _opener([b"x" * 101, b"x"])
    with pytest.raises(ValueError, match="exceeded 100 bytes"):
        fetch.download(_URL, 100, opener=opener, sleep=lambda seconds: None)
    assert len(calls) == 1
