// Prepare actor-sized arena navigation and content-addressed asset packs on E:.
import {readFile,writeFile,readdir,stat,mkdir} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CollisionWorld} from '../web/collision.js';
import {BO1_MAPS} from '../web/maps.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),data=path.join(root,'local-data'),map=BO1_MAPS.find(m=>m.id==='dead-ops');
const read=async name=>JSON.parse(await readFile(path.join(data,name),'utf8'));
const manifest=await read(map.data+'/manifest.json'),world=await read(map.zone+'/web-world/zombietron.json'),source=await read(map.zone+'/web-world/zombietron.collision.json');
const collision=new CollisionWorld(source,manifest.entities);collision.disabled=new Set(manifest.arenas.flatMap(a=>a.exits.map(e=>e.target).filter(Boolean)));
const arenas=[];
for(const arena of manifest.arenas){
  const nodes=[],lookup=new Map(),step=48,mins=arena.bounds.mins,maxs=arena.bounds.maxs;
  for(let x=Math.ceil(mins[0]/step);x<=Math.floor(maxs[0]/step);x++)for(let y=Math.ceil(mins[1]/step);y<=Math.floor(maxs[1]/step);y++){
    const a=[x*step,y*step,arena.center[2]+200],b=[a[0],a[1],arena.center[2]-260],r=collision.trace(a,b,[0,0,0],1);
    if(r.fraction===1||r.allSolid||r.normal[2]<.5)continue;const p=r.end,head=[p[0],p[1],p[2]+30.1];
    if(collision.actor(()=>collision.trace(head,head,[12,12,29.9])).allSolid)continue;
    lookup.set(x+','+y,nodes.length);nodes.push({p,links:[],cell:[x,y]});
  }
  for(let i=0;i<nodes.length;i++){const n=nodes[i];for(const [x,y]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const j=lookup.get((n.cell[0]+x)+','+(n.cell[1]+y));if(j===undefined||Math.abs(n.p[2]-nodes[j].p[2])>48)continue;
    const q=nodes[j].p;if(collision.actor(()=>collision.trace([n.p[0],n.p[1],n.p[2]+31],[q[0],q[1],q[2]+31],[10,10,28])).fraction>.98)n.links.push(j);
  }}
  if(nodes.length<30)throw new Error('No reachable arena navigation: '+arena.id);
  // Steep ledges are one-way drops; the arena grid keeps walking routes
  // that work in both directions rather than trapping actors below a ledge.
  nodes.forEach((n,i)=>n.links=n.links.filter(j=>nodes[j].links.includes(i)));
  // Exclude collision on ocean bottoms and roofs disconnected from the spawn.
  const visited=new Set();let queue=[],best=Infinity;
  for(let start=0;start<nodes.length;start++){
    if(visited.has(start))continue;const component=[start];visited.add(start);
    for(let i=0;i<component.length;i++)for(const j of nodes[component[i]].links)if(!visited.has(j)){visited.add(j);component.push(j);}
    if(component.length<30)continue;const score=Math.min(...component.map(i=>Math.hypot(...nodes[i].p.map((v,k)=>v-arena.spawn[k]))));
    if(score<best){best=score;queue=component;}
  }
  const reachable=new Set(queue);
  const mapping=new Map(queue.map((old,i)=>[old,i])),connected=queue.map(old=>({p:nodes[old].p,links:nodes[old].links.filter(j=>reachable.has(j)).map(j=>mapping.get(j))}));
  if(connected.length<30)throw new Error('Disconnected arena floor: '+arena.id);
  // Exit corridors extend beyond the AI grid. Validate them with the player hull.
  const exitSides=[];
  for(const e of arena.exits){
    let p=connected.toSorted((a,b)=>Math.hypot(a.p[0]-e.position[0],a.p[1]-e.position[1])-Math.hypot(b.p[0]-e.position[0],b.p[1]-e.position[1]))[0].p.slice();
    for(let t=0;t<960;t++){
      if(p[0]>=e.mins[0]-25&&p[0]<=e.maxs[0]+25&&p[1]>=e.mins[1]-25&&p[1]<=e.maxs[1]+25){exitSides.push(e.side);break;}
      const dx=e.position[0]-p[0],dy=e.position[1]-p[1],length=Math.hypot(dx,dy);if(length<1)break;
      const r=collision.step(p,[dx/length*190/120,dy/length*190/120,-800/120/120],[12,12,30]);p=r.position;
      if(r.grounded){const a=[p[0],p[1],p[2]+100],f=collision.trace(a,[p[0],p[1],p[2]-220],[0,0,0],1);if(f.fraction<1&&f.normal[2]>.45&&!f.allSolid)p=f.end;}
    }
  }
  if(!exitSides.length)throw new Error('No walkable exit in '+arena.id);
  arenas.push({id:arena.id,nodes:connected,exitSides});console.log(arena.id+': '+connected.length+' reachable floor nodes; exits '+exitSides.join(', '));
}
await writeFile(path.join(data,map.data,'navigation.json'),JSON.stringify({format:'dead-ops-navigation-v1',arenas}));
const files=new Map();
async function add(relative,required=true){const file=path.resolve(data,relative),inside=path.relative(data,file);if(inside.startsWith('..')||path.isAbsolute(inside))throw new Error('Asset escapes local-data');const info=await stat(file).catch(()=>null);if(!info?.isFile()){if(required)throw new Error('Missing native asset '+relative);return false;}files.set('/data/'+inside.split(path.sep).map(encodeURIComponent).join('/'),{file,size:info.size});return true;}
async function texture(name){if(!name)return;name=name.replace(/^,/,'');if(name.includes('$identity'))return;for(const zone of map.assetZones)if(await add(zone+'/images/'+name+'.dds',false))return;throw new Error('Missing original texture '+name);}
async function model(name){if(!name||name.startsWith('*'))return;for(const zone of map.assetZones){const relative=zone+'/model_export/'+name.replace(/^,/,'')+'_lod0.glb';if(!await add(relative,false))continue;
  const buffer=await readFile(path.join(data,relative)),gltf=JSON.parse(buffer.toString('utf8',20,20+buffer.readUInt32LE(12)));
  for(const image of gltf.images||[])if(image.uri&&!image.uri.startsWith('data:')){const relative=path.relative(data,path.resolve(data,zone,'model_export',decodeURIComponent(image.uri).replace('/images/,','/images/')));if(!await add(relative,false))await texture(path.basename(image.uri).replace(/^,/,'').replace(/\.dds$/i,''));}
  for(const mat of gltf.materials||[])for(const z of map.assetZones){const f=z+'/materials/'+mat.name.replace(/^,/,'')+'.json';if(!await add(f,false))continue;for(const t of (await read(f)).textures||[])if(t.semantic==='colorMap')await texture(t.image);break;}
  return;
}throw new Error('Missing original model '+name);}
await add(map.data+'/manifest.json');await add(map.data+'/navigation.json');await add(map.data+'/presentation.json');
for(const effect of Object.values((await read(map.data+'/presentation.json')).effects))for(const e of effect.elements)for(const url of e.textures)await add(decodeURIComponent(url.slice(6)));
const gore=(await read(map.data+'/presentation.json')).gore;if(gore)for(const url of [gore.burst,gore.drops,...gore.decals])await add(decodeURIComponent(url.slice(6)));
for(const name of await readdir(path.join(data,map.zone,'web-world')))await add(map.zone+'/web-world/'+name);
for(const name of await readdir(path.join(data,map.data,'hud')))if(name.endsWith('.png'))await add(map.data+'/hud/'+name);
for(const mat of Object.values(world.materials)){await texture(mat.diffuse);await texture(mat.normal);}
for(const lm of world.lightmaps)await texture(lm.primary?.replace(/^\*/,'_'));
const names=new Set([...Object.values(manifest.models),...Object.values(manifest.actorHeads||{}),...Object.values(manifest.pickups),...Object.values(manifest.weapons).map(w=>w.worldModel),...world.staticModels.map(m=>m.model),...manifest.entities.filter(e=>e.classname==='script_model'&&!e.model?.startsWith('*')).map(e=>e.model)]);
for(const name of names)await model(name);
for(const name of new Set(Object.values(manifest.animations).filter(Boolean)))for(const zone of map.assetZones)if(await add(zone+'/web-anims/'+name+'.json',false))break;
for(const entry of Object.values(manifest.sounds).flat())await add(decodeURIComponent(entry.url.slice(6)));
const folder=path.join(root,'.cache/preload');await mkdir(folder,{recursive:true});const entries=[...files].sort(([a],[b])=>a.localeCompare(b)),groups=[];let group=[],size=0;
for(const entry of entries){if(group.length&&size+entry[1].size>16*1048576){groups.push(group);group=[];size=0;}group.push(entry);size+=entry[1].size;}if(group.length)groups.push(group);
const packs=[];
for(const group of groups){const buffers=await Promise.all(group.map(([,info])=>readFile(info.file)));let offset=0;const index=group.map(([url],i)=>{const row={url,offset,length:buffers[i].length};offset+=row.length;return row;});const json=Buffer.from(JSON.stringify(index)),header=Buffer.alloc(12);header.write('WWPK');header.writeUInt32LE(1,4);header.writeUInt32LE(json.length,8);const hash=createHash('sha256').update(header).update(json);for(const b of buffers)hash.update(b);const file=hash.digest('hex').slice(0,20)+'.pack',output=path.join(folder,file);
  if(!await stat(output+'.gz').catch(()=>null)){await pipeline((async function*(){yield header;yield json;yield* buffers;})(),createWriteStream(output));await pipeline(createReadStream(output),createGzip({level:6}),createWriteStream(output+'.gz'));}
  packs.push({file,url:'/packs/'+file,bytes:12+json.length+offset,gzipBytes:(await stat(output+'.gz')).size,files:index.length});
}
const metadata={format:'waw-preload-v1',id:createHash('sha256').update(packs.map(p=>p.file).join('\n')).digest('hex').slice(0,20),navigationVersion:'dead-ops-navigation-v1',packs,files:entries.length,bytes:packs.reduce((n,p)=>n+p.bytes,0),gzipBytes:packs.reduce((n,p)=>n+p.gzipBytes,0)};
await writeFile(path.join(data,map.data,'preload.json'),JSON.stringify(metadata,null,2));console.log('Dead Ops Arcade prepared: '+entries.length+' native assets, '+(metadata.gzipBytes/1048576).toFixed(1)+' MB compressed.');
