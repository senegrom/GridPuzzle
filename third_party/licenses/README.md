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

## Libraries inside the WebAssembly runtimes

`pyodide.asm.wasm` and the two Tesseract core loaders are compiled C and C++
programs that statically link third-party libraries, so the site ships those
libraries' licences as well. What each binary links comes from the pinned
upstream build files: `Makefile.envs`, `cpython/Makefile` and
`cpython/Setup.local` at the pyodide/pyodide tag `314.0.7`, and `build.sh`,
`build-scripts/` and the `third_party/` submodule commits at the
naptha/tesseract.js-core tag `v6.0.0`.

| File | Covers | Taken from |
|---|---|---|
| `pyodide/CPython-Doc-license.rst` | The software CPython incorporates in its own sources and Pyodide compiles in: expat, libmpdec, mimalloc, the dtoa and SipHash code and the others it lists. | `Doc/license.rst` at the python/cpython tag `v3.14.2` |
| `pyodide/HACL-LICENSE` | HACL*, the verified hash code behind `hashlib` and `hmac`, MIT. `Doc/license.rst` does not list it, and CPython keeps its notice only in the source headers. | The licence header of `Modules/_hacl/Hacl_Hash_SHA2.c` at the python/cpython tag `v3.14.2`, without the comment markers |
| `pyodide/libffi-LICENSE` | libffi, for `ctypes`. | `LICENSE` at libffi/libffi commit `f08493d249d2067c8b3207ba46693dd858f95db3`, the commit `cpython/Makefile` fetches |
| `pyodide/xz-COPYING` | liblzma from XZ Utils 5.2.2, public domain. | `COPYING` at the xz-mirror/xz tag `v5.2.2`, the release `cpython/Makefile` downloads |
| `pyodide/zstd-LICENSE` | zstd 1.5.7, BSD. | `LICENSE` at the facebook/zstd tag `v1.5.7`; Pyodide builds it from the python/cpython-source-deps `zstd-1.5.7` archive |
| `pyodide/zlib-LICENSE` | zlib 1.3.1, the Emscripten port behind `-s USE_ZLIB`. | `LICENSE` at the madler/zlib tag `v1.3.1`, the version Emscripten 5.0.3's port pins |
| `pyodide/bzip2-LICENSE` | bzip2 1.0.6, the Emscripten port behind `-s USE_BZIP2`. | `LICENSE` at the emscripten-ports/bzip2 tag `1.0.6`, the version Emscripten 5.0.3's port pins |
| `tesseract.js-core/leptonica-license.txt` | Leptonica 1.83. | `leptonica-license.txt` at DanBloomberg/leptonica commit `4af068b56a9674da915debea4ed7e1b9885b17e8` |
| `tesseract.js-core/libjpeg-README` | IJG libjpeg 9a; its LEGAL ISSUES section is the licence, and it requires the credit the notices file carries. | `README` at LuaDist/libjpeg commit `6c0fcb8ddee365e7abc4d332662b06900612e923` |
| `tesseract.js-core/libpng-LICENSE` | libpng 1.6.38. | `LICENSE` at glennrp/libpng commit `a37d4836519517bdce6cb9d956092321eca3e73b` |
| `tesseract.js-core/libtiff-COPYRIGHT` | libtiff 4.3.0. | `COPYRIGHT` at libtiff/libtiff (gitlab.com) commit `b51bb157123264e26d34c09cc673d213aea61fc7` |
| `tesseract.js-core/giflib-COPYING` | giflib 5.1.4. | `COPYING` at mirrorer/giflib commit `fa37672085ce4b3d62c51627ab3c8cf2dda8009a` |
| `tesseract.js-core/libwebp-COPYING`, `tesseract.js-core/libwebp-PATENTS` | libwebp 1.2.2, BSD with Google's patent grant. | `COPYING` and `PATENTS` at webmproject/libwebp commit `20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c` |
| `tesseract.js-core/openlibm-LICENSE.md` | openlibm 0.8.0. | `LICENSE.md` at JuliaMath/openlibm commit `ae2d91698508701c83cab83714d42a1146dccf85` |
| `tesseract.js-core/zlib-README` | zlib 1.2.12; that release has no separate licence file, and the README carries the notice. | `README` at madler/zlib commit `21767c654d31d2dccdde4330529775c6c5fd5389` |
| `emscripten/emscripten-LICENSE`, `emscripten/musl-COPYRIGHT` | The Emscripten runtime and musl libc compiled into both binaries (Emscripten 5.0.3 for Pyodide, 3.1.38 for the Tesseract core); shipped once per package. | `LICENSE` and `system/lib/libc/musl/COPYRIGHT` at the emscripten-core/emscripten tag `5.0.3`; both files are byte-identical at `3.1.38` |

Tesseract itself is Apache-2.0 like the tesseract.js-core package, whose own
`LICENSE` covers it. SQLite 3.39, which Pyodide also links, is in the public
domain and has no licence text; the notices file names it. The LLVM runtime
libraries Emscripten links (libc++, libc++abi, compiler-rt) are Apache-2.0
with the LLVM exception, which waives the notice requirement for compiled
object code.

When a pin in `scripts/build_web.py` moves to a new upstream version, check
whether these texts changed, whether the package now ships its own, and
whether the binaries link a different set of libraries.
