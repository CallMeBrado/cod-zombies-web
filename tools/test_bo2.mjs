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
// Every authored barrier, the start room's hide-pieces ones included, starts
// with its six native boards.
{g.newGame();const boarded=g.windows.filter(w=>w.boardEntities.some(e=>e.nativeBoard));assert.equal(boarded.length,35);assert(boarded.every(w=>w.boards===6),'Barriers start boarded');
 assert(g.windows.some(w=>w.target==='pf643_auto1'&&w.boards===6),'Start room barrier is boarded');report.checks.push('35 native barriers boarded');}
g.newGame();for(const count of [6,8,13,18,24,27]){g.startRound();assert.equal(g.remaining,count);report.rounds.push(count);}
g.newGame();g.phase='round';g.invalidateNavigation=()=>{};const r=g.mapRules;
g.player.position=[-2413,-758,1360.03];assert(g.enabledSpawners().every(e=>e.targetname==='zone_start_spawners'));
g.player.position=[-400,-200,16];assert(g.enabledSpawners().some(e=>e.targetname==='zone_bank_spawners'));report.checks.push('native occupied-zone spawning');
r.use(g.interactions.find(e=>e.targetname==='use_power_switch'));assert(r.power);assert(r.flags.has('power_on'));
g.player.points=20000;const jug=g.interactions.find(e=>e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_armorvest');r.use(jug);g.time=g.gesture.due;g.updateGesture();assert(r.perks.has('specialty_armorvest'));assert.equal(g.player.health,160);g.gesture=null;
r.perks.add('specialty_additionalprimaryweapon');g.giveWeapon('an94_zm');g.giveWeapon('870mcs_zm');assert.equal(g.inventory.length,3);g.switching=null;
r.perks.add('specialty_rof');const enemy={health:10000,dead:false};g.firingNative=true;g.hitEnemy(enemy,100);g.firingNative=false;assert.equal(enemy.health,9800);report.checks.push('power, native perk prices, Mule Kick, Double Tap II');
const key=g.interactions.find(e=>e.buriedItem==='key');r.use(key);assert.equal(r.carry.kind,'key');
// The key is held into the cell door for 3 s with the builder hands; letting go cancels.
g.gesture=null;g.useHeld=true;r.use(g.interactions.find(e=>e.targetname==='buried_jail'));assert.equal(g.gesture.key,'zombie_builder');assert(g.movementBlocked);
g.useHeld=false;g.time+=.2;r.tickHold();assert(!r.hold);assert.equal(r.carry.kind,'key');assert(!r.arthur.cellOpen);g.gesture=null;
g.useHeld=true;r.use(g.interactions.find(e=>e.targetname==='buried_jail'));g.time+=3.01;r.tickHold();assert(r.arthur.cellOpen);assert(g.opened.has('pf749_auto11'));assert(!r.carry);assert.equal(r.arthur.state,'jail_open');g.useHeld=false;
const chalk=g.interactions.find(e=>e.buriedItem==='chalk'&&e.zombie_weapon_upgrade==='870mcs_zm');r.use(chalk);const place=g.interactions.find(e=>e.targetname==='buried_chalk_place');const points=g.player.points;
// Drawing is a 3 s hold with the chalk hands.
g.gesture=null;g.useHeld=true;r.use(place);assert.equal(g.gesture.key,'chalk_draw');assert(!r.chalk.has(place.target));g.time+=3.01;r.tickHold();g.useHeld=false;g.gesture=null;assert.equal(g.player.points,points+1000);assert.equal(r.chalk.get(place.target),'870mcs_zm');assert(g.interactions.some(e=>e.chalkTarget===place.target));report.checks.push('cell key, Arthur release, chalk placement and wall buy');
g.gesture=null;g.switching=null;g.phase='between';g.roundDue=g.time+10;const save=g.saveState();g.loadState(save);assert.equal(g.mapRules.chalk.get(place.target),'870mcs_zm');assert(g.mapRules.arthur.cellOpen);assert(g.interactions.some(e=>e.chalkTarget===place.target));report.checks.push('Buried-specific save round trip');
// Native material data the renderer needs: each compiled blend surface keeps
// its second layer, and decals, grates and glass keep their blend states.
{
  const world=await read('bo2-buried/web-world/zm_buried.json'),mats=Object.entries(world.materials);
  assert(mats.filter(([,m])=>m.layer).length>=150,'Blend layers missing from the prepared world');
  assert.equal(world.materials['*52n_53n(wpc/zm_al_brick_bare:wpc/zm_bu_foliage_ivy_blend)']?.layer?.vertex,true);
  assert.equal(world.materials['wpc/zm_bu_metal_floor_catwalk_mesh'].blend,'test');assert.equal(world.materials['wpc/decal_grunge_darkstain_12'].blend,'multiply');
  assert.equal(world.materials['wpc/decal_damage_crack_01'].blend,'alpha');assert(world.materials['wpc/decal_damage_crack_01'].decal);
  report.checks.push('world blend layers and native blend states');
}
for(const alias of ['mx_splash_screen','mx_zombie_wave_1','chalk','round_over','cha_ching','repair_boards','grenade_explode',m.weapons.m1911_zm.fireSoundPlayer]){
  assert(m.sounds[alias]?.length,'Missing sound '+alias);for(const v of m.sounds[alias])await access(new URL('../local-data/'+v.url.slice(6),import.meta.url));
}
assert.equal(pageRoute(new URL('http://localhost/black-ops-2/')).template,'bo2.html');assert.equal(BO2_MAPS[0].id,'buried');
report.checks.push('original startup/weapon audio and BO2 route');await writeFile(new URL('../local-data/bo2-logic-verification.json',import.meta.url),JSON.stringify(report,null,2));
g.newGame();g.phase='between';g.roundDue=Infinity;g.invalidateNavigation=()=>{};
const rr=g.mapRules,eq=rr.equipment,bench=g.interactions.find(e=>e.buriedBench);
const parts=g.interactions.filter(e=>e.buriedPart==='turbine');assert.equal(parts.length,3);
g.useHeld=true;for(const part of parts){rr.use(part);g.gesture=null;eq.use(bench);assert(g.movementBlocked);assert.equal(g.gesture.key,'zombie_builder');g.time+=3.01;eq.tick(1/120);assert(!g.movementBlocked);}g.useHeld=false;g.gesture=null;
assert(eq.benches.get(bench.targetname).complete);eq.use(bench);assert.equal(eq.held.kind,'turbine');
g.player.position=g.settleFeet([-400,-200,32]);g.yaw=0;assert(eq.place());assert.equal(eq.placed.length,1);
const turbine=eq.placed[0];assert(eq.powered(turbine.position));eq.pickup(g.interactions.find(e=>e.equipmentId===turbine.id));assert.equal(eq.held.kind,'turbine');assert.equal(eq.placed.length,0);
const builtSave=g.saveState();g.loadState(builtSave);assert(g.mapRules.equipment.benches.get(bench.targetname).complete);assert.equal(g.mapRules.equipment.held.kind,'turbine');
assert.equal(m.entities.filter(e=>e.nativeMaze&&!g.collision.disabled.has(e.targetname)).length,4);
report.checks.push('native buildable parts, timed construction, placement, pickup, saved equipment and maze gates');
const resume=g.player.position.slice();
// Arthur: cowering in the opened cell he takes booze from a player facing
// him, drinks, charges out of the jail and breaks its barricade.
{
  g.newGame();g.phase='between';g.roundDue=Infinity;g.invalidateNavigation=()=>{};g.enemies=[];const ar=g.mapRules,arthur=ar.arthur,step=n=>{for(let i=0;i<n;i++){g.time+=1/120;arthur.tick(1/120);}};
  const jailed=arthur.position.slice();ar.openCell();step(Math.ceil(arthur.duration('idle_jail_2_cower')*120)+2);
  assert.equal(arthur.state,'jail_cower');assert(Math.hypot(arthur.position[0]-jailed[0],arthur.position[1]-jailed[1])>30,'He backs into the cell');
  const booze=g.interactions.find(e=>e.buriedItem==='booze'&&ar.itemVisible(e));ar.use(booze);assert.equal(ar.carry.kind,'booze');
  const front=[arthur.position[0]+Math.cos(arthur.yaw)*70,arthur.position[1]+Math.sin(arthur.yaw)*70,arthur.position[2]];g.player.position=front;g.yaw=arthur.yaw+Math.PI;
  assert(arthur.canGift());g.yaw=arthur.yaw;assert(!arthur.canGift(),'The giver must face him');g.yaw=arthur.yaw+Math.PI;
  g.useHeld=true;ar.use(g.interactions.find(e=>e.targetname==='buried_arthur'));g.time+=.76;ar.tickHold();g.useHeld=false;assert.equal(arthur.state,'drink');assert(!ar.carry);
  // drinkbooze turns him around (its root rotation): he charges away from the giver.
  for(let i=0;i<120*4&&arthur.state==='drink';i++)step(1);
  assert(Math.cos(arthur.yaw)*(front[0]-arthur.position[0])+Math.sin(arthur.yaw)*(front[1]-arthur.position[1])<0,'Arthur turns away from the giver before charging');
  g.player.position=[front[0]+200,front[1],front[2]];const points=g.player.points;
  for(let i=0;i<120*12&&!g.opened.has('pf749_auto9');i++)step(1);
  assert(g.opened.has('pf749_auto9'),'Arthur breaks the jail barricade');assert(ar.flags.has('jail_door1'));assert.equal(arthur.state,'crash');assert(g.player.points>points);
  assert(g.interactions.some(e=>e.buriedItem==='candy'&&ar.itemVisible(e)),'Candy spawns once the jail barricade is down');
  step(Math.ceil(arthur.duration('hit_barrier')*120)+2);assert.equal(arthur.state,'roam');
  // He walks off to a roam node he can reach (the street, past the broken
  // jail barricade) rather than pressing into a wall toward one behind a door.
  const crashed=arthur.position.slice();step(120*25);
  assert(Math.hypot(arthur.position[0]-crashed[0],arthur.position[1]-crashed[1])>150,'Arthur roams out of the jail');{const at=arthur.position;assert(g.collision.trace([at[0],at[1],at[2]+8],[at[0],at[1],at[2]-24],[0,0,0]).fraction<1,'Arthur stays on the floor');}
  // Candy: he eats, then runs down and kills zombies near the giver, for 45 s.
  const candy=g.interactions.find(e=>e.buriedItem==='candy'&&ar.itemVisible(e));ar.use(candy);arthur.give('candy');ar.carry=null;
  step(Math.ceil(arthur.duration('eatcandy')*120)+2);assert.equal(arthur.state,'protect');
  // Arthur's roam leaves him anywhere: set the scene along a direction he can walk.
  const dir=[0,1,2,3,4,5,6,7].map(a=>[Math.cos(a*Math.PI/4),Math.sin(a*Math.PI/4)]).find(d=>g.kinematicLink(arthur.position,[arthur.position[0]+d[0]*150,arthur.position[1]+d[1]*150,arthur.position[2]],6))||[1,0];
  g.player.position=arthur.position.map((v,k)=>v+(k<2?dir[k]*100:0));const zombie={id:7777,position:arthur.position.map((v,k)=>v+(k<2?dir[k]*150:0)),health:500,dead:false,stage:'hunt',window:g.windows[0],path:[]};g.enemies=[zombie];const left=g.remaining;
  for(let i=0;i<120*6&&!zombie.dead;i++)step(1);assert(zombie.dead,'Arthur kills the zombie near the candy giver');assert.equal(g.remaining,left+1,'His kills go back into the round');
  g.enemies=[];g.time+=46;step(2);assert.equal(arthur.state,'roam');
  const saved=g.saveState();g.loadState(saved);assert(g.mapRules.arthur.cellOpen);assert(g.mapRules.arthur.gotBooze);
  report.checks.push('Arthur: held cell unlock, cower, facing gift, drink, berserk barricade break, candy spawn, protect, save');
}
// The box: no repeats of held weapons or the other Ray Gun; the teddy bear
// after enough uses moves it to another location.
{
  g.newGame();g.phase='between';g.roundDue=Infinity;g.player.points=100000;
  g.giveWeapon('ray_gun_zm');g.switching=null;const offered=g.boxNames();assert(!offered.includes('raygun_mark2_zm'));assert(!offered.includes('ray_gun_zm'));assert(!offered.includes('m1911_zm'));assert(!offered.includes('an94_zm'),'Wall weapons are not in the box');
  const start=g.activeBox,box=g.boxes.get(start);g.boxUses=8;g.boxMoves=0;g.openBox(box,offered,null);const paid=g.player.points;
  for(let i=0;i<120*10&&box.phase==='cycling';i++){g.time+=1/120;g.updateBoxes();}
  assert.equal(box.phase,'teddy','Eight uses before the first move always bring the bear');assert.equal(g.player.points,paid+950,'The bear refunds the box');
  for(let i=0;i<120*25&&g.activeBox===start;i++){g.time+=1/120;g.updateBoxes();}
  assert.notEqual(g.activeBox,start);assert(!['maze_chest1','maze_chest2'].includes(g.activeBox),'Maze locations wait for the maze');assert.equal(g.boxes.get(g.activeBox).phase,'arriving');assert.equal(g.boxMoves,1);
  report.checks.push('box weapon list, Ray Gun exclusion, teddy bear refund and box move');
}
g.player.position=resume;
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
// Heat is 10% a second of firing, read out of 115 on the gun's counter: it
// reaches 115 after 10 s, locks, and unlocks once cooled (3%/s) to 100.
for(let n=0;n<50;n++){g.time+=.1;g.fire();}assert(Math.abs(g.paralyzerHeat-57.5)<1e-6,'5 s of fire reads 57.5');assert(!g.paralyzerLock);
for(let n=0;n<50;n++){g.time+=.1;g.fire();}assert(g.paralyzerLock);assert.equal(g.paralyzerHeat,115);assert.equal(g.reload(),false);
g.time+=.3;g.tick(4,{});assert(g.paralyzerLock,'Still locked above 100');g.tick(.4,{});assert(!g.paralyzerLock);assert(g.paralyzerHeat<=100.05&&g.paralyzerHeat>99);
// Zombie melee: a swing hurts only on its clip's "fire" notes and only while
// the player is in reach; 60 a hit, then regen returns after 2.4 s.
{
  g.newGame();g.phase='round';g.roundDue=Infinity;g.remaining=0;g.player.position=[-400,-200,16];g.player.health=100;const p=g.player.position;
  const z={id:4242,position:[p[0]+50,p[1],p[2]],angle:Math.PI,gait:'ai_zombie_walk_v1',stage:'hunt',clear:true,sightDue:Infinity,blocked:0,dead:false,health:5000,path:[],age:0,spawnTime:g.time,window:g.windows[0]};
  g.enemies=[z];g.tickEnemy(z,1/120);assert(z.attack,'A zombie in reach starts a melee clip');assert.equal(g.player.health,100,'Starting a swing does no damage');
  assert(z.attack.fires.length>0,'Melee clips carry their fire notes');
  g.time=z.attack.started+z.attack.fires[0]-.01;g.tickEnemy(z,1/120);assert.equal(g.player.health,100);
  g.time=z.attack.started+z.attack.fires[0]+.01;g.tickEnemy(z,1/120);assert.equal(g.player.health,40,'The fire note lands 60');
  // Out of reach when the next swing's note comes: a miss.
  g.time+=5;z.attack=null;g.invulnerableUntil=0;g.player.health=100;g.tickEnemy(z,1/120);const swing=z.attack;assert(swing);
  g.player.position=[p[0]-200,p[1],p[2]];g.time=swing.started+swing.fires[0]+.01;g.tickEnemy(z,1/120);assert.equal(g.player.health,100,'Backing away dodges the swipe');
  g.player.health=40;g.lastDamage=g.time;g.time+=2.3;g.tick(1/120,{});assert.equal(g.player.health,40);g.time+=.2;g.tick(1/120,{});assert.equal(g.player.health,100,'Health returns 2.4 s after a hit');
  assert.equal(g.maxAlive(),24);g.startRound();assert(Math.abs(g.spawnDue-g.time-2.5)<1e-6||g.round===1,'Later rounds wait 2.5 s before spawning');
  report.checks.push('swipe-timed melee, regen, spawn lead and alive cap');
}
// Viewmodel notetrack foley ships with the weapons (the Paralyzer's pullout
// whir), and each chalk piece is drawn by its own <weapon>_chalk_fx.
assert(m.sounds.fly_paralyzer_pullout,'Paralyzer pullout notetrack sound');
for(const e of m.entities.filter(e=>e.nativeItemTarget?.includes('chalk'))){const fx=m.map.chalkPieceEffects[e.zombie_weapon_upgrade]||m.map.chalkPieceEffects.m14_zm;assert(p.effects[fx],'Chalk piece effect '+fx);}
report.checks.push('weapon notetrack foley, chalk piece effects');
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
// Thirteen zombies crowd one standing player: the outer ring can wait just
// past the 58-unit attack reach (separateZombies), which still counts.
const reached=e=>e.dead||e.attacking||e.stage==='hunt'&&Math.hypot(...e.position.map((v,k)=>v-g.player.position[k]))<80;
assert(g.enemies.every(reached),'All town zombies must be able to reach the player after clearing the barrier');
report.checks.push('round 3: all 13 native town zombies traverse the barrier and attack');
// Paralyzer flight: firing straight down rises at 7 m/s, 70° hovers, the
// camera's horizontal facing steers at up to 6 m/s, and the same at 30-144 FPS.
for(const fps of [30,144]){
  g.newGame();g.phase='between';g.roundDue=Infinity;g.setMod('god',true);const at=g.settleFeet([-768,280,52]);Object.assign(g.player,{position:at,previousPosition:at.slice(),grounded:true,velocityZ:0});
  g.giveWeapon('slowgun_zm');for(let i=0;i<240;i++)g.update(1/120,{});g.yaw=0;
  const fly=(deg,secs,input={})=>{g.pitch=-deg*Math.PI/180;for(let i=0;i<Math.round(secs*fps);i++){g.update(1/fps,input);g.paralyzerHeat=0;g.paralyzerLock=false;g.fire();}};
  // Standing or walking while firing straight down does nothing.
  const z=g.player.position[2];fly(90,.5);assert(g.player.grounded&&Math.abs(g.player.position[2]-z)<1&&!g.flight,'Firing on the ground does not lift');
  fly(90,.5,{forward:1});assert(g.player.grounded&&!g.flight,'Walking while firing does not lift');
  Object.assign(g.player,{position:at.slice(),previousPosition:at.slice(),grounded:true,velocityZ:0});
  // A jump starts the flight.
  g.update(1/fps,{jump:true});fly(90,.4);assert(g.player.position[2]-z>80&&Math.abs(g.player.velocityZ-7*39.37)<.5,'Straight down rises at 7 m/s');
  fly(70,1);const hover=g.player.position[2];fly(70,1);assert(Math.abs(g.player.position[2]-hover)<.5,'70° hovers');
  const x=g.player.position[0];fly(70,1.5,{forward:1});assert((g.player.position[0]-x)/1.5>150,'Steers at up to 6 m/s');
  g.pitch=0;for(let i=0;i<fps*8&&!g.player.grounded;i++)g.update(1/fps,{});assert(g.player.grounded,'Lands once the flight lapses');
}
report.checks.push('Paralyzer flight: rise, hover, steering and landing at 30-144 FPS');
// Paralyzer landings on ground zombies cannot reach (a roof, a prop top):
// hovering above them in open air is normal flight; touching one slides the
// player off even while firing to hover and holding back toward it.
for(const top of [[-1400,-1264,296],[-1400,-1072,144]]){
  g.newGame();g.phase='between';g.roundDue=Infinity;g.setMod('god',true);g.giveWeapon('slowgun_zm');for(let i=0;i<240;i++)g.update(1/120,{});
  Object.assign(g.player,{position:[top[0],top[1],top[2]+60],previousPosition:[top[0],top[1],top[2]+60],grounded:false,velocityZ:0});g.yaw=0;
  const shoot=deg=>{g.pitch=-deg*Math.PI/180;g.paralyzerHeat=0;g.paralyzerLock=false;g.fire();};
  for(let i=0;i<60;i++){g.update(1/120,{});shoot(70);}const air=g.player.position[2];for(let i=0;i<120;i++){g.update(1/120,{});shoot(70);assert(!g.unreachableSlide,'Open air above an obstacle is normal flight');}
  assert(Math.abs(g.player.position[2]-air)<1,'Hovers above the obstacle');
  let slid=false,perch=0,longest=0;
  for(let i=0;i<120*12;i++){const s=g.unreachableSlide,late=i>240;if(s)g.yaw=Math.atan2(-s.dir[1],-s.dir[0]);g.update(1/120,late?{forward:1}:{});shoot(late?70:58);
    if(g.unreachableSlide){slid=true;perch+=1/120;longest=Math.max(longest,perch);}else perch=0;}
  assert(slid,'Landing on an unreachable top slides');assert(longest<5,'Never perched on it (longest '+longest.toFixed(2)+' s)');
}
report.checks.push('Paralyzer landings slide off unreachable roofs and props; open-air hover unaffected');
await writeFile(new URL('../local-data/bo2-logic-verification.json',import.meta.url),JSON.stringify(report,null,2));
console.log('Buried logic passed: 40 native spawn/FPS checks, T6 rounds, occupied-zone spawns, perks, progression, equipment, projectiles, saves and audio.');
