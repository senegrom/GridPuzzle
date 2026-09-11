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


def test_manifest_contains_the_complete_versioned_runtime(monkeypatch, tmp_path):
    build = "111111111111"
    monkeypatch.setattr(build_web.subprocess, "check_output", lambda *a, **k: build + "0" * 28)
    monkeypatch.setattr(build_web, "icon", lambda size, path: None)
    package_paths = {
        "pyodide": ["pyodide.mjs", "pyodide.js", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"],
        "tesseract.js": ["dist/tesseract.min.js", "dist/worker.min.js"],
        "tesseract.js-core": ["tesseract-core-lstm.wasm", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm.js"],
        "@tesseract.js-data/eng": ["best_int/eng.traineddata.gz"],
    }

    def package(name, version, integrity, temporary):
        root = temporary / name.replace("/", "_")
        for file in package_paths[name]:
            path = root / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"unchanged upstream bytes: {name}/{file}")
        return root, integrity

    monkeypatch.setattr(build_web, "package", package)
    build_web.build(tmp_path)
    manifest = json.loads((tmp_path / "assets.json").read_text(encoding="utf-8"))
    paths = {asset["path"] for asset in manifest["assets"]}
    assert manifest["build"] == build
    assert f"solver-worker.{build}.js" in paths
    for file in package_paths["pyodide"]:
        assert f"vendor/{build}/pyodide/{file}" in paths
    for path in paths:
        if path.startswith("vendor/"):
            assert path.startswith(f"vendor/{build}/")
    for asset in manifest["assets"]:
        data = (tmp_path / Path(asset["path"])).read_bytes()
        assert hashlib.sha256(data).hexdigest() == asset["sha256"]
        assert len(data) == asset["bytes"]
