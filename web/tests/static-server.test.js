import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The static server the browser suites and the corpus benchmarks start for
// the built site: Python's own http.server with a listen queue that holds a
// browser's connections, as a program for `python -c` (STATIC_SERVER in
// scripts/watch.cjs) whose arguments staticServer() gives. Here: the
// arguments, what the program's text must be for Python to get it as it
// stands, and that the harness's serve() starts exactly that. What the server
// does is Python's to show: tests/test_static_server.py runs the program,
// since the job that runs these tests sets up no Python.
const require = createRequire(import.meta.url);
const { STATIC_SERVER, staticServer } = require('../../scripts/watch.cjs');
const harness = fileURLToPath(new URL('../../scripts/harness.cjs', import.meta.url));

test('the arguments start the program unbuffered, with the port as text and the directory last', () => {
  assert.deepEqual(staticServer(0, '_site'), ['-u', '-c', STATIC_SERVER, '0', '_site']);
  assert.deepEqual(staticServer(8782, path.join('some', 'folder')), ['-u', '-c', STATIC_SERVER, '8782', path.join('some', 'folder')]);
  // A port that came out of a URL is text already (the corpus runner's).
  assert.deepEqual(staticServer('8780', '_site').slice(3), ['8780', '_site']);
});

test('the program\'s text is the program: no backslash, no backquote, no interpolation', () => {
  // A checkout on Windows may end the file's lines with CR LF; a template's
  // text has LF for either, and so has what Python reads from the file.
  const source = fs.readFileSync(new URL('../../scripts/watch.cjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const [, written] = /^const STATIC_SERVER = `([^`]*)`;$/m.exec(source);
  assert.equal(written, STATIC_SERVER, 'what the file holds between the backquotes is what Python gets');
  assert.doesNotMatch(STATIC_SERVER, /\\|\$\{/);
  assert.ok(STATIC_SERVER.endsWith('\n') && !STATIC_SERVER.includes('\r') && !STATIC_SERVER.includes('\t'));
});

test('the program asks for a queue that holds a browser\'s connections, on the loopback address, and names its port as http.server does', () => {
  const [, queue] = /^ {4}request_queue_size = (\d+)$/m.exec(STATIC_SERVER);
  // Six connections to a host at once, forty-odd requests a page load, each
  // on a connection of its own, and two pages in a suite at most.
  assert.ok(Number(queue) >= 64, queue);
  assert.match(STATIC_SERVER, /^class Server\(http\.server\.ThreadingHTTPServer\):$/m);
  assert.match(STATIC_SERVER, /^with Server\(\("127\.0\.0\.1", port\), handler\) as server:$/m);
  assert.match(STATIC_SERVER, /^handler = functools\.partial\(http\.server\.SimpleHTTPRequestHandler, directory=directory\)$/m);
  assert.match(STATIC_SERVER, /^ {4}print\(f"Serving HTTP on \{host\} port \{port\} \(http:\/\/\{host\}:\{port\}\/\) \.\.\.", flush=True\)$/m);
});

// serve() as it is, in a process of its own, with a spawn that says what it
// was asked to start and starts a stand-in that names a port and answers.
const STAND_IN = `require("node:http").createServer((request, response) => response.end())
  .listen(0, "127.0.0.1", function () { console.log("Serving HTTP on 127.0.0.1 port", this.address().port, "..."); });`;
const SERVED = `const children = require("node:child_process"), { spawn } = children;
children.spawn = (command, args, options) => {
  console.log(JSON.stringify({ command, args, stdio: options.stdio }));
  return spawn(process.execPath, ["-e", ${JSON.stringify(STAND_IN)}], options);
};
const { serve } = require(${JSON.stringify(harness)});
(async () => {
  for (const options of [{ directory: "site" }, { directory: "site", port: 8123 }, {}]) {
    const server = await serve(options);
    console.log(JSON.stringify({ origin: server.origin, base: server.base }));
    await server.close();
  }
})();
`;

test('the harness starts python with exactly those arguments, on the port it was given or one the system picks', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-static-server-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'served.cjs'), SERVED);
  const stdout = await new Promise((resolve, reject) => execFile(process.execPath, [path.join(directory, 'served.cjs')],
    { cwd: directory, timeout: 50000 }, (error, out, err) => (error ? reject(new Error(`${error.message}\n${out}\n${err}`)) : resolve(out))));
  const lines = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(lines.length, 6);
  const [first, , second, , third] = lines;
  assert.deepEqual(first, { command: 'python', args: staticServer(0, 'site'), stdio: ['ignore', 'pipe', 'ignore'] });
  assert.deepEqual(second.args, staticServer(8123, 'site'));
  assert.deepEqual(third.args, staticServer(0, '_site'), 'the built site, where a suite names no directory');
  for (const served of [lines[1], lines[3], lines[5]]) {
    assert.match(served.origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'the origin has the port the server named');
    assert.equal(served.base, `${served.origin}/`);
  }
});
