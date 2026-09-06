from pathlib import Path
p=Path('web/scan-analysis.js');p.write_text("import {isCage} from './model.js';\n"+p.read_text())
p=Path('web/photo-flow.js');p.write_text("import {TYPES,checkShape} from './model.js';\n"+p.read_text())
p=Path('web/tests/model.test.js');s=p.read_text();assert "makePuzzle('bad')" in s;s=s.replace("makePuzzle('bad')", "{...makePuzzle(),type:'bad'}");s += "\ntest('Construction validates type before allocating',()=>assert.throws(()=>makePuzzle('bad')));\n";p.write_text(s)
p=Path('web/tests/session.test.js');s=p.read_text();assert 'assert.throws(()=>restoreSession(storage))' in s;s=s.replace('assert.throws(()=>restoreSession(storage))', 'assert.equal(restoreSession(storage),null)');p.write_text(s)
p=Path('web/scanner.js');s=p.read_text();assert '      worker.postMessage(payload);' in s;s=s.replace('      worker.postMessage(payload);', '      try{worker.postMessage(payload);}catch(error){end(error,null,true);}');p.write_text(s)
p=Path('web/README.md');p.write_text(p.read_text()+'''
## Input, build and lifecycle hardening

The editor validates dimensions and Sudoku boxes before allocation, persistence or rendering. Invalid saved sessions fall back to a clean board. Shared JSON fixtures distinguish incomplete-but-editable states from solve-ready inputs; the Python adapter remains the final structural boundary.

Builds are staged before publication. Inside the repository, only `_site` is accepted as output; a custom external path must be new or contain the builder's ownership marker. Existing unmarked directories (including outputs from older builds) are never deleted: move them aside before rebuilding. Source directories, the Git directory, repository ancestors and symbolic output links are rejected. A failed build preserves the previous good output.

Offline requests, readiness checks and preparation use the same digest verifier. Corrupt entries are evicted and retried from the network. Readiness is checked against actual verified entries, not just cache-key presence, and online use can continue even if cache quota is exhausted.

Task/deadline ownership, edit snapshots, camera/photo flow and offline controls have separate modules. Grayscale is computed once for scan preparation; thresholding and region extraction run in the geometry worker. Each OCR scan has a dedicated host owning its raw Tesseract worker during engine and language initialization. Stop rejects the pending task immediately, requests child termination, and bounds host cleanup to 100 ms; scan initialization has a three-minute deadline. Real-browser tests stall language loading, stop the scan, check worker cleanup and then perform a fresh successful scan.

These lifecycle changes do not substitute or reorder any solver technique.
''')
Path('web/tests/controllers.test.js').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskController} from '../task-controller.js';
import {captureEdit,restoreEdit,rememberEdit} from '../edit-history.js';
import {makePuzzle} from '../model.js';
import {prepareScan} from '../scan-analysis.js';
test('task generations invalidate earlier jobs and finish clears deadlines',async()=>{
  const nodes=new Map(),events=[],$=id=>{if(!nodes.has(id))nodes.set(id,{setAttribute(){},hidden:false});return nodes.get(id);};
  const tasks=createTaskController({$,scanner:{cancel:()=>events.push('cancel')},status:()=>{},onStop:busy=>events.push(busy)});
  const first=tasks.begin();assert.ok(tasks.busy);tasks.setDeadline(()=>events.push('expired'),5);tasks.finish();
  await new Promise(r=>setTimeout(r,15));assert.ok(!events.includes('expired'));assert.equal(tasks.busy,false);
  const second=tasks.begin();assert.ok(second>first);tasks.stop();assert.ok(tasks.id>second);assert.equal(tasks.busy,false);
});
test('edit snapshots detach values and restore review metadata',()=>{
  const state={puzzle:makePuzzle(),uncertain:new Set([0]),needsReview:true,notes:['review'],puzzleSource:7,history:[],selected:[0]};
  const snapshot=captureEdit(state);rememberEdit(state);state.puzzle.cells[0]=9;state.uncertain.clear();
  assert.equal(snapshot.puzzle.cells[0],null);restoreEdit(state,snapshot);assert.ok(state.uncertain.has(0));assert.equal(state.puzzleSource,7);assert.equal(state.puzzle.cells[0],null);
});
test('off-thread scan preparation handles a whole image without DOM access',()=>{
  const width=100,height=100,image={width,height,data:new Uint8ClampedArray(width*height*4).fill(255)};
  const result=prepareScan(image,'sudoku',4,4);assert.equal(result.entries.length,0);assert.equal(result.mask.length,width*height);assert.equal(result.g.length,width*height);assert.equal(result.black.length,16);
});
''')
print('Added lifecycle tests and migration/safety documentation.')
