import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const make=(data,zone,asset)=>{const m=read(data+'/manifest.json'),g=new SoloGame(m,new CollisionWorld(read(zone+'/web-world/'+asset+'.collision.json'),m.entities),read(zone+'/web-world/'+asset+'.paths.json'),{},read(data+'/presentation.json'));g.newGame();return g;};
const report={};
for(const [id,data,zone,asset]of [['nacht','gameplay','nacht','nazi_zombie_prototype'],['der-riese','gameplay/der-riese','der-riese','nazi_zombie_factory']]){
  const g=make(data,zone,asset),types=Object.keys(g.presentation.powerups),sounds=[],loops=new Set();
  g.events.sound=s=>sounds.push(s.alias);g.events.loop=l=>loops.add(l.id);g.events.stopLoop=l=>loops.delete(l.id);
  // get_next_powerup: every cycle deals each powerup once; the carpenter only
  // once at least five windows have lost every board.
  const deal=()=>Array.from({length:types.length},()=>g.nextPowerup());
  if(types.includes('carpenter')){
    assert(!Array.from({length:40},()=>g.nextPowerup()).includes('carpenter'),'No carpenter while the windows are intact');
    for(const w of g.windows.slice(0,5))w.boards=0;g.powerupIndex=g.powerupOrder.length;
    assert.deepEqual(deal().sort(),types.slice().sort());
  }else{g.powerupIndex=g.powerupOrder.length;assert.deepEqual(deal().sort(),types.slice().sort());}
  // Every drop plays spawn_powerup and hums until grabbed.
  const drop=g.addDrop('full_ammo',g.player.position);assert(sounds.includes('spawn_powerup'));assert(loops.has('drop'+drop.id));
  sounds.length=0;g.pickup(drop);assert(!loops.has('drop'+drop.id),'The hum stops once grabbed');
  const stale=g.addDrop('nuke',[0,0,-9999]);g.phase='between';g.roundDue=Infinity;g.time=stale.expires;g.tick(1/120,{});assert(!loops.has('drop'+stale.id),'An expired drop stops humming');
  assert(id==='der-riese'?sounds.includes('ma_vox'):sounds.includes('full_ammo'),'Each map uses its own grab announcer');
  if(types.includes('carpenter')){
    for(const w of g.windows.slice(0,5))w.boards=0;g.windows[6].boards=3;const points=g.player.points;sounds.length=0;
    g.pickup(g.addDrop('carpenter',g.player.position));assert(loops.has('carpenter'));
    for(let i=0;i<200&&g.carpenter;i++){g.time+=.05;g.updateCarpenter();}
    assert(g.windows.every(w=>w.boards===6),'The carpenter rebuilds every board');assert.equal(g.player.points,points+200);
    assert(!loops.has('carpenter'));assert(sounds.includes('carp_end')&&sounds.includes('carp_vox'));
  }
  report[id]={powerups:types};
}
console.log('Powerups passed:',JSON.stringify(report));
