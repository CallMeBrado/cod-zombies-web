import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {SoloGame,GRENADE_CONTENTS} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
import {CombatEffects} from '../web/combat-effects.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const m=read('gameplay/manifest.json'),data=read('nacht/web-world/nazi_zombie_prototype.collision.json'),paths=read('nacht/web-world/nazi_zombie_prototype.paths.json');
const collision=new CollisionWorld(data,m.entities),events=[],game=new SoloGame(m,collision,paths,{grenade:g=>events.push({type:'release',time:game.time,g}),explosion:g=>events.push({type:'explosion',time:game.time,g}),sound:s=>events.push(s),bindingName:()=> 'J'});
const advance=s=>{for(let i=0;i<Math.round(s*240);i++)game.update(1/240,{});};
const reset=()=>{game.newGame();game.start();game.roundDue=1e6;events.length=0;};
const projectile=(position,due=5)=>({position:position.slice(),previousPosition:position.slice(),velocity:[0,0,0],resting:true,due,spawned:0,bounceAt:0});
reset();
// Find native gaps and follow ballistic paths through the actual map, including
// intact boards/bars. The old player mask closes these whole openings.
const windows=[];
for(const w of game.windows){
  if(w.target==='auto1')collision.disabled.add(w.target); // This window's boards fill its narrow central gap.
  const dx=w.outside[0]-w.entry[0],dy=w.outside[1]-w.entry[1],length=Math.hypot(dx,dy),duration=length/m.grenade.projectileSpeed;
  let opening=null;
  for(let h=25;h<=105&&!opening;h+=5)for(let side=-25;side<=25;side+=5){
    const start=[w.entry[0]-dy/length*side,w.entry[1]+dx/length*side,w.entry[2]+h],end=[w.outside[0]-dy/length*side,w.outside[1]+dx/length*side,start[2]],velocity=[dx/length*m.grenade.projectileSpeed,dy/length*m.grenade.projectileSpeed,800*duration/2];
    if(collision.trace(start,end,[3,3,3],GRENADE_CONTENTS).fraction<1)continue;
    let p=start.slice(),v=velocity.slice(),blocked=false;
    for(let t=0;t<duration;t+=1/120){v[2]-=800/120;const hit=collision.trace(p,p.map((x,i)=>x+v[i]/120),[3,3,3],GRENADE_CONTENTS);p=hit.end;if(hit.fraction<1){blocked=true;break;}}
    if(!blocked){opening={start,end,velocity,oldFraction:collision.trace(start,end,[3,3,3]).fraction};break;}
  }
  assert(opening,'No throw path through native window '+w.target);
  const g=projectile(opening.start,100);g.resting=false;g.velocity=opening.velocity.slice();game.grenades=[g];
  for(let i=0;i<Math.ceil(duration*120);i++){game.time+=1/120;game.updateGrenades(1/120);}
  assert((g.position[0]-opening.start[0])*dx+(g.position[1]-opening.start[1])*dy>=length*length-.1,'Grenade did not cross '+w.target);
  windows.push({window:w.target,...opening});
}
assert(windows.filter(w=>w.oldFraction<1).length>=11);
// Player-only volumes around rubble are transparent to grenades, while solid
// world floors, crate faces and the actual debris triangles still collide.
const clearClips=[];
for(const b of collision.brushes){
  if(!(b.contents&0x10000)||b.contents&1||b.target)continue;
  for(let z=Math.max(15,b.mins[2]+5);z<Math.min(160,b.maxs[2]-5);z+=10){
    const y=(b.mins[1]+b.maxs[1])/2,start=[b.mins[0]-8,y,z],end=[b.maxs[0]+8,y,z];
    if(collision.trace(start,end,[3,3,3]).fraction<1&&collision.trace(start,end,[3,3,3],GRENADE_CONTENTS).fraction===1){clearClips.push({start,end});break;}
  }
  if(clearClips.length===5)break;
}
assert(clearClips.length>=3);assert(collision.trace([0,424,70],[0,424,-100],[3,3,3],GRENADE_CONTENTS).fraction<1);
const crate=collision.staticSurfaces.find(s=>s.model?.includes('crate')&&s.maxs[2]-s.mins[2]>35),center=crate.mins.map((x,i)=>(x+crate.maxs[i])/2);
assert(collision.trace([crate.mins[0]-10,center[1],center[2]],[crate.maxs[0]+10,center[1],center[2]],[3,3,3],GRENADE_CONTENTS).fraction<1);
reset();game.player.grenades=0;const live=projectile([-20,424,4],3);game.grenades=[live];assert.match(game.prompt(),/^J · Pick up & throw back grenade/);assert(game.use());assert(live.held);assert.equal(game.player.grenades,0);assert.equal(game.use(),false);assert.equal(game.fire(),false);assert.equal(game.nearGrenade(),null);
advance(1);assert(live.held);assert.equal(events.filter(e=>e.type==='release').length,0);assert.equal(live.due,3);
game.aim(0,.2);advance(.2);assert(!live.held);assert.equal(game.grenades[0],live);assert.equal(live.due,3);assert.equal(events.filter(e=>e.type==='release').length,1);assert(!events.some(e=>e.alias==='grenade_pull_pin'),'A live grenade must not pull a second pin');
advance(2);assert.equal(events.filter(e=>e.type==='explosion').length,1);assert.equal(game.grenades.length,0);assert.equal(game.player.grenades,0);
reset();game.player.grenades=0;const late=projectile([-20,424,4],.5);game.grenades=[late];assert(game.use());advance(.6);assert.equal(game.player.health,0);assert.equal(game.pendingGrenade,null);assert.equal(game.grenades.length,0);assert.equal(events.filter(e=>e.type==='explosion').length,1);assert.equal(events.filter(e=>e.type==='release').length,0);
reset();const distant=projectile([-100,424,4]);game.grenades=[distant];assert.equal(game.nearGrenade(),null);game.phase='dead';distant.position=[0,424,4];assert.equal(game.nearGrenade(),null);game.newGame();assert.equal(game.grenades.length,0);assert.equal(game.pendingGrenade,null);
// The same pool slot hides while held and reappears on release without
// allocating another projectile or losing a slot on repeated throwbacks.
const combat=new CombatEffects(new THREE.Scene()),g=projectile([0,0,3]);combat.grenade(g);
for(let i=0;i<100;i++){g.held=true;combat.update(i);assert.equal(combat.grenades.filter(s=>s.mesh.visible).length,0);g.held=false;combat.grenade(g);combat.update(i+.1);assert.equal(combat.grenades.filter(s=>s.grenade===g).length,1);assert.equal(combat.grenades.filter(s=>s.mesh.visible).length,1);}
g.exploded=true;combat.update(101);assert.equal(combat.diagnostics().activeGrenades,0);
assert.equal(m.grenade.altRaiseAnim,'viewmodel_livegrenade_tossback');assert.equal(read('nacht/web-anims/'+m.grenade.altRaiseAnim+'.json').frames,32);
const report={windows,clearPlayerClips:clearClips,solidFloorAndCrate:true,retainsFuse:true,zeroInventoryPickup:true,heldExplosion:true,poolRethrows:100};fs.writeFileSync(new URL('../local-data/grenade-throwback-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({windows:windows.length,clearPlayerClips:clearClips.length,retainsFuse:true,heldExplosion:true,poolRethrows:100}));
