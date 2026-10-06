import * as THREE from 'three';
import {PosedTrace} from './posed-trace.js';
import {raySphere,rayCapsule} from './ballistics.js';

// Native animated bones provide solid combat volumes beneath torn clothing.
// Keep detailed mesh hits for limbs, and do not depend on the camera's culling.
export class ZombieHitTrace extends PosedTrace {
  constructor(root){
    super(root);this.headBone=root.getObjectByName('j_head');
    this.lowerBone=root.getObjectByName('j_pelvis')||root.getObjectByName('j_hip')||root.getObjectByName('j_spinelower');
    this.upperBone=root.getObjectByName('j_spineupper')||root.getObjectByName('j_spine3');
    this.p=new THREE.Vector3();this.q=new THREE.Vector3();
  }
  trace(ray,max,tick){
    let hit=super.trace(ray,max,tick);if(hit)hit.head=!!hit.object.userData.zombieHead;
    const origin=ray.origin.toArray(),dir=ray.direction.toArray();
    if(this.headBone){
      const distance=raySphere(origin,dir,this.headBone.getWorldPosition(this.p).toArray(),9,max);
      if(distance!==null&&(!hit||distance<hit.distance))hit={distance,head:true,object:this.headBone};
    }
    if(this.lowerBone&&this.upperBone){
      const distance=rayCapsule(origin,dir,this.lowerBone.getWorldPosition(this.p).toArray(),this.upperBone.getWorldPosition(this.q).toArray(),12,max);
      if(distance!==null&&(!hit||distance<hit.distance))hit={distance,head:false,object:this.upperBone};
    }
    return hit;
  }
}
