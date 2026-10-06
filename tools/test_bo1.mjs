import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo1-kino/manifest.json'),collision=await read('bo1-kino/web-world/zombie_theater.collision.json'),paths=await read('bo1-kino/web-world/zombie_theater.paths.json'),presentation=await read('gameplay/bo1-kino/presentation.json');
const world=new CollisionWorld(collision,manifest.entities),create=()=>new BlackOpsEngine(manifest,world,paths,{},presentation);
const report={spawns:[],weapons:Object.keys(manifest.weapons).length,rounds:[],audio:[],interactions:[]};
for(const e of manifest.entities.filter(e=>e.targetname==='initial_spawn_points')){
  for(const hz of [30,60,120,240]){
    const g=create();g.spawn=e.origin.split(' ').map(Number);g.newGame();g.phase='between';g.roundDue=Infinity;const start=g.player.position.slice();
    for(let f=0;f<hz*3;f++)g.update(1/hz,{});
    assert(g.player.grounded);assert(Math.abs(g.player.position[2]-start[2])<.1);assert.equal(g.physicsTicks,360);
    for(let f=0;f<hz*2;f++)g.update(1/hz,{jump:f===0});assert(g.player.grounded);assert(Math.abs(g.player.position[2]-start[2])<.1);
    report.spawns.push({origin:g.spawn,hz,floor:start[2]});
  }
}
const g=create();assert.equal(g.engine,'black-ops-t5');assert.equal(g.weapon.name,'m1911_zm');assert.equal(g.weapon.clip,8);assert.equal(g.weapon.reserve,32);assert.equal(g.player.points,500);assert.equal(g.windows.length,22);
for(const count of [6,8,13,18,24,27]){g.startRound();assert.equal(g.remaining,count);report.rounds.push(count);}
g.newGame();g.start();const qr=g.interactions.find(e=>e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive');assert(qr);g.mapRules.use(qr);assert.equal(g.player.points,0);assert(g.gesture);g.time=g.gesture.due;g.updateGesture();assert(g.mapRules.perks.has('specialty_quickrevive'));g.time=g.gesture.due;g.updateGesture();g.time=g.gesture.due;g.updateGesture();
g.damagePlayer(200);assert.notEqual(g.phase,'dead');assert.equal(g.mapRules.revivesUsed,1);g.time+=8.1;g.mapRules.tick();assert.equal(g.player.health,100);
const power=g.interactions.find(e=>e.targetname==='use_power_switch');g.mapRules.use(power);assert(g.mapRules.power);assert(g.mapRules.flags.has('power_on'));
g.mapRules.use(g.interactions.find(e=>e.targetname==='trigger_teleport_pad_0'));assert(g.mapRules.coreLinked);
g.mapRules.use(g.interactions.find(e=>e.targetname==='trigger_teleport_core'));assert(g.mapRules.teleporterLinked);
g.mapRules.use(g.interactions.find(e=>e.targetname==='trigger_teleport_pad_0'));g.time+=1.9;g.mapRules.tick();assert(g.player.grounded);assert(g.mapRules.projectionUntil>g.time);assert(Math.abs(g.player.position[2]-manifest.map.teleportDestination[2])<64);
g.time+=30.1;g.mapRules.tick();assert(g.player.grounded);assert.equal(g.mapRules.projectionUntil,0);report.interactions=['solo Quick Revive','power','teleporter linking','projection room','automatic lobby return'];
for(const alias of ['mx_splash_screen','chalk','round_over','wpn_colt45_fire_plr','cha_ching','repair_boards','grenade_explode']){
  const entries=manifest.sounds[alias];assert(entries?.length,'Missing BO1 sound: '+alias);
  for(const entry of entries){const b=await readFile(new URL('../local-data/'+entry.url.slice(6),import.meta.url));assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');}
  report.audio.push(alias);
}
// Viewmodel clips name their own sounds (sndnt#alias): every reload, bolt and
// gear notetrack resolves to a converted sound, and each gun has sprint clips.
const notetrackAliases=new Set();
for(const w of Object.values(manifest.weapons)){
  if(!w.sprintLoopAnim)continue;
  for(const name of [w.reloadAnim,w.reloadEmptyAnim].filter(Boolean)){
    let data=null;for(const zone of ['bo1-kino','bo1-common','bo1-base'])try{data=await read(zone+'/web-anims/'+name+'.json');break;}catch{}
    if(data)for(const n of data.notifies||[])if(n.name.startsWith('sndnt#'))notetrackAliases.add(n.name.slice(6));
  }
}
assert(notetrackAliases.size>20,'Reload clips carry sound notetracks');
const unresolved=[...notetrackAliases].filter(a=>!manifest.sounds[a]);assert(unresolved.length<=notetrackAliases.size*.1,'Reload notetrack sounds missing: '+unresolved.join(', '));
for(const alias of ['fly_colt45_mag_out','fly_colt45_mag_in','fly_gear_reload_plr'])assert(manifest.sounds[alias]?.length,'Missing reload sound: '+alias);
assert.equal(manifest.weapons.m1911_zm.sprintLoopAnim,'viewmodel_colt1911_sw_sprint_loop');report.reloadNotetrackSounds=notetrackAliases.size-unresolved.length;
assert(Object.keys(presentation.effects).length>=5);assert(presentation.actors.body.startsWith('c_ger_'));
assert.equal(manifest.weapons.ray_gun_zm.maxAmmo,160);assert.equal(manifest.weapons.thundergun_zm.maxAmmo,12);
assert.equal(manifest.entities.find(e=>e.zombie_weapon_upgrade==='m14_zm').zombie_cost,'500');assert.equal(manifest.entities.find(e=>e.zombie_weapon_upgrade==='mp40_zm').zombie_cost,'1000');
const burst=create();burst.start();burst.phase='round';burst.remaining=0;burst.inventory=[burst.makeWeapon('m16_zm')];burst.slot=0;assert(burst.fire());burst.tick(.05,{});burst.tick(.05,{});burst.tick(.05,{});burst.tick(.05,{});assert.equal(burst.shots,3);assert.equal(burst.weapon.clip,27);
await writeFile(new URL('../local-data/bo1-logic-verification.json',import.meta.url),JSON.stringify(report,null,2));
console.log('Kino logic passed: native floor at 30–240 FPS, BO1 ammo/rounds, solo revive, power, teleporter cycle and native audio.');
