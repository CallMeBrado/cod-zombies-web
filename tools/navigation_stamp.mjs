import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';

// Combat tuning and weapon metadata do not change a walking/navigation graph.
export async function navigationStamp(root,chosen,manifest){
  const data=path.join(root,'local-data'),hash=createHash('sha256').update('navigation-inputs-geometry-v1');
  for(const type of ['collision','paths'])hash.update(await readFile(path.join(data,chosen.zone,'web-world',chosen.asset+'.'+type+'.json')));
  hash.update(JSON.stringify({entities:manifest.entities,map:manifest.map,variables:manifest.variables}));
  let game=await readFile(path.join(root,'web/game.js'),'utf8');
  for(const name of ['rayHits','rayHit','fire','autoReload'])if(SoloGame.prototype[name])game=game.replace(SoloGame.prototype[name].toString(),'');
  game=game.replace(/^    this\.autoReload\(\);\r?\n/m,'');
  game=game.replace(/^import .*from '\.\/ballistics\.js';\r?\n/m,'');
  hash.update(game.split(/\r?\n/).filter(line=>line.trim()).join('\n'));
  for(const name of ['map-rules.js','collision.js','native-triangles.js'])hash.update(await readFile(path.join(root,'web',name)));
  if(chosen.game==='black-ops'){
    const source=await readFile(path.join(root,'web/bo1-engine.js'),'utf8'),start=source.indexOf('export class BlackOpsEngine');
    hash.update(source.slice(start,source.indexOf('  newGame(){',start)));hash.update(BlackOpsEngine.prototype.settleFeet.toString());
  }
  return hash.digest('hex');
}
