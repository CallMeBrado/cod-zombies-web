import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {TownEngine} from '../web/bo2-town-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {mapById} from '../web/maps.js';
import {canReachUse} from '../web/interaction-reach.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
for(const [id,Engine] of [['nacht',SoloGame],['kino',BlackOpsEngine],['town',TownEngine]]){
  const map=mapById(id),[m,c,n,p]=await Promise.all([map.data+'/manifest.json',map.zone+'/web-world/'+map.asset+'.collision.json',map.zone+'/web-world/'+map.asset+'.paths.json',map.data+'/presentation.json'].map(read));
  const g=new Engine(m,new CollisionWorld(c,m.entities),n,{},p);g.start();g.round=1;g.roundDue=Infinity;g.mods??={};g.mods.god=true;g.collision=new CollisionWorld({models:[{brushes:[]}],brushes:[{mins:[-1000,-1000,-128],maxs:[1000,1000,0],contents:1,planes:[]}]},[]);
  g.player.position=[0,0,0];g.player.previousPosition=[0,0,0];g.player.points=5000;g.yaw=0;g.interactions=[{targetname:'weapon_upgrade',position:[40,5,35],zombie_weapon_upgrade:g.weapon.name,zombie_cost:'500',script_ammo_clip:'250'}];
  const w={target:'test-barrier',entry:[220,0,0],boards:0,maxBoards:6,boardEntities:Array.from({length:6},()=>({origin:'45 0 35'}))};g.windows=[w];
  assert.equal(g.nearWindow(),w,'Repair uses the physical boards rather than distant animation landing on '+id);assert(!g.nearInteraction());assert(g.prompt().includes('Rebuild barrier'));g.use();assert.equal(g.player.points,5000,'Pressing Use cannot purchase the adjacent gun');
  for(let i=0;i<30;i++)g.update(.02,{use:true});assert(w.boards>0,'Held Use rebuilds on '+id);assert(g.player.points>=5000,'Repair earns points instead of buying ammo');
  w.boards=6;g.interactions[0].position=[85,0,35];assert(!g.nearInteraction());g.use();const money=g.player.points;assert.equal(g.player.points,money);
  g.interactions[0].position=[45,0,35];assert(g.nearInteraction());g.use();assert.equal(g.player.points,money-250);
  g.interactions[0].position=[-45,0,35];assert(!g.nearInteraction(),'Items behind the player do not steal Use');g.yaw=Math.PI;assert(g.nearInteraction());g.yaw=0;
  g.interactions=[{targetname:'zombie_door',position:[85,0,35],target:'test-door',zombie_cost:'750'}];const before=g.player.points;g.use();assert(!g.opened.has('test-door'));assert.equal(g.player.points,before);
  g.interactions[0].position=[45,0,35];g.use();assert(g.opened.has('test-door'));assert.equal(g.player.points,before-750);
  console.log(id+': closer wall buys and doors, facing, held barrier repair and purchase priority passed.');
}
assert(!canReachUse([0,0,0],[85,0,35],0));assert(canReachUse([0,0,0],[45,0,35],0));assert(!canReachUse([0,0,0],[-45,0,35],0));
