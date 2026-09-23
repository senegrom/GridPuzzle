# Vendored third-party licence texts

`scripts/build_web.py` ships a licence text for every browser dependency it
self-hosts, and refuses to build when a pinned package has none. Most packages
bring their own licence file. The texts here fill the gaps for the ones that do
not, and are copied into `_site/licenses/` next to the packages' own files.

| File | Covers | Taken from |
|---|---|---|
| `pyodide/LICENSE` | Pyodide, MPL-2.0. The npm package ships no licence file. | `LICENSE` at the pyodide/pyodide tag `314.0.7` |
| `pyodide/CPython-LICENSE` | The CPython standard library in Pyodide's `python_stdlib.zip`, PSF License Agreement and history. | `LICENSE` at the python/cpython tag `v3.14.2`, the version Pyodide 314.0.7 bundles |
| `tesseract.js-data-eng/LICENSE` | The English `best_int` model from `@tesseract.js-data/eng`, Apache-2.0. The package ships no licence file; its metadata says MIT, but its repository, naptha/tessdata, and the tesseract-ocr/tessdata_best model it redistributes are both Apache-2.0. | `LICENSE` on the `gh-pages` branch of naptha/tessdata |

When a pin in `scripts/build_web.py` moves to a new upstream version, check
whether these texts changed and whether the package now ships its own.
