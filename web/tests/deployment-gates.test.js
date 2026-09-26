import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// The harness's engine selection; loading it needs no Playwright.
const { selectedEngines } = createRequire(import.meta.url)('../../scripts/harness.cjs');
const ENGINES = ['chromium', 'webkit'];

// A checkout may have CRLF line ends; the assertions below expect LF.
const read=path=>fs.readFileSync(new URL(`../../${path}`,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const workflow=name=>read(`.github/workflows/${name}`);

// A workflow's jobs by id.
function jobs(source){
 const parts=source.slice(source.indexOf('\njobs:\n')).split(/^  ([\w-]+):$/m), out={};
 for (let i=1;i<parts.length;i+=2) out[parts[i]]=parts[i+1];
 return out;
}
// The suites a job runs, in order, with the events each step is limited to.
function suiteRuns(job){
 return job.split(/^      - /m).slice(1).flatMap(step=>{
  const pushOnly=/^        if: github\.event_name (== 'push'|!= 'pull_request')$/m.test(step);
  return [...step.matchAll(/node scripts\/(\w+)\.cjs/g)].map(([,suite])=>({suite,events:pushOnly?['push']:['pull_request','push']}));
 });
}
// The engines each leg of a job runs: a job without an engine matrix is one
// leg running both, and a matrix leg runs only its engine when the job hands
// it to the harness as BROWSER_ENGINES; without that, every leg runs both.
function jobLegs(job){
 const matrix=job.match(/^      matrix:\n        engine: \[([\w, ]+)\]$/m);
 if (!matrix) return [ENGINES];
 const legs=matrix[1].split(/,\s*/);
 const selects=/^      BROWSER_ENGINES: \$\{\{ matrix\.engine \}\}$/m.test(job);
 return legs.map(engine=>selects?[engine]:ENGINES);
}
// A suite and those it runs inside itself, read from the sources.
const withNested=suite=>[suite,...[...read(`scripts/${suite}.cjs`).matchAll(/require\("\.\/(\w+)\.cjs"\)(?:\.run)?\(/g)].flatMap(([,inner])=>withNested(inner))];
// The pull-request suites that WebKit's canvas playback must not follow on one runner.
const RECOGNITION=['ocr_quality_regressions','recognition_fragments_regressions','recognition_segments_regressions','scan_input_regressions'];

test('master deployment waits for moving-camera acceptance of the exact built artifact',()=>{
 const source=workflow('browser-pages.yml');
 const all=jobs(source);
 assert.match(all.changes,/^ +gridsolver\/\*\*$/m,'native solver changes also run pre-merge acceptance');
 assert.match(all.build,/needs: changes\n    if: needs\.changes\.outputs\.relevant == 'true'/);
 // Two fresh-runner jobs test the exact built artifact: the moving-feed and
 // cross-feature suites, and beside them the long live-camera suite.
 const suites={'live-acceptance':['live_motion','app_review','live_features','live_noise','live_recovery','editor_reread','live_soak'],'live-camera':['live_camera']};
 for (const [id,names] of Object.entries(suites)) {
  const gate=all[id];
  assert.match(gate,/needs: build/,id);
  assert.match(gate,/actions\/download-artifact@[0-9a-f]{40} # v8/,'the artifact download is SHA-pinned');
  assert.match(gate,/name: scanner-static-build/,id);
  assert.match(gate,/GITHUB_SHA\.slice\(0,12\)/,id);
  for (const name of names) assert.ok(gate.includes(`node scripts/${name}_regressions.cjs`),`${id}: ${name}`);
  assert.doesNotMatch(gate,/build_web\.py/,'test the artifact rather than a separate rebuild');
 }
 // live-camera is one job per engine: each leg installs and tests only its
 // engine, one failing leg does not cancel the other, and each leg uploads
 // its report under its own name (a second upload of one name fails).
 const camera=all['live-camera'];
 assert.deepEqual(jobLegs(camera),[['chromium'],['webkit']]);
 assert.match(camera,/^      fail-fast: false$/m);
 assert.match(camera,/^          browsers: \$\{\{ matrix\.engine \}\}$/m);
 assert.match(camera,/^          name: live-camera-report-\$\{\{ matrix\.engine \}\}$/m);
 // A matrix job's result, and so these needs, cover every engine's job.
 assert.match(all.deploy,/needs: \[build, configure, live-acceptance, live-camera\]/);
 assert.match(all.result,/needs: \[changes, build, live-acceptance, live-camera\]/);
});

test('the harness runs both engines unless BROWSER_ENGINES selects some',()=>{
 for (const value of [undefined,'',' ']) assert.deepEqual(selectedEngines(value),ENGINES);
 assert.deepEqual(selectedEngines('webkit'),['webkit']);
 assert.deepEqual(selectedEngines('chromium'),['chromium']);
 assert.deepEqual(selectedEngines('webkit,chromium'),ENGINES);
 assert.deepEqual(selectedEngines('chromium webkit'),ENGINES);
 assert.throws(()=>selectedEngines('firefox'),/BROWSER_ENGINES names no engine firefox/);
});

test('each browser suite runs once per engine and event, and never plays a canvas stream after the recognition suites',()=>{
 const runs=[];
 for (const [file,ids,events] of [['browser-pages.yml',['build','live-acceptance','live-camera'],['pull_request','push']],['scan-input.yml',['recognition','live'],['pull_request']]]) {
  const all=jobs(workflow(file));
  for (const id of ids) {
   const job=suiteRuns(all[id]);
   assert.ok(job.length,`${file} has no suites in ${id}`);
   job.forEach(({suite},index)=>{
    if (!read(`scripts/${suite}.cjs`).includes('captureStream')) return;
    const earlier=job.slice(0,index).map(run=>run.suite).filter(name=>RECOGNITION.includes(name));
    assert.deepEqual(earlier,[],`${suite} plays a canvas stream after ${earlier} in ${file} ${id}`);
   });
   for (const engines of jobLegs(all[id])) for (const engine of engines)
    for (const run of job) for (const event of run.events.filter(e=>events.includes(e)))
     for (const suite of withNested(run.suite)) runs.push({suite,engine,event,where:`${file} ${id}${suite===run.suite?'':` inside ${run.suite}`}`});
  }
 }
 for (const event of ['pull_request','push']) {
  const seen=new Map();
  for (const {suite,engine,where} of runs.filter(run=>run.event===event)) {
   const key=`${suite} in ${engine}`;
   assert.ok(!seen.has(key),`${key} runs in ${seen.get(key)} and in ${where} on ${event}`);
   seen.set(key,where);
  }
  // Every suite that runs on an event covers both engines on it.
  for (const suite of new Set(runs.filter(run=>run.event===event).map(run=>run.suite)))
   for (const engine of ENGINES) assert.ok(seen.has(`${suite} in ${engine}`),`${suite} never runs in ${engine} on ${event}`);
 }
 assert.deepEqual(withNested('live_camera_regressions'),['live_camera_regressions','review_safety_regressions','structural_capture_regressions']);
 const onPullRequests=new Set(runs.filter(run=>run.event==='pull_request').map(run=>run.suite));
 const suites=fs.readdirSync(new URL('../../scripts/',import.meta.url)).filter(f=>/_regressions\.cjs$|^browser_smoke\.cjs$/.test(f));
 assert.ok(suites.length>20);
 for (const file of suites) assert.ok(onPullRequests.has(file.slice(0,-4)),`${file} runs on no pull request`);
});
