/* Only this app's scoped, versioned caches are ever read or removed. */
const VERSION="__BUILD_ID__";
const PREFIX=`gridpuzzle:${self.registration.scope}:`;
const CACHE=PREFIX+VERSION;
const url=path=>new URL(path,self.registration.scope).href;
const scopeURL=new URL(self.registration.scope);

function validateManifest(data){
  if(data.build!==VERSION||!Array.isArray(data.assets))throw Error("Update the app before downloading offline assets.");
  for(const asset of data.assets){
    if(typeof asset.path!=="string"||!url(asset.path).startsWith(self.registration.scope)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error("Invalid offline asset manifest.");
  }
  return data.assets;
}
async function manifest(cache){
  const response=await cache.match(url("assets.json"));
  if(!response)throw Error("The offline asset list is missing. Reload online.");
  return validateManifest(await response.json());
}
async function matchesAsset(response,asset){
  if(!response?.ok)return false;
  const digest=await crypto.subtle.digest("SHA-256",await response.clone().arrayBuffer());
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("")===asset.sha256;
}
async function verifiedAsset(cache,asset,{network=true,requireStorage=true,trustStored=false}={}){
  const key=url(asset.path);
  let response=await cache.match(key);
  // CACHE is immutable for one build and every write below is verified first.
  // Ordinary navigation therefore avoids re-hashing multi-megabyte WASM files.
  // Offline readiness still performs a fresh digest pass over every asset.
  if(response&&trustStored)return response;
  if(response&&await matchesAsset(response,asset))return response;
  if(response)await cache.delete(key);
  if(!network)return null;
  response=await fetch(new Request(key,{cache:"reload"}));
  if(!response.ok)throw Error(`Could not download ${asset.path}. Stay online and retry.`);
  if(!(await matchesAsset(response,asset)))throw Error(`Asset changed during download: ${asset.path}. Update the app and retry.`);
  try{await cache.put(key,response.clone());}catch(error){if(requireStorage)throw error;}
  return response;
}
async function offlineReady(cache,assets){
  for(const asset of assets)if(!(await verifiedAsset(cache,asset,{network:false})))return false;
  return true;
}
async function reusePrevious(cache,assets){
  const previous=(await caches.keys()).filter(key=>key.startsWith(PREFIX)&&key!==CACHE);
  if(!previous.length)return;
  for(const asset of assets){
    const key=url(asset.path);
    if(await cache.match(key))continue;
    for(const name of previous){
      const old=await caches.open(name),candidate=await old.match(key);
      if(candidate&&await matchesAsset(candidate,asset)){
        try{await cache.put(key,candidate.clone());}catch{return;}
        break;
      }
    }
  }
}
function routeAsset(request,target){
  const rootNavigation=request.mode==="navigate"&&target.origin===scopeURL.origin&&target.pathname===scopeURL.pathname;
  return rootNavigation?url("index.html"):target.href;
}
self.addEventListener("install",event=>event.waitUntil((async()=>{
  const response=await fetch(new Request(url("assets.json"),{cache:"reload"}));
  if(!response.ok)throw Error("Could not load the offline manifest.");
  const assets=validateManifest(await response.clone().json()),cache=await caches.open(CACHE);
  await cache.put(url("assets.json"),response);
  // Reuse unchanged verified Pyodide/OCR assets from the previous build before
  // that cache is retired. Cache the new solver archive too, so an offline-ready
  // installation remains solver-ready after an app update.
  await reusePrevious(cache,assets);
  const shell=assets.filter(a=>a.path.startsWith("icons/")||(!a.path.includes("/")&&!a.path.endsWith(".zip"))||(a.path.startsWith("solver.")&&a.path.endsWith(".zip")));
  for(const asset of shell)await verifiedAsset(cache,asset,{trustStored:true});
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
  const request=event.request,target=new URL(request.url);
  if(request.method!=="GET"||!request.url.startsWith(self.registration.scope)||target.origin!==self.location.origin||request.headers.has("range"))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(target.href===url("assets.json")){await manifest(cache);return cache.match(url("assets.json"));}
    const assets=await manifest(cache),key=routeAsset(request,target),asset=assets.find(a=>url(a.path)===key);
    if(!asset)return fetch(request);
    return verifiedAsset(cache,asset,{requireStorage:false,trustStored:true});
  })());
});
let downloading=false;
self.addEventListener("message",event=>{
  if(event.data?.type==="ACTIVATE"){self.skipWaiting();return;}
  const port=event.ports[0];if(!port)return;
  event.waitUntil((async()=>{
    try{
      const cache=await caches.open(CACHE),assets=await manifest(cache);
      if(event.data?.type==="OFFLINE_STATUS"){
        port.postMessage({done:true,ready:await offlineReady(cache,assets)});return;
      }
      if(event.data?.type!=="PREPARE_OFFLINE")throw Error("Unknown offline task");
      if(downloading)throw Error("Offline preparation is already running in another tab.");
      downloading=true;
      try{
        for(let i=0;i<assets.length;i++){
          await verifiedAsset(cache,assets[i]);
          port.postMessage({progress:i+1,total:assets.length});
        }
        port.postMessage({done:true,ready:true});
      }finally{downloading=false;}
    }catch(error){port.postMessage({error:error.message});}
  })());
});
