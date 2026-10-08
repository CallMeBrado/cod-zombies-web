import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FiveEngine,movingHullTrace} from '../web/bo1-five.js';
import {CollisionWorld} from '../web/collision.js';
import {validateMapModels} from './validate_map_models.mjs';
const read=async f=>JSON.parse(await readFile(new URL('../local-data/'+f,import.meta.url),'utf8'));
const m=await read('gameplay/bo1-five/manifest.json'),p=await read('gameplay/bo1-five/presentation.json'),c=await read('bo1-five/web-world/zombie_pentagon.collision.json'),paths=await read('bo1-five/web-world/zombie_pentagon.paths.json'),nav=await read('gameplay/bo1-five/navigation.json');
const make=()=>{const g=new FiveEngine(m,new CollisionWorld(c,m.entities),paths,{},p);g.prepareSpawnPaths(nav);return g;};
const run=(g,s,input={})=>{for(let i=0;i<s*120;i++)g.update(1/120,input);};
const relocate=(g,at)=>{g.player.position=g.settleFeet(at);g.player.previousPosition=g.player.position.slice();g.player.grounded=true;g.player.velocityZ=0;};
assert.equal(m.map.elevators.length,2);assert.equal(m.map.portals.length,8);assert.equal(m.map.defconSwitches.length,4);assert(m.characterNames.includes('Fidel Castro'));assert(nav.targetNavigation?.links.length);
assert(!m.map.boxWeapons.includes('zombie_cymbal_monkey'),'Unsupported Monkey Bomb is not offered as a broken gun');
assert.equal(m.weapons.freezegun_zm.startAmmo,30);assert.equal(m.weapons.freezegun_zm.maxAmmo,24);assert.equal(m.weapons.freezegun_upgraded_zm.startAmmo,45);assert.equal(m.weapons.freezegun_upgraded_zm.maxAmmo,36);
const hull={mins:[-30,-30,-10],maxs:[30,30,0],planes:[]};const result={fraction:1,normal:[0,0,0],end:[0,0,-100]};assert(movingHullTrace(hull,[0,0,-50],[0,0,0],[0,0,-100],[14,14,10],result).fraction<1);
for(const hz of [30,60,120,240]){const g=make(),z=g.player.position[2];g.start();g.mods.god=true;g.spawnDue=1e9;for(let i=0;i<hz*3;i++)g.update(1/hz,{});assert(g.player.grounded&&Math.abs(g.player.position[2]-z)<.1,'Stable spawn '+hz);assert(g.changeStance('crouch'));assert(g.changeStance('prone'));assert(g.changeStance('stand'));}
// Regression: an actor touching the conference chair bevel can otherwise
// remain allSolid forever after crowd separation.
const chair=make();chair.start();chair.mods.god=true;chair.spawnDue=1e9;const trapped={id:9100,position:[-578.4054043978049,2724.0641937524833,16.03],previousPosition:[-578.4054043978049,2724.0641937524833,16.03],speed:37.48737752610617,gait:'ai_zombie_walk_v2',health:150,dead:false,age:0,spawnTime:0,stage:'hunt',path:[],attackDue:0,navDue:0};chair.enemies=[trapped];run(chair,30);assert(dist(trapped.position,chair.player.position)<100,'Conference chair overlap resolves and reaches player');
console.log('Five: native map, characters, complete gate navigation, chair overlap recovery and 30–240 FPS spawn floors passed.');
const g=make(),r=g.mapRules;g.start();g.mods.god=true;g.spawnDue=1e9;g.player.points=100000;
for(const e of g.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname)))g.openDoor(e);
for(const name of ['elevator2','elevator1']){const d=m.map.elevators.find(e=>e.name===name);relocate(g,[d.origin[0],d.origin[1],d.origin[2]+64]);const z=g.player.position[2],money=g.player.points;
  if(name==='elevator2'){assert.match(g.prompt(),/Use elevator/,'Inside car selects the buy panel, not an inactive call box');g.use();assert(r.cars[name].moving);}else assert(r.ride(name),'Board '+name+' at '+g.player.position);
  assert.equal(g.player.points,money-250);run(g,2.5);assert(r.cars[name].moving);assert(Math.abs(g.player.position[2]-(z-d.drop*.5))<1,'Halfway rider position '+name);
  const state=JSON.parse(JSON.stringify(g.saveState())),h=make();h.loadState(state);run(h,2.6);assert(!h.mapRules.cars[name].moving);assert(Math.abs(h.player.position[2]-(z-d.drop))<1,'Restored rider floor '+name);
  run(g,2.6);assert(g.player.grounded&&Math.abs(g.player.position[2]-(z-d.drop))<1,'Down arrival '+name);assert(r.activeZones().has(d.downZone));
  g.yaw=name==='elevator2'?0:Math.PI/2;run(g,1.2,{forward:1});assert(Math.hypot(g.player.position[0]-d.origin[0],g.player.position[1]-d.origin[1])>130,'Walk out of '+name+': '+g.player.position);
  assert(r.call(name,'up'));run(g,5.1);assert.equal(r.cars[name].z,0);assert.equal(r.cars[name].stop,'up');
}
console.log('Five: both elevators, 250-point fares, five-second rides, walk-off floors, calls and mid-ride saves passed.');
const power=g.interactions.find(e=>e.targetname==='use_power_switch');r.use(power);assert(r.power);assert(r.nextThiefRound>g.round);
for(const e of g.interactions.filter(e=>e.fiveDefcon!=null))r.use(e);assert.equal(r.defcon,5);
const papPortal=m.map.portals.find(v=>v.zone==='conference_level2');r.portal(papPortal.index);assert(r.papOpen&&r.defconStarted);assert(g.player.grounded);
g.giveWeapon('python_zm');g.gesture=null;g.cooldown=0;const pap=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade'),money=g.player.points;r.use(pap);assert(r.pap);assert.equal(g.player.points,money-5000);run(g,15);r.takeUpgrade();assert.equal(g.weapon.name,'python_upgraded_zm');
g.time=r.defconStarted+31;r.tick();assert.equal(r.defcon,1);assert.deepEqual(r.switches,[]);g.time=r.papUntil+1;r.tick();assert(!r.papOpen);assert(g.collision.disabled.has(m.map.papBlockers[1]),'Exit open with player still in Pack-a-Punch room');
for(const portal of m.map.portals){r.portal(portal.index);assert(g.player.grounded&&g.player.position.every(Number.isFinite),'Portal '+portal.index);}
g.pickup({id:900,type:'bonfire_sale'});g.gesture=null;g.giveWeapon('python_zm');const saleMoney=g.player.points;r.use(pap);assert(r.pap);assert.equal(g.player.points,saleMoney-1000);run(g,15);r.takeUpgrade();
console.log('Five: power, DEFCON countdown/reset, every native portal, Pack-a-Punch, safe room exit and Bonfire Sale passed.');
r.portal(m.map.portals.find(v=>v.zone==='war_room_zone_north').index);g.gesture=null;g.enemies=[];r.portalDue=0;r.portalReady=1e9;g.round=r.nextThiefRound;g.startRound();assert(r.thiefRound&&g.remaining===1);g.spawnEnemy();const thief=g.enemies.find(e=>e.kind==='thief');assert(thief&&thief.health===Math.min(60000,g.round*2000)*.3);const stolen=g.weapon.name;thief.position=g.player.position.slice();g.tickEnemy(thief,1/120);assert.equal(thief.stolen.name,stolen);assert(r.thiefStole);g.hitEnemy(thief,thief.health+1);assert(g.inventory.some(w=>w.name===stolen));assert(g.drops.some(d=>d.type==='full_ammo')&&g.drops.some(d=>d.type==='fire_sale'));
const saved=JSON.parse(JSON.stringify(g.saveState())),restored=make();restored.loadState(saved);assert.deepEqual(restored.mapRules.cars,r.cars);assert.equal(restored.mapRules.nextThiefRound,r.nextThiefRound);assert.equal(restored.activeBox,g.activeBox);
g.enemies=[];g.gesture=null;g.switching=null;g.pendingGrenade=null;g.reloadEnd=0;g.cooldown=0;g.sprintExitUntil=0;g.pendingFire=false;g.giveWeapon('freezegun_zm');g.switching=null;g.gesture=null;g.meleeDue=0;g.weapon.clip=6;g.yaw=0;g.pitch=0;const a=g.player.position;
const target={id:9001,position:[a[0]+150,a[1],a[2]],previousPosition:a.slice(),health:5000,stage:'hunt',path:[],speed:40,dead:false,age:0,navDue:0,attackDue:0,gait:'ai_zombie_walk_v1'};g.enemies=[target];g.events.worldTrace=()=>({fraction:1});assert(g.fire());assert(target.health<5000&&target.frozenUntil>g.time,'Winter’s Howl cone damage and freeze');g.time=target.frozenUntil+1;r.tick();assert.equal(target.speed,40);
console.log('Five: Pentagon Thief spawning/theft/recovery, rewards, freeze weapon and session restoration passed.');
const originalRandom=Math.random;
try{for(const seed of [1,9,317]){let randomState=seed;Math.random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  const natural=make();natural.start();natural.mods.god=true;let seen=0;
  for(let i=0;i<120*360&&natural.round<4;i++){natural.update(1/120,{});for(const e of natural.enemies)if(!e.dead&&e.stage==='hunt'&&dist(e.position,natural.player.position)<130){natural.hitEnemy(e,e.health*10,false,true);seen++;}}
  assert.equal(natural.round,4,'Three natural starting-room rounds, seed '+seed+': '+JSON.stringify(natural.enemies.filter(e=>!e.dead).map(e=>({stage:e.stage,position:e.position,path:e.path,window:e.window?.target}))));assert(seen>=20);
  console.log('Five: three natural rounds passed, seed '+seed+', '+natural.time.toFixed(1)+' simulated seconds.');
}}finally{Math.random=originalRandom;}
await validateMapModels('five');
function dist(a,b){return Math.hypot(...a.map((v,k)=>v-b[k]));}
