"""Build routing regressions: no downloads or vendor lifecycle scripts."""
import hashlib
import json
from pathlib import Path

import pytest
from scripts import build_web


@pytest.mark.parametrize("build", ["111111111111", "222222222222"])
def test_runtime_urls_and_worker_are_immutable(build, tmp_path):
    build_web.write_web_sources(tmp_path, build)
    worker = (tmp_path / f"solver-worker.{build}.js").read_text(encoding="utf-8")
    assert (tmp_path / "solver-worker.js").read_text(encoding="utf-8") == worker
    assert f'./vendor/{build}/pyodide/pyodide.mjs' in worker
    assert f'./vendor/{build}/pyodide/' in worker
    assert f'solver.{build}.zip' in worker
    assert f'./solver-worker.{build}.js' in (tmp_path / "app.js").read_text(encoding="utf-8")
    preview = (tmp_path / "live-solver.js").read_text(encoding="utf-8")
    assert f'./solver-worker.{build}.js' in preview
    assert './solver-worker.js' not in preview
    ocr = (tmp_path / "ocr-host-worker.js").read_text(encoding="utf-8")
    for name in ["tesseract", "tesseract-core", "tessdata"]:
        assert f'./vendor/{build}/{name}/' in ocr
    for script in tmp_path.glob("*.js"):
        assert './vendor/pyodide/' not in script.read_text(encoding="utf-8")
        assert '__BUILD_ID__' not in script.read_text(encoding="utf-8")


# The upstream layout of each pinned package, as far as the build reads it:
# Pyodide and the English model ship no licence file (the build vendors
# theirs), and tesseract.js-core ships bare .wasm files the build must skip.
PACKAGE_PATHS = {
    "pyodide": ["pyodide.mjs", "pyodide.js", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json", "package.json"],
    "tesseract.js": ["dist/tesseract.min.js", "dist/worker.min.js", "dist/tesseract.min.js.LICENSE.txt", "dist/worker.min.js.LICENSE.txt", "LICENSE.md", "package.json"],
    "tesseract.js-core": ["tesseract-core-lstm.wasm", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm.js", "LICENSE", "package.json"],
    "@tesseract.js-data/eng": ["4.0.0_best_int/eng.traineddata.gz", "package.json"],
}
LICENCES = {"pyodide": "MPL-2.0", "tesseract.js": "Apache-2.0", "tesseract.js-core": "Apache-2.0", "@tesseract.js-data/eng": "MIT"}


def fake_packages(paths=PACKAGE_PATHS):
    def package(name, version, integrity, temporary):
        root = temporary / name.replace("/", "_")
        for file in paths[name]:
            path = root / file
            path.parent.mkdir(parents=True, exist_ok=True)
            if file == "package.json":
                path.write_text(json.dumps({"name": name, "license": LICENCES[name]}))
            else:
                path.write_text(f"unchanged upstream bytes: {name}/{file}")
        return root, integrity

    return package


def fake_build(monkeypatch, out, build="111111111111", paths=PACKAGE_PATHS):
    monkeypatch.setattr(build_web.subprocess, "check_output", lambda *a, **k: build + "0" * 28)
    monkeypatch.setattr(build_web, "icon", lambda size, path: None)
    monkeypatch.setattr(build_web, "package", fake_packages(paths))
    build_web.build(out)


def test_manifest_contains_the_complete_versioned_runtime(monkeypatch, tmp_path):
    build = "111111111111"
    package_paths = PACKAGE_PATHS
    fake_build(monkeypatch, tmp_path, build)
    manifest = json.loads((tmp_path / "assets.json").read_text(encoding="utf-8"))
    paths = {asset["path"] for asset in manifest["assets"]}
    assert manifest["build"] == build
    assert f"solver-worker.{build}.js" in paths
    for file in package_paths["pyodide"]:
        if file != "package.json":
            assert f"vendor/{build}/pyodide/{file}" in paths
    for path in paths:
        if path.startswith("vendor/"):
            assert path.startswith(f"vendor/{build}/")
    for asset in manifest["assets"]:
        data = (tmp_path / Path(asset["path"])).read_bytes()
        assert hashlib.sha256(data).hexdigest() == asset["sha256"]
        assert len(data) == asset["bytes"]


def test_every_package_ships_its_licence_and_no_unused_core(monkeypatch, tmp_path):
    build = "111111111111"
    fake_build(monkeypatch, tmp_path, build)
    paths = {asset["path"] for asset in json.loads((tmp_path / "assets.json").read_text(encoding="utf-8"))["assets"]}
    expected = {
        "licenses/pyodide-LICENSE",
        "licenses/pyodide-CPython-LICENSE",
        "licenses/tesseract.js-LICENSE.md",
        "licenses/tesseract.js-core-LICENSE",
        "licenses/tesseract.js-data_eng-LICENSE",
        f"vendor/{build}/tesseract/tesseract.min.js.LICENSE.txt",
        f"vendor/{build}/tesseract/worker.min.js.LICENSE.txt",
    }
    assert expected <= paths
    # The libraries statically linked into the two WebAssembly runtimes, and
    # the Emscripten runtime inside both, ship their own texts.
    vendored = {f"licenses/pyodide-{name}" for name in (
        "CPython-Doc-license.rst", "HACL-LICENSE", "libffi-LICENSE", "xz-COPYING", "zstd-LICENSE",
        "zlib-LICENSE", "bzip2-LICENSE", "emscripten-LICENSE", "musl-COPYRIGHT")}
    vendored |= {f"licenses/tesseract.js-core-{name}" for name in (
        "leptonica-license.txt", "libjpeg-README", "libpng-LICENSE", "libtiff-COPYRIGHT", "giflib-COPYING",
        "libwebp-COPYING", "libwebp-PATENTS", "openlibm-LICENSE.md", "zlib-README",
        "emscripten-LICENSE", "musl-COPYRIGHT")}
    assert vendored <= paths
    # The loaders embed their WebAssembly; the bare binaries are never requested.
    cores = sorted(path.rsplit("/", 1)[1] for path in paths if "/tesseract-core/" in path)
    assert cores == ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]
    assert not any(path.endswith(".wasm") and "tesseract" in path for path in paths)
    notices = (tmp_path / "THIRD_PARTY_NOTICES.txt").read_text(encoding="utf-8")
    for name, licence in LICENCES.items():
        assert f"{name} " in notices and licence in notices
    for path in expected | vendored:
        assert f"  {path}" in notices
    # libjpeg's licence requires this sentence wherever only executable code ships.
    assert "this software is based in part on the work of the Independent JPEG Group" in notices


def test_two_licence_texts_with_one_published_name_stop_the_build(monkeypatch, tmp_path):
    # The model's LICENSE would land on the name Pyodide's own LICENSE uses.
    licences = dict(build_web.EXTRA_LICENCES)
    licences["pyodide"] = (*licences["pyodide"], "tesseract.js-data-eng/LICENSE")
    monkeypatch.setattr(build_web, "EXTRA_LICENCES", licences)
    with pytest.raises(ValueError, match="would both be published as licenses/pyodide-LICENSE"):
        fake_build(monkeypatch, tmp_path)


def test_a_package_without_any_licence_stops_the_build(monkeypatch, tmp_path):
    monkeypatch.setattr(build_web, "EXTRA_LICENCES", {})
    with pytest.raises(FileNotFoundError, match="pyodide ships no licence file"):
        fake_build(monkeypatch, tmp_path)


def test_a_missing_bundle_licence_notice_stops_the_build(monkeypatch, tmp_path):
    paths = dict(PACKAGE_PATHS)
    paths["tesseract.js"] = [p for p in paths["tesseract.js"] if not p.endswith("worker.min.js.LICENSE.txt")]
    with pytest.raises(FileNotFoundError, match="worker.min.js.LICENSE.txt"):
        fake_build(monkeypatch, tmp_path, paths=paths)


def test_vendored_licence_texts_are_the_expected_licences():
    texts = {
        relative: (build_web.VENDORED_LICENCES / relative).read_text(encoding="utf-8")
        for relatives in build_web.EXTRA_LICENCES.values()
        for relative in relatives
    }
    assert texts["pyodide/LICENSE"].startswith("Mozilla Public License Version 2.0")
    assert "PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2" in texts["pyodide/CPython-LICENSE"]
    assert "Apache License" in texts["tesseract.js-data-eng/LICENSE"][:200]
    markers = {
        "pyodide/CPython-Doc-license.rst": "Licenses and Acknowledgements for Incorporated Software",
        "pyodide/HACL-LICENSE": "HACL* Contributors",
        "pyodide/libffi-LICENSE": "libffi",
        "pyodide/xz-COPYING": "liblzma is in the public domain",
        "pyodide/zstd-LICENSE": "BSD License",
        "pyodide/zlib-LICENSE": "Jean-loup Gailly and Mark Adler",
        "pyodide/bzip2-LICENSE": "Julian Seward",
        "emscripten/emscripten-LICENSE": "Emscripten",
        "emscripten/musl-COPYRIGHT": "musl",
        "tesseract.js-core/leptonica-license.txt": "Leptonica",
        "tesseract.js-core/libjpeg-README": "based in part on the work of",
        "tesseract.js-core/libpng-LICENSE": "PNG Reference Library License",
        "tesseract.js-core/libtiff-COPYRIGHT": "Sam Leffler",
        "tesseract.js-core/giflib-COPYING": "Eric S. Raymond",
        "tesseract.js-core/libwebp-COPYING": "Google Inc",
        "tesseract.js-core/libwebp-PATENTS": "patent",
        "tesseract.js-core/openlibm-LICENSE.md": "OpenLibm",
        "tesseract.js-core/zlib-README": "Jean-loup Gailly",
    }
    for relative, marker in markers.items():
        assert marker in texts[relative], relative


def test_core_files_select_only_the_two_lstm_loaders(tmp_path):
    for name in ["tesseract-core.wasm.js", "tesseract-core-simd.wasm.js", "tesseract-core-lstm.wasm",
                 "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm.js"]:
        (tmp_path / name).write_text("x")
    assert [path.name for path in build_web.core_files(tmp_path)] == [
        "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]
    (tmp_path / "tesseract-core-simd-lstm.wasm.js").unlink()
    with pytest.raises(FileNotFoundError):
        build_web.core_files(tmp_path)


def test_solver_archive_holds_the_solver_but_not_the_command_line(monkeypatch, tmp_path):
    import zipfile

    build = "111111111111"
    fake_build(monkeypatch, tmp_path, build)
    names = set(zipfile.ZipFile(tmp_path / f"solver.{build}.zip").namelist())
    assert "gridsolver/web_api.py" in names and "LICENSE" in names
    assert "gridsolver/solver/solver.py" in names
    assert "gridsolver/cli.py" not in names
    assert not any(name.startswith("gridsolver/examples/") for name in names)


def test_solver_archive_is_reproducible(monkeypatch, tmp_path):
    build = "111111111111"
    archives = []
    for attempt in ("one", "two"):
        out = tmp_path / attempt
        out.mkdir()
        fake_build(monkeypatch, out, build)
        archives.append((out / f"solver.{build}.zip").read_bytes())
    assert archives[0] == archives[1], "identical sources must produce an identical solver archive"
