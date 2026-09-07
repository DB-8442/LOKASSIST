const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const crypto=require('node:crypto');
const storageApi=require('../storage.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const plain=value=>JSON.parse(JSON.stringify(value));

// Minimal DOM adapter: the real inline script, event handlers and storage
// module run unchanged. This does not simulate browser layout or rendering.
function app(seed={}){
 const elements=new Map(),values=new Map(Object.entries(seed)),alerts=[],confirms=[],created=[];
 let approve=true,download=null;
 const decode=s=>s.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
 function scan(markup){
  const ids=[];
  for(const match of markup.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
   const [,tag,attrs,id]=match,node=elements.get(id)||element();
   const content=markup.slice(match.index+match[0].length).split(`</${tag}>`)[0];
   elements.set(id,node);ids.push(id);
   node.value=decode(attrs.match(/\bvalue="([^"]*)"/)?.[1]||'');
   if(tag==='select'){
    const options=[...content.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
    const selected=options.find(o=>/\bselected\b/.test(o[1]))||options[0];
    node.value=selected?decode(selected[1].match(/value="([^"]*)"/)?.[1]??selected[2]):'';
   }
  }
  return ids;
 }
 function element(){
  let markup='',owned=[];
  return {value:'',textContent:'',style:{},disabled:false,readOnly:false,classList:{add(){},remove(){}},focus(){},remove(){},querySelectorAll(){return []},closest(){return this},appendChild(){},click(){if(this.download)download=this.download},
   get innerHTML(){return markup},set innerHTML(value){for(const id of owned)elements.delete(id);markup=String(value);owned=scan(markup)}
  };
 }
 for(const match of html.matchAll(/\bid="([^"]+)"/g))elements.set(match[1],element());
 const body=element();
 const document={body,getElementById:id=>elements.get(id)||null,createElement:()=>{const node=element();created.push(node);return node},
  querySelector:selector=>selector==='#vehicleList'?elements.get('vehicleList'):null,
  querySelectorAll:selector=>selector==='[id^="vbr"]'?[...elements].filter(([id])=>/^vbr\d+$/.test(id)).map(([,node])=>node):[]};
 const localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const context=vm.createContext({document,localStorage,LokassistStorage:storageApi,crypto,Date,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout(){},navigator:{},window:{scrollTo(){}},alert:message=>alerts.push(message),confirm:message=>{confirms.push(message);return approve},prompt:()=>seed.appPin,console});
 vm.runInContext(script,context);
 const run=source=>vm.runInContext(source,context);
 const field=(id,value)=>{assert.ok(elements.has(id),'missing DOM field '+id);elements.get(id).value=value};
 function vehicleRows(numbers=['101']){
  run('newTfRide()');
  for(let i=0;i<numbers.length;i++){if(i>0)run('addVehicleRow()');field('vbr'+i,'BR 8442');field('vno'+i,numbers[i]);field('vtype'+i,context.deriveVehicleType('BR 8442',numbers[i]));field('vpos'+i,String(i+1))}
 }
 return {context,run,field,elements,values,alerts,confirms,created,vehicleRows,approve:value=>approve=value,download:()=>download};
}
test('actual UI starts and finishes services, archives a ride-free service across next start and reload',()=>{
 const a=app();a.field('serviceName','Frühdienst');a.field('serviceDate',a.run('today()'));a.field('serviceStart','00:00');a.run('startService()');
 const first=plain(a.run('getService()'));assert.equal(first.status,'active');a.run('finishService()');const closed=plain(a.run('getService()'));assert.equal(closed.status,'closed');assert.ok(closed.endTime);
 a.field('serviceName','Zweiter Dienst');a.run('startService()');assert.notEqual(a.run('getService().id'),first.id);assert.deepEqual(plain(a.run('getServices().find(s=>s.id=== '+JSON.stringify(first.id)+')')),closed);
 assert.match(a.elements.get('serviceHistoryList').innerHTML,/Frühdienst/);assert.match(a.elements.get('serviceHistoryList').innerHTML,/0 Fahrten/);assert.match(a.elements.get('serviceHistoryList').innerHTML,/Beginn 00:00/);
 const reloaded=app(Object.fromEntries(a.values));assert.equal(reloaded.run('getServices().length'),2);assert.equal(reloaded.run('getTfRides().length'),0);
});
test('saving, loading and editing an old ride during another active service preserves the original ID and service',async()=>{
 const a=app();a.field('serviceName','Alt');a.field('serviceStart','00:00');a.run('startService()');const oldService=a.run('getService().id');
 a.vehicleRows();a.field('tfTrain','123');a.run('saveTfRide()');const saved=plain(a.run('getTfRides()[0]'));assert.equal(saved.serviceId,oldService);
 a.run('finishService()');a.field('serviceName','Neu');a.run('startService()');const newService=a.run('getService().id');assert.notEqual(newService,oldService);
 a.context.loadTfRide(saved.id);a.run('setTfEditMode(true)');a.field('tfNotes','Geändert');a.run('saveTfRide(true)');
 let edited=plain(a.run('getTfRides()[0]'));assert.equal(edited.id,saved.id);assert.equal(edited.serviceId,oldService);assert.equal(edited.notes,'Geändert');assert.equal(edited.serviceDate,saved.serviceDate);
 assert.match(a.elements.get('tfServiceStatus').innerHTML,/Alt/);assert.doesNotMatch(a.elements.get('tfServiceStatus').innerHTML,/Neu/);
 // Reloading the automatic plan used to drop savedId and lose the association.
 a.context.apiGetRetry=async route=>route.startsWith('stop_times')?[{stop_id:'A',arrival_time:'08:00:00',departure_time:'08:01:00'}]:[{stop_id:'A',stop_name:'A'}];
 await a.context.useSelectedTfTrip({trip_id:'trip',first:'A',last:'A',line:'RE 6',category:'RE'});
 a.run('setTfEditMode(true);saveTfRide(true)');edited=plain(a.run('getTfRides()[0]'));assert.equal(edited.id,saved.id);assert.equal(edited.serviceId,oldService);assert.equal(a.run('getTfRides().length'),1);
 a.vehicleRows();a.field('tfTrain','456');a.run('saveTfRide()');assert.equal(a.run('getTfRides()[0].serviceId'),newService);
});
test('historical ride without a service stays unassigned while another service is active',()=>{
 const a=app();a.vehicleRows();a.run('saveTfRide()');const id=a.run('getTfRides()[0].id');
 a.field('serviceName','Neu');a.field('serviceStart','00:00');a.run('startService()');a.context.loadTfRide(id);a.run('setTfEditMode(true);saveTfRide(true)');assert.equal(a.run('getTfRides()[0].serviceId'),null);
});
test('vehicle derivation, reversal, persisted formation, numbering and validation stay functional',()=>{
 const a=app();a.vehicleRows(['101','202','303']);a.run('saveVehicles();reverseVehicleRows()');
 let rows=plain(a.run('collectVehicleRows()'));assert.deepEqual(rows.map(x=>x.number),['303','202','101']);assert.deepEqual(rows.map(x=>x.position),['1','2','3']);assert.deepEqual(rows.map(x=>x.type),['5-teilig','4-teilig','3-teilig']);assert.equal(a.context.validateVehicleConfiguration(rows),'');assert.deepEqual(plain(a.run('getVehicles()')),rows);
 a.run('newTfRide()');assert.deepEqual(plain(a.run('collectVehicleRows()')),rows);a.run('removeVehicleRow(1)');rows=plain(a.run('collectVehicleRows()'));assert.deepEqual(rows.map(x=>x.position),['1','2']);assert.equal(a.context.validateVehicleConfiguration(rows),'');
 a.field('vno1','303');assert.match(a.run('validateVehicleConfiguration(collectVehicleRows())'),/mehrfach/);a.run('saveTfRide()');assert.equal(a.run('getTfRides().length'),0);
 a.field('vno1','bad');assert.match(a.run('validateVehicleConfiguration(collectVehicleRows())'),/gültige Fahrzeugnummer/);
 a.field('vno1','101');a.field('vpos1','3');assert.match(a.run('validateVehicleConfiguration(collectVehicleRows())'),/fortlaufend/);
 assert.match(a.context.validateVehicleConfiguration([...rows,...rows]),/Maximal 3/);
});
test('editing historical vehicles and reversal does not overwrite current formation',()=>{
 const a=app();a.vehicleRows(['101','202']);a.run('saveVehicles();saveTfRide()');const id=a.run('getTfRides()[0].id');
 a.vehicleRows(['303']);a.run('saveVehicles()');const current=plain(a.run('getVehicles()'));
 a.context.loadTfRide(id);a.run('setTfEditMode(true);reverseVehicleRows();saveTfRide(true)');assert.deepEqual(plain(a.run('getVehicles()')),current);assert.deepEqual(plain(a.run('getTfRides()[0].vehicles.map(v=>v.number)')),['202','101']);
});
test('actual import UI validates before confirmation, resets forms after restore and keeps PIN',async()=>{
 const a=app({appPin:'1234'});a.field('profileName','Gesichert');a.field('profileOffice','Stuttgart');a.field('profileEmail','a@example.org');a.run('saveProfile()');a.vehicleRows();a.run('saveVehicles();saveTfRide()');const payload=a.run('dataStore.exportBackup()');
 a.field('profileName','Andere Angaben');a.run('saveProfile()');a.field('tfNotes','Ungespeichert');
 const before=new Map(a.values),count=a.confirms.length,input={files:[{size:2,text:async()=> '{}'}],value:'file'};
 await a.context.importData({target:input});assert.deepEqual(a.values,before);assert.equal(a.confirms.length,count);assert.equal(input.value,'');assert.match(a.elements.get('backupStatus').textContent,/nicht ausgeführt/);
 input.files=[{size:1000,text:async()=>JSON.stringify(payload)}];await a.context.importData({target:input});
 assert.deepEqual(plain(a.run('dataStore.snapshot()')),plain(payload.data));assert.equal(a.elements.get('profileName').value,'Gesichert');assert.equal(a.elements.get('tfNotes').value,'');assert.equal(a.run('tfData'),null);assert.equal(a.values.get('appPin'),'1234');assert.equal(a.elements.get('backupImportBtn').disabled,false);assert.match(a.elements.get('backupStatus').textContent,/erfolgreich/);
 a.run('exportData()');assert.match(a.download(),/^lokassist-backup-v1-\d{4}-\d{2}-\d{2}\.json$/);
});
test('import cancellation and file read failure leave UI usable and data unchanged',async()=>{
 const a=app(),payload=a.run('dataStore.exportBackup()'),before=new Map(a.values);a.approve(false);
 const input={files:[{size:1000,text:async()=>JSON.stringify(payload)}],value:'file'};await a.context.importData({target:input});assert.deepEqual(a.values,before);assert.equal(input.value,'');assert.equal(a.elements.get('backupImportBtn').disabled,false);
 input.files=[{size:5,text:async()=>{throw new Error('Datei nicht lesbar')}}];await a.context.importData({target:input});assert.deepEqual(a.values,before);assert.match(a.elements.get('backupStatus').textContent,/Datei nicht lesbar/);
});
test('pending automatic plan cannot repopulate forms or overwrite the ride after restore',async()=>{
 const a=app();a.vehicleRows();a.run('saveTfRide()');const payload=a.run('dataStore.exportBackup()');
 let release;const pending=new Promise(resolve=>release=resolve);
 a.context.apiGetRetry=async route=>route.startsWith('stop_times')?pending:[{stop_id:'A',stop_name:'Old stop'}];
 const loading=a.context.useSelectedTfTrip({trip_id:'old-plan',first:'A',last:'A',trip_headsign:'Old route'});
 await a.context.importData({target:{files:[{size:1000,text:async()=>JSON.stringify(payload)}],value:'file'}});
 release([{stop_id:'A',arrival_time:'08:00:00',departure_time:'08:01:00'}]);await loading;
 assert.equal(a.run('tfData'),null);assert.equal(a.elements.get('tfRoute').value,'');assert.equal(a.elements.get('tfStops').innerHTML,'');assert.deepEqual(plain(a.run('dataStore.snapshot()')),plain(payload.data));
});
test('imported IDs and training skill labels cannot inject markup into history or forms',()=>{
 const a=app();a.vehicleRows();a.run('saveTfRide()');const ride=plain(a.run('getTfRides()[0]'));ride.id="x' onclick='alert(1)";
 a.values.set('tfRides',JSON.stringify([ride]));a.run('renderTfHistory()');assert.match(a.elements.get('tfHistoryList').innerHTML,/x&#39; onclick=&#39;alert/);
 a.run('buildSkills({PZB:{level:"<img src=x onerror=alert(1)>",note:""}})');
 assert.ok(a.created.some(node=>node.innerHTML.includes('id="sv11">&lt;img src=x onerror=alert(1)&gt;</span>')));
});
test('inline script and service worker compile; versions and offline asset stay consistent',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');assert.doesNotThrow(()=>new vm.Script(sw));
 assert.match(sw,/const VERSION="1\.2\.0"/);assert.match(sw,/"\.\/storage\.js"/);assert.match(html,/1\.2\.0/);assert.doesNotMatch(html,/1\.1\.0/);assert.match(html,/training-area\{display:none!important\}/);
});
