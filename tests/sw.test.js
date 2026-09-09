const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const {APP_VERSION}=require('../storage.js');
const source=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

function worker(fetchImpl=async()=>{throw new Error('offline')}){
 const handlers={},deleted=[],added=[],puts=[],matches=[];
 const cached={offline:true};
 const caches={open:async()=>({addAll:async assets=>added.push(...assets),put:async(...args)=>puts.push(args)}),keys:async()=>['lokassistent-1.2.0','lokassistent-'+APP_VERSION,'lokassist-dev-1.3.0','unrelated-cache'],delete:async key=>deleted.push(key),match:async request=>{matches.push(request);return request==='./index.html'?cached:undefined}};
 const context=vm.createContext({self:{addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting(){},clients:{claim:async()=>{}}},caches,URL,fetch:fetchImpl});
 vm.runInContext(source,context);
 return {handlers,deleted,added,puts,matches,context,cached,caches};
}
test('worker precaches the versioned storage script and local PWA assets',async()=>{
 const w=worker();let done;w.handlers.install({waitUntil:promise=>done=promise});await done;
 assert.ok(w.added.includes('./storage.js?v='+APP_VERSION));assert.ok(w.added.includes('./index.html'));
 for(const asset of w.added.filter(asset=>!asset.endsWith('.png')))assert.ok(fs.existsSync(path.join(__dirname,'..',asset.split('?')[0].replace(/^\.\//,''))),asset);
 for(const asset of ['./lokassistent-logo.png','./apple-touch-icon-180.png','./lokassistent-icon-512.png'])assert.ok(w.added.includes(asset),asset);
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.webmanifest'),'utf8'));assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');
});
test('worker activation deletes only older Stable caches',async()=>{
 const w=worker();let done;w.handlers.activate({waitUntil:promise=>done=promise});await done;assert.deepEqual(w.deleted,['lokassistent-1.2.0']);
});
test('offline navigation falls back to the cached app and versioned storage is served from cache',async()=>{
 const w=worker();let response;
 w.handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://db-8442.github.io/LOKASSIST/'},respondWith:promise=>response=promise});assert.equal(await response,w.cached);
 const script={body:'storage'};w.caches.match=async request=>request.url.endsWith('storage.js?v='+APP_VERSION)?script:undefined;
 w.handlers.fetch({request:{method:'GET',mode:'cors',url:'https://db-8442.github.io/LOKASSIST/storage.js?v='+APP_VERSION},respondWith:promise=>response=promise});assert.equal(await response,script);
});
test('MobiData API requests are network-only and never touch Cache Storage',async()=>{
 const network={ok:true,status:200,clone(){return this}};let calls=0;const w=worker(async()=>{calls++;return network});let response;
 const request={method:'GET',mode:'cors',url:'https://api.mobidata-bw.de/gtfs/trips?limit=1'};
 w.handlers.fetch({request,respondWith:promise=>response=promise});assert.equal(await response,network);await Promise.resolve();
 assert.equal(calls,1);assert.deepEqual(w.matches,[]);assert.deepEqual(w.puts,[]);
});
test('successful local assets remain cacheable',async()=>{
 const network={ok:true,status:200,clone(){return {copy:true}}};const w=worker(async()=>network);let response;
 const request={method:'GET',mode:'cors',url:'https://db-8442.github.io/LOKASSIST/app.js'};w.handlers.fetch({request,respondWith:promise=>response=promise});assert.equal(await response,network);await Promise.resolve();
 assert.equal(w.puts.length,1);assert.equal(w.puts[0][0],request);
});
test('unsuccessful responses are never cached',async()=>{
 const network={ok:false,status:503,clone(){return {copy:true}}};const w=worker(async()=>network);let response;
 const request={method:'GET',mode:'cors',url:'https://db-8442.github.io/LOKASSIST/app.js'};w.handlers.fetch({request,respondWith:promise=>response=promise});assert.equal(await response,network);await Promise.resolve();
 assert.deepEqual(w.puts,[]);
});
