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
// Advance the gesture and map timelines without running zombies.
const wait=seconds=>{for(let t=0;t<seconds;t+=1/120){game.time+=1/120;game.updateGesture();game.mapRules.tick();}};
const sounds=[];game.events.sound=s=>sounds.push(s);
for(const [perk,health,sting]of [['specialty_armorvest',250,'mx_jugger_sting'],['specialty_fastreload',250,'mx_speed_sting'],['specialty_rof',250,'mx_doubletap_sting']]){
  const machine=game.interactions.find(e=>e.script_noteworthy===perk),before=game.player.points;sounds.length=0;
  purchase(machine);assert(game.player.points<before);assert(!game.mapRules.perks.has(perk),'The perk is set after the drink, not on purchase');
  // perk_give_bottle_begin: the bottle replaces the gun and actions are disabled.
  assert.equal(game.gesture?.phase,'raise');assert.equal(game.fire(),false);assert.equal(game.throwGrenade(),false);
  const stung=sounds.find(s=>s.alias===sting);assert(stung?.position,'The sting plays at the machine, not on the player');
  assert(sounds.some(s=>s.alias==='bottle_dispense3d'&&s.position));
  wait(game.data.gestures[perk].firstRaiseTime+.05);assert(game.mapRules.perks.has(perk));assert.equal(game.mapRules.maxHealth,health);
  wait(1.5);assert.equal(game.gesture,null,'The gun is raised again after the bottle is lowered');
}
game.weapon.clip=0;const reloadTime=game.weapon.definition.reloadEmptyTime;game.reload();assert(Math.abs(game.reloadEnd-game.time-reloadTime*.5)<1e-9);game.reloadEnd=0;
const core=game.interactions.find(e=>e.targetname==='trigger_teleport_core');
for(let id=0;id<3;id++){purchase(game.interactions.find(e=>e.targetname==='trigger_teleport_pad_'+id));game.time+=2;purchase(core);assert(game.mapRules.links.has(id));}
assert(game.collision.disabled.has('pack_door_clip'));
const pap=game.interactions.find(e=>e.targetname==='zombie_vending_upgrade'),loops=[];game.events.loop=l=>loops.push(l.id);game.events.stopLoop=l=>loops.splice(loops.indexOf(l.id),1);wait(.1);
assert(loops.includes('packa_rollers'),'Pack-a-Punch rollers hum starts once all teleporters are linked');
// vending_upgrade: the gun goes into the machine; take it before the timeout.
const original=game.weapon.name,upgraded=game.weapon.definition.upgrade;purchase(pap);
assert(!game.inventory.some(w=>w.name===original),'The weapon is taken while it is upgraded');assert.equal(game.gesture?.key,'knuckle_crack');
wait(4.3);assert.notEqual(game.mapRules.pap.phase,'ready');wait(.1);assert.equal(game.mapRules.pap.phase,'ready');assert(loops.includes('packa_timer'));
purchase(pap);assert.equal(game.weapon.name,upgraded);assert.equal(game.weapon.clip,game.weapon.definition.clipSize);assert.equal(game.weapon.reserve,game.weapon.definition.maxAmmo);
assert.equal(game.mapRules.pap,null);assert(!loops.includes('packa_timer'));
// wait_for_timeout: an upgrade left in the machine for 15 s is lost.
game.giveWeapon('zombie_mp40');const lost=game.weapon.definition.upgrade;sounds.length=0;purchase(pap);wait(4.4+15.1);
assert.equal(game.mapRules.pap,null);assert(!game.inventory.some(w=>w.name===lost||w.name==='zombie_mp40'));assert(sounds.some(s=>s.alias==='packa_deny'&&s.position));
game.giveWeapon(upgraded);
purchase(game.interactions.find(e=>e.targetname==='trigger_teleport_pad_0'));game.time+=2;game.mapRules.tick();assert(game.player.grounded);assert(Math.hypot(game.player.position[0]+88,game.player.position[1]-256)<1);
report.progression={allZones:game.mapRules.activeZones().size,teleporters:game.mapRules.links.size,upgradedWeapon:game.weapon.name,mainframe:game.player.position.slice(),perks:[...game.mapRules.perks],packAPunchTimeout:true};
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
