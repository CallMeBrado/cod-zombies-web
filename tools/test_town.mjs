import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TownEngine} from '../web/bo2-town-engine.js';
import {TownRules} from '../web/bo2-town.js';
import {CollisionWorld,PLAYER_CONTENTS} from '../web/collision.js';
import {validateMapModels} from './validate_map_models.mjs';
import {mapById} from '../web/maps.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const [m,p,c,n,nav,gates,w]=await Promise.all(['gameplay/bo2-town/manifest.json','gameplay/bo2-town/presentation.json','bo2-town/web-world/zm_transit_town.collision.json','bo2-town/web-world/zm_transit_town.paths.json','gameplay/bo2-town/navigation.json','gameplay/bo2-town/gate-navigation.json','bo2-town/web-world/zm_transit_town.json'].map(read));
await validateMapModels('town');
assert.equal(mapById('town').menuPlace,'zm_transit');assert.notEqual(mapById('town').asset,mapById('tranzit').asset);
assert(w.staticModels.length<2000);assert(w.surfaces.length<7000);assert.equal(m.map.nativeBoundary.length,4);
const g=new TownEngine(structuredClone(m),new CollisionWorld(c,m.entities),n,{},p);g.prepareSpawnPaths(nav);g.useGateNavigation(gates);const r=g.mapRules;
assert(r instanceof TownRules);assert(!r.lavaAt(g.player.position),'Solo start is on original safe pavement');assert(r.power);assert.equal(g.weapon.name,'m1911_zm');assert.equal(g.weapon.clip,8);assert.equal(g.weapon.reserve,32);
assert.equal(g.activeBox,'town_chest');assert.deepEqual([...g.boxes.keys()].sort(),['town_chest','town_chest_2']);
assert.equal(g.interactions.filter(e=>e.targetname==='zombie_vending').length,5);assert.equal(g.interactions.filter(e=>e.targetname==='zombie_vending_upgrade').length,1);
assert(!g.interactions.some(e=>e.targetname.startsWith('tranzit_')||e.targetname.startsWith('buried_')));
assert(!m.entities.some(e=>e.script_noteworthy==='specialty_scavenger'),'Tombstone is removed in native solo Survival');
for(const name of ['m14_zm','mp5k_zm','rottweil72_zm','tazer_knuckles_zm'])assert(g.interactions.some(e=>e.zombie_weapon_upgrade===name),name);
assert(!g.interactions.some(e=>['m16_zm','870mcs_zm'].includes(e.zombie_weapon_upgrade)),'Unused race wall weapons must not leak into Survival');
for(const alias of ['chalk','round_over','cha_ching','repair_boards','wpn_knife_pull_plr'])assert(m.sounds[alias]?.length,alias);
g.start();g.mods.god=true;
for(const fps of [30,60,120,240]){const z=g.player.position[2];for(let i=0;i<fps;i++)g.update(1/fps,{});assert(Math.abs(g.player.position[2]-z)<1,'Floor stable at '+fps+' FPS');}
for(const e of m.entities.filter(e=>e.targetname==='initial_spawn_points'))assert(g.settleFeet(e.origin.split(' ').map(Number))[2]>-100);
for(const b of m.map.nativeBoundary){const mid=b.mins.map((v,k)=>(v+b.maxs[k])/2);assert(g.collision.trace(mid,mid,[1,1,1],PLAYER_CONTENTS).allSolid,'Native Survival exit is solid');}
console.log('Town: native asset pack, Survival-only entities, power, two boxes, floors at 30–240 FPS and original exit collision passed.');
g.player.points=50000;const jug=g.interactions.find(e=>e.script_noteworthy==='specialty_armorvest'),points=g.player.points;r.use(jug);assert.equal(g.player.points,points-2500);
for(let i=0;i<600;i++)g.update(.01,{});assert(r.perks.has('specialty_armorvest'));assert.equal(r.maxHealth,250);
const knuckles=g.interactions.find(e=>e.zombie_weapon_upgrade==='tazer_knuckles_zm');r.use(knuckles);assert.equal(r.meleeUpgrade,'tazer_knuckles_zm');
for(const e of g.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname))){g.openDoor(e);assert(g.collision.disabled.has(e.target));}
const pap=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade');g.gesture=null;assert(!r.prompt(pap,'E').includes('not available'));r.use(pap);assert.equal(r.pap?.upgraded,'m1911_upgraded_zm');r.pap=null;
const state=JSON.parse(JSON.stringify(g.saveState()));g.loadState(state);assert(r.power);assert(r.perks.has('specialty_armorvest'));assert.equal(r.meleeUpgrade,'tazer_knuckles_zm');
for(const h of m.map.hazards.flatMap(x=>x.hulls)){const at=h.mins.map((v,k)=>(v+h.maxs[k])/2);at[2]-=3;if(!r.lavaAt(at))continue;assert(!r.lavaAt([at[0],at[1],h.maxs[2]+60]),'Jump clears native lava volume');g.player.position=at;g.mods.god=false;g.invulnerableUntil=0;g.lastDamage=-100;g.player.health=250;r.lavaDue=0;r.tick();assert(g.player.health<250);g.mods.god=true;break;}
console.log('Town: perks, doors, Galvaknuckles, starting pistol Pack-a-Punch, named-session state and jumping over native lava passed.');
g.newGame();g.mods.god=true;g.start();let elapsed=0,approached=0;const began=performance.now();
while(g.round<4&&elapsed<600){g.update(.05,{});elapsed+=.05;for(const e of g.enemies)if(!e.dead&&e.stage==='hunt'&&Math.hypot(...e.position.map((v,k)=>v-g.player.position[k]))<130){g.hitEnemy(e,e.health*10,true);approached++;}}
assert(g.round>=4,'Three natural Town rounds complete: '+JSON.stringify({round:g.round,remaining:g.remaining,enemies:g.enemies.filter(e=>!e.dead).map(e=>({stage:e.stage,p:e.position,path:e.path.length}))}));
assert(approached>=20);console.log('Town: three natural rounds, '+approached+' zombies reached player in '+elapsed.toFixed(1)+' simulated seconds ('+((performance.now()-began)/1000).toFixed(1)+' seconds CPU).');
