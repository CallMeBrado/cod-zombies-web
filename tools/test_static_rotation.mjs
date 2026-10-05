import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
// Static model collision must use the same rotation as rendering. A transposed
// axis mirrored every 90-degree prop; Der Riese's upstairs teleporter (pad 2)
// then had its cage wall across the entrance while pads at 0/180 degrees worked.
const m=read('gameplay/der-riese/manifest.json'),g=new SoloGame(m,new CollisionWorld(read('der-riese/web-world/nazi_zombie_factory.collision.json'),m.entities),read('der-riese/web-world/nazi_zombie_factory.paths.json'),{},read('gameplay/der-riese/presentation.json'));
for(const e of g.interactions.filter(e=>e.script_flag)){g.opened.add(e.target);g.collision.disabled.add(e.target);}
const report={};
for(const id of [0,1,2]){
  const pad=g.interactions.find(e=>e.targetname==='trigger_teleport_pad_'+id),P=pad.origin.split(' ').map(Number);let best=Infinity;
  for(let a=0;a<360;a+=15){
    const r=a*Math.PI/180;let p=g.collision.move([P[0]+Math.cos(r)*170,P[1]+Math.sin(r)*170,P[2]+40],[0,0,-200]).position;
    for(let i=0;i<600;i++){const dx=P[0]-p[0],dy=P[1]-p[1],l=Math.hypot(dx,dy);best=Math.min(best,l);if(l<6)break;p=g.collision.step(p,[dx/l*1.6,dy/l*1.6,-3]).position;}
  }
  assert(best<12,`Teleporter pad ${id} must be walkable onto (closest ${best.toFixed(0)} units)`);report['pad'+id]=+best.toFixed(1);
}
// Every collision surface must sit where the renderer draws its model:
// world = origin + scale * sum(local_i * axis[i]) (assets.js static instances).
for(const [zone,asset]of [['nacht','nazi_zombie_prototype'],['der-riese','nazi_zombie_factory']]){
  const data=read(`${zone}/web-world/${asset}.collision.json`),render=read(`${zone}/web-world/${asset}.json`).staticModels;
  const key=s=>s.model+'@'+s.origin.map(v=>v.toFixed(1)).join(',');const byKey=new Map(render.map(s=>[key(s),s]));
  const world=new CollisionWorld(data,[]);let checked=0,worst=0,i=0;
  for(const model of data.staticModels){
    const r=byKey.get(key(model));assert(r,'Every collision model has a rendered instance');
    for(const surface of data.collisionMeshes?.[model.model]||model.surfaces||[]){
      if(!(surface.contents&(1|0x10000)))continue;const placed=world.staticSurfaces[i++];
      const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
      for(let c=0;c<8;c++){const p=[0,1,2].map(k=>c&(1<<k)?surface.maxs[k]:surface.mins[k]);for(let k=0;k<3;k++){const v=r.origin[k]+r.scale*(p[0]*r.axis[0][k]+p[1]*r.axis[1][k]+p[2]*r.axis[2][k]);mins[k]=Math.min(mins[k],v);maxs[k]=Math.max(maxs[k],v);}}
      worst=Math.max(worst,...[0,1,2].flatMap(k=>[Math.abs(mins[k]-placed.mins[k]),Math.abs(maxs[k]-placed.maxs[k])]));checked++;
    }
  }
  assert(worst<.05,`${zone}: static collision must match rendered placement (worst ${worst.toFixed(2)} units)`);report[zone]={surfaces:checked,worstError:+worst.toFixed(4)};
}
console.log('Static model rotation passed:',JSON.stringify(report));
