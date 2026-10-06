import * as THREE from 'three';
import {model,cloneModel,shadeModel,applyHideTags} from './assets.js';
import {divePresentation} from './player-movement.js';
import {units} from './dive-config.js';
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

export class PlayerBody {
  constructor(scene,illumination,definitions,character){Object.assign(this,{scene,illumination,definitions,character});this.thirdPerson=false;this.ready=false;this.weaponVersion=0;}
  async prepare(){
    const definition=this.definitions[this.character]||this.definitions[0],object=cloneModel(await model(definition.body)),root=new THREE.Group(),pivot=new THREE.Group();root.name='Local player character';root.visible=false;root.add(pivot);pivot.add(object);this.scene.add(root);
    if(definition.head){const head=cloneModel(await model(definition.head));if(definition.hat)head.add(cloneModel(await model(definition.hat)));head.traverse(mesh=>{if(mesh.isSkinnedMesh){mesh.skeleton.bones=mesh.skeleton.bones.map(bone=>object.getObjectByName(bone.name)||bone);}});pivot.add(head);this.head=head;}
    object.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(object),neck=object.getObjectByName('j_neck')?.getWorldPosition(new THREE.Vector3()).z||60,corners=[];for(let i=0;i<8;i++)corners.push(new THREE.Vector3(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z));
    const rest=new Map();object.traverse(bone=>{if(bone.isBone)rest.set(bone,{position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()});});
    this.geometry=[];object.traverse(mesh=>{if(mesh.isMesh){mesh.frustumCulled=false;this.geometry.push({mesh,full:mesh.geometry,fullVisible:mesh.visible});}});
    applyHideTags(object,'j_head j_neck j_shoulder_le j_shoulder_ri');for(const item of this.geometry){item.local=item.mesh.geometry;item.localVisible=item.mesh.visible;}
    shadeModel(object,[.6,.6,.6]);if(this.head)shadeModel(this.head,[.6,.6,.6]);this.rig={root,pivot,object,rest,corners,neckHeight:neck};this.root=root;this.ready=true;this.setThirdPerson(false);
  }
  setThirdPerson(on){this.thirdPerson=!!on;for(const item of this.geometry||[]){item.mesh.geometry=on?item.full:item.local;item.mesh.visible=on?item.fullVisible:item.localVisible;}if(this.head)this.head.visible=!!on;if(this.rig?.gun)this.rig.gun.visible=!!on;}
  async weapon(weapon){
    const version=++this.weaponVersion;if(!this.ready||!weapon.definition.worldModel)return;const gun=cloneModel(await model(weapon.definition.worldModel));if(version!==this.weaponVersion)return;
    if(this.rig.gun){const materials=new Set();this.rig.gun.traverse(mesh=>{if(mesh.isMesh)for(const mat of [mesh.material].flat())materials.add(mat);});this.rig.gun.removeFromParent();for(const mat of materials)mat.dispose();}this.rig.gun=gun;gun.visible=this.thirdPerson;this.root.add(gun);shadeModel(gun,[.6,.6,.6]);
  }
  update(game,playing){
    if(!this.ready)return;this.root.visible=!!playing&&game.player.health>0;if(!this.root.visible)return;
    const time=game.time-1/120+game.accumulator,presentation=divePresentation(game,time);posePlayerBody(this.rig,game,presentation,game.renderPosition(game.player));
    if(game.time>=(this.lightDue||0)){this.lightDue=game.time+.25;const color=this.illumination(game.player.position);for(const object of [this.rig.object,this.head,this.rig.gun])object?.traverse(mesh=>{if(mesh.isMesh)for(const material of [mesh.material].flat())if(!material.userData.fixedLight)material.color.setRGB(...color);});}
  }
  warmObjects(){return this.root?[this.root]:[];}
  diagnostics(){return {ready:this.ready,character:this.definitions[this.character]?.name,thirdPerson:this.thirdPerson,visible:this.root?.visible,bones:this.rig?.rest.size,bodyTiltDegrees:(this.rig?.pivot.rotation.y||0)*180/Math.PI};}
}
