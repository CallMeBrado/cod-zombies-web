import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SoloGame,gaitSpeeds} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const m=read('gameplay/der-riese/manifest.json'),g=new SoloGame(m,new CollisionWorld(read('der-riese/web-world/nazi_zombie_factory.collision.json'),m.entities),read('der-riese/web-world/nazi_zombie_factory.paths.json'),{},read('gameplay/der-riese/presentation.json'));
g.prepareSpawnPaths(read('gameplay/der-riese/navigation.json'));
g.mapRules.use(g.interactions.find(e=>e.targetname==='use_power_switch'));
for(const e of g.interactions.filter(e=>e.script_flag)){g.opened.add(e.target);g.collision.disabled.add(e.target);g.mapRules.onOpen(e);}
g.invalidateNavigation([...g.collision.disabled]);
const report=[],hunts=[],traversals=[];
const speeds=gaitSpeeds(read('gameplay/der-riese/presentation.json').animations);
for(const speed of speeds)for(const window of g.availableWindows()){
 const prepared=g.spawnRoutes.get(window.target);
 for(const origin of prepared.choices){
  const enemy={id:1,position:origin.slice(),path:prepared.routes.get(origin.join(',')).map(p=>p.slice()),speed,window,stage:'approach',age:0,dead:false};let seconds=0;
  while(enemy.stage==='approach'&&seconds<120*Math.max(1,47/speed)){g.time+=1/120;g.tickEnemy(enemy,1/120);seconds+=1/120;}
  report.push({speed,window:window.target,origin,stage:enemy.stage,seconds,position:enemy.position.slice()});
  window.boards=0;window.traverser=null;let crossing=0;
  while(enemy.stage!=='hunt'&&crossing<60){g.time+=1/120;g.tickEnemy(enemy,1/120);crossing+=1/120;}
  traversals.push({speed,window:window.target,origin,stage:enemy.stage,seconds:crossing,position:enemy.position.slice()});
 }
 // A hunter has already torn down and crossed its own barrier.
 g.collision.disabled.add(window.target);g.invalidateNavigation([window.target]);
 const path=g.path(window.entry,g.player.position,true);
 assert(path.length,'Unlocked barrier must connect to the mainframe: '+window.target);
 const enemy={position:window.entry.slice(),path,speed,stage:'hunt'};let seconds=0,arrived=false;
 while(seconds<180*Math.max(1,47/speed)){arrived=g.advancePath(enemy,1/120,g.player.position);seconds+=1/120;if(arrived)break;}
 hunts.push({speed,window:window.target,seconds,arrived,position:enemy.position});
}
fs.writeFileSync(new URL('../local-data/der-riese-path-verification.json',import.meta.url),JSON.stringify({approaches:report,traversals,hunts},null,2));
const failed=report.filter(r=>r.stage!=='barrier');assert.equal(failed.length,0,JSON.stringify(failed));
assert(hunts.every(r=>r.arrived),JSON.stringify(hunts.filter(r=>!r.arrived)));
assert(traversals.every(r=>r.stage==='hunt'),JSON.stringify(traversals.filter(r=>r.stage!=='hunt')));
console.log(JSON.stringify({routes:report.length,traversals:traversals.length,hunts:hunts.length,barriers:g.availableWindows().length,speeds,allArrived:true}));
