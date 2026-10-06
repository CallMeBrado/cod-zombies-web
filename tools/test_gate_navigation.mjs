import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const report={};
for(const [name,data,zone,asset]of [['nacht','gameplay','nacht','nazi_zombie_prototype'],['der-riese','gameplay/der-riese','der-riese','nazi_zombie_factory']]){
  const manifest=read(data+'/manifest.json'),navigation=read(data+'/navigation.json'),gates=read(data+'/gate-navigation.json');
  assert.equal(gates.sourceStamp,navigation.sourceStamp,'Gate states match the shipped navigation graph');
  const g=new SoloGame(manifest,new CollisionWorld(read(zone+'/web-world/'+asset+'.collision.json'),manifest.entities),read(zone+'/web-world/'+asset+'.paths.json'));
  g.prepareSpawnPaths(navigation);g.useGateNavigation(gates);assert(g.gateNavigation,'Prepared gate states load');g.newGame();
  const live=g.walkableLink.bind(g);let checks=0;g.walkableLink=(...args)=>{checks++;return live(...args);};
  const rows=new Map(gates.links),open=(targets,label)=>{
    for(const t of targets)g.collision.disabled.add(t);checks=0;const began=performance.now();g.invalidateNavigation(targets);const ms=performance.now()-began;
    assert.equal(checks,0,label+' must use prepared states instead of physics sweeps');
    // Each selected state equals the native physics for the current open set.
    let verified=0;for(const [key,row]of rows)if(row.targets.some(t=>targets.includes(t))){const [a,b]=key.split(',').map(Number);assert.equal(g.linkCache.get(key),live(g.nodes[a].origin,g.nodes[b].origin,true),label+' link '+key);verified++;}
    return {ms,verified};
  };
  // Doors one after another (each on top of the previous ones), then windows torn open.
  let worst=0,verified=0;const seen=new Set();
  for(const e of g.interactions.filter(e=>['zombie_door','zombie_debris'].includes(e.targetname))){
    if(seen.has(e.target))continue;seen.add(e.target);
    const result=open(e.target.includes('upstairs')?[e.target,'upstairs_blocker','upstairs_blocker2']:[e.target],e.target);worst=Math.max(worst,result.ms);verified+=result.verified;
  }
  for(const w of g.windows){const result=open([w.target],w.target);worst=Math.max(worst,result.ms);verified+=result.verified;}
  assert(worst<10,'Opening a door or window takes '+worst.toFixed(1)+' ms');
  // A rebuilt window (boards back on) selects its closed state again.
  const w=g.windows[0];g.collision.disabled.delete(w.target);checks=0;g.invalidateNavigation([w.target]);assert.equal(checks,0);
  for(const [key,row]of rows)if(row.targets.includes(w.target)){const [a,b]=key.split(',').map(Number);assert.equal(g.linkCache.get(key),live(g.nodes[a].origin,g.nodes[b].origin,true),'Rebuilt window link '+key);}
  // A stale table (different graph version) is ignored rather than trusted.
  g.useGateNavigation({...gates,navigationVersion:'old'});assert.equal(g.gateNavigation,null);
  report[name]={links:rows.size,doors:seen.size,windows:g.windows.length,worstMs:Math.round(worst*100)/100,verified};
}
console.log('Gate navigation passed:',JSON.stringify(report));
