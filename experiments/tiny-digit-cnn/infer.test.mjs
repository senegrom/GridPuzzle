import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createModel,normalizeGray} from './infer.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('./artifacts/model.json',import.meta.url)));
const raw=fs.readFileSync(new URL('./artifacts/weights.f32',import.meta.url));
const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
const model=createModel(manifest,bytes);
test('weights checksum and parameter count',()=>{
 assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),manifest.weights_sha256);
 assert.equal(raw.length,26731*4);
});
const vectors=JSON.parse(fs.readFileSync(new URL('./artifacts/parity.json',import.meta.url)));
for(const [i,vector] of vectors.entries()) test(`JavaScript/PyTorch logits match vector ${i}`,()=>{
 const actual=model.logits(vector.input);
 assert.ok(Math.max(...actual.map((v,j)=>Math.abs(v-vector.logits[j])))<.0001);
});
test('uniform light or dark crops have no invented ink',()=>{
 for(const value of [0,99,255]) assert.equal(Math.max(...normalizeGray(new Uint8Array(63).fill(value),7,9)),0);
});
test('dimensions and invalid pixels are rejected',()=>{
 for(const [p,w,h] of [[[],0,0],[[NaN],1,1],[[256],1,1],[[0],-1,1],[[0],1.5,1],[[0],2,1]])
  assert.throws(()=>normalizeGray(p,w,h));
 for(const p of [[],Array(784).fill(NaN),Array(784).fill(-1),Array(784).fill(2)]) assert.throws(()=>model.predict(p));
});
test('malformed or nonfinite weight files are rejected',()=>{
 assert.throws(()=>createModel({...manifest,parameters:1},bytes));
 assert.throws(()=>createModel(manifest,bytes.slice(4)));
 const bad=bytes.slice(0);new DataView(bad).setFloat32(0,NaN,true);assert.throws(()=>createModel(manifest,bad));
 const meta=structuredClone(manifest);meta.tensors[0].offset=1;assert.throws(()=>createModel(meta,bytes));
});
test('predictions contain a reject option and bounded normalized scores',()=>{
 const result=model.predict(new Float32Array(784));assert.equal(result.label,'reject');assert.equal(result.digit,null);
 assert.ok(result.score>0&&result.score<=1);assert.ok(Math.abs(result.probabilities.reduce((a,b)=>a+b,0)-1)<1e-6);
});
