/* Scope-specific caches never touch other senegrom.github.io apps. */
const VERSION='__BUILD_ID__',PREFIX=`gridpuzzle:${self.registration.scope}:`,CACHE=PREFIX+VERSION;
const SHELL=['./','index.html','style.css','app.js','model.js','scanner.js','geometry.js','geometry-worker.js','solver-worker.js','manifest.webmanifest','favicon.svg','icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','assets.json'];
const url=path=>new URL(path,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(SHELL.map(path=>new Request(url(path),{cache:'reload'})));})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const request=event.request,target=new URL(request.url);
  if(request.method!=='GET'||!request.url.startsWith(self.registration.scope)||target.origin!==self.location.origin)return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE),hit=await cache.match(request);if(hit)return hit;const response=await fetch(request);if(response.ok&&!request.headers.has('range'))await cache.put(request,response.clone());return response;})());
});
async function manifest(cache){const response=await cache.match(url('assets.json'));if(!response)throw Error('The offline asset list is missing. Reload online.');const data=await response.json();if(data.build!==VERSION)throw Error('An app update is available. Reload before downloading offline assets.');return data.assets;}
let downloading=false;
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE'){self.skipWaiting();return;}
  const port=event.ports[0];if(!port)return;
  event.waitUntil((async()=>{
    try{
      const cache=await caches.open(CACHE),assets=await manifest(cache);
      if(event.data?.type==='OFFLINE_STATUS'){
        const matches=await Promise.all(assets.map(a=>cache.match(url(a.path))));port.postMessage({done:true,ready:matches.every(Boolean)});return;
      }
      if(event.data?.type!=='PREPARE_OFFLINE')throw Error('Unknown offline task');
      if(downloading)throw Error('Offline preparation is already running in another tab.');
      downloading=true;
      try{
        for(let i=0;i<assets.length;i++){
          const asset=assets[i],key=url(asset.path);let response=await cache.match(key);
          if(!response)response=await fetch(new Request(key,{cache:'reload'}));
          if(!response.ok)throw Error(`Could not download ${asset.path}. Stay online and retry.`);
          const bytes=await response.clone().arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
          if(digest!==asset.sha256)throw Error(`Asset changed during download: ${asset.path}. Update the app and retry.`);
          await cache.put(key,response);port.postMessage({progress:i+1,total:assets.length});
        }
        port.postMessage({done:true,ready:true});
      }finally{downloading=false;}
    }catch(error){port.postMessage({error:error.message});}
  })());
});
