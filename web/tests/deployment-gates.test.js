import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
// A suite and those it runs inside itself, read from the sources.
const withNested=suite=>[suite,...[...read(`scripts/${suite}.cjs`).matchAll(/require\("\.\/(\w+)\.cjs"\)(?:\.run)?\(/g)].flatMap(([,inner])=>withNested(inner))];
// The pull-request suites that WebKit's canvas playback must not follow on one runner.
const RECOGNITION=['ocr_quality_regressions','recognition_fragments_regressions','recognition_segments_regressions','scan_input_regressions'];

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
 for (const name of ['live_motion','app_review','live_features','live_noise','live_recovery','editor_reread','live_soak'])
  assert.ok(gate.includes(`node scripts/${name}_regressions.cjs`),name);
 assert.doesNotMatch(gate,/build_web\.py/,'test the artifact rather than a separate rebuild');
 assert.match(source.slice(source.indexOf('  deploy:')),/needs: \[build, configure, live-acceptance\]/);
});

test('each browser suite runs once per event, and never plays a canvas stream after the recognition suites',()=>{
 const runs=[];
 for (const [file,ids,events] of [['browser-pages.yml',['build','live-acceptance'],['pull_request','push']],['scan-input.yml',['recognition','live'],['pull_request']]]) {
  const all=jobs(workflow(file));
  for (const id of ids) {
   const job=suiteRuns(all[id]);
   assert.ok(job.length,`${file} has no suites in ${id}`);
   job.forEach(({suite},index)=>{
    if (!read(`scripts/${suite}.cjs`).includes('captureStream')) return;
    const earlier=job.slice(0,index).map(run=>run.suite).filter(name=>RECOGNITION.includes(name));
    assert.deepEqual(earlier,[],`${suite} plays a canvas stream after ${earlier} in ${file} ${id}`);
   });
   for (const run of job) for (const event of run.events.filter(e=>events.includes(e)))
    for (const suite of withNested(run.suite)) runs.push({suite,event,where:`${file} ${id}${suite===run.suite?'':` inside ${run.suite}`}`});
  }
 }
 for (const event of ['pull_request','push']) {
  const seen=new Map();
  for (const {suite,where} of runs.filter(run=>run.event===event)) {
   assert.ok(!seen.has(suite),`${suite} runs in ${seen.get(suite)} and in ${where} on ${event}`);
   seen.set(suite,where);
  }
 }
 assert.deepEqual(withNested('live_camera_regressions'),['live_camera_regressions','review_safety_regressions','structural_capture_regressions']);
 const onPullRequests=new Set(runs.filter(run=>run.event==='pull_request').map(run=>run.suite));
 const suites=fs.readdirSync(new URL('../../scripts/',import.meta.url)).filter(f=>/_regressions\.cjs$|^browser_smoke\.cjs$/.test(f));
 assert.ok(suites.length>20);
 for (const file of suites) assert.ok(onPullRequests.has(file.slice(0,-4)),`${file} runs on no pull request`);
});
