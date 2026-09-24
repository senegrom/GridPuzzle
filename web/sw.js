/* GridPuzzle owns only caches under this service-worker scope. */
const VERSION="__BUILD_ID__";
const PREFIX=`gridpuzzle:${self.registration.scope}:`;
const META=PREFIX+`meta:${VERSION}`;
const CONTENT=PREFIX+"content-v1";
const url=path=>new URL(path,self.registration.scope).href;
const scopeURL=new URL(self.registration.scope);
const RETAINED=url(".retained-solvers.json");
const isSolver=asset=>/^solver\.[a-f0-9]{12}\.zip$/.test(asset.path);
// tesseract.js 6.0.1 loads one of the two LSTM cores per device
// (src/worker-script/browser/getCore.js): the SIMD build where
// wasm-feature-detect's simd() probe below validates, the plain build
// elsewhere. Offline storage needs only that one; where WebAssembly cannot be
// probed here, both are kept.
const SIMD_PROBE=new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
function unusedCore(){
  try{return WebAssembly.validate(SIMD_PROBE)?"tesseract-core-lstm.wasm.js":"tesseract-core-simd-lstm.wasm.js";}
  catch{return null;}
}
function offlineAssets(assets,skip=unusedCore()){
  return skip?assets.filter(asset=>!asset.path.endsWith(`/tesseract-core/${skip}`)):assets;
}
// Failures the fetch handler is allowed to explain. The body it returns is
// one of these literals, chosen by a code carried on the error; no text from
// an exception ever reaches a response, and everything else fails generically.
const SHOWN={ambiguousRuntime:"Cannot identify the outgoing runtime version. Reload this tab."};
const diagnostic=(message,code)=>code?Object.assign(Error(message),{code}):Error(message);

function validateManifest(data,build=VERSION){
  if(data?.build!==build||!Array.isArray(data.assets))throw diagnostic("Update the app before downloading offline assets.");
  const seen=new Set();
  for(const asset of data.assets){
    if(!asset||typeof asset.path!=="string"||seen.has(asset.path)||!url(asset.path).startsWith(self.registration.scope)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw diagnostic("Invalid offline asset manifest.");
    seen.add(asset.path);
  }
  return data.assets;
}
function assetKey(asset){return url(`.gridpuzzle-cache/${asset.sha256}`);}
async function digest(response){
  const bytes=await response.clone().arrayBuffer();
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
async function matchesAsset(response,asset){return !!response?.ok&&(await digest(response))===asset.sha256;}
async function contentCache(){return caches.open(CONTENT);}
function injectedCache(value){return !!value&&typeof value.match==="function"&&typeof value.put==="function";}
async function manifest({network=false,signal}={}){
  signal?.throwIfAborted();
  const cache=await caches.open(META),key=url("assets.json");
  let response=await cache.match(key);
  if(!response&&network){
    // Browsers may evict this cache under storage pressure. Restore the list
    // for this exact build rather than failing every request until a reinstall.
    response=await fetch(new Request(key,{cache:"reload",signal}));
    if(!response.ok)throw diagnostic("Could not load the offline manifest.");
    const assets=validateManifest(await response.clone().json());
    signal?.throwIfAborted();
    try{await cache.put(key,response.clone());}catch{}
    return assets;
  }
  if(!response)throw diagnostic("The offline asset list is missing. Reload online.");
  return validateManifest(await response.clone().json());
}
async function verifiedAsset(cacheOrAsset,assetOrOptions={},maybeOptions={}){
  const injected=injectedCache(cacheOrAsset);
  const cache=injected?cacheOrAsset:await contentCache();
  const asset=injected?assetOrOptions:cacheOrAsset;
  const options=injected?maybeOptions:assetOrOptions;
  const {network=true,requireStorage=true,verifyStored=false,trustStored=false,signal}=options||{};
  signal?.throwIfAborted();
  const key=assetKey(asset);
  let response=await cache.match(key);
  if(response&&verifyStored&&!trustStored&&!(await matchesAsset(response,asset))){signal?.throwIfAborted();await cache.delete(key);response=null;}
  if(response)return response;
  if(!network)return null;
  response=await fetch(new Request(url(asset.path),{cache:"reload",signal}));
  if(!response.ok)throw diagnostic(`Could not download ${asset.path}. Stay online and retry.`);
  if(!(await matchesAsset(response,asset)))throw diagnostic(`Asset changed during download: ${asset.path}. Update the app and retry.`);
  signal?.throwIfAborted();
  try{await cache.put(key,response.clone());}catch(error){if(requireStorage)throw error;}
  return response;
}
async function offlineReadyFast(cacheOrAssets,maybeAssets){
  const injected=injectedCache(cacheOrAssets),cache=injected?cacheOrAssets:await contentCache(),assets=injected?maybeAssets:cacheOrAssets;
  for(const asset of assets)if(!(await cache.match(assetKey(asset))))return false;
  return true;
}
async function offlineReadyVerified(cacheOrAssets,maybeAssets){
  const injected=injectedCache(cacheOrAssets),cache=injected?cacheOrAssets:await contentCache(),assets=injected?maybeAssets:cacheOrAssets;
  for(const asset of assets)if(!(await verifiedAsset(cache,asset,{network:false,verifyStored:true})))return false;
  return true;
}
function routeAsset(request,target){
  const rootNavigation=request.mode==="navigate"&&target.origin===scopeURL.origin&&target.pathname===scopeURL.pathname;
  return rootNavigation?url("index.html"):target.href;
}
async function pruneContent(assets){
  const keep=new Set(assets.map(assetKey)),cache=await contentCache();
  for(const request of await cache.keys())if(!keep.has(request.url))await cache.delete(request);
}
async function retainedSolvers(cache){
  try{
    const response=await (cache||await caches.open(META)).match(RETAINED);
    const assets=response?await response.json():[];
    validateManifest({build:VERSION,assets});
    return assets.filter(asset=>isSolver(asset)&&Array.isArray(asset.clients)&&asset.clients.every(id=>typeof id==="string"));
  }catch{return [];}
}
async function buildAssets(build){
  const name=PREFIX+`meta:${build}`;
  if(!(await caches.keys()).includes(name))return [];
  try{
    const response=await (await caches.open(name)).match(url("assets.json"));
    return response?validateManifest(await response.json(),build):[];
  }catch{return [];}
}
function assetBuild(key){
  const path=key.slice(self.registration.scope.length);
  return path.match(/^(?:solver\.|solver-worker\.)([a-f0-9]{12})\.(?:zip|js)$/)?.[1]
    ||path.match(/^vendor\/([a-f0-9]{12})\//)?.[1];
}
async function historicalAsset(key,clientId){
  let build=assetBuild(key);
  if(!build&&clientId){
    // Upgrade bridge for already-running, unversioned workers and old tabs'
    // lazy imports. New runtime URLs carry their build and need no client ID.
    const owner=(await retainedSolvers()).find(asset=>asset.clients.includes(clientId));
    if(owner)build=assetBuild(url(owner.path));
  }
  return build?(await buildAssets(build)).find(asset=>url(asset.path)===key):null;
}
async function legacyAsset(key){
  // A newly controlling worker can receive fetches before its activate event
  // starts, so activationReady and the new retention index may not exist yet.
  // Old manifests already exist. Use only a hash-unambiguous legacy match;
  // immutable URLs and known owners take the more precise routes above.
  if(!key.startsWith(url("vendor/"))||assetBuild(key))return null;
  let match=null;
  for(const name of await caches.keys()){
    if(!name.startsWith(PREFIX+"meta:")||name===META)continue;
    const asset=(await buildAssets(name.slice((PREFIX+"meta:").length))).find(a=>url(a.path)===key);
    if(!asset)continue;
    if(match&&match.sha256!==asset.sha256)throw diagnostic(SHOWN.ambiguousRuntime,"ambiguousRuntime");
    match=asset;
  }
  return match;
}
async function preserveActiveSolvers(){
  // Preserve whole outgoing builds, not just their solver archives. A worker
  // can still need its Python module, WASM, stdlib and lock file after activation.
  // Include the owning tabs: worker enumeration varies by engine and a worker
  // still loading its script may not be enumerable yet. Later tabs/workers
  // must not prolong retention of unrelated old archives.
  const clients=await self.clients.matchAll({type:"all",includeUncontrolled:true});
  const alive=new Set(clients.filter(client=>client.url.startsWith(self.registration.scope)&&(
    client.type==="window"||client.type==="worker"||client.type==="sharedworker"
    ||/\/solver-worker(?:\.[a-f0-9]{12})?\.js$/.test(new URL(client.url).pathname)
  )).map(client=>client.id));
  const previous=(await caches.keys()).filter(key=>key.startsWith(PREFIX+"meta:")&&key!==META);
  const keep=new Map();
  // Preserve owners recorded by earlier updates before adding the outgoing
  // build, so another update cannot reset an old archive's client lifetime.
  for(const key of previous){
    const meta=await caches.open(key);
    for(const asset of await retainedSolvers(meta)){
      const owners=asset.clients.filter(id=>alive.has(id));
      keep.set(asset.path,{...asset,clients:owners});
    }
  }
  for(const key of previous){
    const meta=await caches.open(key),response=await meta.match(url("assets.json"));
    if(!response)continue;
    try{
      const assets=validateManifest(await response.json(),key.slice((PREFIX+"meta:").length));
      // A tab that already owns an older retained build never ran this one:
      // recording it again would keep every intermediate build alive for as
      // long as that single tab stays open.
      const owned=new Set([...keep.values()].flatMap(asset=>asset.clients));
      for(const asset of assets)if(isSolver(asset)&&!keep.has(asset.path))keep.set(asset.path,{...asset,clients:[...alive].filter(id=>!owned.has(id))});
    }catch{/* Damaged old metadata must not prevent a verified update. */}
  }
  const retained=[...keep.values()].filter(asset=>asset.clients.length);
  await (await caches.open(META)).put(RETAINED,new Response(JSON.stringify(retained)));
  // An existing worker may still route through its previous controller.
  // Keep that controller's manifest while its archive has live owners too.
  const retainedPaths=new Set(retained.map(asset=>asset.path));
  for(const key of previous)if(!retainedPaths.has(`solver.${key.slice((PREFIX+"meta:").length)}.zip`))await caches.delete(key);
  const assets=[];
  for(const asset of retained)assets.push(...await buildAssets(assetBuild(url(asset.path))));
  return assets;
}

self.addEventListener("install",event=>event.waitUntil((async()=>{
  const response=await fetch(new Request(url("assets.json"),{cache:"reload"}));
  if(!response.ok)throw diagnostic("Could not load the offline manifest.");
  const assets=validateManifest(await response.clone().json()),meta=await caches.open(META),cache=await contentCache();
  await meta.put(url("assets.json"),response);
  // Install the complete Python runtime before this build can control tabs.
  // It may later be needed by a lazy worker after the origin publishes an
  // incompatible update. Content addressing reuses identical bytes on updates.
  const shell=assets.filter(a=>/^vendor\/[a-f0-9]{12}\/pyodide\//.test(a.path)||a.path.startsWith("icons/")||(!a.path.includes("/")&&!a.path.endsWith(".zip"))||(a.path.startsWith("solver.")&&a.path.endsWith(".zip")));
  for(const asset of shell)await verifiedAsset(cache,asset,{verifyStored:true});
})()));
let activationReady=Promise.resolve();
self.addEventListener("activate",event=>event.waitUntil(activationReady=(async()=>{
  try{
    const assets=await manifest(),retained=await preserveActiveSolvers();
    await pruneContent([...assets,...retained]);
  }catch{
    // Activation always completes, so a retention or pruning failure (an
    // evicted manifest, a quota error while writing the retention index)
    // must not leave this worker unable to route requests. Stale caches
    // are pruned by the next update; the fetch path restores the manifest.
  }
  await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
  const request=event.request,target=new URL(request.url);
  if(request.method!=="GET"||target.origin!==self.location.origin||!request.url.startsWith(self.registration.scope)||request.headers.has("range"))return;
  event.respondWith((async()=>{
    // A rejected activation must fail open: the routing below already falls
    // back to the network whenever no verified asset can be identified.
    await activationReady.catch(()=>{});
    let assets;
    // Without a usable asset list (evicted, or this worker outlived its build)
    // the page must still load from the network instead of failing every request.
    try{assets=await manifest({network:true});}catch{return fetch(request);}
    if(target.href===url("assets.json"))return (await (await caches.open(META)).match(url("assets.json")))||fetch(request);
    try{
      const key=routeAsset(request,target),current=assets.find(a=>url(a.path)===key);
      let historical=request.mode==="navigate"?null:await historicalAsset(key,event.clientId);
      if(!historical&&!current)historical=await legacyAsset(key);
      const asset=historical||current;
      if(!asset)return fetch(request);
      // An outgoing legacy URL may no longer exist on the origin. Identical
      // bytes under the current immutable URL are a safe cache-miss fallback;
      // never substitute a dependency merely because its filename matches.
      const equivalent=historical&&assets.find(current=>current.sha256===asset.sha256);
      const response=await verifiedAsset(equivalent||asset,{requireStorage:false,trustStored:true});
      // A digest cache may reuse a module downloaded under another build's URL.
      // Strip that old response URL so relative imports resolve against THIS
      // request's versioned directory, not the cache entry's original location.
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch(error){
      // Fail closed, but legibly: a rejected respondWith reaches the page only
      // as "Failed to fetch". A 502 keeps the diagnostic and is never cached.
      const code=error?.code,body=Object.hasOwn(SHOWN,code??"")?SHOWN[code]:"Request failed.";
      console.warn(`GridPuzzle service worker: ${error?.message||String(error)} (${target.href})`);
      return new Response(body,{status:502,statusText:"Bad Gateway",headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
    }
  })());
});
// One build-scoped job, shared by tabs. A page timing out never cancels another
// tab's healthy download. Each phase has its own worker-owned deadline covering
// fetch, body verification and storage, and retries can join current progress.
let offlineJob = null, offlineSerial = 0;
const OFFLINE_PHASE_MS = 240000;
function offlinePhase(job, work) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = diagnostic("Offline download stalled. Stay online and retry.");
      job.controller.abort(error); reject(error);
    }, OFFLINE_PHASE_MS);
  });
  return Promise.race([Promise.resolve().then(work), deadline]).finally(() => clearTimeout(timer));
}
function offlineNotify(job, message) {
  job.last = { ...message, jobId: job.id };
  for (const [key, port] of job.ports) {
    try { port.postMessage(job.last); } catch { job.ports.delete(key); }
    if (message.done || message.error) { try { port.close?.(); } catch {} }
  }
}
function prepareOffline(port, clientId) {
  let job = offlineJob;
  if (!job) {
    job = { id: ++offlineSerial, controller: new AbortController(), ports: new Map(),
      last: { progress: 0, total: 1 }, promise: null };
    offlineJob = job;
    job.promise = Promise.resolve().then(async () => {
      try {
        const signal = job.controller.signal;
        const assets = offlineAssets(await offlinePhase(job, () => manifest({ network: true, signal })));
        const cache = await offlinePhase(job, () => contentCache());
        for (let i = 0; i < assets.length; i++) {
          await offlinePhase(job, () => verifiedAsset(cache, assets[i], { verifyStored: true, requireStorage: true, signal }));
          signal.throwIfAborted();
          offlineNotify(job, { progress: i + 1, total: assets.length });
        }
        // Read back stored bytes rather than certifying an attempted cache put.
        for (const asset of assets) {
          const stored = await offlinePhase(job, () => verifiedAsset(cache, asset, { network: false, verifyStored: true, signal }));
          if (!stored) throw diagnostic("Offline verification failed. Retry while online.");
        }
        signal.throwIfAborted();
        offlineNotify(job, { done: true, ready: true });
      } catch (error) {
        job.controller.abort(error);
        offlineNotify(job, { error: error?.message || String(error) });
      } finally {
        if (offlineJob === job) offlineJob = null;
        job.ports.clear();
      }
    });
  }
  // A new request from the same tab replaces only its obsolete message port.
  const key = clientId || port;
  if (!job.ports.has(key) && job.ports.size >= 16) {
    port.postMessage({ error: "Too many offline download listeners. Retry shortly." });
    port.close?.(); return Promise.resolve();
  }
  try { job.ports.get(key)?.close?.(); } catch {}
  job.ports.set(key, port);
  try { port.postMessage({ ...job.last, jobId: job.id }); } catch { job.ports.delete(key); }
  return job.promise;
}
self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE") { self.skipWaiting(); return; }
  const port = event.ports[0]; if (!port) return;
  if (event.data?.type === "PREPARE_OFFLINE") {
    event.waitUntil(prepareOffline(port, event.source?.id)); return;
  }
  event.waitUntil((async () => {
    try {
      if (event.data?.type !== "OFFLINE_STATUS") throw diagnostic("Unknown offline task");
      port.postMessage({ done: true, ready: await offlineReadyFast(offlineAssets(await manifest())) });
    } catch (error) { port.postMessage({ error: error?.message || String(error) }); }
    finally { port.close?.(); }
  })());
});
