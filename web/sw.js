/* GridPuzzle owns only caches under this service-worker scope. */
const VERSION="__BUILD_ID__";
const PREFIX=`gridpuzzle:${self.registration.scope}:`;
const META=PREFIX+`meta:${VERSION}`;
const CONTENT=PREFIX+"content-v1";
const url=path=>new URL(path,self.registration.scope).href;
const scopeURL=new URL(self.registration.scope);

function validateManifest(data){
  if(data?.build!==VERSION||!Array.isArray(data.assets))throw Error("Update the app before downloading offline assets.");
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

self.addEventListener("install",event=>event.waitUntil((async()=>{
  const response=await fetch(new Request(url("assets.json"),{cache:"reload"}));
  if(!response.ok)throw Error("Could not load the offline manifest.");
  const assets=validateManifest(await response.clone().json()),meta=await caches.open(META),cache=await contentCache();
  await meta.put(url("assets.json"),response);
  const shell=assets.filter(a=>a.path.startsWith("icons/")||(!a.path.includes("/")&&!a.path.endsWith(".zip"))||(a.path.startsWith("solver.")&&a.path.endsWith(".zip")));
  for(const asset of shell)await verifiedAsset(cache,asset,{verifyStored:true});
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  const assets=await manifest();
  for(const key of await caches.keys())if(key.startsWith(PREFIX+"meta:")&&key!==META)await caches.delete(key);
  await pruneContent(assets);
  await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
  const request=event.request,target=new URL(request.url);
  if(request.method!=="GET"||target.origin!==self.location.origin||!request.url.startsWith(self.registration.scope)||request.headers.has("range"))return;
  event.respondWith((async()=>{
    let assets;
    // Without a usable asset list (evicted, or this worker outlived its build)
    // the page must still load from the network instead of failing every request.
    try{assets=await manifest({network:true});}catch{return fetch(request);}
    if(target.href===url("assets.json"))return (await (await caches.open(META)).match(url("assets.json")))||fetch(request);
    const key=routeAsset(request,target),asset=assets.find(a=>url(a.path)===key);
    if(!asset)return fetch(request);
    return verifiedAsset(asset,{requireStorage:false,trustStored:true});
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
