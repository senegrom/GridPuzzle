import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {moveIndex,hasCageRemoval,hasInequalityRemoval} from '../accessibility.js';

test('keyboard arrows never wrap across rows or columns',()=>{
  assert.equal(moveIndex(8,'ArrowRight',9,9),8);
  assert.equal(moveIndex(9,'ArrowLeft',9,9),9);
  assert.equal(moveIndex(4,'ArrowUp',9,9),4);
  assert.equal(moveIndex(76,'ArrowDown',9,9),76);
  assert.equal(moveIndex(10,'ArrowRight',9,9),11);
  assert.equal(moveIndex(10,'ArrowDown',9,9),19);
});
test('remove buttons only invalidate state when a matching structure exists',()=>{
  const p={cages:[{cells:[0,1]}],inequalities:[{less:4,greater:5}]};
  assert.equal(hasCageRemoval(p,[]),false);assert.equal(hasCageRemoval(p,[7]),false);assert.equal(hasCageRemoval(p,[1]),true);
  assert.equal(hasInequalityRemoval(p,[4]),false);assert.equal(hasInequalityRemoval(p,[4,6]),false);assert.equal(hasInequalityRemoval(p,[4,5]),true);
});
test('service-worker root navigation ignores query strings but not subpaths',()=>{
  const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  const self={registration:{scope:'https://example.test/GridPuzzle/'},location:{origin:'https://example.test'},addEventListener(){}};
  const context=vm.createContext({self,URL,Request,Response,Uint8Array,crypto:{subtle:{}},caches:{keys:async()=>[]},fetch:async()=>new Response('')});
  vm.runInContext(source+'\nglobalThis.routeAssetForTest=routeAsset;',context);
  const root=new URL('https://example.test/GridPuzzle/?share=1');
  const sub=new URL('https://example.test/GridPuzzle/help?share=1');
  assert.equal(context.routeAssetForTest({mode:'navigate'},root),'https://example.test/GridPuzzle/index.html');
  assert.equal(context.routeAssetForTest({mode:'navigate'},sub),sub.href);
});
