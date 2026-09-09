const assert=require('node:assert/strict');
const test=require('node:test');
const {APP_VERSION,KEYS,JOURNAL_KEY,TIMETABLE_DIAGNOSTICS_KEY,TIMETABLE_DIAGNOSTICS_LIMIT,createStore,validateBackup,parseBackup,rideServiceFields}=require('../storage.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const at='2026-09-07T10:00:00.000Z';
function service(overrides={}){return {id:'service-1',name:'Frühdienst',serviceDate:'2026-09-07',startTime:'06:00',endDate:'2026-09-07',endTime:'10:00',status:'closed',createdAt:at,updatedAt:at,...overrides}}
function training(overrides={}){return {id:'training-1',date:'2026-09-07',trainee:'Azubi',train:'123',vehicle:'BR 8442',level:'Grundausbildung',route:'A → B',general:'Notiz',skills:{PZB:{level:'🟢 sicher / selbstständig',note:'Gut'}},stops:[{name:'A',pa:'06:00',ra:'06:01',pd:'06:02',rd:'06:03',note:'Halt'}],...overrides}}
function ride(overrides={}){return {id:'tf-1',date:'2026-09-07',train:'RE 123',vehicle:'BR 8442',route:'A → B',notes:'Notiz',vehicles:[{br:'BR 8442',number:'101',type:'3-teilig',position:'1'}],plan:{trip:{trip_id:'trip-1',category:'RE',line:'RE 6'},first:'A',last:'B',stops:[{stop_id:'stop-1',name:'A',pa:'06:00',pd:'06:02'}]},source:'automatic',category:'RE',line:'RE 6',rideType:'Planmäßige Fahrt',manualReason:'',manualStops:[],serviceId:'service-1',serviceName:'Frühdienst',serviceDate:'2026-09-07',createdAt:at,updatedAt:at,...overrides}}
function backup(){const s=service();return {app:'LOKASSIST',appVersion:'1.2.0',formatVersion:1,exportedAt:at,data:{tfRides:[ride()],rides:[training()],services:[s],currentService:s,vehicles:ride().vehicles,profile:{name:'Marco',office:'Stuttgart',email:'m@example.org'}}}}
function memory(seed={}){
 const values=new Map(Object.entries(seed)),writes=[];
 return {values,writes,getItem:key=>values.has(key)?values.get(key):null,setItem(key,value){writes.push(key);values.set(key,String(value))},removeItem(key){writes.push(key);values.delete(key)}};
}
function seeded(){const b=backup(),storage=memory(Object.fromEntries(Object.entries(KEYS).map(([name,key])=>[key,JSON.stringify(b.data[name])])));return {b,storage,store:createStore(storage)}}
test('full export includes every business key, saved plan and hidden training data, excludes PIN and caches',()=>{
 const {b,storage,store}=seeded();
 for(const key of ['appPin','tfTripSel:2026-09-07:123','tripSel:2026-09-07:123','irrelevant'])storage.setItem(key,'secret');
 const result=store.exportBackup();
 assert.equal(result.formatVersion,1);assert.equal(result.appVersion,APP_VERSION);assert.ok(Date.parse(result.exportedAt));
 assert.deepEqual(result.data,b.data);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('appPin'),false);
 assert.deepEqual(validateBackup(result).data,b.data);
});
test('valid restore replaces all business data, preserves PIN and cached selections',()=>{
 const storage=memory({appPin:'1234','tfTripSel:old':'selection',tfRides:'[]',lokassistentProfile:'{"name":"old"}'}),store=createStore(storage),b=backup();
 let confirmed=0;assert.equal(store.restore(JSON.stringify(b),parsed=>{confirmed++;assert.equal(parsed.kind,'full');return true}),'full');
 assert.equal(confirmed,1);assert.deepEqual(store.snapshot(),b.data);assert.equal(storage.getItem('appPin'),'1234');assert.equal(storage.getItem('tfTripSel:old'),'selection');assert.equal(storage.getItem(JOURNAL_KEY),null);
});
test('timetable failures are recorded locally with a strict technical field allowlist and excluded from backup',()=>{
 const storage=memory(),store=createStore(storage);const entry=store.recordTimetableDiagnostic({timestamp:at,endpoint:'trips',train:'22792',date:'2026-09-09',errorClass:'http',status:503,attempts:4,online:true,durationMs:1700,userName:'Marco',profile:{email:'private@example.org'},serviceName:'Dienst',vehicle:'8442'});
 assert.deepEqual(Object.keys(entry),['timestamp','endpoint','train','date','errorClass','status','attempts','online','durationMs']);
 assert.equal(entry.status,503);assert.equal(store.getTimetableDiagnostics().length,1);
 const raw=storage.getItem(TIMETABLE_DIAGNOSTICS_KEY);for(const forbidden of ['Marco','private@example.org','Dienst','vehicle','profile','userName'])assert.doesNotMatch(raw,new RegExp(forbidden));
 assert.equal(JSON.stringify(store.exportBackup()).includes(TIMETABLE_DIAGNOSTICS_KEY),false);assert.equal(JSON.stringify(store.exportBackup()).includes('22792'),false);
});
test('timetable diagnostics use a bounded ring buffer',()=>{
 const storage=memory(),store=createStore(storage);
 for(let i=0;i<TIMETABLE_DIAGNOSTICS_LIMIT+7;i++)store.recordTimetableDiagnostic({timestamp:new Date(Date.parse(at)+i*1000).toISOString(),endpoint:'trips',train:String(22000+i),date:'2026-09-09',errorClass:'network',attempts:4,online:false,durationMs:i});
 const rows=store.getTimetableDiagnostics();assert.equal(rows.length,TIMETABLE_DIAGNOSTICS_LIMIT);assert.equal(rows[0].train,String(22007));assert.equal(rows.at(-1).train,String(22000+TIMETABLE_DIAGNOSTICS_LIMIT+6));
});
test('cancelled restore does not write or replace any data',()=>{
 const {storage,store}=seeded(),before=new Map(storage.values);assert.equal(store.restore(JSON.stringify(backup()),()=>false),false);assert.deepEqual(storage.values,before);assert.deepEqual(storage.writes,[]);
});
const invalidCases=[
 ['missing business section',b=>delete b.data.profile],
 ['missing training field',b=>delete b.data.rides[0].skills],
 ['invalid nested stop',b=>b.data.tfRides[0].plan.stops[0].name={}],
 ['invalid nested skill',b=>b.data.rides[0].skills.PZB.note=[]],
 ['invalid timestamp',b=>b.exportedAt='yesterday'],
 ['invalid date',b=>b.data.tfRides[0].date='2026-02-30'],
 ['invalid time',b=>b.data.services[0].startTime='99:00'],
 ['unknown format',b=>b.formatVersion=2],
 ['PIN field',b=>b.data.appPin='1234'],
 ['unknown nested field',b=>b.data.profile.unexpected={}],
 ['duplicate ride ID',b=>b.data.tfRides.push(clone(b.data.tfRides[0]))],
 ['duplicate service ID',b=>b.data.services.push(clone(b.data.services[0]))],
 ['missing referenced service',b=>b.data.tfRides[0].serviceId='missing'],
 ['current service conflicts with archive',b=>b.data.currentService=service({name:'conflict'})],
 ['multiple active services',b=>{b.data.services=[service({status:'active',endDate:null,endTime:null}),service({id:'other',status:'active',endDate:null,endTime:null})];b.data.currentService=b.data.services[0]}],
 ['end before start',b=>{b.data.services[0].endTime='05:00';b.data.currentService=b.data.services[0]}],
 ['prototype key',b=>b.data.rides[0].skills=JSON.parse('{"__proto__":{"level":"x","note":"x"}}')],
 ['malformed formation',b=>b.data.vehicles[0].position=1]
];
for(const [name,mutate] of invalidCases)test(`invalid import leaves ALL stored values untouched: ${name}`,()=>{
 const {storage,store}=seeded(),before=new Map(storage.values),b=clone(backup());mutate(b);let confirmed=false;
 assert.throws(()=>store.restore(JSON.stringify(b),()=>{confirmed=true;return true}));assert.equal(confirmed,false);assert.deepEqual(storage.values,before);assert.deepEqual(storage.writes,[]);
});
test('malformed JSON and incomplete arbitrary old envelopes are rejected',()=>{
 for(const source of ['{','null','[]','{"rides":[]}','{"version":1,"exportedAt":"'+at+'","rides":[]}'])assert.throws(()=>parseBackup(source));
});
test('legacy exporter version 2 is validated and replaces only training rides',()=>{
 const {storage,store}=seeded(),before=new Map(storage.values),legacy={version:2,exportedAt:at,rides:[training({id:'other-training'})]};
 assert.equal(store.restore(JSON.stringify(legacy),parsed=>parsed.kind==='training'),'training');
 assert.deepEqual(JSON.parse(storage.getItem(KEYS.rides)),legacy.rides);
 for(const [key,value] of before)if(key!==KEYS.rides)assert.equal(storage.getItem(key),value);
 legacy.rides[0].stops[0].pa='" onfocus="attack';
 const after=new Map(storage.values);assert.throws(()=>store.restore(JSON.stringify(legacy),()=>true));assert.deepEqual(storage.values,after);
});
test('migration preserves current 1.1 service and derives older service IDs without inventing times',()=>{
 const old={id:'last',name:'Spätdienst',serviceDate:'2026-09-06',startTime:'22:00',endDate:'2026-09-07',endTime:'02:00',status:'closed',createdAt:at,updatedAt:at};
 const storage=memory({[KEYS.currentService]:JSON.stringify(old),[KEYS.tfRides]:JSON.stringify([ride(),ride({id:'tf-2'})])}),store=createStore(storage);
 const originalRides=storage.getItem(KEYS.tfRides);store.initialize();const data=store.snapshot();
 assert.deepEqual(data.currentService,old);assert.equal(data.services.length,2);
 const historic=data.services.find(s=>s.id==='service-1');assert.equal(historic.status,'unknown');assert.equal(historic.startTime,null);assert.equal(historic.endTime,null);assert.equal(historic.reconstructed,true);
 assert.equal(storage.getItem(KEYS.tfRides),originalRides);
 const before=new Map(storage.values);store.initialize();assert.deepEqual(storage.values,before);
});
test('migration preserves active 1.1 service without end fields and works without any rides',()=>{
 const old={id:'last',name:'Dienst',serviceDate:'2026-09-07',startTime:'06:00',status:'active',createdAt:at};
 const storage=memory({[KEYS.currentService]:JSON.stringify(old)}),store=createStore(storage);store.initialize();const data=store.snapshot();
 assert.equal(data.services.length,1);assert.equal(data.currentService.id,'last');assert.equal(data.currentService.endTime,null);assert.equal(data.currentService.updatedAt,at);
});
test('invalid migration source is preserved without writing a partial archive',()=>{
 const storage=memory({[KEYS.currentService]:'{"id":123}',[KEYS.tfRides]:'[]'}),before=new Map(storage.values);
 assert.throws(()=>createStore(storage).initialize());assert.deepEqual(storage.values,before);assert.deepEqual(storage.writes,[]);
});
test('older closed service retains start and end after a new service, including a service without rides',()=>{
 const storage=memory(),store=createStore(storage);store.initialize();
 store.saveService(service());store.saveService(service({id:'service-2',status:'active',endDate:null,endTime:null}));
 const data=store.snapshot();assert.equal(data.tfRides.length,0);assert.equal(data.services.length,2);assert.deepEqual(data.services.find(s=>s.id==='service-1'),service());assert.equal(data.currentService.id,'service-2');
});
test('active service cannot silently be overwritten with a second active service',()=>{
 const storage=memory(),store=createStore(storage);store.initialize();store.saveService(service({status:'active',endDate:null,endTime:null}));const before=new Map(storage.values);
 assert.throws(()=>store.saveService(service({id:'second',status:'active',endDate:null,endTime:null})));assert.deepEqual(storage.values,before);
});
test('quota/write failure at each step rolls back all keys including absent keys',()=>{
 for(let failAt=1;failAt<=8;failAt++){
  const storage=memory({appPin:'1234',[KEYS.rides]:'[]'}),before=new Map(storage.values),set=storage.setItem.bind(storage),remove=storage.removeItem.bind(storage);let writes=0;
  const fault=()=>{if(++writes===failAt)throw new Error('QuotaExceededError')};
  storage.setItem=(key,value)=>{fault();set(key,value)};storage.removeItem=key=>{fault();remove(key)};
  assert.throws(()=>createStore(storage).restore(JSON.stringify(backup()),()=>true));assert.deepEqual(storage.values,before,`failure ${failAt}`);
 }
});
test('interrupted restore is rolled back on next initialization',()=>{
 const {storage}=seeded(),before=Object.fromEntries(storage.values);storage.setItem(JOURNAL_KEY,JSON.stringify({before}));storage.setItem(KEYS.tfRides,'[]');storage.setItem(KEYS.profile,'{}');
 createStore(storage).initialize();assert.deepEqual(Object.fromEntries(storage.values),before);
});
test('a failed rollback retains recovery journal and can complete on next launch',()=>{
 const {storage,store}=seeded(),before=new Map(storage.values),set=storage.setItem.bind(storage);let calls=0;
 storage.setItem=(key,value)=>{if(++calls>=3)throw new Error('disk unavailable');set(key,value)};
 assert.throws(()=>store.restore(JSON.stringify(backup()),()=>true),/unterbrochen/);assert.ok(storage.getItem(JOURNAL_KEY));
 storage.setItem=set;store.initialize();assert.deepEqual(storage.values,before);
});
test('recovery never accepts arbitrary keys such as appPin',()=>{
 const storage=memory({appPin:'1234',[JOURNAL_KEY]:JSON.stringify({before:{appPin:'0000'}})}),before=new Map(storage.values);
 assert.throws(()=>createStore(storage).recover());assert.deepEqual(storage.values,before);
});
test('old and unassigned rides keep their original service; new rides use active service',()=>{
 const active=service({id:'new',status:'active',endDate:null,endTime:null});
 assert.deepEqual(rideServiceFields(ride(),active,'2026-09-08'),{serviceId:'service-1',serviceName:'Frühdienst',serviceDate:'2026-09-07'});
 assert.equal(rideServiceFields(ride({serviceId:null}),active,'2026-09-08').serviceId,null);
 assert.deepEqual(rideServiceFields(null,active,'2026-09-08'),{serviceId:'new',serviceName:'Frühdienst',serviceDate:'2026-09-07'});
 assert.equal(rideServiceFields(null,service(),'2026-09-07').serviceId,null);
});
test('legacy Tf record and unfinished current vehicle rows survive full round trip',()=>{
 const b=backup();b.data.tfRides=[{id:'old',date:'',train:'',vehicle:'BR 8442',route:'',notes:''}];b.data.vehicles=[{br:'',number:'',type:'unbekannt',position:'1'}];
 assert.deepEqual(validateBackup(b).data,b.data);
});
