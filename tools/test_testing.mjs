import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TestingGame} from '../web/testing.js';
import {CollisionWorld} from '../web/collision.js';
import {nextHealth,roundCount} from '../web/rules.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const report={};
// Exact totals from each map's round_spawning() for one player.
const factory=r=>roundCount(r,24,6,.5);
assert.deepEqual([1,2,3,4,5,9,10,15,20,30].map(r=>roundCount(r,24,6,0)),[4,9,14,19,24,24,24,24,24,24]);
assert.deepEqual([1,2,3,4,5,9,10,15,20,30].map(factory),[5,10,16,21,27,29,33,44,60,105]);
for(const [id,zone,folder]of [['nacht','nazi_zombie_prototype','gameplay'],['der-riese','nazi_zombie_factory','gameplay/der-riese']]){
  const manifest=read(folder+'/manifest.json'),removed=[];
  const g=new TestingGame(manifest,new CollisionWorld(read(id+'/web-world/'+zone+'.collision.json'),manifest.entities),read(id+'/web-world/'+zone+'.paths.json'),{removeEnemy:e=>removed.push(e.id)});
  assert.deepEqual(g.mods,{god:false,points:false,ammo:false,grenades:false,noclip:false});
  assert(!g.setRound(20),'Round changes need an active session');
  g.start();g.damagePlayer(50);assert.equal(g.player.health,50);
  g.setMod('god',true);g.damagePlayer(1000);assert.equal(g.player.health,100);assert.notEqual(g.phase,'dead');
  g.setMod('god',false);g.damagePlayer(25);assert.equal(g.player.health,75);
  g.player.points=0;assert(!g.spendPoints(1000));
  g.setMod('points',true);assert(g.spendPoints(5000));assert.equal(g.player.points,999999);
  const weapon=Object.keys(manifest.weapons).find(n=>n.includes('mp40'));
  assert(weapon);assert(g.equipTestWeapon(weapon));assert.equal(g.weapon.name,weapon);assert(!g.equipTestWeapon('missing'));
  g.pendingGrenade={};assert(!g.equipTestWeapon('zombie_colt'));g.pendingGrenade=null;
  g.weapon.clip=0;g.weapon.reserve=0;g.refillAmmo();assert.equal(g.weapon.clip,g.weapon.definition.clipSize);
  g.setMod('ammo',true);g.weapon.clip=0;g.weapon.reserve=0;g.update(1/120,{});assert.equal(g.weapon.clip,g.weapon.definition.clipSize);assert.equal(g.weapon.reserve,g.weapon.definition.maxAmmo);
  g.setMod('grenades',true);g.player.grenades=0;g.update(1/120,{});assert.equal(g.player.grenades,4);
  // Noclip flies along the view through walls (straight through the map for
  // 3 s), survives below the map, then falls normally once switched off.
  {const start=g.player.position.slice();g.setMod('noclip',true);g.aim(0,0);
   for(let i=0;i<360;i++)g.tick(1/120,{forward:1});assert(Math.abs(g.player.position[0]-start[0]-1200)<1,'Noclip ignores walls at 400 u/s');assert(Math.abs(g.player.position[2]-start[2])<1e-6,'Level flight keeps height');
   g.aim(0,-Math.PI/2);for(let i=0;i<360;i++)g.tick(1/120,{forward:1,sprint:true});assert(g.player.position[2]<start[2]-2000);assert.notEqual(g.phase,'dead','Noclip below the map is safe');
   g.player.position=start.map((v,k)=>k===2?v+40:v);g.setMod('noclip',false);assert(!g.player.grounded);
   // A spot no node can walk to (inside the floor) is searched in bounded time.
   {const t=performance.now();g.nearest([start[0],start[1],start[2]-40],true);assert(performance.now()-t<1000,'Unreachable positions must not sweep the whole graph');}
   for(let i=0;i<240;i++)g.tick(1/120,{});assert(g.player.grounded,'Gravity returns after noclip');assert(Math.abs(g.player.position[2]-start[2])<2);g.aim(Math.PI,0);}
  g.enemies=[{id:432,dead:false},{id:433,dead:true}];g.windows[0].traverser=g.enemies[0];
  assert(g.setRound(20));assert.deepEqual(removed,[432,433]);assert.equal(g.enemies.length,0);assert.equal(g.windows[0].traverser,null);assert.equal(g.round,20);assert.equal(g.phase,'round');assert.equal(g.remaining,roundCount(20,g.vars.zombie_max_ai,g.vars.zombie_ai_per_player,g.mapRules?.soloAiFactor??0));assert.equal(g.remaining,id==='der-riese'?60:24);
  let health=g.vars.zombie_health_start;for(let r=1;r<=20;r++)health=nextHealth(health,r,g.vars);assert.equal(g.zombieHealth,health);
  for(const r of [0,101,1.5,NaN,Infinity])assert(!g.setRound(r));assert.equal(g.round,20);
  assert(g.setRound(1));assert.equal(g.zombieHealth,g.vars.zombie_health_start);assert.equal(g.remaining,id==='der-riese'?5:4);
  g.newGame();assert(g.mods.god===false&&g.mods.points);assert.equal(g.player.points,999999);
  for(const name of Object.keys(g.mods))g.setMod(name,false);g.newGame();assert.equal(g.player.points,500);assert.equal(g.weapon.name,'zombie_colt');assert.equal(g.weapon.clip,8);assert.equal(g.player.health,100);
  g.start();g.damagePlayer(100);assert.equal(g.phase,'dead');assert(!g.setRound(10));
  report[id]={round20Health:health,weapon,normalAfterModsOffAndRestart:true};
}
fs.writeFileSync(new URL('../local-data/mod-menu-verification.json',import.meta.url),JSON.stringify(report,null,2));
console.log('Testing menu checks passed on both maps:',JSON.stringify(report));
