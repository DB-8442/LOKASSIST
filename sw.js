const VERSION="1.1.0";
const CACHE_NAME=`lokassistent-${VERSION}`;
const ASSETS=["./","./index.html","./manifest.webmanifest","./sw.js","./lokassistent-logo.png","./apple-touch-icon-180.png","./lokassistent-icon-512.png"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith("lokassistent-")&&k!==CACHE_NAME).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 if(e.request.mode==="navigate"||new URL(e.request.url).pathname.endsWith("/index.html")){
  e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{const c=r.clone();caches.open(CACHE_NAME).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))));
 }else{
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(n=>{const c=n.clone();caches.open(CACHE_NAME).then(x=>x.put(e.request,c));return n})));
 }
});
