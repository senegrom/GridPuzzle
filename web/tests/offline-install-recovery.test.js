import test from 'node:test';
import assert from 'node:assert/strict';
import { setupOffline } from '../offline.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const prefix="Failed to register a ServiceWorker for scope ('https://example.test/') with script ('https://example.test/sw.js'): ";
async function harness(t, {failRegister=false, registerError=null, active=false, missing=false, redundant=false}={}) {
  const nodes=new Map(), timers=new Map(), requests=[]; let serial=0,reloads=0,ready;
  const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:true,disabled:false});return nodes.get(id);};
  $('prepare-offline').textContent='Download offline assets'; $('prepare-offline').disabled=true;
  $('offline-state').textContent='First use needs an internet connection.';
  const worker=()=>Object.assign(new EventTarget(),{state:'installing',postMessage(m,ports){requests.push(m.type);ports?.[0].reply({done:true,ready:false});}});
  const installing=worker(), old=worker(); old.state='activated'; if(redundant)installing.state='redundant';
  const registration=Object.assign(new EventTarget(),{active:active?old:null,waiting:null,installing:missing?null:installing});
  const serviceWorker=Object.assign(new EventTarget(),{controller:active?old:null,
    register:async()=>{if(registerError)throw registerError;
      if(failRegister)throw new TypeError('An unknown error occurred when fetching the script.');return registration;},
    ready:active?Promise.resolve(registration):new Promise(r=>{ready=r;})});
  for(const key of ['navigator','location','MessageChannel','setTimeout','clearTimeout']) {
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker}});
  globalThis.location={reload(){reloads++;}};
  globalThis.setTimeout=(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;};globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.MessageChannel=class{constructor(){this.port1={close(){}};this.port2={close(){},reply:m=>this.port1.onmessage?.({data:m})};}};
  setupOffline($);await tick();
  return {$,requests,timers,registration,installing,serviceWorker,get reloads(){return reloads;},
    async failed(){installing.state='redundant';registration.installing=null;installing.dispatchEvent(new Event('statechange'));await tick();},
    async recover(){registration.active=installing;registration.installing=null;installing.state='activated';serviceWorker.controller=installing;
      installing.dispatchEvent(new Event('statechange'));serviceWorker.dispatchEvent(new Event('controllerchange'));ready?.(registration);await tick();},
    async expire(){for(const [id,{fn,ms}]of [...timers]){assert.equal(ms,300000);timers.delete(id);fn();}await tick();}};
}
for(const options of [{failRegister:true},{missing:true},{redundant:true},{}])
  test(`failed first installation offers explicit non-destructive retry ${JSON.stringify(options)}`,async t=>{
    const h=await harness(t,options);if(!Object.keys(options).length)await h.failed();
    assert.equal(h.$('prepare-offline').disabled,false);assert.match(h.$('prepare-offline').textContent,/Reload.*retry/);
    assert.match(h.$('offline-state').textContent,/failed|did not finish|unavailable/);assert.equal(h.reloads,0);
    assert.deepEqual(h.requests,[]);assert.equal(h.timers.size,0);
    h.$('prepare-offline').onclick();assert.equal(h.reloads,1);
  });
for(const slow of [false,true])test(`healthy installation can finish and prepare after slow warning ${slow}`,async t=>{
  const h=await harness(t);assert.equal(h.$('prepare-offline').disabled,true);
  if(slow){await h.expire();assert.equal(h.$('prepare-offline').disabled,false);assert.match(h.$('offline-state').textContent,/keep waiting/);}
  await h.recover();assert.equal(h.$('prepare-offline').textContent,'Download offline assets');
  assert.equal(h.$('prepare-offline').disabled,false);assert.equal(h.timers.size,0);assert.deepEqual(h.requests,['OFFLINE_STATUS']);
  assert.doesNotMatch(h.$('offline-state').textContent,/failed|longer than/);
  await h.$('prepare-offline').onclick();assert.deepEqual(h.requests,['OFFLINE_STATUS','PREPARE_OFFLINE']);assert.equal(h.reloads,0);
  // A queued obsolete failure must not replace a working offline action.
  await h.failed();assert.equal(h.$('prepare-offline').textContent,'Download offline assets');
});
test('failed replacement install leaves the existing active version usable',async t=>{
 const h=await harness(t,{active:true});await h.failed();
 assert.equal(h.$('prepare-offline').textContent,'Download offline assets');assert.equal(h.$('prepare-offline').disabled,false);
 assert.doesNotMatch(h.$('offline-state').textContent,/failed/);await h.$('prepare-offline').onclick();
 assert.deepEqual(h.requests,['OFFLINE_STATUS','PREPARE_OFFLINE']);assert.equal(h.reloads,0);
});
// Chromium rejects register() with NotSupportedError while site data is blocked,
// on every reload; there localStorage fails too, so a reload loses the puzzle.
for(const [name,message] of [['NotSupportedError','The user denied permission to use Service Worker.'],['SecurityError','The operation is insecure.']])
  test(`a registration refusal that repeats on every reload (${name}) offers no reload`,async t=>{
    const h=await harness(t,{registerError:new DOMException(prefix+message,name)});
    assert.equal(h.$('prepare-offline').disabled,true);assert.equal(h.$('prepare-offline').textContent,'Download offline assets');
    assert.equal(h.$('prepare-offline').onclick,undefined);assert.equal(h.reloads,0);
    assert.match(h.$('offline-state').textContent,/^Offline caching unavailable: /);
    assert.doesNotMatch(h.$('offline-state').textContent,/reload|\.\./i);
  });
test('a failed script fetch still offers the reload, with one full stop',async t=>{
  const h=await harness(t,{registerError:new TypeError(prefix+'An unknown error occurred when fetching the script.')});
  assert.equal(h.$('prepare-offline').disabled,false);assert.match(h.$('prepare-offline').textContent,/Reload.*retry/);
  assert.doesNotMatch(h.$('offline-state').textContent,/\.\./);
  h.$('prepare-offline').onclick();assert.equal(h.reloads,1);
});
