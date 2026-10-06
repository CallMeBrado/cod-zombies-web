import {readFile,writeFile} from 'node:fs/promises';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
export async function prepareKinoDoors(){
  const manifest=await read('gameplay/bo1-kino/manifest.json'),navigation=await read('gameplay/bo1-kino/navigation.json');
  if(navigation.targetNavigation?.version==='kino-doors-v1')return;
  const game=new BlackOpsEngine(manifest,new CollisionWorld(await read('bo1-kino/web-world/zombie_theater.collision.json'),manifest.entities),await read('bo1-kino/web-world/zombie_theater.paths.json'));
  game.prepareSpawnPaths(navigation);const collision=game.collision,disabled=collision.disabled,rows=[];
  try{
    for(const key of game.linkCache.keys()){
      const [a,b]=key.split(',').map(Number),p=game.nodes[a].origin,q=game.nodes[b].origin;
      const lo=p.map((v,k)=>Math.min(v,q[k])-(k===2?18:18)),hi=p.map((v,k)=>Math.max(v,q[k])+(k===2?88:18));
      const targets=[...new Set(collision.brushes.filter(b=>b.target&&b.mins.every((v,k)=>v<=hi[k])&&b.maxs.every((v,k)=>v>=lo[k])).map(b=>b.target))].sort();
      if(!targets.length)continue;
      if(targets.length>8)throw new Error('Too many overlapping Kino gates to precompute safely: '+key);
      const values=[];for(let mask=0;mask<2**targets.length;mask++){
        collision.disabled=new Set(disabled);targets.forEach((t,i)=>{if(mask&(1<<i))collision.disabled.add(t);else collision.disabled.delete(t);});
        values.push(game.walkableLink(p,q,true));
      }rows.push([key,{targets,values}]);
    }
  }finally{collision.disabled=disabled;}
  navigation.targetNavigation={version:'kino-doors-v1',links:rows};
  await writeFile(new URL('../local-data/gameplay/bo1-kino/navigation.json',import.meta.url),JSON.stringify(navigation));
  console.log(`Prepared ${rows.length} Kino door/barrier edges for every local gate state.`);
}
if(process.argv[1]&&import.meta.url.endsWith('/'+process.argv[1].replaceAll('\\','/').split('/').at(-1)))await prepareKinoDoors();
