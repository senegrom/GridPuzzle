"""Reconcile concurrent scanner fixes without discarding either implementation."""
from pathlib import Path
import subprocess

UPSTREAM='9ea64d8e5dfa96e3bfd38dc0aef8fcea89cfa5da'
def git(*args,check=True):
    return subprocess.run(['git',*args],check=check,text=True,capture_output=True)
def upstream(path):
    return git('show',f'{UPSTREAM}:{path}').stdout

# Both branches changed the formerly minified app. Keep the reviewed lifecycle
# implementation, transplant every independent upstream behaviour below, and
# retain a true merge parent so future work does not reintroduce this conflict.
owned=('web/app.js','web/scanner.js','web/model.js','web/index.html','web/ocr-map.js')
ours={name:Path(name).read_text() for name in owned}
workflow=Path('.github/workflows/browser-pages.yml').read_bytes()
merge=git('merge','--no-commit','--no-ff',UPSTREAM,check=False)
conflicts=git('diff','--name-only','--diff-filter=U').stdout.splitlines()
if merge.returncode not in (0,1) or set(conflicts)-set(owned):
    raise RuntimeError(f'Unexpected merge conflict: {conflicts}\n{merge.stdout}\n{merge.stderr}')
for name in owned:
    Path(name).write_text(ours[name])

# The concurrent patch's more thorough nested-field validation is retained.
# The additional safeguards here keep constructor allocation and direct render
# calls protected, and retain Python-compatible defaults for omitted boxes.
s=upstream('web/model.js')
s=s.replace('export function makePuzzle(', "export function checkDimensions(rows,cols=rows){dimension(rows);dimension(cols);}\nexport function makePuzzle(")
s=s.replace('  dimension(rows);dimension(cols);', "  dimension(rows);dimension(cols);\n  if(!Object.hasOwn(TYPES,type))throw Error('Choose a supported puzzle type.');")
s=s.replace('export function conflicts(p) {','export function conflicts(p) {\n  checkShape(p);')
old="    if(['sudoku','killersudoku'].includes(p.type)&&p.boxRows>0&&p.boxCols>0)\n      for(let r=0;r<p.rows;r+=p.boxRows)for(let c=0;c<p.cols;c+=p.boxCols) unique(all.filter(i=>Math.floor(i/p.cols)>=r&&Math.floor(i/p.cols)<r+p.boxRows&&i%p.cols>=c&&i%p.cols<c+p.boxCols));"
assert old in s
s=s.replace(old,"    if(['sudoku','killersudoku'].includes(p.type)) {\n      const br=p.boxRows===undefined?3:p.boxRows,bc=p.boxCols===undefined?3:p.boxCols;\n      for(let r=0;r<p.rows;r+=br)for(let c=0;c<p.cols;c+=bc) unique(all.filter(i=>Math.floor(i/p.cols)>=r&&Math.floor(i/p.cols)<r+br&&i%p.cols>=c&&i%p.cols<c+bc));\n    }")
Path('web/model.js').write_text(s)
# Our HTML/OCR mapping changes were formatting only. Preserve the new controls
# and stroke/corner classifier verbatim, then format them with the rest.
for name in ('web/index.html','web/ocr-map.js'):
    Path(name).write_text(upstream(name))

# Move the concurrent region filter into the off-thread preparation stage,
# rather than reintroducing a second main-thread grayscale/threshold pass.
source=upstream('web/scanner.js')
region=source[source.index('    function region('):source.index('    if(!entries.length)')]
p=Path('web/scan-analysis.js');s=p.read_text()
a=s.index('  function region(');b=s.index('  return { image, meta:',a)
s=s[:a]+region+'\n'+s[b:]
s="import {isGridStroke} from './ocr-map.js';\n"+s
p.write_text(s)

# Guided review confirms only a saved cell, not the remaining uncertain clues.
source=upstream('web/app.js')
p=Path('web/app.js');s=p.read_text()
s="import {nextReviewCell} from './model.js';\n"+s
a=s.index('function openCell(');b=s.index('function blockInputs(',a)
new=source[source.index('function openCell('):source.index('function blockInputs(')].replace("stopTask(busy?", "stopTask(tasks.busy?")
s=s[:a]+new+s[b:]
a=s.index('function saveCell(');b=s.index('$("cell-form").onsubmit',a)
new=source[source.index('function saveCell('):source.index("$('cell-form').onsubmit")]
s=s[:a]+new+s[b:]
anchor='  const sourceAvailable ='
assert s.count(anchor)==1
s=s.replace(anchor,"  $('review-clues').hidden=!state.uncertain.size;\n  $('review-clues').textContent=`Review ${state.uncertain.size} highlighted clues`;\n"+anchor)
anchor='  getJobId: () => tasks.id,'
assert s.count(anchor)==1
s=s.replace(anchor,anchor+'\n  setDeadline: (callback,ms)=>tasks.setDeadline(callback,ms),')
p.write_text(s)
p=Path('web/photo-flow.js');s=p.read_text();anchor='  getJobId,';assert s.count(anchor)==1;s=s.replace(anchor,anchor+'\n  setDeadline,')
a=s.index('  async function readPhoto(')
head,body=s[:a],s[a:]
anchor='    const id = begin();';assert body.count(anchor)==1
body=body.replace(anchor,anchor+"\n    setDeadline(()=>{if(id===getJobId())stopTask('Recognition timed out. Check the connection and try a clearer photograph.');},120000);")
p.write_text(head+body)
p=Path('web/offline.js');s=p.read_text();anchor='const ready = await navigator.serviceWorker.ready;';assert s.count(anchor)==1;s=s.replace(anchor,anchor+'\n      $("prepare-offline").disabled=false;');p.write_text(s)
p=Path('web/README.md');s=p.read_text().replace('scan initialization has a three-minute deadline','each worker has a three-minute fallback deadline and the complete recognition task has a two-minute deadline');p.write_text(s)
assert Path('.github/workflows/browser-pages.yml').read_bytes()==workflow, 'Runner must not modify workflow definitions'
git('add','web','scripts','.github/workflows/browser-pages.yml')
print('Preserved concurrent OCR, guided review, nested validation, timeouts and regression tests.')
