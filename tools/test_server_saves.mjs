import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createSaveApi} from './save-api.mjs';
import {ServerSaveStore} from '../web/server-saves.js';
import {MAPS,BO1_MAPS} from '../web/maps.js';
const maps=[...MAPS,...BO1_MAPS],directory=await mkdtemp(new URL('../.cache/save-api-test-',import.meta.url)),api=createSaveApi({directory,maps});
let server,base;
async function start(){server=http.createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;}
const fetcher=(url,options)=>fetch(base+url,options),storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
await start();
try{
  const browserA=new ServerSaveStore(storage(),maps,fetcher),browserB=new ServerSaveStore(storage(),maps,fetcher);await browserA.prepare();await browserB.prepare();assert.equal(browserA.count(),0);
  const save={name:'Brad · round 12',map:'kino',slot:0,title:'Kino der Toten',summary:{round:12,points:7650,kills:93},state:{version:2,player:{position:[1,2,3],points:7650},inventory:[{name:'m1911_zm',clip:4,reserve:20}],enemies:[{id:17,health:80,stage:'hunt',position:[4,5,6]}]},thumb:null};
  await browserA.put('kino',0,save);await browserB.refresh();assert.equal(browserB.get('kino',0).name,save.name);assert.deepEqual(browserB.get('kino',0).state,save.state);
  const old=browserB.get('kino',0).revision;await browserA.put('kino',0,{...save,name:'Later round'});
  await assert.rejects(browserB.put('kino',0,{...save,name:'Stale device'}),/changed on another device/);
  const backup=JSON.parse(await readFile(directory+'/kino/0.json.backup','utf8'));assert.equal(backup.revision,old);
  await browserB.refresh();assert.equal(browserB.get('kino',0).name,'Later round');
  const route=await fetch(base+'/api/saves/kino/0',{method:'PUT',headers:{'Origin':'https://another-site.example','Content-Type':'application/json'},body:JSON.stringify({expectedRevision:browserB.get('kino',0).revision,save})});assert.equal(route.status,403);
  assert.equal((await fetch(base+'/api/saves/unknown/0')).status,404);assert.equal((await fetch(base+'/api/saves/kino/3')).status,404);
  server.close();await once(server,'close');await start();await browserB.refresh();assert.equal(browserB.get('kino',0).name,'Later round');
  await browserB.remove('kino',0);await browserA.refresh();assert.equal(browserA.get('kino',0),null);assert(JSON.parse(await readFile(directory+'/kino/0.json.backup','utf8')).state);
  const local=storage();local.setItem('waw-zombies-save-v2:kino:1',JSON.stringify({...save,slot:1,savedAt:100}));
  const importer=new ServerSaveStore(local,maps,fetcher);await importer.prepare();assert.equal(importer.get('kino',1).state.player.points,7650);await importer.remove('kino',1);await importer.prepare();assert.equal(importer.get('kino',1),null,'Deleted imported saves must not reappear');
  console.log('Server saves passed: shared names/full state across browsers, disk persistence, stale-device conflicts, backups, validation and one-time browser migration. Test files: '+directory);
}finally{server.close();}
