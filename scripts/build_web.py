#!/usr/bin/env python3
"""Build a completely self-hosted static phone app; Python solver is unmodified.

Uses immutable npm package versions for prebuilt browser assets, not a JS port
of the solver. No npm lifecycle scripts are executed. No network calls happen
at app runtime except requests to this site's own static files.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile
import zlib
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = {
    'pyodide': '314.0.6',
    'tesseract.js': '6.0.1',
    'tesseract.js-core': '6.0.0',
    '@tesseract.js-data/eng': '1.0.0',
}


def package(name, version, temporary):
    destination = temporary / name.replace('/', '_').replace('@', '')
    destination.mkdir()
    result = subprocess.run(
        ['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', str(destination), f'{name}@{version}'],
        check=True, text=True, capture_output=True, timeout=240,
    )
    metadata = json.loads(result.stdout)[0]
    with tarfile.open(destination / metadata['filename']) as archive:
        archive.extractall(destination, filter='data')
    return destination / 'package', metadata['integrity']


def copy(source, destination):
    if not source.is_file():
        raise FileNotFoundError(f'Required browser asset missing: {source}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def icon(size, path):
    """Opaque PNG icon with a mask-safe grid/check mark, using only stdlib."""
    ink=(18,59,59);light=(220,236,224);mint=(125,209,170);gold=(243,202,118)
    def segment_distance(x,y,a,b):
        dx,dy=b[0]-a[0],b[1]-a[1]
        t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
        return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)
    raw=bytearray()
    for yy in range(size):
        raw.append(0)
        for xx in range(size):
            x,y=xx/size,yy/size;color=ink
            if .22<x<.78 and .22<y<.78:
                if min(abs(x-z) for z in (.23,.41,.59,.77))<.012 or min(abs(y-z) for z in (.23,.41,.59,.77))<.012:color=light
                elif .43<x<.57 and .43<y<.57:color=mint
            if min(segment_distance(x,y,(.58,.68),(.65,.75)),segment_distance(x,y,(.65,.75),(.79,.55)))<.025:color=gold
            raw.extend((*color,255))
    def chunk(kind,data):return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw),9))+chunk(b'IEND',b'')
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(png)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='_site');args=parser.parse_args()
    out=(ROOT/args.output).resolve()
    if out==ROOT or ROOT.is_relative_to(out):
        raise ValueError('Build output must not contain the repository itself')
    if out.exists():shutil.rmtree(out)
    out.mkdir(parents=True)
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();build=commit[:12]
    for source in (ROOT/'web').iterdir():
        if source.is_file() and source.suffix in ('.html','.css','.js','.svg','.webmanifest'):
            text=source.read_text().replace('__BUILD_ID__',build)
            if source.name=='solver-worker.js':text=text.replace('solver.zip',f'solver.{build}.zip')
            (out/source.name).write_text(text)
    (out/'.nojekyll').touch()
    # Include every original core module byte-for-byte, and its license.
    with zipfile.ZipFile(out/f'solver.{build}.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for source in sorted((ROOT/'gridsolver').rglob('*.py')):
            name=source.relative_to(ROOT).as_posix();entry=zipfile.ZipInfo(name,date_time=(2020,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(entry,source.read_bytes())
        archive.writestr('LICENSE', (ROOT/'LICENSE').read_bytes())
    provenance=[]
    with tempfile.TemporaryDirectory() as temporary:
        for name,version in PACKAGES.items():
            source,integrity=package(name,version,Path(temporary));provenance.append({'package':name,'version':version,'integrity':integrity})
            if name=='pyodide':
                for file in ('pyodide.mjs','pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'):
                    copy(source/file,out/'vendor/pyodide'/file)
            elif name=='tesseract.js':
                for file in ('tesseract.min.js','worker.min.js'):copy(source/'dist'/file,out/'vendor/tesseract'/file)
            elif name=='tesseract.js-core':
                for file in source.glob('*.wasm*'):copy(file,out/'vendor/tesseract-core'/file.name)
            else:
                candidates=sorted(source.rglob('eng.traineddata.gz'))
                preferred=[p for p in candidates if 'best_int' in p.as_posix()]
                if not preferred:raise FileNotFoundError(f'English best_int model not found: {candidates}')
                copy(preferred[0],out/'vendor/tessdata/eng.traineddata.gz')
            for license_path in source.glob('*LICENSE*'):
                if license_path.is_file():copy(license_path,out/'licenses'/f'{name.replace("/","_").replace("@","")}-{license_path.name}')
    for name,size in [('apple-touch-icon.png',180),('icon-192.png',192),('icon-512.png',512),('maskable-512.png',512)]:icon(size,out/'icons'/name)
    copy(ROOT/'LICENSE',out/'LICENSE.txt')
    (out/'build-info.json').write_text(json.dumps({'commit':commit,'build':build,'packages':provenance},indent=2)+'\n')
    (out/'THIRD_PARTY_NOTICES.txt').write_text('GridPuzzle is AGPL-3.0-only. Source: https://github.com/senegrom/GridPuzzle/tree/browser-scanner\nBrowser dependencies are self-hosted, version-pinned, and retain their supplied licenses.\n'+json.dumps(provenance,indent=2)+'\n')
    assets=[]
    for source in sorted(out.rglob('*')):
        if source.is_file() and source.name not in ('sw.js','.nojekyll'):
            data=source.read_bytes();assets.append({'path':source.relative_to(out).as_posix(),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    (out/'assets.json').write_text(json.dumps({'build':build,'assets':assets},separators=(',',':'))+'\n')
    print(f'Built {build}: {len(assets)} offline assets, {sum(a["bytes"] for a in assets)/1024**2:.1f} MiB',flush=True)
    print(json.dumps(provenance,indent=2),flush=True)


if __name__=='__main__':main()
