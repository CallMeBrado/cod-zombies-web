import * as THREE from 'three';
import {cloneModel} from './assets.js';

export function createPickupView(drop,template,effects,time){
  const root=new THREE.Group(),object=new THREE.Group(),glow=effects.create('misc/fx_zombie_powerup_on',time);object.add(cloneModel(template));
  root.name='Original pickup '+drop.type;root.add(object,glow);root.position.fromArray(drop.position);root.position.z+=40;
  return {root,object,glow,wobble:null,angles:[0,0,0]};
}
export function updatePickupView(drop,v,time,effects){
  if(!v.wobble||time>=v.wobble.due){const yaw=THREE.MathUtils.clamp(Math.random()*360,60,300);v.wobble={start:time,due:time+2.5+Math.random()*2.5,from:v.angles.slice(),to:[-60+Math.random()*120,v.angles[1]+yaw,-45+Math.random()*90]};}
  const w=v.wobble,t=THREE.MathUtils.smoothstep(time,w.start,w.due);v.angles=w.from.map((a,i)=>a+(w.to[i]-a)*t);
  v.object.rotation.set(THREE.MathUtils.degToRad(v.angles[2]),-THREE.MathUtils.degToRad(v.angles[0]),THREE.MathUtils.degToRad(v.angles[1]),'ZYX');
  const age=time-drop.spawned,period=age<22.5?.5:age<25?.25:.1;
  v.root.visible=age<15||Math.floor((age-15)/period)%2===0;effects.update(v.glow,time);
}
// The weapon turns from the box's angles: +90 on T4/T5 boxes, +180 on T6's
// zbarrier (treasure_chest_weapon_spawn).
export function createBoxView(lid,origin,templates,effects,yawOffset=90){
  const weaponRoot=new THREE.Group(),position=origin.origin.split(/\s+/).map(Number);weaponRoot.position.fromArray(position);weaponRoot.rotation.z=THREE.MathUtils.degToRad(Number(origin.angles.split(/\s+/)[1])+yawOffset);weaponRoot.visible=false;
  const choices=new Map();for(const [name,template]of templates){const object=cloneModel(template);object.visible=false;weaponRoot.add(object);choices.set(name,object);}
  const glow=effects.create('env/light/fx_ray_sun_sm_short',0);glow.position.fromArray(position);glow.rotation.y=Math.PI/2;glow.visible=false;
  return {lid,origin:position,closed:lid.object.quaternion.clone(),weaponRoot,choices,glow};
}
export function updateBoxView(v,box,time,settings,effects){
  // WaW's moving box keeps its lid open under the bear and closes it as the
  // box leaves (treasure_chest_move: lid close on weapon_fly_away_end).
  const leaving=settings.teddyOpen&&box.phase==='leaving',closing=box.phase==='closing'||leaving,closedAt=leaving?box.started:box.closedAt;
  const elapsed=time-box.started,open=box.phase==='cycling'||box.phase==='offered'||settings.teddyOpen&&box.phase==='teddy';
  const blend=closing?1-THREE.MathUtils.smoothstep(time-closedAt,0,settings.closeTime):open?THREE.MathUtils.smoothstep(elapsed,0,settings.openTime):0;
  v.lid.object.quaternion.copy(v.closed).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),THREE.MathUtils.degToRad(settings.openAngle)*blend));
  v.weaponRoot.visible=open&&box.phase!=='teddy'||closing&&box.timedOut&&time-box.closedAt<.3;v.glow.visible=open;
  const rise=closing?1-THREE.MathUtils.smoothstep(time-closedAt,0,.3):THREE.MathUtils.smoothstep(elapsed,0,settings.riseTime);
  v.weaponRoot.position.z=v.origin[2]+settings.floatHeight*rise;
  for(const [name,object]of v.choices)object.visible=name===box.weapon;
  if(v.glow.visible)effects.update(v.glow,time-box.started);
}
