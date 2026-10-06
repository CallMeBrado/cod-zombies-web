import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {BlackOps2Engine} from '../web/bo2-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {BO2_MAPS,selectedMap} from '../web/maps.js';
import {pageRoute} from '../web/routes.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const m=await read('gameplay/bo2-buried/manifest.json'),p=await read('gameplay/bo2-buried/presentation.json');
const c=await read('bo2-buried/web-world/zm_buried.collision.json'),paths=await read('bo2-buried/web-world/zm_buried.paths.json');
const g=new BlackOps2Engine(m,new CollisionWorld(c,m.entities),paths,{},p),report={spawns:[],rounds:[],checks:[]};
assert.equal(g.engine,'black-ops-t6');assert.equal(g.weapon.clip,8);assert.equal(g.weapon.reserve,32);
for(const e of m.entities.filter(e=>e.targetname==='initial_spawn_points'))for(const hz of [30,60,120,240]){
  g.spawn=e.origin.split(' ').map(Number);g.newGame();g.phase='between';g.roundDue=Infinity;const z=g.player.position[2];
  for(let i=0;i<hz;i++)g.update(1/hz,{});assert(g.player.grounded);assert(Math.abs(g.player.position[2]-z)<.1);assert.equal(g.physicsTicks,120);report.spawns.push({origin:g.spawn,hz,z});
}
g.newGame();for(const count of [6,8,13,18,24,27]){g.startRound();assert.equal(g.remaining,count);report.rounds.push(count);}
g.newGame();g.phase='round';g.invalidateNavigation=()=>{};const r=g.mapRules;
g.player.position=[-2413,-758,1360.03];assert(g.enabledSpawners().every(e=>e.targetname==='zone_start_spawners'));
g.player.position=[-400,-200,16];assert(g.enabledSpawners().some(e=>e.targetname==='zone_bank_spawners'));report.checks.push('native occupied-zone spawning');
r.use(g.interactions.find(e=>e.targetname==='use_power_switch'));assert(r.power);assert(r.flags.has('power_on'));
g.player.points=20000;const jug=g.interactions.find(e=>e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_armorvest');r.use(jug);g.time=g.gesture.due;g.updateGesture();assert(r.perks.has('specialty_armorvest'));assert.equal(g.player.health,250);g.gesture=null;
r.perks.add('specialty_additionalprimaryweapon');g.giveWeapon('an94_zm');g.giveWeapon('870mcs_zm');assert.equal(g.inventory.length,3);g.switching=null;
r.perks.add('specialty_rof');const enemy={health:10000,dead:false};g.firingNative=true;g.hitEnemy(enemy,100);g.firingNative=false;assert.equal(enemy.health,9800);report.checks.push('power, native perk prices, Mule Kick, Double Tap II');
const key=g.interactions.find(e=>e.buriedItem==='key');r.use(key);assert.equal(r.carry.kind,'key');r.use(g.interactions.find(e=>e.targetname==='buried_jail'));assert(r.arthurReleased);assert(g.opened.has('pf749_auto11'));
const chalk=g.interactions.find(e=>e.buriedItem==='chalk'&&e.zombie_weapon_upgrade==='870mcs_zm');r.use(chalk);const place=g.interactions.find(e=>e.targetname==='buried_chalk_place');const points=g.player.points;r.use(place);assert.equal(g.player.points,points+1000);assert.equal(r.chalk.get(place.target),'870mcs_zm');assert(g.interactions.some(e=>e.chalkTarget===place.target));report.checks.push('cell key, Arthur release, chalk placement and wall buy');
g.gesture=null;g.switching=null;g.phase='between';g.roundDue=g.time+10;const save=g.saveState();g.loadState(save);assert.equal(g.mapRules.chalk.get(place.target),'870mcs_zm');assert(g.mapRules.arthurReleased);assert(g.interactions.some(e=>e.chalkTarget===place.target));report.checks.push('Buried-specific save round trip');
for(const alias of ['mx_splash_screen','mx_zombie_wave_1','chalk','round_over','cha_ching','repair_boards','grenade_explode',m.weapons.m1911_zm.fireSoundPlayer]){
  assert(m.sounds[alias]?.length,'Missing sound '+alias);for(const v of m.sounds[alias])await access(new URL('../local-data/'+v.url.slice(6),import.meta.url));
}
assert.equal(pageRoute(new URL('http://localhost/black-ops-2/')).template,'bo2.html');assert.equal(BO2_MAPS[0].id,'buried');
report.checks.push('original startup/weapon audio and BO2 route');await writeFile(new URL('../local-data/bo2-logic-verification.json',import.meta.url),JSON.stringify(report,null,2));
g.newGame();g.phase='between';g.roundDue=Infinity;g.invalidateNavigation=()=>{};
const rr=g.mapRules,eq=rr.equipment,bench=g.interactions.find(e=>e.buriedBench);
const parts=g.interactions.filter(e=>e.buriedPart==='turbine');assert.equal(parts.length,3);
for(const part of parts){rr.use(part);eq.use(bench);assert(g.movementBlocked);g.time+=3.01;eq.tick(1/120);assert(!g.movementBlocked);}
assert(eq.benches.get(bench.targetname).complete);eq.use(bench);assert.equal(eq.held.kind,'turbine');
g.player.position=g.settleFeet([-400,-200,32]);g.yaw=0;assert(eq.place());assert.equal(eq.placed.length,1);
const turbine=eq.placed[0];assert(eq.powered(turbine.position));eq.pickup(g.interactions.find(e=>e.equipmentId===turbine.id));assert.equal(eq.held.kind,'turbine');assert.equal(eq.placed.length,0);
const builtSave=g.saveState();g.loadState(builtSave);assert(g.mapRules.equipment.benches.get(bench.targetname).complete);assert.equal(g.mapRules.equipment.held.kind,'turbine');
assert.equal(m.entities.filter(e=>e.nativeMaze&&!g.collision.disabled.has(e.targetname)).length,4);
report.checks.push('native buildable parts, timed construction, placement, pickup, saved equipment and maze gates');
// Leaving a damaged zombie upstairs must not strand the next round.
const stranded={id:99999,health:70,damaged:true,position:[-2413,-758,1360],stage:'hunt',spawnTime:0,window:g.windows[0],dead:false,path:[],navDue:Infinity,retryDue:Infinity,age:20,speed:20,angle:0};
g.time=100;g.enemies=[stranded];g.tickEnemy(stranded,0);g.time=121;const remaining=g.remaining;g.tickEnemy(stranded,0);assert(stranded.dead);assert.equal(g.remaining,remaining+1);assert.equal(g.recycleHealth[0],70);
report.checks.push('one-way descent preserves damaged zombie health and round count');
g.enemies=[];g.giveWeapon('ray_gun_zm');g.switching=null;g.gesture=null;g.cooldown=0;g.sprinting=false;
const target={id:88888,position:[g.player.position[0]+240,g.player.position[1],g.player.position[2]],health:5000,dead:false,stage:'hunt',window:g.windows[0]};g.enemies=[target];
let traveled=0;g.events.traceShot=(origin,dir,length)=>{traveled+=length;return traveled>=240?{hit:{enemy:target,head:false},end:[...target.position.slice(0,2),target.position[2]+35],dir,wall:false}:{end:origin.map((v,k)=>v+dir[k]*length),dir,wall:false};};
g.firingNative=true;g.emit('shot',{origin:[...g.player.position.slice(0,2),g.player.position[2]+35],dir:[1,0,0],rays:[]});g.firingNative=false;
assert.equal(target.health,5000);assert.equal(g.projectiles.length,1);g.updateProjectiles(.1);assert(target.health<5000);assert.equal(g.projectiles.length,0);
g.giveWeapon('slowgun_zm');g.switching=null;g.events.traceShot=()=>({end:[0,0,0],wall:false});g.enemies=[];
for(let n=0;n<130;n++){g.time+=.11;g.fire();}assert(g.paralyzerLock);assert.equal(g.paralyzerHeat,115);assert.equal(g.reload(),false);
g.paralyzerFiredAt=-100;g.tick(10,{});assert(!g.paralyzerLock);assert(g.paralyzerHeat<=87);
report.checks.push('delayed Ray Gun projectile/splash and Paralyzer overheat/cooling');
// The factory's one-way chute must land on supported floor and remain
// walkable through the small sloped brushes at the Quick Revive entrance.
g.newGame();g.phase='between';g.roundDue=Infinity;g.invalidateNavigation=()=>{};g.setMod('god',true);
g.player.position=[-2988,-303,1280];g.player.velocityZ=0;g.player.grounded=false;g.yaw=0;
for(let n=0;n<960;n++)g.update(1/120,{forward:1,side:0,sprint:false});
assert(g.opened.has('pf641_auto6'));assert(g.player.position[0]>-1000);assert(g.player.position[2]>280&&g.player.position[2]<315);assert(g.player.grounded);
const feet=g.player.position,half=g.playerHull,center=[feet[0],feet[1],feet[2]+half[2]+.1];
assert(!g.collision.trace(center,center,half.map(v=>v-.1)).allSolid,'Descent must not place the player inside the supporting floor');
report.checks.push('physical factory chute descent and supported tunnel exit');
g.yaw=-Math.PI/2;for(let n=0;n<80;n++)g.update(1/120,{forward:1});
g.yaw=0;for(let n=0;n<120;n++)g.update(1/120,{forward:1});
g.yaw=Math.PI/2;for(let n=0;n<720;n++)g.update(1/120,{forward:1});
assert(g.player.position[2]<40);assert(g.player.grounded);assert(g.mapRules.occupied().some(v=>v.name==='zone_street_lightwest'));
report.checks.push('continuous factory-to-town movement without teleporting');
// Exercise the shipped graph with a complete third wave at an original
// town floor, rather than testing isolated path methods or off-map positions.
delete g.invalidateNavigation;g.newGame();
g.prepareSpawnPaths(await read('gameplay/bo2-buried/navigation.json'));g.useGateNavigation(await read('gameplay/bo2-buried/gate-navigation.json'));
g.start();g.setMod('god',true);g.player.position=g.settleFeet([-400,-200,80]);g.round=2;g.startRound();
for(let n=0;n<7200;n++)g.update(1/120,{});
assert.equal(g.remaining,0);assert.equal(g.enemies.filter(e=>!e.dead).length,13);
assert(g.enemies.every(e=>e.dead||e.attacking),'All town zombies must be able to reach the player after clearing the barrier');
report.checks.push('round 3: all 13 native town zombies traverse the barrier and attack');
await writeFile(new URL('../local-data/bo2-logic-verification.json',import.meta.url),JSON.stringify(report,null,2));
console.log('Buried logic passed: 40 native spawn/FPS checks, T6 rounds, occupied-zone spawns, perks, progression, equipment, projectiles, saves and audio.');
