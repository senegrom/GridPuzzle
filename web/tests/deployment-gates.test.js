import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('master deployment waits for moving-camera acceptance of the exact built artifact',()=>{
 const source=fs.readFileSync(new URL('../../.github/workflows/browser-pages.yml',import.meta.url),'utf8');
 const gate=source.slice(source.indexOf('  live-acceptance:'),source.indexOf('  configure:'));
 assert.match(gate,/needs: build/);
 assert.match(gate,/actions\/download-artifact@v8/);
 assert.match(gate,/name: scanner-static-build/);
 assert.match(gate,/GITHUB_SHA\.slice\(0,12\)/);
 assert.match(gate,/node scripts\/live_motion_regressions\.cjs/);
 assert.match(gate,/node scripts\/app_review_regressions\.cjs/);
 assert.doesNotMatch(gate,/build_web\.py/,'test the artifact rather than a separate rebuild');
 assert.match(source.slice(source.indexOf('  deploy:')),/needs: \[build, configure, live-acceptance\]/);
});
