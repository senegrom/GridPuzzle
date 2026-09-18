// Production service worker with controlled network and per-phase clocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
const flush=()=>new Promise(r=>setImmediate(r));
async function until(predicate) { for(let i=0;i<80;i++){if(predicate())return;await flush();}assert.ok(predicate(),'expected async phase reached'); }
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness({missingManifest=false}={}) {
 const scope='https://example.test/GridPuzzle/',build='111111111111',timers=new Map(),listeners={},requests=[],entries=new Map();
 let serial=0,mode='stall',failPut=false;
 const body='valid bytes',asset={path:'runtime.wasm',sha256:createHash('sha256').update(body).digest('hex')};
 const manifest=JSON.stringify({build,assets:[asset]});
 const cache={async match(key){key=typeof key==='string'?key:key.url;
    if(key.endsWith('assets.json')&&!missingManifest)return new Response(manifest);
    return entries.get(key)?.clone();},async put(key,response){if(failPut)throw Error('Quota exceeded');entries.set(key,response.clone());},async delete(key){return entries.delete(key);}};
 const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8').replace('__BUILD_ID__',build);
 vm.runInNewContext(source,{URL,Request,Response,AbortController,Uint8Array,crypto:webcrypto,
   caches:{open:async()=>cache},setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimeout(id){timers.delete(id);},
   fetch(request){const d=defer();requests.push({request,...d});
    if(mode==='ok')return Promise.resolve(new Response(request.url.endsWith('assets.json')?manifest:body));
    return d.promise;},
   self:{registration:{scope},location:{origin:'https://example.test'},addEventListener(t,fn){listeners[t]=fn;},skipWaiting(){}},
 });
 return {requests,timers,entries,setMode(v){mode=v;},quota(v){failPut=v;},
  post(id='tab'){const messages=[];let promise;const port={postMessage(m){messages.push(m);},close(){this.closed=true;}};
   listeners.message({data:{type:'PREPARE_OFFLINE'},ports:[port],source:{id},waitUntil(p){promise=p;}});
   return {messages,promise,port};},
  timeout(){for(const {fn,ms} of [...timers.values()]){assert.equal(ms,240000);fn();}},body,manifest,
 };
}
test('a worker-owned deadline aborts a stalled asset and a fresh retry finishes',async()=>{
 const h=harness(),first=h.post();await until(()=>h.requests.length===1);const jobId=first.messages[0].jobId;
 h.timeout();await first.promise;assert.match(first.messages.at(-1).error,/stalled/);assert.equal(h.requests[0].request.signal.aborted,true);
 assert.equal(h.timers.size,0);h.setMode('ok');const retry=h.post();await retry.promise;
 assert.notEqual(retry.messages[0].jobId,jobId);assert.equal(retry.messages.at(-1).ready,true);assert.equal(h.timers.size,0);
});
test('manifest download is covered by the worker deadline before a job can block retries',async()=>{
 const h=harness({missingManifest:true}),first=h.post();await until(()=>h.requests.length===1);
 assert.ok(h.requests[0].request.url.endsWith('assets.json'));h.timeout();await first.promise;
 h.setMode('ok');const retry=h.post();await retry.promise;assert.equal(retry.messages.at(-1).ready,true);
});
test('healthy jobs are shared across tabs and replies carry one job identity',async()=>{
 const h=harness(),a=h.post('A');await until(()=>h.requests.length===1);const b=h.post('B');
 assert.equal(a.messages[0].jobId,b.messages[0].jobId);assert.equal(h.requests.length,1);
 h.requests[0].resolve(new Response(h.body));await Promise.all([a.promise,b.promise]);
 for(const request of [a,b]){assert.equal(request.messages.at(-1).ready,true);assert.equal(request.port.closed,true);}
 assert.equal(h.timers.size,0);
});
test('retrying a waiting tab reconnects without aborting another tab or duplicating downloads',async()=>{
 const h=harness(),old=h.post('A');await until(()=>h.requests.length===1);const other=h.post('B'),renewed=h.post('A');
 assert.equal(old.port.closed,true);assert.equal(other.port.closed,undefined);assert.equal(h.requests[0].request.signal.aborted,false);
 h.requests[0].resolve(new Response(h.body));await renewed.promise;
 assert.equal(other.messages.at(-1).ready,true);assert.equal(renewed.messages.at(-1).ready,true);
 assert.equal(h.requests.length,1);assert.equal(old.messages.some(m=>m.ready),false);
});
test('a late retired download cannot publish success or clear a newer pending job',async()=>{
 const h=harness(),a=h.post('A');await until(()=>h.requests.length===1);h.timeout();await a.promise;
 const b=h.post('B');await until(()=>h.requests.length===2);h.requests[0].resolve(new Response(h.body));await flush();await flush();
 const c=h.post('C');assert.equal(c.messages[0].jobId,b.messages[0].jobId);
 assert.equal(h.requests.length,2);assert.equal(a.messages.some(m=>m.ready),false);
 h.requests[1].resolve(new Response(h.body));await b.promise;assert.equal(c.messages.at(-1).ready,true);
});
test('quota and integrity failures never certify readiness and leave a usable retry',async()=>{
 const h=harness();h.setMode('ok');h.quota(true);const a=h.post();await a.promise;assert.match(a.messages.at(-1).error,/Quota/);
 h.quota(false);h.setMode('stall');const b=h.post();await until(()=>h.requests.length===2);
 h.requests[1].resolve(new Response('corrupt'));await b.promise;assert.match(b.messages.at(-1).error,/Asset changed/);
 h.setMode('ok');const c=h.post();await c.promise;assert.equal(c.messages.at(-1).ready,true);
});
test('verification of a stalled response body is also bounded, not merely fetch headers',async()=>{
 const h=harness(),a=h.post();await until(()=>h.requests.length===1);
 let finish;const response=new Response(new ReadableStream({start(controller){finish=()=>{controller.enqueue(new TextEncoder().encode(h.body));controller.close();};}}));
 h.requests[0].resolve(response);await flush();await flush();h.timeout();await a.promise;
 assert.match(a.messages.at(-1).error,/stalled/);finish();await flush();await flush();
 assert.equal(a.messages.some(m=>m.ready),false);h.setMode('ok');const retry=h.post();await retry.promise;assert.equal(retry.messages.at(-1).ready,true);
});
