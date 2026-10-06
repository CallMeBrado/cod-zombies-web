import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SoloGame,POWER_NAVIGATION_VERSION} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';

export async function prepareFactoryPowerNavigation(data,navigation){
  const read=async file=>JSON.parse(await readFile(path.join(data,file),'utf8'));
  const output=path.join(data,'gameplay/der-riese/power-navigation.json');
  const previous=await read('gameplay/der-riese/power-navigation.json').catch(()=>null);
  if(previous?.sourceStamp===navigation.sourceStamp&&previous.version===POWER_NAVIGATION_VERSION)return previous;
  const began=performance.now(),[manifest,collision,paths]=await Promise.all([read('gameplay/der-riese/manifest.json'),read('der-riese/web-world/nazi_zombie_factory.collision.json'),read('der-riese/web-world/nazi_zombie_factory.paths.json')]);
  const game=new SoloGame(manifest,new CollisionWorld(collision,manifest.entities),paths);
  game.prepareSpawnPaths(navigation);game.preparePowerNavigation();
  const prepared={...game.preparedPowerNavigation(),sourceStamp:navigation.sourceStamp};
  await writeFile(output,JSON.stringify(prepared));
  console.log(`Prepared ${prepared.links.length} powered links (${prepared.links.reduce((n,[,v])=>n+v.values.length,0)} door/barrier states) on E: in ${((performance.now()-began)/1000).toFixed(2)} seconds.`);
  return prepared;
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
  const data=fileURLToPath(new URL('../local-data/',import.meta.url));
  const navigation=JSON.parse(await readFile(path.join(data,'gameplay/der-riese/navigation.json'),'utf8'));
  await prepareFactoryPowerNavigation(data,navigation);
}
