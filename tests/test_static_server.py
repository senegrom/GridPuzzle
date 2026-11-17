"""The static server the browser suites and the corpus benchmarks start for
the built site: STATIC_SERVER in scripts/watch.cjs, a program for `python -c`.
It serves as `python -m http.server` does and says its port in the same first
line, which the suites' harness reads; and it holds the connections a browser
opens at once while it cannot accept them, which http.server's own queue of 5
does not: on a loaded machine the suites stopped at pages that never loaded a
module the server had refused (web/TESTING.md)."""

import contextlib
import ctypes
import os
import re
import select
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parent.parent
_WATCH = _ROOT / "scripts" / "watch.cjs"
# The interpreter itself. A virtual environment's python.exe is a launcher on
# Windows, whose child is the interpreter: holding the launcher still (_held)
# would hold nothing, and a server that goes on accepting passes any queue.
_PYTHON = getattr(sys, "_base_executable", None) or sys.executable
# How the harness finds the port in the server's first line (serve()).
_PORT = r"port (\d+)"


def _program() -> str:
    """The program as scripts/watch.cjs holds it. The text of a template with
    no backslash, no backquote and no interpolation is the program itself."""
    (program,) = re.findall(r"^const STATIC_SERVER = `([^`]*)`;$", _WATCH.read_text(encoding="utf-8"), re.M)
    assert "\\" not in program and "${" not in program
    return program


def _ours(port: int, directory: Path) -> list[str]:
    """As staticServer() in scripts/watch.cjs has the arguments."""
    return [_PYTHON, "-u", "-c", _program(), str(port), str(directory)]


def _pythons(port: int, directory: Path) -> list[str]:
    """`python -m http.server`, as the suites started it until November 2026."""
    return [_PYTHON, "-u", "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(directory)]


@contextlib.contextmanager
def _serving(command: list[str]):
    """The server `command` starts, with the first line it prints and the port
    in it; ended as the block ends. A server that says nothing within half a
    minute fails the test instead of holding it."""
    server = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        lines: list[str] = []
        reader = threading.Thread(target=lambda: lines.append(server.stdout.readline()), daemon=True)
        reader.start()
        reader.join(30)
        assert lines and lines[0], f"the server printed nothing (exit code {server.poll()})"
        yield server, lines[0], int(re.search(_PORT, lines[0])[1])
    finally:
        server.kill()
        server.wait()
        server.stdout.close()


@contextlib.contextmanager
def _held(server: subprocess.Popen):
    """The server's process stopped for the block, as a server that has lost
    the processor is for a moment: it accepts nothing, and what connects
    waits in the listen queue or is turned away."""
    if sys.platform == "win32":
        kernel32, ntdll = ctypes.WinDLL("kernel32"), ctypes.WinDLL("ntdll")
        kernel32.OpenProcess.restype = ctypes.c_void_p
        handle = ctypes.c_void_p(kernel32.OpenProcess(0x0800, False, server.pid))  # PROCESS_SUSPEND_RESUME
        assert handle.value, "the server's process could not be opened"
        assert ntdll.NtSuspendProcess(handle) == 0
        try:
            yield
        finally:
            ntdll.NtResumeProcess(handle)
            kernel32.CloseHandle(handle)
    else:
        os.kill(server.pid, signal.SIGSTOP)
        try:
            yield
        finally:
            os.kill(server.pid, signal.SIGCONT)


def _connect_at_once(port: int, count: int, seconds: float = 5) -> int:
    """How many of `count` connections opened at once are established within
    `seconds`. One that is refused, or still waits then, is not."""
    sockets = []
    for _ in range(count):
        one = socket.socket()
        one.setblocking(False)
        one.connect_ex(("127.0.0.1", port))
        sockets.append(one)
    waiting, connected, deadline = set(sockets), 0, time.monotonic() + seconds
    while waiting and time.monotonic() < deadline:
        _, writable, failed = select.select([], list(waiting), list(waiting), 0.1)
        waiting -= set(failed)
        for one in writable:
            if one in waiting:
                connected += one.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR) == 0
                waiting.discard(one)
    for one in sockets:
        one.close()
    return connected


def _asked_while_held(server: subprocess.Popen, port: int, count: int) -> int:
    """How many of `count` connections opened at once the held server's queue
    takes. A request sent first, on a connection of its own, shows that the
    server is held (no answer while it is) and alive after (its answer)."""
    with socket.create_connection(("127.0.0.1", port), timeout=10) as first:
        first.setblocking(False)
        with _held(server):
            first.sendall(b"HEAD / HTTP/1.0\r\n\r\n")
            assert select.select([first], [], [], 0.5)[0] == [], "the server answered while it was held"
            connected = _connect_at_once(port, count)
        assert select.select([first], [], [], 30)[0] == [first], "the server did not answer once it went on"
        assert first.recv(64).startswith(b"HTTP/1.0 200 ")
    return connected


@pytest.fixture
def site(tmp_path):
    """A small site: a page, a module in a folder and a WebAssembly file."""
    (tmp_path / "index.html").write_bytes(b"<!doctype html><title>Site</title>\n")
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "app.js").write_bytes(b"export const ready = true;\n")
    (tmp_path / "web" / "runtime.wasm").write_bytes(b"\x00asm\x01\x00\x00\x00")
    return tmp_path


def _answer(port: int, path: str, method: str = "GET", headers: dict[str, str] | None = None):
    """What the server answers: its status, its headers but for the time of
    the answer (their names in lower case), and the body."""
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status, got, body = response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        with error:  # it holds the connection's file, which a warning names if nobody closes it
            status, got, body = error.code, error.headers, error.read()
    return status, {name.lower(): value for name, value in got.items() if name.lower() != "date"}, body


def test_the_program_is_python_as_it_stands_in_the_module():
    compile(_program(), "STATIC_SERVER", "exec")


def test_the_program_passes_the_projects_lint():
    """It is text in a JavaScript module, which `ruff check .` does not see:
    here it is checked as the Python file it would be, by the project's rules."""
    pytest.importorskip("ruff")
    checked = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--no-cache", "--stdin-filename", "scripts/static_server.py", "-"],
        input=_program(), cwd=_ROOT, capture_output=True, text=True,
    )
    assert checked.returncode == 0, checked.stdout + checked.stderr


def test_it_names_its_port_in_the_line_http_server_prints(site):
    """The harness reads the port from the first line, and waits for that
    line for ever: a server that worded it otherwise would hold every suite.
    Asked for port 0, each server gets one of its own from the system."""
    assert f"/{_PORT}/.exec(" in (_ROOT / "scripts" / "harness.cjs").read_text(encoding="utf-8")
    with _serving(_ours(0, site)) as (_, ours, port), _serving(_pythons(0, site)) as (_, pythons, other):
        assert port != other
        assert ours.replace(str(port), "PORT") == pythons.replace(str(other), "PORT")
        assert ours.startswith(f"Serving HTTP on 127.0.0.1 port {port} ")
        with _serving(_ours(0, site)) as (_, _again, another):
            assert len({0, port, other, another}) == 4


def test_it_serves_a_directory_as_http_server_does(site):
    """Each answer is `python -m http.server`'s for the same request: a page,
    a module, a WebAssembly file by its type, the harness's HEAD of the site,
    a file that is not there, and a file the browser already has."""
    with _serving(_ours(0, site)) as (_, _line, ours), _serving(_pythons(0, site)) as (_, _other, pythons):
        seen = _answer(ours, "/web/app.js")[1]["last-modified"]
        requests = [
            ("/", "GET", None), ("/", "HEAD", None), ("/index.html", "GET", None), ("/web/app.js", "GET", None),
            ("/web/runtime.wasm", "GET", None), ("/missing.js", "GET", None), ("/web/app.js", "GET", {"If-Modified-Since": seen}),
        ]
        for path, method, headers in requests:
            assert _answer(ours, path, method, headers) == _answer(pythons, path, method, headers), (method, path, headers)
        assert _answer(ours, "/")[0] == 200 and _answer(ours, "/")[2] == (site / "index.html").read_bytes()
        assert _answer(ours, "/", "HEAD")[0] == 200
        assert _answer(ours, "/web/app.js")[2] == b"export const ready = true;\n"
        assert _answer(ours, "/web/runtime.wasm")[1]["content-type"] == "application/wasm"
        assert _answer(ours, "/missing.js")[0] == 404
        assert _answer(ours, "/web/app.js", headers={"If-Modified-Since": seen})[0] == 304


def test_it_serves_a_port_it_is_given(site):
    """The corpus benchmarks and the scanner-settings suite give it theirs."""
    with socket.socket() as free:
        free.bind(("127.0.0.1", 0))
        port = free.getsockname()[1]
    with _serving(_ours(port, site)) as (_, line, said):
        assert said == port and f"port {port} " in line
        assert _answer(port, "/")[0] == 200


def test_it_answers_while_another_connection_says_nothing(site):
    """A browser opens connections ahead of its requests and keeps them. A
    server that took its connections one by one, as http.server's plain
    HTTPServer does, would wait for the silent one."""
    with _serving(_ours(0, site)) as (_, _line, port), socket.create_connection(("127.0.0.1", port), timeout=10):
        assert _answer(port, "/web/app.js")[0] == 200
        assert _answer(port, "/", "HEAD")[0] == 200


@pytest.mark.skipif(sys.platform == "win32", reason="a console's Ctrl+C cannot be sent to one process on Windows")
def test_it_ends_on_an_interrupt_as_http_server_does(site):
    """Ctrl+C in a terminal reaches the server too. `python -m http.server`
    ends with exit code 0 then, and so does the program, without a traceback
    (an interrupt nothing catches ends Python with another code). Where an
    interrupt does not end `python -m http.server` either, because the tests
    run with interrupts ignored, there is nothing to compare."""
    codes = []
    for command in (_pythons(0, site), _ours(0, site)):
        with _serving(command) as (server, _, port):
            assert _answer(port, "/")[0] == 200
            server.send_signal(signal.SIGINT)
            try:
                codes.append(server.wait(30))
            except subprocess.TimeoutExpired:
                assert not codes, "the program goes on after an interrupt that ends http.server"
                pytest.skip("an interrupt does not reach a child process here")
    assert codes == [0, 0]


# A browser opens six connections to a host at once, a page of the site asks
# for some forty files, each on a connection of its own, and a suite may have
# two pages: 64 at once is more than its pages can have waiting.
_AT_ONCE = 64


def test_its_queue_holds_a_browsers_connections_while_it_cannot_accept(site):
    with _serving(_ours(0, site)) as (server, _, port):
        assert _asked_while_held(server, port, _AT_ONCE) == _AT_ONCE


@pytest.mark.skipif(sys.platform != "win32", reason="what a full queue does with a connection is told apart on Windows: it is refused")
def test_http_servers_own_queue_does_not(site):
    """What the program is for. Windows refuses every connection beyond
    http.server's queue of 5 while the server is held, the sixth of the six a
    browser opens among them. Should a Python take more than this test asks,
    the program may no longer be needed: see what its queue is."""
    with _serving(_pythons(0, site)) as (server, _, port):
        assert _asked_while_held(server, port, _AT_ONCE) < _AT_ONCE


def test_no_script_starts_a_server_of_its_own():
    """Every `python` a suite or a corpus command starts is this server, by
    staticServer(): a fourth `-m http.server` would have the queue of 5. It
    reads the scripts' text: a start through any of Node's ways to start a
    process whose first argument is a quoted python (python3, python.exe), and
    `-m http.server` written out anywhere but in the comment that names it.
    Each of the three starts is here as it is written, up to its options: the
    port and the folder it hands on are the ones its own pages are then loaded
    from, and one that swapped the two, or served another port or folder,
    would show in no test but a browser's."""
    starts = []
    for path in sorted([*(_ROOT / "scripts").glob("*.cjs"), *(_ROOT / "corpus").glob("*.cjs")]):
        text = path.read_text(encoding="utf-8")
        starts += [
            (path.name, text[found.end() :].split("\n", 1)[0].split(", {", 1)[0])
            for found in re.finditer(r"""\b(?:spawn|exec|execFile|fork)(?:Sync)?\(\s*["'`]python[\d.]*(?:\.exe)?["'`]\s*,\s*""", text)
        ]
        if path != _WATCH:
            assert not re.search(r"""-m["'`,\s]+["'`]?http\.server""", text), path.name
    assert sorted(starts) == [
        ("benchmark-runner.cjs", 'staticServer(new URL(base).port || "80", options.site || "_site")'),
        ("detect_benchmark_regressions.cjs", 'staticServer(8782, "_site")'),
        ("harness.cjs", "staticServer(port, directory)"),
    ]
