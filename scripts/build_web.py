#!/usr/bin/env python3
"""Build a completely self-hosted static phone app; Python solver is unmodified.

Uses immutable npm package versions for prebuilt browser assets, not a JS port
of the solver. No npm lifecycle scripts are executed. No network calls happen
at app runtime except requests to this site's own static files.
"""

from __future__ import annotations
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile
import zlib
import zipfile

ROOT = Path(__file__).resolve().parent.parent
# npm is npm.cmd on Windows and CreateProcess does not search for it by bare name.
NPM = shutil.which("npm") or "npm"
# Exact versions and registry tarball digests. The build refuses a tarball whose
# SHA-512 differs from the pin, so a registry or proxy substitution cannot
# reach the deployed site.
PACKAGES = {
    "pyodide": (
        "314.0.7",
        "sha512-0YvXxEhfEdpLfb/XkM2BFAeMROq0iMUX2bzzH9pOttyMcWkwq+HbE5uyuGD82LN7y2q+SNvi/6V5JEsOlD2R1A==",
    ),
    "tesseract.js": (
        "6.0.1",
        "sha512-/sPvMvrCtgxnNRCjbTYbr7BRu0yfWDsMZQ2a/T5aN/L1t8wUQN6tTWv6p6FwzpoEBA0jrN2UD2SX4QQFRdoDbA==",
    ),
    "tesseract.js-core": (
        "6.0.0",
        "sha512-1Qncm/9oKM7xgrQXZXNB+NRh19qiXGhxlrR8EwFbK5SaUbPZnS5OMtP/ghtqfd23hsr1ZvZbZjeuAGcMxd/ooA==",
    ),
    "@tesseract.js-data/eng": (
        "1.0.0",
        "sha512-mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg==",
    ),
}


# Licence texts the build ships in addition to a package's own licence files.
# Pyodide's npm package ships none, and its python_stdlib.zip is the CPython
# standard library; the English model package ships none either. See
# third_party/licenses/README.md for where each text comes from.
VENDORED_LICENCES = ROOT / "third_party" / "licenses"
EXTRA_LICENCES = {
    "pyodide": ("pyodide/LICENSE", "pyodide/CPython-LICENSE"),
    "@tesseract.js-data/eng": ("tesseract.js-data-eng/LICENSE",),
}
# What the notices file says about a package beyond its metadata licence.
LICENCE_NOTES = {
    "pyodide": "bundles the CPython standard library under the PSF License Agreement",
    "@tesseract.js-data/eng": (
        "the model data it redistributes (naptha/tessdata, from "
        "tesseract-ocr/tessdata_best) is Apache-2.0"
    ),
}


def licence_files(name, source):
    """Every licence text shipped for a package: its own files plus vendored ones.

    A package that brings no licence file and has none vendored stops the
    build rather than being published without its licence.
    """
    own = [path for path in sorted(source.glob("*LICENSE*")) if path.is_file()]
    vendored = [VENDORED_LICENCES / relative for relative in EXTRA_LICENCES.get(name, ())]
    for path in vendored:
        if not path.is_file():
            raise FileNotFoundError(f"Vendored licence text missing: {path}")
    if not own and not vendored:
        raise FileNotFoundError(
            f"{name} ships no licence file and none is vendored in {VENDORED_LICENCES}"
        )
    return own + vendored


def core_files(source):
    """The plain and SIMD LSTM-only core loaders.

    Each *.wasm.js loader embeds its WebAssembly binary, and the Tesseract
    worker only ever requests the loaders, so the separate *.wasm files would
    add 5.5 MiB to every offline download without being used.
    """
    cores = sorted(source.glob("*lstm.wasm.js"))
    if len(cores) != 2:
        raise FileNotFoundError(f"Expected the plain and SIMD LSTM core loaders: {cores}")
    return cores


def tarball_integrity(path):
    return (
        "sha512-"
        + base64.b64encode(hashlib.sha512(Path(path).read_bytes()).digest()).decode()
    )


def package(name, version, integrity, temporary):
    destination = temporary / name.replace("/", "_").replace("@", "")
    destination.mkdir()
    result = subprocess.run(
        [
            NPM,
            "pack",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            str(destination),
            f"{name}@{version}",
        ],
        check=True,
        text=True,
        capture_output=True,
        timeout=240,
    )
    metadata = json.loads(result.stdout)[0]
    tarball = destination / metadata["filename"]
    actual = tarball_integrity(tarball)
    if actual != integrity:
        raise ValueError(
            f"{name}@{version} tarball integrity {actual} does not match the pinned {integrity}"
        )
    with tarfile.open(tarball) as archive:
        archive.extractall(destination, filter="data")
    return destination / "package", integrity


def copy(source, destination):
    if not source.is_file():
        raise FileNotFoundError(f"Required browser asset missing: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def icon(size, path):
    """Opaque PNG icon with a mask-safe grid/check mark, using only stdlib."""
    ink = (18, 59, 59)
    light = (220, 236, 224)
    mint = (125, 209, 170)
    gold = (243, 202, 118)

    def segment_distance(x, y, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
        return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)

    raw = bytearray()
    for yy in range(size):
        raw.append(0)
        for xx in range(size):
            x, y = xx / size, yy / size
            color = ink
            if 0.22 < x < 0.78 and 0.22 < y < 0.78:
                if (
                    min(abs(x - z) for z in (0.23, 0.41, 0.59, 0.77)) < 0.012
                    or min(abs(y - z) for z in (0.23, 0.41, 0.59, 0.77)) < 0.012
                ):
                    color = light
                elif 0.43 < x < 0.57 and 0.43 < y < 0.57:
                    color = mint
            if (
                min(
                    segment_distance(x, y, (0.58, 0.68), (0.65, 0.75)),
                    segment_distance(x, y, (0.65, 0.75), (0.79, 0.55)),
                )
                < 0.025
            ):
                color = gold
            raw.extend((*color, 255))

    def chunk(kind, data):
        return (
            struct.pack("!I", len(data))
            + kind
            + data
            + struct.pack("!I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack("!2I5B", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


_OUTPUT_MARKER = ".gridpuzzle-output"
_OUTPUT_KIND = "GridPuzzle static output v1\n"


def validate_output(root, output):
    """Never clean source paths, links or directories not owned by this builder."""
    root = Path(root).resolve()
    raw = root / output
    if raw.is_symlink():
        raise ValueError("Build output must not be a symbolic link")
    out = raw.resolve()
    if out == root or root.is_relative_to(out):
        raise ValueError("Build output must not contain the repository")
    if out.is_relative_to(root) and out != root / "_site":
        raise ValueError(
            "Inside the repository only _site may be used; choose a new external directory for custom output"
        )
    if out.exists():
        marker = out / _OUTPUT_MARKER
        if (
            not out.is_dir()
            or marker.is_symlink()
            or not marker.is_file()
            or marker.stat().st_size > 128
            or marker.read_text() != _OUTPUT_KIND
        ):
            raise ValueError(
                "Refusing to replace an unowned output directory; move it aside and retry"
            )
    return out


@contextmanager
def build_destination(root, output):
    """Build in isolation; failed builds leave the last good output intact."""
    out = validate_output(root, output)
    out.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="." + out.name + "-stage-", dir=out.parent))
    backup = None
    try:
        (stage / _OUTPUT_MARKER).write_text(_OUTPUT_KIND)
        yield stage
        # Recheck after the build, before any rename (including ownership).
        validate_output(root, output)
        if out.exists():
            backup = (
                Path(
                    tempfile.mkdtemp(prefix="." + out.name + "-backup-", dir=out.parent)
                )
                / "previous"
            )
            out.replace(backup)
        try:
            stage.replace(out)
        except BaseException:
            if backup is not None:
                backup.replace(out)
                backup.parent.rmdir()
            raise
        if backup is not None:
            shutil.rmtree(backup.parent)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        # Never delete a backup after a failed restoration.


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="_site")
    args = parser.parse_args()
    with build_destination(ROOT, args.output) as out:
        build(out)


def write_web_sources(out, build):
    """Stamp local runtime URLs without modifying any Python or vendor code."""
    for source in (ROOT / "web").iterdir():
        if source.is_file() and source.suffix in (
            ".html",
            ".css",
            ".js",
            ".svg",
            ".webmanifest",
        ):
            text = source.read_text(encoding="utf-8").replace("__BUILD_ID__", build)
            # Runtime imports are immutable across dependency-changing updates.
            text = text.replace("./vendor/", f"./vendor/{build}/")
            if source.suffix == ".js":
                text = text.replace("./solver-worker.js", f"./solver-worker.{build}.js")
            if source.name == "solver-worker.js":
                text = text.replace("solver.zip", f"solver.{build}.zip")
            (out / source.name).write_text(text, encoding="utf-8", newline="\n")
            if source.name == "solver-worker.js":
                # The unversioned alias supports installed pre-migration apps;
                # new app code always starts the exact worker for its build.
                (out / f"solver-worker.{build}.js").write_text(
                    text, encoding="utf-8", newline="\n"
                )


def build(out):
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    build = commit[:12]
    write_web_sources(out, build)
    vendor = out / "vendor" / build
    (out / ".nojekyll").touch()
    # Include every original core module byte-for-byte, and its license.
    with zipfile.ZipFile(
        out / f"solver.{build}.zip", "w", zipfile.ZIP_DEFLATED
    ) as archive:
        for source in sorted((ROOT / "gridsolver").rglob("*.py")):
            name = source.relative_to(ROOT).as_posix()
            entry = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, source.read_bytes())
        # The same fixed timestamp as the modules: identical sources must
        # produce an identical archive digest so the offline cache can reuse it.
        licence = zipfile.ZipInfo("LICENSE", date_time=(2020, 1, 1, 0, 0, 0))
        licence.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(licence, (ROOT / "LICENSE").read_bytes())
    provenance = []
    notices = []
    with tempfile.TemporaryDirectory() as temporary:
        for name, (version, pinned) in PACKAGES.items():
            source, integrity = package(name, version, pinned, Path(temporary))
            provenance.append(
                {"package": name, "version": version, "integrity": integrity}
            )
            bundle_notices = []
            if name == "pyodide":
                # Since 314.0 the Emscripten bootstrap is a native ES module.
                for file in (
                    "pyodide.mjs",
                    "pyodide.js",
                    "pyodide.asm.mjs",
                    "pyodide.asm.wasm",
                    "python_stdlib.zip",
                    "pyodide-lock.json",
                ):
                    copy(source / file, vendor / "pyodide" / file)
            elif name == "tesseract.js":
                for file in ("tesseract.min.js", "worker.min.js"):
                    copy(source / "dist" / file, vendor / "tesseract" / file)
                    # Each bundle's header points to this sibling notice file,
                    # which lists the licences of the code bundled into it.
                    notice = f"{file}.LICENSE.txt"
                    copy(source / "dist" / notice, vendor / "tesseract" / notice)
                    bundle_notices.append(f"vendor/{build}/tesseract/{notice}")
            elif name == "tesseract.js-core":
                # The OCR host runs Tesseract in LSTM-only mode, so the legacy-engine
                # core variants would only enlarge the offline download.
                for file in core_files(source):
                    copy(file, vendor / "tesseract-core" / file.name)
            else:
                candidates = sorted(source.rglob("eng.traineddata.gz"))
                preferred = [p for p in candidates if "best_int" in p.as_posix()]
                if not preferred:
                    raise FileNotFoundError(
                        f"English best_int model not found: {candidates}"
                    )
                copy(preferred[0], vendor / "tessdata/eng.traineddata.gz")
            prefix = name.replace("/", "_").replace("@", "")
            shipped = []
            for license_path in licence_files(name, source):
                target = f"licenses/{prefix}-{license_path.name}"
                copy(license_path, out / target)
                shipped.append(target)
            shipped.extend(bundle_notices)
            package_json = source / "package.json"
            metadata = (
                json.loads(package_json.read_text(encoding="utf-8"))
                if package_json.is_file()
                else {}
            )
            notices.append((name, version, metadata.get("license", "see licence text"), shipped))
    for name, size in [
        ("apple-touch-icon.png", 180),
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("maskable-512.png", 512),
    ]:
        icon(size, out / "icons" / name)
    copy(ROOT / "LICENSE", out / "LICENSE.txt")
    (out / "build-info.json").write_text(
        json.dumps({"commit": commit, "build": build, "packages": provenance}, indent=2)
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    lines = [
        "GridPuzzle is AGPL-3.0-only. Source: https://github.com/senegrom/GridPuzzle",
        "Its browser dependencies are self-hosted and version-pinned, and keep their own licences.",
        "",
    ]
    for name, version, licence, shipped in notices:
        note = LICENCE_NOTES.get(name)
        lines.append(f"{name} {version}: {licence}" + (f"; {note}" if note else ""))
        lines.extend(f"  {path}" for path in shipped)
    (out / "THIRD_PARTY_NOTICES.txt").write_text(
        "\n".join(lines) + "\n\n" + json.dumps(provenance, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    assets = []
    for source in sorted(out.rglob("*")):
        if source.is_file() and source.name not in (
            "sw.js",
            ".nojekyll",
            _OUTPUT_MARKER,
        ):
            data = source.read_bytes()
            assets.append(
                {
                    "path": source.relative_to(out).as_posix(),
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
    (out / "assets.json").write_text(
        json.dumps({"build": build, "assets": assets}, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        f"Built {build}: {len(assets)} offline assets, {sum(a['bytes'] for a in assets) / 1024**2:.1f} MiB",
        flush=True,
    )
    print(json.dumps(provenance, indent=2), flush=True)


if __name__ == "__main__":
    main()
