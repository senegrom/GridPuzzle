import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryCache, scope } from './service-worker-fixture.js';
test('cache consumes writes and returns independent bytes, metadata and empty bodies', async () => {
  const cache = memoryCache(), response = new Response('durable bytes', {status:201, statusText:'Created', headers:{'x-test':'original'}});
  await cache.put(scope, response);
  assert.equal(response.bodyUsed, true);
  const first = await cache.match(scope), second = await cache.match(new Request(scope));
  first.headers.set('x-test','edited');
  assert.equal(await first.text(),'durable bytes');
  assert.equal(second.bodyUsed,false); assert.equal(await second.text(),'durable bytes');
  for(let i=0;i<20;i++) {
    const copy=await cache.match(scope);
    assert.equal(copy.status,201); assert.equal(copy.statusText,'Created');
    assert.equal(copy.headers.get('x-test'),'original'); assert.equal(await copy.text(),'durable bytes');
  }
  await cache.put(scope+'empty',new Response(null,{status:204}));
  assert.equal((await cache.match(scope+'empty')).body,null);
  assert.equal(await cache.match(scope+'missing'),undefined);
});
test('a failed or incomplete cache write cannot replace stored bytes', async () => {
  const cache=memoryCache(); await cache.put(scope,new Response('old'));
  let controller;
  const response=new Response(new ReadableStream({start(c){controller=c;}}));
  const write=cache.put(scope,response); controller.enqueue(new Uint8Array([1]));
  assert.equal(await (await cache.match(scope)).text(),'old');
  controller.error(Error('interrupted body')); await assert.rejects(write,/interrupted/);
  assert.equal(await (await cache.match(scope)).text(),'old');
});
