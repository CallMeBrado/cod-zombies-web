// Focused logic pass. Native map appearance and gameplay are user playtested.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CallOfDeadEngine} from '../web/bo1-coast.js';
import {CollisionWorld} from '../web/collision.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
async function make(events={}){const m=await read('gameplay/bo1-coast/manifest.json'),p=await read('gameplay/bo1-coast/presentation.json');
  const g=new CallOfDeadEngine(m,new CollisionWorld(await read('bo1-coast/web-world/zombie_coast.collision.json'),m.entities),await read('bo1-coast/web-world/zombie_coast.paths.json'),events,p);
  g.prepareSpawnPaths(await read('gameplay/bo1-coast/navigation.json'));return g;}
const g=await make(),r=g.mapRules;
assert.equal(g.engine,'black-ops-t5-coast');assert(g.player.grounded);assert.equal(g.windows.length,32);assert.equal(g.data.characterNames[0],'Sarah Michelle Gellar');
assert.equal(g.data.characterArms.length,4);assert.equal(g.interactions.filter(e=>e.targetname==='zombie_vending').length,7);
assert(g.collision.disabled.has('zombie_vending_upgrade_clip'));assert(r.activeZones().has('beach_zone'));
g.remaining=6;g.spawnEnemy();assert(g.enemies.length);assert.equal(g.enemies[0].stage,'rise','The starting beach uses native ground risers');g.enemies=[];
g.start();g.update(1/120,{});g.time=6;r.spawnDirector();const george=g.enemies.find(e=>e.kind==='george');
assert(george.ignoreRound);assert.equal(george.health,250000);assert(g.presentation.animations[george.gait]);
g.hitEnemy(george,1000);assert(george.angry);assert.equal(george.health,249000);
g.pickup({id:100,type:'nuke',position:george.position});assert.equal(george.health,249000,'Nuke leaves George alive');
g.remaining=0;g.phase='round';g.tick(1/120,{});assert.equal(g.phase,'between','George cannot hold a round open');
const saved=JSON.parse(JSON.stringify(g.saveState())),restored=await make();restored.loadState(saved);const restoredGeorge=restored.enemies.find(e=>e.kind==='george');
assert(restoredGeorge?.ignoreRound);assert.equal(restoredGeorge.health,249000);assert.equal(restored.mapRules.directorId,george.id);
assert.equal(restored.mapRules.papDue,Infinity,'A save before power preserves the lighthouse wait');
// Original water brushes govern the cold timer; controls thaw after ice damage.
const water=r.data.waterVolumes.find(v=>r.waterAt(v.position));assert(water);const spawn=g.player.position.slice();g.player.position=water.position.slice();r.waterDue=0;
for(let i=0;i<301;i++){g.time+=.101;r.tickWater();}assert(r.frozen);assert(g.movementBlocked);
r.thaw();assert(!r.frozen);assert.equal(r.cold,0);g.player.position=spawn;
// Native lighthouse timings and each movable machine's purchase point.
r.use(g.interactions.find(e=>e.targetname==='use_power_switch'));assert(r.power);assert(!r.papAvailable);
g.time=r.papDue;r.tickPap();assert.equal(r.papStage,'searching');g.time=r.papDue;r.tickPap();assert.equal(r.papStage,'rising');
g.time=r.papDue;r.tickPap();r.updatePapPlacement();assert(r.papAvailable);assert.equal(r.papStage,'active');
const location=r.papPosition();assert(location.every((v,k)=>Math.abs(v-Number(r.data.papLocations[r.papLocation].origin.split(' ')[k]))<.01));
const papSave=g.saveState();restored.loadState(papSave);assert.equal(restored.mapRules.papLocation,r.papLocation);assert(restored.mapRules.papAvailable);
g.time=r.papDue;r.tickPap();assert.equal(r.papStage,'lowering');assert(!r.papAvailable);
// Sickle damage uses the owned native melee definition; George's reward is collectible.
r.use(g.interactions.find(e=>e.zombie_weapon_upgrade==='sickle_knife_zm'));assert(!r.sickle,'Cannot buy without 3000 points');
g.player.points=4000;r.use(g.interactions.find(e=>e.zombie_weapon_upgrade==='sickle_knife_zm'));assert(r.sickle);assert.equal(g.player.points,1000);
g.hitEnemy(george,george.health);assert(george.dead);assert(g.drops.some(d=>d.type==='free_perk'));assert(g.drops.some(d=>d.type==='minigun'));
const inventory=g.inventory;r.grantPerk();assert.equal(r.perks.size,1);g.pickup(g.drops.find(d=>d.type==='minigun'));assert.equal(g.weapon.name,'minigun_zm');assert(!g.canSave());
g.time=r.deathMachineUntil;r.tick();assert.equal(g.inventory,inventory);assert(!r.deathMachine);
// Scavenger is a travelling sticky projectile, not a zero-damage hitscan.
g.equipTestWeapon('sniper_explosive_zm');g.cooldown=0;g.meleeDue=0;g.gesture=null;g.switching=null;g.phase='round';
g.events.traceShot=(origin,dir)=>({origin,dir,end:origin.map((v,k)=>v+dir[k]*10),wall:true,hits:[]});assert(g.fire());assert.equal(g.projectiles.length,1);
g.updateProjectiles(1/120);const projectile=g.projectiles[0];assert(projectile.stuck);assert(Math.abs(projectile.due-g.time-3)<.01);
g.time=projectile.due;g.updateProjectiles(1/120);assert.equal(g.projectiles.length,0);
// Hip-fire spread stays a {min, max} cone (with and without Deadshot), so a
// shot's direction is a real ray: a NaN ray walked every triangle tree.
for(const deadshot of [false,true]){if(deadshot)r.perks.add('specialty_deadshot');else r.perks.delete('specialty_deadshot');
  const spread=g.hipSpread();assert(Number.isFinite(spread.min)&&Number.isFinite(spread.max)&&spread.min<=spread.max,'Hip spread is a finite cone');}
let shotRay=null;g.equipTestWeapon('m1911_zm');Object.assign(g,{cooldown:0,meleeDue:0,reloadEnd:0,gesture:null,switching:null,pendingGrenade:null,sprinting:false,pendingFire:false,sprintExitUntil:0,burstRemaining:0,phase:'round'});g.weapon.clip=5;g.events.traceShot=(origin,dir)=>{shotRay=dir;return {origin,dir,end:origin,wall:true,hits:[]};};
assert(g.fire());assert(shotRay&&shotRay.every(Number.isFinite),'Shots fire along a finite direction');
console.log('Call of the Dead quick logic check passed: spawn floor, George/rounds/nuke/saves, cold and thaw, moving Pack-a-Punch, Sickle, rewards and Scavenger fuse.');
