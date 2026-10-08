import * as THREE from 'three';

// Native IW7 local bone keys, kept at their original frame times. No generated
// walking poses: movement, attacks, deaths, weapon actions and gestures use XAnim.
export function sampleKeys(keys,frame,output,quaternion=false){
  if(!keys?.length)return false;
  let lo=0,hi=keys.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(keys[mid][0]<=frame)lo=mid;else hi=mid-1;}
  const a=keys[lo],b=keys[Math.min(lo+1,keys.length-1)],t=a===b?0:THREE.MathUtils.clamp((frame-a[0])/(b[0]-a[0]),0,1);
  if(quaternion){output.fromArray(a,1).normalize();_targetQ.fromArray(b,1).normalize();output.slerp(_targetQ,t);}
  else output.set(a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t);
  return true;
}
const _q=new THREE.Quaternion(),_targetQ=new THREE.Quaternion(),_p=new THREE.Vector3();

export function rigGeometry(buffer,definition){
  const h=new DataView(buffer),n=h.getUint32(8,true),count=h.getUint32(12,true);
  if(h.getUint32(0,true)!==0x52375749||h.getUint32(4,true)!==1||buffer.byteLength!==16+n*80+count*4)throw new Error('Invalid native IW7 skeletal mesh');
  const geometry=new THREE.BufferGeometry(),v=new THREE.InterleavedBuffer(new Float32Array(buffer,16,n*8),8);
  geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(v,3,0));geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(v,2,3));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(v,3,5));
  const j=new THREE.InterleavedBuffer(new Uint16Array(buffer,16+n*32,n*8),8),w=new THREE.InterleavedBuffer(new Float32Array(buffer,16+n*48,n*8),8);
  geometry.setAttribute('skinIndex',new THREE.InterleavedBufferAttribute(j,4,0));geometry.setAttribute('skinWeight',new THREE.InterleavedBufferAttribute(w,4,0));
  geometry.setAttribute('skinIndex2',new THREE.InterleavedBufferAttribute(j,4,4));geometry.setAttribute('skinWeight2',new THREE.InterleavedBufferAttribute(w,4,4));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,16+n*80,count),1));definition.groups.forEach((g,i)=>geometry.addGroup(g.start,g.count,i));geometry.computeBoundingSphere();return geometry;
}

export function nativeSkinMaterial(source){
  const material=source.clone();material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <skinning_pars_vertex>','#include <skinning_pars_vertex>\n#ifdef USE_SKINNING\nattribute vec4 skinIndex2;\nattribute vec4 skinWeight2;\n#endif');
    shader.vertexShader=shader.vertexShader.replace('#include <skinbase_vertex>','#include <skinbase_vertex>\n#ifdef USE_SKINNING\nmat4 boneMatE=getBoneMatrix(skinIndex2.x);mat4 boneMatF=getBoneMatrix(skinIndex2.y);mat4 boneMatG=getBoneMatrix(skinIndex2.z);mat4 boneMatH=getBoneMatrix(skinIndex2.w);\n#endif');
    shader.vertexShader=shader.vertexShader.replace('#include <skinning_vertex>',`#ifdef USE_SKINNING
      vec4 skinVertex=bindMatrix*vec4(transformed,1.0);
      vec4 skinned=boneMatX*skinVertex*skinWeight.x+boneMatY*skinVertex*skinWeight.y+boneMatZ*skinVertex*skinWeight.z+boneMatW*skinVertex*skinWeight.w;
      skinned+=boneMatE*skinVertex*skinWeight2.x+boneMatF*skinVertex*skinWeight2.y+boneMatG*skinVertex*skinWeight2.z+boneMatH*skinVertex*skinWeight2.w;
      transformed=(bindMatrixInverse*skinned).xyz;
    #endif`);
    shader.vertexShader=shader.vertexShader.replace('#include <skinnormal_vertex>',`#ifdef USE_SKINNING
      mat4 skinMatrix=skinWeight.x*boneMatX+skinWeight.y*boneMatY+skinWeight.z*boneMatZ+skinWeight.w*boneMatW;
      skinMatrix+=skinWeight2.x*boneMatE+skinWeight2.y*boneMatF+skinWeight2.z*boneMatG+skinWeight2.w*boneMatH;
      skinMatrix=bindMatrixInverse*skinMatrix*bindMatrix;objectNormal=vec4(skinMatrix*vec4(objectNormal,0.0)).xyz;
      #ifdef USE_TANGENT
        objectTangent=vec4(skinMatrix*vec4(objectTangent,0.0)).xyz;
      #endif
    #endif`);
  };material.customProgramCacheKey=()=> 'iw7-eight-influences-v1';return material;
}

export class NativeActor {
  constructor(definition,geometry,materials,{relativePositions=false}={}){
    this.relativePositions=relativePositions;
    this.definition=definition;this.root=new THREE.Group();this.bones=definition.bones.map(d=>{const bone=new THREE.Bone();bone.name=d.name;bone.position.fromArray(d.position);bone.quaternion.fromArray(d.rotation).normalize();return bone;});
    definition.bones.forEach((d,i)=>{(d.parent<0?this.root:this.bones[d.parent]).add(this.bones[i]);});
    this.mesh=new THREE.SkinnedMesh(geometry,definition.groups.map(g=>materials.get(g.material)));this.root.add(this.mesh);this.root.updateMatrixWorld(true);
    this.skeleton=new THREE.Skeleton(this.bones);this.mesh.bind(this.skeleton);this.mesh.frustumCulled=false;
    this.named=new Map(this.bones.map(b=>[b.name,b]));this.bind=definition.bones.map(d=>({p:new THREE.Vector3().fromArray(d.position),q:new THREE.Quaternion().fromArray(d.rotation).normalize()}));
    this.bindPosition=new Map(this.bones.map((b,i)=>[b,this.bind[i].p]));
    this.time=0;this.clip=null;this.loop=false;this.rate=1;this.onNote=null;this.bindings=new WeakMap();this.fade=0;this.from=[];
  }
  play(clip,{loop=clip?.loop,rate=1,blend=.12,restart=false}={}){
    if(!clip)throw new Error('Original IW7 animation was not loaded');
    if(this.clip===clip&&!restart)return;
    this.from=this.bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone()}));this.fade=blend;this.fadeTotal=blend;this.clip=clip;this.time=0;this.loop=loop;this.rate=rate;this.done=false;
  }
  tracks(clip){if(!this.bindings.has(clip))this.bindings.set(clip,Object.entries(clip.bones).map(([name,tracks])=>({bone:this.named.get(name),tracks})).filter(v=>v.bone));return this.bindings.get(clip);}
  resetPose(){this.bones.forEach((b,i)=>{b.position.copy(this.bind[i].p);b.quaternion.copy(this.bind[i].q);});}
  apply(clip,time,weight=1){
    const frame=Math.min(clip.frames,time*clip.fps);
    for(const {bone,tracks}of this.tracks(clip)){
      // NPC and gun-hierarchy translations are bind offsets. Viewhands use
      // absolute local keys. Rotations are local poses in both cases.
      if(tracks.position){sampleKeys(tracks.position,frame,_p);if(!clip.viewmodel||this.relativePositions)_p.add(this.bindPosition.get(bone));bone.position.lerp(_p,weight);}
      if(tracks.rotation){sampleKeys(tracks.rotation,frame,_q,true);bone.quaternion.slerp(_q,weight);}
    }
  }
  additive(clip,time,weight=1){
    const frame=Math.min(clip.frames,time*clip.fps);
    for(const {bone,tracks}of this.tracks(clip)){
      if(tracks.position){sampleKeys(tracks.position,frame,_p);bone.position.addScaledVector(_p,weight);}
      if(tracks.rotation){sampleKeys(tracks.rotation,frame,_q,true);_targetQ.identity().slerp(_q,weight);bone.quaternion.multiply(_targetQ);}
    }
  }
  update(dt){
    if(!this.clip)return;const previous=this.time,duration=this.clip.duration;
    this.time+=dt*this.rate;
    if(this.onNote)for(const note of this.clip.notes){if(note.time>previous&&note.time<=Math.min(this.time,duration))this.onNote(note.name);}
    if(this.loop&&duration>0)this.time%=duration;else if(this.time>=duration){this.time=duration;this.done=true;}
    this.resetPose();this.apply(this.clip,this.time);
    if(this.fade>0){this.fade=Math.max(0,this.fade-dt);const t=1-this.fade/this.fadeTotal;this.bones.forEach((b,i)=>{b.position.lerpVectors(this.from[i].p,b.position,t);_q.copy(b.quaternion);b.quaternion.copy(this.from[i].q).slerp(_q,t);});}
    this.root.updateMatrixWorld(true);
  }
  dispose(){this.skeleton.dispose();}
}

// Numbers taken from IW7 scripts/cp/zombies/zombies_spawning.gsc.
export const iwHealth=round=>Math.min(6100000,Math.floor(round<=9?150+(round-1)*100:950*1.1**(round-9)));
export function iwRoundCount(round,players=1){const early=[0,.25,.3,.5,.7,.9];const scale=round<6?early[round]:1,factor=round<6?1:round<10?round/5:round*round*.03;return Math.floor((24+Math.max(.5,players-1)*6*factor)*scale);}
export const iwSpawnDelay=round=>Math.max(.08,2*.95**(round-1));
// zombie_agent.gsc::calulatezombiemovemode (the original spelling).
export function iwMoveMode(round,random=Math.random){if(round===1)return 'slow_walk';const roll=round*4+Math.floor(random()*35);return roll<=32?'slow_walk':roll<=55?'walk':roll<=78?'run':'sprint';}
export function nativeStrideSpeed(clip){const keys=clip.delta?.position;if(!keys?.length||!clip.duration)return 0;return Math.hypot(...keys.at(-1).slice(1).map((v,i)=>v-keys[0][i+1]))/clip.duration;}
