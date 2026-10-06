import * as THREE from 'three';
import {model,cloneModel,shadeModel,applyHideTags,originalAnimation} from './assets.js';
import {divePresentation} from './player-movement.js';
import {units,DEFAULT_DIVE_CONFIG} from './dive-config.js';
const v=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),q=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),worldQ=new THREE.Quaternion();

// Rotate an authored joint in world space, then express the rotation in its
// parent's frame. This works with the original rig's non-identity bind axes.
function aimJoint(joint,child,target){
  if(!joint||!child)return;joint.getWorldPosition(v);a.copy(child.getWorldPosition(a)).sub(v);b.copy(target).sub(v);if(a.lengthSq()<1e-8||b.lengthSq()<1e-8)return;
  q.setFromUnitVectors(a.normalize(),b.normalize());joint.getWorldQuaternion(worldQ);joint.parent.getWorldQuaternion(parentQ).invert();joint.quaternion.copy(parentQ.multiply(q).multiply(worldQ));joint.updateMatrixWorld(true);
}
function worldPoint(root,x,y,z){return root.localToWorld(new THREE.Vector3(x,y,z));}
function rotateWorld(joint,axis,angle){if(!joint)return;joint.getWorldQuaternion(worldQ);joint.parent.getWorldQuaternion(parentQ).invert();q.setFromAxisAngle(axis,angle);joint.quaternion.copy(parentQ.multiply(q).multiply(worldQ));joint.updateMatrixWorld(true);}

// The movement root stays at floor-relative feet Z. A separate presentation
// pivot lays the original character rig out behind the camera/head anchor.
export function posePlayerBody(rig,game,presentation,position){
  const blend=presentation.bodyBlend,smooth=blend*blend*(3-2*blend),c=presentation.config;
  for(const [bone,rest]of rig.rest){bone.position.copy(rest.position);bone.quaternion.copy(rest.quaternion);bone.scale.copy(rest.scale);}
  rig.root.position.fromArray(position);rig.root.rotation.set(0,0,presentation.yaw);rig.pivot.rotation.set(0,smooth*Math.PI/2,0);
  rig.pivot.position.set(-rig.neckHeight*smooth,0,0);
  // Bound the rotated bind geometry without traversing vertices every frame.
  let low=Infinity;for(const corner of rig.corners){v.copy(corner).applyEuler(rig.pivot.rotation);low=Math.min(low,v.z);}
  rig.pivot.position.z=smooth*(-low+units(c.bodyClearanceMeters));
  if(game.player.stance==='crouch'&&!game.dive)rig.pivot.position.z-=16;
  const spine=rig.object.getObjectByName('j_spineupper');if(spine)spine.position.x-=units(presentation.compressionMeters);
  rig.root.updateMatrixWorld(true);
  if(spine&&smooth){const chest=spine.getWorldPosition(new THREE.Vector3()).z-position[2],target=units(c.bodyClearanceMeters+c.bodyChestRadiusMeters)-units(presentation.compressionMeters)*.5;rig.pivot.position.z-=smooth*Math.max(0,chest-target);rig.root.updateMatrixWorld(true);}
  rotateWorld(rig.object.getObjectByName('j_neck'),new THREE.Vector3(-Math.sin(presentation.yaw),Math.cos(presentation.yaw),0),-smooth*70*Math.PI/180);
  for(const [side,sign]of [['le',1],['ri',-1]]){const shoulder=rig.object.getObjectByName('j_shoulder_'+side),elbow=rig.object.getObjectByName('j_elbow_'+side),wrist=rig.object.getObjectByName('j_wrist_'+side),base=game.player.stance==='crouch'?27:43,brace=base+(units(c.bodyClearanceMeters)+3-base)*smooth-units(presentation.compressionMeters)*.5;aimJoint(shoulder,elbow,worldPoint(rig.root,2-23*smooth,sign*(15-2*smooth),brace-3));aimJoint(elbow,wrist,worldPoint(rig.root,15-10*smooth,sign*9,brace+1));}
  if(smooth>.05){
    for(const [side,sign]of [['le',1],['ri',-1]]){
      // Knees briefly tuck at push-off, extend in flight, then settle after contact.
      const hip=rig.object.getObjectByName('j_hip_'+side),knee=rig.object.getObjectByName('j_knee_'+side),ankle=rig.object.getObjectByName('j_ankle_'+side),tuck=(1-smooth)*9+units(presentation.compressionMeters)*.6;
      if(hip&&knee&&ankle){const at=knee.getWorldPosition(new THREE.Vector3());at.z+=tuck;aimJoint(hip,knee,at);const foot=ankle.getWorldPosition(new THREE.Vector3());foot.z=Math.max(position[2]+units(c.bodyClearanceMeters)+2,foot.z);aimJoint(knee,ankle,foot);}
    }
  }else if(game.player.stance==='crouch'){
    for(const [side,sign]of [['le',1],['ri',-1]]){const hip=rig.object.getObjectByName('j_hip_'+side),knee=rig.object.getObjectByName('j_knee_'+side),ankle=rig.object.getObjectByName('j_ankle_'+side);aimJoint(hip,knee,worldPoint(rig.root,10,sign*5,16));aimJoint(knee,ankle,worldPoint(rig.root,-5,sign*5,3));}
  }
  rig.root.updateMatrixWorld(true);
  if(rig.gun){const wrist=rig.object.getObjectByName('j_wrist_ri');if(wrist)rig.gun.position.copy(rig.root.worldToLocal(wrist.getWorldPosition(new THREE.Vector3())));else rig.gun.position.set(smooth?6:15,-8,smooth?units(c.bodyClearanceMeters)+14:43);rig.gun.rotation.set(0,smooth?0:-.2,0);}
}

// A head model carries its own neck/head bones plus face bones the body
// lacks. Move the face bones under the body's matching bone, then skin the
// head to the body's skeleton (leaving them behind stretched the face to the
// model origin).
export function attachHead(object,head){
  const bones=new Map();object.traverse(n=>{if(n.isBone)bones.set(n.name,n);});
  const extra=[];head.traverse(n=>{if(n.isBone&&!bones.has(n.name))extra.push(n);});
  for(const bone of extra){const parent=bones.get(bone.parent?.name);if(parent){parent.add(bone);bones.set(bone.name,bone);}}
  const meshes=[];head.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
  for(const mesh of meshes)mesh.skeleton.bones=mesh.skeleton.bones.map(b=>bones.get(b.name)||b);
}
// Rigid models (Richtofen's cap) attach to a bone like CoD's Attach(): their
// root sits on the tag, restoring the Z-up axis the GLB export rotated away.
export function attachRigid(object,attachment,tag='j_head'){
  const inner=attachment.children[0]||attachment,bone=object.getObjectByName(tag);if(!bone)return null;
  inner.removeFromParent();inner.position.set(0,0,0);inner.rotation.set(Math.PI/2,0,0);bone.add(inner);return inner;
}
// Third-person player clips (pb_*) for another co-op player's state.
const DIRECTIONS=['forward','back','left','right'];
export function playerClip(s,{pistol=false,direction='forward',moving=false},has=()=>true){
  const pick=(...names)=>names.find(n=>n&&has(n))||'pb_stand_alert',p=pistol?'_pistol':'';
  if(s.down)return moving?pick('pb_laststand_crawl_'+direction,'pb_prone_pistolcrawl_'+direction[0],'pb_prone_crawl_pistol'):pick('pb_laststand_idle','pb_prone_aim_pistol');
  if(s.dive)return s.dive.phase==='air'?pick(pistol&&'pb_dive_prone_pistol','pb_dive_prone'):pick('pb_dive_prone_land','pb_prone_aim');
  if(s.stance==='prone'){
    if(!moving)return pick('pb_prone_aim'+p,'pb_prone_aim');
    const pistolCrawl={forward:'pb_prone_crawl_pistol',back:'pb_prone_crawl_pistol_back',left:'pb_prone_pistol_crawl_left',right:'pb_prone_pistol_crawl_right'}[direction];
    return pick(pistol&&pistolCrawl,'pb_prone_crawl'+(direction==='forward'?'':'_'+direction));
  }
  if(s.stance==='crouch')return moving?pick('pb_crouch_run_'+direction+p,'pb_crouch_run_'+direction):pick('pb_crouch_alert'+p,'pb_crouch_alert');
  if(s.sprinting)return pick('pb_sprint'+p,'pb_sprint');
  // Pistols run forward with their own clip (there is no forward combatrun_pistol).
  if(moving)return s.ads>.5?pick(pistol&&'pb_combatwalk_'+direction+'_loop_pistol','pb_stand_shoot_walk_'+direction):pick(pistol&&direction==='forward'&&'pb_pistol_run_fast','pb_combatrun_'+direction+'_loop'+p,'pb_combatrun_'+direction+'_loop');
  return s.ads>.5?pick('pb_stand_ads'+p,'pb_stand_ads'):pick('pb_stand_alert'+p,'pb_stand_alert');
}
// Movement relative to where the player faces picks the directional clip.
export function moveDirection(velocity,yaw){
  const forward=velocity[0]*Math.cos(yaw)+velocity[1]*Math.sin(yaw),left=-velocity[0]*Math.sin(yaw)+velocity[1]*Math.cos(yaw);
  return Math.abs(forward)>=Math.abs(left)?(forward>=0?'forward':'back'):(left>0?'left':'right');
}
export class PlayerBody {
  constructor(scene,illumination,definitions,character){Object.assign(this,{scene,illumination,definitions,character});this.thirdPerson=false;this.ready=false;this.weaponVersion=0;}
  async prepare(){
    const definition=this.definitions[this.character]||this.definitions[0],object=cloneModel(await model(definition.body)),root=new THREE.Group(),pivot=new THREE.Group();root.name='Local player character';root.visible=false;root.add(pivot);pivot.add(object);this.scene.add(root);
    // The character script's attachments: head, hat/helmet and gear. Skinned
    // parts bind to the body's skeleton; a rigid one sits on the head bone.
    const parts=[];
    for(const key of ['head','hat','gear'])for(const name of [definition[key]].flat().filter(Boolean)){
      const part=cloneModel(await model(name));let skinned=false;part.traverse(n=>{if(n.isSkinnedMesh)skinned=true;});
      if(skinned){attachHead(object,part);pivot.add(part);shadeModel(part,[.6,.6,.6]);parts.push(part);}
      else{const rigid=attachRigid(object,part,'j_head');if(rigid){shadeModel(rigid,[.6,.6,.6]);parts.push(rigid);}}
    }
    this.parts=parts;this.head=null;
    object.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(object),neck=object.getObjectByName('j_neck')?.getWorldPosition(new THREE.Vector3()).z||60,corners=[];for(let i=0;i<8;i++)corners.push(new THREE.Vector3(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z));
    const rest=new Map();object.traverse(bone=>{if(bone.isBone)rest.set(bone,{position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()});});
    this.geometry=[];object.traverse(mesh=>{if(mesh.isMesh){mesh.frustumCulled=false;this.geometry.push({mesh,full:mesh.geometry,fullVisible:mesh.visible});}});
    applyHideTags(object,'j_head j_neck j_shoulder_le j_shoulder_ri');for(const item of this.geometry){item.local=item.mesh.geometry;item.localVisible=item.mesh.visible;}
    shadeModel(object,[.6,.6,.6]);this.rig={root,pivot,object,rest,corners,neckHeight:neck};this.root=root;this.ready=true;this.setThirdPerson(false);
  }
  setThirdPerson(on){this.thirdPerson=!!on;for(const item of this.geometry||[]){item.mesh.geometry=on?item.full:item.local;item.mesh.visible=on?item.fullVisible:item.localVisible;}for(const part of this.parts||[])part.visible=!!on;if(this.rig?.gun)this.rig.gun.visible=!!on;}
  async weapon(weapon){
    const version=++this.weaponVersion;if(!this.ready||!weapon.definition.worldModel)return;const gun=cloneModel(await model(weapon.definition.worldModel));if(version!==this.weaponVersion)return;
    if(this.rig.gun){const materials=new Set();this.rig.gun.traverse(mesh=>{if(mesh.isMesh)for(const mat of [mesh.material].flat())materials.add(mat);});this.rig.gun.removeFromParent();for(const mat of materials)mat.dispose();}this.rig.gun=gun;gun.visible=this.thirdPerson;this.root.add(gun);shadeModel(gun,[.6,.6,.6]);
  }
  update(game,playing){
    // Like the original, the local player never sees their own body in first
    // person; it is drawn only in the third-person view (and for other players).
    if(!this.ready)return;this.root.visible=this.thirdPerson&&!!playing&&game.player.health>0;if(!this.root.visible)return;
    const time=game.time-1/120+game.accumulator,presentation=divePresentation(game,time);posePlayerBody(this.rig,game,presentation,game.renderPosition(game.player));
    if(game.time>=(this.lightDue||0)){this.lightDue=game.time+.25;const color=this.illumination(game.player.position);for(const object of [this.rig.object,...(this.parts||[]),this.rig.gun])object?.traverse(mesh=>{if(mesh.isMesh)for(const material of [mesh.material].flat())if(!material.userData.fixedLight)material.color.setRGB(...color);});}
  }
  // Another co-op player, drawn from their network state with the original
  // third-person clips; the gun is held between their hands.
  async prepareRemote(clips){
    this.mixer=new THREE.AnimationMixer(this.rig.object);this.actions=new Map();this.clip=null;
    // Some clips carry face tracks made for the multiplayer head rig; on a
    // character's own head they pull the jaw open, so the face keeps its pose.
    const face=/^(j_jaw|j_lip|j_mouth|j_brow|j_cheek|j_eye|j_levator|j_chin|tag_eye)/;
    // The player clips' bone translations (other than the root) are offsets
    // from the skeleton's rest pose. Read as absolute positions they folded the
    // spine (players stood 12 units short) and put the hand tag above the hands.
    const offset=clip=>{for(const track of clip.tracks){
      const [bone,property]=track.name.split('.');if(property!=='position'||bone==='j_mainroot')continue;
      const rest=this.rig.rest.get(this.rig.object.getObjectByName(bone))?.position;if(!rest)continue;
      for(let k=0;k<track.values.length;k+=3){track.values[k]+=rest.x;track.values[k+1]+=rest.y;track.values[k+2]+=rest.z;}
    }};
    await Promise.all(clips.map(async name=>{try{const clip=await originalAnimation(name,this.rig.object,true);clip.tracks=clip.tracks.filter(t=>!face.test(t.name));offset(clip);this.actions.set(name,this.mixer.clipAction(clip));}catch{}}));
    this.spine=this.rig.object.getObjectByName('j_spine4');this.kick=0;this.flashUntil=0;
    for(const [name,action]of this.actions){const once=/dive_prone_land|2laststand|takeoff|_land$/.test(name);action.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;}
  }
  // The gun mounts on the animated hand tag (tag_weapon_right), as Attach()
  // does in the game, with its muzzle flash on the gun's tag_flash.
  async remoteWeapon(definition){
    const version=++this.weaponVersion;if(!this.ready||!definition?.worldModel)return;
    const gun=cloneModel(await model(definition.worldModel));if(version!==this.weaponVersion)return;
    applyHideTags(gun,definition.hideTags);shadeModel(gun,[.6,.6,.6]);
    const inner=gun.children[0]||gun,mount=new THREE.Group();inner.removeFromParent();inner.position.set(0,0,0);inner.rotation.set(Math.PI/2,0,0);mount.add(inner);
    const flash=new THREE.Mesh(new THREE.ConeGeometry(2.2,9,6),new THREE.MeshBasicMaterial({color:0xffe2a8,transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending}));
    flash.rotation.z=-Math.PI/2;flash.position.x=4.5;flash.visible=false;flash.userData.fixedLight=true;flash.material.userData.fixedLight=true;
    (inner.getObjectByName('tag_flash')||inner).add(flash);
    this.rig.gun?.removeFromParent();this.rig.gun=mount;this.flash=flash;
    (this.rig.object.getObjectByName('tag_weapon_right')||this.rig.object.getObjectByName('j_wrist_ri')).add(mount);
    this.pistol=/pistol/i.test(definition.weaponClass||'');this.lightDue=0;
  }
  // A shot: muzzle flash and the recoil kick of the arms and gun.
  fire(time){this.kick=1;this.flashUntil=time+.05;}
  poseRemote(s,dt,time,velocity=[0,0]){
    if(!this.ready||!this.mixer)return;this.root.visible=!!s&&!s.dead;if(!this.root.visible)return;
    const speed=Math.hypot(velocity[0],velocity[1]),moving=speed>12&&!s.dive,yaw=s.dive?.yaw??s.yaw;
    const name=playerClip(s,{pistol:this.pistol||s.down,direction:moving?moveDirection(velocity,yaw):'forward',moving},n=>this.actions.has(n));
    if(name!==this.clip){const next=this.actions.get(name),previous=this.actions.get(this.clip);next.reset().setEffectiveWeight(1).play();if(previous)next.crossFadeFrom(previous,.18,false);this.clip=name;}
    // Locomotion clips play at the player's actual speed.
    const nominal=s.down?40:s.stance==='prone'?28:s.stance==='crouch'?124:s.sprinting?285:190;
    this.actions.get(name).setEffectiveTimeScale(moving?Math.max(.6,Math.min(1.5,speed/nominal)):1);
    this.rig.root.position.fromArray(s.p);this.rig.root.rotation.set(0,0,yaw);this.rig.pivot.rotation.set(0,0,0);this.rig.pivot.position.set(0,0,0);
    // The mixer only writes a bone when its animated value changes, so put
    // back the spine's animated pose before adding this frame's aim bend.
    if(this.spineBase)this.spine.quaternion.copy(this.spineBase);
    this.mixer.update(dt);
    if(this.spine)(this.spineBase??=new THREE.Quaternion()).copy(this.spine.quaternion);
    // Their view pitch bends the upper spine, as the aim layer does; a shot
    // jolts it back and the muzzle climbs, then both settle.
    this.kick*=Math.exp(-dt*16);const right=new THREE.Vector3(-Math.sin(yaw),Math.cos(yaw),0);
    if(this.spine&&!s.down&&!s.dive&&s.stance!=='prone'){this.rig.root.updateMatrixWorld(true);rotateWorld(this.spine,right,-(s.pitch||0)*.6-this.kick*.05);}
    if(this.rig.gun){this.rig.gun.quaternion.identity();this.rig.root.updateMatrixWorld(true);if(this.kick>.01)rotateWorld(this.rig.gun,right,-this.kick*.14);}
    if(this.flash){this.flash.visible=time<this.flashUntil;if(this.flash.visible)this.flash.rotation.x=Math.random()*Math.PI;}
    this.rig.root.updateMatrixWorld(true);
    if(time>=(this.lightDue||0)){this.lightDue=time+.25;const color=this.illumination(s.p);for(const object of [this.rig.object,...(this.parts||[]),this.rig.gun])object?.traverse(mesh=>{if(mesh.isMesh)for(const material of [mesh.material].flat())if(!material.userData.fixedLight)material.color.setRGB(...color);});}
  }
  dispose(){this.root?.removeFromParent();this.rig?.gun?.removeFromParent();this.mixer?.stopAllAction();}
  warmObjects(){return this.root?[this.root]:[];}
  diagnostics(){return {ready:this.ready,character:this.definitions[this.character]?.name,thirdPerson:this.thirdPerson,visible:this.root?.visible,bones:this.rig?.rest.size,bodyTiltDegrees:(this.rig?.pivot.rotation.y||0)*180/Math.PI};}
}
