import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const entities=read('gameplay/manifest.json').entities,data=read('nacht/web-world/nazi_zombie_prototype.collision.json'),old=read('collision-before-player-fix.json');
const world=new CollisionWorld(data,entities),before=new CollisionWorld(old,entities),improved=[],stuck=[];
for(let x=-188;x<=188;x+=16)for(let y=-876;y<=604;y+=16){
  const floor=world.trace([x,y,110],[x,y,-100],[14,14,35]);if(floor.fraction===1||floor.normal[2]<.65)continue;
  const p=[x,y,floor.end[2]-35];if(p[2]>30||p[2]<-10)continue;
  let escapes=0;
  for(let d=0;d<8;d++){const angle=d*Math.PI/4,delta=[4*Math.cos(angle),4*Math.sin(angle),-.0555556],a=before.step(p,delta),b=world.step(p,delta),da=Math.hypot(a.position[0]-x,a.position[1]-y),db=Math.hypot(b.position[0]-x,b.position[1]-y);
    if(db>1)escapes++;if(da<.1&&db>3.5)improved.push({p,d,old:da,now:db});
  }
  if(!escapes)stuck.push(p);
}
const report={improved:improved.length,examples:improved.slice(0,40),stuck:stuck.length,stuckExamples:stuck.slice(0,30),nativeStaticTriangles:world.staticTriangleCount};
fs.writeFileSync(new URL('../local-data/player-walk-audit.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
