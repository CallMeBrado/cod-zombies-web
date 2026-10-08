import * as THREE from 'three';

const STEP=1/60,GRAVITY=800;
// The native rigs share these joints. Small collision bodies follow visible
// surfaces (contents 1), without the invisible clips used for living actors.
const JOINTS=[
  ['j_mainroot',8,4,'j_spinelower','j_hip_le'],
  ['j_spinelower',8,2,'j_spineupper','j_hip_le'],
  ['j_spineupper',9,3,'j_spine4','j_shoulder_le'],
  ['j_spine4',8,2,'j_head','j_shoulder_le'],
  ['j_head',5,1,'j_head_end'],['j_head_end',3,.5],
  ...['le','ri'].flatMap(s=>[
    ['j_hip_'+s,4,1.5,'j_knee_'+s],['j_knee_'+s,4,1,'j_ankle_'+s],
    ['j_ankle_'+s,3,.7,'j_ball_'+s],['j_ball_'+s,2,.4],
    ['j_shoulder_'+s,4,1,'j_elbow_'+s],['j_elbow_'+s,3,.7,'j_wrist_'+s],
    ['j_wrist_'+s,3,.4]])
];

// Position-based articulated bodies: one reusable solver per prepared actor,
// fixed simulation steps, swept world contacts and sleeping settled corpses.
export class SkeletonRagdoll {
  constructor(root){
    this.root=root;this.transforms=[];root.traverse(bone=>{if(bone.isBone)this.transforms.push({bone,position:bone.position.clone(),quaternion:bone.quaternion.clone(),frozenPosition:new THREE.Vector3(),frozenQuaternion:new THREE.Quaternion()});});
    const depth=b=>{let n=0;for(;b.parent;b=b.parent)n++;return n;};
    // Native heads are separate skinned models with duplicate neck/head bones.
    // Drive those followers from the body rig so the visible head cannot stay
    // upright while its ragdoll joint falls.
    const primaryBones=new Map();for(const t of this.transforms)if(!primaryBones.has(t.bone.name))primaryBones.set(t.bone.name,t.bone);
    this.followers=this.transforms.map(t=>({bone:t.bone,source:primaryBones.get(t.bone.name)})).filter(t=>t.bone!==t.source).sort((a,b)=>depth(a.bone)-depth(b.bone));
    this.nodes=JOINTS.map(([name,radius,mass,aim,side])=>{
      const bone=root.getObjectByName(name);if(!bone?.isBone)return null;
      return {bone,name,radius,inverseMass:1/mass,aimName:aim,sideName:side,
        p:new THREE.Vector3(),previous:new THREE.Vector3(),before:new THREE.Vector3(),display:new THREE.Vector3(),renderPrevious:new THREE.Vector3(),
        initialQuaternion:new THREE.Quaternion(),basisInverse:new THREE.Quaternion(),direction:new THREE.Vector3(),sideDirection:new THREE.Vector3(),
        half:[radius,radius,radius],start:[0,0,0],end:[0,0,0],normal:new THREE.Vector3()};
    }).filter(Boolean).sort((a,b)=>depth(a.bone)-depth(b.bone));
    this.byName=new Map(this.nodes.map(n=>[n.name,n]));const byBone=new Map(this.nodes.map(n=>[n.bone,n]));
    for(const n of this.nodes){let parent=n.bone.parent;while(parent&&!byBone.has(parent))parent=parent.parent;
      n.parent=byBone.get(parent);n.aim=this.byName.get(n.aimName)||n.parent;n.baseAim=n.aim;n.side=this.byName.get(n.sideName);
    }
    // Quadrupeds also have a main root/head, but lack the humanoid torso
    // required by this solver. They retain their native death/gib animation.
    this.ready=['j_mainroot','j_spinelower','j_spineupper','j_spine4','j_head'].every(name=>this.byName.has(name));
    this.constraints=[];this.delta=new THREE.Vector3();this.primary=new THREE.Vector3();this.secondary=new THREE.Vector3();this.x=new THREE.Vector3();this.y=new THREE.Vector3();this.z=new THREE.Vector3();
    this.frameMatrix=new THREE.Matrix4();this.parentInverse=new THREE.Matrix4();this.frameQuaternion=new THREE.Quaternion();this.worldQuaternion=new THREE.Quaternion();this.parentQuaternion=new THREE.Quaternion();
    this.detachedBones=new Set();this.active=false;this.sleeping=false;this.sleepPoseApplied=false;this.accumulator=0;this.elapsed=0;this.quiet=0;
  }
  frame(primary,secondary,out){
    if(primary.lengthSq()<1e-8)return false;this.z.copy(primary).normalize();
    this.x.copy(secondary).addScaledVector(this.z,-secondary.dot(this.z));if(this.x.lengthSq()<1e-8)return false;
    this.x.normalize();this.y.crossVectors(this.z,this.x).normalize();this.frameMatrix.makeBasis(this.x,this.y,this.z);out.setFromRotationMatrix(this.frameMatrix);return true;
  }
  start(enemy,direction=null,strength=60,collision=null){
    if(!this.ready||this.active)return false;
    this.active=true;this.sleeping=false;this.sleepPoseApplied=false;this.accumulator=0;this.elapsed=0;this.quiet=0;this.constraints.length=0;this.root.updateWorldMatrix(true,true);
    for(const t of this.transforms){t.frozenPosition.copy(t.bone.position);t.frozenQuaternion.copy(t.bone.quaternion);}
    for(const n of this.nodes){n.bone.getWorldPosition(n.p);n.bone.getWorldQuaternion(n.initialQuaternion);}
    for(const n of this.nodes)n.disabled=!!enemy.deathHeadshot&&['j_head','j_head_end'].includes(n.name);
    for(const n of this.nodes)n.aim=n.baseAim?.disabled?n.parent:n.baseAim;
    const pairs=new Set(),add=(a,b,min=1,max=1,stiffness=1,length=null)=>{
      a=this.byName.get(a);b=this.byName.get(b);if(!a||!b||a.disabled||b.disabled)return;
      const key=[a.name,b.name].sort().join(':');if(pairs.has(key))return;pairs.add(key);
      const d=length??a.p.distanceTo(b.p);this.constraints.push({a,b,min:d*min,max:d*max,stiffness});
    };
    for(const n of this.nodes)if(n.parent)add(n.name,n.parent.name);
    // Braces keep the chest and pelvis from twisting apart while arms and legs
    // remain articulated. Limb reach limits prevent inverted, folded joints.
    for(const group of [['j_mainroot','j_hip_le','j_hip_ri'],['j_spineupper','j_spine4','j_shoulder_le','j_shoulder_ri']])
      for(let a=0;a<group.length;a++)for(let b=a+1;b<group.length;b++)add(group[a],group[b]);
    add('j_mainroot','j_spine4',.9,1.02,.8);
    for(const s of ['le','ri'])for(const names of [['j_hip_'+s,'j_knee_'+s,'j_ankle_'+s],['j_shoulder_'+s,'j_elbow_'+s,'j_wrist_'+s]]){
      const [a,b,c]=names.map(name=>this.byName.get(name));if(a&&b&&c)add(a.name,c.name,.25,.995,.8,a.p.distanceTo(b.p)+b.p.distanceTo(c.p));
    }
    for(let a=0;a<this.nodes.length;a++)for(let b=a+1;b<this.nodes.length;b++){
      const p=this.nodes[a],q=this.nodes[b],radius=p.radius+q.radius;
      if(p.p.distanceTo(q.p)>radius*1.2)add(p.name,q.name,1,Infinity,.7,radius);
    }
    const push=this.delta.set(direction?.[0]??Math.cos(enemy.angle||0),direction?.[1]??Math.sin(enemy.angle||0),0);if(push.lengthSq()<1e-8)push.set(1,0,0);push.normalize();strength=THREE.MathUtils.clamp(strength,0,120);
    const feet=enemy.position[2],variation=Math.sin((enemy.id||1)*2.399963);
    for(const n of this.nodes){
      if(n.aim)n.direction.subVectors(n.aim.p,n.p).normalize();
      n.hasFrame=!!n.side&&this.frame(this.primary.subVectors(n.aim.p,n.p),this.secondary.subVectors(n.side.p,n.p),n.basisInverse);if(n.hasFrame)n.basisInverse.invert();
      // Feet receive less impulse than the torso, tipping the body instead of
      // translating an upright corpse. Preserve some of the zombie's momentum.
      const height=THREE.MathUtils.clamp((n.p.z-feet)/60,.1,1.3),drift=Math.min(80,enemy.speed||0)*.2;
      n.previous.copy(n.p).addScaledVector(push,-strength*height*STEP);
      n.previous.x-=(Math.cos(enemy.angle||0)*drift-push.y*variation*12*height)*STEP;
      n.previous.y-=(Math.sin(enemy.angle||0)*drift+push.x*variation*12*height)*STEP;n.previous.z-=8*height*STEP;
      n.renderPrevious.copy(n.p);n.display.copy(n.p);
    }
    // A hand or foot can start partly inside a sill or floor. Find a nearby
    // clear center once, rather than pinning that joint inside solid geometry.
    if(collision)for(const n of this.nodes){
      n.p.toArray(n.start);if(!collision.trace(n.start,n.start,n.half,1).allSolid)continue;
      let clear=false;for(const amount of [2,4,8,12]){for(const axis of [[0,0,1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,-1]]){
        for(let k=0;k<3;k++)n.end[k]=n.start[k]+axis[k]*amount;
        if(!collision.trace(n.end,n.end,n.half,1).allSolid){this.delta.fromArray(n.end).sub(n.p);n.p.add(this.delta);n.previous.add(this.delta);n.renderPrevious.copy(n.p);clear=true;break;}
      }if(clear)break;}
    }
    return true;
  }
  restoreFrozen(){for(const t of this.transforms){t.bone.position.copy(t.frozenPosition);t.bone.quaternion.copy(t.frozenQuaternion);}}
  detachObject(root){root.traverse(bone=>{if(bone.isBone)this.detachedBones.add(bone);});}
  reset(){
    this.active=false;this.sleeping=false;this.sleepPoseApplied=false;this.accumulator=0;this.elapsed=0;this.quiet=0;this.constraints.length=0;
    this.detachedBones.clear();for(const n of this.nodes){n.disabled=false;n.aim=n.baseAim;}
    for(const t of this.transforms){t.bone.position.copy(t.position);t.bone.quaternion.copy(t.quaternion);}
  }
  contact(n,collision){
    if(!collision)return false;let touched=false;n.before.toArray(n.start);n.p.toArray(n.end);
    for(let attempt=0;attempt<3;attempt++){
      const hit=collision.trace(n.start,n.end,n.half,1);
      if(hit.allSolid){n.p.fromArray(n.start);n.normal.fromArray(hit.normal);touched=true;break;}
      n.p.fromArray(hit.end);if(hit.fraction===1)break;
      n.normal.fromArray(hit.normal);touched=true;this.delta.fromArray(n.end).sub(n.p);this.delta.addScaledVector(n.normal,-Math.min(0,this.delta.dot(n.normal)));
      n.p.addScaledVector(n.normal,.035);n.p.toArray(n.start);
      for(let k=0;k<3;k++)n.end[k]=n.start[k]+this.delta.getComponent(k)*(hit.normal[2]>.65?.8:.95);
    }
    if(touched){
      this.delta.subVectors(n.p,n.before);const inward=this.delta.dot(n.normal);if(inward<0)this.delta.addScaledVector(n.normal,-inward*1.05);
      this.delta.multiplyScalar(n.normal.z>.65?.72:.9);n.previous.copy(n.p).sub(this.delta);
    }
    return touched;
  }
  step(collision){
    let contacts=0,speed=0;
    for(const n of this.nodes){if(n.disabled)continue;n.renderPrevious.copy(n.p);n.before.copy(n.p);this.delta.subVectors(n.p,n.previous).multiplyScalar(.994);n.previous.copy(n.p);n.p.add(this.delta);n.p.z-=GRAVITY*STEP*STEP;}
    for(let pass=0;pass<6;pass++)for(const c of this.constraints){
      const dx=c.b.p.x-c.a.p.x,dy=c.b.p.y-c.a.p.y,dz=c.b.p.z-c.a.p.z,d=Math.hypot(dx,dy,dz);if(d<1e-8||d>=c.min&&d<=c.max)continue;
      const target=d<c.min?c.min:c.max,correction=(d-target)/d*c.stiffness/(c.a.inverseMass+c.b.inverseMass),a=correction*c.a.inverseMass,b=correction*c.b.inverseMass;
      c.a.p.x+=dx*a;c.a.p.y+=dy*a;c.a.p.z+=dz*a;c.b.p.x-=dx*b;c.b.p.y-=dy*b;c.b.p.z-=dz*b;
    }
    for(const n of this.nodes){if(n.disabled)continue;if(this.contact(n,collision))contacts++;speed=Math.max(speed,n.p.distanceToSquared(n.before)/(STEP*STEP));}
    this.elapsed+=STEP;this.quiet=contacts>=3&&speed<144?this.quiet+STEP:0;
    if(this.quiet>.35||this.elapsed>=4)this.sleeping=true;
  }
  applyPose(alpha=1){
    for(const n of this.nodes)n.display.lerpVectors(n.renderPrevious,n.p,alpha);
    for(const n of this.nodes){
      if(n.disabled)continue;
      this.worldQuaternion.copy(n.initialQuaternion);
      if(n.aim){this.primary.subVectors(n.aim.display,n.display);
        if(n.hasFrame&&this.frame(this.primary,this.secondary.subVectors(n.side.display,n.display),this.frameQuaternion))this.worldQuaternion.copy(this.frameQuaternion).multiply(n.basisInverse).multiply(n.initialQuaternion);
        else if(this.primary.lengthSq()>1e-8)this.worldQuaternion.setFromUnitVectors(n.direction,this.primary.normalize()).multiply(n.initialQuaternion);
      }
      n.bone.parent.updateWorldMatrix(true,false);this.parentInverse.copy(n.bone.parent.matrixWorld).invert();n.bone.position.copy(n.display).applyMatrix4(this.parentInverse);
      n.bone.parent.getWorldQuaternion(this.parentQuaternion);n.bone.quaternion.copy(this.parentQuaternion).invert().multiply(this.worldQuaternion).normalize();n.bone.updateWorldMatrix(false,false);
    }
    for(const {bone,source}of this.followers){
      if(this.detachedBones.has(bone))continue;
      bone.parent.updateWorldMatrix(true,false);this.parentInverse.copy(bone.parent.matrixWorld).invert();source.getWorldPosition(this.delta);bone.position.copy(this.delta).applyMatrix4(this.parentInverse);
      source.getWorldQuaternion(this.worldQuaternion);bone.parent.getWorldQuaternion(this.parentQuaternion);bone.quaternion.copy(this.parentQuaternion).invert().multiply(this.worldQuaternion).normalize();bone.updateWorldMatrix(false,false);
    }
    this.root.updateWorldMatrix(true,true);
  }
  update(dt,collision){
    if(!this.active||this.sleeping&&this.sleepPoseApplied)return;
    if(Number.isFinite(dt)&&dt>0&&!this.sleeping){this.accumulator+=Math.min(dt,.1);
      while(this.accumulator+1e-9>=STEP&&!this.sleeping){this.accumulator=Math.max(0,this.accumulator-STEP);this.step(collision);}
    }
    this.applyPose(this.sleeping?1:this.accumulator/STEP);
    this.sleepPoseApplied=this.sleeping;
  }
}
