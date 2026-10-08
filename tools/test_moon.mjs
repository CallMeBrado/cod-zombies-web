import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MoonEngine} from '../web/bo1-moon.js';
import {gaitSpeeds} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
import {validateMapModels} from './validate_map_models.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const m=await read('gameplay/bo1-moon/manifest.json'),p=await read('gameplay/bo1-moon/presentation.json');
const c=await read('bo1-moon/web-world/zombie_moon.collision.json'),paths=await read('bo1-moon/web-world/zombie_moon.paths.json');
const nav=await read('gameplay/bo1-moon/navigation.json');
const world=await read('bo1-moon/web-world/zombie_moon.json'),folder=new URL('../local-data/bo1-moon/web-world/',import.meta.url);
const [vertices,indices]=await Promise.all([readFile(new URL(world.vertices,folder)),readFile(new URL(world.indices,folder))]);
assert.equal(vertices.length,world.vertexCount*32);assert.equal(indices.length,world.indexCount*2);
for(let i=0;i<world.vertexCount;i++)for(let k=0;k<7;k++)assert(Number.isFinite(vertices.readFloatLE(i*32+k*4)),'Finite native vertex/UV');
for(const s of world.surfaces){assert(s.baseIndex>=0&&s.baseIndex+s.triangleCount*3<=world.indexCount);assert(s.firstVertex>=0&&s.firstVertex+s.vertexCount<=world.vertexCount);for(let k=0;k<s.triangleCount*3;k++)assert(indices.readUInt16LE((s.baseIndex+k)*2)<s.vertexCount,'Native surface index');}
const make=()=>{const g=new MoonEngine(m,new CollisionWorld(c,m.entities),paths,{},p);g.prepareSpawnPaths(nav);return g;};
assert(nav.targetNavigation?.links.length,'Build the complete Moon navigation before running gameplay tests');
const g=make(),r=g.mapRules,run=(seconds,input={})=>{for(let i=0;i<seconds*120;i++)g.update(1/120,input);};
const report={};assert.equal(g.engine,'black-ops-t5-moon');assert(g.player.grounded);assert(r.earth);assert.equal(g.player.points,500);assert(g.player.position[0]>10000);assert.equal(g.gravityScale(),1);
console.log('Moon: native geometry and complete navigation ready');
for(const hz of [30,60,120,240]){const f=make(),at=f.player.position.slice();f.start();f.mods.god=true;for(let i=0;i<hz;i++)f.update(1/hz,{});assert(Math.abs(f.player.position[2]-at[2])<.1,'Area 51 floor at '+hz);}
for(const hz of [30,60,120,240]){const f=make();f.start();f.mods.god=true;f.mapRules.travel(false);f.spawnDue=1e9;f.mapRules.nextAstroRound=100;const at=f.player.position.slice();let highest=at[2];for(let i=0;i<hz*6;i++){f.update(1/hz,{jump:i===0});highest=Math.max(highest,f.player.position[2]);}assert(highest>at[2]+100,'Low-gravity jump at '+hz);assert(f.player.grounded&&Math.abs(f.player.position[2]-at[2])<.1,'Lunar landing at '+hz);}
// Hacker airlock holds work before power; only the excavator schedule waits for power.
const h=make();h.start();h.mapRules.travel(false);const tool=h.interactions.find(e=>e.targetname==='zombie_equipment_upgrade'&&e.target===h.mapRules.hackerTarget);h.mapRules.use(tool);const door=h.interactions.find(e=>e.targetname==='zombie_airlock_buy');h.player.position=door.position.slice();h.mapRules.use(door);assert(h.mapRules.hack);h.time+=32.71;h.mapRules.tickDiggers();assert(h.mapRules.doorUnlocked(door.script_flag));assert.equal(h.player.points,300);assert(!h.mapRules.power);
console.log('Moon: Earth/Moon floors and low-gravity jumps at 30–240 FPS; pre-power Hacker passed');
g.start();g.mods.god=true;assert.equal(g.round,0);run(7);assert(g.enemies.length,'No Man’s Land spawns');assert.equal(g.phase,'round');assert(g.remaining>0);report.earthSpawns=g.enemies.length;
assert(r.enabledSpawners().every(e=>e.targetname.startsWith('nml_')));
run(75);assert(g.enemies.filter(e=>!e.dead).every(e=>/fast_sprint/.test(e.gait)),'Area 51 updates the existing horde and new spawners after the first warning');assert.equal(g.phase,'round');assert.equal(g.enemies.filter(e=>!e.dead).length,20,'No Man’s Land reaches its native AI cap');assert(m.sounds.evt_nomans_warning?.length,'Native No Man’s Land warning');
// Invalid native markers cannot fall into the window fallback in this area.
const available=r.enabledSpawners.bind(r);r.enabledSpawners=()=>[{origin:'1000000 1000000 1000000',script_string:'zombie_chaser'}];assert.doesNotThrow(()=>g.spawnEnemy());r.enabledSpawners=available;
console.log('Moon: 82 seconds in No Man’s Land and unsupported marker fallback passed');
const portal=m.map.teleports.find(e=>e.targetname==='nml_teleporter');g.player.position=g.settleFeet([portal.position[0],portal.position[1],portal.position[2]-32]);g.player.previousPosition=g.player.position.slice();g.time=21;r.portals();assert(r.portal);g.time+=2.51;r.portals();assert(!r.earth);assert.equal(g.round,1);assert(g.player.position[0]<10000);assert.equal(g.gravityScale(),136/800);
assert(g.collision.actor(()=>g.collision.trace([g.player.position[0],g.player.position[1],g.player.position[2]+35],[g.player.position[0],g.player.position[1],g.player.position[2]+35],[14,14,34.8]).allSolid)===false);
const moonFeet=g.player.position.slice();g.mods.god=false;g.enemies=[];g.spawnDue=1e9;r.nextAstroRound=100;run(6);assert(r.oxygen>5);g.player.health=100;
const suit=g.interactions.find(e=>e.targetname==='zombie_equipment_upgrade'&&e.zombie_equipment_upgrade==='equip_gasmask_zm');r.use(suit);assert.equal(r.equipment,'pes');assert(g.placeEquipment());run(4);assert(r.pes);assert.equal(r.oxygen,0);assert.equal(g.phase,'round');report.pes='15 s oxygen, equip gesture, breathing, vacuum protection';
g.player.points=100000;
console.log('Moon: automatic portal and P.E.S. protection passed');
const buys=g.interactions.filter(e=>e.targetname==='zombie_airlock_buy');assert.equal(buys.length,21);for(const e of buys)r.use(e);
for(const e of g.interactions.filter(e=>e.targetname==='zombie_door'))g.openDoor(e);
assert(r.activeZones().has('forest_zone'));assert(r.activeZones().has('generator_zone'));
const lock=m.map.airlocks.find(a=>a.flag==='receiving_exit');g.player.position=g.settleFeet([lock.position[0]-60,lock.position[1],lock.position[2]-35]);r.tick();assert(r.airlocks[lock.targets[0]]);assert(g.collision.disabled.has(lock.targets[0]));g.player.position=moonFeet;report.doors=buys.length;
r.use(g.interactions.find(e=>e.targetname==='use_power_switch'));assert(r.power);assert.equal(g.gravityScale(),1,'Receiving bay pressurizes with power');
const perks=g.interactions.filter(e=>e.targetname==='zombie_vending'&&e.position[0]<10000);
const flopper=perks.find(e=>e.script_noteworthy==='specialty_flakjacket');assert(flopper);r.use(flopper);run(8);assert(r.perks.has('specialty_flakjacket'));r.perks.add('specialty_additionalprimaryweapon');g.giveWeapon('ak74u_zm');g.switching=null;g.giveWeapon('mp5k_zm');g.switching=null;assert.equal(g.inventory.length,3);
g.inventory=[g.makeWeapon('microwavegundw_zm')];g.slot=0;assert.equal(g.weapon.reserve,64);assert(g.alternateWeapon());g.switching=null;assert.equal(g.weapon.name,'microwavegun_zm');assert.equal(g.weapon.reserve,12);g.weapon.clip=1;assert(g.alternateWeapon());g.switching=null;assert.equal(g.weapon.name,'microwavegundw_zm');assert(g.alternateWeapon());g.switching=null;assert.equal(g.weapon.clip,1,'Mode ammunition persists');
g.yaw=Math.PI/2;g.pitch=0;g.cooldown=0;g.reloadEnd=0;g.enemies=[];
const target=(id,x,y)=>({id,position:[moonFeet[0]+x,moonFeet[1]+y,moonFeet[2]],previousPosition:moonFeet.slice(),health:100000,dead:false,stage:'hunt',path:[],window:g.windows[0],gait:'ai_zombie_walk_v1',speed:0,age:0,navDue:1e9,attackDue:1e9});
const a=target(1001,0,130),b=target(1002,40,180);g.enemies.push(a,b);assert(g.fire());assert(a.waveDue&&b.waveDue,'Wave Gun hits multiple zombies in its cylinder');g.spawnDue=1e9;run(3);assert(a.dead&&b.dead);assert(!g.drops.length,'Wave Gun deaths do not drop powerups');report.waveGun='both native modes, independent ammo, multi-target vaporization';
g.enemies=[];r.spawnAstro();const astro=g.enemies.find(e=>e.kind==='astronaut');assert(astro);assert(astro.ignoreRound);assert.equal(astro.health,g.zombieHealth*4);g.firingWave='microwavegundw_zm';g.hitEnemy(astro,1e6);g.firingWave=null;assert(!astro.dead);g.player.health=100;r.perks.add('specialty_armorvest');const count=r.perks.size;r.astroGrab(astro);assert.equal(r.perks.size,count-1);assert(g.player.health<=1);g.mods.god=true;g.hitEnemy(astro,astro.health);assert(astro.dead);report.astronaut='ignores rounds/instakill, Wave Gun immune, grabs and steals perks';
g.player.position=moonFeet;g.player.previousPosition=moonFeet.slice();r.nextAstroRound=100;
const hacker=g.interactions.find(e=>e.targetname==='zombie_equipment_upgrade'&&e.target===r.hackerTarget);r.use(hacker);assert.equal(r.equipment,'hacker');assert(!r.pes);
r.startDigger('teleporter');const d=m.map.diggers[0];g.time=r.diggers.teleporter.breachAt+.01;r.tickDiggers();assert(r.diggers.teleporter.breached);assert(r.breached('cata_left_start_zone'));assert(!g.collision.disabled.has(d.blocker));
const panel=g.interactions.find(e=>e.targetname===d.trigger);g.player.position=panel.position.slice();r.use(panel);assert(r.hack);const points=g.player.points;g.time+=5.01;r.tickDiggers();assert(r.diggers.teleporter.stopped);assert.equal(g.player.points,points+1000);assert(g.collision.disabled.has(d.blocker));assert(r.breached('cata_left_start_zone'),'Hacking does not restore a breached atmosphere');report.excavator='240 s warning, breach, five-second hack and +1000 reward';
const pad=m.map.jumpPads.find(p=>p.vertical);g.player.position=g.settleFeet([pad.position[0],pad.position[1],pad.position[2]]);g.player.previousPosition=g.player.position.slice();const beforePad=g.player.position[2];r.jumpPads();assert(r.flight);g.time+=r.flight.duration+.1;r.jumpPads();assert(!r.flight);assert(g.player.position[2]>beforePad+100);report.jumpPads=m.map.jumpPads.length;
g.player.position=moonFeet;g.player.previousPosition=moonFeet.slice();g.phase='round';g.remaining=6;g.round=3;r.travel(true);assert(r.earth);assert.equal(r.moonRound.round,3);assert.equal(r.moonRound.remaining,6);assert.equal(r.earthGateReady,g.time+75);r.travel(false);assert.equal(g.round,3);assert.equal(g.remaining,6);assert.equal(r.moonGateReady,g.time+120);
console.log('Moon: power, perks, Wave Gun, astronaut, excavator, jump pads and round resume passed');
const saved=JSON.parse(JSON.stringify(g.saveState())),restored=make();restored.loadState(saved);assert.deepEqual(restored.mapRules.diggers,r.diggers);assert.equal(restored.mapRules.equipment,'hacker');assert.equal(restored.round,3);assert.deepEqual(restored.waveAmmo,g.waveAmmo);report.save='Moon/Earth round state, equipment, doors, excavators and weapon modes';
const suitSave=structuredClone(saved);suitSave.rules.moon.equipment='pes';suitSave.rules.moon.pes=true;restored.loadState(suitSave);assert.equal(restored.weapon.definition.handsModel,'viewmodel_zom_pressure_suit_arms','P.E.S. hands are restored after the saved rules load');assert.equal(restored.weapon.definition.rigVariant,'pes');
// Every prepared native window must support approach and climbing at both gait extremes.
const walker=make();walker.start();walker.mapRules.travel(false);walker.player.points=100000;
walker.mods.god=true;walker.mapRules.nextAstroRound=100;
for(const e of walker.interactions.filter(e=>e.targetname==='zombie_airlock_buy'))walker.mapRules.use(e);
for(const e of walker.interactions.filter(e=>e.targetname==='zombie_door'))walker.openDoor(e);
const speeds=gaitSpeeds(p.animations).filter(s=>s>0).sort((a,b)=>a-b);let routes=0;
for(const speed of [speeds[0],speeds.at(-1)])for(const window of walker.windows){const prepared=walker.spawnRoutes.get(window.target);assert(prepared?.choices.length,'Prepared route: '+window.target);
  for(const origin of prepared.choices){window.boards=window.maxBoards;window.traverser=null;const path=prepared.routes.get(origin.join(',')).map(p=>p.slice()),length=path.reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,k)=>v-(i?path[i-1]:origin)[k])),0),limit=Math.max(180,length/speed*1.5+30);
    const enemy={id:walker.nextId++,position:origin.slice(),path,speed,window,stage:'approach',age:0,dead:false,attackDue:0};let seconds=0;
    while(enemy.stage==='approach'&&seconds<limit){walker.time+=1/120;walker.tickEnemy(enemy,1/120);seconds+=1/120;}assert.equal(enemy.stage,'barrier','Approach stuck: '+JSON.stringify({window:window.target,origin,speed,position:enemy.position,next:enemy.path[0]}));
    window.boards=0;let crossing=0;while(enemy.stage!=='hunt'&&crossing<60){walker.time+=1/120;walker.tickEnemy(enemy,1/120);crossing+=1/120;}assert.equal(enemy.stage,'hunt','Window crossing: '+window.target);assert(enemy.position.every(Number.isFinite));routes++;
  }
  console.log('Moon route:',window.target,'at',speed,'units/s');
}
report.windowRoutes=routes;
// Use a real lunar vent and native ground/path tests for the Nova crawler.
walker.enemies=[];walker.remaining=1;const vent=m.map.quadSpawners.find(v=>{const at=walker.settleActor(v.origin.split(/\s+/).map(Number));return at&&walker.walkableLink(at,at);});assert(vent);const at=walker.settleActor(vent.origin.split(/\s+/).map(Number));walker.player.position=at.slice();walker.mapRules.enabledSpawners=()=>[vent];walker.spawnEnemy();const quad=walker.enemies[0];assert.equal(quad?.kind,'quad');assert.equal(quad.health,walker.zombieHealth*.75);assert(p.actorVariants.quad.animations[quad.gait]);assert.equal(walker.remaining,0);walker.player.position=walker.player.position.map((v,k)=>v+(k===0?50:0));walker.mods.god=true;for(let i=0;i<120;i++){walker.time+=1/120;walker.tickEnemy(quad,1/120);}assert(quad.position.every(Number.isFinite));report.quad='Native vent, health, low-gravity gait and chase';
report.pack=await validateMapModels('moon');console.log('Moon passed:',JSON.stringify(report));
