import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BlackOps2Engine} from '../web/bo2-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {validateMapModels} from './validate_map_models.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo2-die-rise/manifest.json'),presentation=await read('gameplay/bo2-die-rise/presentation.json');
const collision=await read('bo2-die-rise/web-world/zm_highrise.collision.json'),paths=await read('bo2-die-rise/web-world/zm_highrise.paths.json');
await validateMapModels('die-rise');
const make=()=>new BlackOps2Engine(structuredClone(manifest),new CollisionWorld(collision,manifest.entities),paths,{},presentation);
const g=make(),r=g.mapRules,m=g.data.map;
assert.equal(m.id,'die-rise');assert(g.player.grounded,'The rooftop start has a floor');assert(g.player.position.every(Number.isFinite));assert(!r.power);
assert.equal(g.windows.length,51);assert.equal(m.elevators.length,7);
for(const name of ['mx_zombie_wave_1','zmb_elevator_ding','zmb_elevator_run','repair_boards','mx_whoswho_sting','mx_mule_sting','dog_start'])assert(g.data.sounds[name]?.length,name);
assert(Object.values(g.hipSpread()).every(Number.isFinite));
// init_elevator_perks(): Quick Revive rides 1b; Who's Who and Speed Cola the
// other green cars; Mule Kick, Jugg, Double Tap and Pack-a-Punch the blue ones.
assert.equal(r.machineCar.specialty_quickrevive,'1b');
assert.deepEqual([r.machineCar.specialty_finalstand,r.machineCar.specialty_fastreload].sort(),['1c','1d']);
assert.deepEqual(['specialty_additionalprimaryweapon','specialty_armorvest','specialty_rof','specialty_weapupgrade'].map(p=>r.machineCar[p]).sort(),['3','3b','3c','3d']);
assert.equal(new Set(['3','3b'].map(n=>r.cars[n].z)).size,2,'Cars 3 and 3b start on different stops');
// Before the power only the solo Quick Revive car opens.
g.start();for(let i=0;i<20;i++){g.time+=.1;r.tick();}
assert.equal(r.cars['1d'].phase,'power');assert.notEqual(r.cars['1b'].phase,'power');
const quick=g.interactions.find(e=>e.script_noteworthy==='specialty_quickrevive'),qp=r.machinePose('specialty_quickrevive');
assert(Math.abs(quick.position[2]-qp.position[2]-35)<1e-6,'The Quick Revive prompt follows its machine');
// The power switch starts every car; each visits its stops in order and
// carries its machine and a rider standing in it.
r.use(g.interactions.find(e=>e.targetname==='use_power_switch'));assert(r.power);assert(r.activeZones().has('zone_blue_level4b'));
const car=m.elevators.find(c=>c.name==='1b'),s=r.cars['1b'];s.phase='cycle';s.skip=true;
const frame=r.frame(car),inside=[...frame.position];inside[2]+=1;g.player.position=inside.slice();g.player.previousPosition=inside.slice();
const startZ=s.z;let moved=false;for(let i=0;i<400;i++){g.time+=.05;r.tick();if(s.phase==='moving')moved=true;if(moved&&s.phase!=='moving')break;}
assert(moved&&s.z!==startZ,'1b leaves its stop');assert(Object.values(car.floors).includes(s.z),'1b stops on an authored floor');
assert(Math.abs(g.player.position[2]-(s.z+1))<1e-6,'A rider moves with the car');
const pose=r.machinePose('specialty_quickrevive');assert(Math.abs(pose.position[2]-(qp.position[2]+s.z-startZ))<1e-6,'The machine rides its car');
// The moving floor holds up a walking hull.
const clear={fraction:1,normal:[0,0,0],solid:false,allSolid:false},above=[frame.position[0],frame.position[1],s.z+40];
assert(r.platformTrace(above,[above[0],above[1],s.z-40],[14,14,35],clear).fraction<1,'The car floor is solid');
assert.equal(r.platformTrace(above,[above[0],above[1],s.z-40],[0,0,0],clear).fraction,1,'Shots pass the gameplay hull boxes');
// Stops follow elevator_next_floor(): 1, 2, ... then "0".
const order=[],t=r.cars['1d'],c1d=m.elevators.find(c=>c.name==='1d');t.phase='cycle';t.skip=false;
for(let i=0;i<40000&&order.length<5;i++){g.time+=.05;const before=t.phase;r.updateCar(c1d,t,.05);if(before==='moving'&&t.phase!=='moving')order.push(t.floor);}
assert.deepEqual(order,['1','2','3','0','1']);
// The escape pod drops once a player has stood in it for 3 s, and the key
// at the ground floor console brings it back.
const pod=m.escapePod;g.player.position=[pod.home[0],pod.home[1],pod.home[2]+1];g.player.previousPosition=g.player.position.slice();
for(let i=0;i<200&&r.pod.state!=='bottom';i++){g.time+=.05;r.updatePod(.05);}
assert.equal(r.pod.state,'bottom');assert(Math.abs(g.player.position[2]-(pod.bottom[2]+1))<1e-6,'The pod carries its rider down');
const key=g.interactions.find(e=>e.riseKey&&r.visible(e));r.use(key);assert.equal(r.carry.kind,'key');
r.use(g.interactions.find(e=>e.targetname==='rise_pod_console'));assert(!r.carry);assert.equal(r.pod.state,'rocking');
for(let i=0;i<400&&r.pod.state!=='top';i++){g.time+=.05;r.updatePod(.05);}assert.equal(r.pod.state,'top');
// Parts: one native candidate per part; a full bench gives the Sliquifier once.
assert.equal(g.interactions.filter(e=>e.risePart&&r.visible(e)).length,8);
const bench=g.interactions.find(e=>e.riseBench==='slipgun_zm');
for(const part of g.interactions.filter(e=>e.risePart==='slipgun_zm'&&r.visible(e))){r.use(part);g.useHeld=true;r.use(bench);g.time+=3.01;r.equipment.tick(.01);}
r.use(bench);assert(g.inventory.some(w=>w.name==='slipgun_zm'));assert(g.data.map.boxWeapons.includes('slipgun_zm'));
// Leaper rounds: round 5-7 first, six per player, 400 health.
assert(r.nextLeaperRound>=5&&r.nextLeaperRound<=7);
const count=r.roundCount(r.nextLeaperRound,1);assert.equal(count,6);assert(r.leaperRound);assert.equal(r.maxAlive(),2);
// Who's Who: a fatal hit leaves the body; reviving it restores the loadout.
r.perks.add('specialty_finalstand');r.perks.add('specialty_armorvest');const guns=g.inventory.map(w=>w.name);g.player.health=10;
g.damagePlayer(500);assert(r.whosWho);assert.notEqual(g.phase,'dead');assert.equal(g.inventory.length,1);
r.reviveBody();assert.deepEqual(g.inventory.map(w=>w.name),guns);assert(r.perks.has('specialty_armorvest'));assert(!r.perks.has('specialty_finalstand'));
const saved=g.saveState(),restored=make();restored.loadState(saved);assert.deepEqual(restored.mapRules.cars,r.cars);assert.deepEqual(restored.mapRules.machineCar,r.machineCar);
console.log('Die Rise quick logic check passed: rooftop floor, 51 barriers, elevator perks/stops/riders/collision, escape pod and key, Sliquifier, leaper rounds, Who’s Who and save restoration.');
