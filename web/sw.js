/* GridPuzzle owns only caches under this service-worker scope. */
const VERSION="__BUILD_ID__";
const PREFIX=`gridpuzzle:${self.registration.scope}:`;
const META=PREFIX+`meta:${VERSION}`;
const CONTENT=PREFIX+"content-v1";
const url=path=>new URL(path,self.registration.scope).href;
const scopeURL=new URL(self.registration.scope);
const RETAINED=url(".retained-solvers.json");
const isSolver=asset=>/^solver\.[a-f0-9]{12}\.zip$/.test(asset.path);

function validateManifest(data,build=VERSION){
  if(data?.build!==build||!Array.isArray(data.assets))throw Error("Update the app before downloading offline assets.");
  const seen=new Set();
  for(const asset of data.assets){
    if(!asset||typeof asset.path!=="string"||seen.has(asset.path)||!url(asset.path).startsWith(self.registration.scope)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error("Invalid offline asset manifest.");
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
async function manifest({network=false}={}){
  const cache=await caches.open(META),key=url("assets.json");
  let response=await cache.match(key);
  if(!response&&network){
    // Browsers may evict this cache under storage pressure. Restore the list
    // for this exact build rather than failing every request until a reinstall.
    response=await fetch(new Request(key,{cache:"reload"}));
    if(!response.ok)throw Error("Could not load the offline manifest.");
    const assets=validateManifest(await response.clone().json());
    try{await cache.put(key,response.clone());}catch{}
    return assets;
  }
  if(!response)throw Error("The offline asset list is missing. Reload online.");
  return validateManifest(await response.clone().json());
}
async function verifiedAsset(cacheOrAsset,assetOrOptions={},maybeOptions={}){
  const injected=injectedCache(cacheOrAsset);
  const cache=injected?cacheOrAsset:await contentCache();
  const asset=injected?assetOrOptions:cacheOrAsset;
  const options=injected?maybeOptions:assetOrOptions;
  const {network=true,requireStorage=true,verifyStored=false,trustStored=false}=options||{};
  const key=assetKey(asset);
  let response=await cache.match(key);
  if(response&&verifyStored&&!trustStored&&!(await matchesAsset(response,asset))){await cache.delete(key);response=null;}
  if(response)return response;
  if(!network)return null;
  response=await fetch(new Request(url(asset.path),{cache:"reload"}));
  if(!response.ok)throw Error(`Could not download ${asset.path}. Stay online and retry.`);
  if(!(await matchesAsset(response,asset)))throw Error(`Asset changed during download: ${asset.path}. Update the app and retry.`);
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
    if(match&&match.sha256!==asset.sha256)throw Error("Cannot identify the outgoing runtime version. Reload this tab.");
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
      for(const asset of assets)if(isSolver(asset)&&!keep.has(asset.path))keep.set(asset.path,{...asset,clients:[...alive]});
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
  if(!response.ok)throw Error("Could not load the offline manifest.");
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
  const assets=await manifest(),retained=await preserveActiveSolvers();
  await pruneContent([...assets,...retained]);
  await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
  const request=event.request,target=new URL(request.url);
  if(request.method!=="GET"||target.origin!==self.location.origin||!request.url.startsWith(self.registration.scope)||request.headers.has("range"))return;
  event.respondWith((async()=>{
    await activationReady;
    let assets;
    // Without a usable asset list (evicted, or this worker outlived its build)
    // the page must still load from the network instead of failing every request.
    try{assets=await manifest({network:true});}catch{return fetch(request);}
    if(target.href===url("assets.json"))return (await (await caches.open(META)).match(url("assets.json")))||fetch(request);
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
  })());
});
let downloading=false;
self.addEventListener("message",event=>{
  if(event.data?.type==="ACTIVATE"){self.skipWaiting();return;}
  const port=event.ports[0];if(!port)return;
  event.waitUntil((async()=>{
    try{
      const assets=await manifest({network:event.data?.type==="PREPARE_OFFLINE"});
      if(event.data?.type==="OFFLINE_STATUS"){
        port.postMessage({done:true,ready:await offlineReadyFast(assets)});return;
      }
      if(event.data?.type!=="PREPARE_OFFLINE")throw Error("Unknown offline task");
      if(downloading)throw Error("Offline preparation is already running in another tab.");
      downloading=true;
      try{
        const cache=await contentCache();
        for(let i=0;i<assets.length;i++){
          await verifiedAsset(cache,assets[i],{verifyStored:true,requireStorage:true});
          port.postMessage({progress:i+1,total:assets.length});
        }
        if(!(await offlineReadyVerified(cache,assets)))throw Error("Offline verification failed. Retry while online.");
        port.postMessage({done:true,ready:true});
      }finally{downloading=false;}
    }catch(error){port.postMessage({error:error?.message||String(error)});}
  })());
});
