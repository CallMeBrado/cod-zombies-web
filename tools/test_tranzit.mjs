import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BlackOps2Engine} from '../web/bo2-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {validateMapModels} from './validate_map_models.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo2-tranzit/manifest.json'),presentation=await read('gameplay/bo2-tranzit/presentation.json');
const collision=await read('bo2-tranzit/web-world/zm_transit.collision.json'),paths=await read('bo2-tranzit/web-world/zm_transit.paths.json');
await validateMapModels('tranzit');
const make=()=>new BlackOps2Engine(structuredClone(manifest),new CollisionWorld(collision,manifest.entities),paths,{},presentation);
const g=make(),r=g.mapRules;
assert.equal(g.data.map.id,'tranzit');assert(g.player.grounded);assert(!r.power);assert.equal(g.windows.length,38);
assert(g.player.position.every(Number.isFinite));assert(g.interactions.some(e=>e.targetname==='tranzit_bus'));
assert(g.data.map.fallDeathZ<-850,'The power room must be above the fall-death threshold');
for(const name of ['mx_zombie_wave_1','zmb_bus_engine_loop','zmb_bus_horn','repair_boards'])assert(g.data.sounds[name]?.length,name);
assert(g.hipSpread().min<=g.hipSpread().max);assert(Object.values(g.hipSpread()).every(Number.isFinite));
assert(!g.interactions.some(e=>e.targetname==='buried_arthur'));
const choices=Object.values(r.partChoices);assert.equal(new Set(choices).size,20);
assert(g.entities.filter(e=>e.tranzitPart&&r.visible(e)).length===20);
// Every original Turbine part has its own pickup; hold-to-build consumes each
// exactly once and does not permit a power-switch part at the Turbine bench.
g.start();const bench=g.interactions.find(e=>e.tranzitBench==='turbine');
for(const part of g.interactions.filter(e=>e.tranzitPart==='turbine'&&r.visible(e))){
  r.use(part);assert.equal(r.carry.equipment,'turbine');g.useHeld=true;r.use(bench);assert(r.equipment.building);
  g.time+=3.01;r.equipment.tick(.01);assert(!r.carry);assert(!r.visible(part));
}
assert(r.built.has('turbine'));r.use(bench);assert.equal(r.equipment.held.kind,'turbine');
const powerPart=g.interactions.find(e=>e.tranzitPart==='powerswitch'&&r.visible(e));r.use(powerPart);r.use(bench);assert(!r.equipment.building,'Fixed benches reject the wrong part');r.carry=null;
const power=g.interactions.find(e=>e.targetname==='tranzit_power');r.use(power);assert(!r.power,'Power cannot start before assembly');r.built.add('powerswitch');r.use(power);assert(r.power);r.use(power);assert(!r.power);
// The real 278-node bus loop reaches all five stops, carries its rider, and
// keeps the same route/fraction/position when saving on a moving bus.
r.bus.due=g.time;r.updateBus(.05);assert(r.bus.moving&&!r.bus.doors);r.riding=true;r.riderLocal=[150,0,36];
const seen=new Set(['depot']);for(let i=0;i<18000&&seen.size<5;i++){g.time+=.05;r.updateBus(.05);if(r.bus.stop){seen.add(r.bus.stop);r.bus.due=g.time;}}
assert.deepEqual([...seen].sort(),['depot','diner','farm','power','town']);assert.deepEqual(g.player.position,r.world(r.riderLocal));
const saved=g.saveState(),restored=make();restored.loadState(saved);assert.deepEqual(restored.mapRules.bus,r.bus);assert(restored.mapRules.riding);assert.deepEqual(restored.mapRules.partChoices,r.partChoices);assert(restored.mapRules.built.has('turbine'));
const before=r.riderLocal[0];r.movePlayer(g.player,{forward:1,side:0},.1);assert(Math.abs(r.riderLocal[0]-before)>5,'Rider movement uses normal player speed');
const clear={fraction:1,normal:[0,0,0],solid:false,allSolid:false};
const sideStart=r.world([150,140,70]),sideEnd=r.world([150,0,70]);assert(r.busTrace(sideStart,sideEnd,[14,14,35],clear).fraction<1,'Bus sides block walking hulls');
assert.equal(r.busTrace(sideStart,sideEnd,[0,0,0],clear).fraction,1,'Gameplay hulls do not seal grenade/bullet openings');
const roof=r.world([150,0,178+35]);assert(!r.busTrace(roof,r.world([151,0,178+35]),[14,14,35],clear).allSolid,'Roof contact permits tangential movement');
const avog=r.specialEnemy('avogadro',g.player.position.map((v,k)=>v+(k===0?120:0)));g.hitEnemy(avog,99999);assert.equal(avog.health,4);g.powerup.insta_kill=g.time+30;g.hitEnemy(avog,99999,false,true);assert.equal(avog.health,3);r.meleeUpgrade='tazer_knuckles_zm';g.hitEnemy(avog,99999,false,true);assert.equal(avog.health,1);g.hitEnemy(avog,99999,false,true);assert(avog.dead);delete g.powerup.insta_kill;
assert(avog.ignoreRound);g.powerup.fire_sale=g.time+30;assert.equal(r.boxCost({zombie_cost:'950'}),10);assert(!r.boxJoker());
const nav=await read('gameplay/bo2-tranzit/navigation.json').catch(()=>null);if(nav){g.prepareSpawnPaths(nav);g.useGateNavigation(await read('gameplay/bo2-tranzit/gate-navigation.json'));g.newGame();g.start();g.remaining=6;g.spawnEnemy();assert(g.enemies.length,'The starting Depot spawns an actual zombie');}
console.log('TranZit quick logic check passed: native floor, finite firing spread, parts/benches/power, five bus stops/rider/save, Avogadro melee and Fire Sale.');
