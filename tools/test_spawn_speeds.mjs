import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const manifest=read('gameplay/manifest.json'),game=new SoloGame(manifest,new CollisionWorld(read('nacht/web-world/nazi_zombie_prototype.collision.json'),manifest.entities),read('nacht/web-world/nazi_zombie_prototype.paths.json'));
game.prepareSpawnPaths(read('gameplay/navigation.json'));const report=[];
for(const speed of [47,57,100,145])for(const window of game.windows){const prepared=game.spawnRoutes.get(window.target);
 for(const origin of prepared.choices){const enemy={id:1,position:origin.slice(),path:prepared.routes.get(origin.join(',')).map(p=>p.slice()),speed,window,stage:'approach',age:0,dead:false};let seconds=0;
  while(enemy.stage==='approach'&&seconds<120){game.time+=1/120;game.tickEnemy(enemy,1/120);seconds+=1/120;}
  assert.equal(enemy.stage,'barrier','Original route at speed '+speed+' stuck: '+window.target+' '+origin+' at '+enemy.position+' next '+enemy.path[0]);
  report.push({speed,window:window.target,origin,seconds});
 }
}
fs.writeFileSync(new URL('../local-data/spawn-speeds-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({routes:report.length,speeds:[47,57,100,145],allArrived:true}));
