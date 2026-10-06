import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {WeaponView} from '../web/weapon-view.js';
import {KNIFE_CHARGE_RANGE,KNIFE_STOP_RANGE} from '../web/knife-lunge.js';
import {MAPS,BO1_MAPS} from '../web/maps.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const box=(mins,maxs,contents=1)=>({mins,maxs,contents,planes:[]});
const arena=extra=>new CollisionWorld({models:[{brushes:[]}],brushes:[box([-1000,-1000,-128],[1000,1000,0]),...extra]},[]);
const report=[];
for(const map of [...MAPS,...BO1_MAPS]){
  const m=await read(map.data+'/manifest.json'),presentation=await read(map.data+'/presentation.json'),native=new CollisionWorld(await read(map.zone+'/web-world/'+map.asset+'.collision.json'),m.entities),events=[];
  const g=new (map.game==='black-ops'?BlackOpsEngine:SoloGame)(m,native,await read(map.zone+'/web-world/'+map.asset+'.paths.json'),{melee:e=>events.push(e),meleeImpact:e=>events.push({impact:e})},presentation);
  g.tickEnemy=()=>{};
  const reset=(extra=[])=>{g.collision=native;g.newGame();g.start();g.roundDue=Infinity;g.ambientDue=Infinity;g.collision=arena(extra);g.player.position=[0,0,0];g.player.previousPosition=[0,0,0];g.player.grounded=true;g.aim(0,0);events.length=0;};
  const enemy=(x,y=0,z=0)=>{const e={id:g.enemies.length+1,position:[x,y,z],previousPosition:[x,y,z],health:500,dead:false,stage:'hunt',angle:Math.PI};g.enemies.push(e);return e;};
  const run=(seconds,hz=120,input={})=>{for(let i=0;i<Math.round(seconds*hz);i++)g.update(1/hz,input);};
  let position;
  for(const hz of [30,60,120,240]){
    reset();const e=enemy(120);assert(g.melee());assert(events[0].charge);assert.equal(g.pendingMelee.target,e);assert.equal(g.pendingMelee.due,.15);assert.equal(g.meleeDue,1);assert.equal(g.melee(),false,'Repeated melee press is ignored during recovery');
    run(.1,hz);assert.equal(e.health,500,'Knife damage waits for native charge impact');run(.1,hz);assert.equal(e.health,350);assert.equal(events.filter(e=>e.impact).length,1,'Exactly one knife hit and blood effect');assert(g.player.grounded);assert(Math.abs(g.player.position[0]-(120-KNIFE_STOP_RANGE))<.1,'Lunge stops short of overlapping target');assert(Math.abs(g.player.position[2])<.1,'Lunge stays on the floor');
    if(position)assert(Math.hypot(...g.player.position.map((x,i)=>x-position[i]))<1e-6,'Knife movement is independent of FPS');else position=g.player.position.slice();report.push({map:map.id,hz,movement:g.player.position[0],damage:500-e.health});
  }
  reset();const close=enemy(40);g.melee();assert(!events[0].charge);run(.08);assert.equal(close.health,350);assert.equal(g.player.position[0],0,'Close swipe does not pull player forward');
  for(const [x,y,z,stage]of [[KNIFE_CHARGE_RANGE+1,0,0,'hunt'],[-100,0,0,'hunt'],[60,100,0,'hunt'],[100,0,50,'hunt'],[100,0,0,'barrier'],[100,0,0,'traverse']]){
    reset();const e=enemy(x,y,z);e.stage=stage;g.melee();assert(!g.pendingMelee.lunge,'Out-of-range, behind, high/low and window actors do not trigger a charge');run(.2);assert.equal(g.player.position[0],0);
  }
  reset();enemy(100);g.player.grounded=false;g.melee();assert(!g.pendingMelee.lunge,'No airborne lunge');
  reset();enemy(100);g.melee();g.update(0,{});assert.equal(g.player.position[0],0,'Paused simulation does not lunge');
  reset();const selected=enemy(100),other=enemy(110,10);g.melee();selected.dead=true;run(.2);assert.equal(g.player.position[0],0);assert.equal(other.health,500,'A dead target does not retarget the charge');
  reset();const moving=enemy(120);g.melee();run(.04);moving.position[0]=300;const stopped=g.player.position[0];run(.2);assert.equal(g.player.position[0],stopped,'Escaping target cannot be chased beyond charge range');assert.equal(moving.health,500);
  reset();const switched=enemy(100);g.melee();g.inventory.push(g.makeWeapon(Object.keys(m.weapons).find(n=>n!==g.weapon.name)));g.switchWeapon();run(.2);assert.equal(g.player.position[0],0);assert.equal(switched.health,500,'Weapon switch cancels movement and damage');
  reset();const turned=enemy(100);g.melee();g.aim(Math.PI,0);run(.2);assert.equal(g.player.position[0],0);assert.equal(turned.health,500,'Turning away cancels the lunge');
  reset();const centered=enemy(100,40);g.melee();assert(g.pendingMelee.lunge);run(.2);assert(g.yaw>.25,'Charge gently centers aim on target');assert.equal(centered.health,350);
  reset([box([25,-60,0],[40,60,30])]);const crate=enemy(120);g.melee();assert(g.pendingMelee.lunge,'Visible target above a crate can be selected');run(.2);assert(g.player.position[0]<12,'Lunge cannot walk through a crate taller than step height');assert.equal(crate.health,500,'Blocked lunge cannot strike beyond knife reach');
  reset([box([25,-60,0],[40,60,160],0x10000)]);const clip=enemy(120);g.melee();assert(g.pendingMelee.lunge);run(.2);assert(g.player.position[0]<12,'Invisible player clips still block lunge movement');assert.equal(clip.health,500);
  reset([box([25,-60,0],[40,60,160])]);const wall=enemy(80);g.melee();assert(!g.pendingMelee.lunge,'Solid wall blocks target acquisition');run(.2);assert.equal(wall.health,500,'Knife cannot damage through a solid wall');
  reset();const recovery=enemy(100);g.melee();g.collision=native;g.newGame();g.start();g.roundDue=Infinity;run(.2);assert.equal(g.pendingMelee,null);assert.equal(recovery.health,500,'Restart cannot retain a pending strike');
  // The prepared viewmodel selects the original charge clip and can still
  // fall back to a swipe if an older weapon is missing that animation.
  const d=g.weapon.definition,view={weapon:{definition:d},clips:new Map([[d.meleeChargeAnim,true]]),knife:{visible:false},play:(name,duration)=>events.push({animation:name,duration})};WeaponView.prototype.melee.call(view,{charge:true,duration:1});assert.equal(events.at(-1).animation,d.meleeChargeAnim);assert(view.knife.visible);view.clips.clear();WeaponView.prototype.melee.call(view,{charge:true,duration:1});assert.equal(events.at(-1).animation,d.meleeAnim);
  // Also exercise actual native map hulls along a clear starting-room segment.
  g.collision=native;g.newGame();g.start();g.roundDue=Infinity;const from=g.player.position.slice();let target;
  for(let i=0;i<16&&!target;i++){
    const angle=i*Math.PI/8,at=[from[0]+Math.cos(angle)*105,from[1]+Math.sin(angle)*105,from[2]],sweep=native.trace([from[0],from[1],from[2]+35.1],[at[0],at[1],at[2]+35.1],[14,14,34.9]);
    if(sweep.fraction<.999)continue;const floor=native.trace([at[0],at[1],at[2]+70],[at[0],at[1],at[2]-32],[14,14,35]);if(floor.fraction===1||floor.normal[2]<.65)continue;
    g.aim(angle,0);target={id:99,position:[at[0],at[1],floor.end[2]-35],health:500,dead:false,stage:'hunt',angle:angle+Math.PI};g.enemies=[target];
  }
  assert(target,'Native starting room has a clear lunge test segment');assert(g.melee());assert(g.pendingMelee.lunge);run(.25,240);assert.equal(target.health,350);assert(g.player.grounded);assert(g.player.position[2]>from[2]-20);
}
console.log('Knife lunge passed:',JSON.stringify({runs:report,closeSwipes:true,rangeAndCone:true,lockedTarget:true,crateWallsAndClips:true,cancellationAndReset:true,nativeStartingRooms:true,originalChargeAnimations:true}));
