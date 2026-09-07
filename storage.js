/* Local data, backup validation and recoverable multi-key writes. No API caches. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.LokassistStorage=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const APP_VERSION="1.2.0";
 const KEYS={tfRides:"tfRides",rides:"rides",services:"lokassistentServices",currentService:"lokassistentCurrentService",vehicles:"lokassistentCurrentVehicles",profile:"lokassistentProfile"};
 const JOURNAL_KEY="lokassistentStorageTransaction";
 const MAX_FILE_BYTES=20*1024*1024;
 const fail=(path,message)=>{throw new Error(`${path}: ${message}`)};
 function object(value,path,allowed,required=allowed){
  if(!value||typeof value!=="object"||Array.isArray(value))fail(path,"Objekt erwartet.");
  for(const key of Object.keys(value))if(!allowed.includes(key))fail(path,`Unbekanntes Feld „${key}“.`);
  for(const key of required)if(!Object.hasOwn(value,key))fail(path,`Pflichtfeld „${key}“ fehlt.`);
  return value;
 }
 function string(value,path){if(typeof value!=="string"||value.length>100000)fail(path,"Text erwartet (höchstens 100.000 Zeichen).");return value}
 function id(value,path){string(value,path);if(!value.trim()||value.length>200)fail(path,"Gültige ID erwartet.");return value}
 function date(value,path,empty=false){
  if(empty&&value==="")return value;
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(path,"Gültiges Datum erwartet.");
  return value;
 }
 function time(value,path){if(typeof value!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail(path,"Uhrzeit im Format HH:MM erwartet.");return value}
 function timestamp(value,path){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail(path,"Gültiger UTC-Zeitstempel erwartet.");return value}
 const nullable=check=>(value,path)=>value===null?null:check(value,path);
 const text=string;
 const maybeTime=(value,path)=>value===""?"":time(value,path);
 function fields(value,path,schema,required){
  object(value,path,Object.keys(schema),required);
  const result={};
  for(const [key,check] of Object.entries(schema))if(Object.hasOwn(value,key))result[key]=check(value[key],`${path}.${key}`);
  return result;
 }
 function list(value,path,check,max=100000){
  if(!Array.isArray(value)||value.length>max)fail(path,`Liste mit höchstens ${max} Einträgen erwartet.`);
  return value.map((item,i)=>check(item,`${path}[${i}]`));
 }
 function records(value,path,check){
  const rows=list(value,path,check),ids=new Set();
  for(const row of rows){if(ids.has(row.id))fail(path,`Doppelte ID „${row.id}“.`);ids.add(row.id)}
  return rows;
 }
 function vehicle(value,path){
  // Current formations can contain unfinished rows; validate shape without
  // discarding drafts or rejecting vehicles saved by older app versions.
  return fields(value,path,{br:text,number:text,type:text,position:(v,p)=>{if(!["1","2","3"].includes(v))fail(p,"Position 1 bis 3 erwartet.");return v}},["br","number","type","position"]);
 }
 function trip(value,path){
  const schema=Object.fromEntries(["trip_id","trip_headsign","route_name","agency_id","category","line","first","last","departure","arrival"].map(k=>[k,text]));
  return fields(value,path,schema,[]);
 }
 function plan(value,path){
  return fields(value,path,{trip:nullable(trip),first:text,last:text,stops:(v,p)=>list(v,p,(s,q)=>fields(s,q,{stop_id:text,name:text,pa:maybeTime,pd:maybeTime},["name","pa","pd"]))},["first","last","stops"]);
 }
 function tfRide(value,path){
  return fields(value,path,{
   id,date:(v,p)=>date(v,p,true),train:text,vehicle:text,route:text,notes:text,
   vehicles:(v,p)=>list(v,p,vehicle,3),plan:nullable(plan),
   source:(v,p)=>{if(!["manual","automatic"].includes(v))fail(p,"Fahrtquelle unbekannt.");return v},
   category:text,line:text,rideType:text,manualReason:text,manualStops:(v,p)=>list(v,p,text),
   serviceId:nullable(id),serviceName:text,serviceDate:nullable((v,p)=>date(v,p,true)),
   createdAt:timestamp,updatedAt:timestamp
  },["id","date","train","vehicle","route","notes"]);
 }
 function trainingRide(value,path){
  return fields(value,path,{
   id,date:(v,p)=>date(v,p,true),trainee:text,train:text,vehicle:text,level:text,route:text,general:text,
   skills:(v,p)=>{
    if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length>100)fail(p,"Beobachtungen als Objekt erwartet.");
    const result={};
    for(const [key,item] of Object.entries(v)){
     if(["__proto__","prototype","constructor"].includes(key))fail(p,"Unzulässiger Feldname.");
     string(key,p);result[key]=fields(item,`${p}.${key}`,{level:text,note:text},["level","note"]);
    }
    return result;
   },
   stops:(v,p)=>list(v,p,(s,q)=>fields(s,q,{name:text,pa:maybeTime,ra:maybeTime,pd:maybeTime,rd:maybeTime,note:text},["name","pa","ra","pd","rd","note"]))
  },["id","date","trainee","train","vehicle","level","route","general","skills","stops"]);
 }
 function service(value,path){
  const result=fields(value,path,{
   id,name:text,serviceDate:(v,p)=>date(v,p,true),startTime:nullable(time),endDate:nullable(date),endTime:nullable(time),
   status:(v,p)=>{if(!["active","closed","unknown"].includes(v))fail(p,"Dienststatus unbekannt.");return v},
   createdAt:nullable(timestamp),updatedAt:nullable(timestamp),reconstructed:(v,p)=>{if(typeof v!=="boolean")fail(p,"Wahrheitswert erwartet.");return v}
  },["id","name","serviceDate","startTime","endDate","endTime","status","createdAt","updatedAt"]);
  if(result.status==="unknown"){
   if(!result.reconstructed||result.startTime!==null||result.endDate!==null||result.endTime!==null)fail(path,"Rekonstruierter Dienst muss unbekannte Zeiten kennzeichnen.");
  }else{
   date(result.serviceDate,path+".serviceDate");time(result.startTime,path+".startTime");
   if(result.status==="active"&&(result.endDate!==null||result.endTime!==null))fail(path,"Aktiver Dienst darf kein Ende haben.");
   if(result.status==="closed"){
    date(result.endDate,path+".endDate");time(result.endTime,path+".endTime");
    if(`${result.endDate}T${result.endTime}`<`${result.serviceDate}T${result.startTime}`)fail(path,"Dienstende liegt vor Dienstbeginn.");
   }
  }
  return result;
 }
 function validateData(value){
  const data=fields(value,"Daten",{
   tfRides:(v,p)=>records(v,p,tfRide),rides:(v,p)=>records(v,p,trainingRide),
   services:(v,p)=>records(v,p,service),currentService:nullable(service),vehicles:(v,p)=>list(v,p,vehicle,3),
   profile:(v,p)=>fields(v,p,{name:text,office:text,email:text},[])
  },Object.keys(KEYS));
  const byId=new Map(data.services.map(s=>[s.id,s]));
  for(const ride of data.tfRides)if(ride.serviceId&&!byId.has(ride.serviceId))fail("Daten.tfRides","Ein referenzierter Dienst fehlt im Archiv.");
  if(data.currentService&&JSON.stringify(byId.get(data.currentService.id))!==JSON.stringify(data.currentService))fail("Daten.currentService","Dienst stimmt nicht mit dem Archiv überein.");
  const active=data.services.filter(s=>s.status==="active");
  if(active.length>1||(active.length===1&&active[0].id!==data.currentService?.id))fail("Daten.services","Aktiver Dienst ist nicht eindeutig.");
  return data;
 }
 function validateBackup(payload){
  if(payload&&Object.hasOwn(payload,"formatVersion")){
   object(payload,"Backup",["app","appVersion","formatVersion","exportedAt","data"]);
   if(payload.app!=="LOKASSIST"||payload.formatVersion!==1)fail("Backup","Dieses Backupformat wird nicht unterstützt.");
   string(payload.appVersion,"Backup.appVersion");timestamp(payload.exportedAt,"Backup.exportedAt");
   return {kind:"full",data:validateData(payload.data)};
  }
  // Only the actual old exporter envelope is accepted, never an arbitrary
  // object with a rides property. All nested records use the same validators.
  object(payload,"Ausbildungsbackup",["version","exportedAt","rides"]);
  if(payload.version!==2)fail("Ausbildungsbackup","Nur das bisherige Ausbildungsformat Version 2 wird unterstützt.");
  timestamp(payload.exportedAt,"Ausbildungsbackup.exportedAt");
  return {kind:"training",rides:records(payload.rides,"Ausbildungsfahrten",trainingRide)};
 }
 function parseBackup(source){
  if(typeof source!=="string"||source.length>MAX_FILE_BYTES)fail("Datei","Backup ist zu groß (maximal 20 MB).");
  let value;try{value=JSON.parse(source)}catch(_){fail("Datei","Keine gültige JSON-Datei.")}
  return validateBackup(value);
 }
 function createStore(storage){
  function read(key,fallback){const raw=storage.getItem(key);if(raw===null)return fallback;try{return JSON.parse(raw)}catch(_){fail(key,"Gespeicherte Daten sind nicht lesbar; nichts wurde ersetzt.")}}
  function recover(){
   const journal=read(JOURNAL_KEY,null);if(journal===null)return;
   object(journal,"Wiederherstellung",["before"]);
   object(journal.before,"Wiederherstellung.before",Object.values(KEYS),[]);
   for(const [key,value] of Object.entries(journal.before))if(value!==null&&typeof value!=="string")fail(key,"Ungültige Wiederherstellungsdaten.");
   // Free changed values first so rollback also works when quota is exhausted.
   for(const key of Object.keys(journal.before))storage.removeItem(key);
   for(const [key,value] of Object.entries(journal.before))if(value!==null)storage.setItem(key,value);
   storage.removeItem(JOURNAL_KEY);
  }
  function write(changes){
   recover();
   const before={};
   for(const key of Object.keys(changes)){
    if(!Object.values(KEYS).includes(key))fail("Speicherung","Unzulässiger Schlüssel.");
    before[key]=storage.getItem(key);
   }
   try{
    storage.setItem(JOURNAL_KEY,JSON.stringify({before}));
    for(const [key,value] of Object.entries(changes))storage.setItem(key,JSON.stringify(value));
    storage.removeItem(JOURNAL_KEY);
   }catch(error){
    try{recover()}catch(_){throw new Error("Speicherung unterbrochen. Bitte Speicher freigeben und die App neu laden; die Wiederherstellungsdaten bleiben erhalten.")}
    throw new Error("Nicht gespeichert. Der vorherige Bestand wurde beibehalten. Bitte freien Gerätespeicher und Browserzugriff prüfen.",{cause:error});
   }
  }
  function snapshot(){return validateData(Object.fromEntries(Object.entries(KEYS).map(([name,key])=>[name,read(key,name==="currentService"?null:name==="profile"?{}:[])])))}
  function initialize(){
   recover();
   if(storage.getItem(KEYS.services)!==null)return;
   const current=read(KEYS.currentService,null),rides=records(read(KEYS.tfRides,[]),"Tf-Fahrten",tfRide),services=[];
   let normalized=null;
   if(current){
    normalized=service({...current,endDate:current.endDate??null,endTime:current.endTime??null,createdAt:current.createdAt??null,updatedAt:current.updatedAt??current.createdAt??null},"Bisheriger Dienst");
    services.push(normalized);
   }
   const ids=new Set(services.map(s=>s.id));
   for(const ride of rides)if(ride.serviceId&&!ids.has(ride.serviceId)){
    services.push(service({id:ride.serviceId,name:ride.serviceName||"",serviceDate:ride.serviceDate||ride.date,startTime:null,endDate:null,endTime:null,status:"unknown",createdAt:null,updatedAt:null,reconstructed:true},"Rekonstruierter Dienst"));
    ids.add(ride.serviceId);
   }
   write({[KEYS.services]:services,[KEYS.currentService]:normalized});
  }
  function saveService(value){
   initialize();
   const next=service(value,"Dienst"),data=snapshot(),index=data.services.findIndex(s=>s.id===next.id);
   if(index<0)data.services.unshift(next);else data.services[index]=next;
   data.currentService=next;validateData(data);
   write({[KEYS.services]:data.services,[KEYS.currentService]:next});
  }
  function exportBackup(){return {app:"LOKASSIST",appVersion:APP_VERSION,formatVersion:1,exportedAt:new Date().toISOString(),data:snapshot()}}
  function restore(source,confirmReplace){
   const parsed=parseBackup(source);
   if(!confirmReplace(parsed))return false;
   const changes=parsed.kind==="training"?{[KEYS.rides]:parsed.rides}:Object.fromEntries(Object.entries(KEYS).map(([name,key])=>[key,parsed.data[name]]));
   write(changes);return parsed.kind;
  }
  return {initialize,recover,snapshot,saveService,exportBackup,restore};
 }
 function rideServiceFields(existing,currentService,rideDate){
  if(existing)return {serviceId:existing.serviceId??null,serviceName:existing.serviceName??"",serviceDate:existing.serviceDate??existing.date??rideDate};
  return currentService?.status==="active"?{serviceId:currentService.id,serviceName:currentService.name,serviceDate:currentService.serviceDate}:{serviceId:null,serviceName:"",serviceDate:rideDate};
 }
 return {APP_VERSION,KEYS,JOURNAL_KEY,MAX_FILE_BYTES,validateBackup,parseBackup,validateData,createStore,rideServiceFields};
});
