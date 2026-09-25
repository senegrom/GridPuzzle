import test from "node:test";
import assert from "node:assert/strict";
import { captureTransaction, saveCapture, loadCapture, setupCaptureGallery } from "../capture-store.js";
import { memoryStore } from "./capture-memory.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
function idb({ failure = null }={}) {
  let closes=0,abort=0,request=null,transaction=null;
  const db={objectStoreNames:{contains:()=>true},close(){closes++;},transaction(){
    transaction={objectStore(){return {get(){request={};queueMicrotask(()=>{request.result="saved";request.onsuccess?.();if(failure){transaction.error=Error(failure);transaction.onabort?.();}else transaction.oncomplete?.();});return request;}};},abort(){abort++;transaction.onabort?.();}};
    return transaction;
  }};
  const open={result:db};
  const indexedDB={open(){queueMicrotask(()=>open.onsuccess?.());return open;}};
  return {indexedDB,open,get closes(){return closes;},get aborted(){return abort;}};
}
test("picture reads resolve only after the local transaction commits",async()=>{
 const h=idb();assert.equal(await captureTransaction("readonly",s=>s.get("latest"),h),"saved");assert.equal(h.closes,1);
});
test("request success followed by transaction failure is not reported as saved",async()=>{
 const h=idb({failure:"quota exceeded"});await assert.rejects(captureTransaction("readwrite",s=>s.get("latest"),h),/quota/);assert.equal(h.closes,1);
});
test("synchronous storage failures settle without a dangling database",async()=>{
 const h=idb();await assert.rejects(captureTransaction("readwrite",()=>{throw Error("disk failed");},h),/disk failed/);assert.equal(h.closes,1);
});
test("a late database opening after a timeout is closed and never performs the write",async()=>{
 let open,closed=0,writes=0;
 const pending=captureTransaction("readwrite",()=>{writes++;},{indexedDB:{open(){open={};return open;}},timeout:5});
 await assert.rejects(pending,/timed out/);open.result={close(){closed++;}};open.onsuccess();await tick();assert.equal(writes,0);assert.equal(closed,1);
});
test("unavailable or blocked storage has an explicit download fallback",async()=>{
 await assert.rejects(captureTransaction("readonly",()=>{}, {indexedDB:null}),/Download/);
 const h=idb();h.indexedDB.open=()=>{queueMicrotask(()=>h.open.onblocked());return h.open;};
 await assert.rejects(captureTransaction("readonly",()=>{},h),/Download/);
});
test("invalid or oversized captures are rejected before opening storage",async()=>{
 for(const blob of [null,new Blob([],{type:"image/png"}),new Blob(["jpeg"],{type:"image/jpeg"}),new Blob([new Uint8Array(21*1024*1024)],{type:"image/png"})])
   await assert.rejects(saveCapture(blob),/empty|large/);
});

function deferred() { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
function gallery(backend){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:"",removeAttribute(){}});return nodes.get(id);};
 return {$,save:setupCaptureGallery($,backend)};
}
const picture=label=>({toBlob(done){done(new Blob([label],{type:"image/png"}));}});
test("a delayed startup capture cannot replace a newer shutter picture",async()=>{
 const old=deferred(),h=gallery({load:()=>old.promise,save:async()=>{},remove:async()=>{}});
 assert.equal(await h.save(picture("new"),10),true);const src=h.$("saved-capture-image").src;
 old.resolve({blob:new Blob(["old"],{type:"image/png"}),createdAt:0});await tick();
 assert.equal(h.$("saved-capture-image").src,src);
});
test("storage failure retains the picture for export without claiming successful saving",async()=>{
 const h=gallery({load:async()=>null,save:async()=>{throw Error("quota exceeded");},remove:async()=>{}});
 assert.equal(await h.save(picture("new"),10),false);assert.equal(h.$("saved-capture").hidden,false);
 assert.match(h.$("capture-storage-status").textContent,/quota exceeded.*download/);
});
test("deletion supersedes an in-flight save acknowledgement",async()=>{
 const written=deferred(),h=gallery({load:async()=>null,save:()=>written.promise,remove:async()=>{}});
 const saving=h.save(picture("new"),10);await tick();await h.$("delete-capture").onclick();
 written.resolve();assert.equal(await saving,false);assert.equal(h.$("saved-capture").hidden,true);
 assert.match(h.$("capture-storage-status").textContent,/deleted/);
});

test("PNG byte storage round-trips exact pixels without requiring IndexedDB Blob support",async()=>{
 const h=memoryStore(),bytes=new Uint8Array([137,80,78,71,0,1,254,255]),blob=new Blob([bytes],{type:"image/png"});
 await saveCapture(blob,42,h);
 assert.equal(h.record.type,"image/png");assert.equal(h.record.createdAt,42);
 const loaded=await loadCapture(h);assert.equal(loaded.blob.type,"image/png");
 assert.deepEqual(new Uint8Array(await loaded.blob.arrayBuffer()),bytes);assert.equal(loaded.createdAt,42);
});
test("invalid capture metadata and encoded data never create a gallery image",async()=>{
 for(const record of [null,{}, {type:"image/jpeg",bytes:new ArrayBuffer(1),createdAt:1},
 {type:"image/png",bytes:"not bytes",createdAt:1},{type:"image/png",bytes:new ArrayBuffer(0),createdAt:1},
 {type:"image/png",bytes:new ArrayBuffer(21*1024*1024),createdAt:1}])
  assert.equal(await loadCapture(memoryStore(record)),null);
 const h=memoryStore();await assert.rejects(saveCapture(new Blob(["png"],{type:"image/png"}),Infinity,h),/timestamp/);assert.equal(h.transactions,0);
});
test("PNG conversion runs outside transactions and before the final picture write",async()=>{
 const h=memoryStore(),blob=new Blob(["png"],{type:"image/png"}),conversion=deferred();
 blob.arrayBuffer=()=>conversion.promise;const pending=saveCapture(blob,42,h);await tick();
 assert.equal(h.transactions,1,"only the short ownership reservation has committed");assert.equal(h.writes,0);
 conversion.resolve(new TextEncoder().encode("png").buffer);await pending;assert.equal(h.transactions,2);assert.equal(h.writes,1);
});
test("a follow-up request callback failure aborts the read-modify-write transaction",async()=>{
 const h=memoryStore({createdAt:1});
 await assert.rejects(captureTransaction("readwrite",store=>{const request=store.get("latest");request.onsuccess=()=>{store.delete("latest");throw Error("superseded callback");};return request;},h),/superseded callback/);
 assert.equal(h.record.createdAt,1);
});
test("missing cross-context coordination never downgrades to an unsafe write",async()=>{
 const h=memoryStore();await assert.rejects(saveCapture(new Blob(["png"],{type:"image/png"}),42,{...h,locks:null}),/Download/);
 assert.equal(h.transactions,0);
});
test("a timed-out lock request cannot later save a picture",async()=>{
 const h=memoryStore();let cancelled=false;
 const locks={request(_name,{signal}){return new Promise((resolve,reject)=>signal.addEventListener("abort",()=>{cancelled=true;reject(signal.reason);},{once:true}));}};
 await assert.rejects(saveCapture(new Blob(["png"],{type:"image/png"}),42,{...h,locks,lockTimeout:5}),/timed out/);
 assert.equal(cancelled,true);assert.equal(h.transactions,0);
});
