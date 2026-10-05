import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
import {nativeCollisionTriangle} from '../web/native-triangles.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const data=read('nacht/web-world/nazi_zombie_prototype.collision.json'),manifest=read('gameplay/manifest.json'),paths=read('nacht/web-world/nazi_zombie_prototype.paths.json'),navigation=read('gameplay/navigation.json');
const world=new CollisionWorld(data,manifest.entities),game=new SoloGame(manifest,world,paths);game.prepareSpawnPaths(navigation);
const report={};let triangles=0,maxBoundError=0;
for(const mesh of Object.values(data.collisionMeshes))for(const surface of mesh)for(const tri of surface.triangles){
 const points=nativeCollisionTriangle(tri);assert(points,'Nondegenerate native collision planes');triangles++;
 for(let v=0;v<3;v++)for(let k=0;k<3;k++){
  const p=points[v];maxBoundError=Math.max(maxBoundError,surface.mins[k]-p[k],p[k]-surface.maxs[k]);
  const value=tri[k][0]*p[0]+tri[k][1]*p[1]+tri[k][2]*p[2]-tri[k][3];
  assert(Math.abs(value-(k===1&&v===1||k===2&&v===2?1:0))<1e-5,'Reconstructed vertex preserves native plane/barycentric coordinates');
 }
}
assert(maxBoundError<.1,'Native collision triangles remain within original surface bounds');report.nativeTriangles={unique:triangles,placedSolid:world.staticTriangleCount,maxBoundError};
const improved=[];
for(const [x,y,d]of [[-188,-796,[0,4,-.0555556]],[-188,-780,[0,4,-.0555556]],[-188,-780,[0,-4,-.0555556]],[-188,-764,[0,4,-.0555556]]]){
 const floor=world.trace([x,y,110],[x,y,-100],[14,14,35]),p=[x,y,floor.end[2]-35],result=world.step(p,d);
 // With static models rotated as rendered, these probes cross the starting
 // room's sandbag pile itself; only the no-sideways-kick guarantee applies.
 const length=Math.hypot(result.position[0]-x,result.position[1]-y);
 assert(length<=4.1,'Vertical step probes must not kick the player sideways');improved.push({from:p,to:result.position});
}
report.windowMovement=improved;
game.start();game.roundDue=1e9;
const start=game.player.position.slice(),walks=[];
function walkTo(target){
 const near=game.nearest(target,true,true),route=game.path(game.player.position,game.nodes[near].origin);assert(route.length,'Connected interior walk route');route.push(target);let ticks=0;
 for(const q of route){let arrived=false;
  for(let i=0;i<240*30;i++){
   const p=game.player.position,dx=q[0]-p[0],dy=q[1]-p[1];
   if(Math.hypot(dx,dy)<1.8&&Math.abs(q[2]-p[2])<8){arrived=true;break;}
   game.aim(Math.atan2(dy,dx),0);game.update(1/240,{forward:1});ticks++;
   assert(game.player.position[2]>-10&&game.player.position[2]<50,'Starting-room player stays on native ground');
  }
  assert(arrived,'Player stuck walking to '+q+' at '+game.player.position);
 }
 return ticks/240;
}
for(const window of game.availableWindows()){
 const seconds=walkTo(window.entry);walks.push({window:window.target,position:game.player.position.slice(),seconds});walkTo(start);
}
report.startingRoomWalks=walks;
// Original spawning (round_spawning + zombie_think): a random enabled spawner,
// then one of the windows nearest that spawner. Nacht ignores player position.
function spawned(label,position,samples=600){
 game.player.position=position.slice();const used=new Map();
 for(let i=0;i<samples;i++){game.remaining=1;game.spawnEnemy();const e=game.enemies.pop();used.set(e.window,(used.get(e.window)||0)+1);}
 const windows=[...used].map(([w,n])=>({window:w.target,share:+(n/samples).toFixed(3),upstairs:w.entry[2]>=100,help:w.entry[2]<100&&w.entry[1]>700})).sort((a,b)=>b.share-a.share);
 return {label,windows};
}
const first=game.windows.find(w=>w.target==='pf587_auto1'),far=game.windows.find(w=>w.entry[1]<-700&&w.entry[0]<0);
const west=spawned('west starting window',first.entry),south=spawned('south starting window',far.entry);
for(const d of [west,south]){
 assert(d.windows.every(w=>!w.upstairs&&!w.help),'Locked rooms/floors do not spawn ('+d.label+')');
 assert(d.windows.length>=3,'Zombies come from several starting-room windows, not just the nearest one ('+d.label+')');
 assert(d.windows[0].share<.6,'No single window dominates ('+d.label+')');
}
game.player.points=10000;
for(const e of game.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname))){game.player.position=[e.position[0],e.position[1],e.position[2]-35];game.use();}
const back=spawned('starting room with every door open',first.entry);
assert(back.windows.some(w=>w.help)&&back.windows.some(w=>w.upstairs),'Opened areas add their spawners even while the player stays downstairs');
report.spawnDistribution=[west,south,back];
fs.writeFileSync(new URL('../local-data/movement-spawn-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
