import * as THREE from 'three';
import {NativeActor,iwMoveMode,nativeStrideSpeed} from './iw7-native.js';
import {ParkNavigation} from './iw7-navigation.js';
import {SpacelandMatch} from './iw7-match.js';
import {canReachUse} from './interaction-reach.js';

export const combatClips=character=>[
  ...['shamble','walk','run','sprint'].flatMap(mode=>Array.from({length:mode==='shamble'?4:mode==='sprint'?3:5},(_,i)=>`iw7_cp_zom_${mode}_forward_0${i+1}`)),
  ...['stand_idle_01','stand_attack_l_01','stand_attack_r_01','death_backward_1','death_forward_1','spawn_ground_walk_01'].map(v=>'iw7_cp_zom_'+v),
  ...['idle','fire_sp','ads_fire','reload_rare','reload_empty_rare','raise','recoil','sprint_offset','ads_up_rare','ads_down_rare'].map(v=>'vm_g18_'+v),
  ...['idle','fire','ads_fire','reload','reload_empty','raise','sprint_offset','ads_up','ads_down'].map(v=>'vm_m1_'+v),
  character.melee,'vm_knifemelee_swipe',character.intro,character.card
];

export class SpacelandCombat {
  constructor({data,geometries,materials,clips,scene,camera,movement,collision,wallTrace,audio,hud,gameOver}){
    Object.assign(this,{data,geometries,materials,clips,scene,camera,movement,collision,wallTrace,audio,hud,gameOver});this.navigation=new ParkNavigation(collision);this.pool=[];this.corpses=[];this.points=[];this.time=0;this.character=data.characters.find(c=>c.id===data.selectedCharacter)||data.characters[0];
    for(let i=0;i<24;i++){const name=data.zombies[i%data.zombies.length],actor=this.actor(name);actor.root.visible=false;scene.add(actor.root);this.pool.push(actor);}
    this.wallWeapon=this.actor(data.wallWeapon.model);this.wallWeapon.root.position.fromArray(data.wallWeapon.origin);const a=data.wallWeapon.angles.map(v=>v*Math.PI/180);this.wallWeapon.root.rotation.set(a[2],a[0],a[1],'ZYX');scene.add(this.wallWeapon.root);
    this.viewScene=new THREE.Scene();this.viewCamera=new THREE.PerspectiveCamera(65,camera.aspect,.1,200);this.viewScene.add(new THREE.HemisphereLight(0xd2ddff,0x514361,2.4));
    const light=new THREE.DirectionalLight(0xffffff,1.6);light.position.set(1,1,3);this.viewScene.add(light);
    this.viewRoot=new THREE.Group();const matrix=new THREE.Matrix4().set(0,-1,0,0,0,0,1,0,-1,0,0,0,0,0,0,1);this.viewRoot.quaternion.setFromRotationMatrix(matrix);this.viewScene.add(this.viewRoot);
    this.arms=this.actor(this.character.arms);this.arms.root.position.z=-64.32;this.viewRoot.add(this.arms.root);
    this.guns=new Map();for(const definition of [data.weapon,data.rifle]){const gun=this.actor(definition.model,{relativePositions:true});gun.named.get('tag_cosmetic')?.scale.setScalar(0);this.arms.named.get('tag_weapon').add(gun.root);gun.root.visible=false;this.guns.set(definition.native,gun);}
    this.card=this.actor('zmb_card_01');this.arms.named.get('tag_accessory_left').add(this.card.root);this.card.root.visible=false;
    this.knifeModel=this.actor(this.character.knife);this.arms.named.get('tag_knife_attach2').add(this.knifeModel.root);this.knifeModel.root.visible=false;
    this.currentAction=null;this.actionTime=0;this.aimBlend=0;this.introTime=0;this.started=false;
    this.match=new SpacelandMatch(data,{spawn:v=>this.spawn(v),kill:(z,h)=>this.kill(z,h),hit:(z,h)=>this.hit(z,h),attack:()=>{this.damageFlash=.6;},
      round:(r,state)=>{this.roundFlash=state==='end'?10:3;this.audio.play(state==='start'?'mus_zombies_newwave':'mus_zombies_endwave',.45);},score:amount=>hud.score(amount),gameOver:()=>gameOver(this.match),action:(a,value)=>this.action(a,value),wallTrace,
      shot:(hits,origin,dir,distance)=>{if(hits.length)this.hitMarker=.15;this.flashTime=.045;}});
    this.arms.play(this.clip('vm_g18_idle'),{loop:true,blend:0});this.arms.onNote=n=>audio.play(n,.6);
    this.bloodPositions=new Float32Array(96*3);this.bloodLife=new Float32Array(96);this.bloodVelocity=new Float32Array(96*3);this.bloodAt=0;
    const bloodGeometry=new THREE.BufferGeometry();bloodGeometry.setAttribute('position',new THREE.BufferAttribute(this.bloodPositions,3));this.blood=new THREE.Points(bloodGeometry,new THREE.PointsMaterial({color:0x9d102a,size:3,transparent:true,opacity:.85,depthWrite:false}));this.blood.frustumCulled=false;scene.add(this.blood);
    this.muzzle=new THREE.PointLight(0xffe0a2,0,120,2);this.muzzle.position.set(4,-3,-23);this.viewScene.add(this.muzzle);
  }
  actor(name,options){return new NativeActor(this.data.rigs[name],this.geometries.get(name),this.materials,options);}
  clip(name){const clip=this.clips.get(name);if(!clip)throw new Error(`Original animation unavailable: ${name}`);return clip;}
  hitLocations(zombie){const head=zombie.actor.named.get('j_head')?.matrixWorld.elements,torso=zombie.actor.named.get('j_spine4')?.matrixWorld.elements;if(head)zombie.headPosition=[head[12]+head[0]*3,head[13]+head[1]*3,head[14]+head[2]*3];if(torso)zombie.torsoPosition=torso.slice(12,15);}
  async prepare(){this.navigation.begin(this.movement.position);while(this.navigation.pending){this.navigation.work(40);await new Promise(resolve=>requestAnimationFrame(resolve));}if(!this.navigation.flow.size)throw new Error('No walkable park navigation at spawn');}
  start(){if(this.started)return;this.started=true;this.introTime=this.clip(this.character.intro).duration+this.clip(this.character.card).duration;this.introGesture=true;this.currentAction=this.character.intro;this.actionTime=0;this.audio.play('vm_gesture_zmb_load_in_'+this.character.id,.6);}
  reset(){this.audio.stop();for(const actor of this.pool){actor.busy=false;actor.root.visible=false;actor.root.position.set(0,0,0);}this.corpses=[];this.match.reset();this.started=false;this.currentAction=null;this.introTime=0;this.bloodLife.fill(0);this.damageFlash=this.hitMarker=this.roundFlash=0;this.movement.reset();}
  action(name,value){
    const rifle=this.match.weapon.definition===this.data.rifle,prefix=rifle?'vm_m1_':'vm_g18_';
    if(name==='fire'){this.currentAction=prefix+(value?'ads_fire':rifle?'fire':'fire_sp');this.audio.play(rifle?'weap_m1_fire_plr':'weap_g18_fire_plr',.65);}
    if(name==='reload')this.currentAction=prefix+(rifle?(value?'reload_empty':'reload'):(value?'reload_empty_rare':'reload_rare'));
    if(name==='knife')this.currentAction=this.character.melee;
    if(name==='equip')this.currentAction=prefix+'raise';this.actionTime=0;
  }
  useCard(){if(this.match.over||this.match.phase==='intro'||this.match.reload||this.match.melee||this.currentAction)return;this.currentAction=this.character.card;this.actionTime=0;this.audio.play('wondercard_'+this.character.id.replace('valley_girl','valleygirl')+'_use_gesture',.6);}
  spawn({id,health,round}){
    const candidates=this.navigation.spawns(this.movement.position,this.data.spawnpoints),actor=this.pool.find(a=>!a.busy);
    if(!actor||!candidates.length)return null;
    const p=candidates[id%candidates.length],position=[...p];if(this.match.enemies.some(z=>!z.dead&&Math.hypot(z.position[0]-p[0],z.position[1]-p[1])<25))return null;
    actor.busy=true;actor.root.visible=true;actor.root.position.fromArray(p);actor.root.rotation.z=Math.atan2(this.movement.position[1]-p[1],this.movement.position[0]-p[0]);actor.play(this.clip('iw7_cp_zom_spawn_ground_walk_01'),{loop:false,blend:0,restart:true});
    const mode=iwMoveMode(round),variant=id%(mode==='slow_walk'?4:mode==='sprint'?3:5)+1;
    const clip=this.clip(`iw7_cp_zom_${mode==='slow_walk'?'shamble':mode}_forward_0${variant}`),speed=nativeStrideSpeed(clip);
    if(speed<=0)throw new Error('Original zombie root motion is missing');
    const zombie={id,health,round,position,actor,dead:false,entering:true,speed,moveMode:mode,moveClip:clip,rate:1,attackClock:0,attacking:false,attackHit:false,lastPosition:[...position]};
    actor.onNote=n=>{if(n==='zmb_walk'||n==='zmb_run'){const distance=Math.hypot(position[0]-this.movement.position[0],position[1]-this.movement.position[1]);if(distance<350)this.audio.play(n,.1*(1-distance/350));}};return zombie;
  }
  kill(zombie,head){zombie.entering=false;zombie.attacking=false;zombie.actor.play(this.clip('iw7_cp_zom_'+(head?'death_backward_1':'death_forward_1')),{loop:false,restart:true});this.corpses.push({zombie,time:0});}
  hit(zombie,head){const p=(head?zombie.headPosition:zombie.torsoPosition)||[zombie.position[0],zombie.position[1],zombie.position[2]+(head?64:42)];for(let i=0;i<9;i++){const at=this.bloodAt++%96;this.bloodLife[at]=.35+Math.random()*.25;this.bloodPositions.set(p,at*3);this.bloodVelocity.set([(Math.random()-.5)*100,(Math.random()-.5)*100,20+Math.random()*100],at*3);}}
  fire(ads){const dir=new THREE.Vector3();this.camera.getWorldDirection(dir);return this.match.fire(this.camera.position.toArray(),dir.toArray(),ads);}
  melee(){const dir=new THREE.Vector3();this.camera.getWorldDirection(dir);this.match.knife(this.camera.position.toArray(),dir.toArray());}
  nearWallBuy(){const dir=new THREE.Vector3();this.camera.getWorldDirection(dir);return canReachUse(this.movement.position,this.data.wallWeapon.origin,Math.atan2(dir.y,dir.x));}
  interact(){if(this.nearWallBuy())this.match.buyM1();else this.match.reloadWeapon();}
  update(dt,{aim=false,sprint=false,moving=false}={}){
    if(!this.started)return;this.time+=dt;this.navigation.begin(this.movement.position);this.navigation.work(24);
    if(this.introTime>0){this.introTime-=dt;if(this.introGesture&&this.introTime<=this.clip(this.character.card).duration){this.introGesture=false;this.currentAction=this.character.card;this.actionTime=0;this.audio.play('wondercard_'+this.character.id.replace('valley_girl','valleygirl')+'_use_gesture',.6);}if(this.introTime<=0){this.currentAction=null;this.match.begin();}}
    this.match.step(dt,{canSpawn:this.navigation.flow.size>0});
    for(const zombie of this.match.enemies){
      if(zombie.dead)continue;const actor=zombie.actor,p=zombie.position;
      if(zombie.entering){actor.update(dt);this.hitLocations(zombie);if(actor.done){zombie.entering=false;actor.play(zombie.moveClip,{loop:true,rate:zombie.rate});}continue;}
      if(this.match.total-this.match.killed===1){zombie.lastRemainingAt??=this.time;if(!zombie.attacking&&zombie.moveMode!=='sprint'&&zombie.moveMode!=='run'&&this.time-zombie.lastRemainingAt>(this.match.round<4?80:0)){zombie.moveMode='run';zombie.moveClip=this.clip(`iw7_cp_zom_run_forward_0${zombie.id%5+1}`);zombie.speed=nativeStrideSpeed(zombie.moveClip);actor.play(zombie.moveClip,{loop:true});}}
      const player=this.movement.position,distance=Math.hypot(player[0]-p[0],player[1]-p[1]);zombie.attackClock=Math.max(0,zombie.attackClock-dt);
      if(zombie.attacking){actor.update(dt);this.hitLocations(zombie);if(!zombie.attackHit&&actor.time>zombie.hitTime){zombie.attackHit=true;const line=this.wallTrace([p[0],p[1],p[2]+45],[(player[0]-p[0])/Math.max(1,distance),(player[1]-p[1])/Math.max(1,distance),0],distance);if(distance<73&&Math.abs(player[2]-p[2])<30&&!line)this.match.hurt(45);}if(actor.done){zombie.attacking=false;actor.play(zombie.moveClip,{loop:true,rate:zombie.rate});}continue;}
      if(distance<62&&Math.abs(player[2]-p[2])<30&&zombie.attackClock===0){zombie.attacking=true;zombie.attackHit=false;zombie.attackClock=1.4;const attack=this.clip('iw7_cp_zom_stand_attack_'+(zombie.id%2?'l':'r')+'_01');zombie.hitTime=attack.notes.find(n=>n.name==='hit')?.time??.3;actor.play(attack,{loop:false,restart:true});this.audio.play('zmb_attack_swipe',.2);continue;}
      if(zombie.waypoint&&Math.hypot(zombie.waypoint[0]-p[0],zombie.waypoint[1]-p[1])<3)zombie.waypoint=null;
      const goal=distance<85?player:(zombie.waypoint??=this.navigation.next(p));
      if(goal){let dx=goal[0]-p[0],dy=goal[1]-p[1],len=Math.hypot(dx,dy);if(len>.5){const amount=Math.min(len,zombie.speed*dt),dir=[dx/len,dy/len,0],candidate=[p[0]+dir[0]*amount,p[1]+dir[1]*amount,p[2]],floor=this.movement.ground(candidate,20,45);let blocked=floor===null||Math.abs(floor-p[2])>=21;
        if(!blocked)for(const h of [25,52]){const hit=this.collision([p[0],p[1],Math.max(p[2],floor)+h],dir,amount+14);if(hit&&hit.normal[2]<.45){blocked=true;break;}}
        if(!blocked){p[0]=candidate[0];p[1]=candidate[1];p[2]=floor+.05;}
        let delta=Math.atan2(dy,dx)-actor.root.rotation.z;delta=Math.atan2(Math.sin(delta),Math.cos(delta));actor.root.rotation.z+=delta*Math.min(1,dt*10);
      }}
      // Native zombies have a 15-unit avoidance radius. Apply small, checked
      // separation steps so a shared flow doesn't stack every body in one spot.
      let sx=0,sy=0;for(const other of this.match.enemies){if(other===zombie||other.dead||other.entering)continue;const dx=p[0]-other.position[0],dy=p[1]-other.position[1],len=Math.hypot(dx,dy);if(len>.01&&len<30){sx+=dx/len*(30-len);sy+=dy/len*(30-len);}}
      const separation=Math.hypot(sx,sy);if(separation>0){const amount=Math.min(1,separation*dt*2),dir=[sx/separation,sy/separation,0];if(!this.collision([p[0],p[1],p[2]+25],dir,amount+14)&&!this.collision([p[0],p[1],p[2]+52],dir,amount+14)){const candidate=[p[0]+dir[0]*amount,p[1]+dir[1]*amount,p[2]],floor=this.movement.ground(candidate,20,45);if(floor!==null&&Math.abs(floor-p[2])<20){p[0]=candidate[0];p[1]=candidate[1];p[2]=floor+.05;}}}
      actor.root.position.fromArray(p);actor.update(dt);this.hitLocations(zombie);
    }
    for(let i=this.corpses.length-1;i>=0;i--){const corpse=this.corpses[i];corpse.time+=dt;corpse.zombie.actor.update(dt);if(corpse.time>5){corpse.zombie.actor.busy=false;corpse.zombie.actor.root.visible=false;this.match.enemies=this.match.enemies.filter(z=>z!==corpse.zombie);this.corpses.splice(i,1);}}
    this.aimBlend=THREE.MathUtils.damp(this.aimBlend,aim?1:0,12,dt);this.updateView(dt,{sprint:sprint&&!aim,moving});
    for(let i=0;i<96;i++){if(this.bloodLife[i]<=0){this.bloodPositions[i*3+2]=-20000;continue;}this.bloodLife[i]-=dt;this.bloodVelocity[i*3+2]-=400*dt;for(let k=0;k<3;k++)this.bloodPositions[i*3+k]+=this.bloodVelocity[i*3+k]*dt;}this.blood.geometry.attributes.position.needsUpdate=true;
    this.flashTime=Math.max(0,(this.flashTime||0)-dt);this.muzzle.intensity=this.flashTime>0?150:0;this.hitMarker=Math.max(0,(this.hitMarker||0)-dt);this.damageFlash=Math.max(0,(this.damageFlash||0)-dt);this.roundFlash=Math.max(0,(this.roundFlash||0)-dt);
    this.hud.update(this);
  }
  updateView(dt,{sprint,moving}){
    const rifle=this.match.weapon.definition===this.data.rifle,prefix=rifle?'vm_m1_':'vm_g18_',idle=this.clip(prefix+'idle');
    if(this.arms.clip!==idle)this.arms.play(idle,{loop:true,blend:.1});this.arms.update(dt);
    const gun=this.guns.get(this.match.weapon.definition.native);for(const g of this.guns.values())g.root.visible=g===gun;gun.resetPose();gun.apply(idle,0);this.card.resetPose();this.knifeModel.resetPose();
    if(sprint&&moving&&!this.currentAction){const offset=this.clip(prefix+'sprint_offset');this.arms.additive(offset,offset.duration);gun.additive(offset,offset.duration);}
    if(this.aimBlend>0&&!this.currentAction){const ads=this.clip(prefix+(rifle?'ads_up':'ads_up_rare'));this.arms.apply(ads,ads.duration,this.aimBlend);gun.apply(ads,ads.duration,this.aimBlend);}
    this.card.root.visible=false;this.knifeModel.root.visible=false;
    if(this.currentAction){const clip=this.clip(this.currentAction),previous=this.actionTime;this.actionTime+=dt;
      for(const n of clip.notes)if(n.time>=previous&&n.time<this.actionTime)this.audio.play(n.name,.6);
      const gesture=this.currentAction.startsWith('vm_gesture'),knife=this.currentAction.includes('melee')||this.currentAction.includes('knifemelee');
      this.arms.apply(clip,Math.min(this.actionTime,clip.duration));gun.apply(clip,Math.min(this.actionTime,clip.duration));
      if(gesture){this.card.root.visible=this.currentAction===this.character.card&&this.actionTime<(clip.notes.find(n=>n.name==='hide')?.time??clip.duration);this.card.apply(clip,this.actionTime);}
      if(knife){gun.root.visible=false;this.knifeModel.root.visible=true;this.knifeModel.apply(clip,this.actionTime);}
      if(this.actionTime>=clip.duration&&this.introTime<=0)this.currentAction=null;
    }
    this.arms.root.updateMatrixWorld(true);gun.root.updateMatrixWorld(true);this.card.root.updateMatrixWorld(true);this.knifeModel.root.updateMatrixWorld(true);
    const bob=moving&&!this.currentAction&&!this.aimBlend?Math.sin(this.time*(sprint?12:8))*.15:0;this.viewRoot.position.set(0,bob,0);this.viewRoot.updateMatrixWorld(true);
    // Native ADS clips drive tag_ads; align the model's actual iron-sight tag
    // with the camera axis, rather than sliding the gun by an arbitrary offset.
    if(this.aimBlend>0){const sight=gun.named.get('tag_sight_on')||gun.named.get('tag_sight_off')||gun.named.get('tag_reflex');if(sight){const p=sight.getWorldPosition(new THREE.Vector3());this.viewRoot.position.x-=p.x*this.aimBlend;this.viewRoot.position.y-=p.y*this.aimBlend;}}
    this.viewRoot.updateMatrixWorld(true);const flash=gun.named.get('tag_flash');if(flash)this.muzzle.position.setFromMatrixPosition(flash.matrixWorld);
    this.viewCamera.fov=65-this.aimBlend*12;this.viewCamera.updateProjectionMatrix();
  }
  render(renderer){if(!this.started||this.match.over)return;renderer.autoClear=false;renderer.clearDepth();renderer.render(this.viewScene,this.viewCamera);renderer.autoClear=true;}
}
