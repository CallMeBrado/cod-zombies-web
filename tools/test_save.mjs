import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const make=(data,zone,asset)=>{
  const m=read(data+'/manifest.json'),g=new SoloGame(m,new CollisionWorld(read(zone+'/web-world/'+asset+'.collision.json'),m.entities),read(zone+'/web-world/'+asset+'.paths.json'),{},read(data+'/presentation.json'));
  g.prepareSpawnPaths(read(data+'/navigation.json'));g.newGame();return g;
};
// Seeded Math.random, so the original and the restored game can replay the same seconds.
const realRandom=Math.random;
const seed=n=>{let x=n>>>0;Math.random=()=>{x=(x+0x6D2B79F5)>>>0;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};};
const run=(g,seconds)=>{for(let t=0;t<seconds;t+=1/120)g.tick(1/120,{});};
const report={};
for(const [name,data,zone,asset]of [['nacht','gameplay','nacht','nazi_zombie_prototype'],['der-riese','gameplay/der-riese','der-riese','nazi_zombie_factory']]){
  seed(7);const g=make(data,zone,asset);g.start();
  // Round 3 in progress with live zombies at the windows and inside.
  while(g.round<3){g.time+=1/120;if(g.phase==='between'&&g.time>=g.roundDue)g.startRound();else if(g.phase==='round'){g.remaining=0;g.enemies=[];g.phase='between';g.roundDue=g.time;}}
  run(g,25);
  // Progress worth keeping: points, a second weapon, an open door, a torn window,
  // a drop on the floor, an active powerup, a cycling box, and Der Riese map state.
  g.player.points=12345;g.player.kills=77;g.player.headshots=9;g.player.grenades=2;
  const second=Object.keys(g.data.weapons).find(n=>n!=='zombie_colt'&&!n.endsWith('_upgraded'));g.giveWeapon(second);run(g,2);g.weapon.clip=7;g.weapon.reserve=99;g.player.health=80;g.lastDamage=g.time;
  const door=g.interactions.find(e=>e.zombie_cost&&!e.targetname.includes('weapon')&&e.targetname!=='treasure_chest_use');g.opened.add(door.target);g.collision.disabled.add(door.target);g.invalidateNavigation([door.target]);
  g.windows[0].boards=2;g.addDrop('double_points',[g.player.position[0]+300,g.player.position[1],g.player.position[2]]);g.powerup.insta_kill=g.time+12;
  const box=[...g.boxes.values()][0];if(box)Object.assign(box,{phase:'cycling',names:[second],started:g.time,index:0,nextAt:g.time+.5,weapon:null});
  if(g.mapRules){const r=g.mapRules;r.power=true;r.flags.add('electricity_on');r.perks.add('specialty_armorvest');r.links.add(1);r.linkPending={id:2,due:g.time+20,started:g.time-10,ticks:10};r.later(5,{specialDrop:[0,0,0]});}
  const alive=g.enemies.filter(e=>!e.dead);assert(alive.length>=3,'Zombies are alive at the save');
  assert(g.canSave());
  const saved=JSON.parse(JSON.stringify(g.saveState()));
  // Restore into a fresh game, as the main menu does on another page load.
  const h=make(data,zone,asset);h.loadState(saved);
  assert.equal(h.phase,'round');assert.equal(h.round,3);assert.equal(h.time,g.time);assert.equal(h.remaining,g.remaining);assert.equal(h.zombieHealth,g.zombieHealth);
  assert.deepEqual(h.enemies.map(e=>[e.id,e.stage,e.health,e.window.target,e.position]),alive.map(e=>[e.id,e.stage,e.health,e.window.target,e.position]),'Live zombies restored');
  assert.deepEqual(h.windows.map(w=>[w.boards,(w.attackers||[]).map(e=>e?.id??null),w.traverser?.id??null]),g.windows.map(w=>[w.boards,[0,1,2].map(i=>g.holdsSpot(w.attackers?.[i])?w.attackers[i].id:null),w.traverser&&!w.traverser.dead?w.traverser.id:null]),'Barrier spots restored');
  assert.equal(h.player.points,12345);assert.equal(h.player.kills,77);assert.equal(h.player.headshots,9);assert.equal(h.player.health,80);
  assert.deepEqual(h.inventory.map(w=>w.name),['zombie_colt',second]);assert.equal(h.weapon.name,second);assert.equal(h.weapon.clip,7);assert.equal(h.weapon.reserve,99);
  assert(h.opened.has(door.target)&&h.collision.disabled.has(door.target));assert.equal(h.windows[0].boards,2);
  assert.deepEqual(h.drops.map(d=>[d.type,d.expires]),g.drops.map(d=>[d.type,d.expires]));assert.equal(h.powerup.insta_kill,g.powerup.insta_kill);
  if(box)assert.equal([...h.boxes.values()][0].phase,'cycling');
  if(h.mapRules){const r=h.mapRules;assert(r.power);assert(r.perks.has('specialty_armorvest'));assert.equal(r.maxHealth,160);assert(r.links.has(1));assert(r.activeZones().size>1);assert.equal(r.linkPending.id,2);assert.equal(r.pending.length,g.mapRules.pending.length);}
  // Replaying the same seconds from the save matches the original session.
  let started=false;h.events.sessionStart=()=>started=true;h.start();assert(started,'Resuming restarts the session audio');
  seed(99);run(g,6);seed(99);run(h,6);
  const state=x=>x.enemies.filter(e=>!e.dead).map(e=>[e.id,e.stage,e.health,...e.position.map(v=>Math.round(v*10)/10)]);
  assert.deepEqual(state(h),state(g),'The restored session plays out like the original');
  assert.equal(h.remaining,g.remaining);assert.equal(h.player.health,g.player.health);
  // Mid-drink or mid-upgrade saves would lose spent points, so they are refused.
  if(h.mapRules){h.startGesture('specialty_rof');assert(!h.canSave());h.gesture=null;}
  // Older saves (version 1) still load, restarting their round.
  const legacy=make(data,zone,asset);legacy.loadLegacyState({version:1,round:2,zombieHealth:350,resumeRound:3,player:{position:g.spawn,health:100,points:900,kills:5,headshots:1,grenades:4},yaw:0,pitch:0,inventory:[{name:'zombie_colt',clip:8,reserve:32}],slot:0,opened:[],disabled:[],boards:[],rules:null});
  assert.equal(legacy.phase,'ready');assert.equal(legacy.player.points,900);
  report[name]={round:h.round,zombies:h.enemies.filter(e=>!e.dead).length,stages:[...new Set(alive.map(e=>e.stage))],bytes:JSON.stringify(saved).length};
}
Math.random=realRandom;
console.log(JSON.stringify({saves:report}));
