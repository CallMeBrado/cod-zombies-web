import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {playerClip,moveDirection} from '../web/player-body.js';

// Co-op teammates: each map lists its four player characters and the original
// third-person clips, and every listed model and clip is in the prepared data.
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const exists=async p=>access(new URL('../local-data/'+p,import.meta.url)).then(()=>true,()=>false);
const maps=[{data:'gameplay',zones:['nacht','common'],names:['Player 1','Player 2','Player 3','Player 4']},{data:'gameplay/der-riese',zones:['der-riese','common','nacht'],names:['Dempsey','Nikolai','Takeo','Richtofen']},{data:'gameplay/bo1-kino',zones:['bo1-kino','bo1-common','bo1-base'],names:['Dempsey','Nikolai','Takeo','Richtofen']}];
const report={};
for(const map of maps){
  const m=await read(map.data+'/manifest.json');
  assert.deepEqual(m.playerBodies.map(b=>b.name),map.names,map.data+' characters');
  for(const body of m.playerBodies)for(const key of ['body','head','hat','gear'])if(body[key]){
    let found=false;for(const zone of map.zones)if(await exists(zone+'/model_export/'+body[key]+'_lod0.glb')){found=true;break;}assert(found,'Missing model '+body[key]);
  }
  for(const clip of m.playerAnimations){let found=false;for(const zone of map.zones)if(await exists(zone+'/web-anims/'+clip+'.json')){found=true;break;}assert(found,'Missing clip '+clip);}
  // Every state resolves to a clip the map has.
  const has=n=>m.playerAnimations.includes(n),states=[{},{sprinting:true},{ads:1},{stance:'crouch'},{stance:'prone'},{down:true},{dive:{phase:'air'}},{dive:{phase:'slide'}}];
  for(const s of states)for(const pistol of [false,true])for(const moving of [false,true])for(const direction of ['forward','back','left','right'])
    assert(has(playerClip({stance:'stand',...s},{pistol,moving,direction},has)),JSON.stringify({map:map.data,s,pistol,moving,direction}));
  report[map.data]={characters:m.playerBodies.length,clips:m.playerAnimations.length};
}
// The clips the original player animtree uses for each situation.
const all=()=>true;
assert.equal(playerClip({stance:'stand'},{},all),'pb_stand_alert');
assert.equal(playerClip({stance:'stand',sprinting:true},{moving:true},all),'pb_sprint');
assert.equal(playerClip({stance:'stand'},{moving:true,direction:'left'},all),'pb_combatrun_left_loop');
assert.equal(playerClip({stance:'stand'},{moving:true,direction:'forward',pistol:true},all),'pb_pistol_run_fast');
assert.equal(playerClip({stance:'crouch'},{moving:true,direction:'back'},all),'pb_crouch_run_back');
assert.equal(playerClip({stance:'prone'},{moving:true,direction:'forward'},all),'pb_prone_crawl');
assert.equal(playerClip({down:true},{moving:true,direction:'right'},all),'pb_laststand_crawl_right');
assert.equal(playerClip({down:true},{moving:true,direction:'right'},n=>n!=='pb_laststand_crawl_right'),'pb_prone_pistolcrawl_r','World at War crawls in last stand with its pistol crawl');
assert.equal(playerClip({stance:'stand',dive:{phase:'air'}},{},all),'pb_dive_prone');
// Movement relative to the facing direction.
assert.equal(moveDirection([100,0],0),'forward');assert.equal(moveDirection([-100,0],0),'back');assert.equal(moveDirection([0,100],0),'left');assert.equal(moveDirection([0,-100],0),'right');
assert.equal(moveDirection([0,100],Math.PI/2),'forward');
console.log('Player bodies passed:',JSON.stringify(report));
