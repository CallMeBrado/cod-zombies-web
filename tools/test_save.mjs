import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const make=(data,zone,asset)=>{
  const m=read(data+'/manifest.json'),g=new SoloGame(m,new CollisionWorld(read(zone+'/web-world/'+asset+'.collision.json'),m.entities),read(zone+'/web-world/'+asset+'.paths.json'),{},read(data+'/presentation.json'));
  g.prepareSpawnPaths(read(data+'/navigation.json'));g.newGame();return g;
};
const report={};
for(const [name,data,zone,asset]of [['nacht','gameplay','nacht','nazi_zombie_prototype'],['der-riese','gameplay/der-riese','der-riese','nazi_zombie_factory']]){
  const g=make(data,zone,asset);g.start();
  while(g.round<3){g.time+=1/120;if(g.phase==='between'&&g.time>=g.roundDue)g.startRound();else if(g.phase==='round'){g.remaining=0;g.enemies=[];g.phase='between';g.roundDue=g.time;}}
  // Progress worth keeping: points, a second weapon, an open door, a torn window, and on Der Riese power and a perk.
  g.player.points=12345;g.player.kills=77;g.player.headshots=9;g.player.grenades=2;g.player.health=80;const second=Object.keys(g.data.weapons).find(n=>n!=='zombie_colt'&&!n.endsWith('_upgraded'));g.giveWeapon(second);g.weapon.clip=7;g.weapon.reserve=99;
  const door=g.interactions.find(e=>e.zombie_cost&&!e.targetname.includes('weapon')&&e.targetname!=='treasure_chest_use');g.opened.add(door.target);g.collision.disabled.add(door.target);
  g.windows[0].boards=2;
  if(g.mapRules){g.mapRules.power=true;g.mapRules.flags.add('electricity_on');g.mapRules.perks.add('specialty_armorvest');g.mapRules.links.add(1);}
  assert(g.canSave());const health=g.zombieHealth,round=g.round;
  const saved=JSON.parse(JSON.stringify(g.saveState()));assert.equal(saved.resumeRound,round,'A mid-round save resumes that round');
  // Restore into a fresh game, as the main menu does on another page load.
  const h=make(data,zone,asset);h.loadState(saved);assert.equal(h.player.health,80);
  assert.equal(h.phase,'ready');h.start();h.time=h.roundDue;h.tick(1/120,{});
  assert.equal(h.round,round);assert.equal(h.zombieHealth,health,'The resumed round has the same zombie health');
  assert.equal(h.player.points,12345);assert.equal(h.player.kills,77);assert.equal(h.player.headshots,9);
  assert.deepEqual(h.inventory.map(w=>w.name),['zombie_colt',second]);assert.equal(h.weapon.name,second);assert.equal(h.weapon.clip,7);assert.equal(h.weapon.reserve,99);
  assert(h.opened.has(door.target)&&h.collision.disabled.has(door.target));assert.equal(h.windows[0].boards,2);
  assert(h.player.grounded,'The player is restored onto the floor');
  if(h.mapRules){assert(h.mapRules.power);assert(h.mapRules.perks.has('specialty_armorvest'));assert.equal(h.mapRules.maxHealth,250);assert(h.mapRules.links.has(1));assert(h.mapRules.activeZones().size>1);}
  // Mid-drink or mid-upgrade saves would lose spent points, so they are refused.
  if(h.mapRules){h.startGesture('specialty_rof');assert(!h.canSave());h.gesture=null;}
  report[name]={round,zombieHealth:health,doors:h.opened.size};
}
console.log(JSON.stringify({saves:report}));
