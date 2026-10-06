// Prepare a versioned map/runtime asset pack on E: for one compressed download.
import {readFile,writeFile,readdir,stat,mkdir} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
import {MAPS,BO1_MAPS,mapById} from '../web/maps.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {spawn} from 'node:child_process';
import {prepareFactoryPowerNavigation} from './prepare_power_navigation.mjs';
import {prepareKinoDoors} from './prepare_kino_doors.mjs';
import {prepareGateNavigation} from './prepare_gate_navigation.mjs';
import {navigationStamp} from './navigation_stamp.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),data=path.join(root,'local-data');
await new Promise((resolve,reject)=>{const child=spawn('python',['-B',path.join(root,'tools/prepare_launch_media.py')],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Loading movie preparation failed.')));});
await new Promise((resolve,reject)=>{const child=spawn('python',['-B',path.join(root,'tools/prepare_gore.py')],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Native gore preparation failed.')));});
await new Promise((resolve,reject)=>{const child=spawn('python',['-B',path.join(root,'tools/prepare_melee.py')],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Native knife preparation failed.')));});
await new Promise((resolve,reject)=>{const child=spawn('python',['-B',path.join(root,'tools/prepare_player_movement.py')],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Native dive preparation failed.')));});
await new Promise((resolve,reject)=>{const child=spawn('python',['-B',path.join(root,'tools/prepare_dive.py')],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Dive audio/body preparation failed.')));});
const read=async relative=>JSON.parse(await readFile(path.join(data,relative),'utf8'));
const chosen=mapById(process.argv[process.argv.indexOf('--map')+1]),zones=chosen.assetZones||[...new Set([chosen.zone,'common','nacht'])],blackOps=chosen.game==='black-ops';
const manifest=await read(chosen.data+'/manifest.json'),presentation=await read(chosen.data+'/presentation.json'),world=await read(chosen.zone+'/web-world/'+chosen.asset+'.json');
// Validate small physics steps on the host once, and ship the ready graph.
// Repeat only when the collision, entities, graph or movement code changes.
const navSources=[chosen.zone+'/web-world/'+chosen.asset+'.collision.json',chosen.zone+'/web-world/'+chosen.asset+'.paths.json',chosen.data+'/manifest.json'];
const navStamp=await navigationStamp(root,chosen,manifest);let navigation;try{navigation=await read(chosen.data+'/navigation.json');}catch{}
if(navigation?.sourceStamp!==navStamp&&!(process.argv.includes('--assets-only')&&navigation?.version)){
  const began=performance.now(),collision=await read(navSources[0]),paths=await read(navSources[1]);
  const game=new (blackOps?BlackOpsEngine:SoloGame)(manifest,new CollisionWorld(collision,manifest.entities),paths,{},presentation);game.prepareSpawnPaths();
  navigation={...game.preparedNavigation(),sourceStamp:navStamp};await writeFile(path.join(data,chosen.data+'/navigation.json'),JSON.stringify(navigation));
  console.log(`Prepared ${navigation.links.length} directed navigation links and ${navigation.routes.length} window routes on E: in ${((performance.now()-began)/1000).toFixed(1)} seconds.`);
}
const files=new Map();
if(chosen.id==='der-riese')await prepareFactoryPowerNavigation(data,navigation);
if(blackOps)await prepareKinoDoors();else await prepareGateNavigation(data,chosen,navigation);
async function add(relative,required=true){
  relative=relative.replaceAll('\\','/');const resolved=path.resolve(data,relative),inside=path.relative(data,resolved);
  if(inside.startsWith('..')||path.isAbsolute(inside))throw new Error('Asset path escapes local-data.');
  try{const info=await stat(resolved);if(!info.isFile())throw new Error('Not a file.');
    const url='/data/'+inside.split(path.sep).map(encodeURIComponent).join('/');files.set(url,{file:resolved,size:info.size,mtime:info.mtimeMs});return true;
  }catch(error){if(required)throw error;return false;}
}
async function texture(name){
  if(!name||name.includes('$identity'))return;
  name=name.replace(/^,/, '');for(const zone of zones)if(await add(`${zone}/images/${name}.dds`,false))return;
}
async function model(name){
  if(!name||name.startsWith('*'))return;name=name.replace(/^,/, '');
  for(const zone of zones){
    const relative=`${zone}/model_export/${name}_lod0.glb`;if(!await add(relative,false))continue;
    const buffer=await readFile(path.join(data,relative)),length=buffer.readUInt32LE(12);
    const gltf=JSON.parse(buffer.toString('utf8',20,20+length));
    for(const material of gltf.materials||[]){
      for(const source of zones){const record=`${source}/materials/${material.name.replace(/^,/, '')}.json`;
        if(!await add(record,false))continue;
        const native=JSON.parse(await readFile(path.join(data,record),'utf8'));
        for(const t of native.textures||[])if(t.semantic==='colorMap')await texture(t.image);
        break;
      }
    }
    for(const image of gltf.images||[]){if(!image.uri||image.uri.startsWith('data:'))continue;
      const uri=decodeURIComponent(image.uri).replace('/images/,','/images/');
      const target=path.relative(data,path.resolve(data,zone,'model_export',uri));
      if(!await add(target,false))await texture(path.basename(uri).replace(/^,/, '').replace(/\.dds$/i,''));
    }return;
  }
}
await add(chosen.data+'/manifest.json');await add(chosen.data+'/presentation.json');await add(chosen.data+'/navigation.json');if(!blackOps)await add('ui/fonts/normalFont.json');
if(chosen.id==='der-riese')await add(chosen.data+'/power-navigation.json');
if(!blackOps)await add(chosen.data+'/gate-navigation.json');
for(const effect of Object.values(presentation.effects))for(const element of effect.elements)for(const url of element.textures)await add(decodeURIComponent(url.slice('/data/'.length)));
if(presentation.gore)for(const url of [presentation.gore.burst,presentation.gore.drops,...presentation.gore.decals])await add(decodeURIComponent(url.slice('/data/'.length)));
for(const entry of [...Object.values(manifest.sounds),...Object.values(manifest.voice||{})].flat())await add(decodeURIComponent(entry.url.slice('/data/'.length)));
const hudFolder=blackOps?chosen.data+'/hud':'gameplay/hud';for(const name of await readdir(path.join(data,hudFolder)))if(name.endsWith('.png'))await add(hudFolder+'/'+name);
for(const name of await readdir(path.join(data,chosen.zone+'/web-world')))await add(chosen.zone+'/web-world/'+name);
for(const material of Object.values(world.materials)){await texture(material.diffuse);await texture(material.normal);}
for(const lightmap of world.lightmaps)for(const [type,name] of Object.entries(lightmap))if(!blackOps||type==='primary')await add(chosen.zone+'/images/'+name.replace(/^\*/,'_')+'.dds');
// Kino's four characters each have their own viewmodel arms.
const names=new Set([...(blackOps?['viewmodel_usa_pow_arms','viewmodel_rus_prisoner_arms','viewmodel_vtn_nva_standard_arms','viewmodel_usa_hazmat_arms',presentation.actors.body,presentation.actors.head]:['viewmodel_hands','char_ger_honorgd_body1_1','char_ger_honorgd_zombiehead1_1']),
  ...[manifest.grenade?.gunModel,manifest.grenade?.projectileModel,presentation.gore?.neckModel].filter(Boolean),
  ...Object.values(presentation.powerups),...world.staticModels.map(m=>m.model),...manifest.entities.filter(e=>e.classname==='script_model').map(e=>e.model),...Object.values(manifest.weapons).flatMap(w=>[w.gunModel,w.knifeModel,w.worldModel]),...Object.values(manifest.gestures||{}).map(g=>g.gunModel)]);
for(const character of manifest.playerBodies||[])for(const key of ['body','head','hat'])if(character[key])names.add(character[key]);
for(const name of names)await model(name);
const animations=new Set(Object.keys(presentation.animations));
for(const weapon of [...Object.values(manifest.weapons),...Object.values(manifest.gestures||{}),manifest.grenade||{}])for(const [key,value] of Object.entries(weapon))if(key.endsWith('Anim')&&value)animations.add(value);
for(const name of animations)for(const zone of zones)if(await add(`${zone}/web-anims/${name}.json`,false))break;
const entries=[...files].sort(([a],[b])=>a.localeCompare(b));
const stamp=createHash('sha256').update('sharded-v1').update(JSON.stringify(entries.map(([url,info])=>[url,info.size,info.mtime]))).digest('hex');
const metaFile=path.join(data,chosen.id==='nacht'?'preload.json':chosen.data+'/preload.json'),folder=path.join(root,'.cache/preload');await mkdir(folder,{recursive:true});
let previous;try{previous=await read(chosen.id==='nacht'?'preload.json':chosen.data+'/preload.json');}catch{}
if(previous?.sourceStamp===stamp&&previous.packs?.length&&
  (await Promise.all(previous.packs.map(pack=>stat(path.join(folder,pack.file+'.gz')).catch(()=>null)))).every(Boolean)){
  console.log(`Prepared ${chosen.title}: ${previous.files} assets, ${(previous.gzipBytes/1048576).toFixed(1)} MiB compressed (already ready).`);await prepareOtherMaps();process.exit(0);
}
const groups=[];let group=[],size=0;
for(const entry of entries){if(group.length&&size+entry[1].size>16*1048576){groups.push(group);group=[];size=0;}group.push(entry);size+=entry[1].size;}
if(group.length)groups.push(group);
const packs=[];
for(const group of groups){
  const buffers=await Promise.all(group.map(([,info])=>readFile(info.file)));let offset=0;
  const index=group.map(([url],i)=>{const item={url,offset,length:buffers[i].length};offset+=item.length;return item;});
  const json=Buffer.from(JSON.stringify(index)),header=Buffer.alloc(12);header.write('WWPK');header.writeUInt32LE(1,4);header.writeUInt32LE(json.length,8);
  const hash=createHash('sha256');hash.update(header);hash.update(json);for(const buffer of buffers)hash.update(buffer);
  const id=hash.digest('hex').slice(0,20),file=id+'.pack',output=path.join(folder,file);
  await pipeline((async function*(){yield header;yield json;for(const buffer of buffers)yield buffer;})(),createWriteStream(output));
  await pipeline(createReadStream(output),createGzip({level:6}),createWriteStream(output+'.gz'));
  packs.push({file,url:`/packs/${file}`,files:index.length,bytes:12+json.length+offset,gzipBytes:(await stat(output+'.gz')).size});
}
const id=createHash('sha256').update(packs.map(p=>p.file).join('\n')).digest('hex').slice(0,20);
const metadata={format:'waw-preload-v1',id,packs,files:entries.length,bytes:packs.reduce((n,p)=>n+p.bytes,0),gzipBytes:packs.reduce((n,p)=>n+p.gzipBytes,0),sourceStamp:stamp,...(blackOps?{navigationVersion:'kino-ground-v2'}:{})};
await writeFile(metaFile,JSON.stringify(metadata,null,2));console.log(`Prepared ${chosen.title}: ${entries.length} assets in ${packs.length} cached parts, ${(metadata.bytes/1048576).toFixed(1)} MiB → ${(metadata.gzipBytes/1048576).toFixed(1)} MiB compressed.`);

async function prepareOtherMaps(){
  if(process.argv.includes('--map'))return;
  for(const map of [...MAPS.slice(1),...BO1_MAPS]){if(!await stat(path.join(data,map.data+'/manifest.json')).catch(()=>null))continue;
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--map',map.id,...(process.argv.includes('--assets-only')?['--assets-only']:[])],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(map.title+' preparation failed')));});
  }
}
await prepareOtherMaps();
