"""One-shot browser input, output-directory and cache hardening."""
from pathlib import Path
import json

p=Path('web/model.js');s=p.read_text()
s=s.replace('export function boxShape(n) {', '''export function checkDimensions(rows, cols=rows) {
  for (const value of [rows, cols]) {
    if (!Number.isInteger(value) || value < 1 || value > 25) {
      throw Error('Board dimensions must be whole numbers from 1 to 25.');
    }
  }
}
export function boxShape(n) { checkDimensions(n);''')
s=s.replace("export function makePuzzle(type='sudoku',rows=9,cols=rows) {", "export function makePuzzle(type='sudoku',rows=9,cols=rows) {\n  checkDimensions(rows, cols);\n  if (!Object.hasOwn(TYPES, type)) throw Error('Choose a supported puzzle type.');")
s=s.replace("  for(const k of ['rows','cols']) if(!Number.isInteger(p[k]) || p[k]<1 || p[k]>25) throw Error('Board dimensions must be whole numbers from 1 to 25.');", "  checkDimensions(p.rows, p.cols);")
anchor="  const allowed=new Set(['version'"
pos=s.index(anchor)
s=s[:pos]+'''  if (['sudoku', 'killersudoku'].includes(p.type)) {
    const br = p.boxRows === undefined ? 3 : p.boxRows;
    const bc = p.boxCols === undefined ? 3 : p.boxCols;
    if (!Number.isInteger(br) || !Number.isInteger(bc) || br < 1 || bc < 1 ||
        br > p.rows || bc > p.cols || br * bc !== p.rows || p.rows % br || p.cols % bc) {
      throw Error('Box dimensions must be positive integers that tile the board and contain one of each value.');
    }
  }
''' + s[pos:]
s=s.replace("!cage.cells.length||cage.cells.some", "!cage.cells.length||cage.cells.length>p.cells.length||cage.cells.some")
s=s.replace('export function conflicts(p) {', '''export function conflicts(p) {
  // Rendering is also an input boundary: never iterate unchecked dimensions.
  checkShape(p);''')
s=s.replace("    if(['sudoku','killersudoku'].includes(p.type)&&p.boxRows>0&&p.boxCols>0)\n      for(let r=0;r<p.rows;r+=p.boxRows)for(let c=0;c<p.cols;c+=p.boxCols) unique(all.filter(i=>Math.floor(i/p.cols)>=r&&Math.floor(i/p.cols)<r+p.boxRows&&i%p.cols>=c&&i%p.cols<c+p.boxCols));", "    if(['sudoku','killersudoku'].includes(p.type)) {\n      const br=p.boxRows===undefined?3:p.boxRows, bc=p.boxCols===undefined?3:p.boxCols;\n      for(let r=0;r<p.rows;r+=br)for(let c=0;c<p.cols;c+=bc) unique(all.filter(i=>Math.floor(i/p.cols)>=r&&Math.floor(i/p.cols)<r+br&&i%p.cols>=c&&i%p.cols<c+bc));\n    }")
p.write_text(s)
p=Path('web/session.js');s=p.read_text().replace('  checkShape(puzzle);', '''  try { checkShape(puzzle); }
  catch { return null; } // Malformed/legacy state must not prevent startup.''');p.write_text(s)

p=Path('scripts/build_web.py');s=p.read_text()
s=s.replace('import argparse\n', 'import argparse\nfrom contextlib import contextmanager\n')
a=s.index('\ndef main():');b=s.index('    commit=subprocess.check_output', a)
s=s[:a]+'''
_OUTPUT_MARKER = '.gridpuzzle-output'
_OUTPUT_KIND = 'GridPuzzle static output v1\\n'


def validate_output(root, output):
    """Never clean source paths, links or directories not owned by this builder."""
    root = Path(root).resolve()
    raw = root / output
    if raw.is_symlink():
        raise ValueError('Build output must not be a symbolic link')
    out = raw.resolve()
    if out == root or root.is_relative_to(out):
        raise ValueError('Build output must not contain the repository')
    if out.is_relative_to(root) and out != root / '_site':
        raise ValueError('Inside the repository only _site may be used; choose a new external directory for custom output')
    if out.exists():
        marker = out / _OUTPUT_MARKER
        if (not out.is_dir() or marker.is_symlink() or not marker.is_file()
                or marker.stat().st_size > 128 or marker.read_text() != _OUTPUT_KIND):
            raise ValueError('Refusing to replace an unowned output directory; move it aside and retry')
    return out


@contextmanager
def build_destination(root, output):
    """Build in isolation; failed builds leave the last good output intact."""
    out = validate_output(root, output)
    out.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.' + out.name + '-stage-', dir=out.parent))
    backup = None
    try:
        (stage / _OUTPUT_MARKER).write_text(_OUTPUT_KIND)
        yield stage
        # Recheck after the build, before any rename (including ownership).
        validate_output(root, output)
        if out.exists():
            backup = Path(tempfile.mkdtemp(prefix='.' + out.name + '-backup-', dir=out.parent)) / 'previous'
            out.replace(backup)
        try:
            stage.replace(out)
        except BaseException:
            if backup is not None:
                backup.replace(out)
                backup.parent.rmdir()
            raise
        if backup is not None:
            shutil.rmtree(backup.parent)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        # Never delete a backup after a failed restoration.


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='_site')
    args = parser.parse_args()
    with build_destination(ROOT, args.output) as out:
        build(out)


def build(out):
''' + s[b:]
s=s.replace("source.name not in ('sw.js','.nojekyll')", "source.name not in ('sw.js','.nojekyll',_OUTPUT_MARKER)")
p.write_text(s)

Path('web/sw.js').write_text('''/* Only this app's scoped, versioned cache is ever read or removed. */
const VERSION='__BUILD_ID__';
const PREFIX=`gridpuzzle:${self.registration.scope}:`;
const CACHE=PREFIX+VERSION;
const url=path=>new URL(path,self.registration.scope).href;

function validateManifest(data) {
  if(data.build!==VERSION || !Array.isArray(data.assets)) throw Error('Update the app before downloading offline assets.');
  for(const asset of data.assets) {
    if(typeof asset.path!=='string' || !url(asset.path).startsWith(self.registration.scope) ||
       !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Invalid offline asset manifest.');
  }
  return data.assets;
}
async function manifest(cache) {
  const response=await cache.match(url('assets.json'));
  if(!response) throw Error('The offline asset list is missing. Reload online.');
  return validateManifest(await response.json());
}
async function matchesAsset(response, asset) {
  if(!response?.ok) return false;
  const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')===asset.sha256;
}
async function verifiedAsset(cache, asset, {network=true, requireStorage=true}={}) {
  const key=url(asset.path);
  let response=await cache.match(key);
  if(response && await matchesAsset(response,asset)) return response;
  // A failed verification must not poison every subsequent retry.
  if(response) await cache.delete(key);
  if(!network) return null;
  response=await fetch(new Request(key,{cache:'reload'}));
  if(!response.ok) throw Error(`Could not download ${asset.path}. Stay online and retry.`);
  if(!await matchesAsset(response,asset)) throw Error(`Asset changed during download: ${asset.path}. Update the app and retry.`);
  try { await cache.put(key,response.clone()); }
  catch(error) { if(requireStorage) throw error; } // Quota does not break online use.
  return response;
}
async function offlineReady(cache, assets) {
  // Sequential verification bounds memory even for large WASM assets. A
  // presence-only marker would lie after a partial eviction or bad response.
  for(const asset of assets) if(!await verifiedAsset(cache,asset,{network:false})) return false;
  return true;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const response=await fetch(new Request(url('assets.json'),{cache:'reload'}));
  if(!response.ok) throw Error('Could not load the offline manifest.');
  const assets=validateManifest(await response.clone().json());
  const cache=await caches.open(CACHE);
  await cache.put(url('assets.json'),response);
  // Every first-party module is included automatically; splitting UI modules
  // cannot accidentally drop one from the offline shell.
  const shell=assets.filter(a=>a.path.startsWith('icons/') || (!a.path.includes('/') && !a.path.endsWith('.zip')));
  for(const asset of shell) await verifiedAsset(cache,asset);
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys()) if(key.startsWith(PREFIX)&&key!==CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,target=new URL(request.url);
  if(request.method!=='GET' || !request.url.startsWith(self.registration.scope) || target.origin!==self.location.origin || request.headers.has('range')) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(request.url===url('assets.json')) {
      await manifest(cache);
      return cache.match(url('assets.json'));
    }
    const assets=await manifest(cache);
    const key=target.href===self.registration.scope ? url('index.html') : target.href;
    const asset=assets.find(a=>url(a.path)===key);
    if(!asset) return fetch(request); // Never cache unmanifested responses.
    return verifiedAsset(cache,asset,{requireStorage:false});
  })());
});
let downloading=false;
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE'){self.skipWaiting();return;}
  const port=event.ports[0];if(!port)return;
  event.waitUntil((async()=>{
    try {
      const cache=await caches.open(CACHE),assets=await manifest(cache);
      if(event.data?.type==='OFFLINE_STATUS') {
        port.postMessage({done:true,ready:await offlineReady(cache,assets)});return;
      }
      if(event.data?.type!=='PREPARE_OFFLINE') throw Error('Unknown offline task');
      if(downloading) throw Error('Offline preparation is already running in another tab.');
      downloading=true;
      try {
        for(let i=0;i<assets.length;i++) {
          await verifiedAsset(cache,assets[i]);
          port.postMessage({progress:i+1,total:assets.length});
        }
        port.postMessage({done:true,ready:true});
      } finally { downloading=false; }
    } catch(error) { port.postMessage({error:error.message}); }
  })());
});
''')

base=dict(version=1,type='sudoku',rows=4,cols=4,boxRows=2,boxCols=2,cells=[None]*16,cages=[],inequalities=[],clues=[])
fixtures=[dict(name='valid empty editor',payload=base,editor=True,solver=True)]
for name,changes in [('tiny box',{'boxRows':1e-12}),('fractional box',{'boxCols':1.5}),('null box',{'boxRows':None}),('wrong tiling',{'boxRows':3}),('zero rows',{'rows':0}),('huge rows',{'rows':1000000000}),('string box',{'boxCols':'2'})]:
    fixtures.append(dict(name=name,payload={**base,**changes},editor=False,solver=False))
fixtures.append(dict(name='incomplete cages are editable, not solve-ready',payload={**base,'type':'killersudoku'},editor=True,solver=False))
Path('web/tests/fixtures').mkdir(exist_ok=True)
Path('web/tests/fixtures/payloads.json').write_text(json.dumps(fixtures,indent=2)+'\n')
Path('web/tests/input-safety.test.js').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkShape,conflicts,makePuzzle,boxShape} from '../model.js';
import {restoreSession} from '../session.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/payloads.json',import.meta.url),'utf8'));
for(const fixture of fixtures) test(fixture.name,()=>{
  if(fixture.editor) assert.doesNotThrow(()=>checkShape(fixture.payload));
  else {
    assert.throws(()=>checkShape(fixture.payload));
    assert.throws(()=>conflicts(fixture.payload));
    assert.equal(restoreSession({get:()=>({puzzle:fixture.payload})}),null);
  }
});
test('dimensions are rejected before allocation and box calculation',()=>{
  for(const n of [0,-1,1e-12,1e9,Infinity,NaN,'9',null]) {
    assert.throws(()=>makePuzzle('sudoku',n));
    assert.throws(()=>boxShape(n));
  }
});
''')
Path('tests/test_web_review3.py').write_text('''import json
from pathlib import Path
import pytest
from gridsolver.web_api import build_grid
from scripts.build_web import build_destination,validate_output

FIXTURES=json.loads((Path(__file__).parents[1]/'web/tests/fixtures/payloads.json').read_text())
@pytest.mark.parametrize('fixture',FIXTURES,ids=lambda f:f['name'])
def test_shared_payload_contract(fixture):
    if fixture['solver']:
        build_grid(fixture['payload'])
    else:
        with pytest.raises(ValueError): build_grid(fixture['payload'])

@pytest.mark.parametrize('name',['web','gridsolver','.git','tests','scripts','.', '..','web/generated'])
def test_builder_refuses_source_paths_without_deleting(name,tmp_path):
    root=tmp_path/'repo';root.mkdir()
    (root/'web').mkdir();sentinel=root/'web/source.js';sentinel.write_text('keep')
    with pytest.raises(ValueError):
        with build_destination(root,name): pytest.fail('unsafe output accepted')
    assert sentinel.read_text()=='keep'

def test_builder_refuses_unowned_existing_directory(tmp_path):
    root=tmp_path/'repo';root.mkdir();out=root/'_site';out.mkdir();(out/'sentinel').write_text('keep')
    with pytest.raises(ValueError):
        with build_destination(root,'_site'): pass
    assert (out/'sentinel').read_text()=='keep'

def test_failed_build_preserves_previous_output_and_success_replaces_it(tmp_path):
    root=tmp_path/'repo';root.mkdir()
    with build_destination(root,'_site') as out: (out/'index.html').write_text('old')
    with pytest.raises(RuntimeError):
        with build_destination(root,'_site') as out:
            (out/'index.html').write_text('partial')
            raise RuntimeError('build failed')
    assert (root/'_site/index.html').read_text()=='old'
    with build_destination(root,'_site') as out: (out/'index.html').write_text('new')
    assert (root/'_site/index.html').read_text()=='new'
    assert not list(root.glob('._site-stage-*'))
    assert not list(root.glob('._site-backup-*'))

def test_builder_rejects_symbolic_output(tmp_path):
    root=tmp_path/'repo';root.mkdir();target=tmp_path/'target';target.mkdir()
    try: (root/'_site').symlink_to(target,target_is_directory=True)
    except OSError: pytest.skip('symlink creation is unavailable')
    with pytest.raises(ValueError): validate_output(root,'_site')
    assert target.is_dir()
''')
Path('web/tests/cache-recovery.test.js').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
function harness(){
  const entries=new Map(),calls=[];
  const cache={match:async key=>entries.get(String(key))?.clone(),put:async(key,value)=>entries.set(String(key),value.clone()),delete:async key=>entries.delete(String(key))};
  const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  const context=vm.createContext({URL,Request,Response,Uint8Array,crypto:webcrypto,self:{registration:{scope:'https://example.test/GridPuzzle/'},location:{origin:'https://example.test'},addEventListener(){}},fetch:async request=>{calls.push(request.url);return new Response('correct');}});
  vm.runInContext(source+'\\nglobalThis.api={verifiedAsset,offlineReady};',context);
  const asset={path:'runtime.wasm',sha256:createHash('sha256').update('correct').digest('hex')};
  return {entries,calls,cache,asset,...context.api};
}
test('false readiness evicts a poisoned asset and preparation refetches',async()=>{
  const h=harness(),key='https://example.test/GridPuzzle/runtime.wasm';
  h.entries.set(key,new Response('wrong version'));
  assert.equal(await h.offlineReady(h.cache,[h.asset]),false);
  assert.equal(h.entries.has(key),false);assert.equal(h.calls.length,0);
  assert.equal(await (await h.verifiedAsset(h.cache,h.asset)).text(),'correct');
  assert.equal(h.calls.length,1);
  assert.equal(await h.offlineReady(h.cache,[h.asset]),true);
  await h.cache.delete(key);assert.equal(await h.offlineReady(h.cache,[h.asset]),false);
});
test('retry repairs bad cached bytes, without requiring a status check first',async()=>{
  const h=harness();h.entries.set('https://example.test/GridPuzzle/runtime.wasm',new Response('bad'));
  await h.verifiedAsset(h.cache,h.asset);assert.equal(h.calls.length,1);
  await h.verifiedAsset(h.cache,h.asset);assert.equal(h.calls.length,1);
});
test('mismatched network bytes never become ready and a corrected retry succeeds',async()=>{
  const h=harness(),wrong={...h.asset,sha256:'0'.repeat(64)};
  await assert.rejects(h.verifiedAsset(h.cache,wrong),/Asset changed/);
  assert.equal(h.entries.size,0);
  await h.verifiedAsset(h.cache,h.asset);assert.equal(h.calls.length,2);
});
test('cache quota errors do not block verified online responses',async()=>{
  const h=harness();h.cache.put=async()=>{throw Error('quota');};
  assert.equal(await (await h.verifiedAsset(h.cache,h.asset,{requireStorage:false})).text(),'correct');
  await assert.rejects(h.verifiedAsset(h.cache,h.asset),/quota/);
});
''')
print('Applied browser input, atomic output and verified-cache recovery fixes.')
