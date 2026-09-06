"""Final browser boundary checks; CI configuration is committed separately."""
from pathlib import Path

p=Path('web/photo-flow.js');s=p.read_text();assert 'import { TYPES, checkShape }' in s;s=s.replace('import { TYPES, checkShape }','import { TYPES, checkShape, makePuzzle }')
anchor='    clearPhotoMapping();\n    state.result = null;'
assert s.count(anchor)==1
s=s.replace(anchor,'''    const boxRows=Number($("box-rows").value),boxCols=Number($("box-cols").value);
    try {
      if(type!=="auto") {
        const layout=makePuzzle(type,rows,cols);
        layout.boxRows=boxRows;layout.boxCols=boxCols;
        checkShape(layout);
      }
    } catch(error) { fail(error);return; }
''' + anchor)
anchor='      if (id !== getJobId()) return;\n      finish();\n      remember();'
assert s.count(anchor)==1
s=s.replace(anchor,'''      if (id !== getJobId()) return;
      // Snapshot settings belong to this scan. Validate the complete candidate
      // before committing history, state or autosave, including automatic type.
      if (["sudoku", "killersudoku"].includes(found.puzzle.type)) {
        found.puzzle.boxRows=boxRows;found.puzzle.boxCols=boxCols;
      }
      checkShape(found.puzzle);
      finish();
      remember();''')
old='''      if (["sudoku", "killersudoku"].includes(state.puzzle.type)) {
        state.puzzle.boxRows = Number($("box-rows").value);
        state.puzzle.boxCols = Number($("box-cols").value);
      }
'''
assert s.count(old)==1;s=s.replace(old,'');p.write_text(s)

p=Path('web/scanner.js');s=p.read_text();anchor='worker.onmessage = () => {';assert s.count(anchor)==1;s=s.replace(anchor,'''worker.onmessage = ({data}) => {
            if(!data?.cancelled)return; // Ignore progress queued before Stop.''')
anchor='worker.postMessage({ cancel: true });';assert s.count(anchor)==1;s=s.replace(anchor,'''try { worker.postMessage({ cancel: true }); }
          catch { clearTimeout(kill);worker.terminate(); }''');p.write_text(s)
p=Path('web/tests/worker-lifecycle.test.js');p.write_text(p.read_text()+'''
test('late OCR progress is not a cancellation acknowledgement',async()=>{
  const old=globalThis.Worker;let instance;
  globalThis.Worker=class{constructor(){instance=this;}postMessage(){}terminate(){this.stopped=true;}};
  try{
    const scanner=new Scanner(),promise=scanner._request('ocr-host-worker.js',{},()=>{},'classic');
    scanner.cancel();await assert.rejects(promise,{name:'AbortError'});
    instance.onmessage({data:{type:'progress',progress:.5}});assert.ok(!instance.stopped);
    instance.onmessage({data:{cancelled:true}});assert.ok(instance.stopped);
  }finally{globalThis.Worker=old;}
});
test('postMessage failure cannot retain workers or mask the original error',async()=>{
  const old=globalThis.Worker,original=new DOMException('cannot clone','DataCloneError');let instance;
  globalThis.Worker=class{constructor(){instance=this;}postMessage(){throw original;}terminate(){this.stopped=true;}};
  try{
    const scanner=new Scanner();await assert.rejects(scanner._request('ocr-host-worker.js',{},()=>{},'classic'),e=>e===original);
    assert.equal(scanner.jobs.size,0);assert.ok(instance.stopped);
  }finally{globalThis.Worker=old;}
});
''')

p=Path('scripts/browser_smoke.cjs');s=p.read_text();a=s.index('async function checkStartupCancellation(');b=s.index('(async () => {',a)
part=s[a:b];anchor='    await page.click("#read-photo");';assert part.count(anchor)==1
part=part.replace(anchor,'''    const beforeInvalid=await page.evaluate(()=>({puzzle:JSON.stringify(window.__gridpuzzleTestState().puzzle),saved:localStorage.getItem('gridpuzzle-session-v1')}));
    await page.evaluate(()=>document.querySelector('#box-rows').value='0');
    await page.click('#read-photo');
    assert.equal((await page.evaluate(()=>window.__gridpuzzleTestState())).busy,false);
    assert.deepEqual(await page.evaluate(()=>({puzzle:JSON.stringify(window.__gridpuzzleTestState().puzzle),saved:localStorage.getItem('gridpuzzle-session-v1')})),beforeInvalid);
    await page.evaluate(()=>document.querySelector('#box-rows').value='3');
    report.checks.push('invalid scan box settings rejected before OCR and persistence');
''' + anchor)
s=s[:a]+part+s[b:];p.write_text(s)

# Workflow changes require the authenticated GitHub connection. The runner
# changes only source/tests and results, and does not request extra privileges.
assert 'Real Python and OCR browser acceptance' in Path('.github/workflows/browser-tests.yml').read_text()
print('Validated scan transactions and cancellation acknowledgements.')
