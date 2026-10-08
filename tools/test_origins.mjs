import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {OriginsEngine} from '../web/bo2-origins-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {validateMapModels} from './validate_map_models.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const [m,p,c,n,nav,gates]=await Promise.all(['gameplay/bo2-origins/manifest.json','gameplay/bo2-origins/presentation.json','bo2-origins/web-world/zm_tomb.collision.json','bo2-origins/web-world/zm_tomb.paths.json','gameplay/bo2-origins/navigation.json','gameplay/bo2-origins/gate-navigation.json'].map(read));
await validateMapModels('origins');
const g=new OriginsEngine(structuredClone(m),new CollisionWorld(c,m.entities),n,{},p);
g.prepareSpawnPaths(nav);g.useGateNavigation(gates);
const r=g.mapRules;g.mods.god=true;
assert.equal(g.weapon.name,'c96_zm');assert.equal(g.weapon.clip,8);assert.equal(g.weapon.reserve,32);
assert.equal(g.windows.length,12);assert.equal(m.map.generators.length,6);assert(g.player.grounded);assert.equal(g.engine,'black-ops-t6-origins');
assert(!g.interactions.some(e=>e.targetname.startsWith('origins_traverse_')),'Navigation markers must not become purchase prompts');
for(const name of ['mx_splash_screen','mx_zombie_wave_1','chalk','round_over','cha_ching','repair_boards'])assert(m.sounds[name]?.length,name);
g.start();const spawn=g.player.position.slice();
for(const fps of [30,60,120,240]){Object.assign(g.player,{position:spawn.slice(),previousPosition:spawn.slice(),velocityZ:0,grounded:true});for(let i=0;i<fps*3;i++)g.update(1/fps,{});assert(Math.abs(g.player.position[2]-spawn[2])<1,'Stationary floor holds at '+fps+' FPS');}
assert(g.enemies.some(e=>!e.dead),'Round one spawns');
console.log('Origins: high-FPS floor and initial spawns passed.');
const gen=g.interactions.find(e=>e.targetname==='origins_generator'&&e.generator===1),d=m.map.generators[0];
g.player.points=10000;g.player.position=g.settleFeet([d.origin[0]+80,d.origin[1],d.origin[2]+64]);g.player.previousPosition=g.player.position.slice();
assert.equal(g.nearInteraction()?.targetname,'origins_generator','Generator switch is reachable from its real floor');
r.use(gen);assert.equal(g.player.points,9800);assert.equal(r.activeCapture,1);assert(!r.power);
const tick=(seconds)=>{for(let i=0;i<Math.ceil(seconds/.05);i++){g.time+=.05;r.tick();}};
tick(6);assert(r.generators[1].progress>45&&r.generators[1].progress<55,'Solo generator takes 12 seconds');
assert(g.enemies.some(e=>!e.dead&&e.captureGenerator===1),'Generator capture spawns its authored guards');
g.player.position[0]+=500;const before=r.generators[1].progress;tick(2);assert(r.generators[1].progress<before,'Leaving the circle decays progress');
g.player.position[0]-=500;tick(9);assert.equal(r.generators[1].phase,'on');assert(!r.power);assert(!g.enemies.some(e=>!e.dead&&e.captureGenerator===1));
const jug=g.interactions.find(e=>e.script_noteworthy==='specialty_armorvest');assert(!r.isPowered(jug));
const pap=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade');assert(r.prompt(pap,'F').includes('six'));const paid=g.player.points;r.use(pap);assert.equal(g.player.points,paid);
for(let id=2;id<=6;id++){
 const e=g.interactions.find(e=>e.targetname==='origins_generator'&&e.generator===id),d=m.map.generators[id-1];g.player.position=g.settleFeet([d.origin[0]+80,d.origin[1],d.origin[2]+64]);r.use(e);tick(12.1);assert.equal(r.generators[id].phase,'on');
}
assert(r.power);assert(r.isPowered(jug));
g.player.points=10000;r.use(pap);assert(r.pap);assert.equal(r.pap.upgraded,'c96_upgraded_zm');assert.equal(g.player.points,5000);
console.log('Origins: capture duration/decay, per-generator power and Pack-a-Punch passed.');
// A purchased door changes both zones and collision, with prepared nav invalidation.
for(const e of g.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname))){g.openDoor(e);assert(g.collision.disabled.has(e.target));if(e.script_flag)assert(r.flags.has(e.script_flag));}
assert(r.activeZones().size>50);
const shovel=g.interactions.find(e=>e.originsItem==='shovel'&&r.visible(e));r.use(shovel);assert(r.shovel);
const dig=g.interactions.find(e=>e.originsItem==='dig'&&r.visible(e));r.use(dig);assert(r.dug.has(dig.itemId));assert(!r.visible(dig));
const record=g.interactions.find(e=>e.originsItem==='record'&&e.itemGroup==='gramophone_vinyl_player'&&r.visible(e));r.use(record);assert(r.collected.has('gramophone_vinyl_player'));assert(!r.visible(record));
const master=g.interactions.find(e=>e.itemGroup==='gramophone_vinyl_master'&&r.visible(e));r.use(master);r.use(g.interactions.find(e=>e.targetname==='origins_crypt'));assert(r.cryptOpen);assert(g.collision.disabled.has('junk_nml_chamber_clip'));
for(const e of g.interactions.filter(e=>e.targetname==='origins_staff_bench')){for(const part of r.staffParts(e.staff))r.collected.add(part);r.use(e);assert(g.inventory.some(w=>w.name===e.staff));}
assert.equal(m.weapons.staff_air_zm.maxAmmo,40);assert.equal(m.weapons.c96_upgraded_zm.maxAmmo,100);
g.round=8;g.player.position=m.map.generators[3].origin.slice();g.player.position[0]+=200;r.panzerDue=g.time;r.tick();
assert(g.enemies.some(e=>e.kind==='panzer'),'Panzer spawns in the unlocked battlefield on round 8');
const saved=r.saveState();r.reset();r.loadState(saved);assert.equal(r.generators[6].phase,'on');assert(r.shovel);assert(r.cryptOpen);assert.equal(r.crafted.size,4);
console.log('Origins: door/zone progression, shovel/dig/record/crypt, staff assembly, Panzer and map save restoration passed.');
// Full session restore retains native special enemies, captures and door state.
r.pap=null;g.gesture=null;const session=JSON.parse(JSON.stringify(g.saveState()));g.loadState(session);
assert.equal(g.enemies.filter(e=>e.kind==='panzer').length,1);assert.equal(g.mapRules.generators[6].phase,'on');assert.equal(g.mapRules.crafted.size,4);assert(g.opened.size>0);
// All four authored portals have real floor destinations and return paths.
for(const portal of m.map.portals){r.collected.add('gramophone_vinyl_player');r.collected.add(portal.record);r.use(g.interactions.find(e=>e.targetname==='origins_portal'&&e.portal===portal.id));
 assert(g.player.grounded);assert(g.mapRules.activeZones().has('zone_chamber_0'));
 r.use(g.interactions.find(e=>e.targetname==='origins_return'&&e.portal===portal.id));assert(g.player.grounded);}
console.log('Origins: complete session restoration and all four portal round trips passed.');
// Let real round spawns approach the stationary player; kill only arrivals.
g.newGame();g.mods.god=true;g.start();let elapsed=0;
while(g.round<4&&elapsed<600){g.update(.05,{});elapsed+=.05;for(const e of g.enemies)if(!e.dead&&e.stage==='hunt'&&Math.hypot(...e.position.map((v,k)=>v-g.player.position[k]))<130)g.hitEnemy(e,e.health*10,true);}
assert(g.round>=4,'Starting-room routes must finish three rounds; live='+JSON.stringify(g.enemies.filter(e=>!e.dead).map(e=>({stage:e.stage,position:e.position})))+' remaining='+g.remaining);
console.log('Origins: three full starting-room rounds completed using natural spawn routes in '+elapsed.toFixed(1)+' simulated seconds.');
