import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const data=read('nacht/web-world/nazi_zombie_prototype.collision.json'),manifest=read('gameplay/manifest.json'),paths=read('nacht/web-world/nazi_zombie_prototype.paths.json');
const game=new SoloGame(manifest,new CollisionWorld(data,manifest.entities),paths);game.prepareSpawnPaths();
const w=game.windows.find(w=>w.target==='pf446_auto1'),prepared=game.spawnRoutes.get(w.target);
for(const origin of prepared.choices){
 const route=prepared.routes.get(origin.join(','));console.log('ROUTE',origin,route);
 const enemy={id:1,position:origin.slice(),path:route.map(p=>p.slice()),speed:57,window:w,stage:'approach',age:0};
 let last=enemy.position.slice(),same=0;
 for(let i=0;i<120*100&&enemy.stage==='approach';i++){
  game.time+=1/120;game.tickEnemy(enemy,1/120);
  if(Math.hypot(...enemy.position.map((v,k)=>v-last[k]))<.1)same++;else same=0;last=enemy.position.slice();
  if(same>120){
   console.log('STUCK',enemy.position,enemy.path,'velocity',enemy.velocityZ);
   const p=enemy.position,q=enemy.path[0],d=Math.hypot(q[0]-p[0],q[1]-p[1]),delta=[(q[0]-p[0])/d*.475,(q[1]-p[1])/d*.475,-.0555556];
   console.log('direct',game.collision.move(p,delta),'step',game.collision.step(p,delta),'up',game.collision.trace([p[0],p[1],p[2]+35],[p[0],p[1],p[2]+53],[14,14,35]));
   const over=game.collision.move([p[0],p[1],p[2]+18],[delta[0],delta[1],0]);console.log('over',over,'landing',game.collision.trace([over.position[0],over.position[1],over.position[2]+35],[over.position[0],over.position[1],over.position[2]+17],[14,14,35]));
   console.log('nodesNearby',game.nodes.map((n,i)=>({i,p:n.origin,d:Math.hypot(...p.map((v,k)=>v-n.origin[k]))})).sort((a,b)=>a.d-b.d).slice(0,8));
   console.log('props',game.collision.staticSurfaces.filter(s=>s.mins.every((v,k)=>v<p[k]+(k===2?75:40))&&s.maxs.every((v,k)=>v>p[k]-40)));break;
  }
 }
 console.log('end',enemy.stage,enemy.position);
}

