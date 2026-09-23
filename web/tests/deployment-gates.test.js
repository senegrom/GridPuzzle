import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A checkout may have CRLF line ends; the assertions below expect LF.
const workflow=name=>fs.readFileSync(new URL(`../../.github/workflows/${name}`,import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('master deployment waits for moving-camera acceptance of the exact built artifact',()=>{
 const source=workflow('browser-pages.yml');
 const gate=source.slice(source.indexOf('  live-acceptance:'),source.indexOf('  configure:'));
 const relevance=source.slice(source.indexOf('  changes:'),source.indexOf('  build:'));
 assert.match(relevance,/^ +gridsolver\/\*\*$/m,'native solver changes also run pre-merge acceptance');
 assert.match(source.slice(source.indexOf('  build:'),source.indexOf('  live-acceptance:')),/needs: changes\n    if: needs\.changes\.outputs\.relevant == 'true'/);
 assert.match(gate,/needs: build/);
 assert.match(gate,/actions\/download-artifact@[0-9a-f]{40} # v8/,'the artifact download is SHA-pinned');
 assert.match(gate,/name: scanner-static-build/);
 assert.match(gate,/GITHUB_SHA\.slice\(0,12\)/);
 assert.match(gate,/node scripts\/live_motion_regressions\.cjs/);
 assert.match(gate,/node scripts\/app_review_regressions\.cjs/);
 assert.match(gate,/node scripts\/live_recovery_regressions\.cjs/);
 const quality=workflow('scan-input.yml');
 assert.match(quality,/node scripts\/live_recovery_regressions\.cjs/);
 assert.match(quality,/node scripts\/external_replay_regressions\.cjs/);
 assert.match(quality,/node scripts\/live_noise_regressions\.cjs/);
 for (const name of ['editor_reread', 'live_soak', 'live_noise']) assert.ok(gate.includes(`node scripts/${name}_regressions.cjs`));
 assert.doesNotMatch(gate,/build_web\.py/,'test the artifact rather than a separate rebuild');
 assert.match(source.slice(source.indexOf('  deploy:')),/needs: \[build, configure, live-acceptance\]/);
});
