import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SoloGame} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const manifest=read('gameplay/der-riese/manifest.json'),collision=read('der-riese/web-world/nazi_zombie_factory.collision.json'),paths=read('der-riese/web-world/nazi_zombie_factory.paths.json'),navigation=read('gameplay/der-riese/navigation.json'),presentation=read('gameplay/der-riese/presentation.json');
const game=new SoloGame(manifest,new CollisionWorld(collision,manifest.entities),paths,{},presentation);game.prepareSpawnPaths(navigation);
const report={};let seed=173;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
assert.equal(game.mapRules.power,false);assert.equal(game.windows.length,29);assert.equal(game.availableWindows().length,4);
for(const window of game.availableWindows()){
  assert(game.spawnRoutes.get(window.target).choices.length,'Starting barrier needs a real prepared spawn path');
  assert(game.path(window.entry,game.player.position,true).length,'Starting zombies must be able to climb the mainframe stairs');
}
for(const spawn of manifest.entities.filter(e=>e.targetname==='initial_spawn_points')){
  game.spawn=spawn.origin.split(' ').map(Number);game.newGame();game.start();game.roundDue=1e6;
  const z=game.player.position[2];for(let i=0;i<720;i++)game.update(1/240,{});
  assert(game.player.grounded);assert(Math.abs(game.player.position[2]-z)<.1,'240 FPS spawn must stay on its floor');
}
game.spawn=manifest.entities.find(e=>e.targetname==='initial_spawn_points').origin.split(' ').map(Number);game.newGame();game.start();
const purchase=e=>{game.player.position=[e.position[0],e.position[1],e.position[2]-35];game.player.previousPosition=game.player.position.slice();assert.equal(game.nearInteraction()?.target,e.target);game.use();};
const east=game.interactions.find(e=>e.target==='outside_east_door');game.player.points=749;purchase(east);assert(!game.opened.has(east.target));assert.equal(game.player.points,749);
game.player.points=10000;purchase(east);assert(game.collision.disabled.has(east.target));assert(game.mapRules.activeZones().has('outside_east_zone'));assert(game.availableWindows().length>4);assert.equal(game.player.points,9250);
const wall=game.interactions.find(e=>e.zombie_weapon_upgrade==='zombie_m1carbine');purchase(wall);assert.equal(game.weapon.name,'zombie_m1carbine');assert.equal(game.player.points,8650);
const power=game.interactions.find(e=>e.targetname==='use_power_switch');const points=game.player.points;purchase(power);assert(game.mapRules.power);assert.equal(game.player.points,points);assert(game.collision.disabled.has('wnuen_bridge_clip'));assert(game.collision.disabled.has('outside_south_east_door'));
for(const e of game.interactions.filter(e=>e.script_flag))if(!game.opened.has(e.target)){game.player.points=100000;purchase(e);}
assert.equal(game.mapRules.activeZones().size,new Set(manifest.map.volumes.map(v=>v.name)).size);
for(const w of game.availableWindows())assert(game.spawnRoutes.get(w.target).choices.length,'Unlocked areas must never select unreachable roof/drop spawns');
report.spawns={totalBarriers:game.windows.length,preparedBarriers:game.availableWindows().length};
for(const [perk,health]of [['specialty_armorvest',250],['specialty_fastreload',250],['specialty_rof',250]]){
  purchase(game.interactions.find(e=>e.script_noteworthy===perk));assert(game.mapRules.perks.has(perk));assert.equal(game.mapRules.maxHealth,health);
}
game.weapon.clip=0;const reloadTime=game.weapon.definition.reloadEmptyTime;game.reload();assert.equal(game.reloadEnd-game.time,reloadTime*.5);game.reloadEnd=0;
const core=game.interactions.find(e=>e.targetname==='trigger_teleport_core');
for(let id=0;id<3;id++){purchase(game.interactions.find(e=>e.targetname==='trigger_teleport_pad_'+id));game.time+=2;purchase(core);assert(game.mapRules.links.has(id));}
assert(game.collision.disabled.has('pack_door_clip'));
const upgraded=game.weapon.definition.upgrade;purchase(game.interactions.find(e=>e.targetname==='zombie_vending_upgrade'));game.time+=3;game.mapRules.tick();assert.equal(game.weapon.name,upgraded);assert.equal(game.weapon.clip,game.weapon.definition.clipSize);
purchase(game.interactions.find(e=>e.targetname==='trigger_teleport_pad_0'));game.time+=2;game.mapRules.tick();assert(game.player.grounded);assert(Math.hypot(game.player.position[0]+88,game.player.position[1]-256)<1);
report.progression={allZones:game.mapRules.activeZones().size,teleporters:game.mapRules.links.size,upgradedWeapon:game.weapon.name,mainframe:game.player.position.slice(),perks:[...game.mapRules.perks]};
game.newGame();assert.equal(game.mapRules.links.size,0);assert.equal(game.mapRules.perks.size,0);assert(!game.mapRules.power);assert.equal(game.availableWindows().length,4);
// Play a complete first round with the original starting pistol, actual native
// collision/spawns, ordinary aim/fire/reload calls and normal player health.
game.start();game.ads=1;
for(let i=0;i<24000&&game.phase!=='dead'&&game.round<2;i++){
  const p=game.player.position,eye=[p[0],p[1],p[2]+60];
  const enemies=game.enemies.filter(e=>!e.dead).sort((a,b)=>Math.hypot(...a.position.map((v,k)=>v-eye[k]))-Math.hypot(...b.position.map((v,k)=>v-eye[k])));
  for(const enemy of enemies){const d=[enemy.position[0]-eye[0],enemy.position[1]-eye[1],enemy.position[2]+65-eye[2]];game.aim(Math.atan2(d[1],d[0]),Math.atan2(d[2],Math.hypot(d[0],d[1])));if(game.rayHit().hit){game.fire();break;}}
  if(!game.weapon.clip)game.reload();game.update(1/120,{});
}
report.round={round:game.round,kills:game.player.kills,health:game.player.health,time:game.time,stages:game.enemies.filter(e=>!e.dead).map(e=>({stage:e.stage,position:e.position,path:e.path?.length}))};
fs.writeFileSync(new URL('../local-data/der-riese-verification.json',import.meta.url),JSON.stringify(report,null,2));
assert.equal(game.round,2,'Starting pistol must be able to complete round one');assert(game.player.health>0);
console.log(JSON.stringify(report,null,2));
