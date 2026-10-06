import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SoloGame,GATE_NAVIGATION_VERSION,NAVIGATION_VERSION} from '../web/game.js';
import {BlackOps2Engine} from '../web/bo2-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {mapById} from '../web/maps.js';

// Door, barrier and power-brush navigation states for a WaW map, validated on
// the host so opening anything during play needs no physics sweeps. Repeated
// only when the prepared navigation graph (its source stamp) changes.
export async function prepareGateNavigation(data,map,navigation,existingGame=null){
  const read=async file=>JSON.parse(await readFile(path.join(data,file),'utf8'));
  const output=path.join(data,map.data,'gate-navigation.json');
  const previous=await read(path.join(map.data,'gate-navigation.json')).catch(()=>null);
  if(previous?.sourceStamp===navigation.sourceStamp&&previous.version===GATE_NAVIGATION_VERSION&&previous.navigationVersion===NAVIGATION_VERSION)return previous;
  const began=performance.now();let game=existingGame;
  if(!game){const [manifest,collision,paths]=await Promise.all([read(map.data+'/manifest.json'),read(map.zone+'/web-world/'+map.asset+'.collision.json'),read(map.zone+'/web-world/'+map.asset+'.paths.json')]);
    game=new (map.game==='black-ops-2'?BlackOps2Engine:SoloGame)(manifest,new CollisionWorld(collision,manifest.entities),paths);}
  game.prepareSpawnPaths(navigation);
  const prepared={...game.computeGateNavigation(),sourceStamp:navigation.sourceStamp};
  await writeFile(output,JSON.stringify(prepared));
  console.log(`Prepared ${prepared.links.length} door/barrier navigation links (${prepared.links.reduce((n,[,v])=>n+v.values.length,0)} states) for ${map.title} on E: in ${((performance.now()-began)/1000).toFixed(1)} seconds.`);
  return prepared;
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
  const data=fileURLToPath(new URL('../local-data/',import.meta.url));
  for(const id of process.argv.slice(2).length?process.argv.slice(2):['nacht','der-riese']){
    const map=mapById(id),navigation=JSON.parse(await readFile(path.join(data,map.data,'navigation.json'),'utf8'));
    await prepareGateNavigation(data,map,navigation);
  }
}
