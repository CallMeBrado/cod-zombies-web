import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {BlackOps2Engine} from '../web/bo2-engine.js';
import {MoonEngine,MoonRules} from '../web/bo1-moon.js';
import {ShangriEngine} from '../web/bo1-shangri.js';

// Combat tuning and weapon metadata do not change a walking/navigation graph.
export async function navigationStamp(root,chosen,manifest){
  const data=path.join(root,'local-data'),hash=createHash('sha256').update('navigation-inputs-geometry-v1');
  for(const type of ['collision','paths'])hash.update(await readFile(path.join(data,chosen.zone,'web-world',chosen.asset+'.'+type+'.json')));
  hash.update(JSON.stringify({entities:manifest.entities,map:manifest.map,variables:manifest.variables}));
  let game=await readFile(path.join(root,'web/game.js'),'utf8');
  for(const name of ['rayHits','rayHit','fire','autoReload','melee','resolveMelee'])if(SoloGame.prototype[name])game=game.replace(SoloGame.prototype[name].toString(),'');
  // Stances/dive change only player movement. Canonicalize their additions
  // back to the standing player path; NPC hulls and link walkers are unchanged.
  for(const name of ['changeStance','stanceButton','releaseStance','hipSpread'])game=game.replace(SoloGame.prototype[name].toString(),'');
  for(const name of ['viewHeight','playerHull','movementBlocked'])game=game.replace(Object.getOwnPropertyDescriptor(SoloGame.prototype,name).get.toString(),'');
  const ground=SoloGame.prototype.groundBelow.toString();game=game.replace(ground,ground.replace(/^    const half=this\.playerHull;\r?\n/m,'').replace(',half);',',[14,14,35]);').replace('-half[2]','-35').replace('+half[2]','+35'));
  game=game.replace(/^import .*from '\.\/player-movement\.js';\r?\n/m,'');
  game=game.replace(/^    (resetMovement\(this\)|restoreMovement\(this,s\.player\.stance\)|movementFrame\(this,input\)|input=movementInput\(this,input,dt\));\r?\n/gm,'');
  game=game.replace(/^    if\(!moveDive\(this,dt(?:,input)?\)\)\{\r?\n/m,'').replace(/^    \}\r?\n    movementEnd\(this,dt\);\r?\n    const p=this\.player;\r?\n/m,'');
  game=game.replace("&&this.player.stance==='stand'&&!this.movementBlocked",'').replace('*movementScale*playerSpeed(this);','*movementScale;').replaceAll(',this.playerHull)',')');
  game=game.replace(',stance:this.player.stance','').replace('&&!this.dive&&!this.diveRecovery;',';').replace('&&!this.dive;',';').replace(/if\(this.dive\|\|(?:this.diveRecovery\|\|)?this.gesture/,'if(this.gesture');
  game=game.replace(/^    if\(this\.(dive(?:\|\|this.diveRecovery)?|movementBlocked)\)return false;\r?\n/gm,'').replace('origin[2]+this.viewHeight','origin[2]+60');
  game=game.replace('this.player.position[2]+Math.max(3,this.viewHeight-20)','this.player.position[2]+40').replace('const damage=(p,height=35)=>','const damage=p=>').replace('p[2]+height],range=distance(center,g.position)','p[2]+35],range=distance(center,g.position)').replace('damage(this.player.position,this.playerHull[2])','damage(this.player.position)');
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
  if(['black-ops','black-ops-2'].includes(chosen.game)){
    const source=await readFile(path.join(root,'web/bo1-engine.js'),'utf8'),start=source.indexOf('export class BlackOpsEngine');
    hash.update(source.slice(start,source.indexOf('  newGame(){',start)));hash.update(BlackOpsEngine.prototype.settleFeet.toString());
  }
  if(chosen.game==='black-ops-2')for(const method of ['settleFeet','projectGround','walkableLink'])hash.update(BlackOps2Engine.prototype[method].toString());
  if(chosen.id==='tranzit')hash.update(await readFile(path.join(root,'web/bo2-tranzit.js')));
  if(chosen.id==='shi-no-numa')hash.update(await readFile(path.join(root,'web/waw-shi-no-numa.js')));
  if(chosen.id==='moon'){
    // Moon's combat, oxygen and excavator timers do not alter prepared links.
    const source=await readFile(path.join(root,'web/bo1-moon.js'),'utf8');
    hash.update(source.slice(source.indexOf('  constructor(g)'),source.indexOf('  reset()')));
    for(const name of ['prepareSpawnPaths','invalidateNavigation','settleActor'])hash.update(MoonEngine.prototype[name].toString());
    hash.update(MoonRules.prototype.doorUnlocked.toString());
  }
  if(chosen.id==='shangri-la'){hash.update(ShangriEngine.toString().split('  startRound()')[0]);hash.update(ShangriEngine.prototype.settleActor.toString());}
  return hash.digest('hex');
}
