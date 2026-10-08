import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CollisionWorld} from '../web/collision.js';
import {ShiNoNumaGame,floggerRotation} from '../web/waw-shi-no-numa.js';
import {validateMapModels} from './validate_map_models.mjs';
import * as THREE from 'three';
import {BulletTrace} from '../web/bullet-trace.js';
import {ShiNoNumaView} from '../web/waw-shi-no-numa-view.js';
import {SkeletonRagdoll} from '../web/ragdoll.js';
import {ZombieActors} from '../web/actors.js';
import {gaitSpeeds} from '../web/game.js';

const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const m=await read('gameplay/shi-no-numa/manifest.json'),p=await read('gameplay/shi-no-numa/presentation.json');
const c=await read('shi-no-numa/web-world/nazi_zombie_sumpf.collision.json'),paths=await read('shi-no-numa/web-world/nazi_zombie_sumpf.paths.json');
const world=await read('shi-no-numa/web-world/nazi_zombie_sumpf.json');
const folder=new URL('../local-data/shi-no-numa/web-world/',import.meta.url);
const [vertices,indices]=await Promise.all([readFile(new URL(world.vertices,folder)),readFile(new URL(world.indices,folder))]);
assert.equal(vertices.length,world.vertexCount*32);assert.equal(indices.length,world.indexCount*2);
for(let v=0;v<world.vertexCount;v++)for(let k=0;k<7;k++)assert(Number.isFinite(vertices.readFloatLE(v*32+k*4)),'Finite position/UV at vertex '+v);
for(const s of world.surfaces){assert(s.baseIndex>=0&&s.baseIndex+s.triangleCount*3<=world.indexCount);assert(s.firstVertex>=0&&s.firstVertex+s.vertexCount<=world.vertexCount);for(let k=0;k<s.triangleCount*3;k++)assert(indices.readUInt16LE((s.baseIndex+k)*2)<s.vertexCount,'Native relative surface index');}
for(const material of Object.values(world.materials).filter(m=>m.diffuse==='ch_godray01')){assert.equal(material.blend,'screen');assert(material.emissive,'Light shafts must not become opaque black walls');}
const swamp=world.materials['wc/water_sumpf_muddy_green'];assert.equal(swamp.diffuse,null,'Water must not display its blue diagnostic colorMap');assert.deepEqual(swamp.tint,[0.23921599984169006,0.2705880105495453,0.17254899442195892]);assert.equal(swamp.normal,'test_mitton_water');
const make=(events={})=>new ShiNoNumaGame(structuredClone(m),new CollisionWorld(c,m.entities),paths,events,p);
const g=make(),r=g.mapRules;
// Native dog rigs must not enter the humanoid corpse solver: a missing chest
// joint previously threw during the kill event and stopped the render loop.
for(const config of Object.values(p.actorVariants)){
  const bytes=await readFile(new URL('../local-data/shi-no-numa/model_export/'+config.body+'_lod0.glb',import.meta.url));
  const data=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12))),joints=new Set(data.skins.flatMap(s=>s.joints));
  const nodes=data.nodes.map((n,i)=>{const b=joints.has(i)?new THREE.Bone():new THREE.Object3D();b.name=n.name||'';if(n.translation)b.position.fromArray(n.translation);if(n.rotation)b.quaternion.fromArray(n.rotation);if(n.scale)b.scale.fromArray(n.scale);return b;});
  data.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
  const root=new THREE.Group();for(const id of data.scenes[data.scene||0].nodes)root.add(nodes[id]);
  const ragdoll=new SkeletonRagdoll(root);assert(!ragdoll.ready,'Dogs use their native death/gib, rather than humanoid ragdolls');
  const actors=new ZombieActors(new THREE.Scene(),{illumination:()=>[1,1,1]},p),slot={root,object:root,mixer:new THREE.AnimationMixer(root),actions:new Map(),materials:[],trace:{tick:-1},ragdoll};
  actors.pool.push(slot);const enemy={id:1,kind:'hellhound',position:[0,0,0],angle:0,stage:'hunt',dead:false};actors.acquire(enemy);
  enemy.dead=true;assert.equal(actors.kill(enemy),false);enemy.gibbed=true;actors.updateOne(slot,.016,enemy.position);assert.equal(root.visible,false);actors.release(enemy.id);assert.equal(actors.pool.length,1);
}
// A moving native brush must trace in its current pose, with no stale wall
// left behind and no array/vector mismatch in the posed-trace API.
const moving=new THREE.Group(),cube=new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));moving.position.x=30;moving.add(cube);moving.updateMatrixWorld(true);
const bullets=new BulletTrace();bullets.addRoot(moving);const dynamic=new Map([[m.map.flogger.targets[0],[{object:moving,entity:{angles:'0 0 0'}}]]]);
const view=new ShiNoNumaView(new THREE.Scene(),{bullets,illumination:()=>[1,1,1]},dynamic,m);
assert(Math.abs(bullets.trace([0,0,0],[1,0,0],100).distance-25)<1e-6);
moving.position.x=70;view.poseTick++;assert(Math.abs(bullets.trace([0,0,0],[1,0,0],100).distance-65)<1e-6);
moving.visible=false;view.poseTick++;assert.equal(bullets.trace([0,0,0],[1,0,0],100),null);assert.equal(bullets.trace([0,0,0],[NaN,0,0],100),null);
// Separate machine instances keep simultaneous hut lotteries visible.
for(const slot of m.map.perkSlots)for(const id of Object.keys(r.placements)){const object=new THREE.Group(),root=new THREE.Group();root.add(object);view.perks.push({id,slot:slot.index,root,object});}
r.reveals=Object.fromEntries(m.map.perkSlots.map(s=>[s.index,g.time]));view.update(g,[]);assert.equal(view.perks.filter(v=>v.root.visible).length,4);
g.time+=5;view.update(g,[]);for(const slot of m.map.perkSlots){const visible=view.perks.filter(v=>v.slot===slot.index&&v.root.visible);assert.equal(visible.length,1);assert.equal(r.placements[visible[0].id],slot.index);assert.deepEqual(visible[0].root.position.toArray(),slot.position);}
g.time=0;r.reveals={};
assert.equal(g.data.map.id,'shi-no-numa');assert(g.player.grounded);assert.equal(g.windows.length,19);assert.equal(r.power,true);
assert.equal(g.player.points,500,'Developer-only script blocks must not change the starting score');assert.equal(g.zombieHealth,150);
assert(g.player.position.every(Number.isFinite));assert(g.data.map.fallDeathZ<-900);
assert.equal(new Set(Object.values(r.placements)).size,4);assert(r.nextDogRound>=5&&r.nextDogRound<8);
assert.equal(g.data.weapons.tesla_gun.clipSize,3);assert.equal(g.data.weapons.ray_gun.clipSize,20);
assert(!g.interactions.some(e=>e.targetname==='use_power_switch'||e.targetname==='zombie_vending_upgrade'));
assert(r.enabledSpawners().every(e=>e.targetname==='zombie_spawner_init'));
assert.deepEqual([...r.activeZones()],['center_building_upstairs']);
for(const name of ['mx_splash_screen','mx_zombie_wave_1','dark_sting','bright_sting','rando_start','perk_lottery'])assert(g.data.sounds[name]?.length,'Original sound missing: '+name);
for(const hz of [30,60,120,240]){const f=make();f.start();const at=f.player.position.slice();for(let i=0;i<hz;i++)f.update(1/hz,{});assert(f.player.grounded);assert(Math.abs(f.player.position[2]-at[2])<.1,'Spawn support at '+hz+' FPS');}
g.start();g.player.points=100000;
const stairs=g.interactions.find(e=>e.script_flag==='unlock_hospital_downstairs');g.openDoor(stairs);assert(r.activeZones().has('center_building_combined'));
const path=g.interactions.find(e=>e.script_flag==='nw_magic_box');g.openDoor(path);assert(r.activeZones().has('northwest_outside'));assert(g.collision.disabled.has(path.target+'_door'));
const hut=g.interactions.find(e=>e.script_flag==='northwest_building_unlocked');g.openDoor(hut);assert(r.activeZones().has('northwest_building'));assert(r.reveals[0]!=null);
const first=Object.keys(r.placements).find(id=>r.placements[id]===0);assert(['specialty_armorvest','specialty_fastreload'].includes(first),'Solo first hut reveals Jugger-Nog or Speed Cola');
const perk=g.interactions.find(e=>e.script_noteworthy===first);assert(!r.visible(perk));g.time+=4.81;assert(r.visible(perk));r.use(perk);assert(g.gesture);g.time+=g.gesture.definition.firstRaiseTime+.01;g.updateGesture();assert(r.perks.has(first));g.gesture=null;
const flogger=g.interactions.find(e=>e.targetname==='pendulum_buy_trigger'),money=g.player.points;r.use(flogger);assert.equal(g.player.points,money-750);assert(Math.abs(r.flogger.until-r.flogger.live-30)<1e-9);assert(Math.abs(r.flogger.ready-r.flogger.until-45)<1e-9);r.use(flogger);assert.equal(g.player.points,money-750);
g.time=r.flogger.live+6;
const hull=m.map.flogger.hulls[0],center=hull.mins.map((v,k)=>(v+hull.maxs[k])/2),pivot=m.map.flogger.origin,angle=floggerRotation(g.time,r.flogger.live),dx=center[0]-pivot[0],dz=center[2]-pivot[2];
const contact=[pivot[0]+Math.cos(angle)*dx+Math.sin(angle)*dz,center[1],pivot[2]-Math.sin(angle)*dx+Math.cos(angle)*dz-30];
assert(r.floggerTouches(contact),'The hurt brush follows the rotating logs');
const victim={id:g.nextId++,position:contact,health:200,dead:false,stage:'hunt'},immune={...victim,id:g.nextId++,kind:'hellhound'};g.enemies.push(victim,immune);
const score=g.player.points;r.tick();assert(victim.dead);assert(!immune.dead,'Native Hellhounds ignore the Flogger');assert.equal(g.player.points,score,'Trap kills do not award points');g.enemies=[];
g.time=r.flogger.until+.01;r.tick();assert(!g.collision.disabled.has(m.map.flogger.targets[0]),'Stopped logs regain their collision');
// The native schedule and health apply independently of zombie health.
g.round=r.nextDogRound-1;g.startRound();assert(r.dogRound);assert.equal(g.remaining,6);assert.equal(g.maxAlive(),2);assert.equal(g.spawnDue-g.time,7);
g.spawnEnemy();const h=g.enemies.at(-1);assert(h.kind.startsWith('hellhound'));assert.equal(h.health,350);assert.equal(h.stage,'dog-spawn');g.hitEnemy(h,99999);assert(!h.dead,'Lightning-spawn shield');
g.time=h.spawnReady+.01;g.tickEnemy(h,.01);assert.equal(h.stage,'hunt');assert(h.position.every(Number.isFinite));g.hitEnemy(h,h.health);assert(h.dead&&h.gibbed);
g.remaining=0;r.tick();assert.equal(g.drops.filter(d=>d.type==='full_ammo').length,1);r.tick();assert.equal(g.drops.filter(d=>d.type==='full_ammo').length,1,'Only the final dog awards Max Ammo');
for(const [health,count]of [[700,2],[1000,3],[1250,4]]){r.dogRounds=count;g.remaining=1;g.spawnEnemy();assert.equal(g.enemies.at(-1).health,health);}
// Open all native doors: the lower swamp must have a usable, safe exit.
for(const e of g.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname)))g.openDoor(e);
const activate=g.interactions.find(e=>e.targetname==='zip_lever_trigger');r.use(activate);assert(r.zip.activated);assert(r.zip.ride&&!r.riding);
g.time=r.zip.ride.started+r.zip.ride.duration+.01;r.tick();assert(r.zip.lower&&!r.zip.ride);
g.time=r.zip.ready+.01;const lower=g.interactions.find(e=>e.targetname==='zipline_buy_trigger'&&e.script_noteworthy==='static');r.use(lower);assert(r.riding);
g.time=r.zip.ride.started+r.zip.ride.duration/2;r.tick();assert(g.player.grounded&&g.player.position.every(Number.isFinite));
const save=g.saveState(),restored=make();restored.loadState(save);assert.deepEqual(restored.mapRules.placements,r.placements);assert(restored.mapRules.riding);assert.equal(restored.mapRules.nextDogRound,r.nextDogRound);
g.time=r.zip.ride.started+r.zip.ride.duration+.01;r.tick();assert(!r.riding&&!r.zip.lower);assert(g.player.position[2]>g.data.map.fallDeathZ);
// The real chain is capped at 20 enemies and cannot arc through solid cover.
const t=make();t.start();t.phase='round';t.enemies=[];const originalTrace=t.collision.trace.bind(t.collision);t.collision.trace=()=>({fraction:1});
for(let i=0;i<25;i++)t.enemies.push({id:i+1,position:[i*5,0,0],health:10000,stage:'hunt',dead:false});
t.explode({weapon:'tesla_gun',id:1},{end:[0,0,35],hit:{enemy:t.enemies[0]}});assert.equal(t.arcJobs.length,20);
t.collision.trace=originalTrace;t.tickEnemy=()=>{};t.separateZombies=()=>{};t.time=10;t.tick(.001,{});assert.equal(t.enemies.filter(e=>e.dead).length,20);assert.equal(t.arcJobs.length,0);
const nav=await read('gameplay/shi-no-numa/navigation.json');const n=make();n.prepareSpawnPaths(nav);n.useGateNavigation(await read('gameplay/shi-no-numa/gate-navigation.json'));n.start();n.remaining=4;n.spawnEnemy();assert(n.enemies.length,'Upstairs has a prepared spawn route');
const walker=make();walker.prepareSpawnPaths(nav);walker.useGateNavigation(await read('gameplay/shi-no-numa/gate-navigation.json'));for(const e of walker.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname)))walker.openDoor(e);
const speeds=gaitSpeeds(p.animations).sort((a,b)=>a-b),routeChecks=[];
for(const speed of [speeds[0],speeds.at(-1)])for(const window of walker.windows){const prepared=walker.spawnRoutes.get(window.target);
  // Outdoor risers pursue the player directly; their incidental cached
  // cross-map window routes are never selected by the building spawner.
  const choices=prepared.choices.filter(origin=>walker.spawnEntities.some(e=>e.targetname===walker.mapRules.group(window)&&e.origin.split(/\s+/).map(Number).join(',')===origin.join(',')));assert(choices.length,'Usable native building route: '+window.target);
  for(const origin of choices){window.boards=window.maxBoards;window.traverser=null;const path=prepared.routes.get(origin.join(',')).map(p=>p.slice()),length=path.reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,k)=>v-(i?path[i-1]:origin)[k])),0),limit=Math.max(120*Math.max(1,47/speed),length/speed*1.5+30);const enemy={id:walker.nextId++,position:origin.slice(),path,speed,window,stage:'approach',age:0,dead:false,attackDue:0};let seconds=0;
    while(enemy.stage==='approach'&&seconds<limit){walker.time+=1/120;walker.tickEnemy(enemy,1/120);seconds+=1/120;}assert.equal(enemy.stage,'barrier','Route stuck: '+JSON.stringify({target:window.target,origin,speed,position:enemy.position,outside:window.outside,next:enemy.path[0],pathLeft:enemy.path.length}));
    window.boards=0;let crossing=0;while(enemy.stage!=='hunt'&&crossing<60){walker.time+=1/120;walker.tickEnemy(enemy,1/120);crossing+=1/120;}assert.equal(enemy.stage,'hunt','Window crossing stuck: '+window.target);assert(enemy.position.every(Number.isFinite));routeChecks.push({target:window.target,speed,seconds,crossing});
  }
}
console.log('Native Shi No Numa barrier approaches/traversals passed:',routeChecks.length,'at',speeds[0],'and',speeds.at(-1),'units/s.');
for(const area of ['northwest','northeast','southeast','southwest']){
  const spawners=walker.spawnEntities.filter(e=>e.targetname===area+'_outside_spawners');let at;
  for(const s of spawners){const floor=walker.settleActor(s.origin.split(/\s+/).map(Number));if(!floor)continue;walker.player.position=floor;if(walker.mapRules.occupiedZones().has(area+'_outside')){at=floor;break;}}
  assert(at,'Supported outdoor play area: '+area);walker.enemies=[];walker.remaining=1;walker.mods.god=true;walker.mapRules.dogRound=false;
  for(let attempt=0;attempt<20&&!walker.enemies.length;attempt++)walker.mapRules.spawnEnemy();const enemy=walker.enemies[0];assert(enemy,'Native outdoor riser: '+area);assert.equal(enemy.stage,'rise');
  const riseSeconds=enemy.riseUntil-walker.time+3;
  for(let n=0;n<Math.ceil(120*riseSeconds);n++){walker.time+=1/120;walker.tickEnemy(enemy,1/120);assert(enemy.position.every(Number.isFinite)&&enemy.position[2]>m.map.fallDeathZ);}
  assert.equal(enemy.stage,'hunt','Outdoor riser finishes its native animation: '+area);
}
await validateMapModels('shi-no-numa');
console.log('Shi No Numa passed: native spawn at 30–240 FPS, hut gates/perk lottery, Flogger, Hellhound schedule/health/shield/Max Ammo, zipline/rider/save, Wunderwaffe chain and prepared routes.');
