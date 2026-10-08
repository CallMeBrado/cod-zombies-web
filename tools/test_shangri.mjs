import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ShangriEngine,routeLength} from '../web/bo1-shangri.js';
import {CollisionWorld} from '../web/collision.js';
import {gaitSpeeds} from '../web/game.js';
import {validateMapModels} from './validate_map_models.mjs';
const read=async f=>JSON.parse(await readFile(new URL('../local-data/'+f,import.meta.url),'utf8'));
const m=await read('gameplay/bo1-temple/manifest.json'),p=await read('gameplay/bo1-temple/presentation.json'),c=await read('bo1-temple/web-world/zombie_temple.collision.json'),paths=await read('bo1-temple/web-world/zombie_temple.paths.json'),nav=await read('gameplay/bo1-temple/navigation.json');
const world=await read('bo1-temple/web-world/zombie_temple.json'),folder=new URL('../local-data/bo1-temple/web-world/',import.meta.url);
const [vertices,indices]=await Promise.all([readFile(new URL(world.vertices,folder)),readFile(new URL(world.indices,folder))]);
assert.equal(vertices.length,world.vertexCount*32);assert.equal(indices.length,world.indexCount*2);
for(let i=0;i<world.vertexCount;i++)for(let k=0;k<7;k++)assert(Number.isFinite(vertices.readFloatLE(i*32+k*4)));
for(const s of world.surfaces){assert(s.baseIndex+s.triangleCount*3<=world.indexCount);assert(s.firstVertex+s.vertexCount<=world.vertexCount);for(let k=0;k<s.triangleCount*3;k++)assert(indices.readUInt16LE((s.baseIndex+k)*2)<s.vertexCount);}
assert(nav.targetNavigation?.links.length,'Complete door-state navigation required');
const make=()=>{const g=new ShangriEngine(m,new CollisionWorld(c,m.entities),paths,{},p);g.prepareSpawnPaths(nav);return g;};
const g=make(),r=g.mapRules,run=(secs,input={})=>{for(let i=0;i<secs*120;i++)g.update(1/120,input);};
assert.equal(g.engine,'black-ops-t5-shangri-la');assert.equal(g.windows.length,29);assert.equal(r.data.perkSlots.length,6);assert.equal(r.data.plates.length,4);assert.equal(new Set(Object.values(r.placements)).size,6);
for(const slot of r.data.perkSlots)assert(slot.allowed.includes(r.placements[slot.index]));
console.log('Shangri: native world, complete navigation, constrained perk shuffle passed');
for(const hz of [30,60,120,240]){const f=make(),at=f.player.position.slice();f.start();f.mods.god=true;f.spawnDue=1e9;for(let i=0;i<hz*2;i++)f.update(1/hz,{});assert(f.player.grounded&&Math.abs(f.player.position[2]-at[2])<.1,'Spawn floor '+hz);assert(f.changeStance('crouch'));assert(f.changeStance('prone'));assert(f.changeStance('stand'));let top=at[2];for(let i=0;i<hz*2;i++){f.update(1/hz,{jump:i===0});top=Math.max(top,f.player.position[2]);}assert(top>at[2]+20);assert(f.player.grounded,'Jump landing '+hz);}
console.log('Shangri: spawn, crouch/prone and jump landing at 30–240 FPS passed');
g.start();g.mods.god=true;run(12);assert(g.enemies.length,'Starting zone zombies must spawn');assert(g.enemies.every(e=>e.position.every(Number.isFinite)));
g.enemies=[];g.spawnDue=1e9;g.player.points=100000;
const switches=g.interactions.filter(e=>e.templeSwitch);assert.equal(switches.length,2);r.use(switches[0]);run(2);assert(!r.power,'First lever alone does not restore power');r.use(switches[1]);assert(!r.power);run(2);assert(r.power&&r.flags.has('power_on'));
for(const e of g.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname)))g.openDoor(e);
assert(r.activeZones().has('power_room_zone'),'Open routes reach the power room');assert(r.slideOpen,'Open lower routes enable the powered slide');
console.log('Shangri: starting spawns, two power switches and doors passed');
const base=g.player.position.slice(),plate=r.data.plates[r.plateOrder.indexOf(1)];
g.player.position=g.settleFeet(plate.position);g.player.previousPosition=g.player.position.slice();r.tick();assert(r.papAvailable,'Solo one-player pressure plate opens stairs: '+JSON.stringify({feet:g.player.position,plate,touched:r.plateTouched}));assert(r.data.papFloor.every(t=>!g.collision.disabled.has(t)));assert(r.data.papBlockers.every(t=>g.collision.disabled.has(t)));
g.player.position=base;g.time=r.papUntil+.01;r.tick();assert(!r.papAvailable);assert(r.data.papFloor.every(t=>g.collision.disabled.has(t)));assert(r.data.papBlockers.every(t=>!g.collision.disabled.has(t)));
const perk=g.interactions.find(e=>e.templePerkSlot!=null);r.use(perk);run(7);assert(r.perks.has(r.placements[perk.templePerkSlot]));
console.log('Shangri: solo pressure plate, timed stairs/collision and randomized perk purchase passed');
r.openPap();g.player.position=g.settleFeet(r.data.plates[0].position);g.player.previousPosition=g.player.position.slice();g.yaw=Math.PI/2;run(7,{forward:1});assert(g.player.position[1]>300&&g.player.position[2]>250,'Walk the raised stairs to Pack-a-Punch: '+g.player.position);g.player.position=base;g.player.previousPosition=base.slice();
for(const kind of ['napalm','sonic']){g.enemies=[];g.remaining=10;assert(g.spawnSpecial(kind),'Reachable native '+kind+' marker');const e=g.enemies[0];assert.equal(e.health,g.zombieHealth*(kind==='napalm'?4:2.5));g.time+=2;for(let i=0;i<120;i++)g.tickEnemy(e,1/120);assert(e.position.every(Number.isFinite));g.hitEnemy(e,e.health);assert(e.dead);if(kind==='napalm')assert(r.fires.length);}
const target=(id,offset)=>({id,position:base.map((v,k)=>v+(k===0?offset:0)),previousPosition:base.slice(),health:900,speed:40,stage:'hunt',path:[],window:g.windows[0],gait:'ai_zombie_walk_v1',age:0,navDue:1e9,attackDue:1e9,dead:false});
g.inventory=[g.makeWeapon('shrink_ray_zm')];g.slot=0;g.enemies=[target(10001,100)];const tiny=g.enemies[0];g.shrinkEnemy(tiny,false);assert.equal(tiny.health,1);assert.equal(tiny.visualScale,.25);g.time=tiny.shrunkUntil+.01;r.tick();assert.equal(tiny.health,900);assert.equal(tiny.visualScale,1);
g.shrinkEnemy(tiny,false);g.player.position=tiny.position.slice();r.tick();assert(tiny.dead&&tiny.gibbed);
g.player.position=base;g.enemies=[];g.drops=[];
const forward=(id,x,y)=>{const e=target(id,0);e.position=g.settleActor([base[0]+x,base[1]+y,base[2]+10])||g.settleActor([base[0]+x,base[1]+y,base[2]+100]);assert(e.position);e.previousPosition=e.position.slice();return e;};
const beamA=forward(11001,0,120),beamB=forward(11002,20,160),outside=forward(11003,-100,120),behind=forward(11004,-100,-100);g.enemies=[beamA,beamB,outside,behind];g.yaw=Math.PI/2;g.pitch=0;g.cooldown=0;g.reloadEnd=0;g.gesture=null;g.switching=null;g.weapon.clip=1;
assert(g.fire(),'Native shrink-ray shot');assert(beamA.shrunkUntil&&beamB.shrunkUntil,'One beam shrinks multiple visible zombies');assert(!outside.shrunkUntil&&!behind.shrunkUntil,'Cylinder excludes side/behind targets');run(.35);assert(g.reloadEnd>g.time,'Last shot finishes, then starts automatic reload');run(5);assert(g.weapon.clip>0);g.enemies=[];g.drops=[];
const monkeyStart=g.settleActor(r.data.monkeySpawns[0].position.map((v,k)=>v+(k===2?80:0))),drop={id:9901,type:'full_ammo',position:monkeyStart.slice(),expires:g.time+30,spawned:g.time};g.drops=[drop];assert(g.spawnMonkey(drop));const monkey=g.enemies.at(-1);g.tickEnemy(monkey,1/120);assert(monkey.carrying);monkey.position[1]-=60;g.time+=.6;g.tickEnemy(monkey,1/120);assert.equal(drop.type,'insta_kill');const points=g.player.points;g.hitEnemy(monkey,monkey.health);assert.equal(g.player.points,points+560,'Native kill points plus stolen power-up bonus');assert(drop.expires>g.time);g.enemies=[];g.drops=[];
for(const kind of ['cart','slide']){if(kind==='cart')r.rideCart();else{r.slideReady=0;r.rideSlide();}assert(r.transport);const save=JSON.parse(JSON.stringify(g.saveState())),h=make();h.loadState(save);assert.equal(h.mapRules.transport.kind,kind);g.time=r.transport.started+r.transport.duration+.01;r.moveTransport();assert(!r.transport);assert(g.player.position.every(Number.isFinite));assert(g.player.grounded,'Stable '+kind+' landing');console.log('Shangri transport:',kind,g.player.position);}
g.player.position=base;g.player.previousPosition=base.slice();const saved=JSON.parse(JSON.stringify(g.saveState())),restored=make();restored.loadState(saved);assert.deepEqual(restored.mapRules.placements,r.placements);assert.deepEqual(restored.mapRules.switches,r.switches);assert(restored.mapRules.power);
console.log('Shangri: special enemies, shrink/restore/stomp, transports and saved progression passed');
const speeds=gaitSpeeds(p.animations).filter(s=>s>0).sort((a,b)=>a-b);let routes=0;
for(const speed of [speeds[0],speeds.at(-1)])for(const window of g.windows){const prepared=g.spawnRoutes.get(window.target);assert(prepared?.choices.length,'Prepared route '+window.target);
  for(const origin of prepared.choices){window.boards=window.maxBoards;window.traverser=null;const path=prepared.routes.get(origin.join(',')).map(p=>p.slice()),length=routeLength([{position:origin},...path.map(position=>({position}))]),limit=Math.max(180,length/speed*1.5+30);
    const e={id:g.nextId++,position:origin.slice(),path,speed,window,stage:'approach',age:0,dead:false,attackDue:0};let t=0;
    while(e.stage==='approach'&&t<limit){g.time+=1/120;g.tickEnemy(e,1/120);t+=1/120;}assert.equal(e.stage,'barrier','Approach '+window.target+' at '+speed);window.boards=0;t=0;
    while(e.stage!=='hunt'&&t<60){g.time+=1/120;g.tickEnemy(e,1/120);t+=1/120;}assert.equal(e.stage,'hunt','Climb '+window.target);assert(e.position.every(Number.isFinite));routes++;
  }
}
console.log('Shangri: '+routes+' authored approach/climb routes at both gait extremes passed');
await validateMapModels('shangri-la');console.log('Shangri-La gameplay passed');
