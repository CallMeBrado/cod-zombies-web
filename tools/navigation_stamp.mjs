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
  for(const name of ['rayHits','rayHit','fire','autoReload','melee','resolveMelee'])if(SoloGame.prototype[name])game=game.replace(SoloGame.prototype[name].toString(),'');
  game=game.replace(/^    this\.autoReload\(\);\r?\n/m,'');
  game=game.replace(/^    enemy\.deathHeadshot=!!head&&!melee;\r?\n/m,'');
  game=game.replace(/^import .*from '\.\/ballistics\.js';\r?\n/m,'');
  game=game.replace(/^import .*from '\.\/knife-lunge\.js';\r?\n/m,'');
  game=game.replace(/^    if\(moveKnifeLunge\(this,dt,input\)\)input=\{\.\.\.input,forward:0,side:0,sprint:false,jump:false\};\r?\n/m,'');
  // Analog input scales player speed; prepared NPC hull paths do not use it.
  game=game.replace(/^    const movementScale=Number\.isFinite\(input\.movementScale\)\?Math\.max\(0,Math\.min\(1,input\.movementScale\)\):1;\r?\n/m,'');
  game=game.replace('*this.weapon.definition.moveSpeedScale*movementScale;','*this.weapon.definition.moveSpeedScale;');
  hash.update(game.split(/\r?\n/).filter(line=>line.trim()).join('\n'));
  for(const name of ['map-rules.js','collision.js','native-triangles.js'])hash.update(await readFile(path.join(root,'web',name)));
  if(chosen.game==='black-ops'){
    const source=await readFile(path.join(root,'web/bo1-engine.js'),'utf8'),start=source.indexOf('export class BlackOpsEngine');
    hash.update(source.slice(start,source.indexOf('  newGame(){',start)));hash.update(BlackOpsEngine.prototype.settleFeet.toString());
  }
  return hash.digest('hex');
}
