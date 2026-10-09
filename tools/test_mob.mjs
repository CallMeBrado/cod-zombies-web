import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MobEngine} from '../web/bo2-mob-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {validateMapModels} from './validate_map_models.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const [m,p,c,n,nav,gates]=await Promise.all(['gameplay/bo2-mob/manifest.json','gameplay/bo2-mob/presentation.json','bo2-mob/web-world/zm_prison.collision.json','bo2-mob/web-world/zm_prison.paths.json','gameplay/bo2-mob/navigation.json','gameplay/bo2-mob/gate-navigation.json'].map(read));
await validateMapModels('mob-of-the-dead');
const g=new MobEngine(structuredClone(m),new CollisionWorld(c,m.entities),n,{},p);g.prepareSpawnPaths(nav);g.useGateNavigation(gates);const r=g.mapRules;
assert.equal(g.engine,'black-ops-t6-mob');assert.equal(g.weapon.name,'m1911_zm');assert.equal(g.weapon.clip,8);assert.equal(g.weapon.reserve,32);assert.equal(g.windows.length,22);
assert.equal(m.map.volumes.length,29);assert.equal(m.characterArms.length,4);
for(const alias of ['chalk','round_over','cha_ching','repair_boards','wpn_knife_pull_plr'])assert(m.sounds[alias]?.length,alias);
g.start();assert(r.afterlife);assert.equal(r.souls,2);assert.equal(g.weapon.name,'lightning_hands_zm');assert(g.fire());assert.equal(r.afterlife.mana,199);
for(const fps of [30,60,120,240]){const z=g.player.position[2];for(let i=0;i<fps;i++)g.update(1/fps,{});assert(Math.abs(g.player.position[2]-z)<1,'Floor stable at '+fps+' FPS');}
assert.equal(g.round,0);assert.equal(g.enemies.length,0,'Round waits for the opening Afterlife revival');
const a=r.afterlife;g.player.position=a.body.slice();g.player.previousPosition=a.body.slice();r.use(g.interactions.find(e=>e.targetname==='mob_revive'));
for(let i=0;i<400;i++)g.update(.01,{use:true});assert(!r.afterlife,'Held revive completes');assert.equal(g.weapon.name,'m1911_zm');assert.equal(g.weapon.reserve,32);assert.equal(g.player.health,100);
g.mods.god=true;for(let i=0;i<400;i++)g.update(.05,{});assert.equal(g.round,1);assert(g.enemies.some(e=>!e.dead),'Native spawn routes produce enemies');
console.log('Mob: original start, Afterlife/fire/mana/held revival and 30–240 FPS floor passed.');
// Expiry must hand the presentation its real game-over statistics.
const expired=new MobEngine(structuredClone(m),new CollisionWorld(c,m.entities),n,{death:stats=>{assert.equal(stats.round,0);assert.equal(stats.points,500);}},p);expired.start();expired.mapRules.afterlife.mana=.001;expired.update(.02,{});assert.equal(expired.phase,'dead');
// Purchasing a machine requires its own panel, and each door changes native collision.
const jug=g.interactions.find(e=>e.script_noteworthy==='specialty_armorvest');g.player.points=20000;const before=g.player.points;r.use(jug);assert.equal(g.player.points,before);assert(!r.perks.has('specialty_armorvest'));
r.enterAfterlife();const panel=g.entities.find(e=>e.mobPanel==='juggernog_on'),pp=panel.origin.split(' ').map(Number),angle=Number(panel.angles.split(' ')[1])*Math.PI/180;
g.player.position=[pp[0]+Math.cos(angle)*75,pp[1]+Math.sin(angle)*75,pp[2]-30];g.player.previousPosition=g.player.position.slice();
const origin=[...g.player.position];origin[2]+=g.viewHeight;const to=[pp[0],pp[1],pp[2]+25],d=to.map((v,k)=>v-origin[k]);g.yaw=Math.atan2(d[1],d[0]);g.pitch=Math.atan2(d[2],Math.hypot(d[0],d[1]));g.cooldown=0;
assert(g.fire());assert(r.flags.has('juggernog_on'),'Aimed native panel accepts the ghost shock');r.revive();r.use(jug);assert.equal(g.player.points,before-2500);
for(let i=0;i<600;i++)g.update(.01,{});assert(r.perks.has('specialty_armorvest'));assert.equal(r.maxHealth,250);
for(const e of g.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname))){g.openDoor(e);assert(g.collision.disabled.has(e.target));}
assert(r.activeZones().size>20);console.log('Mob: separate perk power and full door/zone progression passed.');
// Real authored collectible groups assemble Icarus and travel to real collision floors.
for(const e of g.interactions.filter(e=>e.mobItem?.startsWith('plane_')&&r.visible(e)))r.use(e);assert.equal(r.planeParts.size,5);
r.use(g.interactions.find(e=>e.targetname==='plane_craftable_trigger'));assert(r.planeBuilt);
r.use(g.interactions.find(e=>e.targetname==='plane_fly_trigger'));assert(r.travel);
for(let i=0;i<610;i++)g.update(.01,{});assert.equal(r.bridgeVisits,1);assert(g.player.grounded);assert(g.player.position[2]<-8000);
const pap=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade');g.gesture=null;r.use(pap);assert(r.pap);assert.equal(r.pap.upgraded,'m1911_upgraded_zm');r.pap=null;
g.gesture=null;r.use(g.interactions.find(e=>e.targetname==='trigger_electric_chair_1'));assert(r.afterlife);assert(g.player.position[2]>1300);r.revive();
const session=JSON.parse(JSON.stringify(g.saveState()));g.loadState(session);assert.equal(r.bridgeVisits,1);assert(r.planeBuilt);assert.equal(r.planeParts.size,5);assert(r.flags.has('juggernog_on'));
console.log('Mob: original plane parts, bridge/Pack-a-Punch, chair return and session restore passed.');
// Natural starting-room pursuit must finish, rather than leaving unreachable spawns.
g.newGame();g.mods.god=true;g.start();r.revive();let elapsed=0;
while(g.round<4&&elapsed<600){g.update(.05,{});elapsed+=.05;for(const e of g.enemies)if(!e.dead&&e.stage==='hunt'&&Math.hypot(...e.position.map((v,k)=>v-g.player.position[k]))<130)g.hitEnemy(e,e.health*10,true);}
assert(g.round>=4,'Three rounds complete through natural barrier routes: '+JSON.stringify(g.enemies.filter(e=>!e.dead).map(e=>({stage:e.stage,position:e.position}))));
assert(r.spawnBrutus(),'Brutus can spawn on an original reachable location');const brutus=g.enemies.find(e=>!e.dead&&e.kind==='brutus');assert(brutus);assert.equal(brutus.health,500);
for(let i=0;i<5;i++)g.hitEnemy(brutus,1,true);assert.equal(brutus.helmet,0);g.hitEnemy(brutus,10000,true);assert(brutus.dead);
console.log('Mob: three natural starting-room rounds in '+elapsed.toFixed(1)+' simulated seconds; Brutus helmet/combat passed.');
